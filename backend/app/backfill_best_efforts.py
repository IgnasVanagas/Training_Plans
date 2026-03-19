from __future__ import annotations

import asyncio
import os

from .database import AsyncSessionLocal
from .services.personal_records import backfill_missing_best_efforts


async def run() -> None:
    batch_size = max(1, int(os.getenv("BEST_EFFORTS_BACKFILL_BATCH_SIZE", "300")))
    max_passes = max(1, int(os.getenv("BEST_EFFORTS_BACKFILL_MAX_PASSES", "200")))

    total_updated = 0
    total_missing_seen = 0

    async with AsyncSessionLocal() as db:
        for current_pass in range(1, max_passes + 1):
            result = await backfill_missing_best_efforts(db, limit=batch_size)
            updated = int(result.get("updated", 0) or 0)
            missing = int(result.get("missing", 0) or 0)
            remaining_missing = int(result.get("remaining_missing", 0) or 0)

            total_updated += updated
            total_missing_seen = max(total_missing_seen, missing)

            print(
                f"pass={current_pass} updated={updated} missing={missing} remaining_missing={remaining_missing}"
            )

            if updated == 0:
                break

    print(
        f"best efforts backfill complete: total_updated={total_updated} highest_missing_seen={total_missing_seen}"
    )


if __name__ == "__main__":
    asyncio.run(run())
