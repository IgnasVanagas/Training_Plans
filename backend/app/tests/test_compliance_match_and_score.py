from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest

from app.models import Activity, ComplianceStatusEnum, PlannedWorkout
from app.services import compliance as compliance_service


class _Result:
    def __init__(self, values):
        self._values = list(values)

    def scalars(self):
        return self

    def all(self):
        return list(self._values)


class _FakeDB:
    def __init__(self, *, execute_results, scalar_results=None):
        self.execute_results = list(execute_results)
        self.scalar_results = list(scalar_results or [])
        self.added = []
        self.commits = 0
        self.executed_statements = []

    async def execute(self, stmt):
        self.executed_statements.append(stmt)
        if not self.execute_results:
            raise AssertionError(f"Unexpected execute call: {stmt}")
        return self.execute_results.pop(0)

    async def scalar(self, _stmt):
        if self.scalar_results:
            return self.scalar_results.pop(0)
        return None

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commits += 1


def _planned_workout(*, workout_id: int, workout_date: date, matched_activity_id: int | None = None) -> PlannedWorkout:
    return PlannedWorkout(
        id=workout_id,
        user_id=7,
        date=workout_date,
        title="Morning Run",
        description=None,
        sport_type="Running",
        planned_duration=60,
        planned_distance=10.0,
        planned_intensity="Zone 2",
        matched_activity_id=matched_activity_id,
        compliance_status=ComplianceStatusEnum.planned,
    )


def _activity(*, activity_id: int, created_at: datetime, local_date: date) -> Activity:
    return Activity(
        id=activity_id,
        athlete_id=7,
        filename="run.fit",
        file_path="uploads/run.fit",
        file_type="provider",
        sport="Running",
        created_at=created_at,
        distance=10_000.0,
        duration=3_600.0,
        local_date=local_date,
        streams={
            "provider_payload": {
                "summary": {
                    "start_date_local": f"{local_date.isoformat()}T06:30:00",
                }
            }
        },
    )


@pytest.mark.asyncio
async def test_match_and_score_matches_by_local_date_even_when_utc_day_differs():
    target_date = date(2026, 3, 2)
    workout = _planned_workout(workout_id=1, workout_date=target_date)
    activity = _activity(
        activity_id=11,
        created_at=datetime(2026, 3, 1, 23, 30, 0),
        local_date=target_date,
    )
    db = _FakeDB(
        execute_results=[
            _Result([workout]),
            _Result([activity]),
            _Result([]),
        ],
        scalar_results=[None, None],
    )

    await compliance_service.match_and_score(db, 7, target_date)

    compiled = db.executed_statements[1].compile()
    assert compiled.params["local_date_1"] == target_date
    assert "activities.local_date = :local_date_1" in str(compiled)
    assert workout.matched_activity_id == activity.id
    assert workout.compliance_status == ComplianceStatusEnum.completed_green
    assert db.commits == 1


@pytest.mark.asyncio
async def test_match_and_score_clears_conflicting_workout_links_for_same_activity():
    target_date = date(2026, 3, 2)
    workout = _planned_workout(workout_id=1, workout_date=target_date)
    conflicting_workout = _planned_workout(
        workout_id=2,
        workout_date=date.today() + timedelta(days=5),
        matched_activity_id=11,
    )
    conflicting_workout.compliance_status = ComplianceStatusEnum.completed_green
    activity = _activity(
        activity_id=11,
        created_at=datetime(2026, 3, 1, 23, 30, 0),
        local_date=target_date,
    )
    db = _FakeDB(
        execute_results=[
            _Result([workout]),
            _Result([activity]),
            _Result([conflicting_workout]),
        ],
        scalar_results=[None, None],
    )

    await compliance_service.match_and_score(db, 7, target_date)

    assert conflicting_workout.matched_activity_id is None
    assert conflicting_workout.compliance_status == ComplianceStatusEnum.planned
    assert workout.matched_activity_id == activity.id
    assert db.commits == 1