"""Tests for Strava OAuth/webhook subscription endpoints (httpx mocked)."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime
from types import SimpleNamespace

import httpx
import pytest

from app.integrations.connectors.strava import StravaConnector


def _resp(status, body=None, headers=None):
    return httpx.Response(
        status_code=status,
        content=json.dumps(body).encode() if body is not None else b"",
        headers={"content-type": "application/json", **(headers or {})}
        if body is not None else (headers or {}),
    )


@pytest.fixture
def connector(monkeypatch):
    async def _no_sleep(*a, **k):
        return None
    monkeypatch.setattr("app.integrations.connectors.strava.asyncio.sleep", _no_sleep)
    return StravaConnector()


def _patch_async_client(monkeypatch, handler):
    real_cls = httpx.AsyncClient

    def fake(*a, **kw):
        return real_cls(transport=httpx.MockTransport(handler), timeout=5.0)

    monkeypatch.setattr(
        "app.integrations.connectors.strava.httpx.AsyncClient", fake
    )


def test_exchange_token_returns_result(connector, monkeypatch):
    body = {
        "access_token": "AT", "refresh_token": "RT",
        "expires_at": 1735689600, "scope": "read,activity:read_all",
        "athlete": {"id": 12345},
    }
    _patch_async_client(monkeypatch, lambda r: _resp(200, body))

    result = asyncio.run(connector.exchange_token("code123"))
    assert result.access_token == "AT"
    assert result.refresh_token == "RT"
    assert "activity:read_all" in result.scopes
    assert result.external_athlete_id == "12345"


def test_refresh_token_returns_result(connector, monkeypatch):
    body = {"access_token": "NEW", "refresh_token": "NEWRT",
            "scope": "read", "expires_at": 0}
    _patch_async_client(monkeypatch, lambda r: _resp(200, body))
    result = asyncio.run(connector.refresh_token("oldrt"))
    assert result.access_token == "NEW"


def test_deauthorize_returns_already_when_401(connector, monkeypatch):
    _patch_async_client(monkeypatch, lambda r: httpx.Response(status_code=401))
    out = asyncio.run(connector.deauthorize("at"))
    assert out == {"status": "already_deauthorized"}


def test_deauthorize_returns_payload(connector, monkeypatch):
    _patch_async_client(monkeypatch, lambda r: _resp(200, {"deauthorized": True}))
    out = asyncio.run(connector.deauthorize("at"))
    assert out == {"deauthorized": True}


def test_list_webhook_subscriptions_returns_list(connector, monkeypatch):
    body = [{"id": 1, "callback_url": "https://x"}]
    _patch_async_client(monkeypatch, lambda r: _resp(200, body))
    out = asyncio.run(connector.list_webhook_subscriptions())
    assert out == body


def test_list_webhook_subscriptions_returns_empty_when_not_list(connector, monkeypatch):
    _patch_async_client(monkeypatch, lambda r: _resp(200, {"oops": True}))
    out = asyncio.run(connector.list_webhook_subscriptions())
    assert out == []


def test_create_webhook_subscription(connector, monkeypatch):
    _patch_async_client(monkeypatch, lambda r: _resp(201, {"id": 42}))
    out = asyncio.run(connector.create_webhook_subscription())
    assert out["id"] == 42


def test_delete_webhook_subscription_ok_on_404(connector, monkeypatch):
    _patch_async_client(monkeypatch, lambda r: httpx.Response(status_code=404))
    asyncio.run(connector.delete_webhook_subscription(99))


def test_handle_webhook_returns_accepted(connector):
    out = asyncio.run(connector.handle_webhook(
        {"object_type": "activity", "owner_id": "1", "aspect_type": "create"},
        {},
    ))
    assert out["status"] == "accepted"
    assert out["provider"] == "strava"


def test_fetch_wellness_returns_empty_payload(connector):
    out = asyncio.run(connector.fetch_wellness(access_token="t", cursor=None))
    assert out.hrv_daily == []
    assert out.rhr_daily == []


def test_ensure_webhook_subscription_returns_existing(connector, monkeypatch):
    monkeypatch.setattr(connector, "is_webhook_configured", lambda: True)
    monkeypatch.setattr(connector, "webhook_callback_url",
                        lambda: "https://my-callback")

    async def fake_list():
        return [{"id": 1, "callback_url": "https://my-callback"}]
    monkeypatch.setattr(connector, "list_webhook_subscriptions", fake_list)

    out = asyncio.run(connector.ensure_webhook_subscription())
    assert out["status"] == "existing"


def test_ensure_webhook_subscription_not_configured(connector, monkeypatch):
    monkeypatch.setattr(connector, "is_webhook_configured", lambda: False)
    out = asyncio.run(connector.ensure_webhook_subscription())
    assert out["status"] == "not_configured"


def test_ensure_webhook_subscription_creates_when_none(connector, monkeypatch):
    monkeypatch.setattr(connector, "is_webhook_configured", lambda: True)
    monkeypatch.setattr(connector, "webhook_callback_url",
                        lambda: "https://my-callback")

    async def fake_list():
        return []

    async def fake_create():
        return {"id": 7}

    monkeypatch.setattr(connector, "list_webhook_subscriptions", fake_list)
    monkeypatch.setattr(connector, "create_webhook_subscription", fake_create)

    out = asyncio.run(connector.ensure_webhook_subscription())
    assert out["status"] == "created"


def test_ensure_webhook_subscription_raises_when_other_subscription(connector, monkeypatch):
    monkeypatch.setattr(connector, "is_webhook_configured", lambda: True)
    monkeypatch.setattr(connector, "webhook_callback_url",
                        lambda: "https://my-callback")

    async def fake_list():
        return [{"id": 5, "callback_url": "https://other"}]

    monkeypatch.setattr(connector, "list_webhook_subscriptions", fake_list)
    monkeypatch.delenv("STRAVA_REPLACE_EXISTING_WEBHOOK_SUBSCRIPTION",
                        raising=False)

    with pytest.raises(RuntimeError):
        asyncio.run(connector.ensure_webhook_subscription())
