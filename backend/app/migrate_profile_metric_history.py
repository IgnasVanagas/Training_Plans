"""
Migration: create profile_metric_history table and backfill existing FTP/weight values.

The table is created by SQLAlchemy's create_all on startup (model already added to models.py).
This script only handles the backfill: for every profile row that already has a non-null
ftp or weight value, we insert one history row with recorded_at = 2000-01-01, meaning
"this value has been in effect since forever" — so all historic activities continue to use
the current value rather than having no value at all.

Run once after deploying the updated code:
    docker compose exec backend python -m app.migrate_profile_metric_history
"""

import asyncio
import os
import sys
from datetime import datetime

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.database import engine

EPOCH = datetime(2000, 1, 1)


async def run():
    async with engine.begin() as conn:
        # Ensure the table exists (create_all may not have run yet in this context)
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS profile_metric_history (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                metric VARCHAR(20) NOT NULL,
                value FLOAT NOT NULL,
                recorded_at TIMESTAMP NOT NULL
            )
        """))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_profile_metric_history_id ON profile_metric_history (id)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_profile_metric_history_user_id ON profile_metric_history (user_id)"
        ))

        # Backfill FTP
        result = await conn.execute(text(
            "SELECT user_id, ftp FROM profiles WHERE ftp IS NOT NULL"
        ))
        ftp_rows = result.fetchall()
        for row in ftp_rows:
            exists = await conn.execute(text(
                "SELECT 1 FROM profile_metric_history "
                "WHERE user_id = :uid AND metric = 'ftp' AND recorded_at = :ts"
            ), {"uid": row.user_id, "ts": EPOCH})
            if not exists.scalar():
                await conn.execute(text(
                    "INSERT INTO profile_metric_history (user_id, metric, value, recorded_at) "
                    "VALUES (:uid, 'ftp', :val, :ts)"
                ), {"uid": row.user_id, "val": row.ftp, "ts": EPOCH})
                print(f"Backfilled FTP={row.ftp} for user {row.user_id}")

        # Backfill weight
        result = await conn.execute(text(
            "SELECT user_id, weight FROM profiles WHERE weight IS NOT NULL"
        ))
        weight_rows = result.fetchall()
        for row in weight_rows:
            exists = await conn.execute(text(
                "SELECT 1 FROM profile_metric_history "
                "WHERE user_id = :uid AND metric = 'weight' AND recorded_at = :ts"
            ), {"uid": row.user_id, "ts": EPOCH})
            if not exists.scalar():
                await conn.execute(text(
                    "INSERT INTO profile_metric_history (user_id, metric, value, recorded_at) "
                    "VALUES (:uid, 'weight', :val, :ts)"
                ), {"uid": row.user_id, "val": row.weight, "ts": EPOCH})
                print(f"Backfilled weight={row.weight} for user {row.user_id}")

    print("Backfill complete.")


if __name__ == "__main__":
    asyncio.run(run())
