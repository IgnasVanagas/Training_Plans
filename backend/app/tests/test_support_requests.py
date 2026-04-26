from __future__ import annotations

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.routers import communications as communications_router
from app.schemas import SupportRequestCreate
from app.services import support as support_service


def _make_request(*, host: str = "203.0.113.10", user_agent: str = "pytest-agent") -> Request:
    scope = {
        "type": "http",
        "headers": [(b"user-agent", user_agent.encode("utf-8"))],
        "client": (host, 443),
        "method": "POST",
        "path": "/communications/support",
    }
    return Request(scope)


@pytest.fixture(autouse=True)
def clear_support_rate_limit_state():
    support_service._RATE_LIMIT_BUCKETS.clear()
    yield
    support_service._RATE_LIMIT_BUCKETS.clear()


@pytest.mark.asyncio
async def test_submit_support_request_sends_email(monkeypatch):
    captured: dict[str, str | None] = {}

    async def _fake_send(payload, *, client_host, user_agent, attachments=None):
        captured["email"] = payload.email
        captured["host"] = client_host
        captured["user_agent"] = user_agent

    monkeypatch.setattr(communications_router, "send_support_email", _fake_send)

    response = await communications_router.submit_support_request(
        _make_request(),
        SupportRequestCreate(
            name="Alex Runner",
            email="alex@example.com",
            subject="Dashboard issue",
            message="Dashboard keeps failing to load after refresh.",
            page_url="https://origami.example.com/dashboard",
            error_message="Unable to load dashboard.",
            client_elapsed_ms=3200,
        ),
        photos=[],
    )

    assert response.message == "Support request sent."
    assert captured == {
        "email": "alex@example.com",
        "host": "203.0.113.10",
        "user_agent": "pytest-agent",
    }


@pytest.mark.asyncio
async def test_submit_support_request_rejects_bot_trap():
    with pytest.raises(HTTPException) as exc:
        await communications_router.submit_support_request(
            _make_request(),
            SupportRequestCreate(
                email="alex@example.com",
                message="I need help with my account access.",
                bot_trap="spam",
                client_elapsed_ms=3200,
            ),
            photos=[],
        )

    assert exc.value.status_code == 400
    assert exc.value.detail == "Support request flagged as bot traffic."


@pytest.mark.asyncio
async def test_submit_support_request_surfaces_delivery_failure(monkeypatch):
    async def _failing_send(*_args, **_kwargs):
        raise communications_router.SupportDeliveryError("boom")

    monkeypatch.setattr(communications_router, "send_support_email", _failing_send)

    with pytest.raises(HTTPException) as exc:
        await communications_router.submit_support_request(
            _make_request(),
            SupportRequestCreate(
                email="alex@example.com",
                message="Please help me recover my access to the app.",
                client_elapsed_ms=3200,
            ),
            photos=[],
        )

    assert exc.value.status_code == 503
    assert exc.value.detail == "Support is temporarily unavailable. Please try again later."