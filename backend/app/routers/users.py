import os
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..database import get_db
from ..models import CoachAthleteLink, RoleEnum, User, Profile, Organization, OrganizationMember
from ..schemas import AthleteOut, InviteLinkResponse, UserOut, ProfileUpdate, OrganizationOut, OrganizationUpdate, JoinOrganization, OrganizationCreate, AthletePermissionOut, AthletePermissionUpdate, AthletePermissionSettings
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


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)) -> UserOut:
    # Need to load organization_memberships eagerly or lazy load will trigger.
    # get_current_user implementation might need check.
    _normalize_user_for_response(current_user)
    return current_user


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
            OrganizationMember.status == 'pending'
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
        OrganizationMember.status == 'pending'
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
    invite_url = f"{base_url}/join?code={org.code}"
    return InviteLinkResponse(invite_token=org.code, invite_url=invite_url)


@router.put("/profile", response_model=UserOut)
async def update_profile(
    profile_update: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    # Ensure profile exists
    if not current_user.profile:
        current_user.profile = Profile(user_id=current_user.id)
        db.add(current_user.profile)
    
    update_data = profile_update.model_dump(exclude_unset=True)
    sports_in_payload = "sports" in update_data
    zones_in_payload = "zone_settings" in update_data
    auto_sync_in_payload = "auto_sync_integrations" in update_data
    incoming_sports = update_data.pop("sports", None)
    incoming_zone_settings = update_data.pop("zone_settings", None)
    incoming_auto_sync_integrations = update_data.pop("auto_sync_integrations", None)

    # Update fields
    for field, value in update_data.items():
        setattr(current_user.profile, field, value)

    if sports_in_payload or zones_in_payload:
        existing_sports, existing_zone_settings, existing_auto_sync = _extract_profile_sports_and_zones(current_user.profile.sports)
        merged_sports = incoming_sports if sports_in_payload else existing_sports
        merged_zone_settings = incoming_zone_settings if zones_in_payload else existing_zone_settings
        merged_auto_sync = incoming_auto_sync_integrations if auto_sync_in_payload else existing_auto_sync
        current_user.profile.sports = {
            "items": merged_sports,
            "zone_settings": merged_zone_settings,
            "integration_settings": {
                "auto_sync_integrations": bool(merged_auto_sync),
            },
        }
    elif auto_sync_in_payload:
        existing_sports, existing_zone_settings, _ = _extract_profile_sports_and_zones(current_user.profile.sports)
        current_user.profile.sports = {
            "items": existing_sports,
            "zone_settings": existing_zone_settings,
            "integration_settings": {
                "auto_sync_integrations": bool(incoming_auto_sync_integrations),
            },
        }

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
             existing_membership.status = "pending"
        elif existing_membership.status == "active":
             raise HTTPException(status_code=400, detail="You are already an active member of this organization")
        # if pending, do nothing
    else:
        # Create new membership
        # Default role: athlete (unless user is coach? But usually joining implies athlete role or requires approval)
        # Requirement: "athlete enters the code ... and goes to pending status"
        # So we join as athlete or user's current role?
        # User has a global role "coach" or "athlete". Let's use that.
        new_membership = OrganizationMember(
            user_id=current_user.id,
            organization_id=org.id,
            role=current_user.role.value, # or "athlete" if coaches also join as athletes? No, usually use their role.
            status="pending"
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

    # Update fields
    for field, value in profile_update.dict(exclude_unset=True).items():
        setattr(current_user.profile, field, value)
    
    await db.commit()
    await db.refresh(current_user)
    
    return current_user
