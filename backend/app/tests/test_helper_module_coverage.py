from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from cryptography.fernet import InvalidToken
from fastapi import HTTPException
from jose import jwt
from starlette.requests import Request

import app.auth as auth_module
import app.database as database_module
import app.integrations.crypto as crypto_module
import app.services.email as email_module
import app.services.support as support_module
import app.workout_templates as workout_templates
from app.integrations.base import IntegrationUnavailableError
from app.integrations.connectors._scaffold import ApprovalScaffoldConnector
from app.models import RoleEnum, User
from app.schemas import SupportRequestCreate


class _FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeDB:
    def __init__(self, value):
        self._value = value

    async def execute(self, _stmt):
        return _FakeResult(self._value)


class _FakeSession:
    def __init__(self):
        self.rollback_calls = 0

    async def rollback(self):
        self.rollback_calls += 1


class _FakeSessionContext:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _make_request(*, access_token: str | None = None) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if access_token is not None:
        headers.append((b"cookie", f"access_token={access_token}".encode("utf-8")))
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/auth/me",
        "headers": headers,
        "query_string": b"",
        "client": ("127.0.0.1", 443),
    }
    return Request(scope)


def _encode_auth_token(**overrides) -> str:
    now = datetime.utcnow()
    payload = {
        "exp": now + timedelta(minutes=5),
        "iat": now,
        "nbf": now,
        "iss": auth_module.JWT_ISSUER,
        "aud": auth_module.JWT_AUDIENCE,
        "sub": "1",
    }
    payload.update(overrides)
    return jwt.encode(payload, auth_module.SECRET_KEY, algorithm=auth_module.ALGORITHM)


def _make_support_payload(**overrides) -> SupportRequestCreate:
    payload = {
        "name": "Alex Runner",
        "email": "alex@example.com",
        "subject": "Need help",
        "message": "Please help me recover access to the dashboard.",
        "client_elapsed_ms": 4500,
    }
    payload.update(overrides)
    return SupportRequestCreate(**payload)


class _RecorderSMTP:
    instances: list["_RecorderSMTP"] = []

    def __init__(self, host, port, timeout=None, context=None):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.context = context
        self.started_tls = False
        self.login_args = None
        self.sent_message = None
        self.raise_on_send = False
        self.__class__.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def starttls(self, context=None):
        self.started_tls = True
        self.context = context

    def login(self, username, password):
        self.login_args = (username, password)

    def send_message(self, message):
        if self.raise_on_send:
            raise RuntimeError("smtp send failed")
        self.sent_message = message


def _build_connector(**overrides) -> ApprovalScaffoldConnector:
    params = {
        "provider": "polar",
        "display_name": "Polar",
        "docs_url": "https://docs.example.test/polar",
        "required_scopes": ["activities:read"],
    }
    params.update(overrides)
    return ApprovalScaffoldConnector(**params)


def test_load_secret_key_uses_configured_secure_value(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "real-secret-value")

    assert auth_module._load_secret_key() == "real-secret-value"


def test_load_secret_key_generates_ephemeral_value_for_placeholder(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "change_me")
    monkeypatch.setattr(auth_module.secrets, "token_urlsafe", lambda _size: "generated-secret")

    assert auth_module._load_secret_key() == "generated-secret"


@pytest.mark.asyncio
async def test_get_current_user_returns_user_from_bearer_token():
    user = User(id=12, email="runner@example.com", password_hash="hash", role=RoleEnum.athlete)

    current = await auth_module.get_current_user(
        _make_request(),
        token=auth_module.create_access_token(subject="12"),
        db=_FakeDB(user),
    )

    assert current is user


@pytest.mark.asyncio
async def test_get_current_user_uses_cookie_token_when_header_missing():
    user = User(id=22, email="cookie@example.com", password_hash="hash", role=RoleEnum.athlete)
    token = auth_module.create_access_token(subject="22")

    current = await auth_module.get_current_user(
        _make_request(access_token=token),
        token=None,
        db=_FakeDB(user),
    )

    assert current is user


@pytest.mark.asyncio
async def test_get_current_user_rejects_missing_token():
    with pytest.raises(HTTPException) as exc:
        await auth_module.get_current_user(_make_request(), token=None, db=_FakeDB(None))

    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_user_rejects_missing_subject():
    with pytest.raises(HTTPException) as exc:
        await auth_module.get_current_user(
            _make_request(),
            token=_encode_auth_token(sub=None),
            db=_FakeDB(None),
        )

    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_user_rejects_non_numeric_subject():
    with pytest.raises(HTTPException) as exc:
        await auth_module.get_current_user(
            _make_request(),
            token=auth_module.create_access_token(subject="not-an-int"),
            db=_FakeDB(None),
        )

    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_user_rejects_non_positive_subject():
    with pytest.raises(HTTPException) as exc:
        await auth_module.get_current_user(
            _make_request(),
            token=auth_module.create_access_token(subject="0"),
            db=_FakeDB(None),
        )

    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_user_rejects_unknown_user():
    with pytest.raises(HTTPException) as exc:
        await auth_module.get_current_user(
            _make_request(),
            token=auth_module.create_access_token(subject="99"),
            db=_FakeDB(None),
        )

    assert exc.value.status_code == 401


@pytest.mark.parametrize(
    ("database_url", "expected"),
    [
        ("postgres://user:pw@db/app", "postgresql+asyncpg://user:pw@db/app"),
        ("postgresql://user:pw@db/app", "postgresql+asyncpg://user:pw@db/app"),
        (" sqlite+aiosqlite:///tmp/test.db ", "sqlite+aiosqlite:///tmp/test.db"),
    ],
)
def test_normalize_async_database_url(database_url, expected):
    assert database_module._normalize_async_database_url(database_url) == expected


@pytest.mark.parametrize(
    ("value", "default", "expected"),
    [
        (None, 5, 5),
        ("17", 5, 17),
        ("invalid", 5, 5),
    ],
)
def test_env_int_parses_or_falls_back(monkeypatch, value, default, expected):
    if value is None:
        monkeypatch.delenv("TEST_ENV_INT", raising=False)
    else:
        monkeypatch.setenv("TEST_ENV_INT", value)

    assert database_module._env_int("TEST_ENV_INT", default) == expected


@pytest.mark.asyncio
async def test_get_db_yields_session_without_rollback(monkeypatch):
    session = _FakeSession()
    monkeypatch.setattr(database_module, "AsyncSessionLocal", lambda: _FakeSessionContext(session))

    generator = database_module.get_db()
    yielded = await generator.__anext__()
    await generator.aclose()

    assert yielded is session
    assert session.rollback_calls == 0


@pytest.mark.asyncio
async def test_get_db_rolls_back_on_exception(monkeypatch):
    session = _FakeSession()
    monkeypatch.setattr(database_module, "AsyncSessionLocal", lambda: _FakeSessionContext(session))

    generator = database_module.get_db()
    yielded = await generator.__anext__()

    with pytest.raises(RuntimeError, match="boom"):
        await generator.athrow(RuntimeError("boom"))

    assert yielded is session
    assert session.rollback_calls == 1


def test_encrypt_and_decrypt_token_round_trip_with_default_secret(monkeypatch):
    monkeypatch.delenv("INTEGRATIONS_TOKEN_ENCRYPTION_KEY", raising=False)

    cipher_text = crypto_module.encrypt_token("access-token")

    assert cipher_text is not None
    assert cipher_text != "access-token"
    assert crypto_module.decrypt_token(cipher_text) == "access-token"


def test_encrypt_and_decrypt_token_ignore_empty_values():
    assert crypto_module.encrypt_token(None) is None
    assert crypto_module.encrypt_token("") is None
    assert crypto_module.decrypt_token(None) is None
    assert crypto_module.decrypt_token("") is None


def test_decrypt_token_uses_runtime_encryption_secret(monkeypatch):
    monkeypatch.setenv("INTEGRATIONS_TOKEN_ENCRYPTION_KEY", "key-one")
    cipher_text = crypto_module.encrypt_token("refresh-token")

    monkeypatch.setenv("INTEGRATIONS_TOKEN_ENCRYPTION_KEY", "key-two")
    with pytest.raises(InvalidToken):
        crypto_module.decrypt_token(cipher_text)

    monkeypatch.setenv("INTEGRATIONS_TOKEN_ENCRYPTION_KEY", "key-one")
    assert crypto_module.decrypt_token(cipher_text) == "refresh-token"


@pytest.mark.asyncio
async def test_send_email_via_resend_skips_when_not_configured(monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.delenv("RESEND_FROM_EMAIL", raising=False)

    assert (
        await email_module.send_email_via_resend(
            to_email="user@example.com",
            subject="Welcome",
            html="<p>Hello</p>",
        )
        is False
    )


@pytest.mark.asyncio
async def test_send_email_via_resend_posts_expected_payload(monkeypatch):
    captured = {}

    class _FakeResponse:
        status_code = 202
        text = "accepted"

    class _FakeAsyncClient:
        def __init__(self, *, timeout):
            captured["timeout"] = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, *, json, headers):
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            return _FakeResponse()

    monkeypatch.setenv("RESEND_API_KEY", "resend-key")
    monkeypatch.setenv("RESEND_FROM_EMAIL", "noreply@example.com")
    monkeypatch.setattr(email_module.httpx, "AsyncClient", _FakeAsyncClient)

    result = await email_module.send_email_via_resend(
        to_email="user@example.com",
        subject="Welcome",
        html="<p>Hello</p>",
    )

    assert result is True
    assert captured == {
        "timeout": 10.0,
        "url": "https://api.resend.com/emails",
        "json": {
            "from": "noreply@example.com",
            "to": ["user@example.com"],
            "subject": "Welcome",
            "html": "<p>Hello</p>",
        },
        "headers": {
            "Authorization": "Bearer resend-key",
            "Content-Type": "application/json",
        },
    }


@pytest.mark.asyncio
async def test_send_email_via_resend_returns_false_on_http_error(monkeypatch):
    class _FakeResponse:
        status_code = 500
        text = "upstream failure"

    class _FakeAsyncClient:
        def __init__(self, *, timeout):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, *, json, headers):
            return _FakeResponse()

    monkeypatch.setenv("RESEND_API_KEY", "resend-key")
    monkeypatch.setenv("RESEND_FROM_EMAIL", "noreply@example.com")
    monkeypatch.setattr(email_module.httpx, "AsyncClient", _FakeAsyncClient)

    result = await email_module.send_email_via_resend(
        to_email="user@example.com",
        subject="Welcome",
        html="<p>Hello</p>",
    )

    assert result is False


@pytest.mark.asyncio
async def test_send_email_via_resend_returns_false_on_exception(monkeypatch):
    class _ExplodingAsyncClient:
        def __init__(self, *, timeout):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, *, json, headers):
            raise RuntimeError("network down")

    monkeypatch.setenv("RESEND_API_KEY", "resend-key")
    monkeypatch.setenv("RESEND_FROM_EMAIL", "noreply@example.com")
    monkeypatch.setattr(email_module.httpx, "AsyncClient", _ExplodingAsyncClient)

    result = await email_module.send_email_via_resend(
        to_email="user@example.com",
        subject="Welcome",
        html="<p>Hello</p>",
    )

    assert result is False


@pytest.mark.asyncio
async def test_send_verification_email_delegates_to_resend(monkeypatch):
    captured = {}

    async def _fake_send_email_via_resend(**kwargs):
        captured.update(kwargs)
        return True

    monkeypatch.setattr(email_module, "send_email_via_resend", _fake_send_email_via_resend)

    result = await email_module.send_verification_email(
        to_email="user@example.com",
        code="123456",
        expires_minutes=15,
    )

    assert result is True
    assert captured["to_email"] == "user@example.com"
    assert captured["subject"] == "Verify your email"
    assert "123456" in captured["html"]
    assert "15 minutes" in captured["html"]


def test_send_support_email_sync_requires_smtp_host(monkeypatch):
    monkeypatch.delenv("SMTP_HOST", raising=False)

    with pytest.raises(support_module.SupportDeliveryError, match="SMTP is not configured"):
        support_module._send_support_email_sync(
            _make_support_payload(),
            client_host="203.0.113.1",
            user_agent="pytest",
        )


def test_send_support_email_sync_uses_ssl_login_and_attachments(monkeypatch):
    _RecorderSMTP.instances.clear()
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("SMTP_PORT", "465")
    monkeypatch.setenv("SMTP_USE_SSL", "true")
    monkeypatch.setenv("SMTP_USERNAME", "mailer@example.com")
    monkeypatch.setenv("SMTP_PASSWORD", "secret")
    monkeypatch.setenv("SUPPORT_EMAIL_TO", "support@example.com")
    monkeypatch.delenv("SUPPORT_EMAIL_FROM", raising=False)
    monkeypatch.setattr(support_module.smtplib, "SMTP_SSL", _RecorderSMTP)

    support_module._send_support_email_sync(
        _make_support_payload(error_message="Server returned 500"),
        client_host="203.0.113.5",
        user_agent="pytest-agent",
        attachments=[("trace.txt", b"hello", "text/plain")],
    )

    smtp = _RecorderSMTP.instances[-1]
    attachments = list(smtp.sent_message.iter_attachments())
    assert smtp.host == "smtp.example.com"
    assert smtp.port == 465
    assert smtp.login_args == ("mailer@example.com", "secret")
    assert smtp.sent_message["Subject"] == "Need help"
    assert smtp.sent_message["From"] == "mailer@example.com"
    assert smtp.sent_message["To"] == "support@example.com"
    assert smtp.sent_message["Reply-To"] == "alex@example.com"
    assert len(attachments) == 1
    assert attachments[0].get_filename() == "trace.txt"


def test_send_support_email_sync_uses_starttls_without_login(monkeypatch):
    _RecorderSMTP.instances.clear()
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("SMTP_PORT", "587")
    monkeypatch.delenv("SMTP_USE_SSL", raising=False)
    monkeypatch.delenv("SMTP_USERNAME", raising=False)
    monkeypatch.delenv("SMTP_PASSWORD", raising=False)
    monkeypatch.setenv("SUPPORT_EMAIL_FROM", "support-form@example.com")
    monkeypatch.setattr(support_module.smtplib, "SMTP", _RecorderSMTP)

    support_module._send_support_email_sync(
        _make_support_payload(),
        client_host="203.0.113.10",
        user_agent="pytest-agent",
    )

    smtp = _RecorderSMTP.instances[-1]
    body = smtp.sent_message.get_body(preferencelist=("plain",)).get_content()
    assert smtp.started_tls is True
    assert smtp.login_args is None
    assert smtp.sent_message["From"] == "support-form@example.com"
    assert "Client IP: 203.0.113.10" in body
    assert "User-Agent: pytest-agent" in body


def test_send_support_email_sync_wraps_smtp_errors(monkeypatch):
    class _ExplodingSMTP(_RecorderSMTP):
        def send_message(self, message):
            raise RuntimeError("send failed")

    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(support_module.smtplib, "SMTP", _ExplodingSMTP)

    with pytest.raises(support_module.SupportDeliveryError, match="Support delivery failed"):
        support_module._send_support_email_sync(
            _make_support_payload(),
            client_host="203.0.113.15",
            user_agent="pytest-agent",
        )


@pytest.mark.asyncio
async def test_send_support_email_delegates_to_thread(monkeypatch):
    captured = {}

    async def _fake_to_thread(func, payload, **kwargs):
        captured["func"] = func
        captured["payload"] = payload
        captured["kwargs"] = kwargs
        return None

    monkeypatch.setattr(support_module.asyncio, "to_thread", _fake_to_thread)
    payload = _make_support_payload()

    await support_module.send_support_email(
        payload,
        client_host="203.0.113.20",
        user_agent="pytest-agent",
        attachments=[("photo.png", b"123", "image/png")],
    )

    assert captured == {
        "func": support_module._send_support_email_sync,
        "payload": payload,
        "kwargs": {
            "client_host": "203.0.113.20",
            "user_agent": "pytest-agent",
            "attachments": [("photo.png", b"123", "image/png")],
        },
    }


@pytest.mark.asyncio
async def test_send_support_email_reraises_delivery_errors(monkeypatch):
    async def _fake_to_thread(func, payload, **kwargs):
        raise support_module.SupportDeliveryError("configured failure")

    monkeypatch.setattr(support_module.asyncio, "to_thread", _fake_to_thread)

    with pytest.raises(support_module.SupportDeliveryError, match="configured failure"):
        await support_module.send_support_email(
            _make_support_payload(),
            client_host="203.0.113.20",
            user_agent="pytest-agent",
        )


@pytest.mark.asyncio
async def test_send_support_email_wraps_unexpected_errors(monkeypatch):
    async def _fake_to_thread(func, payload, **kwargs):
        raise RuntimeError("thread exploded")

    monkeypatch.setattr(support_module.asyncio, "to_thread", _fake_to_thread)

    with pytest.raises(support_module.SupportDeliveryError, match="Support delivery failed"):
        await support_module.send_support_email(
            _make_support_payload(),
            client_host="203.0.113.20",
            user_agent="pytest-agent",
        )


def test_workout_templates_export_seedable_run_and_cycle_workouts():
    assert workout_templates.RUN_WORKOUTS
    assert workout_templates.CYCLE_WORKOUTS

    for workouts in (workout_templates.RUN_WORKOUTS, workout_templates.CYCLE_WORKOUTS):
        titles = [workout["title"] for workout in workouts]
        assert len(titles) == len(set(titles))
        for workout in workouts:
            assert workout["sport_type"] in {"Running", "Cycling"}
            assert workout["description"]
            assert workout["tags"]
            assert workout["structure"]


def test_approval_scaffold_connector_reads_enable_and_config_flags(monkeypatch):
    connector = _build_connector()
    monkeypatch.setenv("ENABLE_POLAR_INTEGRATION", "true")
    monkeypatch.setenv("POLAR_CLIENT_ID", "client-id")
    monkeypatch.setenv("POLAR_CLIENT_SECRET", "client-secret")

    assert connector.is_enabled() is True
    assert connector.is_configured() is True


def test_approval_scaffold_connector_detects_missing_config(monkeypatch):
    connector = _build_connector()
    monkeypatch.setenv("ENABLE_POLAR_INTEGRATION", "false")
    monkeypatch.delenv("POLAR_CLIENT_ID", raising=False)
    monkeypatch.delenv("POLAR_CLIENT_SECRET", raising=False)

    assert connector.is_enabled() is False
    assert connector.is_configured() is False


@pytest.mark.asyncio
async def test_approval_scaffold_connector_unavailable_methods_raise():
    connector = _build_connector()

    with pytest.raises(IntegrationUnavailableError, match="scaffolded only"):
        connector.authorize_url("state-token")
    with pytest.raises(IntegrationUnavailableError, match="token exchange is disabled"):
        await connector.exchange_token("code")
    with pytest.raises(IntegrationUnavailableError, match="token refresh is disabled"):
        await connector.refresh_token("refresh-token")
    with pytest.raises(IntegrationUnavailableError, match="activity sync is disabled"):
        await connector.fetch_activities(access_token="token", cursor=None)
    with pytest.raises(IntegrationUnavailableError, match="wellness sync is disabled"):
        await connector.fetch_wellness(access_token="token", cursor=None)


@pytest.mark.asyncio
async def test_approval_scaffold_connector_bridge_only_wellness_and_webhook():
    connector = _build_connector(bridge_only=True)

    payload = await connector.fetch_wellness(access_token="token", cursor=None)
    webhook_response = await connector.handle_webhook({"event": "ping"}, {"x-request-id": "abc"})

    assert payload.hrv_daily == []
    assert payload.rhr_daily == []
    assert payload.sleep_sessions == []
    assert payload.stress_daily == []
    assert webhook_response["status"] == "ignored"
    assert webhook_response["reason"] == "pending_partner_approval"
    assert webhook_response["provider"] == "polar"
    assert webhook_response["received_at"]