from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import desc, func, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..database import get_db
from ..models import Activity, IntegrationAuditLog, RoleEnum, User

router = APIRouter(prefix="/admin", tags=["admin"])


def _require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != RoleEnum.admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


# ── Response schemas ──────────────────────────────────────────────────────────

class AdminUserOut(BaseModel):
    id: int
    email: str
    role: str
    email_verified: bool
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    activity_count: int = 0

    model_config = {"from_attributes": True}


class AdminAuditLogOut(BaseModel):
    id: int
    user_id: int
    user_email: Optional[str] = None
    provider: str
    action: str
    status: str
    message: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class RoleChangeRequest(BaseModel):
    role: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/users", response_model=list[AdminUserOut])
async def list_all_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    search: Optional[str] = Query(None),
    role: Optional[str] = Query(None),
    _admin: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[AdminUserOut]:
    act_sub = (
        select(Activity.athlete_id, func.count(Activity.id).label("cnt"))
        .group_by(Activity.athlete_id)
        .subquery()
    )
    stmt = (
        select(User, act_sub.c.cnt)
        .outerjoin(act_sub, act_sub.c.athlete_id == User.id)
        .options(selectinload(User.profile))
        .order_by(User.id.asc())
        .offset(skip)
        .limit(limit)
    )
    if search:
        stmt = stmt.where(User.email.ilike(f"%{search}%"))
    if role:
        try:
            stmt = stmt.where(User.role == RoleEnum(role))
        except ValueError:
            pass

    rows = (await db.execute(stmt)).all()
    result = []
    for user, cnt in rows:
        p = user.profile
        result.append(AdminUserOut(
            id=user.id,
            email=user.email,
            role=user.role.value,
            email_verified=user.email_verified,
            first_name=p.first_name if p else None,
            last_name=p.last_name if p else None,
            activity_count=cnt or 0,
        ))
    return result


@router.patch("/users/{user_id}/role")
async def change_user_role(
    user_id: int,
    body: RoleChangeRequest,
    admin: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if admin.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot change your own role")
    try:
        new_role = RoleEnum(body.role)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid role: {body.role}")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.role = new_role
    await db.commit()
    return {"id": user_id, "role": new_role.value}


@router.get("/audit-logs", response_model=list[AdminAuditLogOut])
async def list_audit_logs(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    provider: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    _admin: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[AdminAuditLogOut]:
    stmt = (
        select(IntegrationAuditLog, User.email)
        .join(User, User.id == IntegrationAuditLog.user_id)
        .order_by(desc(IntegrationAuditLog.created_at))
        .offset(skip)
        .limit(limit)
    )
    if provider:
        stmt = stmt.where(IntegrationAuditLog.provider == provider)
    if status:
        stmt = stmt.where(IntegrationAuditLog.status == status)

    rows = (await db.execute(stmt)).all()
    return [
        AdminAuditLogOut(
            id=log.id,
            user_id=log.user_id,
            user_email=email,
            provider=log.provider,
            action=log.action,
            status=log.status,
            message=log.message,
            created_at=log.created_at,
        )
        for log, email in rows
    ]


@router.get("/stats")
async def get_stats(
    _admin: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user_counts: dict[str, int] = {}
    for r in RoleEnum:
        user_counts[r.value] = await db.scalar(
            select(func.count(User.id)).where(User.role == r)
        ) or 0

    total_activities = await db.scalar(select(func.count(Activity.id))) or 0

    return {
        "users": user_counts,
        "total_activities": total_activities,
        "db": "ok",
    }
