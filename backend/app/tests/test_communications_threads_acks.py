"""Tests for thread + acknowledgement endpoints in app.routers.communications.

Direct function-call style with hand-rolled mock DB. Covers helpers
(_normalize_entity_type, _build_message_preview, _sender_display_name,
_resolve_entity_owner_id, _ensure_access_to_entity, _list_thread_comments)
plus get_thread / add_thread_comment / add_acknowledgement /
get_acknowledgements / get_communication_history.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import pytest
from fastapi import HTTPException

from app.models import (
    Activity,
    CommunicationAcknowledgement,
    CommunicationComment,
    CommunicationThread,
    PlannedWorkout,
    Profile,
    RoleEnum,
    User,
)
from app.routers import communications as comm_router
from app.schemas import (
    CommunicationAcknowledgementCreate,
    CommunicationCommentCreate,
)


# ── Pure helpers ─────────────────────────────────────────────────────────────


def test_sender_display_name_uses_full_name():
    user = User(id=1, email="x@y", password_hash="h", role=RoleEnum.coach,
                email_verified=True)
    profile = Profile(user_id=1, first_name="Ada", last_name="Lovelace")
    assert comm_router._sender_display_name(user, profile) == "Ada Lovelace"


def test_sender_display_name_uses_first_only():
    user = User(id=1, email="x@y", password_hash="h", role=RoleEnum.coach,
                email_verified=True)
    profile = Profile(user_id=1, first_name="Solo", last_name=None)
    assert comm_router._sender_display_name(user, profile) == "Solo"


def test_sender_display_name_falls_back_to_email():
    user = User(id=1, email="x@y", password_hash="h", role=RoleEnum.coach,
                email_verified=True)
    assert comm_router._sender_display_name(user, None) == "x@y"
    blank_profile = Profile(user_id=1, first_name=None, last_name=None)
    assert comm_router._sender_display_name(user, blank_profile) == "x@y"


def test_normalize_entity_type_lowercases():
    assert comm_router._normalize_entity_type("Activity") == "activity"
    assert comm_router._normalize_entity_type(" workout ") == "workout"


def test_normalize_entity_type_invalid():
    with pytest.raises(HTTPException) as exc:
        comm_router._normalize_entity_type("event")
    assert exc.value.status_code == 400


def test_build_message_preview_uses_body_when_present():
    assert comm_router._build_message_preview("hello", "file.png") == "hello"


def test_build_message_preview_uses_attachment_when_no_body():
    assert comm_router._build_message_preview("   ", "file.png") == "file.png"


def test_build_message_preview_returns_none_when_both_blank():
    assert comm_router._build_message_preview(None, None) is None
    assert comm_router._build_message_preview("", "  ") is None


# ── Test doubles ─────────────────────────────────────────────────────────────


class _RowsResult:
    def __init__(self, rows):
        self._rows = list(rows)

    def all(self):
        return list(self._rows)

    def scalars(self):
        return _ScalarsResult(self._rows)

    def scalar_one_or_none(self):
        return self._rows[0] if self._rows else None


class _ScalarsResult:
    def __init__(self, rows):
        self._rows = list(rows)

    def all(self):
        return list(self._rows)

    def __iter__(self):
        return iter(self._rows)


class _CommDB:
    def __init__(
        self,
        *,
        scalar_queue: list[Any] | None = None,
        execute_queue: list[Any] | None = None,
    ):
        self.scalar_queue = list(scalar_queue or [])
        self.execute_queue = list(execute_queue or [])
        self.added: list[object] = []
        self.commits = 0
        self.flushes = 0
        self.refreshed: list[object] = []

    async def scalar(self, _stmt):
        return self.scalar_queue.pop(0) if self.scalar_queue else None

    async def execute(self, _stmt):
        if self.execute_queue:
            return self.execute_queue.pop(0)
        return _RowsResult([])

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commits += 1

    async def flush(self):
        self.flushes += 1
        # Assign id to any pending CommunicationThread without one
        for obj in self.added:
            if isinstance(obj, CommunicationThread) and getattr(obj, "id", None) is None:
                obj.id = 555

    async def refresh(self, obj):
        self.refreshed.append(obj)
        if not getattr(obj, "id", None):
            obj.id = 777
        if not getattr(obj, "created_at", None):
            obj.created_at = datetime(2026, 5, 1, 12, 0, 0)


def _athlete(uid: int = 10) -> User:
    return User(id=uid, email=f"a{uid}@x", password_hash="h",
                role=RoleEnum.athlete, email_verified=True)


def _coach(uid: int = 1) -> User:
    return User(id=uid, email=f"c{uid}@x", password_hash="h",
                role=RoleEnum.coach, email_verified=True)


def _admin(uid: int = 99) -> User:
    return User(id=uid, email="admin@x", password_hash="h",
                role=RoleEnum.admin, email_verified=True)


# ── _resolve_entity_owner_id ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_resolve_entity_owner_activity():
    activity = Activity(id=5, athlete_id=42, filename="x", file_path="/", file_type="fit")
    db = _CommDB(scalar_queue=[activity])
    out = await comm_router._resolve_entity_owner_id(db, entity_type="activity", entity_id=5)
    assert out == 42


@pytest.mark.asyncio
async def test_resolve_entity_owner_workout():
    workout = PlannedWorkout(id=7, user_id=99)
    db = _CommDB(scalar_queue=[workout])
    out = await comm_router._resolve_entity_owner_id(db, entity_type="workout", entity_id=7)
    assert out == 99


@pytest.mark.asyncio
async def test_resolve_entity_owner_missing():
    db = _CommDB(scalar_queue=[None])
    out = await comm_router._resolve_entity_owner_id(db, entity_type="activity", entity_id=999)
    assert out is None


# ── _ensure_access_to_entity ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ensure_access_athlete_owner_succeeds():
    user = _athlete(10)
    activity = Activity(id=5, athlete_id=10, filename="x", file_path="/", file_type="fit")
    db = _CommDB(scalar_queue=[activity])
    out = await comm_router._ensure_access_to_entity(
        db, current_user=user, entity_type="activity", entity_id=5,
    )
    assert out == 10


@pytest.mark.asyncio
async def test_ensure_access_athlete_other_owner_blocked():
    user = _athlete(10)
    activity = Activity(id=5, athlete_id=99, filename="x", file_path="/", file_type="fit")
    db = _CommDB(scalar_queue=[activity])
    with pytest.raises(HTTPException) as exc:
        await comm_router._ensure_access_to_entity(
            db, current_user=user, entity_type="activity", entity_id=5,
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_ensure_access_entity_not_found():
    db = _CommDB(scalar_queue=[None])
    with pytest.raises(HTTPException) as exc:
        await comm_router._ensure_access_to_entity(
            db, current_user=_athlete(), entity_type="activity", entity_id=99,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_ensure_access_admin_role_blocked():
    db = _CommDB(scalar_queue=[Activity(
        id=5, athlete_id=10, filename="x", file_path="/", file_type="fit",
    )])
    with pytest.raises(HTTPException) as exc:
        await comm_router._ensure_access_to_entity(
            db, current_user=_admin(), entity_type="activity", entity_id=5,
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_ensure_access_coach_athlete_id_mismatch():
    coach = _coach(1)
    activity = Activity(id=5, athlete_id=10, filename="x", file_path="/", file_type="fit")
    db = _CommDB(scalar_queue=[activity])
    with pytest.raises(HTTPException) as exc:
        await comm_router._ensure_access_to_entity(
            db, current_user=coach, entity_type="activity", entity_id=5, athlete_id=999,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_ensure_access_coach_no_shared_org(monkeypatch):
    coach = _coach(1)
    activity = Activity(id=5, athlete_id=10, filename="x", file_path="/", file_type="fit")
    db = _CommDB(scalar_queue=[activity])

    async def _no_orgs(*_a, **_kw):
        return set()
    monkeypatch.setattr(comm_router, "get_shared_org_ids", _no_orgs)

    with pytest.raises(HTTPException) as exc:
        await comm_router._ensure_access_to_entity(
            db, current_user=coach, entity_type="activity", entity_id=5, athlete_id=10,
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_ensure_access_coach_with_shared_org(monkeypatch):
    coach = _coach(1)
    activity = Activity(id=5, athlete_id=10, filename="x", file_path="/", file_type="fit")
    db = _CommDB(scalar_queue=[activity])

    async def _has_orgs(*_a, **_kw):
        return {7}
    monkeypatch.setattr(comm_router, "get_shared_org_ids", _has_orgs)

    out = await comm_router._ensure_access_to_entity(
        db, current_user=coach, entity_type="activity", entity_id=5, athlete_id=10,
    )
    assert out == 10


# ── _list_thread_comments ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_thread_comments_maps_rows():
    author = _athlete(10)
    comments = [
        CommunicationComment(id=1, thread_id=20, author_id=10, body="hi",
                             created_at=datetime(2026, 1, 1)),
        CommunicationComment(id=2, thread_id=20, author_id=10, body="again",
                             created_at=datetime(2026, 1, 2)),
    ]
    db = _CommDB(execute_queue=[_RowsResult([(c, author) for c in comments])])
    out = await comm_router._list_thread_comments(db, thread_id=20)
    assert len(out) == 2
    assert out[0].author_role == "athlete"
    assert out[1].body == "again"


# ── get_thread ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_thread_returns_empty_stub_when_missing():
    user = _athlete(10)
    activity = Activity(id=5, athlete_id=10, filename="x", file_path="/", file_type="fit")
    # First scalar: _resolve_entity_owner_id activity
    # Second scalar: thread lookup → None
    db = _CommDB(scalar_queue=[activity, None])
    out = await comm_router.get_thread(
        entity_type="activity", entity_id=5, athlete_id=None,
        current_user=user, db=db,
    )
    assert out.id == 0
    assert out.entity_id == 5
    assert out.athlete_id == 10
    assert out.comments == []


@pytest.mark.asyncio
async def test_get_thread_returns_existing_thread_with_comments():
    user = _athlete(10)
    activity = Activity(id=5, athlete_id=10, filename="x", file_path="/", file_type="fit")
    thread = CommunicationThread(
        id=20, entity_type="activity", entity_id=5,
        athlete_id=10, coach_id=1,
    )
    comment = CommunicationComment(
        id=1, thread_id=20, author_id=10, body="hi",
        created_at=datetime(2026, 1, 1),
    )
    db = _CommDB(
        scalar_queue=[activity, thread],
        execute_queue=[_RowsResult([(comment, user)])],
    )
    out = await comm_router.get_thread(
        entity_type="activity", entity_id=5, athlete_id=None,
        current_user=user, db=db,
    )
    assert out.id == 20
    assert len(out.comments) == 1


# ── add_thread_comment ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_add_thread_comment_creates_thread_when_missing():
    user = _athlete(10)
    activity = Activity(id=5, athlete_id=10, filename="x", file_path="/", file_type="fit")
    db = _CommDB(scalar_queue=[activity, None])  # owner lookup, thread lookup → None
    payload = CommunicationCommentCreate(body="hello", athlete_id=None)
    out = await comm_router.add_thread_comment(
        entity_type="activity", entity_id=5, payload=payload,
        current_user=user, db=db,
    )
    assert out.body == "hello"
    assert any(isinstance(o, CommunicationThread) for o in db.added)
    assert any(isinstance(o, CommunicationComment) for o in db.added)
    assert db.commits == 1
    assert db.flushes == 1


@pytest.mark.asyncio
async def test_add_thread_comment_uses_existing_thread_and_assigns_coach(monkeypatch):
    coach = _coach(1)
    activity = Activity(id=5, athlete_id=10, filename="x", file_path="/", file_type="fit")
    thread = CommunicationThread(
        id=22, entity_type="activity", entity_id=5,
        athlete_id=10, coach_id=None,
    )

    async def _has_orgs(*_a, **_kw):
        return {1}
    monkeypatch.setattr(comm_router, "get_shared_org_ids", _has_orgs)

    db = _CommDB(scalar_queue=[activity, thread])
    payload = CommunicationCommentCreate(body="reply", athlete_id=10)
    out = await comm_router.add_thread_comment(
        entity_type="activity", entity_id=5, payload=payload,
        current_user=coach, db=db,
    )
    assert out.author_role == "coach"
    assert thread.coach_id == coach.id  # assigned on first coach reply


# ── add_acknowledgement / get_acknowledgements ───────────────────────────────


@pytest.mark.asyncio
async def test_add_acknowledgement_persists_row():
    user = _athlete(10)
    activity = Activity(id=5, athlete_id=10, filename="x", file_path="/", file_type="fit")
    db = _CommDB(scalar_queue=[activity])
    payload = CommunicationAcknowledgementCreate(
        entity_type="activity", entity_id=5, action="ACKED ", note="ok",
    )
    out = await comm_router.add_acknowledgement(
        payload=payload, current_user=user, db=db,
    )
    assert out.action == "acked"
    assert out.athlete_id == 10
    assert db.commits == 1


@pytest.mark.asyncio
async def test_get_acknowledgements_lists_rows():
    user = _athlete(10)
    activity = Activity(id=5, athlete_id=10, filename="x", file_path="/", file_type="fit")
    acks = [
        CommunicationAcknowledgement(
            id=1, entity_type="activity", entity_id=5, athlete_id=10,
            actor_id=10, action="seen", note=None, created_at=datetime(2026, 1, 1),
        ),
    ]
    db = _CommDB(
        scalar_queue=[activity],
        execute_queue=[_RowsResult(acks)],
    )
    out = await comm_router.get_acknowledgements(
        entity_type="activity", entity_id=5, current_user=user, db=db,
    )
    assert len(out) == 1
    assert out[0].action == "seen"


# ── get_communication_history ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_history_self_access_returns_rows():
    user = _athlete(10)
    acks = [
        CommunicationAcknowledgement(
            id=1, entity_type="activity", entity_id=5, athlete_id=10,
            actor_id=10, action="seen", note="n",
            created_at=datetime(2026, 1, 1),
        ),
    ]
    db = _CommDB(execute_queue=[_RowsResult(acks)])
    out = await comm_router.get_communication_history(
        athlete_id=10, limit=50, current_user=user, db=db,
    )
    assert len(out) == 1


@pytest.mark.asyncio
async def test_history_athlete_querying_others_blocked():
    user = _athlete(10)
    db = _CommDB()
    with pytest.raises(HTTPException) as exc:
        await comm_router.get_communication_history(
            athlete_id=99, limit=50, current_user=user, db=db,
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_history_coach_no_shared_org_blocked(monkeypatch):
    coach = _coach(1)

    async def _no_orgs(*_a, **_kw):
        return set()
    monkeypatch.setattr(comm_router, "get_shared_org_ids", _no_orgs)

    db = _CommDB()
    with pytest.raises(HTTPException) as exc:
        await comm_router.get_communication_history(
            athlete_id=10, limit=50, current_user=coach, db=db,
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_history_coach_with_shared_org(monkeypatch):
    coach = _coach(1)

    async def _has_orgs(*_a, **_kw):
        return {7}
    monkeypatch.setattr(comm_router, "get_shared_org_ids", _has_orgs)

    db = _CommDB(execute_queue=[_RowsResult([])])
    out = await comm_router.get_communication_history(
        athlete_id=10, limit=50, current_user=coach, db=db,
    )
    assert out == []
