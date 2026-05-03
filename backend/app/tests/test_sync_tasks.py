"""Coverage tests for app.routers.integrations.sync_tasks.

Exercises early-return / failure branches of _sync_provider_task and the
startup helper using a hand-rolled mock AsyncSession + connector.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.routers.integrations import sync_tasks


# ── Mock session machinery ──────────────────────────────────────────────────


class _Result:
    def __init__(self, items=None, scalar_value=None):
        self._items = list(items or [])
        self._scalar = scalar_value

    def scalars(self):
        return self

    def all(self):
        return list(self._items)

    def __iter__(self):
        return iter(self._items)

    def scalar(self):
        return self._scalar


class _MockDB:
    def __init__(self, *, execute_results=None, scalar_values=None, get_map=None):
        self.execute_results = list(execute_results or [])
        self.scalar_values = list(scalar_values or [])
        self.get_map = dict(get_map or {})
        self.commits = 0
        self.rollbacks = 0
        self.added = []
        self.merged = []
        self.expunged = []

    async def execute(self, stmt):
        if self.execute_results:
            return self.execute_results.pop(0)
        return _Result()

    async def scalar(self, stmt):
        if self.scalar_values:
            return self.scalar_values.pop(0)
        return None

    async def get(self, model, key):
        return self.get_map.get(key)

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1

    async def reset(self):
        return None

    async def merge(self, obj):
        self.merged.append(obj)
        return obj

    def add(self, obj):
        self.added.append(obj)

    def expunge(self, obj):
        self.expunged.append(obj)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None


def _install_session(monkeypatch, db: _MockDB):
    """Patch AsyncSessionLocal so `async with AsyncSessionLocal() as db` yields our mock."""
    def _factory():
        return db
    monkeypatch.setattr(sync_tasks, "AsyncSessionLocal", _factory)


# ── _sync_provider_task: early-return paths ─────────────────────────────────


@pytest.mark.asyncio
async def test_sync_provider_task_aborts_when_not_connected(monkeypatch):
    state = SimpleNamespace(
        id=1, sync_status="idle", sync_message="", sync_progress=0,
        sync_total=0, last_error=None, cursor={},
    )
    connection = SimpleNamespace(status="disconnected", encrypted_access_token="x",
                                  encrypted_refresh_token="y", token_expires_at=None,
                                  scopes=None, last_sync_at=None, last_error=None)
    db = _MockDB()

    _install_session(monkeypatch, db)

    monkeypatch.setattr(sync_tasks, "get_or_create_sync_state",
                        AsyncMock(return_value=state))
    monkeypatch.setattr(sync_tasks, "get_connection",
                        AsyncMock(return_value=connection))
    monkeypatch.setattr(sync_tasks, "get_connector", lambda p: SimpleNamespace())

    await sync_tasks._sync_provider_task("strava", user_id=42)

    assert state.sync_status == "failed"
    assert state.sync_message == "Not connected"
    assert db.commits >= 2


@pytest.mark.asyncio
async def test_sync_provider_task_aborts_when_no_connection(monkeypatch):
    state = SimpleNamespace(
        id=1, sync_status="idle", sync_message="", sync_progress=0,
        sync_total=0, last_error=None, cursor={},
    )
    db = _MockDB()
    _install_session(monkeypatch, db)
    monkeypatch.setattr(sync_tasks, "get_or_create_sync_state",
                        AsyncMock(return_value=state))
    monkeypatch.setattr(sync_tasks, "get_connection",
                        AsyncMock(return_value=None))
    monkeypatch.setattr(sync_tasks, "get_connector", lambda p: SimpleNamespace())

    await sync_tasks._sync_provider_task("strava", user_id=42)

    assert state.sync_status == "failed"


@pytest.mark.asyncio
async def test_sync_provider_task_handles_token_refresh_failure(monkeypatch):
    state = SimpleNamespace(
        id=1, sync_status="idle", sync_message="", sync_progress=0,
        sync_total=0, last_error=None, cursor={},
    )
    # Token expired → refresh path triggered
    expired = datetime.utcnow() - timedelta(minutes=5)
    connection = SimpleNamespace(
        status="connected",
        encrypted_access_token="enc-access",
        encrypted_refresh_token="enc-refresh",
        token_expires_at=expired,
        scopes=None, last_sync_at=None, last_error=None,
    )

    db = _MockDB()
    _install_session(monkeypatch, db)

    monkeypatch.setattr(sync_tasks, "decrypt_token", lambda v: f"plain-{v}")
    monkeypatch.setattr(sync_tasks, "get_or_create_sync_state",
                        AsyncMock(return_value=state))
    monkeypatch.setattr(sync_tasks, "get_connection",
                        AsyncMock(return_value=connection))

    connector = SimpleNamespace(
        refresh_token=AsyncMock(side_effect=RuntimeError("boom")),
    )
    monkeypatch.setattr(sync_tasks, "get_connector", lambda p: connector)

    await sync_tasks._sync_provider_task("strava", user_id=42)

    assert state.sync_status == "failed"
    assert "boom" in (state.sync_message or "")
    assert state.last_error == "boom"


@pytest.mark.asyncio
async def test_sync_provider_task_outer_exception_writes_error_state(monkeypatch):
    """Force an exception before connection check so the outer `except` runs."""
    db = _MockDB()
    error_db = _MockDB()
    sessions = iter([db, error_db])
    monkeypatch.setattr(sync_tasks, "AsyncSessionLocal", lambda: next(sessions))

    state = SimpleNamespace(
        id=1, sync_status="idle", sync_message="", sync_progress=0,
        sync_total=0, last_error=None, cursor={},
    )
    error_state = SimpleNamespace(
        id=1, sync_status="idle", sync_message="", sync_progress=0,
        sync_total=0, last_error=None, cursor={},
    )

    call_count = {"n": 0}

    async def _get_or_create(*args, **kwargs):
        call_count["n"] += 1
        return state if call_count["n"] == 1 else error_state

    monkeypatch.setattr(sync_tasks, "get_or_create_sync_state", _get_or_create)
    monkeypatch.setattr(sync_tasks, "get_connection",
                        AsyncMock(side_effect=RuntimeError("explode")))
    monkeypatch.setattr(sync_tasks, "get_connector", lambda p: SimpleNamespace())

    await sync_tasks._sync_provider_task("strava", user_id=42)

    assert error_state.sync_status == "failed"
    assert error_state.sync_message == "explode"
    assert db.rollbacks == 1


# ── _startup_trigger_pending_syncs ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_startup_trigger_skips_states_with_initial_done(monkeypatch):
    state_done = SimpleNamespace(user_id=1, cursor={"initial_sync_done": True})
    state_pending = SimpleNamespace(user_id=2, cursor={})
    db = _MockDB(execute_results=[_Result([state_done, state_pending])])
    _install_session(monkeypatch, db)

    created = []

    def _fake_create_task(coro):
        # Close the coroutine so it doesn't warn; we don't want it to run.
        coro.close()
        created.append(True)
        return SimpleNamespace()

    monkeypatch.setattr(sync_tasks.asyncio, "create_task", _fake_create_task)

    await sync_tasks._startup_trigger_pending_syncs()

    # Only the pending state triggers a task
    assert len(created) == 1


@pytest.mark.asyncio
async def test_startup_trigger_no_pending_states(monkeypatch):
    db = _MockDB(execute_results=[_Result([])])
    _install_session(monkeypatch, db)

    created = []

    def _fake_create_task(coro):
        coro.close()
        created.append(True)
        return SimpleNamespace()

    monkeypatch.setattr(sync_tasks.asyncio, "create_task", _fake_create_task)

    await sync_tasks._startup_trigger_pending_syncs()
    assert created == []


@pytest.mark.asyncio
async def test_startup_trigger_handles_state_with_none_cursor(monkeypatch):
    state = SimpleNamespace(user_id=3, cursor=None)
    db = _MockDB(execute_results=[_Result([state])])
    _install_session(monkeypatch, db)

    triggered = []

    def _fake_create_task(coro):
        coro.close()
        triggered.append(True)
        return SimpleNamespace()

    monkeypatch.setattr(sync_tasks.asyncio, "create_task", _fake_create_task)

    await sync_tasks._startup_trigger_pending_syncs()
    # cursor=None falsey → counts as not-yet-done → triggers task
    assert triggered == [True]


# ── _strava_backfill_activity_details: budget-exhausted early return ────────


@pytest.mark.asyncio
async def test_backfill_returns_when_daily_budget_exhausted(monkeypatch):
    """When the daily Strava request budget is already used, return immediately."""
    monkeypatch.setenv("STRAVA_DAILY_REQUEST_LIMIT", "10")
    today_key = datetime.utcnow().strftime("%Y-%m-%d")
    state = SimpleNamespace(
        cursor={"strava_request_day": today_key, "strava_request_count": 10},
    )
    db = _MockDB()
    connector = SimpleNamespace()

    enriched, message = await sync_tasks._strava_backfill_activity_details(
        db,
        state=state,
        connector=connector,
        access_token="at",
        user_id=1,
        import_all_time=False,
    )

    assert enriched == 0
    assert "limit" in (message or "").lower()
    # Cursor preserved
    assert state.cursor["strava_request_count"] == 10


@pytest.mark.asyncio
async def test_backfill_returns_zero_when_no_candidates(monkeypatch):
    """Empty candidate list → enriched=0, no message."""
    monkeypatch.setenv("STRAVA_DAILY_REQUEST_LIMIT", "500")
    monkeypatch.setenv("STRAVA_ENRICH_DELAY_SECONDS", "0")
    state = SimpleNamespace(cursor={})
    db = _MockDB(execute_results=[_Result([])])
    connector = SimpleNamespace()

    enriched, message = await sync_tasks._strava_backfill_activity_details(
        db,
        state=state,
        connector=connector,
        access_token="at",
        user_id=1,
        import_all_time=True,
    )

    assert enriched == 0
    assert message is None
