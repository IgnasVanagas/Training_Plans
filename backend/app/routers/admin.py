from datetime import datetime
import os
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr
from sqlalchemy import desc, func, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from ..auth import get_current_user, get_password_hash, verify_password
from ..database import get_db
from ..models import Activity, IntegrationAuditLog, Profile, RoleEnum, User

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


class AdminAthleteIdentityUpdateRequest(BaseModel):
    admin_password: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[EmailStr] = None


class AdminAthletePasswordResetRequest(BaseModel):
    admin_password: str
    new_password: str


def _read_process_memory_mb() -> tuple[float | None, float | None]:
    current_rss_mb: float | None = None
    peak_rss_mb: float | None = None

    try:
        with open("/proc/self/status", "r", encoding="utf-8") as status_file:
            for line in status_file:
                if line.startswith("VmRSS:"):
                    current_rss_mb = int(line.split()[1]) / 1024.0
                elif line.startswith("VmHWM:"):
                    peak_rss_mb = int(line.split()[1]) / 1024.0
    except OSError:
        pass

    return current_rss_mb, peak_rss_mb


def _assert_admin_password(admin: User, provided_password: str) -> None:
    if not provided_password or not verify_password(provided_password, admin.password_hash):
        raise HTTPException(status_code=403, detail="Admin password confirmation failed")


def _validate_strong_password(value: str) -> None:
    # Enforce high-entropy passwords for admin-initiated resets.
    if len(value) < 12:
        raise HTTPException(status_code=400, detail="Password must be at least 12 characters")
    if not re.search(r"[A-Z]", value):
        raise HTTPException(status_code=400, detail="Password must include an uppercase letter")
    if not re.search(r"[a-z]", value):
        raise HTTPException(status_code=400, detail="Password must include a lowercase letter")
    if not re.search(r"\d", value):
        raise HTTPException(status_code=400, detail="Password must include a number")
    if not re.search(r"[^A-Za-z0-9]", value):
        raise HTTPException(status_code=400, detail="Password must include a symbol")


async def _write_admin_audit_log(
    *,
    db: AsyncSession,
    admin: User,
    action: str,
    status: str,
    message: str,
) -> None:
    db.add(
        IntegrationAuditLog(
            user_id=admin.id,
            provider="admin",
            action=action,
            status=status,
            message=message,
        )
    )
    await db.commit()


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


@router.patch("/users/{user_id}/identity")
async def update_athlete_identity(
    user_id: int,
    body: AdminAthleteIdentityUpdateRequest,
    admin: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    _assert_admin_password(admin, body.admin_password)

    if admin.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot update your own account via admin identity endpoint")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role != RoleEnum.athlete:
        raise HTTPException(status_code=400, detail="Only athlete accounts can be edited here")

    profile = user.profile
    if profile is None:
        profile = Profile(user_id=user.id)
        db.add(profile)

    change_parts: list[str] = []

    new_email = str(body.email).strip().lower() if body.email else None
    if new_email and new_email != user.email:
        change_parts.append("email")
        user.email = new_email
        user.email_verified = False

    if body.first_name is not None and body.first_name != (profile.first_name or ""):
        change_parts.append("first_name")
        profile.first_name = body.first_name.strip() or None

    if body.last_name is not None and body.last_name != (profile.last_name or ""):
        change_parts.append("last_name")
        profile.last_name = body.last_name.strip() or None

    if not change_parts:
        return {
            "id": user.id,
            "email": user.email,
            "first_name": profile.first_name,
            "last_name": profile.last_name,
            "updated": False,
        }

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Email is already in use")

    await _write_admin_audit_log(
        db=db,
        admin=admin,
        action="update_identity",
        status="ok",
        message=f"Updated athlete_id={user.id}; fields={','.join(change_parts)}",
    )

    return {
        "id": user.id,
        "email": user.email,
        "first_name": profile.first_name,
        "last_name": profile.last_name,
        "updated": True,
    }


@router.post("/users/{user_id}/reset-password")
async def reset_athlete_password(
    user_id: int,
    body: AdminAthletePasswordResetRequest,
    admin: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    _assert_admin_password(admin, body.admin_password)
    _validate_strong_password(body.new_password)

    if admin.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot reset your own password via admin reset endpoint")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role != RoleEnum.athlete:
        raise HTTPException(status_code=400, detail="Only athlete account passwords can be reset here")

    user.password_hash = get_password_hash(body.new_password)
    await db.commit()

    await _write_admin_audit_log(
        db=db,
        admin=admin,
        action="reset_password",
        status="ok",
        message=f"Reset athlete password athlete_id={user.id}",
    )

    return {"id": user.id, "reset": True}


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
    current_rss_mb, peak_rss_mb = _read_process_memory_mb()

    host_total_mb: float | None = None
    host_available_mb: float | None = None
    try:
        pages = os.sysconf("SC_PHYS_PAGES")
        page_size = os.sysconf("SC_PAGE_SIZE")
        host_total_mb = (pages * page_size) / (1024.0 * 1024.0)
        with open("/proc/meminfo", "r", encoding="utf-8") as meminfo:
            for line in meminfo:
                if line.startswith("MemAvailable:"):
                    host_available_mb = int(line.split()[1]) / 1024.0
                    break
    except Exception:
        pass

    return {
        "users": user_counts,
        "total_activities": total_activities,
        "db": "ok",
        "memory": {
            "process_rss_mb": current_rss_mb,
            "process_peak_mb": peak_rss_mb,
            "host_total_mb": host_total_mb,
            "host_available_mb": host_available_mb,
        },
    }


@router.post("/backfill-duplicates")
async def backfill_duplicates(
    _admin: User = Depends(_require_admin),
) -> dict:
    """Re-scan all activities and link undetected duplicates."""
    from ..database import engine
    from ..services.activity_dedupe import _backfill_duplicates

    marked = await _backfill_duplicates(engine)
    return {"marked": marked}
