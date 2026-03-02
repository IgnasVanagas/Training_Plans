
import asyncio
import os
import sys
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# Need to set this up to run inside container
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://app:app@localhost:5432/endurance")

async def add_columns():
    engine = create_async_engine(DATABASE_URL)
    async with engine.begin() as conn:
        print("Migrating activities...")
        try:
            await conn.execute(text("ALTER TABLE activities ADD COLUMN rpe DOUBLE PRECISION;"))
            print("Added activities.rpe")
        except Exception as e:
            print(f"Error adding activities.rpe (likely exists): {e}")

        try:
            await conn.execute(text("ALTER TABLE activities ADD COLUMN notes TEXT;"))
            print("Added activities.notes")
        except Exception as e:
            print(f"Error activities.notes: {e}")

        print("Migrating planned_workouts...")
        try:
            await conn.execute(text("ALTER TABLE planned_workouts ADD COLUMN rpe DOUBLE PRECISION;"))
            print("Added planned_workouts.rpe")
        except Exception as e:
            print(f"Error planned_workouts.rpe (likely exists): {e}")

        try:
            await conn.execute(text("ALTER TABLE planned_workouts ADD COLUMN notes TEXT;"))
            print("Added planned_workouts.notes")
        except Exception as e:
            print(f"Error planned_workouts.notes: {e}")

    await engine.dispose()
    print("Done")

if __name__ == "__main__":
    asyncio.run(add_columns())
