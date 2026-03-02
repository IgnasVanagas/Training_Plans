from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List

from .. import models, schemas, database
from ..auth import get_current_user

router = APIRouter(
    prefix="/workouts",
    tags=["workouts"],
    responses={404: {"description": "Not found"}},
)

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
    return db_workout

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
    return db_workout

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
    return workouts

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
        
    return workout
