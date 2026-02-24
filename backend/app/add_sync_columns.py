import asyncio
import os
import sys
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# Need to set this up to run inside container
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://app:app@localhost:5432/endurance")

async def add_columns():
    engine = create_async_engine(DATABASE_URL, echo=True)
    async with engine.begin() as conn:
        print("Checking if columns exist...")
        # Check if columns exist before adding to avoid errors
        # This is a bit brute force but simple for this setup
        try:
            await conn.execute(text("ALTER TABLE provider_sync_state ADD COLUMN sync_status VARCHAR(20) DEFAULT 'idle' NOT NULL;"))
            print("Added sync_status")
        except Exception as e:
            print(f"sync_status might already exist: {e}")
            
        try:
            await conn.execute(text("ALTER TABLE provider_sync_state ADD COLUMN sync_progress INTEGER DEFAULT 0 NOT NULL;"))
            print("Added sync_progress")
        except Exception as e:
            print(f"sync_progress might already exist: {e}")

        try:
            await conn.execute(text("ALTER TABLE provider_sync_state ADD COLUMN sync_total INTEGER DEFAULT 0 NOT NULL;"))
            print("Added sync_total")
        except Exception as e:
            print(f"sync_total might already exist: {e}")

        try:
            await conn.execute(text("ALTER TABLE provider_sync_state ADD COLUMN sync_message TEXT;"))
            print("Added sync_message")
        except Exception as e:
            print(f"sync_message might already exist: {e}")

    await engine.dispose()
    print("Done")

if __name__ == "__main__":
    asyncio.run(add_columns())
