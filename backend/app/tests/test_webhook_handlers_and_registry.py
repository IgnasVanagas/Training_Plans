"""Tests for webhook_handlers and integration registry."""

from __future__ import annotations

import asyncio
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.routers.integrations import webhook_handlers as wh
from app.integrations import registry


# ── registry ─────────────────────────────────────────────────────────────


def test_registry_get_connector_returns_strava():
    connector = registry.get_connector("strava")
    assert connector is not None
    assert connector.provider == "strava"


def test_registry_get_connector_unknown_raises():
    with pytest.raises(KeyError):
        registry.get_connector("unknown_provider_xyz")


def test_registry_list_provider_statuses_includes_strava():
    statuses = registry.list_provider_statuses()
    assert isinstance(statuses, list)
    assert any(s.get("provider") == "strava" for s in statuses)


# ── webhook_handlers helpers ─────────────────────────────────────────────


class _Result:
    def __init__(self, items):
        self._items = list(items)

    def scalars(self):
        return self

    def all(self):
        return list(self._items)


class _DB:
    def __init__(self, scalars=None, executes=None):
        self._scalars = list(scalars or [])
        self._executes = list(executes or [])
        self.committed = False
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    async def scalar(self, _stmt):
        if not self._scalars:
            return None
        return self._scalars.pop(0)

    async def execute(self, _stmt):
        if not self._executes:
            return _Result([])
        return _Result(self._executes.pop(0))

    async def commit(self):
        self.committed = True


def test_process_strava_webhook_returns_ignored_when_owner_missing():
    db = _DB()
    result = asyncio.run(wh._process_strava_webhook_event(db, {}))
    assert result["status"] == "ignored"
    assert result["reason"] == "missing_owner_id"


def test_process_strava_webhook_returns_ignored_when_owner_not_connected():
    db = _DB(scalars=[None])
    result = asyncio.run(wh._process_strava_webhook_event(
        db, {"owner_id": "999", "object_type": "activity"}
    ))
    assert result["status"] == "ignored"
    assert result["reason"] == "owner_not_connected"


def test_process_strava_webhook_unsupported_object_type():
    connection = SimpleNamespace(user_id=1, provider="strava",
                                  external_athlete_id="999")
    db = _DB(scalars=[connection])
    result = asyncio.run(wh._process_strava_webhook_event(
        db, {"owner_id": "999", "object_type": "club", "aspect_type": "create"}
    ))
    assert result["status"] == "ignored"
    assert result["reason"] == "unsupported_object"


def test_process_strava_webhook_missing_object_id():
    connection = SimpleNamespace(user_id=1, provider="strava",
                                  external_athlete_id="999")
    db = _DB(scalars=[connection])
    result = asyncio.run(wh._process_strava_webhook_event(
        db, {"owner_id": "999", "object_type": "activity",
             "aspect_type": "create"}
    ))
    assert result["status"] == "ignored"
    assert result["reason"] == "missing_object_id"


def test_process_strava_webhook_athlete_deauthorize(monkeypatch):
    connection = SimpleNamespace(user_id=1, provider="strava",
                                  external_athlete_id="999",
                                  encrypted_access_token=None)

    async def fake_disconnect(db, *, connection, reason, last_error):
        return None

    monkeypatch.setattr(wh, "_disconnect_provider_connection", fake_disconnect)

    db = _DB(scalars=[connection])
    result = asyncio.run(wh._process_strava_webhook_event(
        db, {"owner_id": "999", "object_type": "athlete",
             "updates": {"authorized": "false"}}
    ))
    assert result["status"] == "deauthorized"
    assert result["user_id"] == 1


def test_find_strava_connection_by_owner_id_returns_value():
    expected = SimpleNamespace(user_id=1, provider="strava")
    db = _DB(scalars=[expected])
    out = asyncio.run(wh._find_strava_connection_by_owner_id(db, "999"))
    assert out is expected


def test_mark_strava_activity_deleted_no_matches():
    db = _DB(executes=[[]])
    out = asyncio.run(wh._mark_strava_activity_deleted(
        db, user_id=1, provider_activity_id="9001"
    ))
    assert out == 0


def test_mark_strava_activity_deleted_marks_one(monkeypatch):
    activity = SimpleNamespace(
        id=1, athlete_id=1, file_type="provider", is_deleted=False,
        created_at=datetime(2025, 4, 1, 10, 0),
        streams={"_meta": {"source_provider": "strava",
                            "source_activity_id": "9001"}},
    )
    db = _DB(executes=[[activity]])

    async def fake_match(_db, _user_id, _date):
        return None

    monkeypatch.setattr(wh, "match_and_score", fake_match)

    out = asyncio.run(wh._mark_strava_activity_deleted(
        db, user_id=1, provider_activity_id="9001"
    ))
    assert out == 1
    assert activity.is_deleted is True
