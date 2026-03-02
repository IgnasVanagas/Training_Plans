
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
        print("Migrating structured_workouts to add library features from template...")
        try:
            await conn.execute(text("ALTER TABLE structured_workouts ADD COLUMN tags JSONB DEFAULT '[]';"))
            print("Added tags")
        except Exception as e:
            print(f"Error adding tags (likely exists): {e}")

        try:
            await conn.execute(text("ALTER TABLE structured_workouts ADD COLUMN is_favorite BOOLEAN DEFAULT FALSE;"))
            print("Added is_favorite")
        except Exception as e:
            print(f"Error adding is_favorite (likely exists): {e}")

    await engine.dispose()
    print("Done")

if __name__ == "__main__":
    asyncio.run(add_columns())
