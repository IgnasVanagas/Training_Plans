import uuid
from typing import Any, List, Optional
from datetime import date, timedelta, datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from sqlalchemy.orm import load_only

from app.database import get_db
from app.models import User, PlannedWorkout, Activity, ComplianceStatusEnum, RoleEnum, OrganizationMember, Profile, DayNote
from app.schemas import PlannedWorkoutCreate, PlannedWorkoutUpdate, PlannedWorkoutOut, CalendarEvent, DayNoteOut, DayNoteUpsert
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



def _estimate_planned_duration_minutes(structure: object) -> Optional[int]:
    if not isinstance(structure, list) or len(structure) == 0:
        return None

    def _node_seconds(node: object) -> float:
        if not isinstance(node, dict):
            return 0.0

        node_type = str(node.get("type") or "")
        if node_type == "repeat":
            repeats_raw = node.get("repeats")
            try:
                repeats = max(1, int(repeats_raw or 1))
            except (TypeError, ValueError):
                repeats = 1
            steps = node.get("steps")
            if not isinstance(steps, list):
                return 0.0
            child_total = sum(_node_seconds(step) for step in steps)
            return child_total * repeats

        if node_type != "block":
            return 0.0

        duration = node.get("duration")
        if not isinstance(duration, dict):
            return 0.0

        duration_type = str(duration.get("type") or "")
        value_raw = duration.get("value")
        try:
            value = float(value_raw or 0)
        except (TypeError, ValueError):
            return 0.0

        if value <= 0:
            return 0.0

        if duration_type == "time":
            return value

        return 0.0

    total_seconds = sum(_node_seconds(node) for node in structure)
    if total_seconds <= 0:
        return None
    return max(1, int(round(total_seconds / 60.0)))


def _extract_recurrence(workout: PlannedWorkout | None) -> Optional[dict[str, Any]]:
    if workout is None:
        return None
    planning_context = workout.planning_context if isinstance(workout.planning_context, dict) else {}
    recurrence = planning_context.get("recurrence") if isinstance(planning_context.get("recurrence"), dict) else None
    return recurrence


def _merge_planning_context(base_context: object, recurrence: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    next_context = dict(base_context) if isinstance(base_context, dict) else {}
    if recurrence is None:
        next_context.pop("recurrence", None)
    else:
        next_context["recurrence"] = recurrence
    return next_context or None


def _expand_weekly_recurrence_dates(start_date: date, recurrence: dict[str, Any]) -> list[date]:
    interval_weeks = max(1, int(recurrence.get("interval_weeks") or 1))
    weekdays = sorted({int(day) for day in recurrence.get("weekdays") or [start_date.weekday()]})
    if not weekdays:
        raise HTTPException(status_code=422, detail="Recurring workout rule requires at least one weekday")

    for weekday in weekdays:
        if weekday < 0 or weekday > 6:
            raise HTTPException(status_code=422, detail="Recurring workout weekdays must be between 0 and 6")

    span_weeks_raw = recurrence.get("span_weeks")
    end_date_raw = recurrence.get("end_date")
    if span_weeks_raw is None and end_date_raw is None:
        raise HTTPException(status_code=422, detail="Recurring workout rule requires span_weeks or end_date")

    if isinstance(end_date_raw, str):
        try:
            end_date = date.fromisoformat(end_date_raw)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Recurring workout end_date is invalid") from exc
    else:
        end_date = end_date_raw

    if end_date is None:
        span_weeks = max(1, int(span_weeks_raw or 1))
        end_date = start_date + timedelta(days=(span_weeks * 7) - 1)

    if end_date < start_date:
        raise HTTPException(status_code=422, detail="Recurring workout end date must be on or after the first workout date")

    exception_dates: set[date] = set()
    for value in recurrence.get("exception_dates") or []:
        if isinstance(value, str):
            try:
                exception_dates.add(date.fromisoformat(value))
            except ValueError as exc:
                raise HTTPException(status_code=422, detail="Recurring workout exception date is invalid") from exc
        elif isinstance(value, date):
            exception_dates.add(value)

    anchor_week_start = start_date - timedelta(days=start_date.weekday())
    dates: list[date] = []
    cursor = start_date
    while cursor <= end_date:
        week_index = ((cursor - anchor_week_start).days // 7)
        if week_index % interval_weeks == 0 and cursor.weekday() in weekdays and cursor not in exception_dates:
            dates.append(cursor)
        cursor += timedelta(days=1)

    if not dates:
        raise HTTPException(status_code=422, detail="Recurring workout rule produced no workout dates")
    if len(dates) > 366:
        raise HTTPException(status_code=422, detail="Recurring workout rule produced too many workouts")
    return dates


def _resolve_activity_local_date(activity: Activity) -> date:
    """
    Attempts to resolve the local start date from activity streams/metadata.
    Falls back to UTC created_at if unavailable.
    """
    try:
        if isinstance(activity.streams, dict):
            provider = activity.streams.get("provider_payload", {})
            if isinstance(provider, dict):
                # Check summary or detail
                candidates = []
                summary = provider.get("summary")
                if isinstance(summary, dict):
                    candidates.append(summary.get("start_date_local"))
                detail = provider.get("detail")
                if isinstance(detail, dict):
                    candidates.append(detail.get("start_date_local"))
                
                for candidate in candidates:
                    if candidate and isinstance(candidate, str):
                        # Format often: "2026-03-01T00:30:00Z" or similar
                        # We just want the date part
                        try:
                            # Handle T separator
                            dt_str = candidate.split("T")[0]
                            return date.fromisoformat(dt_str)
                        except ValueError:
                            pass
    except Exception:
        pass
    
    # Fallback to created_at (UTC)
    if activity.created_at:
        return activity.created_at.date()
    return date.today() # Should not happen if created_at is not null


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
        # Fetch only linked athletes for the coach team calendar.
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
    
    # We expand the search window by +/- 1 day to catch activities 
    # that might belong to the local date but are shifted in UTC.
    search_start_dt = datetime.combine(start_date - timedelta(days=1), datetime.min.time())
    search_end_dt = datetime.combine(end_date + timedelta(days=1), datetime.max.time())
    
    query_activities = (
        select(Activity)
        .options(load_only(
            Activity.id, Activity.athlete_id, Activity.filename, Activity.sport,
            Activity.created_at, Activity.distance, Activity.duration,
            Activity.avg_speed, Activity.average_hr, Activity.average_watts,
            Activity.duplicate_of_id,
        ))
        .where(
            Activity.created_at >= search_start_dt,
            Activity.created_at <= search_end_dt,
            Activity.athlete_id.in_(target_user_ids),
            Activity.duplicate_of_id.is_(None),
            Activity.is_deleted.is_(False),
        )
    )
    res_activities = await db.execute(query_activities)
    activities = res_activities.scalars().all()

    # Count duplicate recordings for each primary activity
    primary_ids = [a.id for a in activities]
    dup_count_map: dict[int, int] = {}
    if primary_ids:
        dup_counts_res = await db.execute(
            select(Activity.duplicate_of_id, func.count(Activity.id).label("cnt"))
            .where(Activity.duplicate_of_id.in_(primary_ids))
            .group_by(Activity.duplicate_of_id)
        )
        for row in dup_counts_res.all():
            dup_count_map[row[0]] = row[1]

    visible_activity_ids = {activity.id for activity in activities}
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
        duration_minutes = _estimate_planned_duration_minutes(w.structure)
        resolved_planned_duration = duration_minutes if duration_minutes is not None else w.planned_duration
        events.append(CalendarEvent(
            id=w.id,
            user_id=w.user_id,
            date=w.date,
            title=w.title,
            sport_type=w.sport_type,
            duration=float(resolved_planned_duration) if resolved_planned_duration else None,
            distance=w.planned_distance,
            is_planned=True,
            compliance_status=w.compliance_status,
            matched_activity_id=w.matched_activity_id,
            description=w.description,
            planned_intensity=w.planned_intensity,
            planned_duration=resolved_planned_duration,
            planned_distance=w.planned_distance,
            structure=w.structure,
            created_by_user_id=created_by_user_id,
            created_by_name=created_by_name,
            created_by_email=created_by_email,
            season_plan_id=w.season_plan_id,
            planning_context=w.planning_context,
            recurrence=_extract_recurrence(w),
            start_time=datetime.combine(w.date, datetime.min.time())
        ))

    # Map Activities
    for a in activities:
        matched_workout = workout_by_matched_activity_id.get(a.id)
        created_by_user_id, created_by_name, created_by_email = (None, None, None)
        if matched_workout is not None:
            created_by_user_id, created_by_name, created_by_email = _creator_payload(matched_workout)
        
        display_date = _resolve_activity_local_date(a)

        events.append(CalendarEvent(
            id=a.id,
            user_id=a.athlete_id,
            date=display_date, 
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
            season_plan_id=matched_workout.season_plan_id if matched_workout else None,
            planning_context=matched_workout.planning_context if matched_workout else None,
            recurrence=_extract_recurrence(matched_workout),
            avg_hr=a.average_hr,
            avg_watts=a.average_watts,
            avg_speed=a.avg_speed,
            duplicate_recordings_count=dup_count_map.get(a.id, 0) or None,
            start_time=a.created_at
        ))
        
    # Sort events by start_time descending (latest first)
    events.sort(key=lambda x: x.start_time or datetime.combine(x.date, datetime.min.time()), reverse=True)
        
    return events


@router.get("/recent-coach-workouts")
async def recent_coach_workouts(
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the coach's most recently planned workouts, deduplicated by title."""
    if current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail="Only coaches can access this endpoint")

    stmt = (
        select(PlannedWorkout)
        .where(PlannedWorkout.created_by_user_id == current_user.id)
        .order_by(PlannedWorkout.id.desc())
        .limit(limit * 5)  # fetch extra to account for dedup
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()

    seen_titles: set[str] = set()
    unique: list[dict] = []
    for pw in rows:
        key = (pw.title or "").strip().lower()
        if key in seen_titles:
            continue
        seen_titles.add(key)
        unique.append({
            "id": pw.id,
            "title": pw.title,
            "description": pw.description,
            "sport_type": pw.sport_type,
            "structure": pw.structure or [],
            "planned_duration": pw.planned_duration,
            "date": pw.date.isoformat() if pw.date else None,
            "tags": [],
            "is_favorite": False,
            "recurrence": _extract_recurrence(pw),
        })
        if len(unique) >= limit:
            break

    return unique


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

    payload = workout_in.model_dump()
    recurrence = payload.pop("recurrence", None)
    estimated_duration = _estimate_planned_duration_minutes(payload.get("structure"))
    if estimated_duration is not None:
        payload["planned_duration"] = estimated_duration

    occurrence_dates = [payload["date"]]
    recurrence_payload: Optional[dict[str, Any]] = None
    if isinstance(recurrence, dict):
        occurrence_dates = _expand_weekly_recurrence_dates(payload["date"], recurrence)
        recurrence_payload = {
            "frequency": "weekly",
            "interval_weeks": max(1, int(recurrence.get("interval_weeks") or 1)),
            "weekdays": sorted({int(day) for day in recurrence.get("weekdays") or []}),
            "span_weeks": recurrence.get("span_weeks"),
            "end_date": occurrence_dates[-1].isoformat(),
            "exception_dates": [
                value.isoformat() if isinstance(value, date) else str(value)
                for value in (recurrence.get("exception_dates") or [])
            ],
            "series_id": str(recurrence.get("series_id") or uuid.uuid4().hex),
            "anchor_date": payload["date"].isoformat(),
            "occurrences_total": len(occurrence_dates),
        }

    created_workouts: list[PlannedWorkout] = []
    for index, workout_date in enumerate(occurrence_dates, start=1):
        workout_payload = dict(payload)
        workout_payload["date"] = workout_date
        if recurrence_payload is not None:
            workout_payload["planning_context"] = _merge_planning_context(
                workout_payload.get("planning_context"),
                {
                    **recurrence_payload,
                    "occurrence_index": index,
                },
            )

        new_workout = PlannedWorkout(
            user_id=target_user_id,
            created_by_user_id=current_user.id,
            **workout_payload
        )
        db.add(new_workout)
        created_workouts.append(new_workout)

    await db.commit()
    for workout in created_workouts:
        await db.refresh(workout)

    for workout_date in {workout.date for workout in created_workouts}:
        await match_and_score(db, target_user_id, workout_date)

    primary_workout = created_workouts[0]
    await db.refresh(primary_workout)
    return primary_workout

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
        if not athlete_permissions.get("allow_edit_workouts", True):
            raise HTTPException(status_code=403, detail="Coach has not allowed workout editing")

    update_data = workout_update.model_dump(exclude_unset=True)
    recurrence = update_data.pop("recurrence", None) if "recurrence" in update_data else None

    if "structure" in update_data:
        estimated_duration = _estimate_planned_duration_minutes(update_data.get("structure"))
        if estimated_duration is not None:
            update_data["planned_duration"] = estimated_duration

    if "recurrence" in workout_update.model_fields_set:
        workout.planning_context = _merge_planning_context(workout.planning_context, recurrence)
    
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
        season_plan_id=source_workout.season_plan_id,
        planning_context=source_workout.planning_context,
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


# ── Day Notes ────────────────────────────────────────────────────────

async def _resolve_athlete_id(
    current_user: User,
    athlete_id: int | None,
    db: AsyncSession,
) -> int:
    """Return the effective athlete_id, checking coach access if needed."""
    if athlete_id is None:
        return current_user.id
    if athlete_id == current_user.id:
        return current_user.id
    if current_user.role == RoleEnum.coach:
        await check_coach_access(current_user.id, athlete_id, db)
        return athlete_id
    raise HTTPException(status_code=403, detail="Not authorized")


def _note_display_name(profile: Profile | None) -> str | None:
    if profile and (profile.first_name or profile.last_name):
        return " ".join(p for p in [profile.first_name, profile.last_name] if p).strip() or None
    return None


@router.get("/day-notes", response_model=list[DayNoteOut])
async def get_day_notes(
    date_str: str = Query(..., alias="date"),
    athlete_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_id = await _resolve_athlete_id(current_user, athlete_id, db)
    target_date = date.fromisoformat(date_str)

    rows = await db.execute(
        select(DayNote)
        .where(DayNote.athlete_id == target_id, DayNote.date == target_date)
        .order_by(DayNote.created_at)
    )
    notes = rows.scalars().all()

    results: list[DayNoteOut] = []
    for n in notes:
        author_profile = await db.scalar(
            select(Profile).where(Profile.user_id == n.author_id)
        )
        author_user = await db.scalar(select(User).where(User.id == n.author_id))
        results.append(DayNoteOut(
            id=n.id,
            athlete_id=n.athlete_id,
            author_id=n.author_id,
            author_name=_note_display_name(author_profile) or (author_user.email if author_user else None),
            author_role=author_user.role.value if author_user else None,
            date=n.date,
            content=n.content,
            created_at=n.created_at,
            updated_at=n.updated_at,
        ))
    return results


@router.get("/day-notes-range", response_model=list[DayNoteOut])
async def get_day_notes_range(
    start: str = Query(...),
    end: str = Query(...),
    athlete_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_id = await _resolve_athlete_id(current_user, athlete_id, db)
    start_date = date.fromisoformat(start)
    end_date = date.fromisoformat(end)

    rows = await db.execute(
        select(DayNote)
        .where(DayNote.athlete_id == target_id, DayNote.date >= start_date, DayNote.date <= end_date)
        .order_by(DayNote.date, DayNote.created_at)
    )
    notes = rows.scalars().all()

    author_cache: dict[int, tuple] = {}
    results: list[DayNoteOut] = []
    for n in notes:
        if n.author_id not in author_cache:
            author_profile = await db.scalar(select(Profile).where(Profile.user_id == n.author_id))
            author_user = await db.scalar(select(User).where(User.id == n.author_id))
            author_cache[n.author_id] = (
                _note_display_name(author_profile) or (author_user.email if author_user else None),
                author_user.role.value if author_user else None,
            )
        author_name, author_role = author_cache[n.author_id]
        results.append(DayNoteOut(
            id=n.id,
            athlete_id=n.athlete_id,
            author_id=n.author_id,
            author_name=author_name,
            author_role=author_role,
            date=n.date,
            content=n.content,
            created_at=n.created_at,
            updated_at=n.updated_at,
        ))
    return results


@router.put("/day-notes", response_model=DayNoteOut)
async def upsert_day_note(
    payload: DayNoteUpsert,
    date_str: str = Query(..., alias="date"),
    athlete_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_id = await _resolve_athlete_id(current_user, athlete_id, db)
    target_date = date.fromisoformat(date_str)

    existing = await db.scalar(
        select(DayNote).where(
            DayNote.athlete_id == target_id,
            DayNote.date == target_date,
            DayNote.author_id == current_user.id,
        )
    )

    if existing:
        existing.content = payload.content
        existing.updated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(existing)
        note = existing
    else:
        note = DayNote(
            athlete_id=target_id,
            author_id=current_user.id,
            date=target_date,
            content=payload.content,
        )
        db.add(note)
        await db.commit()
        await db.refresh(note)

    author_profile = await db.scalar(
        select(Profile).where(Profile.user_id == current_user.id)
    )
    return DayNoteOut(
        id=note.id,
        athlete_id=note.athlete_id,
        author_id=note.author_id,
        author_name=_note_display_name(author_profile) or current_user.email,
        author_role=current_user.role.value,
        date=note.date,
        content=note.content,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


@router.delete("/day-notes/{note_id}", status_code=204)
async def delete_day_note(
    note_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = await db.scalar(select(DayNote).where(DayNote.id == note_id))
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    # Author can always delete their own note; coaches can delete notes on their athletes
    if note.author_id != current_user.id:
        if current_user.role == RoleEnum.coach:
            await check_coach_access(current_user.id, note.athlete_id, db)
        else:
            raise HTTPException(status_code=403, detail="Not authorized")
    await db.delete(note)
    await db.commit()
