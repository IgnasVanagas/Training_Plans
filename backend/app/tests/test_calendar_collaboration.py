from __future__ import annotations

from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest

from fastapi import HTTPException
from app.models import Activity, PlannedWorkout, RoleEnum, User
from app.routers import calendar as calendar_router
from app.schemas import CalendarApprovalDecisionRequest, PlannedWorkoutCreate, PlannedWorkoutUpdate
from app.services import permissions as permissions_service


class _ScalarListResult:
    def __init__(self, values):
        self._values = list(values)

    def scalars(self):
        return self

    def all(self):
        return list(self._values)

    def first(self):
        return self._values[0] if self._values else None


class _ScalarValueResult:
    def __init__(self, value):
        self._value = value

    def scalar(self):
        return self._value


class _ShareSettingsDB:
    def __init__(self, orgs):
        self.orgs = list(orgs)
        self.added = []
        self.commits = 0

    async def execute(self, stmt):
        return _ScalarListResult(self.orgs)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commits += 1


class _VersionDB:
    def __init__(self, current_max):
        self.current_max = current_max
        self.added = []

    async def execute(self, stmt):
        return _ScalarValueResult(self.current_max)

    def add(self, obj):
        self.added.append(obj)


class _WorkoutDB:
    def __init__(self, workout):
        self.workout = workout

    async def execute(self, stmt):
        rows = [self.workout] if self.workout is not None else []
        return _ScalarListResult(rows)


class _CalendarCrudDB:
    def __init__(self, *, execute_results=None, scalar_results=None):
        self.execute_results = list(execute_results or [])
        self.scalar_results = list(scalar_results or [])
        self.added = []
        self.deleted = []
        self.flushed = 0
        self.commits = 0
        self.refreshed = []
        self._next_workout_id = 1000

    async def execute(self, stmt):
        if not self.execute_results:
            return _ScalarListResult([])
        return self.execute_results.pop(0)

    async def scalar(self, stmt):
        if not self.scalar_results:
            return None
        return self.scalar_results.pop(0)

    def add(self, obj):
        if obj not in self.added:
            self.added.append(obj)

    async def flush(self):
        self.flushed += 1
        for obj in self.added:
            if isinstance(obj, PlannedWorkout) and getattr(obj, "id", None) is None:
                obj.id = self._next_workout_id
                self._next_workout_id += 1

    async def commit(self):
        self.commits += 1

    async def refresh(self, obj):
        self.refreshed.append(obj)

    async def delete(self, obj):
        self.deleted.append(obj)


def test_merge_effective_permissions_is_restrictive_for_grants_and_escalates_approval_requirement():
    current = permissions_service.DEFAULT_PERMISSIONS.copy()
    parsed = permissions_service.normalize_permissions({
        "allow_edit_workouts": False,
        "allow_export_calendar": False,
        "require_workout_approval": True,
    })

    merged = permissions_service._merge_effective_permissions(current, parsed)

    assert merged["allow_edit_workouts"] is False
    assert merged["allow_export_calendar"] is False
    assert merged["require_workout_approval"] is True


def test_normalize_calendar_share_settings_applies_safe_defaults():
    settings = calendar_router._normalize_calendar_share_settings({
        "enabled": True,
        "token": "abc123",
        "include_completed": True,
    })

    assert settings == {
        "enabled": True,
        "token": "abc123",
        "include_completed": True,
        "include_descriptions": False,
    }


def test_approval_from_planning_context_ignores_invalid_payloads():
    assert calendar_router._approval_from_planning_context(None) is None
    assert calendar_router._approval_from_planning_context({"approval": {"status": "other"}}) is None

    approval = calendar_router._approval_from_planning_context({
        "approval": {
            "status": "pending",
            "request_type": "update",
            "requested_by_user_id": 14,
        }
    })

    assert approval is not None
    assert approval["status"] == "pending"
    assert approval["request_type"] == "update"


def test_compute_workout_diff_detects_field_changes():
    before = {
        "title": "Tempo",
        "planned_duration": 60,
        "planning_context": {"a": 1},
    }
    after = {
        "title": "Tempo + strides",
        "planned_duration": 60,
        "planning_context": {"a": 2},
    }

    diff = calendar_router._compute_workout_diff(before, after)

    assert {item["field"] for item in diff} == {"title", "planning_context"}
    assert any(item["field"] == "title" and item["before"] == "Tempo" and item["after"] == "Tempo + strides" for item in diff)


def test_escape_ics_text_and_approval_helpers_cover_context_round_trip():
    assert calendar_router._escape_ics_text("Tempo, build;\\check\nnext") == "Tempo\\, build\\;\\\\check\\nnext"
    assert calendar_router._approval_datetime("2026-03-01T10:00:00Z") == datetime(2026, 3, 1, 10, 0, tzinfo=timezone.utc)
    assert calendar_router._approval_datetime("bad-value") is None

    serialized = calendar_router._serialize_proposed_changes(
        {
            "date": date(2026, 3, 10),
            "updated_at": datetime(2026, 3, 1, 10, 15, 0),
            "title": "Tempo",
        }
    )
    assert serialized == {
        "date": "2026-03-10",
        "updated_at": "2026-03-01T10:15:00",
        "title": "Tempo",
    }

    planning_context = {
        "approval": {
            "status": "pending",
            "request_type": "update",
            "requested_by_user_id": 14,
            "requested_at": "2026-03-01T10:00:00Z",
            "proposed_changes": {"title": "Tempo + strides"},
        },
        "notes": "keep",
    }
    assert calendar_router._strip_approval_context(planning_context) == {"notes": "keep"}
    assert calendar_router._strip_approval_context({"approval": planning_context["approval"]}) is None

    next_context = calendar_router._set_approval_context(
        {"notes": "keep"},
        status="pending",
        request_type="create",
        requested_by_user_id=42,
        proposed_changes={"title": "New workout"},
    )
    assert next_context["notes"] == "keep"
    assert next_context["approval"]["status"] == "pending"
    assert next_context["approval"]["request_type"] == "create"
    assert next_context["approval"]["requested_by_user_id"] == 42
    assert next_context["approval"]["proposed_changes"] == {"title": "New workout"}

    workout = PlannedWorkout(title="Tempo", planning_context=planning_context)
    annotated = calendar_router._annotate_workout_with_approval(workout, {14: "Coach Example"})
    assert annotated.approval_status == "pending"
    assert annotated.approval_request_type == "update"
    assert annotated.approval_requested_by_user_id == 14
    assert annotated.approval_requested_by_name == "Coach Example"
    assert annotated.approval_requested_at == datetime(2026, 3, 1, 10, 0, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_share_settings_helpers_round_trip_and_find_token(monkeypatch):
    org = SimpleNamespace(id=1, settings_json={})
    db = _ShareSettingsDB([org])

    monkeypatch.setattr(calendar_router.uuid, "uuid4", lambda: SimpleNamespace(hex="share-token"))

    saved = await calendar_router._set_calendar_share_settings(
        db,
        athlete_id=22,
        org_ids=[1],
        payload={"enabled": True, "include_completed": True},
    )

    assert saved == {
        "enabled": True,
        "token": "share-token",
        "include_completed": True,
        "include_descriptions": False,
    }
    assert db.commits == 1
    assert org.settings_json["calendar_public_shares"]["22"] == saved

    loaded = await calendar_router._get_calendar_share_settings(db, athlete_id=22, org_ids=[1])
    found = await calendar_router._find_share_by_token(db, "share-token")

    assert loaded == saved
    assert found == (22, saved)


@pytest.mark.asyncio
async def test_duration_recurrence_snapshot_and_version_helpers():
    structure = [
        {"type": "block", "duration": {"type": "time", "value": 300}},
        {
            "type": "repeat",
            "repeats": 2,
            "steps": [
                {"type": "block", "duration": {"type": "time", "value": 120}},
                {"type": "block", "duration": {"type": "distance", "value": 1000}},
            ],
        },
    ]
    recurrence = {"frequency": "weekly", "weekdays": [1, 3], "interval_weeks": 1}
    workout = PlannedWorkout(
        id=31,
        user_id=8,
        date=date(2026, 3, 10),
        title="Tempo",
        description="Main set",
        sport_type="Running",
        planned_duration=45,
        planned_distance=10.0,
        planned_intensity="Zone 3",
        structure=structure,
        season_plan_id=3,
        planning_context={"recurrence": recurrence},
    )

    assert calendar_router._estimate_planned_duration_minutes(structure) == 9
    assert calendar_router._estimate_planned_duration_minutes([{"type": "block", "duration": {"type": "distance", "value": 1000}}]) is None
    assert calendar_router._extract_recurrence(workout) == recurrence
    assert calendar_router._merge_planning_context({"approval": {"status": "pending"}}, recurrence) == {
        "approval": {"status": "pending"},
        "recurrence": recurrence,
    }
    assert calendar_router._merge_planning_context({"recurrence": recurrence}, None) is None

    snapshot = calendar_router._snapshot_workout(workout)
    assert snapshot["date"] == "2026-03-10"
    assert snapshot["title"] == "Tempo"

    workout.title = "Changed"
    workout.date = date(2026, 3, 11)
    calendar_router._apply_workout_snapshot(workout, snapshot)
    assert workout.title == "Tempo"
    assert workout.date == date(2026, 3, 10)

    db = _VersionDB(current_max=2)
    before_snapshot = {**snapshot, "title": "Before"}
    await calendar_router._record_workout_version(
        db,
        workout_id=workout.id,
        workout_user_id=workout.user_id,
        action="update",
        changed_by_user_id=99,
        before_snapshot=before_snapshot,
        after_snapshot=snapshot,
        note="edited",
    )

    version = db.added[0]
    assert version.version_number == 3
    assert version.note == "edited"
    assert any(item["field"] == "title" and item["before"] == "Before" and item["after"] == "Tempo" for item in version.diff_json)


@pytest.mark.parametrize(
    ("recurrence", "message"),
    [
        ({"frequency": "weekly", "weekdays": [7], "span_weeks": 1}, "between 0 and 6"),
        ({"frequency": "weekly", "weekdays": [1]}, "span_weeks or end_date"),
        ({"frequency": "weekly", "weekdays": [1], "end_date": "bad-date"}, "end_date is invalid"),
        ({"frequency": "weekly", "weekdays": [1], "end_date": "2026-03-01"}, "on or after"),
        ({"frequency": "weekly", "weekdays": [1], "span_weeks": 1, "exception_dates": ["bad-date"]}, "exception date is invalid"),
        ({"frequency": "weekly", "weekdays": [1], "end_date": "2035-03-01"}, "too many workouts"),
        ({"frequency": "weekly", "weekdays": [2], "end_date": "2026-03-10"}, "produced no workout dates"),
    ],
)
def test_expand_weekly_recurrence_dates_validates_bad_rules(recurrence, message):
    with pytest.raises(HTTPException) as exc_info:
        calendar_router._expand_weekly_recurrence_dates(date(2026, 3, 10), recurrence)

    assert message in exc_info.value.detail


def test_resolve_activity_local_date_prefers_provider_payload_and_falls_back_to_created_at():
    with_summary = Activity(
        id=71,
        athlete_id=8,
        filename="summary.fit",
        file_path="uploads/summary.fit",
        file_type="fit",
        sport="running",
        created_at=datetime(2026, 3, 10, 5, 0, 0),
        streams={"provider_payload": {"summary": {"start_date_local": "2026-03-09T23:45:00Z"}}},
    )
    fallback = Activity(
        id=72,
        athlete_id=8,
        filename="fallback.fit",
        file_path="uploads/fallback.fit",
        file_type="fit",
        sport="running",
        created_at=datetime(2026, 3, 10, 5, 0, 0),
        streams={"provider_payload": {"summary": {"start_date_local": "bad-value"}}},
    )

    assert calendar_router._resolve_activity_local_date(with_summary) == date(2026, 3, 9)
    assert calendar_router._resolve_activity_local_date(fallback) == date(2026, 3, 10)


@pytest.mark.asyncio
async def test_resolve_athlete_id_enforces_coach_access(monkeypatch):
    coach = User(id=99, email="coach@example.com", password_hash="x", role=RoleEnum.coach, email_verified=True)
    athlete = User(id=50, email="athlete@example.com", password_hash="x", role=RoleEnum.athlete, email_verified=True)
    seen = {}

    async def fake_check(coach_id, athlete_id, db):
        seen["pair"] = (coach_id, athlete_id)

    monkeypatch.setattr(calendar_router, "check_coach_access", fake_check)

    assert await calendar_router._resolve_athlete_id(coach, None, db=None) == 99
    assert await calendar_router._resolve_athlete_id(coach, 50, db=None) == 50
    assert seen["pair"] == (99, 50)

    with pytest.raises(HTTPException) as exc_info:
        await calendar_router._resolve_athlete_id(athlete, 99, db=None)
    assert exc_info.value.status_code == 403


def test_build_fit_workout_generates_bytes_for_mixed_step_types():
    workout = PlannedWorkout(
        id=81,
        user_id=8,
        title="Tempo Builder",
        sport_type="Running",
        structure=[
            {
                "type": "block",
                "category": "warmup",
                "description": "Warmup",
                "duration": {"type": "time", "value": 300},
                "target": {"type": "heart_rate_zone", "zone": 2},
            },
            {
                "type": "block",
                "category": "work",
                "description": "Power",
                "duration": {"type": "distance", "value": 1000},
                "target": {"type": "power", "min": 200, "max": 220},
            },
            {
                "type": "block",
                "category": "work",
                "description": "Pace",
                "duration": {"type": "time", "value": 600},
                "target": {"type": "pace", "min": 4.5, "max": 5.0},
            },
            {
                "type": "repeat",
                "repeats": 2,
                "steps": [
                    {
                        "type": "block",
                        "category": "recovery",
                        "description": "Easy",
                        "duration": {"type": "time", "value": 120},
                        "target": {"type": "power", "zone": 1},
                    }
                ],
            },
            {
                "type": "block",
                "category": "cooldown",
                "description": "Open",
                "duration": {},
                "target": {"type": "open"},
            },
        ],
    )

    fit_data = calendar_router._build_fit_workout(workout)

    assert isinstance(fit_data, bytes)
    assert len(fit_data) > 64
    assert b".FIT" in fit_data[:16]


@pytest.mark.asyncio
async def test_download_fit_and_ics_exports_return_expected_payloads(monkeypatch):
    workout = PlannedWorkout(
        id=82,
        user_id=99,
        date=date(2026, 3, 10),
        title="Tempo, Builder",
        description="Line 1\nLine 2",
        sport_type="Running",
        planned_duration=45,
        planned_distance=10.0,
        planned_intensity="Zone 3",
        structure=[{"type": "block", "duration": {"type": "time", "value": 300}}],
    )
    db = _WorkoutDB(workout)
    current_user = User(id=99, email="coach@example.com", password_hash="x", role=RoleEnum.coach, email_verified=True)

    monkeypatch.setattr(calendar_router, "_build_fit_workout", lambda workout: b"FITDATA")

    fit_response = await calendar_router.download_workout_fit(workout_id=82, current_user=current_user, db=db)
    ics_response = await calendar_router.download_workout(workout_id=82, current_user=current_user, db=db)

    assert fit_response.body == b"FITDATA"
    assert fit_response.headers["content-disposition"] == 'attachment; filename="Tempo Builder.fit"'

    ics_body = ics_response.body.decode("utf-8")
    assert "SUMMARY:Tempo\\, Builder" in ics_body
    assert "DESCRIPTION:Line 1\\nLine 2\\nSport: Running\\nDuration: 45 min\\nDistance: 10.0 km\\nIntensity: Zone 3" in ics_body
    assert "DTSTART;VALUE=DATE:20260310" in ics_body

    async def fake_public_calendar(**kwargs):
        return SimpleNamespace(
            events=[
                SimpleNamespace(
                    is_planned=True,
                    id=5,
                    date=date(2026, 3, 10),
                    title="Planned, Workout",
                    description="Session; notes",
                ),
                SimpleNamespace(
                    is_planned=False,
                    id=6,
                    date=date(2026, 3, 10),
                    title="Activity",
                    description="ignore",
                ),
            ]
        )

    monkeypatch.setattr(calendar_router, "get_public_calendar", fake_public_calendar)
    public_ics = await calendar_router.download_public_calendar_ics(
        token="share-token",
        start_date=date(2026, 3, 10),
        end_date=date(2026, 3, 11),
        db=None,
    )

    public_body = public_ics.body.decode("utf-8")
    assert "SUMMARY:Planned\\, Workout" in public_body
    assert "DESCRIPTION:Session\\; notes" in public_body
    assert "Activity" not in public_body


@pytest.mark.asyncio
async def test_create_workout_builds_recurrence_and_pending_approval(monkeypatch):
    recorded_actions = []
    scored_dates = []
    db = _CalendarCrudDB()
    current_user = User(id=50, email="athlete@example.com", password_hash="x", role=RoleEnum.athlete, email_verified=True)

    async def fake_permissions(db, athlete_id):
        return {"require_workout_approval": True}

    async def fake_record_version(db, **kwargs):
        recorded_actions.append((kwargs["action"], kwargs["workout_id"]))

    async def fake_match_and_score(db, user_id, workout_date):
        scored_dates.append((user_id, workout_date))

    monkeypatch.setattr(calendar_router, "get_athlete_permissions", fake_permissions)
    monkeypatch.setattr(calendar_router, "_record_workout_version", fake_record_version)
    monkeypatch.setattr(calendar_router, "match_and_score", fake_match_and_score)

    workout_in = PlannedWorkoutCreate(
        date=date(2026, 3, 10),
        title="Tempo",
        description="Main set",
        sport_type="Running",
        planned_duration=1,
        planned_distance=10.0,
        planned_intensity="Zone 3",
        structure=[
            {
                "id": "step-1",
                "type": "block",
                "category": "work",
                "description": "Tempo",
                "duration": {"type": "time", "value": 600},
                "target": {"type": "pace", "zone": 3},
            }
        ],
        recurrence={
            "frequency": "weekly",
            "interval_weeks": 1,
            "weekdays": [1, 3],
            "span_weeks": 2,
        },
    )

    result = await calendar_router.create_workout(workout_in=workout_in, athlete_id=None, current_user=current_user, db=db)

    created_workouts = [obj for obj in db.added if isinstance(obj, PlannedWorkout)]
    assert db.flushed == 1
    assert len(created_workouts) == 4
    assert result.id == 1000
    assert result.planned_duration == 10
    assert result.approval_status == "pending"
    assert result.approval_request_type == "create"
    assert result.approval_requested_by_name == "athlete@example.com"
    assert result.planning_context["recurrence"]["occurrences_total"] == 4
    assert result.planning_context["recurrence"]["occurrence_index"] == 1
    assert recorded_actions == [("create", 1000), ("create", 1001), ("create", 1002), ("create", 1003)]
    assert sorted(scored_dates, key=lambda item: item[1]) == [
        (50, date(2026, 3, 10)),
        (50, date(2026, 3, 12)),
        (50, date(2026, 3, 17)),
        (50, date(2026, 3, 19)),
    ]


@pytest.mark.asyncio
async def test_update_and_delete_workout_request_pending_approval_for_athlete(monkeypatch):
    recorded_actions = []
    current_user = User(id=50, email="athlete@example.com", password_hash="x", role=RoleEnum.athlete, email_verified=True)

    async def fake_permissions(db, athlete_id):
        return {
            "allow_edit_workouts": True,
            "allow_delete_workouts": True,
            "require_workout_approval": True,
        }

    async def fake_record_version(db, **kwargs):
        recorded_actions.append(kwargs["action"])

    monkeypatch.setattr(calendar_router, "get_athlete_permissions", fake_permissions)
    monkeypatch.setattr(calendar_router, "_record_workout_version", fake_record_version)

    update_workout = PlannedWorkout(
        id=200,
        user_id=50,
        date=date(2026, 3, 10),
        title="Tempo",
        description="Original",
        sport_type="Running",
        planned_duration=45,
        planning_context=None,
        structure=[
            {
                "id": "existing-step",
                "type": "block",
                "category": "work",
                "description": "Tempo",
                "duration": {"type": "time", "value": 600},
                "target": {"type": "pace", "zone": 3},
            }
        ],
    )
    update_db = _CalendarCrudDB(execute_results=[_ScalarListResult([update_workout])])

    payload = PlannedWorkoutUpdate(
        title="Tempo + strides",
        structure=[
            {
                "id": "new-step",
                "type": "block",
                "category": "work",
                "description": "Tempo",
                "duration": {"type": "time", "value": 900},
                "target": {"type": "pace", "zone": 3},
            }
        ],
        recurrence={
            "frequency": "weekly",
            "interval_weeks": 1,
            "weekdays": [1],
            "span_weeks": 1,
        },
    )

    updated = await calendar_router.update_workout(
        workout_id=200,
        workout_update=payload,
        current_user=current_user,
        db=update_db,
    )

    assert updated.approval_status == "pending"
    assert updated.approval_request_type == "update"
    assert updated.planning_context["approval"]["proposed_changes"]["title"] == "Tempo + strides"
    assert updated.planning_context["approval"]["proposed_changes"]["planned_duration"] == 15
    assert updated.planning_context["approval"]["proposed_changes"]["planning_context"]["recurrence"]["weekdays"] == [1]

    delete_workout = PlannedWorkout(
        id=201,
        user_id=50,
        date=date(2026, 3, 11),
        title="Recovery",
        sport_type="Running",
        planned_duration=30,
        planning_context=None,
    )
    delete_db = _CalendarCrudDB(execute_results=[_ScalarListResult([delete_workout])])
    deleted = await calendar_router.delete_workout(workout_id=201, current_user=current_user, db=delete_db)

    assert deleted == {"status": "pending_approval", "deleted": False}
    assert delete_workout.planning_context["approval"]["request_type"] == "delete"
    assert recorded_actions == ["request_update", "request_delete"]


@pytest.mark.asyncio
async def test_review_calendar_approval_updates_workout_and_copy_workout_duplicates(monkeypatch):
    recorded_versions = []
    score_calls = []
    access_checks = []

    async def fake_record_version(db, **kwargs):
        recorded_versions.append((kwargs["action"], kwargs.get("note")))

    async def fake_match_and_score(db, user_id, workout_date):
        score_calls.append((user_id, workout_date))

    async def fake_check_coach_access(coach_id, athlete_id, db):
        access_checks.append((coach_id, athlete_id))

    monkeypatch.setattr(calendar_router, "_record_workout_version", fake_record_version)
    monkeypatch.setattr(calendar_router, "match_and_score", fake_match_and_score)
    monkeypatch.setattr(calendar_router, "check_coach_access", fake_check_coach_access)

    coach = User(id=99, email="coach@example.com", password_hash="x", role=RoleEnum.coach, email_verified=True)
    pending_workout = PlannedWorkout(
        id=300,
        user_id=50,
        date=date(2026, 3, 10),
        title="Tempo",
        sport_type="Running",
        planned_duration=45,
        planning_context={
            "approval": {
                "status": "pending",
                "request_type": "update",
                "requested_by_user_id": 50,
                "requested_at": "2026-03-01T10:00:00Z",
                "proposed_changes": {"title": "Tempo + strides", "date": "2026-03-11"},
            }
        },
    )
    review_db = _CalendarCrudDB(scalar_results=[pending_workout])

    decision = CalendarApprovalDecisionRequest(decision="approve")
    reviewed = await calendar_router.review_calendar_approval(
        workout_id=300,
        payload=decision,
        current_user=coach,
        db=review_db,
    )

    assert reviewed.status == "approved"
    assert reviewed.deleted is False
    assert pending_workout.title == "Tempo + strides"
    assert pending_workout.date == date(2026, 3, 11)
    assert pending_workout.planning_context is None

    source_workout = PlannedWorkout(
        id=301,
        user_id=50,
        date=date(2026, 3, 10),
        title="Base Ride",
        description="Steady",
        sport_type="Cycling",
        planned_duration=90,
        planned_distance=50.0,
        planned_intensity="Zone 2",
        season_plan_id=7,
        planning_context={"notes": "keep"},
    )
    copy_db = _CalendarCrudDB(execute_results=[_ScalarListResult([source_workout])])
    copied = await calendar_router.copy_workout(
        workout_id=301,
        target_date=date(2026, 3, 15),
        current_user=coach,
        db=copy_db,
    )

    assert copied.id == 1000
    assert copied.user_id == 50
    assert copied.created_by_user_id == 99
    assert copied.date == date(2026, 3, 15)
    assert copied.title == "Base Ride"
    assert access_checks == [(99, 50), (99, 50)]
    assert recorded_versions == [
        ("approve_update", None),
        ("copy_create", "copied_from_workout_id:301"),
    ]
    assert score_calls == [
        (50, date(2026, 3, 10)),
        (50, date(2026, 3, 11)),
        (50, date(2026, 3, 15)),
    ]