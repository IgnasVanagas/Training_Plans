from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List
import uuid

from .. import models, schemas, database
from ..auth import get_current_user

router = APIRouter(
    prefix="/workouts",
    tags=["workouts"],
    responses={404: {"description": "Not found"}},
)


def _zone_defaults(zone: int) -> tuple[float, float, float]:
    power_ranges = {
        1: (50.0, 55.0),
        2: (56.0, 75.0),
        3: (76.0, 90.0),
        4: (91.0, 105.0),
        5: (106.0, 120.0),
        6: (121.0, 150.0),
        7: (151.0, 200.0),
    }
    low, high = power_ranges.get(zone, (56.0, 75.0))
    return low, high, round((low + high) / 2.0)


def _normalize_target(target: object) -> dict:
    source = target if isinstance(target, dict) else {}
    target_type = str(source.get("type") or "power").lower()
    zone_value_raw = source.get("zone")
    try:
        zone_value = int(zone_value_raw) if zone_value_raw is not None else None
    except (TypeError, ValueError):
        zone_value = None

    normalized: dict = dict(source)

    if target_type == "power_zone":
        zone_value = zone_value or 2
        low, high, default_value = _zone_defaults(zone_value)
        normalized["type"] = "power"
        normalized["metric"] = normalized.get("metric") or "percent_ftp"
        normalized["unit"] = normalized.get("unit") or "%"
        normalized["zone"] = zone_value
        normalized["min"] = float(normalized.get("min") if normalized.get("min") is not None else low)
        normalized["max"] = float(normalized.get("max") if normalized.get("max") is not None else high)
        normalized["value"] = float(normalized.get("value") if normalized.get("value") is not None else default_value)
        return normalized

    allowed_types = {"heart_rate_zone", "power", "pace", "rpe", "open", "heart_rate"}
    if target_type not in allowed_types:
        normalized["type"] = "open"
    else:
        normalized["type"] = target_type

    if zone_value is not None:
        normalized["zone"] = zone_value

    return normalized


def _normalize_node(node: object) -> dict:
    source = node if isinstance(node, dict) else {}
    node_type = str(source.get("type") or "block").lower()
    node_id = str(source.get("id") or uuid.uuid4().hex[:10])
    description = source.get("description")

    if node_type == "repeat":
        repeats_raw = source.get("repeats")
        try:
            repeats = max(1, int(repeats_raw or 1))
        except (TypeError, ValueError):
            repeats = 1
        steps_raw = source.get("steps") if isinstance(source.get("steps"), list) else []
        return {
            "id": node_id,
            "type": "repeat",
            "repeats": repeats,
            "steps": [_normalize_node(step) for step in steps_raw],
            "description": description,
        }

    category = str(source.get("category") or "work").lower()
    if category not in {"warmup", "work", "recovery", "cooldown"}:
        category = "work"

    duration_source = source.get("duration") if isinstance(source.get("duration"), dict) else {}
    duration_type = str(duration_source.get("type") or "time").lower()
    if duration_type not in {"time", "distance", "lap_button", "calories"}:
        duration_type = "time"
    duration_value = duration_source.get("value")
    if duration_type == "lap_button":
        duration_value = None

    return {
        "id": node_id,
        "type": "block",
        "category": category,
        "duration": {
            "type": duration_type,
            "value": duration_value,
        },
        "target": _normalize_target(source.get("target")),
        "description": description,
    }


def _normalize_structure(structure: object) -> list[dict]:
    if not isinstance(structure, list):
        return []
    return [_normalize_node(node) for node in structure]


def _serialize_workout(workout: models.StructuredWorkout) -> dict:
    return {
        "id": workout.id,
        "coach_id": workout.coach_id,
        "title": workout.title,
        "description": workout.description,
        "sport_type": workout.sport_type,
        "structure": _normalize_structure(workout.structure),
        "tags": workout.tags or [],
        "is_favorite": bool(workout.is_favorite),
        "created_at": workout.created_at,
        "updated_at": workout.updated_at,
    }

@router.post("/", response_model=schemas.StructuredWorkoutOut)
async def create_workout(
    workout: schemas.StructuredWorkoutCreate,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(database.get_db),
):
    if workout.tags is None:
        workout.tags = []
        
    # Convert Pydantic model to dict, ensuring nested models are also converted
    workout_data = workout.model_dump()
    
    db_workout = models.StructuredWorkout(
        **workout_data,
        coach_id=current_user.id
    )
    
    db.add(db_workout)
    await db.commit()
    await db.refresh(db_workout)
    return _serialize_workout(db_workout)

@router.patch("/{workout_id}", response_model=schemas.StructuredWorkoutOut)
async def update_workout_library(
    workout_id: int,
    workout_update: schemas.StructuredWorkoutUpdate,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(database.get_db),
):
    stmt = select(models.StructuredWorkout).where(
        models.StructuredWorkout.id == workout_id,
        models.StructuredWorkout.coach_id == current_user.id
    )
    result = await db.execute(stmt)
    db_workout = result.scalar_one_or_none()
    
    if not db_workout:
        raise HTTPException(status_code=404, detail="Workout not found")
        
    update_data = workout_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_workout, field, value)
        
    await db.commit()
    await db.refresh(db_workout)
    return _serialize_workout(db_workout)

@router.delete("/{workout_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workout_library(
    workout_id: int,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(database.get_db),
):
    stmt = select(models.StructuredWorkout).where(
        models.StructuredWorkout.id == workout_id,
        models.StructuredWorkout.coach_id == current_user.id
    )
    result = await db.execute(stmt)
    db_workout = result.scalar_one_or_none()
    
    if not db_workout:
        raise HTTPException(status_code=404, detail="Workout not found")
        
    await db.delete(db_workout)
    await db.commit()
    return None

@router.get("/", response_model=List[schemas.StructuredWorkoutOut])
async def read_workouts(
    skip: int = 0,
    limit: int = 100,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(database.get_db),
):
    result = await db.execute(
        select(models.StructuredWorkout)
        .where(models.StructuredWorkout.coach_id == current_user.id)
        .offset(skip)
        .limit(limit)
    )
    workouts = result.scalars().all()
    return [_serialize_workout(workout) for workout in workouts]

@router.get("/{workout_id}", response_model=schemas.StructuredWorkoutOut)
async def read_workout(
    workout_id: int,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(database.get_db),
):
    result = await db.execute(
        select(models.StructuredWorkout).where(models.StructuredWorkout.id == workout_id)
    )
    workout = result.scalars().first()
    if workout is None:
        raise HTTPException(status_code=404, detail="Workout not found")
    
    if workout.coach_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to view this workout")
        
    return _serialize_workout(workout)
