"""HTTPX-mocked tests for StravaConnector network paths."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.integrations.connectors.strava import StravaConnector


def _resp(status, body=None):
    return httpx.Response(
        status_code=status,
        content=json.dumps(body).encode() if body is not None else b"",
        headers={"content-type": "application/json"} if body is not None else {},
    )


def _client_with(handler):
    transport = httpx.MockTransport(handler)
    return httpx.AsyncClient(transport=transport, timeout=5.0)


@pytest.fixture
def connector(monkeypatch):
    # Avoid real backoff sleeps in retry loop and rate limiter waits
    async def _no_sleep(*a, **k):
        return None
    monkeypatch.setattr("app.integrations.connectors.strava.asyncio.sleep", _no_sleep)
    monkeypatch.setattr(
        "app.integrations.connectors.strava._STRAVA_REQUEST_TIMESTAMPS",
        __import__("collections").deque(),
    )
    return StravaConnector()


# ── _acquire_rate_limit_slot grants a slot ────────────────────────────────


def test_acquire_rate_limit_slot_returns_int(connector):
    out = asyncio.run(connector._acquire_rate_limit_slot())
    assert isinstance(out, int)
    assert out >= 1


# ── _get_with_retry retries on 429, returns last response ────────────────


def test_get_with_retry_returns_on_first_success(connector):
    def handler(_request):
        return _resp(200, {"ok": True})

    async def go():
        async with _client_with(handler) as client:
            response = await connector._get_with_retry(
                client, url="https://x/y", headers={}, context="test",
            )
            return response

    response = asyncio.run(go())
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_get_with_retry_eventually_returns_on_429(connector):
    calls = {"n": 0}

    def handler(_request):
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(
                status_code=429, headers={"Retry-After": "1"},
            )
        return _resp(200, {"ok": True})

    async def go():
        async with _client_with(handler) as client:
            return await connector._get_with_retry(
                client, url="https://x/y", headers={}, context="test",
                max_retries=3,
            )

    response = asyncio.run(go())
    assert response.status_code == 200
    assert calls["n"] == 3


def test_get_with_retry_returns_429_after_exhausting_retries(connector):
    def handler(_request):
        return httpx.Response(status_code=429,
                              headers={"Retry-After": "garbage"})

    async def go():
        async with _client_with(handler) as client:
            return await connector._get_with_retry(
                client, url="https://x/y", headers={}, context="test",
                max_retries=2,
            )

    response = asyncio.run(go())
    assert response.status_code == 429


# ── fetch_activity_summary ────────────────────────────────────────────────


def test_fetch_activity_summary_returns_record(connector, monkeypatch):
    sample = {
        "id": 9001, "name": "Morning Ride",
        "start_date": "2025-04-01T08:00:00Z",
        "elapsed_time": 3600, "moving_time": 3500,
        "distance": 20000, "sport_type": "Ride",
        "average_heartrate": 140, "average_watts": 180,
        "average_speed": 5.5,
    }

    async def fake_client_factory(*a, **k):
        raise NotImplementedError

    def handler(_request):
        return _resp(200, sample)

    real_client_cls = httpx.AsyncClient
    def fake_async_client(*a, **kw):
        return real_client_cls(transport=httpx.MockTransport(handler),
                                  timeout=5.0)
    monkeypatch.setattr("app.integrations.connectors.strava.httpx.AsyncClient",
                        fake_async_client)

    record = asyncio.run(connector.fetch_activity_summary(
        access_token="t", activity_id="9001",
    ))

    assert record is not None
    assert record.provider_activity_id == "9001"
    assert record.duration_s == 3600
    assert record.sport == "ride"


def test_fetch_activity_summary_returns_none_on_404(connector, monkeypatch):
    def handler(_request):
        return httpx.Response(status_code=404)

    real_client_cls = httpx.AsyncClient
    def fake_async_client(*a, **kw):
        return real_client_cls(transport=httpx.MockTransport(handler),
                                  timeout=5.0)
    monkeypatch.setattr("app.integrations.connectors.strava.httpx.AsyncClient",
                        fake_async_client)

    record = asyncio.run(connector.fetch_activity_summary(
        access_token="t", activity_id="9001",
    ))
    assert record is None


# ── _fetch_activity_detail_payload ────────────────────────────────────────


def test_fetch_activity_detail_payload_full(connector, monkeypatch):
    detail_body = {
        "id": 9001, "name": "Ride",
        "start_date": "2025-04-01T08:00:00Z",
        "elapsed_time": 3600, "distance": 20000,
        "sport_type": "Ride",
        "max_heartrate": 180, "max_watts": 380,
        "max_speed": 12.5, "max_cadence": 110,
        "average_cadence": 90, "total_elevation_gain": 200,
        "calories": 800, "moving_time": 3500,
    }
    laps_body = [
        {"distance": 5000, "elapsed_time": 900, "moving_time": 900,
         "average_heartrate": 140, "average_speed": 5.5,
         "lap_index": 1, "name": "Lap 1"},
    ]
    streams_body = {
        "time": {"data": [0, 1, 2]},
        "distance": {"data": [0, 5, 10]},
        "heartrate": {"data": [120, 130, 140]},
        "watts": {"data": [150, 180, 200]},
        "velocity_smooth": {"data": [5.0, 5.2, 5.5]},
        "altitude": {"data": [100, 101, 102]},
        "cadence": {"data": [80, 85, 90]},
    }

    def handler(request):
        path = request.url.path
        if path.endswith("/laps"):
            return _resp(200, laps_body)
        if path.endswith("/streams"):
            return _resp(200, streams_body)
        return _resp(200, detail_body)

    real_client_cls = httpx.AsyncClient
    def fake_async_client(*a, **kw):
        return real_client_cls(transport=httpx.MockTransport(handler),
                                  timeout=5.0)
    monkeypatch.setattr("app.integrations.connectors.strava.httpx.AsyncClient",
                        fake_async_client)

    payload = asyncio.run(connector._fetch_activity_detail_payload(
        access_token="t", activity_id="9001",
        start_time=datetime(2025, 4, 1, 8, 0),
    ))

    assert isinstance(payload, dict)
    assert payload["data"]
    assert payload["laps"]
    assert "stats" in payload


def test_fetch_activity_detail_payload_handles_404_streams_and_laps(connector, monkeypatch):
    detail_body = {
        "id": 9001, "name": "Ride", "start_date": "2025-04-01T08:00:00Z",
        "elapsed_time": 3600, "distance": 20000, "sport_type": "Ride",
        "moving_time": 3500,
    }

    def handler(request):
        path = request.url.path
        if path.endswith("/laps") or path.endswith("/streams"):
            return httpx.Response(status_code=404)
        return _resp(200, detail_body)

    real_client_cls = httpx.AsyncClient
    def fake_async_client(*a, **kw):
        return real_client_cls(transport=httpx.MockTransport(handler),
                                  timeout=5.0)
    monkeypatch.setattr("app.integrations.connectors.strava.httpx.AsyncClient",
                        fake_async_client)

    payload = asyncio.run(connector._fetch_activity_detail_payload(
        access_token="t", activity_id="9001",
        start_time=datetime(2025, 4, 1, 8, 0),
    ))

    assert payload["laps"] == []
    assert payload["data"] == []
