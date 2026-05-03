"""Endpoint tests for app.routers.planning."""

from __future__ import annotations

from datetime import date as dt_date
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.models import RoleEnum, SeasonPlan, User
from app.routers import planning as plan_router


class _Result:
    def __init__(self, scalars_list=None, scalar_one=None):
        self._scalars_list = list(scalars_list) if scalars_list is not None else None
        self._scalar_one = scalar_one

    def scalars(self):
        return self

    def all(self):
        return list(self._scalars_list or [])

    def first(self):
        return self._scalars_list[0] if self._scalars_list else None

    def scalar_one_or_none(self):
        if self._scalar_one is not None:
            return self._scalar_one
        if self._scalars_list:
            return self._scalars_list[0]
        return None


class _DB:
    def __init__(self, *, execute_results=None):
        self.execute_results = list(execute_results or [])
        self.added = []
        self.deleted = []
        self.commits = 0

    async def execute(self, stmt):
        return self.execute_results.pop(0) if self.execute_results else _Result()

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commits += 1

    async def refresh(self, obj):
        pass

    async def delete(self, obj):
        self.deleted.append(obj)


def _athlete(uid=1) -> User:
    return User(id=uid, email=f"a{uid}@x.y", password_hash="h",
                role=RoleEnum.athlete, email_verified=True)


def _coach(uid=99) -> User:
    return User(id=uid, email="c@x.y", password_hash="h",
                role=RoleEnum.coach, email_verified=True)


# ── _resolve_target_athlete_id ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_resolve_target_athlete_self_when_none():
    user = _athlete(1)
    out = await plan_router._resolve_target_athlete_id(None, user, _DB())
    assert out == 1


@pytest.mark.asyncio
async def test_resolve_target_athlete_self_explicit():
    user = _athlete(1)
    out = await plan_router._resolve_target_athlete_id(1, user, _DB())
    assert out == 1


@pytest.mark.asyncio
async def test_resolve_target_athlete_other_forbidden_for_athlete():
    user = _athlete(1)
    with pytest.raises(HTTPException) as exc:
        await plan_router._resolve_target_athlete_id(2, user, _DB())
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_resolve_target_athlete_coach(monkeypatch):
    coach = _coach(99)
    monkeypatch.setattr(plan_router, "check_coach_access",
                        AsyncMock(return_value=None))
    out = await plan_router._resolve_target_athlete_id(2, coach, _DB())
    assert out == 2


# ── get_latest_season_plan ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_latest_season_plan_returns_none(monkeypatch):
    user = _athlete(1)
    db = _DB(execute_results=[_Result(scalars_list=[])])
    out = await plan_router.get_latest_season_plan(
        athlete_id=None, current_user=user, db=db,
    )
    assert out is None


@pytest.mark.asyncio
async def test_get_latest_season_plan_returns_plan():
    user = _athlete(1)
    plan = SeasonPlan(id=1, athlete_id=1, name="Plan", sport_type="running",
                      season_start=dt_date(2024, 1, 1),
                      season_end=dt_date(2024, 6, 1))
    db = _DB(execute_results=[_Result(scalars_list=[plan])])
    out = await plan_router.get_latest_season_plan(
        athlete_id=None, current_user=user, db=db,
    )
    assert out is plan


# ── preview_season_plan ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_preview_season_plan_happy_path(monkeypatch):
    user = _athlete(1)
    monkeypatch.setattr(plan_router, "build_generated_workouts",
                        lambda payload, profile: {"generated_workouts": [{"date": "2024-01-01"}]})
    db = _DB(execute_results=[_Result(scalars_list=[])])
    payload = SimpleNamespace()
    out = await plan_router.preview_season_plan(
        payload=payload, athlete_id=None, current_user=user, db=db,
    )
    assert out["generated_workouts"]


@pytest.mark.asyncio
async def test_preview_season_plan_value_error_400(monkeypatch):
    user = _athlete(1)

    def _raise(*a, **kw):
        raise ValueError("bad payload")

    monkeypatch.setattr(plan_router, "build_generated_workouts", _raise)
    db = _DB(execute_results=[_Result(scalars_list=[])])
    payload = SimpleNamespace()
    with pytest.raises(HTTPException) as exc:
        await plan_router.preview_season_plan(
            payload=payload, athlete_id=None, current_user=user, db=db,
        )
    assert exc.value.status_code == 400


# ── save_season_plan ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_save_season_plan_creates_new(monkeypatch):
    user = _athlete(1)
    monkeypatch.setattr(plan_router, "build_generated_workouts",
                        lambda payload, profile: {"generated_workouts": [{"date": "2024-01-01"}]})
    payload = SimpleNamespace(
        id=None, name="Plan", sport_type="running",
        season_start=dt_date(2024, 1, 1), season_end=dt_date(2024, 6, 1),
        notes=None, target_metrics=[], goal_races=[],
        constraints=[], periodization={},
    )
    db = _DB(execute_results=[_Result(scalars_list=[])])
    out = await plan_router.save_season_plan(
        payload=payload, athlete_id=None, current_user=user, db=db,
    )
    assert out.name == "Plan"
    assert out in db.added


@pytest.mark.asyncio
async def test_save_season_plan_value_error_400(monkeypatch):
    user = _athlete(1)

    def _raise(*a, **kw):
        raise ValueError("nope")

    monkeypatch.setattr(plan_router, "build_generated_workouts", _raise)
    payload = SimpleNamespace(id=None)
    db = _DB(execute_results=[_Result(scalars_list=[])])
    with pytest.raises(HTTPException) as exc:
        await plan_router.save_season_plan(
            payload=payload, athlete_id=None, current_user=user, db=db,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_save_season_plan_existing_plan_mismatched_athlete_400(monkeypatch):
    user = _athlete(1)
    monkeypatch.setattr(plan_router, "build_generated_workouts",
                        lambda payload, profile: {"generated_workouts": []})
    plan = SeasonPlan(id=5, athlete_id=999, name="X", sport_type="running",
                      season_start=dt_date(2024, 1, 1),
                      season_end=dt_date(2024, 6, 1))
    payload = SimpleNamespace(
        id=5, name="Plan", sport_type="running",
        season_start=dt_date(2024, 1, 1), season_end=dt_date(2024, 6, 1),
        notes=None, target_metrics=[], goal_races=[],
        constraints=[], periodization={},
    )
    db = _DB(execute_results=[
        _Result(scalars_list=[]),         # _get_profile
        _Result(scalars_list=[plan]),     # _load_plan_or_404
    ])
    with pytest.raises(HTTPException) as exc:
        await plan_router.save_season_plan(
            payload=payload, athlete_id=None, current_user=user, db=db,
        )
    # athlete cannot access plan owned by other -> 403 short-circuit before 400
    assert exc.value.status_code == 403


# ── apply_season_plan ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_apply_season_plan_404_when_plan_missing():
    user = _athlete(1)
    db = _DB(execute_results=[_Result(scalars_list=[])])
    with pytest.raises(HTTPException) as exc:
        await plan_router.apply_season_plan(
            plan_id=1, replace_generated=True, current_user=user, db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_apply_season_plan_400_when_no_workouts(monkeypatch):
    user = _athlete(1)
    plan = SeasonPlan(id=1, athlete_id=1, name="P", sport_type="running",
                      season_start=dt_date(2024, 1, 1),
                      season_end=dt_date(2024, 6, 1),
                      generated_summary={"generated_workouts": []})
    db = _DB(execute_results=[
        _Result(scalars_list=[plan]),  # _load_plan_or_404
        _Result(scalars_list=[]),      # _get_profile
    ])
    with pytest.raises(HTTPException) as exc:
        await plan_router.apply_season_plan(
            plan_id=1, replace_generated=True, current_user=user, db=db,
        )
    assert exc.value.status_code == 400


# ── _plain helper ───────────────────────────────────────────────────────────


def test_plain_handles_basic_types():
    assert plan_router._plain(None) is None
    assert plan_router._plain(5) == 5
    assert plan_router._plain([1, 2]) == [1, 2]
    assert plan_router._plain({"a": dt_date(2024, 1, 1)}) == {"a": "2024-01-01"}


def test_plain_handles_pydantic_like():
    class _M:
        def model_dump(self):
            return {"x": 1}

    assert plan_router._plain(_M()) == {"x": 1}
