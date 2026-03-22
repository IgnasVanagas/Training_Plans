from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging
import os
from sqlalchemy import text

from .database import Base, engine
from .routers import auth, users, activities, calendar, workouts, integrations, communications, planning
from .seed import seed_data

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Endurance Sports Management Platform")

allowed_origins_raw = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,https://training-plans-1.onrender.com,https://training-plans.onrender.com")
allowed_origins = [origin.strip() for origin in allowed_origins_raw.split(",") if origin.strip()]
# Auto-include FRONTEND_BASE_URL so CORS works even if ALLOWED_ORIGINS is out of sync
_frontend_url = (os.getenv("FRONTEND_BASE_URL") or "").strip().rstrip("/")
if _frontend_url and _frontend_url not in allowed_origins:
    allowed_origins.append(_frontend_url)
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
    try:
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
        logger.info("Database schema ready")
    except Exception as exc:
        logger.error("Database migration failed (non-fatal): %s", exc)

    if os.getenv("AUTO_SEED_DEMO", "true").lower() in {"1", "true", "yes", "on"}:
        try:
            await seed_data()
        except Exception as exc:
            logger.error("Seed data failed (non-fatal): %s", exc)

    # Ensure Strava webhook subscription exists on startup
    if os.getenv("ENABLE_STRAVA_INTEGRATION", "false").lower() in {"1", "true", "yes", "on"}:
        try:
            from .integrations.registry import get_connector
            connector = get_connector("strava")
            if connector.is_webhook_configured():
                result = await connector.ensure_webhook_subscription()
                logger.info("Strava webhook subscription: %s", result.get("status"))
        except Exception as exc:
            logger.warning("Strava webhook subscription check failed: %s", exc)

    # Backfill duplicate_of_id for any historic activities that were recorded
    # before the duplicate-detection column existed.  Safe to run on every
    # startup — only touches rows where duplicate_of_id IS NULL.
    try:
        from .services.activity_dedupe import _backfill_duplicates
        marked = await _backfill_duplicates(engine)
        if marked:
            logger.info("Duplicate backfill: marked %d historic duplicate(s)", marked)
    except Exception as exc:
        logger.warning("Duplicate backfill failed (non-fatal): %s", exc)

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
