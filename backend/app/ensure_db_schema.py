import asyncio
import os
import sys

# Add parent directory to path so we can import app modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.database import engine

async def ensure_columns():
    print("Checking database schema for provider_sync_state...")
    
    columns_to_add = [
        ("sync_status", "VARCHAR(20) DEFAULT 'idle' NOT NULL"),
        ("sync_progress", "INTEGER DEFAULT 0 NOT NULL"),
        ("sync_total", "INTEGER DEFAULT 0 NOT NULL"),
        ("sync_message", "TEXT"),
    ]

    async with engine.connect() as conn:
        for col_name, col_def in columns_to_add:
            try:
                # Check if column exists
                result = await conn.execute(text(
                    f"SELECT column_name FROM information_schema.columns "
                    f"WHERE table_name='provider_sync_state' AND column_name='{col_name}'"
                ))
                if result.scalar():
                    print(f"Column '{col_name}' already exists.")
                    continue

                print(f"Adding column '{col_name}'...")
                await conn.execute(text(f"ALTER TABLE provider_sync_state ADD COLUMN {col_name} {col_def}"))
                await conn.commit()
                print(f"Added column '{col_name}'.")
            except Exception as e:
                print(f"Error checking/adding column '{col_name}': {e}")
                
    print("Schema check complete.")

if __name__ == "__main__":
    asyncio.run(ensure_columns())
