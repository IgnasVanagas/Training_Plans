import asyncio
import os
import sys

import asyncpg


def _normalize_database_url(database_url: str) -> str:
    normalized = database_url.strip()
    if normalized.startswith("postgres://"):
        return normalized.replace("postgres://", "postgresql://", 1)
    if normalized.startswith("postgresql+asyncpg://"):
        return normalized.replace("postgresql+asyncpg://", "postgresql://", 1)
    return normalized


async def wait_for_db() -> None:
    database_url = _normalize_database_url(
        os.getenv("DATABASE_URL", "postgresql+asyncpg://app:app@db:5432/endurance")
    )

    for _ in range(30):
        try:
            conn = await asyncpg.connect(database_url)
            await conn.close()
            return
        except Exception:
            await asyncio.sleep(1)

    print("Database not ready after retries")
    sys.exit(1)


if __name__ == "__main__":
    asyncio.run(wait_for_db())
