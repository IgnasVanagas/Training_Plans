from __future__ import annotations

from datetime import date, datetime

import pytest

from app.models import PlannedWorkout, RoleEnum, SeasonPlan, User
from app.routers import planning as planning_router
from app.schemas import SeasonPlanSaveRequest
from app.services.season_planner import build_generated_workouts


class _Result:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalars(self):
        return self

    def all(self):
        if isinstance(self._value, list):
            return list(self._value)
        return []


class _FakeDB:
    def __init__(self, results):
        self.results = list(results)
        self.added = []
        self.deleted = []
        self.commits = 0

    async def execute(self, _stmt):
        return self.results.pop(0)

    def add(self, obj):
        self.added.append(obj)

    async def delete(self, obj):
        self.deleted.append(obj)

    async def commit(self):
        self.commits += 1

    async def refresh(self, _obj):
        return None


def _sample_payload() -> SeasonPlanSaveRequest:
    return SeasonPlanSaveRequest(
        name="Summer Focus",
        sport_type="Running",
        season_start=date(2026, 4, 1),
        season_end=date(2026, 7, 31),
        notes="Key spring-summer block",
        target_metrics=[{"metric": "10k pace", "value": "4:00/km", "unit": "min/km"}],
        goal_races=[
            {
                "name": "City 10K",
                "date": date(2026, 6, 20),
                "priority": "A",
                "target_metrics": [{"metric": "Goal pace", "value": "4:00/km", "unit": "min/km"}],
            }
        ],
        constraints=[
            {
                "name": "Work travel",
                "kind": "travel",
                "start_date": date(2026, 5, 11),
                "end_date": date(2026, 5, 14),
                "severity": "moderate",
                "impact": "avoid_intensity",
            }
        ],
        periodization={
            "weekly_hours_target": 7.5,
            "longest_session_minutes": 110,
            "training_days_per_week": 5,
            "recovery_week_frequency": 4,
            "taper_profile": "standard",
        },
    )


def test_build_generated_workouts_creates_countdowns_taper_and_constraints():
    payload = _sample_payload()

    preview = build_generated_workouts(payload)

    assert preview["summary"]["race_count"] == 1
    assert preview["summary"]["generated_workout_count"] > 0
    assert preview["countdowns"][0]["name"] == "City 10K"
    assert preview["countdowns"][0]["taper_starts_on"] == "2026-06-06"

    taper_weeks = [row for row in preview["micro_cycles"] if row["phase"] == "taper"]
    assert taper_weeks
    constrained_weeks = [row for row in preview["micro_cycles"] if row["constraints"]]
    assert constrained_weeks
    assert any("Work travel" in item for row in constrained_weeks for item in row["constraints"])
    assert any(workout["planning_context"]["phase"] == "race" for workout in preview["generated_workouts"] if workout["title"].startswith("A Race"))


@pytest.mark.asyncio
async def test_apply_season_plan_preserves_manual_workouts_and_adds_generated_rows(monkeypatch):
    preview = build_generated_workouts(_sample_payload())
    generated = preview["generated_workouts"]
    first_generated_date = date.fromisoformat(generated[0]["date"])

    season_plan = SeasonPlan(
        id=11,
        athlete_id=3,
        coach_id=None,
        name="Summer Focus",
        sport_type="Running",
        season_start=date(2026, 4, 1),
        season_end=date(2026, 7, 31),
        notes="Key spring-summer block",
        target_metrics=[],
        goal_races=[],
        constraints=[],
        periodization={},
        generated_summary=preview,
        created_at=datetime.now(),
        updated_at=datetime.now(),
    )
    manual_workout = PlannedWorkout(
        id=91,
        user_id=3,
        created_by_user_id=3,
        date=first_generated_date,
        title="Coach Override",
        description="Manual session",
        sport_type="Running",
        planned_duration=45,
        season_plan_id=None,
    )
    current_user = User(id=3, email="athlete@example.com", password_hash="x", role=RoleEnum.athlete, email_verified=True)
    db = _FakeDB([
        _Result(season_plan),
        _Result(None),
        _Result([manual_workout]),
    ])

    async def _skip_match_and_score(_db, _athlete_id, _target_date):
        return None

    monkeypatch.setattr(planning_router, "match_and_score", _skip_match_and_score)

    response = await planning_router.apply_season_plan(
        plan_id=11,
        replace_generated=True,
        current_user=current_user,
        db=db,
    )

    created_workouts = [row for row in db.added if isinstance(row, PlannedWorkout)]
    assert response.plan_id == 11
    assert response.skipped_count >= 1
    assert response.preserved_manual_count >= 1
    assert created_workouts
    assert all(row.season_plan_id == 11 for row in created_workouts)
    assert all(row.date != manual_workout.date for row in created_workouts)
