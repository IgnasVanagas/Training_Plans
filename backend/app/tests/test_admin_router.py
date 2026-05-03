"""Tests for app.routers.admin endpoints and helpers.

Mirrors the codebase pattern: direct router function calls with a hand-rolled
mock DB rather than spinning up TestClient + sqlite. Pure helpers are unit
tested first, followed by per-endpoint integration-style tests.
"""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models import Activity, IntegrationAuditLog, Profile, RoleEnum, User
from app.routers import admin as admin_router


# ── Test doubles ──────────────────────────────────────────────────────────────


class _Result:
    def __init__(self, rows):
        self._rows = list(rows)

    def all(self):
        return list(self._rows)


class _AdminDB:
    """Minimal AsyncSession stand-in compatible with admin router usage."""

    def __init__(
        self,
        *,
        get_map: dict[tuple[type, int], object] | None = None,
        execute_results: list[_Result] | None = None,
        scalar_results: list[object] | None = None,
        commit_raises: list[Exception | None] | None = None,
    ) -> None:
        self.get_map = dict(get_map or {})
        self.execute_results = list(execute_results or [])
        self.scalar_results = list(scalar_results or [])
        self.commit_raises = list(commit_raises or [])
        self.added: list[object] = []
        self.commits = 0
        self.rollbacks = 0

    async def get(self, model, pk):
        return self.get_map.get((model, pk))

    async def execute(self, _stmt):
        if self.execute_results:
            return self.execute_results.pop(0)
        return _Result([])

    async def scalar(self, _stmt):
        if self.scalar_results:
            return self.scalar_results.pop(0)
        return 0

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commits += 1
        if self.commit_raises:
            err = self.commit_raises.pop(0)
            if err is not None:
                raise err

    async def rollback(self):
        self.rollbacks += 1


def _make_admin(user_id: int = 1, *, password_hash: str = "$hashed") -> User:
    return User(
        id=user_id,
        email="admin@example.com",
        password_hash=password_hash,
        role=RoleEnum.admin,
        email_verified=True,
    )


def _make_athlete(user_id: int = 2, *, email: str = "ath@example.com") -> User:
    user = User(
        id=user_id,
        email=email,
        password_hash="x",
        role=RoleEnum.athlete,
        email_verified=True,
    )
    user.profile = Profile(user_id=user_id, first_name="Old", last_name="Name")
    return user


# ── Pure helpers ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "value, detail",
    [
        ("Aa1!short", "Password must be at least 12 characters"),
        ("alllowercase1!", "Password must include an uppercase letter"),
        ("ALLUPPERCASE1!", "Password must include a lowercase letter"),
        ("NoNumbers!Here", "Password must include a number"),
        ("NoSymbol1Here", "Password must include a symbol"),
    ],
)
def test_validate_strong_password_rejects(value, detail):
    with pytest.raises(HTTPException) as exc:
        admin_router._validate_strong_password(value)
    assert exc.value.status_code == 400
    assert exc.value.detail == detail


def test_validate_strong_password_accepts_complex_value():
    admin_router._validate_strong_password("Str0ng!Passw0rd")  # no exception


def test_read_process_memory_mb_handles_oserror(monkeypatch):
    def _raise_oserror(*_a, **_kw):
        raise OSError("not on linux")

    monkeypatch.setattr("builtins.open", _raise_oserror)
    rss, peak = admin_router._read_process_memory_mb()
    assert rss is None and peak is None


def test_read_process_memory_mb_parses_status(monkeypatch):
    class _FakeFile:
        def __init__(self, lines):
            self._lines = lines
        def __enter__(self):
            return iter(self._lines)
        def __exit__(self, *_a):
            return False

    def _fake_open(path, *_a, **_kw):
        assert path == "/proc/self/status"
        return _FakeFile(["VmRSS:\t  2048 kB\n", "VmHWM:\t  4096 kB\n"])

    monkeypatch.setattr("builtins.open", _fake_open)
    rss, peak = admin_router._read_process_memory_mb()
    assert rss == 2.0
    assert peak == 4.0


def test_assert_admin_password_rejects_when_blank():
    admin = _make_admin()
    with pytest.raises(HTTPException) as exc:
        admin_router._assert_admin_password(admin, "")
    assert exc.value.status_code == 403


def test_assert_admin_password_rejects_when_mismatch(monkeypatch):
    monkeypatch.setattr(admin_router, "verify_password", lambda *_a, **_kw: False)
    with pytest.raises(HTTPException) as exc:
        admin_router._assert_admin_password(_make_admin(), "wrong")
    assert exc.value.status_code == 403


def test_assert_admin_password_passes(monkeypatch):
    monkeypatch.setattr(admin_router, "verify_password", lambda *_a, **_kw: True)
    admin_router._assert_admin_password(_make_admin(), "right")


def test_require_admin_blocks_non_admin():
    coach = User(
        id=9, email="c@x", password_hash="x",
        role=RoleEnum.coach, email_verified=True,
    )
    with pytest.raises(HTTPException) as exc:
        admin_router._require_admin(coach)
    assert exc.value.status_code == 403


def test_require_admin_allows_admin():
    admin = _make_admin()
    assert admin_router._require_admin(admin) is admin


@pytest.mark.asyncio
async def test_write_admin_audit_log_persists_row():
    db = _AdminDB()
    admin = _make_admin()

    await admin_router._write_admin_audit_log(
        db=db,
        admin=admin,
        action="reset_password",
        status="ok",
        message="msg",
    )

    assert db.commits == 1
    assert len(db.added) == 1
    log = db.added[0]
    assert isinstance(log, IntegrationAuditLog)
    assert log.user_id == admin.id
    assert log.provider == "admin"
    assert log.action == "reset_password"
    assert log.status == "ok"
    assert log.message == "msg"


# ── Endpoint: list_all_users ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_all_users_maps_rows_with_activity_counts():
    user = _make_athlete()
    db = _AdminDB(execute_results=[_Result([(user, 12)])])

    rows = await admin_router.list_all_users(
        skip=0,
        limit=50,
        search="ath",
        role="athlete",
        _admin=_make_admin(),
        db=db,
    )

    assert len(rows) == 1
    assert rows[0].id == user.id
    assert rows[0].activity_count == 12
    assert rows[0].first_name == "Old"
    assert rows[0].role == "athlete"


@pytest.mark.asyncio
async def test_list_all_users_ignores_invalid_role_filter():
    db = _AdminDB(execute_results=[_Result([])])
    rows = await admin_router.list_all_users(
        skip=0, limit=10, search=None, role="not-a-role",
        _admin=_make_admin(), db=db,
    )
    assert rows == []


# ── Endpoint: change_user_role ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_change_user_role_rejects_self_change():
    admin = _make_admin()
    db = _AdminDB()
    with pytest.raises(HTTPException) as exc:
        await admin_router.change_user_role(
            user_id=admin.id,
            body=admin_router.RoleChangeRequest(role="coach"),
            admin=admin,
            db=db,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_change_user_role_invalid_role():
    admin = _make_admin()
    db = _AdminDB()
    with pytest.raises(HTTPException) as exc:
        await admin_router.change_user_role(
            user_id=2,
            body=admin_router.RoleChangeRequest(role="bogus"),
            admin=admin,
            db=db,
        )
    assert exc.value.status_code == 400
    assert "Invalid role" in exc.value.detail


@pytest.mark.asyncio
async def test_change_user_role_user_not_found():
    admin = _make_admin()
    db = _AdminDB()  # get returns None
    with pytest.raises(HTTPException) as exc:
        await admin_router.change_user_role(
            user_id=99,
            body=admin_router.RoleChangeRequest(role="coach"),
            admin=admin,
            db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_change_user_role_success_commits():
    admin = _make_admin()
    target = _make_athlete()
    db = _AdminDB(get_map={(User, target.id): target})

    out = await admin_router.change_user_role(
        user_id=target.id,
        body=admin_router.RoleChangeRequest(role="coach"),
        admin=admin,
        db=db,
    )
    assert out == {"id": target.id, "role": "coach"}
    assert target.role == RoleEnum.coach
    assert db.commits == 1


# ── Endpoint: update_athlete_identity ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_update_identity_blocks_self(monkeypatch):
    monkeypatch.setattr(admin_router, "verify_password", lambda *_a, **_kw: True)
    admin = _make_admin()
    db = _AdminDB()
    body = admin_router.AdminAthleteIdentityUpdateRequest(
        admin_password="ok", first_name="X",
    )
    with pytest.raises(HTTPException) as exc:
        await admin_router.update_athlete_identity(
            user_id=admin.id, body=body, admin=admin, db=db,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_update_identity_rejects_non_athlete(monkeypatch):
    monkeypatch.setattr(admin_router, "verify_password", lambda *_a, **_kw: True)
    admin = _make_admin()
    target = _make_athlete()
    target.role = RoleEnum.coach
    db = _AdminDB(get_map={(User, target.id): target})
    body = admin_router.AdminAthleteIdentityUpdateRequest(
        admin_password="ok", first_name="X",
    )
    with pytest.raises(HTTPException) as exc:
        await admin_router.update_athlete_identity(
            user_id=target.id, body=body, admin=admin, db=db,
        )
    assert exc.value.status_code == 400
    assert "athlete" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_update_identity_no_changes_returns_updated_false(monkeypatch):
    monkeypatch.setattr(admin_router, "verify_password", lambda *_a, **_kw: True)
    admin = _make_admin()
    target = _make_athlete()
    db = _AdminDB(get_map={(User, target.id): target})
    body = admin_router.AdminAthleteIdentityUpdateRequest(
        admin_password="ok",
        first_name="Old",  # same as profile
        last_name="Name",
        email=target.email,
    )
    out = await admin_router.update_athlete_identity(
        user_id=target.id, body=body, admin=admin, db=db,
    )
    assert out["updated"] is False
    assert db.commits == 0  # nothing to commit


@pytest.mark.asyncio
async def test_update_identity_success_writes_audit(monkeypatch):
    monkeypatch.setattr(admin_router, "verify_password", lambda *_a, **_kw: True)
    admin = _make_admin()
    target = _make_athlete()
    db = _AdminDB(get_map={(User, target.id): target})
    body = admin_router.AdminAthleteIdentityUpdateRequest(
        admin_password="ok", first_name="New", last_name="Hero",
        email="new@example.com",
    )
    out = await admin_router.update_athlete_identity(
        user_id=target.id, body=body, admin=admin, db=db,
    )
    assert out["updated"] is True
    assert target.email == "new@example.com"
    assert target.email_verified is False
    assert target.profile.first_name == "New"
    assert target.profile.last_name == "Hero"
    # one commit for the profile fields, second for audit log
    assert db.commits == 2
    audit = [o for o in db.added if isinstance(o, IntegrationAuditLog)]
    assert audit and audit[0].action == "update_identity"


@pytest.mark.asyncio
async def test_update_identity_creates_profile_when_missing(monkeypatch):
    monkeypatch.setattr(admin_router, "verify_password", lambda *_a, **_kw: True)
    admin = _make_admin()
    target = _make_athlete()
    target.profile = None  # missing profile path
    db = _AdminDB(get_map={(User, target.id): target})
    body = admin_router.AdminAthleteIdentityUpdateRequest(
        admin_password="ok", first_name="New",
    )
    out = await admin_router.update_athlete_identity(
        user_id=target.id, body=body, admin=admin, db=db,
    )
    assert out["updated"] is True
    assert any(isinstance(o, Profile) for o in db.added)


@pytest.mark.asyncio
async def test_update_identity_handles_email_collision(monkeypatch):
    from sqlalchemy.exc import IntegrityError

    monkeypatch.setattr(admin_router, "verify_password", lambda *_a, **_kw: True)
    admin = _make_admin()
    target = _make_athlete()
    db = _AdminDB(
        get_map={(User, target.id): target},
        commit_raises=[IntegrityError("dup", None, Exception("dup"))],
    )
    body = admin_router.AdminAthleteIdentityUpdateRequest(
        admin_password="ok", email="dup@example.com",
    )
    with pytest.raises(HTTPException) as exc:
        await admin_router.update_athlete_identity(
            user_id=target.id, body=body, admin=admin, db=db,
        )
    assert exc.value.status_code == 400
    assert "already in use" in exc.value.detail
    assert db.rollbacks == 1


# ── Endpoint: reset_athlete_password ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_reset_password_blocks_self(monkeypatch):
    monkeypatch.setattr(admin_router, "verify_password", lambda *_a, **_kw: True)
    admin = _make_admin()
    db = _AdminDB()
    body = admin_router.AdminAthletePasswordResetRequest(
        admin_password="ok", new_password="Str0ng!Passw0rd",
    )
    with pytest.raises(HTTPException) as exc:
        await admin_router.reset_athlete_password(
            user_id=admin.id, body=body, admin=admin, db=db,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_reset_password_rejects_non_athlete(monkeypatch):
    monkeypatch.setattr(admin_router, "verify_password", lambda *_a, **_kw: True)
    monkeypatch.setattr(admin_router, "get_password_hash", lambda v: f"H({v})")
    admin = _make_admin()
    target = _make_athlete()
    target.role = RoleEnum.coach
    db = _AdminDB(get_map={(User, target.id): target})
    body = admin_router.AdminAthletePasswordResetRequest(
        admin_password="ok", new_password="Str0ng!Passw0rd",
    )
    with pytest.raises(HTTPException) as exc:
        await admin_router.reset_athlete_password(
            user_id=target.id, body=body, admin=admin, db=db,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_reset_password_success(monkeypatch):
    monkeypatch.setattr(admin_router, "verify_password", lambda *_a, **_kw: True)
    monkeypatch.setattr(admin_router, "get_password_hash", lambda v: f"H({v})")
    admin = _make_admin()
    target = _make_athlete()
    db = _AdminDB(get_map={(User, target.id): target})
    body = admin_router.AdminAthletePasswordResetRequest(
        admin_password="ok", new_password="Str0ng!Passw0rd",
    )
    out = await admin_router.reset_athlete_password(
        user_id=target.id, body=body, admin=admin, db=db,
    )
    assert out == {"id": target.id, "reset": True}
    assert target.password_hash == "H(Str0ng!Passw0rd)"
    # commit for password write + commit inside _write_admin_audit_log
    assert db.commits == 2


@pytest.mark.asyncio
async def test_reset_password_user_not_found(monkeypatch):
    monkeypatch.setattr(admin_router, "verify_password", lambda *_a, **_kw: True)
    admin = _make_admin()
    db = _AdminDB()
    body = admin_router.AdminAthletePasswordResetRequest(
        admin_password="ok", new_password="Str0ng!Passw0rd",
    )
    with pytest.raises(HTTPException) as exc:
        await admin_router.reset_athlete_password(
            user_id=999, body=body, admin=admin, db=db,
        )
    assert exc.value.status_code == 404


# ── Endpoint: list_audit_logs ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_audit_logs_maps_rows():
    log = IntegrationAuditLog(
        id=1, user_id=2, provider="admin", action="reset",
        status="ok", message="msg", created_at=datetime(2026, 1, 1),
    )
    db = _AdminDB(execute_results=[_Result([(log, "user@example.com")])])

    rows = await admin_router.list_audit_logs(
        skip=0, limit=10, provider="admin", status="ok",
        _admin=_make_admin(), db=db,
    )
    assert len(rows) == 1
    assert rows[0].id == 1
    assert rows[0].user_email == "user@example.com"


# ── Endpoint: get_stats ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_stats_aggregates_counts(monkeypatch):
    # 3 role counts + 1 total activities
    db = _AdminDB(scalar_results=[5, 10, 1, 200])
    monkeypatch.setattr(
        admin_router, "_read_process_memory_mb", lambda: (12.5, 25.0)
    )

    out = await admin_router.get_stats(_admin=_make_admin(), db=db)

    assert out["total_activities"] == 200
    assert out["users"]["coach"] in (5, 10, 1)
    assert out["memory"]["process_rss_mb"] == 12.5
    assert out["memory"]["host_total_mb"] is None


# ── Endpoint: backfill_duplicates ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_backfill_duplicates_invokes_service(monkeypatch):
    captured = {}

    async def _fake(engine):
        captured["engine"] = engine
        return 7

    monkeypatch.setattr(
        "app.services.activity_dedupe._backfill_duplicates", _fake
    )
    out = await admin_router.backfill_duplicates(_admin=_make_admin())
    assert out == {"marked": 7}
    assert "engine" in captured
