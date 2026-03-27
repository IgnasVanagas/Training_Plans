from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import asyncio
import logging
import os
import pathlib
from sqlalchemy import text

from .database import Base, engine
from .routers import auth, users, activities, calendar, workouts, integrations, communications, planning, admin
from .seed import seed_data

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Endurance Sports Management Platform")

# Chat file uploads — served at /uploads/chat/<filename>
_UPLOADS_DIR = pathlib.Path(os.getenv("UPLOADS_DIR", "uploads/chat"))
_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads/chat", StaticFiles(directory=str(_UPLOADS_DIR)), name="chat_uploads")

allowed_origins_raw = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,https://training-plans-1.onrender.com,https://training-plans.onrender.com")
allowed_origins = [origin.strip() for origin in allowed_origins_raw.split(",") if origin.strip()]
# Auto-include FRONTEND_BASE_URL so CORS works even if ALLOWED_ORIGINS is out of sync
_frontend_url = (os.getenv("FRONTEND_BASE_URL") or "").strip().rstrip("/")
if _frontend_url and _frontend_url not in allowed_origins:
    allowed_origins.append(_frontend_url)
# Always include known Render production origins regardless of what ALLOWED_ORIGINS env var is set to
for _ro in ("https://training-plans-1.onrender.com", "https://training-plans.onrender.com"):
    if _ro not in allowed_origins:
        allowed_origins.append(_ro)
allowed_origin_regex = os.getenv(
    "ALLOWED_ORIGIN_REGEX",
    r"^https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$|^https://[a-zA-Z0-9-]+\.onrender\.com$",
)

logger.info("CORS allow_origins: %s", allowed_origins)
logger.info("CORS allow_origin_regex: %s", allowed_origin_regex)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=allowed_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["health"])
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.on_event("startup")
async def on_startup() -> None:
    logger.info("Starting up...")

    # All DB work is wrapped in a timeout so the server always binds its port.
    # Uvicorn only opens the listening socket AFTER startup events complete, so
    # a hanging DB connection would cause Render's port-detection to time out.
    _STARTUP_DB_TIMEOUT = 45  # seconds

    async def _run_migrations() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await conn.execute(text("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS hrv_ms DOUBLE PRECISION"))
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE"))
            await conn.execute(text("ALTER TABLE planned_workouts ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER"))
            await conn.execute(text("ALTER TABLE planned_workouts ADD COLUMN IF NOT EXISTS season_plan_id INTEGER"))
            await conn.execute(text("ALTER TABLE planned_workouts ADD COLUMN IF NOT EXISTS planning_context JSONB"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_activities_athlete_created_at ON activities (athlete_id, created_at DESC)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_planned_workouts_user_date ON planned_workouts (user_id, date)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_planned_workouts_season_plan_id ON planned_workouts (season_plan_id)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_season_plans_athlete_updated_at ON season_plans (athlete_id, updated_at DESC)"))
            await conn.execute(text("UPDATE planned_workouts SET created_by_user_id = user_id WHERE created_by_user_id IS NULL"))
            await conn.execute(text("UPDATE users SET email_verified = TRUE WHERE email_verified IS NULL"))
            await conn.execute(text("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS country VARCHAR(100)"))
            await conn.execute(text("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255)"))
            await conn.execute(text("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS contact_number VARCHAR(50)"))
            await conn.execute(text("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS menstruation_available_to_coach BOOLEAN DEFAULT FALSE"))
            await conn.execute(text("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS training_days JSONB"))
            await conn.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE"))
            await conn.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS duplicate_of_id INTEGER REFERENCES activities(id)"))
            await conn.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS rpe FLOAT"))
            await conn.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS notes TEXT"))
            await conn.execute(text("ALTER TABLE organization_group_messages ADD COLUMN IF NOT EXISTS attachment_url VARCHAR(500)"))
            await conn.execute(text("ALTER TABLE organization_group_messages ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255)"))
            await conn.execute(text("ALTER TABLE organization_coach_messages ADD COLUMN IF NOT EXISTS attachment_url VARCHAR(500)"))
            await conn.execute(text("ALTER TABLE organization_coach_messages ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255)"))
        logger.info("Database schema ready")

    try:
        await asyncio.wait_for(_run_migrations(), timeout=_STARTUP_DB_TIMEOUT)
    except asyncio.TimeoutError:
        logger.error("Database migration timed out after %ds (non-fatal)", _STARTUP_DB_TIMEOUT)
    except Exception as exc:
        logger.error("Database migration failed (non-fatal): %s", exc)

    if os.getenv("AUTO_SEED_DEMO", "true").lower() in {"1", "true", "yes", "on"}:
        try:
            await asyncio.wait_for(seed_data(), timeout=_STARTUP_DB_TIMEOUT)
        except asyncio.TimeoutError:
            logger.error("Seed data timed out (non-fatal)")
        except Exception as exc:
            logger.error("Seed data failed (non-fatal): %s", exc)

    # Ensure Strava webhook subscription exists on startup
    if os.getenv("ENABLE_STRAVA_INTEGRATION", "false").lower() in {"1", "true", "yes", "on"}:
        try:
            from .integrations.registry import get_connector
            connector = get_connector("strava")
            if connector.is_webhook_configured():
                result = await asyncio.wait_for(
                    connector.ensure_webhook_subscription(), timeout=15,
                )
                logger.info("Strava webhook subscription: %s", result.get("status"))
        except asyncio.TimeoutError:
            logger.warning("Strava webhook subscription timed out")
        except Exception as exc:
            logger.warning("Strava webhook subscription check failed: %s", exc)

    # Backfill duplicate_of_id for any historic activities that were recorded
    # before the duplicate-detection column existed.  Safe to run on every
    # startup — only touches rows where duplicate_of_id IS NULL.
    try:
        from .services.activity_dedupe import _backfill_duplicates
        marked = await asyncio.wait_for(_backfill_duplicates(engine), timeout=_STARTUP_DB_TIMEOUT)
        if marked:
            logger.info("Duplicate backfill: marked %d historic duplicate(s)", marked)
    except asyncio.TimeoutError:
        logger.warning("Duplicate backfill timed out (non-fatal)")
    except Exception as exc:
        logger.warning("Duplicate backfill failed (non-fatal): %s", exc)

    # Trigger a sync for any Strava user whose initial sync never completed
    try:
        from .routers.integrations import _startup_trigger_pending_syncs
        asyncio.create_task(_startup_trigger_pending_syncs())
    except Exception as exc:
        logger.warning("Startup pending sync trigger failed: %s", exc)

    logger.info("Startup complete")


@app.on_event("shutdown")
async def on_shutdown() -> None:
    await engine.dispose()


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(activities.router)
app.include_router(calendar.router)
app.include_router(workouts.router)
app.include_router(integrations.router)
app.include_router(communications.router)
app.include_router(planning.router)
app.include_router(admin.router)
