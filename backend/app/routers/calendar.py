import uuid
from typing import Any, List, Optional
from datetime import date, timedelta, datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import load_only

from app.database import get_db
from app.models import User, PlannedWorkout, PlannedWorkoutVersion, Activity, ComplianceStatusEnum, RoleEnum, OrganizationMember, Profile, DayNote, Organization
from app.schemas import PlannedWorkoutCreate, PlannedWorkoutUpdate, PlannedWorkoutOut, PlannedWorkoutVersionOut, PlannedWorkoutVersionDiffItemOut, CalendarEvent, DayNoteOut, DayNoteUpsert, CalendarShareSettingsOut, CalendarShareSettingsUpdate, CalendarApprovalSummaryOut, CalendarApprovalDecisionRequest, CalendarApprovalDecisionResponse, PublicCalendarResponse, PublicCalendarMetaOut
from app.auth import get_current_user
from app.services.compliance import match_and_score
from app.services.permissions import get_athlete_permissions, get_shared_org_ids, get_athlete_org_ids

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


CALENDAR_SHARE_DEFAULTS = {
    "enabled": False,
    "token": None,
    "include_completed": False,
    "include_descriptions": False,
}


def _normalize_calendar_share_settings(raw: object) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return dict(CALENDAR_SHARE_DEFAULTS)
    return {
        "enabled": bool(raw.get("enabled", False)),
        "token": str(raw.get("token") or "").strip() or None,
        "include_completed": bool(raw.get("include_completed", False)),
        "include_descriptions": bool(raw.get("include_descriptions", False)),
    }


def _approval_from_planning_context(planning_context: object) -> dict[str, Any] | None:
    if not isinstance(planning_context, dict):
        return None
    approval = planning_context.get("approval")
    if not isinstance(approval, dict):
        return None
    status = str(approval.get("status") or "").strip().lower()
    request_type = str(approval.get("request_type") or "").strip().lower()
    if status not in {"pending", "approved", "rejected"}:
        return None
    if request_type not in {"create", "update", "delete"}:
        return None
    return approval


def _approval_datetime(raw: object) -> datetime | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    normalized = raw.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def _strip_approval_context(planning_context: object) -> dict[str, Any] | None:
    if not isinstance(planning_context, dict):
        return None
    next_context = dict(planning_context)
    next_context.pop("approval", None)
    return next_context or None


def _set_approval_context(
    planning_context: object,
    *,
    status: str,
    request_type: str,
    requested_by_user_id: int,
    proposed_changes: dict[str, Any] | None = None,
) -> dict[str, Any]:
    next_context = dict(planning_context) if isinstance(planning_context, dict) else {}
    next_context["approval"] = {
        "status": status,
        "request_type": request_type,
        "requested_by_user_id": requested_by_user_id,
        "requested_at": datetime.utcnow().isoformat(),
        "proposed_changes": proposed_changes or None,
    }
    return next_context


def _serialize_proposed_changes(proposed_changes: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(proposed_changes, dict):
        return None
    serialized: dict[str, Any] = {}
    for key, value in proposed_changes.items():
        if isinstance(value, (date, datetime)):
            serialized[key] = value.isoformat()
        else:
            serialized[key] = value
    return serialized or None


async def _user_display_lookup(db: AsyncSession, user_ids: list[int]) -> dict[int, str]:
    if not user_ids:
        return {}
    unique_ids = list(set(user_ids))
    user_rows = await db.execute(select(User.id, User.email).where(User.id.in_(unique_ids)))
    email_by_id = {row[0]: row[1] for row in user_rows.all()}
    profile_rows = await db.execute(select(Profile.user_id, Profile.first_name, Profile.last_name).where(Profile.user_id.in_(unique_ids)))
    display_by_id = dict(email_by_id)
    for user_id, first_name, last_name in profile_rows.all():
        display_name = " ".join(part for part in [first_name, last_name] if part).strip()
        if display_name:
            display_by_id[user_id] = display_name
    return display_by_id


def _annotate_workout_with_approval(workout: PlannedWorkout, display_by_id: dict[int, str] | None = None) -> PlannedWorkout:
    approval = _approval_from_planning_context(workout.planning_context)
    if not approval:
        workout.approval_status = None
        workout.approval_request_type = None
        workout.approval_requested_by_user_id = None
        workout.approval_requested_by_name = None
        workout.approval_requested_at = None
        return workout

    requester_id = approval.get("requested_by_user_id")
    workout.approval_status = approval.get("status")
    workout.approval_request_type = approval.get("request_type")
    workout.approval_requested_by_user_id = requester_id if isinstance(requester_id, int) else None
    workout.approval_requested_by_name = display_by_id.get(requester_id) if display_by_id and isinstance(requester_id, int) else None
    workout.approval_requested_at = _approval_datetime(approval.get("requested_at"))
    return workout


async def _resolve_share_org_ids(db: AsyncSession, current_user: User, athlete_id: int) -> list[int]:
    if current_user.role == RoleEnum.coach and athlete_id != current_user.id:
        return await get_shared_org_ids(db, current_user.id, athlete_id)
    return await get_athlete_org_ids(db, athlete_id)


async def _get_calendar_share_settings(db: AsyncSession, athlete_id: int, org_ids: list[int]) -> dict[str, Any]:
    if not org_ids:
        return dict(CALENDAR_SHARE_DEFAULTS)
    orgs = (await db.execute(select(Organization).where(Organization.id.in_(org_ids)))).scalars().all()
    for org in orgs:
        settings = org.settings_json if isinstance(org.settings_json, dict) else {}
        share_map = settings.get("calendar_public_shares") if isinstance(settings.get("calendar_public_shares"), dict) else {}
        raw = share_map.get(str(athlete_id))
        if raw is not None:
            return _normalize_calendar_share_settings(raw)
    return dict(CALENDAR_SHARE_DEFAULTS)


async def _set_calendar_share_settings(db: AsyncSession, athlete_id: int, org_ids: list[int], payload: dict[str, Any]) -> dict[str, Any]:
    normalized = _normalize_calendar_share_settings(payload)
    if normalized["enabled"] and not normalized["token"]:
        normalized["token"] = uuid.uuid4().hex
    if not org_ids:
        return normalized
    orgs = (await db.execute(select(Organization).where(Organization.id.in_(org_ids)))).scalars().all()
    for org in orgs:
        settings = org.settings_json if isinstance(org.settings_json, dict) else {}
        share_map = settings.get("calendar_public_shares") if isinstance(settings.get("calendar_public_shares"), dict) else {}
        share_map[str(athlete_id)] = normalized
        settings["calendar_public_shares"] = share_map
        org.settings_json = settings
        db.add(org)
    await db.commit()
    return normalized


async def _find_share_by_token(db: AsyncSession, token: str) -> tuple[int, dict[str, Any]] | None:
    orgs = (await db.execute(select(Organization))).scalars().all()
    for org in orgs:
        settings = org.settings_json if isinstance(org.settings_json, dict) else {}
        share_map = settings.get("calendar_public_shares") if isinstance(settings.get("calendar_public_shares"), dict) else {}
        for athlete_key, raw in share_map.items():
            normalized = _normalize_calendar_share_settings(raw)
            if normalized["enabled"] and normalized.get("token") == token:
                try:
                    return int(athlete_key), normalized
                except (TypeError, ValueError):
                    continue
    return None



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


_WORKOUT_VERSION_FIELDS = [
    "date",
    "title",
    "description",
    "sport_type",
    "planned_duration",
    "planned_distance",
    "planned_intensity",
    "structure",
    "season_plan_id",
    "planning_context",
]


def _snapshot_workout(workout: PlannedWorkout) -> dict[str, Any]:
    snapshot: dict[str, Any] = {}
    for field in _WORKOUT_VERSION_FIELDS:
        value = getattr(workout, field)
        snapshot[field] = value.isoformat() if isinstance(value, date) else value
    return snapshot


def _compute_workout_diff(before: dict[str, Any] | None, after: dict[str, Any] | None) -> list[dict[str, Any]]:
    left = before or {}
    right = after or {}
    fields = sorted(set(left.keys()) | set(right.keys()))
    diff: list[dict[str, Any]] = []
    for field in fields:
        if left.get(field) != right.get(field):
            diff.append({"field": field, "before": left.get(field), "after": right.get(field)})
    return diff


async def _record_workout_version(
    db: AsyncSession,
    *,
    workout_id: int,
    workout_user_id: int,
    action: str,
    changed_by_user_id: int | None,
    before_snapshot: dict[str, Any] | None,
    after_snapshot: dict[str, Any] | None,
    note: str | None = None,
) -> None:
    max_version_row = await db.execute(
        select(func.max(PlannedWorkoutVersion.version_number)).where(PlannedWorkoutVersion.workout_id == workout_id)
    )
    current_max = int(max_version_row.scalar() or 0)
    version = PlannedWorkoutVersion(
        workout_id=workout_id,
        workout_user_id=workout_user_id,
        version_number=current_max + 1,
        action=action,
        changed_by_user_id=changed_by_user_id,
        before_snapshot=before_snapshot,
        after_snapshot=after_snapshot,
        diff_json=_compute_workout_diff(before_snapshot, after_snapshot),
        note=note,
    )
    db.add(version)


def _apply_workout_snapshot(workout: PlannedWorkout, snapshot: dict[str, Any]) -> None:
    for field in _WORKOUT_VERSION_FIELDS:
        if field not in snapshot:
            continue
        value = snapshot.get(field)
        if field == "date" and isinstance(value, str):
            setattr(workout, field, date.fromisoformat(value))
        else:
            setattr(workout, field, value)


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
    training_load_map: dict[int, float] = {}
    local_date_map: dict[int, date] = {}
    moving_time_map: dict[int, float] = {}
    if primary_ids:
        dup_counts_res = await db.execute(
            select(Activity.duplicate_of_id, func.count(Activity.id).label("cnt"))
            .where(Activity.duplicate_of_id.in_(primary_ids))
            .group_by(Activity.duplicate_of_id)
        )
        for row in dup_counts_res.all():
            dup_count_map[row[0]] = row[1]

        meta_res = await db.execute(
            select(
                Activity.id,
                Activity.streams['_meta'].label('meta'),
                Activity.streams['stats'].label('stats_data'),
                Activity.streams['provider_payload']['summary']['start_date_local'].label('summary_local'),
                Activity.streams['provider_payload']['detail']['start_date_local'].label('detail_local'),
                Activity.streams['provider_payload']['summary']['moving_time'].label('summary_moving_time'),
            )
            .where(Activity.id.in_(primary_ids))
        )
        for row in meta_res.all():
            m = row.meta if isinstance(row.meta, dict) else {}
            aerobic = float(m.get('aerobic_load') or 0)
            anaerobic = float(m.get('anaerobic_load') or 0)
            total = round(aerobic + anaerobic, 1)
            if total > 0:
                training_load_map[row.id] = total
            stats = row.stats_data if isinstance(row.stats_data, dict) else {}
            mt = (
                (stats.get('total_timer_time') if isinstance(stats, dict) else None)
                or (float(row.summary_moving_time) if row.summary_moving_time else None)
            )
            if mt:
                moving_time_map[row.id] = float(mt)
            # Resolve local date from provider_payload JSONB paths
            for candidate in (row.summary_local, row.detail_local):
                if candidate and isinstance(candidate, str):
                    try:
                        local_date_map[row.id] = date.fromisoformat(candidate.split("T")[0])
                        break
                    except (ValueError, AttributeError):
                        pass

    def _activity_display_date(activity: Activity) -> date:
        return local_date_map.get(activity.id) or (activity.created_at.date() if activity.created_at else date.today())

    visible_activity_ids = {
        activity.id
        for activity in activities
        if start_date <= _activity_display_date(activity) <= end_date
    }
    workout_by_matched_activity_id = {
        workout.matched_activity_id: workout
        for workout in workouts
        if workout.matched_activity_id is not None
    }

    creator_ids = {workout.created_by_user_id for workout in workouts if workout.created_by_user_id is not None}
    approval_requester_ids = {
        approval.get("requested_by_user_id")
        for workout in workouts
        for approval in [_approval_from_planning_context(workout.planning_context)]
        if isinstance(approval, dict) and isinstance(approval.get("requested_by_user_id"), int)
    }
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

    requester_name_by_id = await _user_display_lookup(db, [requester_id for requester_id in approval_requester_ids if isinstance(requester_id, int)])

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
            approval_status=(_approval_from_planning_context(w.planning_context) or {}).get("status"),
            approval_request_type=(_approval_from_planning_context(w.planning_context) or {}).get("request_type"),
            approval_requested_by_user_id=(_approval_from_planning_context(w.planning_context) or {}).get("requested_by_user_id"),
            approval_requested_by_name=requester_name_by_id.get((_approval_from_planning_context(w.planning_context) or {}).get("requested_by_user_id")),
            approval_requested_at=_approval_datetime((_approval_from_planning_context(w.planning_context) or {}).get("requested_at")),
            start_time=datetime.combine(w.date, datetime.min.time())
        ))

    # Map Activities
    for a in activities:
        matched_workout = workout_by_matched_activity_id.get(a.id)
        created_by_user_id, created_by_name, created_by_email = (None, None, None)
        if matched_workout is not None:
            created_by_user_id, created_by_name, created_by_email = _creator_payload(matched_workout)

        display_date = _activity_display_date(a)
        if display_date < start_date or display_date > end_date:
            continue

        events.append(CalendarEvent(
            id=a.id,
            user_id=a.athlete_id,
            date=display_date, 
            title=a.filename or "Activity",
            sport_type=a.sport,
            duration=((moving_time_map.get(a.id) or a.duration or 0) / 60),
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
            approval_status=(_approval_from_planning_context(matched_workout.planning_context) or {}).get("status") if matched_workout else None,
            approval_request_type=(_approval_from_planning_context(matched_workout.planning_context) or {}).get("request_type") if matched_workout else None,
            approval_requested_by_user_id=(_approval_from_planning_context(matched_workout.planning_context) or {}).get("requested_by_user_id") if matched_workout else None,
            approval_requested_by_name=requester_name_by_id.get((_approval_from_planning_context(matched_workout.planning_context) or {}).get("requested_by_user_id")) if matched_workout else None,
            approval_requested_at=_approval_datetime((_approval_from_planning_context(matched_workout.planning_context) or {}).get("requested_at")) if matched_workout else None,
            avg_hr=a.average_hr,
            avg_watts=a.average_watts,
            avg_speed=a.avg_speed,
            duplicate_recordings_count=dup_count_map.get(a.id, 0) or None,
            training_load=training_load_map.get(a.id),
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

    # Include legacy rows where created_by_user_id is null but the workout
    # belongs to an athlete currently linked to this coach.
    coach_orgs_subq = select(OrganizationMember.organization_id).where(
        OrganizationMember.user_id == current_user.id,
        OrganizationMember.role == RoleEnum.coach.value,
        OrganizationMember.status == 'active',
    )
    athlete_ids_subq = select(OrganizationMember.user_id).where(
        OrganizationMember.organization_id.in_(coach_orgs_subq),
        OrganizationMember.role == RoleEnum.athlete.value,
        OrganizationMember.status == 'active',
    )

    stmt = (
        select(PlannedWorkout)
        .where(
            or_(
                PlannedWorkout.created_by_user_id == current_user.id,
                and_(
                    PlannedWorkout.created_by_user_id.is_(None),
                    PlannedWorkout.user_id.in_(athlete_ids_subq),
                ),
            )
        )
        .order_by(PlannedWorkout.id.desc())
        .limit(limit * 8)  # fetch extra to account for dedup + fallback rows
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


@router.get("/sharing/settings", response_model=list[CalendarShareSettingsOut])
async def list_calendar_share_settings(
    athlete_id: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role == RoleEnum.coach:
        coach_org_ids = [
            membership.organization_id
            for membership in current_user.organization_memberships
            if membership.role == RoleEnum.coach.value and membership.status == 'active'
        ]
        if not coach_org_ids:
            return []
        athlete_rows = await db.execute(
            select(OrganizationMember.user_id)
            .where(
                OrganizationMember.organization_id.in_(coach_org_ids),
                OrganizationMember.role == RoleEnum.athlete.value,
                OrganizationMember.status == 'active',
            )
        )
        athlete_ids = sorted(set(athlete_rows.scalars().all()))
        if athlete_id is not None:
            athlete_ids = [value for value in athlete_ids if value == athlete_id]
    else:
        athlete_ids = [current_user.id]
        athlete_id = current_user.id

    rows: list[CalendarShareSettingsOut] = []
    for target_athlete_id in athlete_ids:
        if current_user.role == RoleEnum.coach:
            org_ids = await get_shared_org_ids(db, current_user.id, target_athlete_id)
        else:
            permissions = await get_athlete_permissions(db, target_athlete_id)
            if not permissions.get("allow_public_calendar_share", True):
                rows.append(CalendarShareSettingsOut(athlete_id=target_athlete_id))
                continue
            org_ids = await get_athlete_org_ids(db, target_athlete_id)
        share = await _get_calendar_share_settings(db, target_athlete_id, org_ids)
        rows.append(CalendarShareSettingsOut(athlete_id=target_athlete_id, **share))
    return rows


@router.put("/sharing/settings", response_model=CalendarShareSettingsOut)
async def update_calendar_share_settings(
    payload: CalendarShareSettingsUpdate,
    athlete_id: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target_athlete_id = athlete_id or current_user.id
    if current_user.role == RoleEnum.coach:
        org_ids = await get_shared_org_ids(db, current_user.id, target_athlete_id)
        if not org_ids:
            raise HTTPException(status_code=403, detail="Not authorized to manage this athlete's shared calendar")
    else:
        if target_athlete_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized to manage this shared calendar")
        permissions = await get_athlete_permissions(db, target_athlete_id)
        if not permissions.get("allow_public_calendar_share", True):
            raise HTTPException(status_code=403, detail="Coach has not allowed public calendar sharing")
        org_ids = await get_athlete_org_ids(db, target_athlete_id)

    existing = await _get_calendar_share_settings(db, target_athlete_id, org_ids)
    next_payload = {
        **existing,
        **payload.model_dump(exclude_unset=True),
    }
    share = await _set_calendar_share_settings(db, target_athlete_id, org_ids, next_payload)
    return CalendarShareSettingsOut(athlete_id=target_athlete_id, **share)


@router.get("/public/{token}", response_model=PublicCalendarResponse)
async def get_public_calendar(
    token: str,
    start_date: date,
    end_date: date,
    db: AsyncSession = Depends(get_db),
):
    share_match = await _find_share_by_token(db, token)
    if share_match is None:
        raise HTTPException(status_code=404, detail="Shared calendar not found")

    athlete_id, share_settings = share_match
    athlete_permissions = await get_athlete_permissions(db, athlete_id)
    if not athlete_permissions.get("allow_public_calendar_share", True):
        raise HTTPException(status_code=404, detail="Shared calendar not found")
    athlete = await db.scalar(select(User).where(User.id == athlete_id))
    athlete_profile = await db.scalar(select(Profile).where(Profile.user_id == athlete_id))
    athlete_name = _note_display_name(athlete_profile) or (athlete.email if athlete else "Athlete")

    workout_rows = (
        await db.execute(
            select(PlannedWorkout)
            .where(
                PlannedWorkout.user_id == athlete_id,
                PlannedWorkout.date >= start_date,
                PlannedWorkout.date <= end_date,
            )
            .order_by(PlannedWorkout.date.asc(), PlannedWorkout.id.asc())
        )
    ).scalars().all()

    events: list[CalendarEvent] = []
    for workout in workout_rows:
        approval = _approval_from_planning_context(workout.planning_context)
        if approval and approval.get("status") == "pending":
            continue
        events.append(CalendarEvent(
            id=workout.id,
            user_id=athlete_id,
            date=workout.date,
            title=workout.title,
            sport_type=workout.sport_type,
            duration=float(workout.planned_duration) if workout.planned_duration else None,
            is_planned=True,
            description=workout.description if share_settings.get("include_descriptions") else None,
            planned_duration=workout.planned_duration,
            planned_distance=workout.planned_distance,
            planned_intensity=workout.planned_intensity,
            compliance_status=workout.compliance_status,
            start_time=datetime.combine(workout.date, datetime.min.time()),
        ))

    if share_settings.get("include_completed"):
        activity_rows = (
            await db.execute(
                select(Activity)
                .options(load_only(
                    Activity.id, Activity.athlete_id, Activity.filename, Activity.sport,
                    Activity.created_at, Activity.distance, Activity.duration,
                    Activity.avg_speed, Activity.average_hr, Activity.average_watts,
                ))
                .where(
                    Activity.athlete_id == athlete_id,
                    Activity.created_at >= datetime.combine(start_date - timedelta(days=1), datetime.min.time()),
                    Activity.created_at <= datetime.combine(end_date + timedelta(days=1), datetime.max.time()),
                    Activity.duplicate_of_id.is_(None),
                    Activity.is_deleted.is_(False),
                )
            )
        ).scalars().all()
        for activity in activity_rows:
            display_date = activity.created_at.date() if activity.created_at else start_date
            if display_date < start_date or display_date > end_date:
                continue
            events.append(CalendarEvent(
                id=activity.id,
                user_id=athlete_id,
                date=display_date,
                title=activity.filename or "Activity",
                sport_type=activity.sport,
                duration=(activity.duration or 0) / 60 if activity.duration else None,
                distance=(activity.distance / 1000) if activity.distance else None,
                is_planned=False,
                avg_hr=activity.average_hr,
                avg_watts=activity.average_watts,
                avg_speed=activity.avg_speed,
                start_time=activity.created_at,
            ))

    events.sort(key=lambda row: row.start_time or datetime.combine(row.date, datetime.min.time()))
    return PublicCalendarResponse(
        meta=PublicCalendarMetaOut(
            athlete_name=athlete_name,
            include_completed=bool(share_settings.get("include_completed")),
            include_descriptions=bool(share_settings.get("include_descriptions")),
        ),
        events=events,
    )


@router.get("/public/{token}/ics")
async def download_public_calendar_ics(
    token: str,
    start_date: date,
    end_date: date,
    db: AsyncSession = Depends(get_db),
):
    public_calendar = await get_public_calendar(token=token, start_date=start_date, end_date=end_date, db=db)

    dtstamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Endurance//Shared Calendar//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ]
    for event in public_calendar.events:
        if not event.is_planned:
            continue
        event_end = event.date + timedelta(days=1)
        lines.extend([
            "BEGIN:VEVENT",
            f"UID:shared-planned-workout-{event.id}@endurance.local",
            f"DTSTAMP:{dtstamp}",
            f"DTSTART;VALUE=DATE:{event.date.strftime('%Y%m%d')}",
            f"DTEND;VALUE=DATE:{event_end.strftime('%Y%m%d')}",
            f"SUMMARY:{_escape_ics_text(event.title)}",
            f"DESCRIPTION:{_escape_ics_text(event.description or '')}",
            "STATUS:CONFIRMED",
            "END:VEVENT",
        ])
    lines.extend(["END:VCALENDAR", ""])
    return Response(
        content="\r\n".join(lines),
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="shared-calendar.ics"'},
    )


@router.get("/approvals", response_model=list[CalendarApprovalSummaryOut])
async def list_calendar_approvals(
    athlete_id: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail="Only coaches can review calendar approvals")

    coach_org_ids = [
        membership.organization_id
        for membership in current_user.organization_memberships
        if membership.role == RoleEnum.coach.value and membership.status == 'active'
    ]
    if not coach_org_ids:
        return []

    athlete_rows = await db.execute(
        select(OrganizationMember.user_id).where(
            OrganizationMember.organization_id.in_(coach_org_ids),
            OrganizationMember.role == RoleEnum.athlete.value,
            OrganizationMember.status == 'active',
        )
    )
    athlete_ids = sorted(set(athlete_rows.scalars().all()))
    if athlete_id is not None:
        athlete_ids = [value for value in athlete_ids if value == athlete_id]
    if not athlete_ids:
        return []

    workouts = (
        await db.execute(
            select(PlannedWorkout)
            .where(PlannedWorkout.user_id.in_(athlete_ids))
            .order_by(PlannedWorkout.date.asc(), PlannedWorkout.id.asc())
        )
    ).scalars().all()

    display_by_id = await _user_display_lookup(db, athlete_ids + [current_user.id] + [
        approval.get("requested_by_user_id")
        for workout in workouts
        for approval in [_approval_from_planning_context(workout.planning_context)]
        if isinstance(approval, dict) and isinstance(approval.get("requested_by_user_id"), int)
    ])

    rows: list[CalendarApprovalSummaryOut] = []
    for workout in workouts:
        approval = _approval_from_planning_context(workout.planning_context)
        if not approval or approval.get("status") != "pending":
            continue
        requester_id = approval.get("requested_by_user_id")
        if not isinstance(requester_id, int):
            continue
        rows.append(CalendarApprovalSummaryOut(
            workout_id=workout.id,
            athlete_id=workout.user_id,
            athlete_name=display_by_id.get(workout.user_id, f"Athlete {workout.user_id}"),
            title=workout.title,
            date=workout.date,
            sport_type=workout.sport_type,
            request_type=approval.get("request_type"),
            requested_by_user_id=requester_id,
            requested_by_name=display_by_id.get(requester_id),
            requested_at=_approval_datetime(approval.get("requested_at")) or datetime.utcnow(),
            proposed_changes=_serialize_proposed_changes(approval.get("proposed_changes")),
        ))
    return rows


@router.post("/{workout_id}/review", response_model=CalendarApprovalDecisionResponse)
async def review_calendar_approval(
    workout_id: int,
    payload: CalendarApprovalDecisionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail="Only coaches can review calendar approvals")

    workout = await db.scalar(select(PlannedWorkout).where(PlannedWorkout.id == workout_id))
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found")
    if workout.user_id != current_user.id:
        await check_coach_access(current_user.id, workout.user_id, db)

    approval = _approval_from_planning_context(workout.planning_context)
    if not approval or approval.get("status") != "pending":
        raise HTTPException(status_code=400, detail="This workout has no pending approval request")

    request_type = approval.get("request_type")
    proposed_changes = approval.get("proposed_changes") if isinstance(approval.get("proposed_changes"), dict) else {}

    if payload.decision == 'reject':
        if request_type == 'create':
            target_user_id = workout.user_id
            target_date = workout.date
            before_snapshot = _snapshot_workout(workout)
            await _record_workout_version(
                db,
                workout_id=workout.id,
                workout_user_id=workout.user_id,
                action="reject_create",
                changed_by_user_id=current_user.id,
                before_snapshot=before_snapshot,
                after_snapshot=None,
            )
            await db.delete(workout)
            await db.commit()
            await match_and_score(db, target_user_id, target_date)
            return CalendarApprovalDecisionResponse(workout_id=workout_id, status='rejected', deleted=True)

        before_snapshot = _snapshot_workout(workout)
        workout.planning_context = _strip_approval_context(workout.planning_context)
        db.add(workout)
        await _record_workout_version(
            db,
            workout_id=workout.id,
            workout_user_id=workout.user_id,
            action="reject_request",
            changed_by_user_id=current_user.id,
            before_snapshot=before_snapshot,
            after_snapshot=_snapshot_workout(workout),
        )
        await db.commit()
        await db.refresh(workout)
        return CalendarApprovalDecisionResponse(workout_id=workout_id, status='rejected', deleted=False)

    before_snapshot = _snapshot_workout(workout)
    original_date = workout.date
    if request_type == 'update':
        for key, value in proposed_changes.items():
            if key == 'date' and isinstance(value, str):
                setattr(workout, key, date.fromisoformat(value))
            else:
                setattr(workout, key, value)
    elif request_type == 'delete':
        target_user_id = workout.user_id
        target_date = workout.date
        await _record_workout_version(
            db,
            workout_id=workout.id,
            workout_user_id=workout.user_id,
            action="approve_delete",
            changed_by_user_id=current_user.id,
            before_snapshot=before_snapshot,
            after_snapshot=None,
        )
        await db.delete(workout)
        await db.commit()
        await match_and_score(db, target_user_id, target_date)
        return CalendarApprovalDecisionResponse(workout_id=workout_id, status='approved', deleted=True)

    workout.planning_context = _strip_approval_context(workout.planning_context)
    db.add(workout)
    await _record_workout_version(
        db,
        workout_id=workout.id,
        workout_user_id=workout.user_id,
        action="approve_update" if request_type == "update" else "approve_create",
        changed_by_user_id=current_user.id,
        before_snapshot=before_snapshot,
        after_snapshot=_snapshot_workout(workout),
    )
    await db.commit()
    await db.refresh(workout)
    if workout.date != original_date:
        await match_and_score(db, workout.user_id, original_date)
    await match_and_score(db, workout.user_id, workout.date)
    return CalendarApprovalDecisionResponse(workout_id=workout_id, status='approved', deleted=False)


@router.get("/{workout_id}/history", response_model=list[PlannedWorkoutVersionOut])
async def get_workout_history(
    workout_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    workout = await db.scalar(select(PlannedWorkout).where(PlannedWorkout.id == workout_id))
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found")

    if current_user.role == RoleEnum.coach:
        if workout.user_id != current_user.id:
            await check_coach_access(current_user.id, workout.user_id, db)
    elif workout.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    versions = (
        await db.execute(
            select(PlannedWorkoutVersion)
            .where(PlannedWorkoutVersion.workout_id == workout_id)
            .order_by(PlannedWorkoutVersion.version_number.desc())
        )
    ).scalars().all()

    changed_by_ids = [row.changed_by_user_id for row in versions if isinstance(row.changed_by_user_id, int)]
    display_by_id = await _user_display_lookup(db, changed_by_ids)

    rows: list[PlannedWorkoutVersionOut] = []
    for row in versions:
        diff_items = [
            PlannedWorkoutVersionDiffItemOut(
                field=str(item.get("field")),
                before=item.get("before"),
                after=item.get("after"),
            )
            for item in (row.diff_json or [])
            if isinstance(item, dict) and item.get("field")
        ]
        rows.append(
            PlannedWorkoutVersionOut(
                id=row.id,
                workout_id=row.workout_id,
                version_number=row.version_number,
                action=row.action,
                changed_by_user_id=row.changed_by_user_id,
                changed_by_name=display_by_id.get(row.changed_by_user_id) if row.changed_by_user_id else None,
                changed_at=row.changed_at,
                note=row.note,
                diff=diff_items,
            )
        )
    return rows


@router.post("/{workout_id}/history/{version_id}/rollback", response_model=PlannedWorkoutOut)
async def rollback_workout_version(
    workout_id: int,
    version_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail="Only coaches can rollback workout versions")

    workout = await db.scalar(select(PlannedWorkout).where(PlannedWorkout.id == workout_id))
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found")
    if workout.user_id != current_user.id:
        await check_coach_access(current_user.id, workout.user_id, db)

    version = await db.scalar(
        select(PlannedWorkoutVersion).where(
            PlannedWorkoutVersion.id == version_id,
            PlannedWorkoutVersion.workout_id == workout_id,
        )
    )
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    if not isinstance(version.after_snapshot, dict):
        raise HTTPException(status_code=400, detail="Selected version has no restorable snapshot")

    before_snapshot = _snapshot_workout(workout)
    original_date = workout.date
    _apply_workout_snapshot(workout, version.after_snapshot)

    db.add(workout)
    await _record_workout_version(
        db,
        workout_id=workout.id,
        workout_user_id=workout.user_id,
        action="rollback",
        changed_by_user_id=current_user.id,
        before_snapshot=before_snapshot,
        after_snapshot=_snapshot_workout(workout),
        note=f"rollback_to_version:{version.version_number}",
    )
    await db.commit()
    await db.refresh(workout)

    if workout.date != original_date:
        await match_and_score(db, workout.user_id, original_date)
    await match_and_score(db, workout.user_id, workout.date)

    _annotate_workout_with_approval(workout, {current_user.id: current_user.email})
    return workout


@router.post("/", response_model=PlannedWorkoutOut)
async def create_workout(
    workout_in: PlannedWorkoutCreate,
    athlete_id: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    target_user_id = current_user.id
    athlete_permissions = None

    if athlete_id is not None:
         if current_user.role != RoleEnum.coach:
             raise HTTPException(status_code=403, detail="Only coaches can assign workouts to athletes")
         if athlete_id != current_user.id:
             await check_coach_access(current_user.id, athlete_id, db)
             target_user_id = athlete_id
    elif current_user.role != RoleEnum.coach:
        athlete_permissions = await get_athlete_permissions(db, current_user.id)

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
        if current_user.role != RoleEnum.coach and athlete_permissions and athlete_permissions.get("require_workout_approval", False):
            new_workout.planning_context = _set_approval_context(
                new_workout.planning_context,
                status="pending",
                request_type="create",
                requested_by_user_id=current_user.id,
            )
        db.add(new_workout)
        created_workouts.append(new_workout)

    await db.flush()
    for workout in created_workouts:
        await _record_workout_version(
            db,
            workout_id=workout.id,
            workout_user_id=workout.user_id,
            action="create",
            changed_by_user_id=current_user.id,
            before_snapshot=None,
            after_snapshot=_snapshot_workout(workout),
        )

    await db.commit()
    for workout in created_workouts:
        await db.refresh(workout)

    for workout_date in {workout.date for workout in created_workouts}:
        await match_and_score(db, target_user_id, workout_date)

    primary_workout = created_workouts[0]
    _annotate_workout_with_approval(primary_workout, {current_user.id: current_user.email})
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
        if athlete_permissions.get("require_workout_approval", False):
            if _approval_from_planning_context(workout.planning_context):
                raise HTTPException(status_code=409, detail="This workout already has a pending approval request")
            before_snapshot = _snapshot_workout(workout)
            update_data = workout_update.model_dump(exclude_unset=True)
            recurrence = update_data.pop("recurrence", None) if "recurrence" in update_data else None
            if "structure" in update_data:
                estimated_duration = _estimate_planned_duration_minutes(update_data.get("structure"))
                if estimated_duration is not None:
                    update_data["planned_duration"] = estimated_duration
            if "recurrence" in workout_update.model_fields_set:
                update_data["planning_context"] = _merge_planning_context(workout.planning_context, recurrence)
            workout.planning_context = _set_approval_context(
                workout.planning_context,
                status="pending",
                request_type="update",
                requested_by_user_id=current_user.id,
                proposed_changes=_serialize_proposed_changes(update_data),
            )
            db.add(workout)
            await _record_workout_version(
                db,
                workout_id=workout.id,
                workout_user_id=workout.user_id,
                action="request_update",
                changed_by_user_id=current_user.id,
                before_snapshot=before_snapshot,
                after_snapshot=_snapshot_workout(workout),
            )
            await db.commit()
            await db.refresh(workout)
            _annotate_workout_with_approval(workout, {current_user.id: current_user.email})
            return workout

    update_data = workout_update.model_dump(exclude_unset=True)
    recurrence = update_data.pop("recurrence", None) if "recurrence" in update_data else None

    if "structure" in update_data:
        estimated_duration = _estimate_planned_duration_minutes(update_data.get("structure"))
        if estimated_duration is not None:
            update_data["planned_duration"] = estimated_duration

    if "recurrence" in workout_update.model_fields_set:
        workout.planning_context = _merge_planning_context(workout.planning_context, recurrence)
    
    before_snapshot = _snapshot_workout(workout)
    original_date = workout.date
    new_date = update_data.get('date')
    
    for key, value in update_data.items():
        setattr(workout, key, value)
        
    db.add(workout)
    await _record_workout_version(
        db,
        workout_id=workout.id,
        workout_user_id=workout.user_id,
        action="update",
        changed_by_user_id=current_user.id,
        before_snapshot=before_snapshot,
        after_snapshot=_snapshot_workout(workout),
    )
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
    _annotate_workout_with_approval(workout, {current_user.id: current_user.email})
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
        athlete_permissions = await get_athlete_permissions(db, current_user.id)
        if not athlete_permissions.get("allow_delete_workouts", True):
            raise HTTPException(status_code=403, detail="Coach has not allowed plan deletion")
        if athlete_permissions.get("require_workout_approval", False):
            if _approval_from_planning_context(workout.planning_context):
                raise HTTPException(status_code=409, detail="This workout already has a pending approval request")
            before_snapshot = _snapshot_workout(workout)
            workout.planning_context = _set_approval_context(
                workout.planning_context,
                status="pending",
                request_type="delete",
                requested_by_user_id=current_user.id,
            )
            db.add(workout)
            await _record_workout_version(
                db,
                workout_id=workout.id,
                workout_user_id=workout.user_id,
                action="request_delete",
                changed_by_user_id=current_user.id,
                before_snapshot=before_snapshot,
                after_snapshot=_snapshot_workout(workout),
            )
            await db.commit()
            return {"status": "pending_approval", "deleted": False}

    target_user_id = workout.user_id
    target_date = workout.date
    before_snapshot = _snapshot_workout(workout)

    await _record_workout_version(
        db,
        workout_id=workout.id,
        workout_user_id=workout.user_id,
        action="delete",
        changed_by_user_id=current_user.id,
        before_snapshot=before_snapshot,
        after_snapshot=None,
    )
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
    elif current_user.role != RoleEnum.coach:
        athlete_permissions = await get_athlete_permissions(db, current_user.id)
        if not athlete_permissions.get("allow_edit_workouts", True):
            raise HTTPException(status_code=403, detail="Coach has not allowed workout editing")

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
    if current_user.role != RoleEnum.coach:
        athlete_permissions = await get_athlete_permissions(db, current_user.id)
        if athlete_permissions.get("require_workout_approval", False):
            new_workout.planning_context = _set_approval_context(
                new_workout.planning_context,
                status="pending",
                request_type="create",
                requested_by_user_id=current_user.id,
            )
    
    db.add(new_workout)
    await db.flush()
    await _record_workout_version(
        db,
        workout_id=new_workout.id,
        workout_user_id=new_workout.user_id,
        action="copy_create",
        changed_by_user_id=current_user.id,
        before_snapshot=None,
        after_snapshot=_snapshot_workout(new_workout),
        note=f"copied_from_workout_id:{source_workout.id}",
    )
    await db.commit()
    await db.refresh(new_workout)
    
    await match_and_score(db, target_user_id, target_date)
    await db.refresh(new_workout)
    
    return new_workout


# ── FIT Workout Export ───────────────────────────────────────────────

def _build_fit_workout(workout) -> bytes:
    """Convert a PlannedWorkout into a Garmin-compatible FIT workout file."""
    from fit_tool.fit_file_builder import FitFileBuilder
    from fit_tool.profile.messages.file_id_message import FileIdMessage
    from fit_tool.profile.messages.workout_message import WorkoutMessage
    from fit_tool.profile.messages.workout_step_message import WorkoutStepMessage
    from fit_tool.profile.profile_type import (
        FileType, Manufacturer, Sport, Intensity,
        WorkoutStepDuration, WorkoutStepTarget,
    )

    sport_map = {
        "running": Sport.RUNNING, "run": Sport.RUNNING,
        "cycling": Sport.CYCLING, "bike": Sport.CYCLING, "biking": Sport.CYCLING,
        "swimming": Sport.SWIMMING, "swim": Sport.SWIMMING,
        "hiking": Sport.HIKING, "walking": Sport.WALKING,
        "rowing": Sport.ROWING,
    }
    sport_type = sport_map.get((workout.sport_type or "").lower(), Sport.GENERIC)

    intensity_map = {
        "warmup": Intensity.WARMUP,
        "work": Intensity.ACTIVE,
        "recovery": Intensity.RECOVERY,
        "cooldown": Intensity.COOLDOWN,
    }

    flat_steps: list[dict] = []

    def flatten(node: dict):
        ntype = node.get("type", "")
        if ntype == "repeat":
            repeats = max(1, int(node.get("repeats", 1) or 1))
            first_idx = len(flat_steps)
            for child in node.get("steps") or []:
                flatten(child)
            # Add repeat step referencing back to first child
            flat_steps.append({
                "_repeat": True,
                "back_to": first_idx,
                "repeats": repeats,
            })
        else:
            flat_steps.append(node)

    structure = workout.structure if isinstance(workout.structure, list) else []
    for node in structure:
        if isinstance(node, dict):
            flatten(node)

    builder = FitFileBuilder(auto_define=True)

    file_id = FileIdMessage()
    file_id.type = FileType.WORKOUT
    file_id.manufacturer = Manufacturer.DEVELOPMENT.value
    file_id.product = 0
    file_id.serial_number = 12345
    builder.add(file_id)

    wm = WorkoutMessage()
    wm.workout_name = (workout.title or "Workout")[:40]
    wm.sport = sport_type
    wm.num_valid_steps = len(flat_steps)
    builder.add(wm)

    for idx, step in enumerate(flat_steps):
        sm = WorkoutStepMessage()
        sm.message_index = idx

        if step.get("_repeat"):
            sm.intensity = Intensity.REST
            sm.duration_type = WorkoutStepDuration.REPEAT_UNTIL_STEPS_CMPLT
            sm.duration_step = step["back_to"]
            sm.target_repeat_steps = step["repeats"]
            sm.target_type = WorkoutStepTarget.OPEN
        else:
            category = step.get("category", "work")
            sm.intensity = intensity_map.get(category, Intensity.ACTIVE)
            sm.workout_step_name = (step.get("description") or category.capitalize())[:16]

            dur = step.get("duration") or {}
            dur_type = dur.get("type", "")
            dur_value = dur.get("value")

            if dur_type == "time" and dur_value:
                sm.duration_type = WorkoutStepDuration.TIME
                sm.duration_time = float(dur_value) * 1000  # seconds → milliseconds
            elif dur_type == "distance" and dur_value:
                sm.duration_type = WorkoutStepDuration.DISTANCE
                sm.duration_distance = float(dur_value) * 100  # meters → centimeters (FIT unit)
            else:
                sm.duration_type = WorkoutStepDuration.OPEN

            target = step.get("target") or {}
            tgt_type = target.get("type", "open")

            if tgt_type == "heart_rate_zone" and target.get("zone"):
                sm.target_type = WorkoutStepTarget.HEART_RATE
                sm.target_hr_zone = int(target["zone"])
            elif tgt_type == "power":
                if target.get("zone"):
                    sm.target_type = WorkoutStepTarget.POWER
                    sm.target_power_zone = int(target["zone"])
                elif target.get("min") is not None and target.get("max") is not None:
                    sm.target_type = WorkoutStepTarget.POWER
                    sm.custom_target_power_low = int(target["min"])
                    sm.custom_target_power_high = int(target["max"])
                else:
                    sm.target_type = WorkoutStepTarget.OPEN
            elif tgt_type == "pace":
                if target.get("min") is not None and target.get("max") is not None:
                    # Pace stored as min/km → convert to m/s for FIT speed target
                    # FIT speed is in mm/s
                    try:
                        pace_min = float(target["min"])   # min/km
                        pace_max = float(target["max"])
                        speed_low = 1000 / (pace_max * 60) * 1000 if pace_max > 0 else 0   # mm/s
                        speed_high = 1000 / (pace_min * 60) * 1000 if pace_min > 0 else 0
                        sm.target_type = WorkoutStepTarget.SPEED
                        sm.custom_target_speed_low = int(speed_low)
                        sm.custom_target_speed_high = int(speed_high)
                    except (ValueError, ZeroDivisionError):
                        sm.target_type = WorkoutStepTarget.OPEN
                else:
                    sm.target_type = WorkoutStepTarget.OPEN
            else:
                sm.target_type = WorkoutStepTarget.OPEN

        builder.add(sm)

    fit_file = builder.build()
    return fit_file.to_bytes()


@router.get("/{workout_id}/download-fit")
async def download_workout_fit(
    workout_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Download a planned workout as a Garmin/Wahoo-compatible .fit file."""
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
        athlete_permissions = await get_athlete_permissions(db, current_user.id)
        if not athlete_permissions.get("allow_export_calendar", True):
            raise HTTPException(status_code=403, detail="Coach has not allowed workout export")

    if not workout.structure:
        raise HTTPException(status_code=400, detail="Workout has no structured steps to export")

    fit_data = _build_fit_workout(workout)
    safe_title = "".join(c if c.isalnum() or c in "-_ " else "" for c in (workout.title or "workout"))[:50].strip() or "workout"
    filename = f"{safe_title}.fit"

    return Response(
        content=fit_data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


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
        athlete_permissions = await get_athlete_permissions(db, current_user.id)
        if not athlete_permissions.get("allow_export_calendar", True):
            raise HTTPException(status_code=403, detail="Coach has not allowed workout export")

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
