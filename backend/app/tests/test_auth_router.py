"""Endpoint tests for app.routers.auth (login, refresh, verify, password)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, Response
from jose import JWTError

from app.models import RoleEnum, User
from app.routers import auth as auth_router


class _Result:
    def __init__(self, scalars_list=None, scalar_one=None):
        self._scalars_list = list(scalars_list) if scalars_list is not None else None
        self._scalar_one = scalar_one

    def scalar_one_or_none(self):
        if self._scalar_one is not None:
            return self._scalar_one
        if self._scalars_list:
            return self._scalars_list[0]
        return None


class _DB:
    def __init__(self, *, execute_results=None, scalar_results=None):
        self.execute_results = list(execute_results or [])
        self.scalar_results = list(scalar_results or [])
        self.commits = 0

    async def execute(self, stmt):
        return self.execute_results.pop(0) if self.execute_results else _Result()

    async def scalar(self, stmt):
        return self.scalar_results.pop(0) if self.scalar_results else None

    async def commit(self):
        self.commits += 1


def _user(email="x@y.z", verified=True, code=None, expires=None):
    return User(
        id=1, email=email, password_hash="hashed",
        role=RoleEnum.athlete, email_verified=verified,
        email_verification_code=code,
        email_verification_expires_at=expires,
    )


# ── login ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_login_invalid_credentials_when_user_missing(monkeypatch):
    db = _DB(execute_results=[_Result()])
    monkeypatch.setattr(auth_router.asyncio, "sleep",
                        AsyncMock(return_value=None))
    payload = SimpleNamespace(email="x@y.z", password="pw")
    with pytest.raises(HTTPException) as exc:
        await auth_router.login(payload=payload, response=Response(), db=db)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_login_invalid_password(monkeypatch):
    user = _user()
    db = _DB(execute_results=[_Result(scalar_one=user)])
    monkeypatch.setattr(auth_router, "verify_password", lambda p, h: False)
    monkeypatch.setattr(auth_router.asyncio, "sleep",
                        AsyncMock(return_value=None))
    payload = SimpleNamespace(email="x@y.z", password="bad")
    with pytest.raises(HTTPException) as exc:
        await auth_router.login(payload=payload, response=Response(), db=db)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_login_email_not_verified(monkeypatch):
    user = _user(verified=False)
    db = _DB(execute_results=[_Result(scalar_one=user)])
    monkeypatch.setattr(auth_router, "verify_password", lambda p, h: True)
    monkeypatch.setattr(auth_router, "_require_email_verification", lambda: True)
    payload = SimpleNamespace(email="x@y.z", password="pw")
    with pytest.raises(HTTPException) as exc:
        await auth_router.login(payload=payload, response=Response(), db=db)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_login_happy_path(monkeypatch):
    user = _user()
    db = _DB(execute_results=[_Result(scalar_one=user)])
    monkeypatch.setattr(auth_router, "verify_password", lambda p, h: True)
    monkeypatch.setattr(auth_router, "_require_email_verification", lambda: False)
    monkeypatch.setattr(auth_router, "create_access_token", lambda subject: "AT")
    monkeypatch.setattr(auth_router, "create_refresh_token", lambda subject: "RT")
    payload = SimpleNamespace(email="x@y.z", password="pw")
    out = await auth_router.login(payload=payload, response=Response(), db=db)
    assert out.access_token == "AT"


# ── logout ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_logout_returns_message():
    out = await auth_router.logout(response=Response())
    assert out["message"] == "Logged out"


# ── refresh ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_refresh_no_cookie_401():
    request = SimpleNamespace(cookies={})
    with pytest.raises(HTTPException) as exc:
        await auth_router.refresh(request=request, response=Response(), db=_DB())
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_refresh_invalid_token_401(monkeypatch):
    request = SimpleNamespace(cookies={"refresh_token": "bad"})

    def _raise(_token):
        raise JWTError("invalid")

    monkeypatch.setattr(auth_router, "decode_refresh_token", _raise)
    with pytest.raises(HTTPException) as exc:
        await auth_router.refresh(request=request, response=Response(), db=_DB())
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_refresh_user_not_found_401(monkeypatch):
    request = SimpleNamespace(cookies={"refresh_token": "tok"})
    monkeypatch.setattr(auth_router, "decode_refresh_token", lambda t: "1")
    db = _DB(scalar_results=[None])
    with pytest.raises(HTTPException) as exc:
        await auth_router.refresh(request=request, response=Response(), db=db)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_refresh_happy_path(monkeypatch):
    user = _user()
    request = SimpleNamespace(cookies={"refresh_token": "tok"})
    monkeypatch.setattr(auth_router, "decode_refresh_token", lambda t: "1")
    monkeypatch.setattr(auth_router, "create_access_token", lambda subject: "AT2")
    monkeypatch.setattr(auth_router, "create_refresh_token", lambda subject: "RT2")
    db = _DB(scalar_results=[user])
    out = await auth_router.refresh(request=request, response=Response(), db=db)
    assert out.access_token == "AT2"


# ── verify_email ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_verify_email_user_not_found_404():
    payload = SimpleNamespace(email="x@y.z", code="123456")
    db = _DB(scalar_results=[None])
    with pytest.raises(HTTPException) as exc:
        await auth_router.verify_email(payload=payload, db=db)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_verify_email_already_verified():
    user = _user(verified=True)
    payload = SimpleNamespace(email="x@y.z", code="123456")
    db = _DB(scalar_results=[user])
    out = await auth_router.verify_email(payload=payload, db=db)
    assert out["message"] == "Email confirmed"


@pytest.mark.asyncio
async def test_verify_email_invalid_code():
    user = _user(verified=False, code="OTHER")
    payload = SimpleNamespace(email="x@y.z", code="123456")
    db = _DB(scalar_results=[user])
    with pytest.raises(HTTPException) as exc:
        await auth_router.verify_email(payload=payload, db=db)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_verify_email_expired_no_expiry():
    user = _user(verified=False, code="123456", expires=None)
    payload = SimpleNamespace(email="x@y.z", code="123456")
    db = _DB(scalar_results=[user])
    with pytest.raises(HTTPException) as exc:
        await auth_router.verify_email(payload=payload, db=db)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_verify_email_expired_in_past():
    expired = datetime.now(timezone.utc) - timedelta(minutes=30)
    user = _user(verified=False, code="123456", expires=expired)
    payload = SimpleNamespace(email="x@y.z", code="123456")
    db = _DB(scalar_results=[user])
    with pytest.raises(HTTPException) as exc:
        await auth_router.verify_email(payload=payload, db=db)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_verify_email_happy_path():
    future = datetime.now(timezone.utc) + timedelta(minutes=10)
    user = _user(verified=False, code="123456", expires=future)
    payload = SimpleNamespace(email="x@y.z", code="123456")
    db = _DB(scalar_results=[user])
    out = await auth_router.verify_email(payload=payload, db=db)
    assert user.email_verified is True
    assert out["message"] == "Email confirmed"


# ── resend_email_confirmation ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_resend_email_confirmation_user_missing():
    payload = SimpleNamespace(email="x@y.z")
    db = _DB(scalar_results=[None])
    out = await auth_router.resend_email_confirmation(payload=payload, db=db)
    assert "If that email" in out["message"]


@pytest.mark.asyncio
async def test_resend_email_confirmation_already_verified():
    user = _user(verified=True)
    payload = SimpleNamespace(email="x@y.z")
    db = _DB(scalar_results=[user])
    out = await auth_router.resend_email_confirmation(payload=payload, db=db)
    assert "already verified" in out["message"]


@pytest.mark.asyncio
async def test_resend_email_confirmation_sends(monkeypatch):
    user = _user(verified=False)
    payload = SimpleNamespace(email="x@y.z")
    db = _DB(scalar_results=[user])
    monkeypatch.setattr(auth_router, "send_verification_email",
                        AsyncMock(return_value=None))
    out = await auth_router.resend_email_confirmation(payload=payload, db=db)
    assert "If that email" in out["message"]


# ── forgot/reset password ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_forgot_password_missing_user_returns_neutral():
    payload = SimpleNamespace(email="x@y.z")
    db = _DB(scalar_results=[None])
    out = await auth_router.forgot_password(payload=payload, db=db)
    assert "If that email" in out["message"]


@pytest.mark.asyncio
async def test_forgot_password_with_debug_link(monkeypatch):
    user = _user()
    payload = SimpleNamespace(email="x@y.z")
    db = _DB(scalar_results=[user])
    monkeypatch.setattr(auth_router, "_should_expose_auth_debug_links",
                        lambda: True)
    monkeypatch.setattr(auth_router, "create_action_token",
                        lambda subject, purpose, expires_minutes: "TOK")
    out = await auth_router.forgot_password(payload=payload, db=db)
    assert "reset_url" in out


@pytest.mark.asyncio
async def test_reset_password_invalid_token(monkeypatch):
    def _raise(token, purpose):
        raise JWTError("bad")

    monkeypatch.setattr(auth_router, "decode_action_token", _raise)
    payload = SimpleNamespace(token="X", new_password="NewPw1234!")
    with pytest.raises(HTTPException) as exc:
        await auth_router.reset_password(payload=payload, db=_DB())
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_reset_password_user_not_found(monkeypatch):
    monkeypatch.setattr(auth_router, "decode_action_token",
                        lambda token, purpose: "x@y.z")
    db = _DB(scalar_results=[None])
    payload = SimpleNamespace(token="X", new_password="NewPw1234!")
    with pytest.raises(HTTPException) as exc:
        await auth_router.reset_password(payload=payload, db=db)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_reset_password_happy_path(monkeypatch):
    user = _user()
    monkeypatch.setattr(auth_router, "decode_action_token",
                        lambda token, purpose: "x@y.z")
    monkeypatch.setattr(auth_router, "get_password_hash",
                        lambda pw: "newhash")
    db = _DB(scalar_results=[user])
    payload = SimpleNamespace(token="X", new_password="NewPw1234!")
    out = await auth_router.reset_password(payload=payload, db=db)
    assert user.password_hash == "newhash"
    assert "updated" in out["message"]


# ── _build_frontend_action_url ──────────────────────────────────────────────


def test_build_frontend_action_url():
    url = auth_router._build_frontend_action_url(route="/x?reset=", token="abc d")
    assert url.endswith("/x?reset=abc%20d")
