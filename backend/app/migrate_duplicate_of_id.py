"""
Migration: add duplicate_of_id column to activities table.

Run once after deploying the updated code:
    docker compose exec backend python -m app.migrate_duplicate_of_id
"""

import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.database import engine


async def run():
    async with engine.begin() as conn:
        # Add column if it doesn't already exist
        result = await conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'activities' AND column_name = 'duplicate_of_id'
        """))
        if result.scalar():
            print("duplicate_of_id column already exists — nothing to do.")
            return

        await conn.execute(text("""
            ALTER TABLE activities
            ADD COLUMN duplicate_of_id INTEGER REFERENCES activities(id) ON DELETE SET NULL
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_activities_duplicate_of_id
            ON activities (duplicate_of_id)
        """))
        print("Migration complete: added duplicate_of_id to activities.")


if __name__ == "__main__":
    asyncio.run(run())
