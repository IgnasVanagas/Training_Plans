"""Endpoint-handler tests for app.routers.users.

Direct calls to async route functions with hand-rolled mock DB. Targets
permission/role guards, validation paths, and happy paths to gain
endpoint-level coverage without TestClient.
"""

from __future__ import annotations

from datetime import date as dt_date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.models import OrganizationMember, Profile, RoleEnum, User
from app.routers import users as users_router

def _Org(**kwargs):
    return SimpleNamespace(**kwargs)


class _Result:
    def __init__(self, rows=None, scalars_list=None, scalar_one=None):
        self._rows = list(rows or [])
        self._scalars_list = list(scalars_list) if scalars_list is not None else None
        self._scalar_one = scalar_one

    def all(self):
        if self._scalars_list is not None:
            return list(self._scalars_list)
        return list(self._rows)

    def scalars(self):
        return self

    def first(self):
        if self._scalars_list:
            return self._scalars_list[0]
        if self._rows:
            return self._rows[0]
        return None

    def scalar_one_or_none(self):
        if self._scalar_one is not None:
            return self._scalar_one
        if self._scalars_list:
            return self._scalars_list[0]
        return None

    def scalar_one(self):
        return self._scalar_one

    def __iter__(self):
        return iter(self._scalars_list if self._scalars_list is not None else self._rows)


class _DB:
    def __init__(self, *, execute_results=None, scalar_results=None):
        self.execute_results = list(execute_results or [])
        self.scalar_results = list(scalar_results or [])
        self.added = []
        self.commits = 0
        self.refreshed = []

    async def execute(self, stmt):
        if self.execute_results:
            return self.execute_results.pop(0)
        return _Result()

    async def scalar(self, stmt):
        if self.scalar_results:
            return self.scalar_results.pop(0)
        return None

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commits += 1

    async def refresh(self, obj):
        self.refreshed.append(obj)

    async def delete(self, obj):
        if not hasattr(self, 'deleted'):
            self.deleted = []
        self.deleted.append(obj)


def _athlete_user(uid=1, email="a@b.c") -> User:
    u = User(id=uid, email=email, password_hash="h", role=RoleEnum.athlete,
             email_verified=True)
    u.profile = Profile(user_id=uid, first_name="A", last_name="B")
    u.organization_memberships = []
    return u


def _coach_user(uid=99, email="coach@b.c") -> User:
    u = User(id=uid, email=email, password_hash="h", role=RoleEnum.coach,
             email_verified=True)
    u.profile = Profile(user_id=uid)
    u.organization_memberships = [
        OrganizationMember(user_id=uid, organization_id=1,
                           role=RoleEnum.coach.value, status="active"),
    ]
    return u


# ── get_athletes (lines 324-364) ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_athletes_forbidden_for_athlete():
    user = _athlete_user()
    db = _DB()
    with pytest.raises(HTTPException) as exc:
        await users_router.get_athletes(current_user=user, db=db)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_get_athletes_returns_empty_when_no_orgs():
    user = _coach_user()
    user.organization_memberships = []
    db = _DB()
    out = await users_router.get_athletes(current_user=user, db=db)
    assert out == []


@pytest.mark.asyncio
async def test_get_athletes_returns_list_for_coach(monkeypatch):
    coach = _coach_user()
    athlete = _athlete_user(uid=2)

    async def _no_op(*a, **k):
        return None

    monkeypatch.setattr(users_router, "_annotate_athletes_with_upcoming_workout_status", _no_op)
    db = _DB(execute_results=[_Result(scalars_list=[athlete])])
    out = await users_router.get_athletes(current_user=coach, db=db)
    assert len(out) == 1


# ── get_pending_athletes (line 622-660) ─────────────────────────────────────


@pytest.mark.asyncio
async def test_get_pending_athletes_forbidden_for_athlete():
    with pytest.raises(HTTPException) as exc:
        await users_router.get_pending_athletes(current_user=_athlete_user(), db=_DB())
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_get_pending_athletes_empty_when_no_orgs():
    coach = _coach_user()
    coach.organization_memberships = []
    out = await users_router.get_pending_athletes(current_user=coach, db=_DB())
    assert out == []


@pytest.mark.asyncio
async def test_get_pending_athletes_dedupes_and_attaches_message():
    coach = _coach_user()
    athlete = _athlete_user(uid=2)

    class _ResultRows:
        def __init__(self, rows):
            self._rows = list(rows)

        def all(self):
            return list(self._rows)

    db = _DB(execute_results=[
        _ResultRows([(athlete, "wants to join"), (athlete, "again")]),
    ])
    out = await users_router.get_pending_athletes(current_user=coach, db=db)
    assert len(out) == 1
    assert out[0].pending_message == "wants to join"


# ── approve_athlete / reject_athlete (lines 663-720) ────────────────────────


@pytest.mark.asyncio
async def test_approve_athlete_forbidden_for_athlete():
    with pytest.raises(HTTPException) as exc:
        await users_router.approve_athlete(athlete_id=2, current_user=_athlete_user(), db=_DB())
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_approve_athlete_no_orgs_raises_400():
    coach = _coach_user()
    coach.organization_memberships = []
    with pytest.raises(HTTPException) as exc:
        await users_router.approve_athlete(athlete_id=2, current_user=coach, db=_DB())
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_approve_athlete_404_when_no_membership():
    coach = _coach_user()
    db = _DB(scalar_results=[None])
    with pytest.raises(HTTPException) as exc:
        await users_router.approve_athlete(athlete_id=2, current_user=coach, db=db)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_approve_athlete_happy_path():
    coach = _coach_user()
    member = OrganizationMember(user_id=2, organization_id=1,
                                role=RoleEnum.athlete.value, status="pending")
    db = _DB(scalar_results=[member])
    out = await users_router.approve_athlete(athlete_id=2, current_user=coach, db=db)
    assert out == {"message": "Athlete approved"}
    assert member.status == "active"
    assert db.commits == 1


@pytest.mark.asyncio
async def test_reject_athlete_forbidden_for_athlete():
    with pytest.raises(HTTPException) as exc:
        await users_router.reject_athlete(athlete_id=2, current_user=_athlete_user(), db=_DB())
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_reject_athlete_404_when_no_membership():
    coach = _coach_user()
    db = _DB(scalar_results=[None])
    with pytest.raises(HTTPException) as exc:
        await users_router.reject_athlete(athlete_id=2, current_user=coach, db=db)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_reject_athlete_happy_path():
    coach = _coach_user()
    member = OrganizationMember(user_id=2, organization_id=1,
                                role=RoleEnum.athlete.value, status="pending")
    db = _DB(scalar_results=[member])
    await users_router.reject_athlete(athlete_id=2, current_user=coach, db=db)
    assert member.status == "rejected"


# ── get_athlete_details ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_athlete_details_forbidden_for_athlete():
    with pytest.raises(HTTPException) as exc:
        await users_router.get_athlete_details(athlete_id=2, current_user=_athlete_user(), db=_DB())
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_get_athlete_details_404_when_not_in_orgs():
    coach = _coach_user()
    db = _DB(scalar_results=[None])
    with pytest.raises(HTTPException) as exc:
        await users_router.get_athlete_details(athlete_id=2, current_user=coach, db=db)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_get_athlete_details_happy_path(monkeypatch):
    coach = _coach_user()
    athlete = _athlete_user(uid=2)

    async def _no_op(*a, **k):
        return None

    monkeypatch.setattr(users_router, "_annotate_athletes_with_upcoming_workout_status", _no_op)
    db = _DB(scalar_results=[athlete])
    out = await users_router.get_athlete_details(athlete_id=2, current_user=coach, db=db)
    assert out is athlete


# ── change_password ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_change_password_wrong_current(monkeypatch):
    user = _athlete_user()
    monkeypatch.setattr(users_router, "verify_password", lambda *a, **k: False)
    payload = SimpleNamespace(current_password="x", new_password="y")
    with pytest.raises(HTTPException) as exc:
        await users_router.change_password(payload=payload, current_user=user, db=_DB())
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_change_password_same_as_current(monkeypatch):
    user = _athlete_user()
    monkeypatch.setattr(users_router, "verify_password", lambda *a, **k: True)
    payload = SimpleNamespace(current_password="x", new_password="x")
    with pytest.raises(HTTPException) as exc:
        await users_router.change_password(payload=payload, current_user=user, db=_DB())
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_change_password_happy_path(monkeypatch):
    user = _athlete_user()
    user.password_hash = "old"
    seq = iter([True, False])  # current matches; new differs
    monkeypatch.setattr(users_router, "verify_password", lambda *a, **k: next(seq))
    monkeypatch.setattr(users_router, "get_password_hash", lambda v: f"hashed-{v}")

    db = _DB()
    payload = SimpleNamespace(current_password="old", new_password="new")
    out = await users_router.change_password(payload=payload, current_user=user, db=db)
    assert out == {"message": "Password updated"}
    assert user.password_hash == "hashed-new"
    assert db.commits == 1


# ── get_athlete_permissions_endpoint ────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_athlete_permissions_coach_forbidden_when_not_shared(monkeypatch):
    coach = _coach_user()
    monkeypatch.setattr(users_router, "get_shared_org_ids",
                        AsyncMock(return_value=[]))
    with pytest.raises(HTTPException) as exc:
        await users_router.get_athlete_permissions_endpoint(
            athlete_id=42, current_user=coach, db=_DB()
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_get_athlete_permissions_coach_for_self_skips_shared_check(monkeypatch):
    coach = _coach_user()
    monkeypatch.setattr(users_router, "get_shared_org_ids",
                        AsyncMock(return_value=[]))
    monkeypatch.setattr(users_router, "get_athlete_permissions",
                        AsyncMock(return_value={}))
    out = await users_router.get_athlete_permissions_endpoint(
        athlete_id=coach.id, current_user=coach, db=_DB()
    )
    assert out.athlete_id == coach.id

# ?? create_invite ???????????????????????????????????????????????????????????


@pytest.mark.asyncio
async def test_create_invite_forbidden_for_athlete():
    with pytest.raises(HTTPException) as exc:
        await users_router.create_invite(current_user=_athlete_user(), db=_DB())
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_create_invite_no_orgs():
    coach = _coach_user()
    coach.organization_memberships = []
    with pytest.raises(HTTPException) as exc:
        await users_router.create_invite(current_user=coach, db=_DB())
    assert exc.value.status_code == 400


class _ScalarOneResult:
    def __init__(self, value):
        self._value = value

    def scalar_one(self):
        return self._value

    def scalars(self):
        return SimpleNamespace(all=lambda: [self._value])


@pytest.mark.asyncio
async def test_create_invite_generates_code_when_missing(monkeypatch):
    coach = _coach_user()
    from app.models import Organization
    org = _Org(id=1, name="Org", code=None)
    db = _DB(execute_results=[_ScalarOneResult(org)])
    monkeypatch.setenv("FRONTEND_BASE_URL", "https://example.com")
    out = await users_router.create_invite(current_user=coach, db=db)
    assert org.code is not None
    assert out.invite_url.startswith("https://example.com/invite/")


@pytest.mark.asyncio
async def test_create_invite_uses_existing_code():
    coach = _coach_user()
    from app.models import Organization
    org = _Org(id=1, name="Org", code="ABC123")
    db = _DB(execute_results=[_ScalarOneResult(org)])
    out = await users_router.create_invite(current_user=coach, db=db)
    assert out.invite_token == "ABC123"


# ?? invite_existing_athlete_by_email ????????????????????????????????????????


@pytest.mark.asyncio
async def test_invite_by_email_forbidden_for_athlete():
    payload = SimpleNamespace(email="x@y.z", message=None)
    with pytest.raises(HTTPException) as exc:
        await users_router.invite_existing_athlete_by_email(
            payload=payload, current_user=_athlete_user(), db=_DB()
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_invite_by_email_no_org():
    coach = _coach_user()
    coach.organization_memberships = []
    payload = SimpleNamespace(email="x@y.z", message=None)
    with pytest.raises(HTTPException) as exc:
        await users_router.invite_existing_athlete_by_email(
            payload=payload, current_user=coach, db=_DB()
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_invite_by_email_org_not_found():
    coach = _coach_user()
    db = _DB(scalar_results=[None])
    payload = SimpleNamespace(email="x@y.z", message=None)
    with pytest.raises(HTTPException) as exc:
        await users_router.invite_existing_athlete_by_email(
            payload=payload, current_user=coach, db=db
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_invite_by_email_returns_not_found_when_user_missing():
    coach = _coach_user()
    from app.models import Organization
    org = _Org(id=1, name="Org", code="ABC")
    db = _DB(scalar_results=[org, None])  # org found, user not found
    payload = SimpleNamespace(email="x@y.z", message=None)
    out = await users_router.invite_existing_athlete_by_email(
        payload=payload, current_user=coach, db=db
    )
    assert out.status == "not_found"
    assert out.existing_user is False


@pytest.mark.asyncio
async def test_invite_by_email_self_raises_400():
    coach = _coach_user()
    from app.models import Organization
    org = _Org(id=1, name="Org", code="ABC")
    db = _DB(scalar_results=[org, coach])
    payload = SimpleNamespace(email="coach@b.c", message=None)
    with pytest.raises(HTTPException) as exc:
        await users_router.invite_existing_athlete_by_email(
            payload=payload, current_user=coach, db=db
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_invite_by_email_already_active():
    coach = _coach_user()
    target = _athlete_user(uid=2)
    from app.models import Organization
    org = _Org(id=1, name="Org", code="ABC")
    member = OrganizationMember(user_id=2, organization_id=1, role=RoleEnum.athlete.value, status="active")
    db = _DB(scalar_results=[org, target, member])
    payload = SimpleNamespace(email="a@b.c", message=None)
    out = await users_router.invite_existing_athlete_by_email(
        payload=payload, current_user=coach, db=db
    )
    assert out.status == "already_active"


@pytest.mark.asyncio
async def test_invite_by_email_re_pending_existing_member():
    coach = _coach_user()
    target = _athlete_user(uid=2)
    from app.models import Organization
    org = _Org(id=1, name="Org", code="ABC")
    member = OrganizationMember(user_id=2, organization_id=1, role=RoleEnum.athlete.value, status="rejected")
    db = _DB(scalar_results=[org, target, member])
    payload = SimpleNamespace(email="a@b.c", message="please")
    out = await users_router.invite_existing_athlete_by_email(
        payload=payload, current_user=coach, db=db
    )
    assert out.status == "pending"
    assert member.status == "pending"
    assert member.message == "please"


@pytest.mark.asyncio
async def test_invite_by_email_creates_new_member():
    coach = _coach_user()
    target = _athlete_user(uid=2)
    from app.models import Organization
    org = _Org(id=1, name="Org", code="ABC")
    db = _DB(scalar_results=[org, target, None])
    payload = SimpleNamespace(email="a@b.c", message="hi")
    out = await users_router.invite_existing_athlete_by_email(
        payload=payload, current_user=coach, db=db
    )
    assert out.status == "pending"
    assert any(isinstance(o, OrganizationMember) for o in db.added)


# ?? respond_to_organization_invitation ??????????????????????????????????????


@pytest.mark.asyncio
async def test_respond_to_invitation_404_when_no_membership():
    db = _DB(scalar_results=[None])
    payload = SimpleNamespace(action="accept", athlete_data_sharing_consent=True,
                              athlete_data_sharing_consent_version="v1")
    with pytest.raises(HTTPException) as exc:
        await users_router.respond_to_organization_invitation(
            organization_id=1, payload=payload, current_user=_athlete_user(), db=db
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_respond_accept_requires_consent_for_athlete():
    user = _athlete_user()
    member = OrganizationMember(user_id=1, organization_id=1, role=RoleEnum.athlete.value, status="pending")
    db = _DB(scalar_results=[member])
    payload = SimpleNamespace(action="accept", athlete_data_sharing_consent=False,
                              athlete_data_sharing_consent_version=None)
    with pytest.raises(HTTPException) as exc:
        await users_router.respond_to_organization_invitation(
            organization_id=1, payload=payload, current_user=user, db=db
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_respond_accept_already_active_returns_message():
    user = _athlete_user()
    member = OrganizationMember(user_id=1, organization_id=1, role=RoleEnum.athlete.value, status="active")
    db = _DB(scalar_results=[member])
    payload = SimpleNamespace(action="accept", athlete_data_sharing_consent=True,
                              athlete_data_sharing_consent_version="v1")
    out = await users_router.respond_to_organization_invitation(
        organization_id=1, payload=payload, current_user=user, db=db
    )
    assert out["status"] == "active"


@pytest.mark.asyncio
async def test_respond_accept_activates_membership(monkeypatch):
    user = _athlete_user()
    member = OrganizationMember(user_id=1, organization_id=1, role=RoleEnum.athlete.value, status="pending")
    db = _DB(scalar_results=[member])
    monkeypatch.setattr(users_router, "_apply_athlete_data_sharing_consent", lambda *a, **k: None)
    payload = SimpleNamespace(action="accept", athlete_data_sharing_consent=True,
                              athlete_data_sharing_consent_version="v1")
    out = await users_router.respond_to_organization_invitation(
        organization_id=1, payload=payload, current_user=user, db=db
    )
    assert member.status == "active"
    assert out["status"] == "active"


@pytest.mark.asyncio
async def test_respond_decline_active_raises_400():
    user = _athlete_user()
    member = OrganizationMember(user_id=1, organization_id=1, role=RoleEnum.athlete.value, status="active")
    db = _DB(scalar_results=[member])
    payload = SimpleNamespace(action="decline", athlete_data_sharing_consent=False,
                              athlete_data_sharing_consent_version=None)
    with pytest.raises(HTTPException) as exc:
        await users_router.respond_to_organization_invitation(
            organization_id=1, payload=payload, current_user=user, db=db
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_respond_decline_pending_marks_rejected():
    user = _athlete_user()
    member = OrganizationMember(user_id=1, organization_id=1, role=RoleEnum.athlete.value, status="pending")
    db = _DB(scalar_results=[member])
    payload = SimpleNamespace(action="decline", athlete_data_sharing_consent=False,
                              athlete_data_sharing_consent_version=None)
    out = await users_router.respond_to_organization_invitation(
        organization_id=1, payload=payload, current_user=user, db=db
    )
    assert member.status == "rejected"
    assert out["status"] == "rejected"


# ?? request_join_organization ???????????????????????????????????????????????


@pytest.mark.asyncio
async def test_request_join_forbidden_for_coach():
    payload = SimpleNamespace(organization_id=1, message=None,
                              athlete_data_sharing_consent=True,
                              athlete_data_sharing_consent_version="v1")
    with pytest.raises(HTTPException) as exc:
        await users_router.request_join_organization(
            payload=payload, current_user=_coach_user(), db=_DB()
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_request_join_requires_consent():
    payload = SimpleNamespace(organization_id=1, message=None,
                              athlete_data_sharing_consent=False,
                              athlete_data_sharing_consent_version=None)
    with pytest.raises(HTTPException) as exc:
        await users_router.request_join_organization(
            payload=payload, current_user=_athlete_user(), db=_DB()
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_request_join_org_not_found():
    payload = SimpleNamespace(organization_id=99, message=None,
                              athlete_data_sharing_consent=True,
                              athlete_data_sharing_consent_version="v1")
    db = _DB(scalar_results=[None])
    with pytest.raises(HTTPException) as exc:
        await users_router.request_join_organization(
            payload=payload, current_user=_athlete_user(), db=db
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_request_join_existing_active_returns_active():
    user = _athlete_user()
    from app.models import Organization
    org = _Org(id=1, name="O")
    member = OrganizationMember(user_id=1, organization_id=1,
                                role=RoleEnum.athlete.value, status="active")
    db = _DB(scalar_results=[org, member])
    payload = SimpleNamespace(organization_id=1, message=None,
                              athlete_data_sharing_consent=True,
                              athlete_data_sharing_consent_version="v1")
    out = await users_router.request_join_organization(
        payload=payload, current_user=user, db=db
    )
    assert out["status"] == "active"


@pytest.mark.asyncio
async def test_request_join_existing_role_mismatch_400():
    user = _athlete_user()
    from app.models import Organization
    org = _Org(id=1, name="O")
    member = OrganizationMember(user_id=1, organization_id=1,
                                role=RoleEnum.coach.value, status="pending")
    db = _DB(scalar_results=[org, member])
    payload = SimpleNamespace(organization_id=1, message=None,
                              athlete_data_sharing_consent=True,
                              athlete_data_sharing_consent_version="v1")
    with pytest.raises(HTTPException) as exc:
        await users_router.request_join_organization(
            payload=payload, current_user=user, db=db
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_request_join_creates_new_membership(monkeypatch):
    user = _athlete_user()
    from app.models import Organization
    org = _Org(id=1, name="O")
    monkeypatch.setattr(users_router, "_default_athlete_data_sharing_consent_version",
                        lambda: "v1")
    db = _DB(scalar_results=[org, None])
    payload = SimpleNamespace(organization_id=1, message="hi",
                              athlete_data_sharing_consent=True,
                              athlete_data_sharing_consent_version="v1")
    out = await users_router.request_join_organization(
        payload=payload, current_user=user, db=db
    )
    assert out["status"] == "pending_approval"
    assert any(isinstance(o, OrganizationMember) for o in db.added)


# ?? discover_organizations ??????????????????????????????????????????????????


@pytest.mark.asyncio
async def test_discover_organizations_empty():
    db = _DB(execute_results=[_Result(scalars_list=[])])
    out = await users_router.discover_organizations(
        query=None, current_user=_athlete_user(), db=db
    )
    assert out.items == []


@pytest.mark.asyncio
async def test_discover_organizations_with_query_and_results():
    from app.models import Organization
    orgs = [
        Organization(id=1, name="One", description=None, picture=None),
        Organization(id=2, name="Two", description=None, picture=None),
    ]
    db = _DB(execute_results=[
        _Result(scalars_list=orgs),         # orgs query
        _Result(rows=[(1, 5), (2, 0)]),     # member counts
        _Result(rows=[(1, "active")]),      # my memberships
        _Result(rows=[(1, 99, "c@e.x", "Coach", "One")]),  # coach rows
    ])
    out = await users_router.discover_organizations(
        query="search", current_user=_athlete_user(), db=db
    )
    assert len(out.items) == 2
    by_id = {item.id: item for item in out.items}
    assert by_id[1].member_count == 5
    assert by_id[1].my_membership_status == "active"
    assert len(by_id[1].coaches) == 1


# ?? update_profile ??????????????????????????????????????????????????????????


@pytest.mark.asyncio
async def test_update_profile_happy_path(monkeypatch):
    user = _athlete_user()
    user.profile.ftp = 200
    user.profile.weight = 70

    monkeypatch.setattr(users_router, "_apply_profile_update_to_user", lambda u, p: None)
    monkeypatch.setattr(users_router, "_log_metric_change", AsyncMock(return_value=None))

    db = _DB()
    update = SimpleNamespace()
    out = await users_router.update_profile(profile_update=update, current_user=user, db=db)
    assert db.commits == 1
    assert out is not None


# ?? create_organization ?????????????????????????????????????????????????????


@pytest.mark.asyncio
async def test_create_organization_happy_path():
    user = _coach_user()
    from app.schemas import OrganizationCreate
    payload = OrganizationCreate(name="MyOrg", description=None, picture=None)
    db = _DB()

    # flush should set new_org.id; we mimic by intercepting db.add
    original_add = db.add
    def _add_with_id(obj):
        from app.models import Organization
        if isinstance(obj, Organization) and obj.id is None:
            obj.id = 42
        original_add(obj)
    db.add = _add_with_id

    async def _flush():
        pass
    db.flush = _flush

    out = await users_router.create_organization(
        payload=payload, current_user=user, db=db
    )
    assert out.name == "MyOrg"
    assert any(isinstance(o, OrganizationMember) for o in db.added)
    assert db.commits == 1

# ?? coach_operations endpoint ???????????????????????????????????????????????


@pytest.mark.asyncio
async def test_coach_operations_forbidden_for_athlete():
    with pytest.raises(HTTPException) as exc:
        await users_router.get_coach_operations_view(
            athlete_id=None, sport=None, risk_level=None,
            exceptions_only=False, at_risk_only=False,
            current_user=_athlete_user(), db=_DB(),
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_coach_operations_no_orgs_returns_empty():
    coach = _coach_user()
    coach.organization_memberships = []
    out = await users_router.get_coach_operations_view(
        athlete_id=None, sport=None, risk_level=None,
        exceptions_only=False, at_risk_only=False,
        current_user=coach, db=_DB(),
    )
    assert out.athletes == []
    assert out.workload_balance.target_weekly_minutes == 0.0


@pytest.mark.asyncio
async def test_coach_operations_no_athletes_returns_empty():
    coach = _coach_user()
    db = _DB(execute_results=[_Result(scalars_list=[])])
    out = await users_router.get_coach_operations_view(
        athlete_id=None, sport=None, risk_level=None,
        exceptions_only=False, at_risk_only=False,
        current_user=coach, db=db,
    )
    assert out.athletes == []


@pytest.mark.asyncio
async def test_coach_operations_happy_path_with_filters():
    from datetime import datetime as dt, date as d, timedelta as td
    coach = _coach_user()
    athlete = _athlete_user(uid=2)
    athlete.profile.ftp = 200
    athlete.profile.max_hr = 190
    athlete.profile.main_sport = "cycling"

    today = d.today()
    activity_rows = [
        # athlete_id, created_at, duration, avg_hr, avg_watts
        (2, dt.combine(today - td(days=1), dt.min.time()), 3600, 140, 180),
        (2, dt.combine(today - td(days=10), dt.min.time()), 3600, 130, 170),
    ]
    planned_rows = [
        # user_id, date, planned_duration, compliance_status
        (2, today + td(days=1), 60, "planned"),
        (2, today - td(days=2), 60, "planned"),  # overdue
    ]

    db = _DB(execute_results=[
        _Result(scalars_list=[athlete]),  # athletes
        _Result(rows=activity_rows),       # activity_rows
        _Result(rows=planned_rows),        # planned_rows
    ])
    out = await users_router.get_coach_operations_view(
        athlete_id=None, sport="cycling", risk_level=None,
        exceptions_only=False, at_risk_only=False,
        current_user=coach, db=db,
    )
    assert len(out.athletes) == 1
    assert out.athletes[0].athlete_id == 2
    assert out.athletes[0].main_sport == "cycling"


@pytest.mark.asyncio
async def test_coach_operations_filters_unmatched_sport():
    from datetime import datetime as dt, date as d, timedelta as td
    coach = _coach_user()
    athlete = _athlete_user(uid=2)
    athlete.profile.main_sport = "cycling"

    db = _DB(execute_results=[
        _Result(scalars_list=[athlete]),
        _Result(rows=[]),
        _Result(rows=[]),
    ])
    out = await users_router.get_coach_operations_view(
        athlete_id=None, sport="running", risk_level=None,
        exceptions_only=False, at_risk_only=False,
        current_user=coach, db=db,
    )
    assert out.athletes == []


@pytest.mark.asyncio
async def test_coach_operations_at_risk_only_filter():
    coach = _coach_user()
    athlete = _athlete_user(uid=2)
    athlete.profile.main_sport = "cycling"

    db = _DB(execute_results=[
        _Result(scalars_list=[athlete]),
        _Result(rows=[]),
        _Result(rows=[]),
    ])
    out = await users_router.get_coach_operations_view(
        athlete_id=None, sport=None, risk_level="low",
        exceptions_only=True, at_risk_only=True,
        current_user=coach, db=db,
    )
    assert out.athletes == []

# ?? coach_operations endpoint ???????????????????????????????????????????????


@pytest.mark.asyncio
async def test_coach_operations_forbidden_for_athlete():
    with pytest.raises(HTTPException) as exc:
        await users_router.get_coach_operations_view(
            athlete_id=None, sport=None, risk_level=None,
            exceptions_only=False, at_risk_only=False,
            current_user=_athlete_user(), db=_DB(),
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_coach_operations_no_orgs_returns_empty():
    coach = _coach_user()
    coach.organization_memberships = []
    out = await users_router.get_coach_operations_view(
        athlete_id=None, sport=None, risk_level=None,
        exceptions_only=False, at_risk_only=False,
        current_user=coach, db=_DB(),
    )
    assert out.athletes == []
    assert out.workload_balance.target_weekly_minutes == 0.0


@pytest.mark.asyncio
async def test_coach_operations_no_athletes_returns_empty():
    coach = _coach_user()
    db = _DB(execute_results=[_Result(scalars_list=[])])
    out = await users_router.get_coach_operations_view(
        athlete_id=None, sport=None, risk_level=None,
        exceptions_only=False, at_risk_only=False,
        current_user=coach, db=db,
    )
    assert out.athletes == []


@pytest.mark.asyncio
async def test_coach_operations_happy_path_with_filters():
    from datetime import datetime as dt, date as d, timedelta as td
    coach = _coach_user()
    athlete = _athlete_user(uid=2)
    athlete.profile.ftp = 200
    athlete.profile.max_hr = 190
    athlete.profile.main_sport = "cycling"

    today = d.today()
    activity_rows = [
        # athlete_id, created_at, duration, avg_hr, avg_watts
        (2, dt.combine(today - td(days=1), dt.min.time()), 3600, 140, 180),
        (2, dt.combine(today - td(days=10), dt.min.time()), 3600, 130, 170),
    ]
    planned_rows = [
        # user_id, date, planned_duration, compliance_status
        (2, today + td(days=1), 60, "planned"),
        (2, today - td(days=2), 60, "planned"),  # overdue
    ]

    db = _DB(execute_results=[
        _Result(scalars_list=[athlete]),  # athletes
        _Result(rows=activity_rows),       # activity_rows
        _Result(rows=planned_rows),        # planned_rows
    ])
    out = await users_router.get_coach_operations_view(
        athlete_id=None, sport="cycling", risk_level=None,
        exceptions_only=False, at_risk_only=False,
        current_user=coach, db=db,
    )
    assert len(out.athletes) == 1
    assert out.athletes[0].athlete_id == 2
    assert out.athletes[0].main_sport == "cycling"


@pytest.mark.asyncio
async def test_coach_operations_filters_unmatched_sport():
    from datetime import datetime as dt, date as d, timedelta as td
    coach = _coach_user()
    athlete = _athlete_user(uid=2)
    athlete.profile.main_sport = "cycling"

    db = _DB(execute_results=[
        _Result(scalars_list=[athlete]),
        _Result(rows=[]),
        _Result(rows=[]),
    ])
    out = await users_router.get_coach_operations_view(
        athlete_id=None, sport="running", risk_level=None,
        exceptions_only=False, at_risk_only=False,
        current_user=coach, db=db,
    )
    assert out.athletes == []


@pytest.mark.asyncio
async def test_coach_operations_at_risk_only_filter():
    coach = _coach_user()
    athlete = _athlete_user(uid=2)
    athlete.profile.main_sport = "cycling"

    db = _DB(execute_results=[
        _Result(scalars_list=[athlete]),
        _Result(rows=[]),
        _Result(rows=[]),
    ])
    out = await users_router.get_coach_operations_view(
        athlete_id=None, sport=None, risk_level="low",
        exceptions_only=True, at_risk_only=True,
        current_user=coach, db=db,
    )
    assert out.athletes == []

# ?? Organization member management ??????????????????????????????????????????


@pytest.mark.asyncio
async def test_join_organization_athlete_consent_required():
    user = _athlete_user(1)
    payload = SimpleNamespace(
        code="ABC", athlete_data_sharing_consent=False,
        athlete_data_sharing_consent_version=None,
    )
    with pytest.raises(HTTPException) as exc:
        await users_router.join_organization(
            payload=payload, current_user=user, db=_DB(),
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_join_organization_org_not_found():
    user = _athlete_user(1)
    payload = SimpleNamespace(
        code="X", athlete_data_sharing_consent=True,
        athlete_data_sharing_consent_version=None,
    )
    db = _DB(execute_results=[_Result(scalars_list=[])])
    with pytest.raises(HTTPException) as exc:
        await users_router.join_organization(
            payload=payload, current_user=user, db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_join_organization_already_active_400(monkeypatch):
    user = _athlete_user(1)
    org = _Org(id=1, code="X", name="O", settings_json=None)
    member = OrganizationMember(user_id=1, organization_id=1,
                                role=RoleEnum.athlete.value, status="active")
    payload = SimpleNamespace(
        code="X", athlete_data_sharing_consent=True,
        athlete_data_sharing_consent_version=None,
    )

    db = _DB(
        execute_results=[_Result(scalars_list=[org]), _Result(scalar_one=user)],
        scalar_results=[member],
    )
    monkeypatch.setattr(users_router, "_normalize_user_for_response",
                        lambda u: None)
    with pytest.raises(HTTPException) as exc:
        await users_router.join_organization(
            payload=payload, current_user=user, db=db,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_update_organization_forbidden_for_athlete():
    user = _athlete_user(1)
    payload = SimpleNamespace(dict=lambda exclude_unset=False: {})
    with pytest.raises(HTTPException) as exc:
        await users_router.update_organization(
            payload=payload, current_user=user, db=_DB(),
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_update_organization_no_orgs_404():
    coach = _coach_user(99)
    payload = SimpleNamespace(dict=lambda exclude_unset=False: {})
    db = _DB(execute_results=[_Result(scalars_list=[])])
    with pytest.raises(HTTPException) as exc:
        await users_router.update_organization(
            payload=payload, current_user=coach, db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_update_organization_happy_path():
    coach = _coach_user(99)
    org = _Org(id=1, code="X", name="O", settings_json=None)
    payload = SimpleNamespace(dict=lambda exclude_unset=False: {"name": "New"})
    db = _DB(execute_results=[_Result(scalars_list=[org])])
    out = await users_router.update_organization(
        payload=payload, current_user=coach, db=db,
    )
    assert out.name == "New"


@pytest.mark.asyncio
async def test_leave_organization_404():
    user = _athlete_user(1)
    db = _DB(execute_results=[_Result(scalars_list=[])])
    with pytest.raises(HTTPException) as exc:
        await users_router.leave_organization(
            org_id=1, current_user=user, db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_leave_organization_happy_path():
    user = _athlete_user(1)
    member = OrganizationMember(user_id=1, organization_id=1,
                                role=RoleEnum.athlete.value, status="active")

    db = _DB(execute_results=[_Result(scalar_one=member)])
    out = await users_router.leave_organization(
        org_id=1, current_user=user, db=db,
    )
    assert out["status"] == "ok"
    assert member in db.deleted


@pytest.mark.asyncio
async def test_remove_organization_member_not_caller_member_403():
    coach = _coach_user(99)

    db = _DB(execute_results=[_Result(scalar_one=None)])
    with pytest.raises(HTTPException) as exc:
        await users_router.remove_organization_member(
            org_id=1, user_id=2, current_user=coach, db=db,
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_remove_organization_member_org_not_found():
    coach = _coach_user(99)
    caller_member = OrganizationMember(user_id=99, organization_id=1,
                                       role=RoleEnum.coach.value, status="active")

    db = _DB(
        execute_results=[_Result(scalar_one=caller_member)],
        scalar_results=[None],
    )
    with pytest.raises(HTTPException) as exc:
        await users_router.remove_organization_member(
            org_id=1, user_id=2, current_user=coach, db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_remove_organization_member_happy_path():
    coach = _coach_user(99)
    caller_member = OrganizationMember(user_id=99, organization_id=1,
                                       role=RoleEnum.coach.value, status="active")
    target_member = OrganizationMember(user_id=2, organization_id=1,
                                       role=RoleEnum.athlete.value, status="active")
    org = _Org(id=1, code="X", name="O", settings_json=None)

    db = _DB(
        execute_results=[_Result(scalar_one=caller_member), _Result(scalar_one=target_member)],
        scalar_results=[org],
    )
    out = await users_router.remove_organization_member(
        org_id=1, user_id=2, current_user=coach, db=db,
    )
    assert out["status"] == "ok"
    assert target_member in db.deleted


@pytest.mark.asyncio
async def test_remove_organization_member_self_400():
    coach = _coach_user(99)
    caller_member = OrganizationMember(user_id=99, organization_id=1,
                                       role=RoleEnum.coach.value, status="active")
    org = _Org(id=1, code="X", name="O", settings_json=None)

    db = _DB(
        execute_results=[_Result(scalar_one=caller_member)],
        scalar_results=[org],
    )
    with pytest.raises(HTTPException) as exc:
        await users_router.remove_organization_member(
            org_id=1, user_id=99, current_user=coach, db=db,
        )
    assert exc.value.status_code == 400


# ?? update_athlete_profile_endpoint ?????????????????????????????????????????


@pytest.mark.asyncio
async def test_update_athlete_profile_forbidden_for_athlete():
    user = _athlete_user(1)
    with pytest.raises(HTTPException) as exc:
        await users_router.update_athlete_profile_endpoint(
            athlete_id=2, profile_update=SimpleNamespace(),
            current_user=user, db=_DB(),
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_update_athlete_profile_no_shared_orgs_403(monkeypatch):
    coach = _coach_user(99)
    monkeypatch.setattr(users_router, "get_shared_org_ids",
                        AsyncMock(return_value=set()))
    with pytest.raises(HTTPException) as exc:
        await users_router.update_athlete_profile_endpoint(
            athlete_id=2, profile_update=SimpleNamespace(),
            current_user=coach, db=_DB(),
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_update_athlete_profile_athlete_not_found(monkeypatch):
    coach = _coach_user(99)
    monkeypatch.setattr(users_router, "get_shared_org_ids",
                        AsyncMock(return_value={1}))
    db = _DB(scalar_results=[None])
    with pytest.raises(HTTPException) as exc:
        await users_router.update_athlete_profile_endpoint(
            athlete_id=2, profile_update=SimpleNamespace(),
            current_user=coach, db=db,
        )
    assert exc.value.status_code == 404

# ?? Organization member management ??????????????????????????????????????????


@pytest.mark.asyncio
async def test_join_organization_athlete_consent_required():
    user = _athlete_user(1)
    payload = SimpleNamespace(
        code="ABC", athlete_data_sharing_consent=False,
        athlete_data_sharing_consent_version=None,
    )
    with pytest.raises(HTTPException) as exc:
        await users_router.join_organization(
            payload=payload, current_user=user, db=_DB(),
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_join_organization_org_not_found():
    user = _athlete_user(1)
    payload = SimpleNamespace(
        code="X", athlete_data_sharing_consent=True,
        athlete_data_sharing_consent_version=None,
    )
    db = _DB(execute_results=[_Result(scalars_list=[])])
    with pytest.raises(HTTPException) as exc:
        await users_router.join_organization(
            payload=payload, current_user=user, db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_join_organization_already_active_400(monkeypatch):
    user = _athlete_user(1)
    org = _Org(id=1, code="X", name="O", settings_json=None)
    member = OrganizationMember(user_id=1, organization_id=1,
                                role=RoleEnum.athlete.value, status="active")
    payload = SimpleNamespace(
        code="X", athlete_data_sharing_consent=True,
        athlete_data_sharing_consent_version=None,
    )

    db = _DB(
        execute_results=[_Result(scalars_list=[org]), _Result(scalar_one=user)],
        scalar_results=[member],
    )
    monkeypatch.setattr(users_router, "_normalize_user_for_response",
                        lambda u: None)
    with pytest.raises(HTTPException) as exc:
        await users_router.join_organization(
            payload=payload, current_user=user, db=db,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_update_organization_forbidden_for_athlete():
    user = _athlete_user(1)
    payload = SimpleNamespace(dict=lambda exclude_unset=False: {})
    with pytest.raises(HTTPException) as exc:
        await users_router.update_organization(
            payload=payload, current_user=user, db=_DB(),
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_update_organization_no_orgs_404():
    coach = _coach_user(99)
    payload = SimpleNamespace(dict=lambda exclude_unset=False: {})
    db = _DB(execute_results=[_Result(scalars_list=[])])
    with pytest.raises(HTTPException) as exc:
        await users_router.update_organization(
            payload=payload, current_user=coach, db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_update_organization_happy_path():
    coach = _coach_user(99)
    org = _Org(id=1, code="X", name="O", settings_json=None)
    payload = SimpleNamespace(dict=lambda exclude_unset=False: {"name": "New"})
    db = _DB(execute_results=[_Result(scalars_list=[org])])
    out = await users_router.update_organization(
        payload=payload, current_user=coach, db=db,
    )
    assert out.name == "New"


@pytest.mark.asyncio
async def test_leave_organization_404():
    user = _athlete_user(1)
    db = _DB(execute_results=[_Result(scalars_list=[])])
    with pytest.raises(HTTPException) as exc:
        await users_router.leave_organization(
            org_id=1, current_user=user, db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_leave_organization_happy_path():
    user = _athlete_user(1)
    member = OrganizationMember(user_id=1, organization_id=1,
                                role=RoleEnum.athlete.value, status="active")

    db = _DB(execute_results=[_Result(scalar_one=member)])
    out = await users_router.leave_organization(
        org_id=1, current_user=user, db=db,
    )
    assert out["status"] == "ok"
    assert member in db.deleted


@pytest.mark.asyncio
async def test_remove_organization_member_not_caller_member_403():
    coach = _coach_user(99)

    db = _DB(execute_results=[_Result(scalar_one=None)])
    with pytest.raises(HTTPException) as exc:
        await users_router.remove_organization_member(
            org_id=1, user_id=2, current_user=coach, db=db,
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_remove_organization_member_org_not_found():
    coach = _coach_user(99)
    caller_member = OrganizationMember(user_id=99, organization_id=1,
                                       role=RoleEnum.coach.value, status="active")

    db = _DB(
        execute_results=[_Result(scalar_one=caller_member)],
        scalar_results=[None],
    )
    with pytest.raises(HTTPException) as exc:
        await users_router.remove_organization_member(
            org_id=1, user_id=2, current_user=coach, db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_remove_organization_member_happy_path():
    coach = _coach_user(99)
    caller_member = OrganizationMember(user_id=99, organization_id=1,
                                       role=RoleEnum.coach.value, status="active")
    target_member = OrganizationMember(user_id=2, organization_id=1,
                                       role=RoleEnum.athlete.value, status="active")
    org = _Org(id=1, code="X", name="O", settings_json=None)

    db = _DB(
        execute_results=[_Result(scalar_one=caller_member), _Result(scalar_one=target_member)],
        scalar_results=[org],
    )
    out = await users_router.remove_organization_member(
        org_id=1, user_id=2, current_user=coach, db=db,
    )
    assert out["status"] == "ok"
    assert target_member in db.deleted


@pytest.mark.asyncio
async def test_remove_organization_member_self_400():
    coach = _coach_user(99)
    caller_member = OrganizationMember(user_id=99, organization_id=1,
                                       role=RoleEnum.coach.value, status="active")
    org = _Org(id=1, code="X", name="O", settings_json=None)

    db = _DB(
        execute_results=[_Result(scalar_one=caller_member)],
        scalar_results=[org],
    )
    with pytest.raises(HTTPException) as exc:
        await users_router.remove_organization_member(
            org_id=1, user_id=99, current_user=coach, db=db,
        )
    assert exc.value.status_code == 400


# ?? update_athlete_profile_endpoint ?????????????????????????????????????????


@pytest.mark.asyncio
async def test_update_athlete_profile_forbidden_for_athlete():
    user = _athlete_user(1)
    with pytest.raises(HTTPException) as exc:
        await users_router.update_athlete_profile_endpoint(
            athlete_id=2, profile_update=SimpleNamespace(),
            current_user=user, db=_DB(),
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_update_athlete_profile_no_shared_orgs_403(monkeypatch):
    coach = _coach_user(99)
    monkeypatch.setattr(users_router, "get_shared_org_ids",
                        AsyncMock(return_value=set()))
    with pytest.raises(HTTPException) as exc:
        await users_router.update_athlete_profile_endpoint(
            athlete_id=2, profile_update=SimpleNamespace(),
            current_user=coach, db=_DB(),
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_update_athlete_profile_athlete_not_found(monkeypatch):
    coach = _coach_user(99)
    monkeypatch.setattr(users_router, "get_shared_org_ids",
                        AsyncMock(return_value={1}))
    db = _DB(scalar_results=[None])
    with pytest.raises(HTTPException) as exc:
        await users_router.update_athlete_profile_endpoint(
            athlete_id=2, profile_update=SimpleNamespace(),
            current_user=coach, db=db,
        )
    assert exc.value.status_code == 404

# ?? athlete permissions ?????????????????????????????????????????????????????


@pytest.mark.asyncio
async def test_list_athlete_permissions_forbidden_for_athlete():
    user = _athlete_user(1)
    with pytest.raises(HTTPException) as exc:
        await users_router.list_athlete_permissions_for_coach(
            current_user=user, db=_DB(),
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_list_athlete_permissions_no_orgs_returns_empty():
    coach = _coach_user(99)
    coach.organization_memberships = []
    out = await users_router.list_athlete_permissions_for_coach(
        current_user=coach, db=_DB(),
    )
    assert out == []


@pytest.mark.asyncio
async def test_list_athlete_permissions_returns_for_athletes(monkeypatch):
    coach = _coach_user(99)
    monkeypatch.setattr(
        users_router, "get_athlete_permissions",
        AsyncMock(return_value={
            "allow_delete_activities": True,
            "allow_delete_workouts": True,
            "allow_edit_workouts": True,
            "allow_export_calendar": True,
            "allow_public_calendar_share": False,
            "require_workout_approval": False,
        }),
    )
    db = _DB(execute_results=[_Result(scalars_list=[2, 3])])
    out = await users_router.list_athlete_permissions_for_coach(
        current_user=coach, db=db,
    )
    assert len(out) == 2


@pytest.mark.asyncio
async def test_update_athlete_permissions_forbidden_for_athlete():
    user = _athlete_user(1)
    payload = SimpleNamespace(model_dump=lambda exclude_unset: {})
    with pytest.raises(HTTPException) as exc:
        await users_router.update_athlete_permissions_endpoint(
            athlete_id=2, payload=payload, current_user=user, db=_DB(),
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_update_athlete_permissions_no_shared_orgs_403(monkeypatch):
    coach = _coach_user(99)
    monkeypatch.setattr(users_router, "get_shared_org_ids",
                        AsyncMock(return_value=set()))
    payload = SimpleNamespace(model_dump=lambda exclude_unset: {})
    with pytest.raises(HTTPException) as exc:
        await users_router.update_athlete_permissions_endpoint(
            athlete_id=2, payload=payload, current_user=coach, db=_DB(),
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_update_athlete_permissions_updated_zero_orgs_403(monkeypatch):
    coach = _coach_user(99)
    monkeypatch.setattr(users_router, "get_shared_org_ids",
                        AsyncMock(return_value={1}))
    monkeypatch.setattr(
        users_router, "get_athlete_permissions",
        AsyncMock(return_value={
            "allow_delete_activities": True, "allow_delete_workouts": True,
            "allow_edit_workouts": True, "allow_export_calendar": True,
            "allow_public_calendar_share": False, "require_workout_approval": False,
        }),
    )
    monkeypatch.setattr(
        users_router, "set_athlete_permissions_for_shared_orgs",
        AsyncMock(return_value=0),
    )
    payload = SimpleNamespace(model_dump=lambda exclude_unset: {})
    with pytest.raises(HTTPException) as exc:
        await users_router.update_athlete_permissions_endpoint(
            athlete_id=2, payload=payload, current_user=coach, db=_DB(),
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_update_athlete_permissions_happy_path(monkeypatch):
    coach = _coach_user(99)
    monkeypatch.setattr(users_router, "get_shared_org_ids",
                        AsyncMock(return_value={1}))
    monkeypatch.setattr(
        users_router, "get_athlete_permissions",
        AsyncMock(return_value={
            "allow_delete_activities": True, "allow_delete_workouts": True,
            "allow_edit_workouts": True, "allow_export_calendar": True,
            "allow_public_calendar_share": False, "require_workout_approval": False,
        }),
    )
    monkeypatch.setattr(
        users_router, "set_athlete_permissions_for_shared_orgs",
        AsyncMock(return_value=1),
    )
    payload = SimpleNamespace(model_dump=lambda exclude_unset: {"require_workout_approval": True})
    out = await users_router.update_athlete_permissions_endpoint(
        athlete_id=2, payload=payload, current_user=coach, db=_DB(),
    )
    assert out.athlete_id == 2

# ?? athlete permissions ?????????????????????????????????????????????????????


@pytest.mark.asyncio
async def test_list_athlete_permissions_forbidden_for_athlete():
    user = _athlete_user(1)
    with pytest.raises(HTTPException) as exc:
        await users_router.list_athlete_permissions_for_coach(
            current_user=user, db=_DB(),
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_list_athlete_permissions_no_orgs_returns_empty():
    coach = _coach_user(99)
    coach.organization_memberships = []
    out = await users_router.list_athlete_permissions_for_coach(
        current_user=coach, db=_DB(),
    )
    assert out == []


@pytest.mark.asyncio
async def test_list_athlete_permissions_returns_for_athletes(monkeypatch):
    coach = _coach_user(99)
    monkeypatch.setattr(
        users_router, "get_athlete_permissions",
        AsyncMock(return_value={
            "allow_delete_activities": True,
            "allow_delete_workouts": True,
            "allow_edit_workouts": True,
            "allow_export_calendar": True,
            "allow_public_calendar_share": False,
            "require_workout_approval": False,
        }),
    )
    db = _DB(execute_results=[_Result(scalars_list=[2, 3])])
    out = await users_router.list_athlete_permissions_for_coach(
        current_user=coach, db=db,
    )
    assert len(out) == 2


@pytest.mark.asyncio
async def test_update_athlete_permissions_forbidden_for_athlete():
    user = _athlete_user(1)
    payload = SimpleNamespace(model_dump=lambda exclude_unset: {})
    with pytest.raises(HTTPException) as exc:
        await users_router.update_athlete_permissions_endpoint(
            athlete_id=2, payload=payload, current_user=user, db=_DB(),
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_update_athlete_permissions_no_shared_orgs_403(monkeypatch):
    coach = _coach_user(99)
    monkeypatch.setattr(users_router, "get_shared_org_ids",
                        AsyncMock(return_value=set()))
    payload = SimpleNamespace(model_dump=lambda exclude_unset: {})
    with pytest.raises(HTTPException) as exc:
        await users_router.update_athlete_permissions_endpoint(
            athlete_id=2, payload=payload, current_user=coach, db=_DB(),
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_update_athlete_permissions_updated_zero_orgs_403(monkeypatch):
    coach = _coach_user(99)
    monkeypatch.setattr(users_router, "get_shared_org_ids",
                        AsyncMock(return_value={1}))
    monkeypatch.setattr(
        users_router, "get_athlete_permissions",
        AsyncMock(return_value={
            "allow_delete_activities": True, "allow_delete_workouts": True,
            "allow_edit_workouts": True, "allow_export_calendar": True,
            "allow_public_calendar_share": False, "require_workout_approval": False,
        }),
    )
    monkeypatch.setattr(
        users_router, "set_athlete_permissions_for_shared_orgs",
        AsyncMock(return_value=0),
    )
    payload = SimpleNamespace(model_dump=lambda exclude_unset: {})
    with pytest.raises(HTTPException) as exc:
        await users_router.update_athlete_permissions_endpoint(
            athlete_id=2, payload=payload, current_user=coach, db=_DB(),
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_update_athlete_permissions_happy_path(monkeypatch):
    coach = _coach_user(99)
    monkeypatch.setattr(users_router, "get_shared_org_ids",
                        AsyncMock(return_value={1}))
    monkeypatch.setattr(
        users_router, "get_athlete_permissions",
        AsyncMock(return_value={
            "allow_delete_activities": True, "allow_delete_workouts": True,
            "allow_edit_workouts": True, "allow_export_calendar": True,
            "allow_public_calendar_share": False, "require_workout_approval": False,
        }),
    )
    monkeypatch.setattr(
        users_router, "set_athlete_permissions_for_shared_orgs",
        AsyncMock(return_value=1),
    )
    payload = SimpleNamespace(model_dump=lambda exclude_unset: {"require_workout_approval": True})
    out = await users_router.update_athlete_permissions_endpoint(
        athlete_id=2, payload=payload, current_user=coach, db=_DB(),
    )
    assert out.athlete_id == 2
