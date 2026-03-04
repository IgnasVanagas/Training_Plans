import asyncio
import os
import sys
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

# Add parent directory to path to simulate package import
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Need to set ENV before importing database if possible, or override manually
os.environ["DATABASE_URL"] = "postgresql+asyncpg://app:app@127.0.0.1:5432/endurance"

from app.models import User, StructuredWorkout, RoleEnum

# Workout Templates
# Running
RUN_WORKOUTS = [
    {
        "title": "Classic 5x1km Intervals",
        "description": "5x1km repeats at threshold pace with 2 min recovery.",
        "sport_type": "Running",
        "tags": ["Intervals", "Threshold"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 600}, "target": {"type": "rpe", "value": 3}},
            {
                "type": "repeat", 
                "repeats": 5, 
                "steps": [
                    {"type": "block", "category": "work", "duration": {"type": "distance", "value": 1000}, "target": {"type": "pace", "metric": "percent_threshold_pace", "value": 100}},
                    {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 120}, "target": {"type": "rpe", "value": 2}}
                ]
            },
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 600}, "target": {"type": "rpe", "value": 2}}
        ]
    },
    {
        "title": "Long Run with Tempo Finish",
        "description": "90 min endurance run, picking up the pace for the last 20 mins.",
        "sport_type": "Running",
        "tags": ["Endurance", "Tempo"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 900}, "target": {"type": "rpe", "value": 3}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 3000}, "target": {"type": "heart_rate_zone", "zone": 2}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 1200}, "target": {"type": "heart_rate_zone", "zone": 3}},
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 300}, "target": {"type": "rpe", "value": 2}}
        ]
    },
    {
        "title": "Speed Pyramid",
        "description": "1-2-3-2-1 mins hard with equal recovery.",
        "sport_type": "Running",
        "tags": ["Speed", "Intervals"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 600}, "target": {"type": "rpe", "value": 3}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 60}, "target": {"type": "rpe", "value": 9}},
            {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 60}, "target": {"type": "rpe", "value": 2}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 120}, "target": {"type": "rpe", "value": 8}},
            {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 120}, "target": {"type": "rpe", "value": 2}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 180}, "target": {"type": "rpe", "value": 7}},
            {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 180}, "target": {"type": "rpe", "value": 2}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 120}, "target": {"type": "rpe", "value": 8}},
            {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 120}, "target": {"type": "rpe", "value": 2}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 60}, "target": {"type": "rpe", "value": 9}},
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 600}, "target": {"type": "rpe", "value": 2}}
        ]
    }
]

# Cycling
CYCLE_WORKOUTS = [
    {
        "title": "2x20 FTP Intervals",
        "description": "Classic threshold builder. 2x20mins at 95-100% FTP.",
        "sport_type": "Cycling",
        "tags": ["Threshold", "FTP"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 900}, "target": {"type": "power_zone", "zone": 2}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 1200}, "target": {"type": "power", "metric": "percent_ftp", "value": 95}},
            {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 600}, "target": {"type": "power_zone", "zone": 1}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 1200}, "target": {"type": "power", "metric": "percent_ftp", "value": 95}},
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 900}, "target": {"type": "power_zone", "zone": 1}}
        ]
    },
    {
        "title": "VO2Max 4x4min",
        "description": "High intensity intervals to boost VO2Max.",
        "sport_type": "Cycling",
        "tags": ["VO2Max", "Intervals"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 900}, "target": {"type": "power_zone", "zone": 2}},
            {
                "type": "repeat", 
                "repeats": 4, 
                "steps": [
                    {"type": "block", "category": "work", "duration": {"type": "time", "value": 240}, "target": {"type": "power", "metric": "percent_ftp", "value": 115}},
                    {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 240}, "target": {"type": "power_zone", "zone": 1}}
                ]
            },
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 900}, "target": {"type": "power_zone", "zone": 1}}
        ]
    },
    {
        "title": "Endurance Ride (Zone 2)",
        "description": "Steady state endurance ride to build base.",
        "sport_type": "Cycling",
        "tags": ["Endurance", "Base"],
        "structure": [
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 5400}, "target": {"type": "power_zone", "zone": 2}}
        ]
    }
]

async def seed_workouts():
    DATABASE_URL = os.environ["DATABASE_URL"]
    engine = create_async_engine(DATABASE_URL, echo=False)
    AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with AsyncSessionLocal() as db:
        # Get the first coach or admin to be the author
        result = await db.execute(select(User).where(User.role.in_([RoleEnum.coach, RoleEnum.admin])))
        coach = result.scalars().first()
        
        if not coach:
            # Fallback for dev - get any user
            result = await db.execute(select(User))
            coach = result.scalars().first()
            
        if not coach:
            print("No user found to assign workouts to.")
            return

        print(f"Creating workouts for coach: {coach.email}")

        for w in RUN_WORKOUTS + CYCLE_WORKOUTS:
            # Check if exists
            result = await db.execute(select(StructuredWorkout).where(StructuredWorkout.title == w["title"], StructuredWorkout.coach_id == coach.id))
            existing = result.scalar_one_or_none()
            
            if not existing:
                workout = StructuredWorkout(
                    coach_id=coach.id,
                    title=w["title"],
                    description=w["description"],
                    sport_type=w["sport_type"],
                    tags=w["tags"],
                    structure=w["structure"],
                    is_favorite=False
                )
                db.add(workout)
                print(f"Added: {w['title']}")
            else:
                print(f"Skipped (exists): {w['title']}")
        
        await db.commit()
        print("Done seeding workouts.")

if __name__ == "__main__":
    if sys.platform == "win32":
        try:
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        except AttributeError:
            pass
    asyncio.run(seed_workouts())
