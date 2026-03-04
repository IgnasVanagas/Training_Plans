from typing import List, Optional
from datetime import date, timedelta, datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.database import get_db
from app.models import User, PlannedWorkout, Activity, ComplianceStatusEnum, RoleEnum, OrganizationMember, Profile
from app.schemas import PlannedWorkoutCreate, PlannedWorkoutUpdate, PlannedWorkoutOut, CalendarEvent
from app.auth import get_current_user
from app.services.compliance import match_and_score
from app.services.permissions import get_athlete_permissions

router = APIRouter(
    prefix="/calendar",
    tags=["calendar"]
)


def _escape_ics_text(value: str | None) -> str:
    if not value:
        return ""
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def _is_activity_deleted(activity: Activity) -> bool:
    streams = activity.streams
    if isinstance(streams, dict):
        meta = streams.get("_meta")
        if isinstance(meta, dict):
            return bool(meta.get("deleted"))
    return False

async def check_coach_access(coach_id: int, athlete_id: int, db: AsyncSession):
    """
    Verifies that the coach_id is indeed a coach of athlete_id via Organization.
    """
    # 1. Get organizations where coach_id is a coach
    stmt = select(OrganizationMember.organization_id).where(
        OrganizationMember.user_id == coach_id,
        OrganizationMember.role == RoleEnum.coach.value,
        OrganizationMember.status == 'active'
    )
    res = await db.execute(stmt)
    coach_org_ids = res.scalars().all()

    if not coach_org_ids:
        raise HTTPException(status_code=403, detail="You are not a coach in any organization")

    # 2. Check if athlete_id is in any of these organizations
    stmt = select(OrganizationMember).where(
        OrganizationMember.user_id == athlete_id,
        OrganizationMember.organization_id.in_(coach_org_ids),
        OrganizationMember.status == 'active' 
    )
    result = await db.execute(stmt)
    link = result.scalar_one_or_none()
    
    if not link:
        raise HTTPException(status_code=403, detail="Not authorized to access this athlete's data (not in your organization)")
    return True

@router.get("/", response_model=List[CalendarEvent])
async def get_calendar_events(
    start_date: date,
    end_date: date,
    athlete_id: Optional[int] = None,
    all_athletes: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    workouts = []
    activities = []
    
    # Base filter criteria
    target_user_ids = []

    if current_user.role == RoleEnum.coach and all_athletes:
        # Fetch all linked athletes + self
        # 1. Get coach orgs
        coach_orgs_subq = select(OrganizationMember.organization_id).where(
            OrganizationMember.user_id == current_user.id,
            OrganizationMember.role == RoleEnum.coach.value,
            OrganizationMember.status == 'active'
        )
        
        # 2. Get athletes in those orgs
        subq = select(OrganizationMember.user_id).where(
            OrganizationMember.organization_id.in_(coach_orgs_subq),
            OrganizationMember.role == RoleEnum.athlete.value,
            OrganizationMember.status == 'active'
        )
        res = await db.execute(subq)
        target_user_ids = list(res.scalars().all())
        target_user_ids.append(current_user.id)
        
    else:
        target_id = current_user.id
        if athlete_id is not None:
            if current_user.role != RoleEnum.coach:
                 raise HTTPException(status_code=403, detail="Only coaches can view other athletes' calendars")
            # Verify relationship
            if athlete_id != current_user.id:
                await check_coach_access(current_user.id, athlete_id, db)
            target_id = athlete_id
        target_user_ids = [target_id]

    # Fetch Workouts
    query_workouts = select(PlannedWorkout).where(
        and_(
            PlannedWorkout.date >= start_date,
            PlannedWorkout.date <= end_date,
            PlannedWorkout.user_id.in_(target_user_ids)
        )
    )
    res_workouts = await db.execute(query_workouts)
    workouts = res_workouts.scalars().all()

    # Fetch Activities (Use created_at cast to date or range)
    # Range is safer. start_date is inclusive. end_date is inclusive (likely).
    # datetime created_at >= start_date 00:00 AND < end_date+1 00:00
    
    start_dt = datetime.combine(start_date, datetime.min.time())
    end_dt = datetime.combine(end_date, datetime.max.time())
    
    query_activities = select(Activity).where(
        and_(
            Activity.created_at >= start_dt,
            Activity.created_at <= end_dt,
            Activity.athlete_id.in_(target_user_ids)
        )
    )
    res_activities = await db.execute(query_activities)
    activities = res_activities.scalars().all()

    visible_activity_ids = {activity.id for activity in activities if not _is_activity_deleted(activity)}
    workout_by_matched_activity_id = {
        workout.matched_activity_id: workout
        for workout in workouts
        if workout.matched_activity_id is not None
    }

    creator_ids = {workout.created_by_user_id for workout in workouts if workout.created_by_user_id is not None}
    creator_by_id: dict[int, tuple[str, Optional[str], Optional[str]]] = {}
    if creator_ids:
        creator_result = await db.execute(
            select(User.id, User.email)
            .where(User.id.in_(creator_ids))
        )
        email_by_id = {row[0]: row[1] for row in creator_result.all()}

        profile_result = await db.execute(
            select(Profile.user_id, Profile.first_name, Profile.last_name)
            .where(Profile.user_id.in_(creator_ids))
        )
        for user_id, first_name, last_name in profile_result.all():
            creator_by_id[user_id] = (email_by_id.get(user_id, ""), first_name, last_name)

        for user_id, email in email_by_id.items():
            if user_id not in creator_by_id:
                creator_by_id[user_id] = (email, None, None)

    def _creator_payload(workout: PlannedWorkout) -> tuple[Optional[int], Optional[str], Optional[str]]:
        created_by_user_id = workout.created_by_user_id
        if created_by_user_id is None:
            return None, None, None

        creator = creator_by_id.get(created_by_user_id)
        if creator is None:
            return created_by_user_id, None, None

        email, first_name, last_name = creator
        created_by_name = f"{first_name or ''} {last_name or ''}".strip() if (first_name or last_name) else email
        return created_by_user_id, created_by_name, email

    events = []
    
    # Map Workouts
    for w in workouts:
        if w.matched_activity_id is not None and w.matched_activity_id in visible_activity_ids:
            continue
        created_by_user_id, created_by_name, created_by_email = _creator_payload(w)
        events.append(CalendarEvent(
            id=w.id,
            user_id=w.user_id,
            date=w.date,
            title=w.title,
            sport_type=w.sport_type,
            duration=float(w.planned_duration) if w.planned_duration else None,
            distance=w.planned_distance,
            is_planned=True,
            compliance_status=w.compliance_status,
            matched_activity_id=w.matched_activity_id,
            description=w.description,
            planned_intensity=w.planned_intensity,
            planned_duration=w.planned_duration,
            planned_distance=w.planned_distance,
            structure=w.structure,
            created_by_user_id=created_by_user_id,
            created_by_name=created_by_name,
            created_by_email=created_by_email,
            start_time=datetime.combine(w.date, datetime.min.time())
        ))

    # Map Activities
    for a in activities:
        if _is_activity_deleted(a):
            continue
        matched_workout = workout_by_matched_activity_id.get(a.id)
        created_by_user_id, created_by_name, created_by_email = (None, None, None)
        if matched_workout is not None:
            created_by_user_id, created_by_name, created_by_email = _creator_payload(matched_workout)
        events.append(CalendarEvent(
            id=a.id,
            user_id=a.athlete_id,
            date=a.created_at.date(), 
            title=a.filename or "Activity",
            sport_type=a.sport,
            duration=((a.duration / 60) if a.duration else 0), 
            distance=(a.distance / 1000) if a.distance else 0, 
            is_planned=False,
            compliance_status=matched_workout.compliance_status if matched_workout else None,
            matched_activity_id=matched_workout.matched_activity_id if matched_workout else None,
            description=matched_workout.description if matched_workout else None,
            planned_intensity=matched_workout.planned_intensity if matched_workout else None,
            planned_duration=matched_workout.planned_duration if matched_workout else None,
            planned_distance=matched_workout.planned_distance if matched_workout else None,
            structure=matched_workout.structure if matched_workout else None,
            created_by_user_id=created_by_user_id,
            created_by_name=created_by_name,
            created_by_email=created_by_email,
            avg_hr=a.average_hr,
            avg_watts=a.average_watts,
            avg_speed=a.avg_speed,
            start_time=a.created_at
        ))
        
    # Sort events by start_time descending (latest first)
    events.sort(key=lambda x: x.start_time or datetime.combine(x.date, datetime.min.time()), reverse=True)
        
    return events

@router.post("/", response_model=PlannedWorkoutOut)
async def create_workout(
    workout_in: PlannedWorkoutCreate,
    athlete_id: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    target_user_id = current_user.id

    if athlete_id is not None:
         if current_user.role != RoleEnum.coach:
             raise HTTPException(status_code=403, detail="Only coaches can assign workouts to athletes")
         if athlete_id != current_user.id:
             await check_coach_access(current_user.id, athlete_id, db)
             target_user_id = athlete_id

    new_workout = PlannedWorkout(
        user_id=target_user_id,
        created_by_user_id=current_user.id,
        **workout_in.model_dump()
    )
    db.add(new_workout)
    await db.commit()
    await db.refresh(new_workout)
    
    # Run compliance logic
    await match_and_score(db, target_user_id, new_workout.date)
    await db.refresh(new_workout)
    
    return new_workout

@router.patch("/{workout_id}", response_model=PlannedWorkoutOut)
async def update_workout(
    workout_id: int,
    workout_update: PlannedWorkoutUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # First fetch the workout to see who owns it
    stmt = select(PlannedWorkout).where(PlannedWorkout.id == workout_id)
    result = await db.execute(stmt)
    workout = result.scalars().first()
    
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found")
        
    # Check permissions
    if current_user.role == RoleEnum.coach:
        if workout.user_id != current_user.id:
            await check_coach_access(current_user.id, workout.user_id, db)
    else:
        if workout.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized to edit this workout")
        athlete_permissions = await get_athlete_permissions(db, workout.user_id)
        if not athlete_permissions.get("allow_edit_workouts", False):
            raise HTTPException(status_code=403, detail="Coach has not allowed workout editing")

    update_data = workout_update.model_dump(exclude_unset=True)
    
    original_date = workout.date
    new_date = update_data.get('date')
    
    for key, value in update_data.items():
        setattr(workout, key, value)
        
    db.add(workout)
    await db.commit()
    
    # If date changed, re-score both dates
    target_user_id = workout.user_id
    if new_date and new_date != original_date:
        await match_and_score(db, target_user_id, original_date)
        await match_and_score(db, target_user_id, new_date)
    else:
        # Re-score current date if details changed
        await match_and_score(db, target_user_id, workout.date)
        
    await db.refresh(workout)
    return workout

@router.delete("/{workout_id}")
async def delete_workout(
    workout_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(PlannedWorkout).where(PlannedWorkout.id == workout_id)
    result = await db.execute(stmt)
    workout = result.scalars().first()
    
    if not workout:
        return {"status": "success", "deleted": False}

    # Permission check
    if current_user.role == RoleEnum.coach:
        if workout.user_id != current_user.id:
            await check_coach_access(current_user.id, workout.user_id, db)
    else:
        if workout.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized")
            
    target_user_id = workout.user_id
    target_date = workout.date
    
    await db.delete(workout)
    await db.commit()
    
    # Re-score to clear compliance if needed (e.g. if an activity was matched to this)
    await match_and_score(db, target_user_id, target_date)
    
    return {"status": "success", "deleted": True}

@router.post("/{workout_id}/copy", response_model=PlannedWorkoutOut)
async def copy_workout(
    workout_id: int,
    target_date: date, 
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(PlannedWorkout).where(PlannedWorkout.id == workout_id)
    result = await db.execute(stmt)
    source_workout = result.scalars().first()
    
    if not source_workout:
        raise HTTPException(status_code=404, detail="Workout not found")
        
    # Permission check (can I read the source?)
    if source_workout.user_id != current_user.id:
         if current_user.role == RoleEnum.coach:
            await check_coach_access(current_user.id, source_workout.user_id, db)
         else:
            raise HTTPException(status_code=403, detail="Not authorized")

    target_user_id = source_workout.user_id

    new_workout = PlannedWorkout(
        user_id=target_user_id,
        created_by_user_id=current_user.id,
        date=target_date,
        title=source_workout.title,
        description=source_workout.description,
        sport_type=source_workout.sport_type,
        planned_duration=source_workout.planned_duration,
        planned_distance=source_workout.planned_distance,
        planned_intensity=source_workout.planned_intensity,
        compliance_status=ComplianceStatusEnum.planned
    )
    
    db.add(new_workout)
    await db.commit()
    await db.refresh(new_workout)
    
    await match_and_score(db, target_user_id, target_date)
    await db.refresh(new_workout)
    
    return new_workout


@router.get("/{workout_id}/download")
async def download_workout(
    workout_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(PlannedWorkout).where(PlannedWorkout.id == workout_id)
    result = await db.execute(stmt)
    workout = result.scalars().first()

    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found")

    if current_user.role == RoleEnum.coach:
        if workout.user_id != current_user.id:
            await check_coach_access(current_user.id, workout.user_id, db)
    else:
        if workout.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized")

    start_date = workout.date
    end_date = workout.date + timedelta(days=1)
    dtstamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")

    description_parts: list[str] = []
    if workout.description:
        description_parts.append(str(workout.description))
    if workout.sport_type:
        description_parts.append(f"Sport: {workout.sport_type}")
    if workout.planned_duration:
        description_parts.append(f"Duration: {workout.planned_duration} min")
    if workout.planned_distance:
        description_parts.append(f"Distance: {workout.planned_distance} km")
    if workout.planned_intensity:
        description_parts.append(f"Intensity: {workout.planned_intensity}")

    description = "\n".join(description_parts)
    title = workout.title or "Planned Workout"

    ics_content = "\r\n".join([
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Endurance//Planned Workout//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"UID:planned-workout-{workout.id}@endurance.local",
        f"DTSTAMP:{dtstamp}",
        f"DTSTART;VALUE=DATE:{start_date.strftime('%Y%m%d')}",
        f"DTEND;VALUE=DATE:{end_date.strftime('%Y%m%d')}",
        f"SUMMARY:{_escape_ics_text(title)}",
        f"DESCRIPTION:{_escape_ics_text(description)}",
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "END:VCALENDAR",
        ""
    ])

    filename = f"planned-workout-{workout.id}.ics"
    return Response(
        content=ics_content,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )
