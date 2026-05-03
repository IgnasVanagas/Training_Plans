"""Endpoint-handler tests for app.routers.communications focused on chats."""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.models import (
    OrganizationCoachMessage,
    OrganizationGroupMessage,
    OrganizationMember,
    Profile,
    RoleEnum,
    User,
)
from app.routers import communications as comm


class _Result:
    def __init__(self, rows=None, scalars_list=None):
        self._rows = list(rows or [])
        self._scalars_list = list(scalars_list) if scalars_list is not None else None

    def all(self):
        if self._scalars_list is not None:
            return list(self._scalars_list)
        return list(self._rows)

    def scalars(self):
        return self


class _DB:
    def __init__(self, *, execute_results=None, scalar_results=None):
        self.execute_results = list(execute_results or [])
        self.scalar_results = list(scalar_results or [])
        self.added = []
        self.commits = 0

    async def execute(self, stmt):
        return self.execute_results.pop(0) if self.execute_results else _Result()

    async def scalar(self, stmt):
        return self.scalar_results.pop(0) if self.scalar_results else None

    def add(self, obj):
        self.added.append(obj)
        if hasattr(obj, "id") and obj.id is None:
            obj.id = 555
        if hasattr(obj, "created_at") and obj.created_at is None:
            obj.created_at = datetime(2024, 1, 1)

    async def commit(self):
        self.commits += 1

    async def refresh(self, obj):
        pass


def _athlete(uid=1) -> User:
    u = User(id=uid, email=f"a{uid}@x.y", password_hash="h",
             role=RoleEnum.athlete, email_verified=True)
    return u


def _coach(uid=99) -> User:
    u = User(id=uid, email=f"c{uid}@x.y", password_hash="h",
             role=RoleEnum.coach, email_verified=True)
    return u


# ── _require_active_org_membership ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_require_active_org_membership_403_when_missing():
    db = _DB(scalar_results=[None])
    with pytest.raises(HTTPException) as exc:
        await comm._require_active_org_membership(db, user_id=1, organization_id=1)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_require_active_org_membership_returns_member():
    member = OrganizationMember(user_id=1, organization_id=1,
                                role=RoleEnum.athlete.value, status="active")
    db = _DB(scalar_results=[member])
    out = await comm._require_active_org_membership(
        db, user_id=1, organization_id=1, role=RoleEnum.athlete.value,
    )
    assert out is member


# ── _sender_display_name ────────────────────────────────────────────────────


def test_sender_display_name_full_name():
    u = User(id=1, email="x@y.z", password_hash="h",
             role=RoleEnum.athlete, email_verified=True)
    p = Profile(user_id=1, first_name="John", last_name="Doe")
    assert comm._sender_display_name(u, p) == "John Doe"


def test_sender_display_name_first_only():
    u = User(id=1, email="x@y.z", password_hash="h",
             role=RoleEnum.athlete, email_verified=True)
    p = Profile(user_id=1, first_name="Jane", last_name=None)
    assert comm._sender_display_name(u, p) == "Jane"


def test_sender_display_name_falls_back_to_email():
    u = User(id=1, email="x@y.z", password_hash="h",
             role=RoleEnum.athlete, email_verified=True)
    p = Profile(user_id=1)
    assert comm._sender_display_name(u, p) == "x@y.z"


def test_sender_display_name_no_profile():
    u = User(id=1, email="x@y.z", password_hash="h",
             role=RoleEnum.athlete, email_verified=True)
    assert comm._sender_display_name(u, None) == "x@y.z"


# ── _normalize_entity_type ──────────────────────────────────────────────────


def test_normalize_entity_type_activity():
    assert comm._normalize_entity_type("activity") == "activity"


def test_normalize_entity_type_workout_uppercase():
    assert comm._normalize_entity_type("Workout") == "workout"


def test_normalize_entity_type_invalid():
    with pytest.raises(HTTPException) as exc:
        comm._normalize_entity_type("bogus")
    assert exc.value.status_code == 400


# ── list_organization_group_messages ────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_org_group_messages_unauthorized(monkeypatch):
    monkeypatch.setattr(comm, "_require_active_org_membership",
                        AsyncMock(side_effect=HTTPException(status_code=403, detail="x")))
    with pytest.raises(HTTPException) as exc:
        await comm.list_organization_group_messages(
            organization_id=1, limit=10, current_user=_athlete(), db=_DB()
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_list_org_group_messages_returns_in_chronological(monkeypatch):
    monkeypatch.setattr(comm, "_require_active_org_membership",
                        AsyncMock(return_value=None))
    sender = _athlete(2)
    profile = Profile(user_id=2, first_name="A", last_name="B")
    msg1 = OrganizationGroupMessage(id=1, organization_id=1, sender_id=2,
                                    body="hi", attachment_url=None,
                                    attachment_name=None,
                                    created_at=datetime(2024, 1, 1))
    msg2 = OrganizationGroupMessage(id=2, organization_id=1, sender_id=2,
                                    body="hello", attachment_url=None,
                                    attachment_name=None,
                                    created_at=datetime(2024, 1, 2))
    db = _DB(execute_results=[
        _Result(rows=[(msg2, sender, profile), (msg1, sender, profile)]),
    ])
    out = await comm.list_organization_group_messages(
        organization_id=1, limit=10, current_user=_athlete(), db=db
    )
    assert [m.id for m in out] == [1, 2]


# ── post_organization_group_message ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_post_org_group_empty_body_400(monkeypatch):
    monkeypatch.setattr(comm, "_require_active_org_membership",
                        AsyncMock(return_value=None))
    payload = SimpleNamespace(body="   ", attachment_url=None, attachment_name=None)
    with pytest.raises(HTTPException) as exc:
        await comm.post_organization_group_message(
            organization_id=1, payload=payload,
            current_user=_athlete(), db=_DB()
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_post_org_group_creates_message(monkeypatch):
    monkeypatch.setattr(comm, "_require_active_org_membership",
                        AsyncMock(return_value=None))
    payload = SimpleNamespace(body="hello", attachment_url=None, attachment_name=None)
    db = _DB(scalar_results=[None])  # profile lookup
    out = await comm.post_organization_group_message(
        organization_id=1, payload=payload,
        current_user=_athlete(uid=2), db=db
    )
    assert out.body == "hello"
    assert any(isinstance(o, OrganizationGroupMessage) for o in db.added)


# ── post_organization_coach_chat_message ────────────────────────────────────


@pytest.mark.asyncio
async def test_post_coach_chat_empty_400():
    payload = SimpleNamespace(body="  ", attachment_url=None, attachment_name=None)
    with pytest.raises(HTTPException) as exc:
        await comm.post_organization_coach_chat_message(
            organization_id=1, payload=payload, coach_id=1, athlete_id=None,
            current_user=_athlete(), db=_DB()
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_post_coach_chat_athlete_missing_coach_id_400(monkeypatch):
    monkeypatch.setattr(comm, "_require_active_org_membership",
                        AsyncMock(return_value=None))
    payload = SimpleNamespace(body="hello", attachment_url=None, attachment_name=None)
    with pytest.raises(HTTPException) as exc:
        await comm.post_organization_coach_chat_message(
            organization_id=1, payload=payload, coach_id=None, athlete_id=None,
            current_user=_athlete(), db=_DB()
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_post_coach_chat_coach_missing_athlete_id_400(monkeypatch):
    monkeypatch.setattr(comm, "_require_active_org_membership",
                        AsyncMock(return_value=None))
    payload = SimpleNamespace(body="hello", attachment_url=None, attachment_name=None)
    with pytest.raises(HTTPException) as exc:
        await comm.post_organization_coach_chat_message(
            organization_id=1, payload=payload, coach_id=None, athlete_id=None,
            current_user=_coach(), db=_DB()
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_post_coach_chat_other_role_403(monkeypatch):
    user = User(id=5, email="x@y.z", password_hash="h",
                role=RoleEnum.admin, email_verified=True)
    payload = SimpleNamespace(body="hi", attachment_url=None, attachment_name=None)
    with pytest.raises(HTTPException) as exc:
        await comm.post_organization_coach_chat_message(
            organization_id=1, payload=payload, coach_id=None, athlete_id=None,
            current_user=user, db=_DB()
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_post_coach_chat_athlete_creates(monkeypatch):
    monkeypatch.setattr(comm, "_require_active_org_membership",
                        AsyncMock(return_value=None))
    payload = SimpleNamespace(body="hi", attachment_url=None, attachment_name=None)
    db = _DB(scalar_results=[None])
    out = await comm.post_organization_coach_chat_message(
        organization_id=1, payload=payload, coach_id=99, athlete_id=None,
        current_user=_athlete(uid=2), db=db
    )
    assert out.athlete_id == 2
    assert out.coach_id == 99


@pytest.mark.asyncio
async def test_post_coach_chat_coach_creates(monkeypatch):
    monkeypatch.setattr(comm, "_require_active_org_membership",
                        AsyncMock(return_value=None))
    payload = SimpleNamespace(body="hi", attachment_url=None, attachment_name=None)
    db = _DB(scalar_results=[None])
    out = await comm.post_organization_coach_chat_message(
        organization_id=1, payload=payload, coach_id=None, athlete_id=2,
        current_user=_coach(uid=99), db=db
    )
    assert out.coach_id == 99
    assert out.athlete_id == 2

# ?? get_organization_inbox ??????????????????????????????????????????????????


@pytest.mark.asyncio
async def test_get_organization_inbox_athlete(monkeypatch):
    user = _athlete(1)
    member = OrganizationMember(user_id=1, organization_id=1,
                                role=RoleEnum.athlete.value, status="active")
    monkeypatch.setattr(comm, "_require_active_org_membership",
                        AsyncMock(return_value=member))

    coach_user = User(id=2, email="c@x.y", password_hash="h",
                      role=RoleEnum.coach, email_verified=True)
    coach_profile = Profile(user_id=2, first_name="Coach", last_name="One")
    coach_member = OrganizationMember(user_id=2, organization_id=1,
                                      role=RoleEnum.coach.value, status="active")

    member_rows = _Result(rows=[(coach_user, coach_profile, coach_member)])

    class _Scalar:
        def scalar_one_or_none(self):
            return None

    db = _DB(execute_results=[
        member_rows,
        _Scalar(),         # group_row
        _Result(rows=[]),  # latest_coach_rows
        _Result(rows=[]),  # latest_direct_rows
    ])
    out = await comm.get_organization_inbox(
        organization_id=1, current_user=user, db=db,
    )
    assert any(t.thread_type == "group" for t in out.items)
    assert any(t.thread_type == "coach" for t in out.items)


@pytest.mark.asyncio
async def test_get_organization_inbox_coach(monkeypatch):
    coach = _coach(99)
    member = OrganizationMember(user_id=99, organization_id=1,
                                role=RoleEnum.coach.value, status="active")
    monkeypatch.setattr(comm, "_require_active_org_membership",
                        AsyncMock(return_value=member))

    athlete_user = User(id=2, email="a@x.y", password_hash="h",
                        role=RoleEnum.athlete, email_verified=True)
    athlete_profile = Profile(user_id=2, first_name="Ath", last_name="Lete")
    athlete_member = OrganizationMember(user_id=2, organization_id=1,
                                        role=RoleEnum.athlete.value, status="active")

    member_rows = _Result(rows=[(athlete_user, athlete_profile, athlete_member)])

    class _Scalar:
        def scalar_one_or_none(self):
            return None

    db = _DB(execute_results=[
        member_rows,
        _Scalar(),
        _Result(rows=[]),
        _Result(rows=[]),
    ])
    out = await comm.get_organization_inbox(
        organization_id=1, current_user=coach, db=db,
    )
    assert any(t.thread_type == "coach" for t in out.items)


# ?? get_notifications_feed ??????????????????????????????????????????????????


@pytest.mark.asyncio
async def test_get_notifications_feed_athlete_empty():
    user = _athlete(1)
    user.organization_memberships = []
    db = _DB(execute_results=[
        _Result(scalars_list=[]),  # upcoming_workouts
        _Result(rows=[]),          # coach_comments
        _Result(scalars_list=[]),  # acknowledgements
    ])
    out = await comm.get_notifications_feed(
        limit=10, current_user=user, db=db,
    )
    assert out.items == []


@pytest.mark.asyncio
async def test_get_notifications_feed_coach_empty():
    coach = _coach(99)
    db = _DB(execute_results=[
        _Result(scalars_list=[]),  # coach_org_ids
        _Result(scalars_list=[]),  # acknowledgements
    ])
    out = await comm.get_notifications_feed(
        limit=10, current_user=coach, db=db,
    )
    assert out.items == []

# ?? get_organization_inbox ??????????????????????????????????????????????????


@pytest.mark.asyncio
async def test_get_organization_inbox_athlete(monkeypatch):
    user = _athlete(1)
    member = OrganizationMember(user_id=1, organization_id=1,
                                role=RoleEnum.athlete.value, status="active")
    monkeypatch.setattr(comm, "_require_active_org_membership",
                        AsyncMock(return_value=member))

    coach_user = User(id=2, email="c@x.y", password_hash="h",
                      role=RoleEnum.coach, email_verified=True)
    coach_profile = Profile(user_id=2, first_name="Coach", last_name="One")
    coach_member = OrganizationMember(user_id=2, organization_id=1,
                                      role=RoleEnum.coach.value, status="active")

    member_rows = _Result(rows=[(coach_user, coach_profile, coach_member)])

    class _Scalar:
        def scalar_one_or_none(self):
            return None

    db = _DB(execute_results=[
        member_rows,
        _Scalar(),         # group_row
        _Result(rows=[]),  # latest_coach_rows
        _Result(rows=[]),  # latest_direct_rows
    ])
    out = await comm.get_organization_inbox(
        organization_id=1, current_user=user, db=db,
    )
    assert any(t.thread_type == "group" for t in out.items)
    assert any(t.thread_type == "coach" for t in out.items)


@pytest.mark.asyncio
async def test_get_organization_inbox_coach(monkeypatch):
    coach = _coach(99)
    member = OrganizationMember(user_id=99, organization_id=1,
                                role=RoleEnum.coach.value, status="active")
    monkeypatch.setattr(comm, "_require_active_org_membership",
                        AsyncMock(return_value=member))

    athlete_user = User(id=2, email="a@x.y", password_hash="h",
                        role=RoleEnum.athlete, email_verified=True)
    athlete_profile = Profile(user_id=2, first_name="Ath", last_name="Lete")
    athlete_member = OrganizationMember(user_id=2, organization_id=1,
                                        role=RoleEnum.athlete.value, status="active")

    member_rows = _Result(rows=[(athlete_user, athlete_profile, athlete_member)])

    class _Scalar:
        def scalar_one_or_none(self):
            return None

    db = _DB(execute_results=[
        member_rows,
        _Scalar(),
        _Result(rows=[]),
        _Result(rows=[]),
    ])
    out = await comm.get_organization_inbox(
        organization_id=1, current_user=coach, db=db,
    )
    assert any(t.thread_type == "coach" for t in out.items)


# ?? get_notifications_feed ??????????????????????????????????????????????????


@pytest.mark.asyncio
async def test_get_notifications_feed_athlete_empty():
    user = _athlete(1)
    user.organization_memberships = []
    db = _DB(execute_results=[
        _Result(scalars_list=[]),  # upcoming_workouts
        _Result(rows=[]),          # coach_comments
        _Result(scalars_list=[]),  # acknowledgements
    ])
    out = await comm.get_notifications_feed(
        limit=10, current_user=user, db=db,
    )
    assert out.items == []


@pytest.mark.asyncio
async def test_get_notifications_feed_coach_empty():
    coach = _coach(99)
    db = _DB(execute_results=[
        _Result(scalars_list=[]),  # coach_org_ids
        _Result(scalars_list=[]),  # acknowledgements
    ])
    out = await comm.get_notifications_feed(
        limit=10, current_user=coach, db=db,
    )
    assert out.items == []
