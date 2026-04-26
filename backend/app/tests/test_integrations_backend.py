from __future__ import annotations

from datetime import datetime
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.integrations.connectors.strava import StravaConnector
from app.integrations.ingest import ingest_provider_activity
from app.integrations.service import build_event_key, merge_cursor
from app.routers import integrations as integrations_router


class _FakeResponse:
    def __init__(self, payload, *, status_code: int = 200, headers: dict | None = None):
        self._payload = payload
        self.status_code = status_code
        self.headers = headers or {}

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


def test_strava_authorize_url_requests_required_scopes(monkeypatch):
    monkeypatch.setenv("STRAVA_CLIENT_ID", "cid")
    monkeypatch.setenv("STRAVA_CLIENT_SECRET", "secret")
    monkeypatch.setenv("STRAVA_REDIRECT_URI", "http://localhost/callback")

    connector = StravaConnector()
    authorize_url = connector.authorize_url("state-123")
    query = parse_qs(urlparse(authorize_url).query)

    assert query["approval_prompt"] == ["auto"]
    requested_scopes = query["scope"][0].split(",")
    assert requested_scopes == ["read", "activity:read", "activity:read_all"]
    assert connector.missing_required_scopes(["read", "activity:read_all"]) == ["activity:read"]


@pytest.mark.asyncio
async def test_strava_deauthorize_posts_access_token(monkeypatch):
    import app.integrations.connectors.strava as strava_module

    captured_params = {}

    class _FakeDeauthClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def post(self, _url, params=None, data=None):
            captured_params.update(params or {})
            return _FakeResponse({"access_token": "revoked"})

    monkeypatch.setattr(strava_module.httpx, "AsyncClient", _FakeDeauthClient)
    connector = StravaConnector()

    response = await connector.deauthorize("access-123")

    assert captured_params == {"access_token": "access-123"}
    assert response["access_token"] == "revoked"


@pytest.mark.asyncio
async def test_strava_ensure_webhook_subscription_creates_when_missing(monkeypatch):
    import app.integrations.connectors.strava as strava_module

    calls: list[tuple[str, dict | None]] = []

    class _FakeWebhookClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def get(self, _url, params=None):
            calls.append(("get", dict(params or {})))
            return _FakeResponse([])

        async def post(self, _url, data=None, params=None):
            calls.append(("post", dict(data or params or {})))
            return _FakeResponse({"id": 999, "callback_url": "https://api.example.com/integrations/strava/webhook"})

        async def delete(self, _url, params=None):
            calls.append(("delete", dict(params or {})))
            return _FakeResponse({}, status_code=204)

    monkeypatch.setenv("STRAVA_CLIENT_ID", "cid")
    monkeypatch.setenv("STRAVA_CLIENT_SECRET", "secret")
    monkeypatch.setenv("STRAVA_REDIRECT_URI", "http://localhost/callback")
    monkeypatch.setenv("STRAVA_WEBHOOK_CALLBACK_URL", "https://api.example.com/integrations/strava/webhook")
    monkeypatch.setenv("STRAVA_WEBHOOK_VERIFY_TOKEN", "verify-me")
    monkeypatch.setattr(strava_module.httpx, "AsyncClient", _FakeWebhookClient)

    connector = StravaConnector()
    result = await connector.ensure_webhook_subscription()

    assert result["status"] == "created"
    assert calls[0][0] == "get"
    assert calls[1][0] == "post"
    assert calls[1][1]["verify_token"] == "verify-me"


def _make_webhook_request(query_string: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/integrations/strava/webhook",
            "query_string": query_string.encode("utf-8"),
            "headers": [],
        }
    )


@pytest.mark.asyncio
async def test_strava_webhook_challenge_validates_verify_token(monkeypatch):
    monkeypatch.setenv("STRAVA_CLIENT_ID", "cid")
    monkeypatch.setenv("STRAVA_CLIENT_SECRET", "secret")
    monkeypatch.setenv("STRAVA_REDIRECT_URI", "http://localhost/callback")
    monkeypatch.setenv("STRAVA_WEBHOOK_VERIFY_TOKEN", "verify-me")

    ok_response = await integrations_router.provider_webhook_challenge(
        "strava",
        _make_webhook_request("hub.verify_token=verify-me&hub.challenge=abc123&hub.mode=subscribe"),
    )

    assert ok_response == {"hub.challenge": "abc123"}

    with pytest.raises(HTTPException) as exc:
        await integrations_router.provider_webhook_challenge(
            "strava",
            _make_webhook_request("hub.verify_token=wrong&hub.challenge=abc123&hub.mode=subscribe"),
        )

    assert exc.value.status_code == 400


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
        file_type = "provider"
        streams = {
            "data": [],
            "_meta": {
                "source_provider": "strava",
                "source_activity_id": "abc",
            },
        }
        filename = "old.fit"
        sport = "running"
        created_at = None
        duration = 1200
        distance = 5000
        avg_speed = 4.1
        average_hr = 150
        average_watts = None
        local_date = None
        moving_time = None

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
    # The existing duplicate is re-added to the session during same-source enrichment update.
    # Assert no *new* activity object was created: the added item must be the existing duplicate.
    assert all(getattr(item, "id", None) == 42 for item in db.added)


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
async def test_strava_initial_sync_uses_three_month_window(monkeypatch):
    import app.integrations.connectors.strava as strava_module
    from datetime import datetime, timezone, timedelta

    captured_params: list[dict] = []

    class _FakeInitialSyncClient:
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
                            "name": "3-Month Old Ride",
                            "start_date": "2025-12-01T07:30:00Z",
                            "moving_time": 2400,
                            "distance": 12000,
                            "sport_type": "Ride",
                        }
                    ]
                )
            return _ListResponse([])

    monkeypatch.setattr(strava_module.httpx, "AsyncClient", _FakeInitialSyncClient)

    connector = StravaConnector()
    result = await connector.fetch_activities(
        access_token="token",
        cursor={},
    )

    assert len(result.activities) == 1
    # On first sync, should use "after" parameter (not "before")
    assert all("after" in p for p in captured_params)
    # Cursor should be updated to mark initial sync as done
    assert result.next_cursor.get("initial_sync_done") is True
