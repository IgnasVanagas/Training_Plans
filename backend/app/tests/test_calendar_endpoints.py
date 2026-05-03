"""Endpoint-handler tests for app.routers.calendar."""

from __future__ import annotations

from datetime import date as dt_date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.models import OrganizationMember, PlannedWorkout, RoleEnum, User
from app.routers import calendar as cal


class _Result:
    def __init__(self, rows=None, scalars_list=None, scalar_one=None):
        self._rows = list(rows or [])
        self._scalars_list = list(scalars_list) if scalars_list is not None else None
        self._scalar_one = scalar_one

    def all(self):
        if self._scalars_list is not None:
            return list(self._scalars_list)
        return list(self._rows)

    def scalars(self):
        return self

    def first(self):
        if self._scalars_list:
            return self._scalars_list[0]
        return None

    def scalar_one_or_none(self):
        return self._scalar_one


class _DB:
    def __init__(self, *, execute_results=None, scalar_results=None):
        self.execute_results = list(execute_results or [])
        self.scalar_results = list(scalar_results or [])
        self.added = []
        self.commits = 0
        self.refreshed = []
        self.deleted = []

    async def execute(self, stmt):
        return self.execute_results.pop(0) if self.execute_results else _Result()

    async def scalar(self, stmt):
        return self.scalar_results.pop(0) if self.scalar_results else None

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commits += 1

    async def refresh(self, obj):
        self.refreshed.append(obj)

    async def delete(self, obj):
        self.deleted.append(obj)


def _athlete(uid=1) -> User:
    u = User(id=uid, email=f"a{uid}@x.y", password_hash="h",
             role=RoleEnum.athlete, email_verified=True)
    u.organization_memberships = []
    return u


def _coach(uid=99) -> User:
    u = User(id=uid, email=f"c{uid}@x.y", password_hash="h",
             role=RoleEnum.coach, email_verified=True)
    u.organization_memberships = [
        OrganizationMember(user_id=uid, organization_id=1,
                           role=RoleEnum.coach.value, status="active"),
    ]
    return u


# ── list_calendar_share_settings ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_share_settings_athlete_returns_self(monkeypatch):
    user = _athlete(1)
    monkeypatch.setattr(cal, "get_athlete_permissions",
                        AsyncMock(return_value={"allow_public_calendar_share": True}))
    monkeypatch.setattr(cal, "get_athlete_org_ids",
                        AsyncMock(return_value=[1]))
    monkeypatch.setattr(cal, "_get_calendar_share_settings",
                        AsyncMock(return_value={}))
    out = await cal.list_calendar_share_settings(
        athlete_id=None, current_user=user, db=_DB()
    )
    assert len(out) == 1
    assert out[0].athlete_id == 1


@pytest.mark.asyncio
async def test_list_share_settings_athlete_disabled_share(monkeypatch):
    user = _athlete(1)
    monkeypatch.setattr(cal, "get_athlete_permissions",
                        AsyncMock(return_value={"allow_public_calendar_share": False}))
    out = await cal.list_calendar_share_settings(
        athlete_id=None, current_user=user, db=_DB()
    )
    assert len(out) == 1


@pytest.mark.asyncio
async def test_list_share_settings_coach_no_orgs():
    coach = _coach()
    coach.organization_memberships = []
    out = await cal.list_calendar_share_settings(
        athlete_id=None, current_user=coach, db=_DB()
    )
    assert out == []


@pytest.mark.asyncio
async def test_list_share_settings_coach_filters_by_athlete_id(monkeypatch):
    coach = _coach()
    db = _DB(execute_results=[_Result(scalars_list=[2, 3, 4])])
    monkeypatch.setattr(cal, "get_shared_org_ids",
                        AsyncMock(return_value=[1]))
    monkeypatch.setattr(cal, "_get_calendar_share_settings",
                        AsyncMock(return_value={}))
    out = await cal.list_calendar_share_settings(
        athlete_id=3, current_user=coach, db=db
    )
    assert [row.athlete_id for row in out] == [3]


# ── update_calendar_share_settings ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_update_share_settings_coach_no_access(monkeypatch):
    coach = _coach()
    monkeypatch.setattr(cal, "get_shared_org_ids",
                        AsyncMock(return_value=[]))
    payload = SimpleNamespace(model_dump=lambda exclude_unset: {})
    with pytest.raises(HTTPException) as exc:
        await cal.update_calendar_share_settings(
            payload=payload, athlete_id=2, current_user=coach, db=_DB()
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_update_share_settings_athlete_other_forbidden():
    user = _athlete(1)
    payload = SimpleNamespace(model_dump=lambda exclude_unset: {})
    with pytest.raises(HTTPException) as exc:
        await cal.update_calendar_share_settings(
            payload=payload, athlete_id=99, current_user=user, db=_DB()
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_update_share_settings_athlete_disabled_403(monkeypatch):
    user = _athlete(1)
    monkeypatch.setattr(cal, "get_athlete_permissions",
                        AsyncMock(return_value={"allow_public_calendar_share": False}))
    payload = SimpleNamespace(model_dump=lambda exclude_unset: {})
    with pytest.raises(HTTPException) as exc:
        await cal.update_calendar_share_settings(
            payload=payload, athlete_id=None, current_user=user, db=_DB()
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_update_share_settings_athlete_happy(monkeypatch):
    user = _athlete(1)
    monkeypatch.setattr(cal, "get_athlete_permissions",
                        AsyncMock(return_value={"allow_public_calendar_share": True}))
    monkeypatch.setattr(cal, "get_athlete_org_ids", AsyncMock(return_value=[1]))
    monkeypatch.setattr(cal, "_get_calendar_share_settings",
                        AsyncMock(return_value={"enabled": False}))
    monkeypatch.setattr(cal, "_set_calendar_share_settings",
                        AsyncMock(return_value={"enabled": True}))
    payload = SimpleNamespace(model_dump=lambda exclude_unset: {"enabled": True})
    out = await cal.update_calendar_share_settings(
        payload=payload, athlete_id=None, current_user=user, db=_DB()
    )
    assert out.athlete_id == 1


# ── get_public_calendar ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_public_calendar_404_on_unknown_token(monkeypatch):
    monkeypatch.setattr(cal, "_find_share_by_token", AsyncMock(return_value=None))
    with pytest.raises(HTTPException) as exc:
        await cal.get_public_calendar(
            token="unknown",
            start_date=dt_date(2024, 1, 1),
            end_date=dt_date(2024, 1, 2),
            db=_DB(),
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_get_public_calendar_404_when_disabled(monkeypatch):
    monkeypatch.setattr(cal, "_find_share_by_token",
                        AsyncMock(return_value=(1, {"enabled": True})))
    monkeypatch.setattr(cal, "get_athlete_permissions",
                        AsyncMock(return_value={"allow_public_calendar_share": False}))
    with pytest.raises(HTTPException) as exc:
        await cal.get_public_calendar(
            token="t", start_date=dt_date(2024, 1, 1),
            end_date=dt_date(2024, 1, 2), db=_DB(),
        )
    assert exc.value.status_code == 404


# ── list_calendar_approvals ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_approvals_forbidden_for_athlete():
    with pytest.raises(HTTPException) as exc:
        await cal.list_calendar_approvals(
            athlete_id=None, current_user=_athlete(), db=_DB()
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_list_approvals_no_orgs():
    coach = _coach()
    coach.organization_memberships = []
    out = await cal.list_calendar_approvals(
        athlete_id=None, current_user=coach, db=_DB()
    )
    assert out == []


@pytest.mark.asyncio
async def test_list_approvals_no_athletes():
    coach = _coach()
    db = _DB(execute_results=[_Result(scalars_list=[])])
    out = await cal.list_calendar_approvals(
        athlete_id=None, current_user=coach, db=db
    )
    assert out == []


@pytest.mark.asyncio
async def test_list_approvals_filters_pending(monkeypatch):
    coach = _coach()
    pending_workout = PlannedWorkout(
        id=1, user_id=2, title="W",
        date=dt_date(2024, 1, 1),
        sport_type="cycling",
        planning_context={
            "approval": {
                "status": "pending",
                "request_type": "update",
                "requested_by_user_id": 2,
                "requested_at": "2024-01-01T00:00:00",
            }
        },
    )
    not_pending = PlannedWorkout(
        id=2, user_id=2, title="W2",
        date=dt_date(2024, 1, 2), sport_type="cycling",
        planning_context={"approval": {"status": "approved"}},
    )
    db = _DB(execute_results=[
        _Result(scalars_list=[2]),  # athlete IDs
        _Result(scalars_list=[pending_workout, not_pending]),  # workouts
    ])
    monkeypatch.setattr(cal, "_user_display_lookup",
                        AsyncMock(return_value={2: "Athlete 2", 99: "Coach"}))
    out = await cal.list_calendar_approvals(
        athlete_id=None, current_user=coach, db=db
    )
    assert len(out) == 1
    assert out[0].workout_id == 1


# ── update_workout (delete branch sub-paths) ────────────────────────────────


@pytest.mark.asyncio
async def test_update_workout_404():
    user = _athlete(1)
    db = _DB(execute_results=[_Result(scalars_list=[])])
    payload = SimpleNamespace(model_dump=lambda exclude_unset: {},
                              model_fields_set=set())
    with pytest.raises(HTTPException) as exc:
        await cal.update_workout(
            workout_id=1, workout_update=payload, current_user=user, db=db
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_update_workout_athlete_not_owner_403():
    user = _athlete(1)
    workout = PlannedWorkout(id=1, user_id=999, date=dt_date(2024, 1, 1))
    db = _DB(execute_results=[_Result(scalars_list=[workout])])
    payload = SimpleNamespace(model_dump=lambda exclude_unset: {},
                              model_fields_set=set())
    with pytest.raises(HTTPException) as exc:
        await cal.update_workout(
            workout_id=1, workout_update=payload, current_user=user, db=db
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_update_workout_athlete_disabled_edit(monkeypatch):
    user = _athlete(1)
    workout = PlannedWorkout(id=1, user_id=1, date=dt_date(2024, 1, 1))
    db = _DB(execute_results=[_Result(scalars_list=[workout])])
    monkeypatch.setattr(cal, "get_athlete_permissions",
                        AsyncMock(return_value={"allow_edit_workouts": False}))
    payload = SimpleNamespace(model_dump=lambda exclude_unset: {},
                              model_fields_set=set())
    with pytest.raises(HTTPException) as exc:
        await cal.update_workout(
            workout_id=1, workout_update=payload, current_user=user, db=db
        )
    assert exc.value.status_code == 403


# ── delete_workout ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_workout_returns_success_when_not_found():
    user = _athlete(1)
    db = _DB(execute_results=[_Result(scalars_list=[])])
    out = await cal.delete_workout(workout_id=99, current_user=user, db=db)
    assert out == {"status": "success", "deleted": False}


@pytest.mark.asyncio
async def test_delete_workout_athlete_not_owner_403():
    user = _athlete(1)
    workout = PlannedWorkout(id=1, user_id=999, date=dt_date(2024, 1, 1))
    db = _DB(execute_results=[_Result(scalars_list=[workout])])
    with pytest.raises(HTTPException) as exc:
        await cal.delete_workout(workout_id=1, current_user=user, db=db)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_delete_workout_athlete_delete_disabled(monkeypatch):
    user = _athlete(1)
    workout = PlannedWorkout(id=1, user_id=1, date=dt_date(2024, 1, 1))
    db = _DB(execute_results=[_Result(scalars_list=[workout])])
    monkeypatch.setattr(cal, "get_athlete_permissions",
                        AsyncMock(return_value={"allow_delete_workouts": False}))
    with pytest.raises(HTTPException) as exc:
        await cal.delete_workout(workout_id=1, current_user=user, db=db)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_delete_workout_athlete_requires_approval(monkeypatch):
    user = _athlete(1)
    workout = PlannedWorkout(id=1, user_id=1, date=dt_date(2024, 1, 1),
                             planning_context={})
    db = _DB(execute_results=[_Result(scalars_list=[workout])])
    monkeypatch.setattr(cal, "get_athlete_permissions",
                        AsyncMock(return_value={
                            "allow_delete_workouts": True,
                            "require_workout_approval": True,
                        }))
    monkeypatch.setattr(cal, "_record_workout_version",
                        AsyncMock(return_value=None))
    out = await cal.delete_workout(workout_id=1, current_user=user, db=db)
    assert out["status"] == "pending_approval"
    assert db.commits == 1


@pytest.mark.asyncio
async def test_delete_workout_athlete_pending_already_409(monkeypatch):
    user = _athlete(1)
    workout = PlannedWorkout(
        id=1, user_id=1, date=dt_date(2024, 1, 1),
        planning_context={"approval": {"status": "pending", "request_type": "delete"}},
    )
    db = _DB(execute_results=[_Result(scalars_list=[workout])])
    monkeypatch.setattr(cal, "get_athlete_permissions",
                        AsyncMock(return_value={
                            "allow_delete_workouts": True,
                            "require_workout_approval": True,
                        }))
    with pytest.raises(HTTPException) as exc:
        await cal.delete_workout(workout_id=1, current_user=user, db=db)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_delete_workout_athlete_happy_path(monkeypatch):
    user = _athlete(1)
    workout = PlannedWorkout(id=1, user_id=1, date=dt_date(2024, 1, 1),
                             planning_context={})
    db = _DB(execute_results=[_Result(scalars_list=[workout])])
    monkeypatch.setattr(cal, "get_athlete_permissions",
                        AsyncMock(return_value={
                            "allow_delete_workouts": True,
                            "require_workout_approval": False,
                        }))
    monkeypatch.setattr(cal, "_record_workout_version",
                        AsyncMock(return_value=None))
    monkeypatch.setattr(cal, "match_and_score", AsyncMock(return_value=None))
    out = await cal.delete_workout(workout_id=1, current_user=user, db=db)
    assert out == {"status": "success", "deleted": True}
    assert db.deleted == [workout]

# ?? recent_coach_workouts ???????????????????????????????????????????????????


@pytest.mark.asyncio
async def test_recent_coach_workouts_athlete():
    user = _athlete(1)
    pw = PlannedWorkout(id=1, user_id=1, title="Morning Run",
                        description=None, sport_type="running",
                        structure=[], planned_duration=60,
                        date=dt_date(2024, 1, 1))
    db = _DB(execute_results=[_Result(scalars_list=[pw])])
    out = await cal.recent_coach_workouts(limit=5, current_user=user, db=db)
    assert len(out) == 1
    assert out[0]["title"] == "Morning Run"


@pytest.mark.asyncio
async def test_recent_coach_workouts_dedupes_by_title():
    user = _athlete(1)
    pw1 = PlannedWorkout(id=1, user_id=1, title="Run", description=None,
                         sport_type="running", structure=[], planned_duration=60,
                         date=dt_date(2024, 1, 1))
    pw2 = PlannedWorkout(id=2, user_id=1, title="Run", description=None,
                         sport_type="running", structure=[], planned_duration=45,
                         date=dt_date(2024, 1, 2))
    db = _DB(execute_results=[_Result(scalars_list=[pw1, pw2])])
    out = await cal.recent_coach_workouts(limit=5, current_user=user, db=db)
    assert len(out) == 1


@pytest.mark.asyncio
async def test_recent_coach_workouts_coach_path():
    coach = _coach()
    pw = PlannedWorkout(id=1, user_id=2, title="Tempo", description="x",
                        sport_type="running", structure=[], planned_duration=60,
                        date=dt_date(2024, 1, 1))
    db = _DB(execute_results=[_Result(scalars_list=[pw])])
    out = await cal.recent_coach_workouts(limit=10, current_user=coach, db=db)
    assert len(out) == 1


# ?? get_workout_history ?????????????????????????????????????????????????????


@pytest.mark.asyncio
async def test_get_workout_history_404():
    user = _athlete(1)
    db = _DB(scalar_results=[None])
    with pytest.raises(HTTPException) as exc:
        await cal.get_workout_history(workout_id=1, current_user=user, db=db)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_get_workout_history_athlete_other_403():
    user = _athlete(1)
    workout = PlannedWorkout(id=1, user_id=999, date=dt_date(2024, 1, 1))
    db = _DB(scalar_results=[workout])
    with pytest.raises(HTTPException) as exc:
        await cal.get_workout_history(workout_id=1, current_user=user, db=db)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_get_workout_history_returns_versions(monkeypatch):
    user = _athlete(1)
    workout = PlannedWorkout(id=1, user_id=1, date=dt_date(2024, 1, 1))
    from app.models import PlannedWorkoutVersion
    version = PlannedWorkoutVersion(
        id=10, workout_id=1, version_number=1, action="update",
        changed_by_user_id=1, changed_at=datetime(2024, 1, 1),
        note=None, diff_json=[{"field": "title", "before": "a", "after": "b"}],
    )
    db = _DB(
        scalar_results=[workout],
        execute_results=[_Result(scalars_list=[version])],
    )
    monkeypatch.setattr(cal, "_user_display_lookup",
                        AsyncMock(return_value={1: "User"}))
    out = await cal.get_workout_history(workout_id=1, current_user=user, db=db)
    assert len(out) == 1
    assert out[0].diff[0].field == "title"


# ?? rollback_workout_version ????????????????????????????????????????????????


@pytest.mark.asyncio
async def test_rollback_forbidden_for_athlete():
    user = _athlete(1)
    with pytest.raises(HTTPException) as exc:
        await cal.rollback_workout_version(
            workout_id=1, version_id=10, current_user=user, db=_DB()
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_rollback_workout_not_found():
    coach = _coach()
    db = _DB(scalar_results=[None])
    with pytest.raises(HTTPException) as exc:
        await cal.rollback_workout_version(
            workout_id=1, version_id=10, current_user=coach, db=db
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_rollback_version_not_found(monkeypatch):
    coach = _coach()
    workout = PlannedWorkout(id=1, user_id=99, date=dt_date(2024, 1, 1))
    db = _DB(scalar_results=[workout, None])
    with pytest.raises(HTTPException) as exc:
        await cal.rollback_workout_version(
            workout_id=1, version_id=10, current_user=coach, db=db
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_rollback_no_after_snapshot():
    coach = _coach()
    workout = PlannedWorkout(id=1, user_id=99, date=dt_date(2024, 1, 1))
    from app.models import PlannedWorkoutVersion
    version = PlannedWorkoutVersion(
        id=10, workout_id=1, version_number=1, action="update",
        changed_by_user_id=1, changed_at=datetime(2024, 1, 1),
        note=None, diff_json=[], after_snapshot=None,
    )
    db = _DB(scalar_results=[workout, version])
    with pytest.raises(HTTPException) as exc:
        await cal.rollback_workout_version(
            workout_id=1, version_id=10, current_user=coach, db=db
        )
    assert exc.value.status_code == 400


# ?? day_notes endpoints ?????????????????????????????????????????????????????


@pytest.mark.asyncio
async def test_get_day_notes_returns_notes(monkeypatch):
    user = _athlete(1)
    monkeypatch.setattr(cal, "_resolve_athlete_id",
                        AsyncMock(return_value=1))
    from app.models import DayNote
    n = DayNote(id=1, athlete_id=1, author_id=1, date=dt_date(2024, 1, 1),
                content="hi", created_at=datetime(2024, 1, 1),
                updated_at=datetime(2024, 1, 1))
    db = _DB(
        execute_results=[_Result(scalars_list=[n])],
        scalar_results=[None, user],  # author profile, author user
    )
    out = await cal.get_day_notes(
        date_str="2024-01-01", athlete_id=None, db=db, current_user=user
    )
    assert len(out) == 1


@pytest.mark.asyncio
async def test_get_day_notes_range_uses_cache(monkeypatch):
    user = _athlete(1)
    monkeypatch.setattr(cal, "_resolve_athlete_id",
                        AsyncMock(return_value=1))
    from app.models import DayNote
    n1 = DayNote(id=1, athlete_id=1, author_id=1, date=dt_date(2024, 1, 1),
                 content="a", created_at=datetime(2024, 1, 1),
                 updated_at=datetime(2024, 1, 1))
    n2 = DayNote(id=2, athlete_id=1, author_id=1, date=dt_date(2024, 1, 2),
                 content="b", created_at=datetime(2024, 1, 2),
                 updated_at=datetime(2024, 1, 2))
    db = _DB(
        execute_results=[_Result(scalars_list=[n1, n2])],
        scalar_results=[None, user],  # cached after first lookup
    )
    out = await cal.get_day_notes_range(
        start="2024-01-01", end="2024-01-31",
        athlete_id=None, db=db, current_user=user,
    )
    assert len(out) == 2


@pytest.mark.asyncio
async def test_upsert_day_note_creates_new(monkeypatch):
    user = _athlete(1)
    monkeypatch.setattr(cal, "_resolve_athlete_id",
                        AsyncMock(return_value=1))
    payload = SimpleNamespace(content="new note")
    db = _DB(scalar_results=[None, None])  # existing=None, profile=None

    original_add = db.add

    def _add_with_metadata(obj):
        if hasattr(obj, "id") and obj.id is None:
            obj.id = 555
        if hasattr(obj, "created_at") and obj.created_at is None:
            obj.created_at = datetime(2024, 1, 1)
        if hasattr(obj, "updated_at") and obj.updated_at is None:
            obj.updated_at = datetime(2024, 1, 1)
        original_add(obj)

    db.add = _add_with_metadata

    out = await cal.upsert_day_note(
        payload=payload, date_str="2024-01-01",
        athlete_id=None, db=db, current_user=user,
    )
    assert out.content == "new note"


@pytest.mark.asyncio
async def test_upsert_day_note_updates_existing(monkeypatch):
    user = _athlete(1)
    monkeypatch.setattr(cal, "_resolve_athlete_id",
                        AsyncMock(return_value=1))
    from app.models import DayNote
    existing = DayNote(id=5, athlete_id=1, author_id=1, date=dt_date(2024, 1, 1),
                       content="old", created_at=datetime(2024, 1, 1),
                       updated_at=datetime(2024, 1, 1))
    payload = SimpleNamespace(content="updated")
    db = _DB(scalar_results=[existing, None])
    out = await cal.upsert_day_note(
        payload=payload, date_str="2024-01-01",
        athlete_id=None, db=db, current_user=user,
    )
    assert existing.content == "updated"
    assert out.content == "updated"


@pytest.mark.asyncio
async def test_delete_day_note_404():
    user = _athlete(1)
    db = _DB(scalar_results=[None])
    with pytest.raises(HTTPException) as exc:
        await cal.delete_day_note(note_id=1, db=db, current_user=user)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_day_note_other_athlete_403():
    user = _athlete(1)
    from app.models import DayNote
    note = DayNote(id=1, athlete_id=2, author_id=999, date=dt_date(2024, 1, 1),
                   content="x", created_at=datetime(2024, 1, 1),
                   updated_at=datetime(2024, 1, 1))
    db = _DB(scalar_results=[note])
    with pytest.raises(HTTPException) as exc:
        await cal.delete_day_note(note_id=1, db=db, current_user=user)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_delete_day_note_owner_happy_path():
    user = _athlete(1)
    from app.models import DayNote
    note = DayNote(id=1, athlete_id=1, author_id=1, date=dt_date(2024, 1, 1),
                   content="x", created_at=datetime(2024, 1, 1),
                   updated_at=datetime(2024, 1, 1))
    db = _DB(scalar_results=[note])
    await cal.delete_day_note(note_id=1, db=db, current_user=user)
    assert note in db.deleted

# ?? create_workout ??????????????????????????????????????????????????????????


@pytest.mark.asyncio
async def test_create_workout_athlete_assigns_self(monkeypatch):
    user = _athlete(1)
    monkeypatch.setattr(cal, "get_athlete_permissions",
                        AsyncMock(return_value={"require_workout_approval": False}))
    monkeypatch.setattr(cal, "_record_workout_version",
                        AsyncMock(return_value=None))
    monkeypatch.setattr(cal, "match_and_score", AsyncMock(return_value=None))
    monkeypatch.setattr(cal, "_estimate_planned_duration_minutes", lambda s: None)
    monkeypatch.setattr(cal, "_annotate_workout_with_approval", lambda w, d: None)

    payload = SimpleNamespace(
        model_dump=lambda: {
            "date": dt_date(2024, 1, 1),
            "title": "Run",
            "description": None,
            "sport_type": "running",
            "structure": [],
            "planned_duration": 60,
            "planned_distance": None,
            "planned_intensity": None,
            "planning_context": None,
        }
    )
    db = _DB()

    async def _flush(): pass
    db.flush = _flush

    out = await cal.create_workout(
        workout_in=payload, athlete_id=None, current_user=user, db=db,
    )
    assert any(isinstance(o, PlannedWorkout) for o in db.added)


@pytest.mark.asyncio
async def test_create_workout_athlete_with_athlete_id_403():
    user = _athlete(1)
    payload = SimpleNamespace(model_dump=lambda: {"date": dt_date(2024, 1, 1)})
    with pytest.raises(HTTPException) as exc:
        await cal.create_workout(
            workout_in=payload, athlete_id=999, current_user=user, db=_DB()
        )
    assert exc.value.status_code == 403


# ?? copy_workout ????????????????????????????????????????????????????????????


@pytest.mark.asyncio
async def test_copy_workout_404():
    user = _athlete(1)
    db = _DB(execute_results=[_Result(scalars_list=[])])
    with pytest.raises(HTTPException) as exc:
        await cal.copy_workout(
            workout_id=1, target_date=dt_date(2024, 1, 5),
            current_user=user, db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_copy_workout_athlete_other_owner_403():
    user = _athlete(1)
    src = PlannedWorkout(id=1, user_id=999, date=dt_date(2024, 1, 1),
                         title="x", sport_type="running",
                         planned_duration=30,
                         compliance_status="planned")
    db = _DB(execute_results=[_Result(scalars_list=[src])])
    with pytest.raises(HTTPException) as exc:
        await cal.copy_workout(
            workout_id=1, target_date=dt_date(2024, 1, 5),
            current_user=user, db=db,
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_copy_workout_athlete_edit_disabled(monkeypatch):
    user = _athlete(1)
    src = PlannedWorkout(id=1, user_id=1, date=dt_date(2024, 1, 1),
                         title="x", sport_type="running",
                         planned_duration=30,
                         compliance_status="planned")
    db = _DB(execute_results=[_Result(scalars_list=[src])])
    monkeypatch.setattr(cal, "get_athlete_permissions",
                        AsyncMock(return_value={"allow_edit_workouts": False}))
    with pytest.raises(HTTPException) as exc:
        await cal.copy_workout(
            workout_id=1, target_date=dt_date(2024, 1, 5),
            current_user=user, db=db,
        )
    assert exc.value.status_code == 403

# ?? create_workout ??????????????????????????????????????????????????????????


@pytest.mark.asyncio
async def test_create_workout_athlete_assigns_self(monkeypatch):
    user = _athlete(1)
    monkeypatch.setattr(cal, "get_athlete_permissions",
                        AsyncMock(return_value={"require_workout_approval": False}))
    monkeypatch.setattr(cal, "_record_workout_version",
                        AsyncMock(return_value=None))
    monkeypatch.setattr(cal, "match_and_score", AsyncMock(return_value=None))
    monkeypatch.setattr(cal, "_estimate_planned_duration_minutes", lambda s: None)
    monkeypatch.setattr(cal, "_annotate_workout_with_approval", lambda w, d: None)

    payload = SimpleNamespace(
        model_dump=lambda: {
            "date": dt_date(2024, 1, 1),
            "title": "Run",
            "description": None,
            "sport_type": "running",
            "structure": [],
            "planned_duration": 60,
            "planned_distance": None,
            "planned_intensity": None,
            "planning_context": None,
        }
    )
    db = _DB()

    async def _flush(): pass
    db.flush = _flush

    out = await cal.create_workout(
        workout_in=payload, athlete_id=None, current_user=user, db=db,
    )
    assert any(isinstance(o, PlannedWorkout) for o in db.added)


@pytest.mark.asyncio
async def test_create_workout_athlete_with_athlete_id_403():
    user = _athlete(1)
    payload = SimpleNamespace(model_dump=lambda: {"date": dt_date(2024, 1, 1)})
    with pytest.raises(HTTPException) as exc:
        await cal.create_workout(
            workout_in=payload, athlete_id=999, current_user=user, db=_DB()
        )
    assert exc.value.status_code == 403


# ?? copy_workout ????????????????????????????????????????????????????????????


@pytest.mark.asyncio
async def test_copy_workout_404():
    user = _athlete(1)
    db = _DB(execute_results=[_Result(scalars_list=[])])
    with pytest.raises(HTTPException) as exc:
        await cal.copy_workout(
            workout_id=1, target_date=dt_date(2024, 1, 5),
            current_user=user, db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_copy_workout_athlete_other_owner_403():
    user = _athlete(1)
    src = PlannedWorkout(id=1, user_id=999, date=dt_date(2024, 1, 1),
                         title="x", sport_type="running",
                         planned_duration=30,
                         compliance_status="planned")
    db = _DB(execute_results=[_Result(scalars_list=[src])])
    with pytest.raises(HTTPException) as exc:
        await cal.copy_workout(
            workout_id=1, target_date=dt_date(2024, 1, 5),
            current_user=user, db=db,
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_copy_workout_athlete_edit_disabled(monkeypatch):
    user = _athlete(1)
    src = PlannedWorkout(id=1, user_id=1, date=dt_date(2024, 1, 1),
                         title="x", sport_type="running",
                         planned_duration=30,
                         compliance_status="planned")
    db = _DB(execute_results=[_Result(scalars_list=[src])])
    monkeypatch.setattr(cal, "get_athlete_permissions",
                        AsyncMock(return_value={"allow_edit_workouts": False}))
    with pytest.raises(HTTPException) as exc:
        await cal.copy_workout(
            workout_id=1, target_date=dt_date(2024, 1, 5),
            current_user=user, db=db,
        )
    assert exc.value.status_code == 403
