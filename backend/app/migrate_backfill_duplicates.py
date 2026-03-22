"""
Migration: backfill duplicate_of_id for existing activities.

Uses the same detection rules as find_duplicate_activity():
  1. file_sha256 match (streams._meta.file_sha256)
  2. source_provider + source_activity_id match
  3. fingerprint_v1 match
  4. Fuzzy: same sport, start within 3 min, duration within 90 s, distance within 150 m

The OLDER activity (lower id) is kept as the original; the newer one gets
duplicate_of_id set to the original's id.

Run once:
    docker compose exec backend python -m app.migrate_backfill_duplicates
"""

import asyncio
import json
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.database import engine
from app.services.activity_dedupe import _rows_are_duplicate


async def run():
    async with engine.connect() as conn:
        result = await conn.execute(text("""
            SELECT id, athlete_id, sport, created_at, duration, distance, streams
            FROM activities
            WHERE duplicate_of_id IS NULL
            ORDER BY athlete_id, id
        """))
        rows = result.mappings().fetchall()

    all_activities = []
    for r in rows:
        row = dict(r)
        # streams may come back as string
        if isinstance(row.get("streams"), str):
            try:
                row["streams"] = json.loads(row["streams"])
            except Exception:
                row["streams"] = {}
        all_activities.append(row)

    # Group by athlete
    by_athlete: dict[int, list] = {}
    for a in all_activities:
        by_athlete.setdefault(a["athlete_id"], []).append(a)

    to_mark: list[tuple[int, int]] = []

    for athlete_id, activities in by_athlete.items():
        claimed: set[int] = set()
        for i, candidate in enumerate(activities):
            if candidate["id"] in claimed:
                continue
            for original in activities[:i]:
                if original["id"] in claimed:
                    continue
                if _rows_are_duplicate(original, candidate):
                    to_mark.append((candidate["id"], original["id"]))
                    claimed.add(candidate["id"])
                    break

    if not to_mark:
        print("No duplicates found — nothing to do.")
        return

    print(f"Found {len(to_mark)} duplicate(s). Marking...")
    async with engine.begin() as conn:
        for dup_id, orig_id in to_mark:
            await conn.execute(
                text("UPDATE activities SET duplicate_of_id = :orig WHERE id = :dup"),
                {"orig": orig_id, "dup": dup_id},
            )
            print(f"  activity {dup_id} → duplicate of {orig_id}")

    print("Done.")


if __name__ == "__main__":
    asyncio.run(run())
