"""Cover Strava fetch_activities pagination path with mock httpx."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from app.integrations.connectors.strava import StravaConnector


def _resp(status, body=None, headers=None):
    h = {"content-type": "application/json"} if body is not None else {}
    if headers:
        h.update(headers)
    return httpx.Response(
        status_code=status,
        content=json.dumps(body).encode() if body is not None else b"",
        headers=h,
    )


@pytest.fixture
def connector(monkeypatch):
    async def _no_sleep(*a, **k):
        return None
    monkeypatch.setattr("app.integrations.connectors.strava.asyncio.sleep", _no_sleep)
    monkeypatch.setattr(
        "app.integrations.connectors.strava._STRAVA_REQUEST_TIMESTAMPS",
        __import__("collections").deque(),
    )
    return StravaConnector()


def _patch_async_client(monkeypatch, handler):
    real_cls = httpx.AsyncClient

    def fake(*a, **kw):
        return real_cls(transport=httpx.MockTransport(handler), timeout=5.0)

    monkeypatch.setattr(
        "app.integrations.connectors.strava.httpx.AsyncClient", fake
    )


def test_fetch_activities_initial_sync_returns_records(connector, monkeypatch):
    pages = [
        [
            {"id": 1, "name": "Ride 1",
             "start_date": "2025-04-01T08:00:00Z",
             "elapsed_time": 3600, "distance": 20000,
             "sport_type": "Ride", "average_heartrate": 140,
             "average_watts": 180, "average_speed": 5.5},
            {"id": 2, "name": "Ride 2",
             "start_date": "2025-04-02T08:00:00Z",
             "elapsed_time": 1800, "distance": 10000,
             "sport_type": "Ride"},
        ],
        [],  # page 2 empty -> stops
    ]
    calls = {"n": 0}

    def handler(_req):
        page = calls["n"]
        calls["n"] += 1
        return _resp(200, pages[page] if page < len(pages) else [])

    _patch_async_client(monkeypatch, handler)

    result = asyncio.run(connector.fetch_activities(
        access_token="t", cursor={}
    ))
    assert len(result.activities) == 2
    assert result.next_cursor.get("initial_sync_done") is True


def test_fetch_activities_incremental_with_cursor(connector, monkeypatch):
    pages = [
        [{"id": 3, "name": "Ride 3",
          "start_date": "2025-05-01T08:00:00Z",
          "elapsed_time": 1200, "distance": 5000,
          "sport_type": "Run"}],
        [],
    ]
    calls = {"n": 0}

    def handler(req):
        page = calls["n"]
        calls["n"] += 1
        return _resp(200, pages[page] if page < len(pages) else [])

    _patch_async_client(monkeypatch, handler)

    result = asyncio.run(connector.fetch_activities(
        access_token="t",
        cursor={"initial_sync_done": True, "after_epoch": 1735000000},
    ))
    assert len(result.activities) == 1
    assert result.activities[0].sport == "run"


def test_fetch_activities_handles_429_then_succeeds(connector, monkeypatch, tmp_path):
    pages = [
        [{"id": 4, "name": "Ride 4",
          "start_date": "2025-06-01T08:00:00Z",
          "elapsed_time": 900, "distance": 3000,
          "sport_type": "Ride"}],
        [],
    ]
    calls = {"n": 0, "served_429": False}

    def handler(_req):
        if not calls["served_429"]:
            calls["served_429"] = True
            return _resp(429, headers={"Retry-After": "1"})
        page = calls["n"]
        calls["n"] += 1
        return _resp(200, pages[page] if page < len(pages) else [])

    _patch_async_client(monkeypatch, handler)

    result = asyncio.run(connector.fetch_activities(
        access_token="t", cursor={}
    ))
    assert len(result.activities) == 1


def test_fetch_activities_skips_invalid_items(connector, monkeypatch):
    pages = [
        [
            "not_a_dict",
            {"id": None, "start_date": None},  # missing
            {"id": 5, "start_date": "2025-04-03T08:00:00Z",
             "elapsed_time": 600, "distance": 1000, "sport_type": "Ride"},
        ],
        [],
    ]
    calls = {"n": 0}

    def handler(_req):
        page = calls["n"]
        calls["n"] += 1
        return _resp(200, pages[page] if page < len(pages) else [])

    _patch_async_client(monkeypatch, handler)

    result = asyncio.run(connector.fetch_activities(
        access_token="t", cursor={}
    ))
    assert len(result.activities) == 1
    assert result.activities[0].provider_activity_id == "5"


def test_fetch_activities_respects_should_cancel(connector, monkeypatch):
    cancelled = {"flag": False}

    async def should_cancel():
        return cancelled["flag"]

    pages = [
        [{"id": 6, "start_date": "2025-04-04T08:00:00Z",
          "elapsed_time": 600, "distance": 1000, "sport_type": "Ride"}],
    ]
    calls = {"n": 0}

    def handler(_req):
        page = calls["n"]
        calls["n"] += 1
        if page == 0:
            return _resp(200, pages[0])
        cancelled["flag"] = True
        return _resp(200, [])

    _patch_async_client(monkeypatch, handler)

    result = asyncio.run(connector.fetch_activities(
        access_token="t", cursor={"initial_sync_done": True},
        should_cancel=should_cancel,
    ))
    assert isinstance(result.activities, list)
