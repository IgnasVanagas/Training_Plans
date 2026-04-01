from __future__ import annotations

from datetime import datetime

import pytest

from app.models import RoleEnum, User
from app.routers import communications as communications_router
from app.schemas import OrganizationChatMessageCreate


class _RecordingDB:
    def __init__(self):
        self.added = []
        self.committed = False

    def add(self, value):
        self.added.append(value)

    async def commit(self):
        self.committed = True

    async def refresh(self, value):
        value.id = 101
        value.created_at = datetime(2026, 4, 1, 12, 0, 0)

    async def scalar(self, _stmt):
        return None


@pytest.mark.asyncio
async def test_group_message_allows_attachment_without_text(monkeypatch):
    async def _allow_membership(*_args, **_kwargs):
        return None

    monkeypatch.setattr(communications_router, "_require_active_org_membership", _allow_membership)

    db = _RecordingDB()
    current_user = User(
        id=7,
        email="coach@example.com",
        password_hash="x",
        role=RoleEnum.coach,
        email_verified=True,
    )

    response = await communications_router.post_organization_group_message(
        organization_id=3,
        payload=OrganizationChatMessageCreate(
            body="",
            attachment_url="abc123.png",
            attachment_name="photo.png",
        ),
        current_user=current_user,
        db=db,
    )

    assert db.committed is True
    assert len(db.added) == 1
    assert db.added[0].body == ""
    assert db.added[0].attachment_url == "abc123.png"
    assert db.added[0].attachment_name == "photo.png"
    assert response.body == ""
    assert response.attachment_url == "abc123.png"
    assert response.attachment_name == "photo.png"
    assert response.sender_id == current_user.id