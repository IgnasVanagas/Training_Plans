from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from datetime import date, datetime

from app.models import PlannedWorkout, Activity, ComplianceStatusEnum


def _is_activity_deleted(activity: Activity) -> bool:
    streams = activity.streams
    if isinstance(streams, dict):
        meta = streams.get("_meta")
        if isinstance(meta, dict):
            return bool(meta.get("deleted"))
    return False

async def match_and_score(db: AsyncSession, user_id: int, target_date: date):
    """
    Matches PlannedWorkouts with Activities for a given user and date.
    Updates compliance status based on duration deviation.
    """
    
    # 1. Fetch Planned Workouts for the date
    # Note: DB queries are async
    stmt_workouts = select(PlannedWorkout).where(
        and_(
            PlannedWorkout.user_id == user_id,
            PlannedWorkout.date == target_date
        )
    )
    result_workouts = await db.execute(stmt_workouts)
    planned_workouts = result_workouts.scalars().all()
    
    if not planned_workouts:
        return

    # 2. Fetch Activities for the date
    # Activity.created_at is DateTime. Cast to date?
    # Or range check for the day.
    start_of_day = datetime.combine(target_date, datetime.min.time())
    end_of_day = datetime.combine(target_date, datetime.max.time())
    
    stmt_activities = select(Activity).where(
        and_(
            Activity.athlete_id == user_id,
            Activity.created_at >= start_of_day,
            Activity.created_at <= end_of_day
        )
    )
    result_activities = await db.execute(stmt_activities)
    activities = [activity for activity in result_activities.scalars().all() if not _is_activity_deleted(activity)]
    
    # 3. Matching Logic
    # Simple Greedy Match: First activity of same sport matches first workout of same sport.
    # A more complex one handles duplicates, but for MVP this is fine.
    
    used_activity_ids = set()
    
    for workout in planned_workouts:
        matched_activity = None
        
        # Try to find a match
        for activity in activities:
            if activity.id in used_activity_ids:
                continue
                
            # Check Sport (Case, partial match?)
            # Activity sport might be 'running' or 'Run', Workout might be 'Running'
            # Let's normalize to lower()
            act_sport = (activity.sport or "").lower()
            work_sport = (workout.sport_type or "").lower()
            
            if act_sport == work_sport:
                matched_activity = activity
                used_activity_ids.add(activity.id)
                break
        
        # Update Workout
        if matched_activity:
            workout.matched_activity_id = matched_activity.id
            
            # Scoring
            planned_dur = float(workout.planned_duration) # minutes
            actual_dur = (matched_activity.duration or 0) / 60.0 # seconds to minutes
            
            if planned_dur > 0:
                deviation = abs(planned_dur - actual_dur) / planned_dur
                
                if deviation <= 0.10:
                    workout.compliance_status = ComplianceStatusEnum.completed_green
                elif deviation <= 0.20:
                    workout.compliance_status = ComplianceStatusEnum.completed_yellow
                else:
                    workout.compliance_status = ComplianceStatusEnum.completed_red
            else:
                 workout.compliance_status = ComplianceStatusEnum.completed_green # 0 duration?
                 
        else:
            # No match
            workout.matched_activity_id = None
            if target_date < date.today():
                workout.compliance_status = ComplianceStatusEnum.missed
            else:
                workout.compliance_status = ComplianceStatusEnum.planned
                
        db.add(workout)
    
    await db.commit()
