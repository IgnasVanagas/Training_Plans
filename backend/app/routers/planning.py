from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models import ComplianceStatusEnum, PlannedWorkout, Profile, RoleEnum, SeasonPlan, User
from app.routers.calendar import check_coach_access
from app.schemas import SeasonPlanApplyResponse, SeasonPlanOut, SeasonPlanPreviewOut, SeasonPlanSaveRequest
from app.services.compliance import match_and_score
from app.services.season_planner import build_generated_workouts

router = APIRouter(
    prefix="/planning",
    tags=["planning"],
)


def _plain(value):
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if isinstance(value, list):
        return [_plain(item) for item in value]
    if isinstance(value, dict):
        return {key: _plain(item) for key, item in value.items()}
    return value


async def _resolve_target_athlete_id(
    athlete_id: Optional[int],
    current_user: User,
    db: AsyncSession,
) -> int:
    if athlete_id is None:
        return current_user.id
    if athlete_id == current_user.id:
        return athlete_id
    if current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail="Only coaches can manage other athletes' plans")
    await check_coach_access(current_user.id, athlete_id, db)
    return athlete_id


async def _get_profile(athlete_id: int, db: AsyncSession) -> Optional[Profile]:
    result = await db.execute(select(Profile).where(Profile.user_id == athlete_id))
    return result.scalar_one_or_none()


async def _load_plan_or_404(plan_id: int, current_user: User, db: AsyncSession) -> SeasonPlan:
    result = await db.execute(select(SeasonPlan).where(SeasonPlan.id == plan_id))
    plan = result.scalar_one_or_none()
    if plan is None:
        raise HTTPException(status_code=404, detail="Season plan not found")
    if plan.athlete_id != current_user.id:
        if current_user.role != RoleEnum.coach:
            raise HTTPException(status_code=403, detail="Not authorized to access this season plan")
        await check_coach_access(current_user.id, plan.athlete_id, db)
    return plan


@router.get("/season", response_model=Optional[SeasonPlanOut])
async def get_latest_season_plan(
    athlete_id: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target_athlete_id = await _resolve_target_athlete_id(athlete_id, current_user, db)
    result = await db.execute(
        select(SeasonPlan)
        .where(SeasonPlan.athlete_id == target_athlete_id)
        .order_by(SeasonPlan.updated_at.desc(), SeasonPlan.id.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


@router.post("/season/preview", response_model=SeasonPlanPreviewOut)
async def preview_season_plan(
    payload: SeasonPlanSaveRequest,
    athlete_id: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target_athlete_id = await _resolve_target_athlete_id(athlete_id, current_user, db)
    profile = await _get_profile(target_athlete_id, db)
    try:
        return build_generated_workouts(payload, profile)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/season", response_model=SeasonPlanOut)
async def save_season_plan(
    payload: SeasonPlanSaveRequest,
    athlete_id: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target_athlete_id = await _resolve_target_athlete_id(athlete_id, current_user, db)
    profile = await _get_profile(target_athlete_id, db)
    try:
        preview = build_generated_workouts(payload, profile)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    plan: SeasonPlan | None = None
    if payload.id is not None:
        plan = await _load_plan_or_404(payload.id, current_user, db)
        if plan.athlete_id != target_athlete_id:
            raise HTTPException(status_code=400, detail="Target athlete does not match the existing season plan")

    if plan is None:
        plan = SeasonPlan(
            athlete_id=target_athlete_id,
            coach_id=current_user.id if current_user.role == RoleEnum.coach else None,
        )

    plan.name = payload.name
    plan.sport_type = payload.sport_type
    plan.season_start = payload.season_start
    plan.season_end = payload.season_end
    plan.notes = payload.notes
    plan.target_metrics = _plain(payload.target_metrics)
    plan.goal_races = _plain(payload.goal_races)
    plan.constraints = _plain(payload.constraints)
    plan.periodization = _plain(payload.periodization)
    plan.generated_summary = preview

    db.add(plan)
    await db.commit()
    await db.refresh(plan)
    return plan


@router.post("/season/{plan_id}/apply", response_model=SeasonPlanApplyResponse)
async def apply_season_plan(
    plan_id: int,
    replace_generated: bool = Query(True),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    plan = await _load_plan_or_404(plan_id, current_user, db)
    profile = await _get_profile(plan.athlete_id, db)
    preview = plan.generated_summary or build_generated_workouts(
        {
            "id": plan.id,
            "name": plan.name,
            "sport_type": plan.sport_type,
            "season_start": plan.season_start,
            "season_end": plan.season_end,
            "notes": plan.notes,
            "target_metrics": plan.target_metrics or [],
            "goal_races": plan.goal_races or [],
            "constraints": plan.constraints or [],
            "periodization": plan.periodization or {},
        },
        profile,
    )

    generated_rows = list(preview.get("generated_workouts") or [])
    if not generated_rows:
        raise HTTPException(status_code=400, detail="Season plan preview did not generate any workouts")

    result = await db.execute(
        select(PlannedWorkout).where(
            PlannedWorkout.user_id == plan.athlete_id,
            PlannedWorkout.date >= plan.season_start,
            PlannedWorkout.date <= plan.season_end,
        )
    )
    existing_rows = result.scalars().all()
    existing_by_date: dict[date, list[PlannedWorkout]] = {}
    for row in existing_rows:
        existing_by_date.setdefault(row.date, []).append(row)

    replaced_count = 0
    skipped_count = 0
    preserved_manual_count = 0
    touched_dates: set[date] = set()

    for workout in generated_rows:
        workout_date = date.fromisoformat(str(workout["date"]))
        same_day_rows = list(existing_by_date.get(workout_date, []))

        same_plan_rows = [row for row in same_day_rows if row.season_plan_id == plan.id]
        manual_rows = [row for row in same_day_rows if row.season_plan_id != plan.id]

        if manual_rows:
            preserved_manual_count += len(manual_rows)
            skipped_count += 1
            continue

        if same_plan_rows and not replace_generated:
            skipped_count += 1
            continue

        if same_plan_rows and replace_generated:
            for row in same_plan_rows:
                await db.delete(row)
                replaced_count += 1
                touched_dates.add(row.date)

        planned_workout = PlannedWorkout(
            user_id=plan.athlete_id,
            created_by_user_id=plan.coach_id or current_user.id,
            season_plan_id=plan.id,
            date=workout_date,
            title=str(workout.get("title") or "Planned Workout"),
            description=workout.get("description"),
            sport_type=str(workout.get("sport_type") or plan.sport_type),
            planned_duration=max(5, int(workout.get("planned_duration") or 30)),
            planned_distance=workout.get("planned_distance"),
            planned_intensity=workout.get("planned_intensity"),
            planning_context=workout.get("planning_context") or {},
            compliance_status=ComplianceStatusEnum.planned,
        )
        db.add(planned_workout)
        touched_dates.add(workout_date)

    plan.generated_summary = preview
    db.add(plan)
    await db.commit()
    await db.refresh(plan)

    for target_date in sorted(touched_dates):
        if target_date <= date.today():
            await match_and_score(db, plan.athlete_id, target_date)

    return SeasonPlanApplyResponse(
        plan_id=plan.id,
        athlete_id=plan.athlete_id,
        created_count=len(generated_rows) - skipped_count,
        replaced_count=replaced_count,
        skipped_count=skipped_count,
        preserved_manual_count=preserved_manual_count,
        preview=preview,
    )
