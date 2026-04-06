import os
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base


def _normalize_async_database_url(database_url: str) -> str:
    normalized = database_url.strip()
    if normalized.startswith("postgres://"):
        return normalized.replace("postgres://", "postgresql+asyncpg://", 1)
    if normalized.startswith("postgresql://"):
        return normalized.replace("postgresql://", "postgresql+asyncpg://", 1)
    return normalized


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


DATABASE_URL = _normalize_async_database_url(
    os.getenv("DATABASE_URL", "postgresql+asyncpg://app:app@db:5432/endurance")
)

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    # Recycle connections every 5 min — well below Render's ~10 min idle timeout
    pool_recycle=max(0, _env_int("DB_POOL_RECYCLE_SECONDS", 300)),
    pool_size=max(1, _env_int("DB_POOL_SIZE", 5)),
    max_overflow=max(0, _env_int("DB_MAX_OVERFLOW", 10)),
    pool_timeout=max(1, _env_int("DB_POOL_TIMEOUT_SECONDS", 30)),
    pool_use_lifo=True,
    connect_args={
        "timeout": 10,
        "command_timeout": 30,
    },
)
AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)

Base = declarative_base()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
