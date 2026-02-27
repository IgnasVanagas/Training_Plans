from __future__ import annotations

from datetime import date

import pytest
from fastapi import HTTPException, Response
from jose import JWTError
from sqlalchemy.exc import IntegrityError

from app.auth import create_action_token, decode_action_token, get_password_hash, verify_password
from app.models import Organization, OrganizationMember, RoleEnum, User
from app.routers import auth as auth_router
from app.routers import users as users_router
from app.schemas import (
    ChangePasswordRequest,
    EmailTokenRequest,
    ForgotPasswordRequest,
    InviteByEmailRequest,
    ResetPasswordRequest,
    UserCreate,
)
import app.main as main_module


class _FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeDB:
    def __init__(self, *, execute_results=None, scalar_results=None, commit_side_effects=None):
        self.execute_results = list(execute_results or [])
        self.scalar_results = list(scalar_results or [])
        self.commit_side_effects = list(commit_side_effects or [])
        self.added = []
        self.rollback_called = False
        self.commit_count = 0
        self._id_counter = 100

    async def execute(self, _stmt):
        if self.execute_results:
            return self.execute_results.pop(0)
        return _FakeResult(None)

    async def scalar(self, _stmt):
        if self.scalar_results:
            return self.scalar_results.pop(0)
        return None

    def add(self, obj):
        if hasattr(obj, "id") and getattr(obj, "id", None) is None:
            self._id_counter += 1
            obj.id = self._id_counter
        self.added.append(obj)

    async def flush(self):
        return None

    async def refresh(self, _obj):
        return None

    async def commit(self):
        self.commit_count += 1
        if self.commit_side_effects:
            effect = self.commit_side_effects.pop(0)
            if effect:
                raise effect
        return None

    async def rollback(self):
        self.rollback_called = True


@pytest.mark.asyncio
async def test_register_handles_integrity_error_duplicate_email():
    payload = UserCreate(
        email="dupe@example.com",
        password="StrongPass1!",
        role=RoleEnum.athlete,
        first_name="Alex",
        last_name="Smith",
        gender="Male",
        birth_date=date(1990, 1, 1),
    )
    response = Response()
    db = _FakeDB(
        execute_results=[_FakeResult(None)],
        commit_side_effects=[IntegrityError("insert", {}, Exception("duplicate"))],
    )

    with pytest.raises(HTTPException) as exc:
        await auth_router.register(payload, response, db)

    assert exc.value.status_code == 400
    assert exc.value.detail == "Email already registered"
    assert db.rollback_called is True


@pytest.mark.asyncio
async def test_invite_existing_athlete_by_email_creates_pending_membership():
    coach = User(id=1, email="coach@example.com", password_hash="x", role=RoleEnum.coach, email_verified=True)
    coach.organization_memberships = [
        OrganizationMember(user_id=1, organization_id=11, role=RoleEnum.coach.value, status="active")
    ]

    org = Organization(id=11, name="Org One", code="orgcode")
    athlete = User(id=2, email="athlete@example.com", password_hash="x", role=RoleEnum.athlete, email_verified=True)
    db = _FakeDB(scalar_results=[org, athlete, None])

    out = await users_router.invite_existing_athlete_by_email(
        InviteByEmailRequest(email="athlete@example.com"),
        coach,
        db,
    )

    assert out.status == "pending"
    assert out.existing_user is True
    membership_adds = [item for item in db.added if isinstance(item, OrganizationMember)]
    assert len(membership_adds) == 1
    assert membership_adds[0].user_id == 2
    assert membership_adds[0].organization_id == 11
    assert membership_adds[0].status == "pending"


@pytest.mark.asyncio
async def test_invite_existing_athlete_by_email_handles_unknown_user_with_link():
    coach = User(id=1, email="coach@example.com", password_hash="x", role=RoleEnum.coach, email_verified=True)
    coach.organization_memberships = [
        OrganizationMember(user_id=1, organization_id=11, role=RoleEnum.coach.value, status="active")
    ]

    org = Organization(id=11, name="Org One", code="orgcode")
    db = _FakeDB(scalar_results=[org, None])

    out = await users_router.invite_existing_athlete_by_email(
        InviteByEmailRequest(email="newperson@example.com"),
        coach,
        db,
    )

    assert out.status == "not_found"
    assert out.existing_user is False
    assert "/invite/" in out.invite_url


@pytest.mark.asyncio
async def test_change_password_requires_valid_current_and_updates_hash():
    old_password = "OldPass1!"
    new_password = "NewPass22@"
    user = User(id=5, email="ath@example.com", password_hash=get_password_hash(old_password), role=RoleEnum.athlete, email_verified=True)

    db = _FakeDB()
    with pytest.raises(HTTPException) as exc:
        await users_router.change_password(
            ChangePasswordRequest(current_password="wrong", new_password=new_password),
            user,
            db,
        )
    assert exc.value.status_code == 400

    await users_router.change_password(
        ChangePasswordRequest(current_password=old_password, new_password=new_password),
        user,
        db,
    )

    assert verify_password(new_password, user.password_hash)
    assert db.commit_count >= 1


@pytest.mark.asyncio
async def test_verify_email_and_reset_password_flows():
    user = User(id=7, email="flow@example.com", password_hash=get_password_hash("OldPass1!"), role=RoleEnum.athlete, email_verified=False)

    verify_token = create_action_token(subject=user.email, purpose="email_confirm", expires_minutes=5)
    db_verify = _FakeDB(scalar_results=[user])
    verify_response = await auth_router.verify_email(EmailTokenRequest(token=verify_token), db_verify)
    assert verify_response["message"] == "Email confirmed"
    assert user.email_verified is True

    reset_token = create_action_token(subject=user.email, purpose="password_reset", expires_minutes=5)
    db_reset = _FakeDB(scalar_results=[user])
    reset_response = await auth_router.reset_password(
        ResetPasswordRequest(token=reset_token, new_password="BrandNew2#"),
        db_reset,
    )
    assert reset_response["message"] == "Password updated"
    assert verify_password("BrandNew2#", user.password_hash)


@pytest.mark.asyncio
async def test_forgot_password_generic_message_and_link_for_existing_user():
    existing = User(id=8, email="exists@example.com", password_hash="x", role=RoleEnum.athlete, email_verified=True)
    db_existing = _FakeDB(scalar_results=[existing])
    out_existing = await auth_router.forgot_password(ForgotPasswordRequest(email="exists@example.com"), db_existing)

    assert out_existing["message"].startswith("If that email exists")
    assert out_existing["reset_url"] is not None
    assert "/login?reset=" in out_existing["reset_url"]

    db_missing = _FakeDB(scalar_results=[None])
    out_missing = await auth_router.forgot_password(ForgotPasswordRequest(email="missing@example.com"), db_missing)
    assert out_missing["message"].startswith("If that email exists")
    assert out_missing["reset_url"] is None


def test_action_token_decode_rejects_wrong_purpose():
    token = create_action_token(subject="person@example.com", purpose="email_confirm", expires_minutes=5)
    with pytest.raises(JWTError):
        decode_action_token(token=token, purpose="password_reset")


@pytest.mark.asyncio
async def test_startup_schema_update_is_non_destructive(monkeypatch):
    executed_sql: list[str] = []

    class _FakeConn:
        async def run_sync(self, _fn):
            return None

        async def execute(self, stmt):
            executed_sql.append(str(stmt))
            return None

    class _FakeBegin:
        async def __aenter__(self):
            return _FakeConn()

        async def __aexit__(self, exc_type, exc, tb):
            return None

    class _FakeEngine:
        def begin(self):
            return _FakeBegin()

    monkeypatch.setattr(main_module, "engine", _FakeEngine())
    monkeypatch.setattr(main_module, "seed_data", lambda: None)
    monkeypatch.setenv("AUTO_SEED_DEMO", "false")

    await main_module.on_startup()

    assert any("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified" in sql for sql in executed_sql)
    assert any("UPDATE users SET email_verified = TRUE WHERE email_verified IS NULL" in sql for sql in executed_sql)
    assert all("DROP TABLE" not in sql.upper() for sql in executed_sql)
    assert all("TRUNCATE" not in sql.upper() for sql in executed_sql)
