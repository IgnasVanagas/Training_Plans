from __future__ import annotations

from datetime import datetime

import pytest

from app.integrations.connectors.strava import StravaConnector
from app.integrations.ingest import ingest_provider_activity
from app.integrations.service import build_event_key, merge_cursor


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeAsyncClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return None

    async def post(self, *_args, **_kwargs):
        return _FakeResponse(
            {
                "access_token": "new-access",
                "refresh_token": "new-refresh",
                "expires_at": 1900000000,
                "scope": "read,activity:read_all",
                "athlete": {"id": 12345},
            }
        )


@pytest.mark.asyncio
async def test_strava_token_exchange_and_refresh(monkeypatch):
    import app.integrations.connectors.strava as strava_module

    monkeypatch.setenv("STRAVA_CLIENT_ID", "cid")
    monkeypatch.setenv("STRAVA_CLIENT_SECRET", "secret")
    monkeypatch.setenv("STRAVA_REDIRECT_URI", "http://localhost/callback")
    monkeypatch.setattr(strava_module.httpx, "AsyncClient", _FakeAsyncClient)

    connector = StravaConnector()
    exchanged = await connector.exchange_token("oauth-code")
    refreshed = await connector.refresh_token("refresh-token")

    assert exchanged.access_token == "new-access"
    assert refreshed.refresh_token == "new-refresh"
    assert exchanged.external_athlete_id == "12345"


class _FakeSession:
    def __init__(self):
        self.added = []

    def add(self, item):
        self.added.append(item)

    async def commit(self):
        return None

    async def refresh(self, _item):
        return None


@pytest.mark.asyncio
async def test_ingest_provider_activity_dedupe(monkeypatch):
    import app.integrations.ingest as ingest_module

    class _Existing:
        id = 42

    async def _dup(*args, **kwargs):
        return _Existing()

    monkeypatch.setattr(ingest_module, "find_duplicate_activity", _dup)
    db = _FakeSession()

    _, created = await ingest_provider_activity(
        db,
        user_id=9,
        provider="strava",
        provider_activity_id="abc",
        name="Morning Run",
        start_time=datetime.utcnow(),
        duration_s=1200,
        distance_m=5000,
        sport="running",
        average_hr=150,
        average_watts=None,
        average_speed=4.1,
        payload={"id": "abc"},
    )

    assert created is False
    assert len(db.added) == 0


@pytest.mark.asyncio
async def test_sync_cursor_merge_and_webhook_idempotency_key():
    merged = merge_cursor({"after_epoch": 1000}, {"after_epoch": 2000, "page": 2})
    assert merged == {"after_epoch": 2000, "page": 2}

    payload = {"a": 1, "b": 2}
    headers = {"X-Request-ID": "abc-123"}
    key1 = build_event_key("strava", payload, headers)
    key2 = build_event_key("strava", payload, headers)

    assert key1 == "strava:abc-123"
    assert key1 == key2


class _ListResponse:
    def __init__(self, payload, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code
        self.headers = {}

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


@pytest.mark.asyncio
async def test_strava_incremental_sync_always_requests_latest_first(monkeypatch):
    import app.integrations.connectors.strava as strava_module

    captured_params: list[dict] = []

    class _FakeListClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def get(self, _url, params=None, headers=None):
            params = dict(params or {})
            captured_params.append(params)
            page = int(params.get("page", 1))
            if page == 1:
                return _ListResponse(
                    [
                        {
                            "id": 1001,
                            "name": "Today Run",
                            "start_date": "2026-02-26T07:30:00Z",
                            "moving_time": 1800,
                            "distance": 5000,
                            "sport_type": "Run",
                        }
                    ]
                )
            return _ListResponse([])

    monkeypatch.setattr(strava_module.httpx, "AsyncClient", _FakeListClient)
    monkeypatch.setenv("STRAVA_SYNC_MAX_ACTIVITIES", "20")

    connector = StravaConnector()
    result = await connector.fetch_activities(
        access_token="token",
        cursor={"initial_sync_done": True, "after_epoch": 9999999999},
    )

    assert len(result.activities) == 1
    assert result.activities[0].provider_activity_id == "1001"
    assert captured_params
    first_call = captured_params[0]
    assert "after" in first_call
    assert int(first_call["after"]) <= 9999999999
    assert int(result.next_cursor.get("strava_requests_last_10m") or 0) >= 1


@pytest.mark.asyncio
async def test_strava_history_only_mode_skips_recent_requests(monkeypatch):
    import app.integrations.connectors.strava as strava_module

    captured_params: list[dict] = []

    class _FakeHistoryClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def get(self, _url, params=None, headers=None):
            params = dict(params or {})
            captured_params.append(params)
            page = int(params.get("page", 1))
            if page == 1:
                return _ListResponse(
                    [
                        {
                            "id": 2001,
                            "name": "Old Ride",
                            "start_date": "2025-12-01T07:30:00Z",
                            "moving_time": 2400,
                            "distance": 12000,
                            "sport_type": "Ride",
                        }
                    ]
                )
            return _ListResponse([])

    monkeypatch.setattr(strava_module.httpx, "AsyncClient", _FakeHistoryClient)

    connector = StravaConnector()
    result = await connector.fetch_activities(
        access_token="token",
        cursor={
            "initial_sync_done": True,
            "strava_history_only": True,
            "backfill_before_epoch": 1764547200,
        },
    )

    assert len(result.activities) == 1
    assert all("before" in p for p in captured_params)
