import os
import uuid
from datetime import date as dt_date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, and_, or_
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user, get_password_hash, verify_password
from ..database import get_db
from ..models import CoachAthleteLink, RoleEnum, User, Profile, ProfileMetricHistory, Organization, OrganizationMember, PlannedWorkout
from ..schemas import AthleteOut, InviteLinkResponse, InviteByEmailRequest, InviteByEmailResponse, UserOut, ProfileUpdate, OrganizationOut, OrganizationUpdate, JoinOrganization, JoinOrganizationRequest, InvitationRespondRequest, OrganizationCreate, AthletePermissionOut, AthletePermissionUpdate, AthletePermissionSettings, ChangePasswordRequest, CoachSummaryOut, OrganizationDiscoverOut, OrganizationDiscoverItemOut, OrganizationCoachOut
from ..services.permissions import get_shared_org_ids, get_athlete_permissions, set_athlete_permissions_for_shared_orgs

router = APIRouter(prefix="/users", tags=["users"])


def _extract_profile_sports_and_zones(raw_sports):
    if isinstance(raw_sports, dict):
        sports = raw_sports.get("items")
        zone_settings = raw_sports.get("zone_settings")
        integration_settings = raw_sports.get("integration_settings")
        auto_sync_integrations = True
        if isinstance(integration_settings, dict) and "auto_sync_integrations" in integration_settings:
            auto_sync_integrations = bool(integration_settings.get("auto_sync_integrations"))
        return (
            sports if isinstance(sports, list) else None,
            zone_settings if isinstance(zone_settings, dict) else None,
            auto_sync_integrations,
        )
    if isinstance(raw_sports, list):
        return raw_sports, None, True
    return None, None, True


def _normalize_profile_for_response(profile: Profile | None) -> None:
    if profile is None:
        return
    sports, zone_settings, auto_sync_integrations = _extract_profile_sports_and_zones(profile.sports)
    profile.sports = sports
    profile.zone_settings = zone_settings
    profile.auto_sync_integrations = auto_sync_integrations


def _normalize_user_for_response(user: User | None) -> None:
    if user is None:
        return
    _normalize_profile_for_response(user.profile)


def _build_next_coach_workout_lookup(rows: list[tuple[int, dt_date]]) -> dict[int, dt_date]:
    lookup: dict[int, dt_date] = {}
    for athlete_id, workout_date in rows:
        if athlete_id not in lookup:
            lookup[athlete_id] = workout_date
    return lookup


async def _annotate_athletes_with_upcoming_workout_status(
    db: AsyncSession,
    coach_id: int,
    athletes: list[User],
    horizon_days: int = 7,
) -> None:
    athlete_ids = [athlete.id for athlete in athletes]
    if not athlete_ids:
        return

    today = dt_date.today()
    end_date = today + timedelta(days=horizon_days)
    result = await db.execute(
        select(PlannedWorkout.user_id, PlannedWorkout.date)
        .where(
            PlannedWorkout.created_by_user_id == coach_id,
            PlannedWorkout.user_id.in_(athlete_ids),
            PlannedWorkout.date >= today,
            PlannedWorkout.date <= end_date,
        )
        .order_by(PlannedWorkout.user_id.asc(), PlannedWorkout.date.asc())
    )
    lookup = _build_next_coach_workout_lookup(result.all())

    for athlete in athletes:
        next_workout_date = lookup.get(athlete.id)
        athlete.has_upcoming_coach_workout = next_workout_date is not None
        athlete.next_coach_workout_date = next_workout_date


def _apply_profile_update_to_user(target_user: User, profile_update: ProfileUpdate) -> None:
    if not target_user.profile:
        target_user.profile = Profile(user_id=target_user.id)

    update_data = profile_update.model_dump(exclude_unset=True)
    sports_in_payload = "sports" in update_data
    zones_in_payload = "zone_settings" in update_data
    auto_sync_in_payload = "auto_sync_integrations" in update_data
    incoming_sports = update_data.pop("sports", None)
    incoming_zone_settings = update_data.pop("zone_settings", None)
    incoming_auto_sync_integrations = update_data.pop("auto_sync_integrations", None)

    for field, value in update_data.items():
        setattr(target_user.profile, field, value)

    if sports_in_payload or zones_in_payload:
        existing_sports, existing_zone_settings, existing_auto_sync = _extract_profile_sports_and_zones(target_user.profile.sports)
        merged_sports = incoming_sports if sports_in_payload else existing_sports
        merged_zone_settings = incoming_zone_settings if zones_in_payload else existing_zone_settings
        merged_auto_sync = incoming_auto_sync_integrations if auto_sync_in_payload else existing_auto_sync
        target_user.profile.sports = {
            "items": merged_sports,
            "zone_settings": merged_zone_settings,
            "integration_settings": {
                "auto_sync_integrations": bool(merged_auto_sync),
            },
        }
    elif auto_sync_in_payload:
        existing_sports, existing_zone_settings, _ = _extract_profile_sports_and_zones(target_user.profile.sports)
        target_user.profile.sports = {
            "items": existing_sports,
            "zone_settings": existing_zone_settings,
            "integration_settings": {
                "auto_sync_integrations": bool(incoming_auto_sync_integrations),
            },
        }


async def _log_metric_change(db: AsyncSession, user_id: int, metric: str, old_value, new_value) -> None:
    """Insert a ProfileMetricHistory row when a metric actually changes."""
    if new_value is None:
        return
    if old_value == new_value:
        return
    db.add(ProfileMetricHistory(
        user_id=user_id,
        metric=metric,
        value=new_value,
        recorded_at=datetime.utcnow(),
    ))


async def _get_athlete_coach_summaries(db: AsyncSession, athlete: User) -> list[CoachSummaryOut]:
    athlete_org_ids = [
        membership.organization_id
        for membership in (athlete.organization_memberships or [])
        if membership.role == RoleEnum.athlete.value and membership.status == "active"
    ]
    if not athlete_org_ids:
        return []

    rows = await db.execute(
        select(
            User.id,
            User.email,
            Profile.first_name,
            Profile.last_name,
            Organization.id,
            Organization.name,
        )
        .join(OrganizationMember, OrganizationMember.user_id == User.id)
        .join(Organization, Organization.id == OrganizationMember.organization_id)
        .outerjoin(Profile, Profile.user_id == User.id)
        .where(
            OrganizationMember.organization_id.in_(athlete_org_ids),
            OrganizationMember.role == RoleEnum.coach.value,
            OrganizationMember.status == "active",
            User.id != athlete.id,
        )
    )

    by_coach_id: dict[int, dict] = {}
    for coach_id, email, first_name, last_name, org_id, org_name in rows.all():
        existing = by_coach_id.get(coach_id)
        if existing is None:
            existing = {
                "id": coach_id,
                "email": email,
                "first_name": first_name,
                "last_name": last_name,
                "organization_ids": [],
                "organization_names": [],
            }
            by_coach_id[coach_id] = existing

        if org_id not in existing["organization_ids"]:
            existing["organization_ids"].append(org_id)
        if org_name and org_name not in existing["organization_names"]:
            existing["organization_names"].append(org_name)

    return [CoachSummaryOut(**payload) for payload in by_coach_id.values()]


@router.get("/me", response_model=UserOut)
async def get_me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    # Need to load organization_memberships eagerly or lazy load will trigger.
    # get_current_user implementation might need check.
    _normalize_user_for_response(current_user)
    response_payload = UserOut.model_validate(current_user)
    if current_user.role == RoleEnum.athlete:
        response_payload.coaches = await _get_athlete_coach_summaries(db, current_user)
    return response_payload


@router.get("/athletes", response_model=list[AthleteOut])
async def get_athletes(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[AthleteOut]:
    if current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail="Only coaches can view athletes")

    # Get orgs where I am a coach
    my_org_ids = [
        m.organization_id for m in current_user.organization_memberships 
        if m.role == RoleEnum.coach.value and m.status == 'active'
    ]

    if not my_org_ids:
        return []

    # Get athletes in these orgs
    # Query: Users who have membership in these orgs with role=athlete and status=active
    stmt = (
        select(User)
        .join(OrganizationMember, OrganizationMember.user_id == User.id)
        .where(
            OrganizationMember.organization_id.in_(my_org_ids),
            OrganizationMember.role == RoleEnum.athlete.value, # or just role athlete? User role or member role? 
            # Usually member role should match user role effectively or be specific.
            # Let's rely on User.role being athlete OR member role being athlete.
            # User.role is global. Member role is context specific. 
            OrganizationMember.status == 'active'
        )
        .distinct()
        .options(selectinload(User.profile))
    )
    
    result = await db.execute(stmt)
    athletes = result.scalars().all()
    for athlete in athletes:
        _normalize_user_for_response(athlete)
    await _annotate_athletes_with_upcoming_workout_status(db, current_user.id, athletes)
    return athletes


@router.get("/athletes/pending", response_model=list[AthleteOut])
async def get_pending_athletes(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[AthleteOut]:
    if current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail="Only coaches can view pending athletes")

    my_org_ids = [
        m.organization_id for m in current_user.organization_memberships 
        if m.role == RoleEnum.coach.value and m.status == 'active'
    ]

    if not my_org_ids:
        return []

    stmt = (
        select(User)
        .join(OrganizationMember, OrganizationMember.user_id == User.id)
        .where(
            OrganizationMember.organization_id.in_(my_org_ids),
            OrganizationMember.status.in_(["pending", "pending_approval"])
        )
        .distinct()
        .options(selectinload(User.profile))
    )

    result = await db.execute(stmt)
    athletes = result.scalars().all()
    for athlete in athletes:
        _normalize_user_for_response(athlete)
    return athletes


@router.post("/athletes/{athlete_id}/approve", response_model=dict)
async def approve_athlete(
    athlete_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail="Only coaches can approve athletes")
        
    my_org_ids = [
        m.organization_id for m in current_user.organization_memberships 
        if m.role == RoleEnum.coach.value and m.status == 'active'
    ]
    
    if not my_org_ids:
        raise HTTPException(status_code=400, detail="You are not an active coach in any organization")

    # Find the pending membership
    stmt = select(OrganizationMember).where(
        OrganizationMember.user_id == athlete_id,
        OrganizationMember.organization_id.in_(my_org_ids),
        OrganizationMember.status.in_(["pending", "pending_approval"])
    )
    
    member = await db.scalar(stmt)
    if not member:
        raise HTTPException(status_code=404, detail="Pending athlete not found in your organizations")
        
    member.status = "active"
    await db.commit()
    return {"message": "Athlete approved"}


@router.post("/athletes/{athlete_id}/reject", response_model=dict)
async def reject_athlete(
    athlete_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail="Only coaches can reject athletes")
        
    my_org_ids = [
        m.organization_id for m in current_user.organization_memberships 
        if m.role == RoleEnum.coach.value and m.status == 'active'
    ]
    
    stmt = select(OrganizationMember).where(
        OrganizationMember.user_id == athlete_id,
        OrganizationMember.organization_id.in_(my_org_ids)
    )
    
    member = await db.scalar(stmt)
    if not member:
        raise HTTPException(status_code=404, detail="Athlete not found in your organizations")
        
    member.status = "rejected"
    await db.commit()
    return {"message": "Athlete rejected"}


@router.get("/athletes/{athlete_id}", response_model=AthleteOut)
async def get_athlete_details(
    athlete_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AthleteOut:
    if current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail="Only coaches can view athlete details")

    my_org_ids = [
        m.organization_id for m in current_user.organization_memberships 
        if m.role == RoleEnum.coach.value and m.status == 'active'
    ]

    stmt = select(User).join(OrganizationMember).where(
        User.id == athlete_id,
        OrganizationMember.organization_id.in_(my_org_ids),
        OrganizationMember.status == 'active'
    ).options(selectinload(User.profile))
    
    athlete = await db.scalar(stmt)
    if not athlete:
         raise HTTPException(status_code=404, detail="Athlete not found in your organizations")

    _normalize_user_for_response(athlete)
    await _annotate_athletes_with_upcoming_workout_status(db, current_user.id, [athlete])

    return athlete


@router.put('/athletes/{athlete_id}/profile', response_model=AthleteOut)
async def update_athlete_profile_endpoint(
    athlete_id: int,
    profile_update: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AthleteOut:
    if current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail='Only coaches can update athlete profiles')

    shared_org_ids = await get_shared_org_ids(db, current_user.id, athlete_id)
    if not shared_org_ids:
        raise HTTPException(status_code=403, detail='Not authorized to update this athlete profile')

    athlete = await db.scalar(
        select(User)
        .where(User.id == athlete_id)
        .options(selectinload(User.profile))
    )
    if not athlete:
        raise HTTPException(status_code=404, detail='Athlete not found')

    old_ftp = athlete.profile.ftp if athlete.profile else None
    old_weight = athlete.profile.weight if athlete.profile else None
    _apply_profile_update_to_user(athlete, profile_update)
    await _log_metric_change(db, athlete_id, "ftp", old_ftp, athlete.profile.ftp)
    await _log_metric_change(db, athlete_id, "weight", old_weight, athlete.profile.weight)
    db.add(athlete)
    await db.commit()
    await db.refresh(athlete)

    _normalize_user_for_response(athlete)
    await _annotate_athletes_with_upcoming_workout_status(db, current_user.id, [athlete])
    return athlete


@router.get('/athletes/{athlete_id}/permissions', response_model=AthletePermissionOut)
async def get_athlete_permissions_endpoint(
    athlete_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AthletePermissionOut:
    if current_user.role == RoleEnum.coach:
        shared_org_ids = await get_shared_org_ids(db, current_user.id, athlete_id)
        if not shared_org_ids and athlete_id != current_user.id:
            raise HTTPException(status_code=403, detail='Not authorized to view this athlete settings')
        permissions = await get_athlete_permissions(db, athlete_id, coach_id=current_user.id)
    else:
        if athlete_id != current_user.id:
            raise HTTPException(status_code=403, detail='Not authorized to view this athlete settings')
        permissions = await get_athlete_permissions(db, athlete_id)

    return AthletePermissionOut(
        athlete_id=athlete_id,
        permissions=AthletePermissionSettings(**permissions)
    )


@router.get('/athlete-permissions', response_model=list[AthletePermissionOut])
async def list_athlete_permissions_for_coach(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[AthletePermissionOut]:
    if current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail='Only coaches can view athlete permissions')

    my_org_ids = [
        m.organization_id for m in current_user.organization_memberships
        if m.role == RoleEnum.coach.value and m.status == 'active'
    ]
    if not my_org_ids:
        return []

    athlete_ids_stmt = select(OrganizationMember.user_id).where(
        OrganizationMember.organization_id.in_(my_org_ids),
        OrganizationMember.role == RoleEnum.athlete.value,
        OrganizationMember.status == 'active'
    )
    athlete_ids_res = await db.execute(athlete_ids_stmt)
    athlete_ids = list(set(athlete_ids_res.scalars().all()))

    out: list[AthletePermissionOut] = []
    for athlete_id in athlete_ids:
        permissions = await get_athlete_permissions(db, athlete_id, coach_id=current_user.id)
        out.append(AthletePermissionOut(
            athlete_id=athlete_id,
            permissions=AthletePermissionSettings(**permissions)
        ))

    return out


@router.put('/athletes/{athlete_id}/permissions', response_model=AthletePermissionOut)
async def update_athlete_permissions_endpoint(
    athlete_id: int,
    payload: AthletePermissionUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AthletePermissionOut:
    if current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail='Only coaches can update athlete permissions')

    shared_org_ids = await get_shared_org_ids(db, current_user.id, athlete_id)
    if not shared_org_ids and athlete_id != current_user.id:
        raise HTTPException(status_code=403, detail='Not authorized to update this athlete settings')

    existing = await get_athlete_permissions(db, athlete_id, coach_id=current_user.id)
    incoming = payload.model_dump(exclude_unset=True)
    next_permissions = {
        'allow_delete_activities': bool(incoming.get('allow_delete_activities', existing['allow_delete_activities'])),
        'allow_delete_workouts': bool(incoming.get('allow_delete_workouts', existing['allow_delete_workouts'])),
        'allow_edit_workouts': bool(incoming.get('allow_edit_workouts', existing['allow_edit_workouts'])),
    }

    updated_orgs = await set_athlete_permissions_for_shared_orgs(
        db,
        coach_id=current_user.id,
        athlete_id=athlete_id,
        permissions=next_permissions,
    )
    if updated_orgs == 0 and athlete_id != current_user.id:
        raise HTTPException(status_code=403, detail='Not authorized to update this athlete settings')

    return AthletePermissionOut(
        athlete_id=athlete_id,
        permissions=AthletePermissionSettings(**next_permissions)
    )

@router.post("/invite", response_model=InviteLinkResponse)
async def create_invite(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> InviteLinkResponse:
    if current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail="Only coaches can create invites")

    my_memberships = [
        m for m in current_user.organization_memberships 
        if m.role == RoleEnum.coach.value and m.status == 'active'
    ]

    if not my_memberships:
        raise HTTPException(status_code=400, detail="You are not an active coach in any organization")

    # Pick first org for now
    target_org_id = my_memberships[0].organization_id
    
    result = await db.execute(select(Organization).where(Organization.id == target_org_id))
    org = result.scalar_one()

    if not org.code:
        org.code = str(uuid.uuid4())[:8]
        await db.commit()
        await db.refresh(org)

    base_url = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000")
    invite_url = f"{base_url}/invite/{org.code}"
    return InviteLinkResponse(invite_token=org.code, invite_url=invite_url)


@router.post("/invite-by-email", response_model=InviteByEmailResponse)
async def invite_existing_athlete_by_email(
    payload: InviteByEmailRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> InviteByEmailResponse:
    if current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail="Only coaches can invite athletes")

    my_memberships = [
        m for m in current_user.organization_memberships
        if m.role == RoleEnum.coach.value and m.status == 'active'
    ]
    if not my_memberships:
        raise HTTPException(status_code=400, detail="You are not an active coach in any organization")

    target_org_id = my_memberships[0].organization_id
    org = await db.scalar(select(Organization).where(Organization.id == target_org_id))
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    if not org.code:
        org.code = str(uuid.uuid4())[:8]
        await db.commit()
        await db.refresh(org)

    base_url = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000")
    invite_url = f"{base_url}/invite/{org.code}"

    target_email = str(payload.email).strip().lower()
    target_user = await db.scalar(select(User).where(User.email == target_email))

    if not target_user:
        return InviteByEmailResponse(
            email=target_email,
            existing_user=False,
            invite_url=invite_url,
            status="not_found",
            message="No account with this email exists yet. Share the invite link so they can register and join.",
        )

    if target_user.id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot invite yourself")

    existing_membership = await db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.user_id == target_user.id,
            OrganizationMember.organization_id == org.id,
        )
    )

    if existing_membership:
        if existing_membership.status == "active":
            return InviteByEmailResponse(
                email=target_email,
                existing_user=True,
                invite_url=invite_url,
                status="already_active",
                message="This athlete is already active in your organization.",
            )
        if existing_membership.status in {"pending", "pending_approval", "rejected"}:
            existing_membership.status = "pending"
            existing_membership.role = RoleEnum.athlete.value
            await db.commit()
            return InviteByEmailResponse(
                email=target_email,
                existing_user=True,
                invite_url=invite_url,
                status="pending",
                message="Invitation sent. The athlete is now pending approval.",
            )

    db.add(
        OrganizationMember(
            user_id=target_user.id,
            organization_id=org.id,
            role=RoleEnum.athlete.value,
            status="pending",
        )
    )
    await db.commit()

    return InviteByEmailResponse(
        email=target_email,
        existing_user=True,
        invite_url=invite_url,
        status="pending",
        message="Invitation sent. The athlete is now pending approval.",
    )


@router.post("/change-password", response_model=dict)
async def change_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    if verify_password(payload.new_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="New password must be different from the current password")

    current_user.password_hash = get_password_hash(payload.new_password)
    await db.commit()
    return {"message": "Password updated"}


@router.post("/organization/invitations/{organization_id}/respond", response_model=dict)
async def respond_to_organization_invitation(
    organization_id: int,
    payload: InvitationRespondRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    membership = await db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.user_id == current_user.id,
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.role == RoleEnum.athlete.value,
        )
    )
    if not membership:
        raise HTTPException(status_code=404, detail="Invitation not found")

    if payload.action == "accept":
        if membership.status == "active":
            return {"message": "You are already active in this organization", "status": "active"}
        membership.status = "active"
        await db.commit()
        return {"message": "Invitation accepted. You are now active in this organization.", "status": "active"}

    if membership.status == "active":
        raise HTTPException(status_code=400, detail="Cannot decline an active organization membership")

    membership.status = "rejected"
    await db.commit()
    return {"message": "Invitation declined", "status": "rejected"}


@router.get("/organizations/discover", response_model=OrganizationDiscoverOut)
async def discover_organizations(
    query: str | None = Query(default=None, min_length=1, max_length=120),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OrganizationDiscoverOut:
    if current_user.role != RoleEnum.athlete:
        raise HTTPException(status_code=403, detail="Only athletes can discover organizations")

    org_query = select(Organization).order_by(Organization.name.asc())
    if query:
        like_term = f"%{query.strip()}%"
        org_query = org_query.where(
            or_(Organization.name.ilike(like_term), Organization.description.ilike(like_term))
        )

    organizations = (await db.execute(org_query.limit(100))).scalars().all()
    if not organizations:
        return OrganizationDiscoverOut(items=[])

    org_ids = [org.id for org in organizations]

    membership_rows = (
        await db.execute(
            select(OrganizationMember.organization_id, OrganizationMember.status)
            .where(
                OrganizationMember.user_id == current_user.id,
                OrganizationMember.organization_id.in_(org_ids),
            )
        )
    ).all()
    my_status_by_org: dict[int, str] = {org_id: status for org_id, status in membership_rows}

    coach_rows = (
        await db.execute(
            select(
                OrganizationMember.organization_id,
                User.id,
                User.email,
                Profile.first_name,
                Profile.last_name,
            )
            .join(User, User.id == OrganizationMember.user_id)
            .outerjoin(Profile, Profile.user_id == User.id)
            .where(
                OrganizationMember.organization_id.in_(org_ids),
                OrganizationMember.role == RoleEnum.coach.value,
                OrganizationMember.status == "active",
            )
            .order_by(Profile.first_name.asc().nulls_last(), Profile.last_name.asc().nulls_last(), User.email.asc())
        )
    ).all()

    coaches_by_org: dict[int, list[OrganizationCoachOut]] = {org_id: [] for org_id in org_ids}
    for org_id, coach_id, email, first_name, last_name in coach_rows:
        coaches_by_org.setdefault(org_id, []).append(
            OrganizationCoachOut(
                id=coach_id,
                email=email,
                first_name=first_name,
                last_name=last_name,
            )
        )

    items = [
        OrganizationDiscoverItemOut(
            id=org.id,
            name=org.name,
            description=org.description,
            picture=org.picture,
            coaches=coaches_by_org.get(org.id, []),
            my_membership_status=my_status_by_org.get(org.id),
        )
        for org in organizations
    ]

    return OrganizationDiscoverOut(items=items)


@router.post("/organization/request-join", response_model=dict)
async def request_join_organization(
    payload: JoinOrganizationRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if current_user.role != RoleEnum.athlete:
        raise HTTPException(status_code=403, detail="Only athletes can request organization membership")

    org = await db.scalar(select(Organization).where(Organization.id == payload.organization_id))
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    membership = await db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.user_id == current_user.id,
            OrganizationMember.organization_id == org.id,
        )
    )

    if membership:
        if membership.role != RoleEnum.athlete.value:
            raise HTTPException(status_code=400, detail="Membership role is incompatible with athlete join request")
        if membership.status == "active":
            return {"message": "You are already an active member", "status": "active"}
        membership.status = "pending_approval"
    else:
        db.add(
            OrganizationMember(
                user_id=current_user.id,
                organization_id=org.id,
                role=RoleEnum.athlete.value,
                status="pending_approval",
            )
        )

    await db.commit()
    return {"message": "Join request sent. Waiting for coach approval.", "status": "pending_approval"}


@router.put("/profile", response_model=UserOut)
async def update_profile(
    profile_update: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    old_ftp = current_user.profile.ftp if current_user.profile else None
    old_weight = current_user.profile.weight if current_user.profile else None
    _apply_profile_update_to_user(current_user, profile_update)
    await _log_metric_change(db, current_user.id, "ftp", old_ftp, current_user.profile.ftp)
    await _log_metric_change(db, current_user.id, "weight", old_weight, current_user.profile.weight)

    await db.commit()
    await db.refresh(current_user)
    _normalize_user_for_response(current_user)
    return current_user


@router.post("/organization", response_model=OrganizationOut)
async def create_organization(
    payload: OrganizationCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OrganizationOut:
    if current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail="Only coaches can create organizations")

    # Generate code
    new_code = str(uuid.uuid4())[:8]
    
    new_org = Organization(
        name=payload.name,
        description=payload.description,
        picture=payload.picture,
        code=new_code,
        settings_json={}
    )
    db.add(new_org)
    await db.flush()
    
    # Add creator as member
    member = OrganizationMember(
        user_id=current_user.id,
        organization_id=new_org.id,
        role=RoleEnum.coach.value, # Default role for creator
        status="active"
    )
    db.add(member)
    
    await db.commit()
    await db.refresh(new_org)
    return new_org


@router.put("/organization/join", response_model=UserOut)
async def join_organization(
    payload: JoinOrganization,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    # Find organization by code
    result = await db.execute(select(Organization).where(Organization.code == payload.code))
    org = result.scalar_one_or_none()
    
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Check if already member
    stmt = select(OrganizationMember).where(
        OrganizationMember.user_id == current_user.id,
        OrganizationMember.organization_id == org.id
    )
    existing_membership = await db.scalar(stmt)
    
    if existing_membership:
        # Already member, maybe update status if previously rejected?
        if existing_membership.status == "rejected":
            existing_membership.status = "active"
        elif existing_membership.status == "active":
            raise HTTPException(status_code=400, detail="You are already an active member of this organization")
        elif existing_membership.status in {"pending", "pending_approval"}:
            existing_membership.status = "active"
    else:
        # Create new membership
        new_membership = OrganizationMember(
            user_id=current_user.id,
            organization_id=org.id,
            role=current_user.role.value,
            status="active"
        )
        db.add(new_membership)
    
    await db.commit()
    await db.refresh(current_user)
    # Refresh memberships explicitly if needed
    result = await db.execute(select(User).where(User.id == current_user.id).options(selectinload(User.organization_memberships).selectinload(OrganizationMember.organization)))
    refreshed_user = result.scalar_one()
    _normalize_user_for_response(refreshed_user)
    return refreshed_user


@router.put("/organization", response_model=OrganizationOut)
async def update_organization(
    payload: OrganizationUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OrganizationOut:
    if current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail="Only coaches can update organization")

    # Find organization where user is coach
    stmt = select(Organization).join(OrganizationMember).where(
        OrganizationMember.user_id == current_user.id,
        OrganizationMember.role == RoleEnum.coach.value,
        OrganizationMember.status == 'active'
    )
    result = await db.execute(stmt)
    orgs = result.scalars().all()
    
    if not orgs:
         raise HTTPException(status_code=404, detail="You do not manage any organization")
    
    # Ideally should specify which org. For now, take first.
    org = orgs[0]

    for field, value in payload.dict(exclude_unset=True).items():
        setattr(org, field, value)

    # Ensure code exists
    if not org.code:
        org.code = str(uuid.uuid4())[:8]

    await db.commit()
    await db.refresh(org)
    return org


@router.delete("/organizations/{org_id}/membership")
async def leave_organization(
    org_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Current user leaves the specified organization."""
    stmt = select(OrganizationMember).where(
        OrganizationMember.user_id == current_user.id,
        OrganizationMember.organization_id == org_id,
    )
    membership = (await db.execute(stmt)).scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=404, detail="Membership not found")

    await db.delete(membership)
    await db.commit()
    return {"status": "ok", "detail": "Left organization"}


@router.delete("/organizations/{org_id}/members/{user_id}")
async def remove_organization_member(
    org_id: int,
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Coach removes a member from their organization."""
    if current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail="Only coaches can remove members")

    # Verify current user is an active coach in this org
    coach_stmt = select(OrganizationMember).where(
        OrganizationMember.user_id == current_user.id,
        OrganizationMember.organization_id == org_id,
        OrganizationMember.role == RoleEnum.coach.value,
        OrganizationMember.status == "active",
    )
    coach_membership = (await db.execute(coach_stmt)).scalar_one_or_none()
    if not coach_membership:
        raise HTTPException(status_code=403, detail="You are not a coach in this organization")

    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot remove yourself; use leave instead")

    target_stmt = select(OrganizationMember).where(
        OrganizationMember.user_id == user_id,
        OrganizationMember.organization_id == org_id,
    )
    target_membership = (await db.execute(target_stmt)).scalar_one_or_none()
    if not target_membership:
        raise HTTPException(status_code=404, detail="Member not found in this organization")

    await db.delete(target_membership)
    await db.commit()
    return {"status": "ok", "detail": "Member removed"}
