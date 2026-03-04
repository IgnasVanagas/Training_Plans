import asyncio
import os
import sys
from sqlalchemy import select

# Add parent directory to path to simulate package import
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Use existing env or fallback
if "DATABASE_URL" not in os.environ:
    # Fallback for local testing, but in docker it should be set
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://app:app@db:5432/endurance"

from app.database import AsyncSessionLocal
from app.models import PlannedWorkout
from app.services.compliance import match_and_score

async def recheck_all():
    print("Starting compliance recheck...")
    
    async with AsyncSessionLocal() as db:
        # Find all distinct (user_id, date) pairs that have PlannedWorkouts
        # We want to re-evaluate compliance for EVERY day that has a plan.
        stmt = select(PlannedWorkout.user_id, PlannedWorkout.date).distinct()
        result = await db.execute(stmt)
        pairs = result.all()
        
        print(f"Found {len(pairs)} day-user combinations to check.")
        
        count = 0
        for row in pairs:
            user_id = row[0]
            target_date = row[1]
            
            if not target_date:
                continue

            try:
                # This function now contains the improved "Best Match" logic
                await match_and_score(db, user_id, target_date)
                count += 1
                if count % 10 == 0:
                    print(f"Processed {count} days...")
            except Exception as e:
                print(f"Error processing user {user_id} on {target_date}: {e}")
        
        print(f"Recheck complete. processed {count} items.")

if __name__ == "__main__":
    asyncio.run(recheck_all())
