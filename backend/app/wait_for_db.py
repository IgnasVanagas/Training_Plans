import asyncio
import os
import sys

import asyncpg


async def wait_for_db() -> None:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set")
        sys.exit(1)

    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
    if database_url.startswith("postgresql+asyncpg://"):
        database_url = database_url.replace("postgresql+asyncpg://", "postgresql://", 1)

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
