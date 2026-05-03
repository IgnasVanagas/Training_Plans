"""Endpoint-handler tests for app.routers.activities.

Direct calls focusing on permission/role guards and helper-routing paths.
"""

from __future__ import annotations

from datetime import date as dt_date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.models import Activity, OrganizationMember, RoleEnum, User
from app.routers import activities as act


class _Result:
    def __init__(self, rows=None, scalars_list=None, scalar_one=None):
        self._rows = list(rows or [])
        self._scalars_list = (
            list(scalars_list) if scalars_list is not None else None
        )
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

    async def execute(self, stmt):
        if self.execute_results:
            return self.execute_results.pop(0)
        return _Result()

    async def scalar(self, stmt):
        if self.scalar_results:
            return self.scalar_results.pop(0)
        return None

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commits += 1

    async def refresh(self, obj):
        self.refreshed.append(obj)

    async def delete(self, obj):
        self.added.append(("delete", obj))


def _athlete(uid=1) -> User:
    u = User(id=uid, email=f"a{uid}@x.y", password_hash="h",
             role=RoleEnum.athlete, email_verified=True)
    u.organization_memberships = []
    return u


def _coach(uid=99) -> User:
    u = User(id=uid, email=f"c{uid}@x.y", password_hash="h",
             role=RoleEnum.coach, email_verified=True)
    u.organization_memberships = []
    return u


# ── _resolve_training_status_target_athlete ─────────────────────────────────


@pytest.mark.asyncio
async def test_resolve_target_self_when_no_athlete_id():
    user = _athlete(1)
    out = await act._resolve_training_status_target_athlete(
        _DB(), current_user=user, athlete_id=None
    )
    assert out == 1


@pytest.mark.asyncio
async def test_resolve_target_self_when_athlete_id_matches():
    user = _athlete(1)
    out = await act._resolve_training_status_target_athlete(
        _DB(), current_user=user, athlete_id=1
    )
    assert out == 1


@pytest.mark.asyncio
async def test_resolve_target_athlete_for_other_forbidden():
    user = _athlete(1)
    with pytest.raises(HTTPException) as exc:
        await act._resolve_training_status_target_athlete(
            _DB(), current_user=user, athlete_id=2
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_resolve_target_coach_no_access_403():
    coach = _coach(99)
    db = _DB(execute_results=[_Result(scalar_one=None)])
    with pytest.raises(HTTPException) as exc:
        await act._resolve_training_status_target_athlete(
            db, current_user=coach, athlete_id=2
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_resolve_target_coach_access_returns_id():
    coach = _coach(99)
    db = _DB(execute_results=[_Result(scalar_one=object())])
    out = await act._resolve_training_status_target_athlete(
        db, current_user=coach, athlete_id=2
    )
    assert out == 2


# ── get_training_status (404 path) ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_training_status_raises_when_no_rows(monkeypatch):
    user = _athlete(1)
    monkeypatch.setattr(act, "_resolve_training_status_target_athlete",
                        AsyncMock(return_value=1))
    monkeypatch.setattr(act, "_build_training_status_history",
                        AsyncMock(return_value=[]))
    with pytest.raises(HTTPException) as exc:
        await act.get_training_status(
            athlete_id=None, reference_date=None, current_user=user, db=_DB()
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_get_training_status_returns_first_row(monkeypatch):
    user = _athlete(1)
    monkeypatch.setattr(act, "_resolve_training_status_target_athlete",
                        AsyncMock(return_value=1))
    monkeypatch.setattr(act, "_build_training_status_history",
                        AsyncMock(return_value=[{"athlete_id": 1}]))
    out = await act.get_training_status(
        athlete_id=None, reference_date=None, current_user=user, db=_DB()
    )
    assert out["athlete_id"] == 1


# ── get_training_status_history ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_training_status_history(monkeypatch):
    user = _athlete(1)
    monkeypatch.setattr(act, "_resolve_training_status_target_athlete",
                        AsyncMock(return_value=1))
    monkeypatch.setattr(act, "_build_training_status_history",
                        AsyncMock(return_value=[{"a": 1}, {"a": 2}]))
    out = await act.get_training_status_history(
        athlete_id=None, days=2, end_date=dt_date(2024, 1, 10),
        current_user=user, db=_DB()
    )
    assert out == [{"a": 1}, {"a": 2}]


# ── get_personal_records_endpoint ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_personal_records_self_passes_through(monkeypatch):
    user = _athlete(1)
    monkeypatch.setattr(act, "get_personal_records",
                        AsyncMock(return_value={"records": []}))
    out = await act.get_personal_records_endpoint(
        sport="cycling", athlete_id=None, current_user=user, db=_DB()
    )
    assert out == {"records": []}


@pytest.mark.asyncio
async def test_personal_records_athlete_other_forbidden():
    user = _athlete(1)
    with pytest.raises(HTTPException) as exc:
        await act.get_personal_records_endpoint(
            sport="cycling", athlete_id=2, current_user=user, db=_DB()
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_personal_records_coach_no_access_forbidden(monkeypatch):
    coach = _coach()
    db = _DB(execute_results=[_Result(scalar_one=None)])
    with pytest.raises(HTTPException) as exc:
        await act.get_personal_records_endpoint(
            sport="cycling", athlete_id=2, current_user=coach, db=db
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_personal_records_coach_with_access_calls_helper(monkeypatch):
    coach = _coach()
    monkeypatch.setattr(act, "get_personal_records",
                        AsyncMock(return_value={"records": [1]}))
    db = _DB(execute_results=[_Result(scalar_one=object())])
    out = await act.get_personal_records_endpoint(
        sport="running", athlete_id=2, current_user=coach, db=db
    )
    assert out == {"records": [1]}


# ── delete_activity ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_activity_404():
    user = _athlete(1)
    db = _DB(execute_results=[_Result(scalars_list=[])])
    with pytest.raises(HTTPException) as exc:
        await act.delete_activity(
            activity_id=1, background_tasks=SimpleNamespace(add_task=lambda *a, **k: None),
            current_user=user, db=db
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_activity_athlete_other_owner_forbidden():
    user = _athlete(1)
    activity = Activity(id=1, athlete_id=999,
                        created_at=datetime(2024, 1, 1), duplicate_of_id=None)
    db = _DB(execute_results=[_Result(scalars_list=[activity])])
    with pytest.raises(HTTPException) as exc:
        await act.delete_activity(
            activity_id=1,
            background_tasks=SimpleNamespace(add_task=lambda *a, **k: None),
            current_user=user, db=db
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_delete_activity_coach_no_access_forbidden():
    coach = _coach(99)
    activity = Activity(id=1, athlete_id=42,
                        created_at=datetime(2024, 1, 1), duplicate_of_id=None)
    db = _DB(execute_results=[
        _Result(scalars_list=[activity]),
        _Result(scalar_one=None),  # no shared org access
    ])
    with pytest.raises(HTTPException) as exc:
        await act.delete_activity(
            activity_id=1,
            background_tasks=SimpleNamespace(add_task=lambda *a, **k: None),
            current_user=coach, db=db
        )
    assert exc.value.status_code == 403


# ── update_activity_feedback ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_update_activity_feedback_404():
    user = _athlete(1)
    db = _DB(execute_results=[_Result(scalars_list=[])])
    payload = SimpleNamespace(model_dump=lambda exclude_unset: {})
    with pytest.raises(HTTPException) as exc:
        await act.update_activity_feedback(
            activity_id=1, payload=payload, current_user=user, db=db
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_update_activity_feedback_athlete_other_forbidden():
    user = _athlete(1)
    activity = Activity(id=1, athlete_id=999, streams={}, created_at=datetime(2024, 1, 1))
    db = _DB(execute_results=[_Result(scalars_list=[activity])])
    payload = SimpleNamespace(model_dump=lambda exclude_unset: {})
    with pytest.raises(HTTPException) as exc:
        await act.update_activity_feedback(
            activity_id=1, payload=payload, current_user=user, db=db
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_update_activity_feedback_coach_no_access_forbidden():
    coach = _coach(99)
    activity = Activity(id=1, athlete_id=42, streams={}, created_at=datetime(2024, 1, 1))
    db = _DB(execute_results=[
        _Result(scalars_list=[activity]),
        _Result(scalar_one=None),
    ])
    payload = SimpleNamespace(model_dump=lambda exclude_unset: {})
    with pytest.raises(HTTPException) as exc:
        await act.update_activity_feedback(
            activity_id=1, payload=payload, current_user=coach, db=db
        )
    assert exc.value.status_code == 403


# ── zone-summary unauthorized branches ──────────────────────────────────────


@pytest.mark.asyncio
async def test_get_zone_summary_athlete_other_forbidden():
    user = _athlete(1)
    with pytest.raises(HTTPException) as exc:
        await act.get_zone_summary(
            athlete_id=2, all_athletes=False, reference_date=None,
            week_start_day="monday", current_user=user, db=_DB()
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_get_zone_summary_coach_no_access_forbidden():
    coach = _coach(99)
    db = _DB(execute_results=[_Result(scalar_one=None)])
    with pytest.raises(HTTPException) as exc:
        await act.get_zone_summary(
            athlete_id=2, all_athletes=False, reference_date=None,
            week_start_day="monday", current_user=coach, db=db
        )
    assert exc.value.status_code == 403


# ── get_performance_trend authorization branches ────────────────────────────


@pytest.mark.asyncio
async def test_performance_trend_athlete_other_forbidden():
    user = _athlete(1)
    with pytest.raises(HTTPException) as exc:
        await act.get_performance_trend(
            days=30, athlete_id=2, current_user=user, db=_DB()
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_performance_trend_coach_no_access_forbidden():
    coach = _coach(99)
    db = _DB(execute_results=[_Result(scalar_one=None)])
    with pytest.raises(HTTPException) as exc:
        await act.get_performance_trend(
            days=30, athlete_id=2, current_user=coach, db=db
        )
    assert exc.value.status_code == 403
