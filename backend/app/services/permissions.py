from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import OrganizationMember, Organization, RoleEnum

PERMISSION_KEYS = (
    "allow_delete_activities",
    "allow_delete_workouts",
    "allow_edit_workouts",
)

DEFAULT_PERMISSIONS = {key: False for key in PERMISSION_KEYS}
DEFAULT_PERMISSIONS["allow_edit_workouts"] = True


def normalize_permissions(raw: Optional[dict]) -> dict:
    if not isinstance(raw, dict):
        return DEFAULT_PERMISSIONS.copy()
    return {
        key: bool(raw.get(key, DEFAULT_PERMISSIONS.get(key, False)))
        for key in PERMISSION_KEYS
    }


async def get_shared_org_ids(db: AsyncSession, coach_id: int, athlete_id: int) -> list[int]:
    coach_orgs_stmt = select(OrganizationMember.organization_id).where(
        OrganizationMember.user_id == coach_id,
        OrganizationMember.role == RoleEnum.coach.value,
        OrganizationMember.status == "active",
    )
    coach_orgs_res = await db.execute(coach_orgs_stmt)
    coach_org_ids = list(set(coach_orgs_res.scalars().all()))
    if not coach_org_ids:
        return []

    shared_stmt = select(OrganizationMember.organization_id).where(
        OrganizationMember.user_id == athlete_id,
        OrganizationMember.organization_id.in_(coach_org_ids),
        OrganizationMember.status == "active",
    )
    shared_res = await db.execute(shared_stmt)
    return list(set(shared_res.scalars().all()))


async def get_athlete_org_ids(db: AsyncSession, athlete_id: int) -> list[int]:
    athlete_orgs_stmt = select(OrganizationMember.organization_id).where(
        OrganizationMember.user_id == athlete_id,
        OrganizationMember.status == "active",
    )
    athlete_orgs_res = await db.execute(athlete_orgs_stmt)
    return list(set(athlete_orgs_res.scalars().all()))


async def get_athlete_permissions(
    db: AsyncSession,
    athlete_id: int,
    coach_id: Optional[int] = None,
) -> dict:
    if coach_id is not None:
        org_ids = await get_shared_org_ids(db, coach_id, athlete_id)
    else:
        org_ids = await get_athlete_org_ids(db, athlete_id)

    # Self-permission semantics:
    # - If athlete has no active org/coaching relationship, do not block self actions.
    # - If athlete has active coach relationship(s), enforce org permission settings.
    if coach_id is None and not org_ids:
        return {key: True for key in PERMISSION_KEYS}

    if coach_id is not None and not org_ids:
        return DEFAULT_PERMISSIONS.copy()

    if coach_id is None:
        has_active_coach_stmt = select(OrganizationMember.user_id).where(
            OrganizationMember.organization_id.in_(org_ids),
            OrganizationMember.role == RoleEnum.coach.value,
            OrganizationMember.status == "active",
        )
        has_active_coach_res = await db.execute(has_active_coach_stmt)
        has_active_coach = has_active_coach_res.scalar_one_or_none() is not None
        if not has_active_coach:
            return {key: True for key in PERMISSION_KEYS}

    orgs_stmt = select(Organization).where(Organization.id.in_(org_ids))
    orgs_res = await db.execute(orgs_stmt)
    orgs = orgs_res.scalars().all()

    effective = DEFAULT_PERMISSIONS.copy()

    for org in orgs:
        settings = org.settings_json if isinstance(org.settings_json, dict) else {}
        athlete_permissions = settings.get("athlete_permissions") if isinstance(settings, dict) else None
        athlete_raw = athlete_permissions.get(str(athlete_id)) if isinstance(athlete_permissions, dict) else None
        parsed = normalize_permissions(athlete_raw)
        for key in PERMISSION_KEYS:
            effective[key] = effective[key] or parsed[key]

    return effective


async def set_athlete_permissions_for_shared_orgs(
    db: AsyncSession,
    coach_id: int,
    athlete_id: int,
    permissions: dict,
) -> int:
    org_ids = await get_shared_org_ids(db, coach_id, athlete_id)
    if not org_ids:
        return 0

    orgs_stmt = select(Organization).where(Organization.id.in_(org_ids))
    orgs_res = await db.execute(orgs_stmt)
    orgs = orgs_res.scalars().all()

    normalized = normalize_permissions(permissions)

    for org in orgs:
        settings = org.settings_json if isinstance(org.settings_json, dict) else {}
        athlete_permissions = settings.get("athlete_permissions") if isinstance(settings.get("athlete_permissions"), dict) else {}
        athlete_permissions[str(athlete_id)] = normalized
        settings["athlete_permissions"] = athlete_permissions
        org.settings_json = settings
        db.add(org)

    await db.commit()
    return len(orgs)
