from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import asyncio
import logging
import os
import pathlib
import time
from sqlalchemy import text

try:
    import resource
except ImportError:
    resource = None

from .database import Base, engine
from .routers import auth, users, activities, calendar, workouts, integrations, communications, planning, admin
from .seed import seed_data

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Endurance Sports Management Platform")


def _read_process_memory_mb() -> tuple[float | None, float | None]:
    current_rss_mb: float | None = None
    peak_rss_mb: float | None = None

    try:
        with open("/proc/self/status", "r", encoding="utf-8") as status_file:
            for line in status_file:
                if line.startswith("VmRSS:"):
                    current_rss_mb = int(line.split()[1]) / 1024.0
                elif line.startswith("VmHWM:"):
                    peak_rss_mb = int(line.split()[1]) / 1024.0
    except OSError:
        pass

    try:
        if resource is None:
            raise RuntimeError("resource module unavailable")
        resource_peak_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0
        if peak_rss_mb is None:
            peak_rss_mb = resource_peak_mb
    except Exception:
        pass

    return current_rss_mb, peak_rss_mb


def _should_log_hot_path_memory(path: str) -> bool:
    hot_prefixes = (
        "/activities/",
        "/calendar/",
        "/communications/notifications",
        "/communications/organizations/",
        "/integrations/wellness/summary",
    )
    return any(path.startswith(prefix) for prefix in hot_prefixes)


@app.middleware("http")
async def log_hot_path_memory(request: Request, call_next):
    path = request.url.path
    if not _should_log_hot_path_memory(path):
        return await call_next(request)

    start = time.perf_counter()
    before_rss_mb, before_peak_rss_mb = _read_process_memory_mb()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000.0
    after_rss_mb, after_peak_rss_mb = _read_process_memory_mb()

    logger.info(
        "Hot path memory method=%s path=%s status=%s duration_ms=%.1f rss_before_mb=%s rss_after_mb=%s peak_before_mb=%s peak_after_mb=%s",
        request.method,
        path,
        response.status_code,
        duration_ms,
        f"{before_rss_mb:.1f}" if before_rss_mb is not None else "n/a",
        f"{after_rss_mb:.1f}" if after_rss_mb is not None else "n/a",
        f"{before_peak_rss_mb:.1f}" if before_peak_rss_mb is not None else "n/a",
        f"{after_peak_rss_mb:.1f}" if after_peak_rss_mb is not None else "n/a",
    )
    return response

# Chat file uploads — served at /uploads/chat/<filename>
_UPLOADS_DIR = pathlib.Path(os.getenv("UPLOADS_DIR", "uploads/chat"))
_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads/chat", StaticFiles(directory=str(_UPLOADS_DIR)), name="chat_uploads")

# Org picture uploads — served at /uploads/org/<filename>
_ORG_UPLOADS_DIR = pathlib.Path(os.getenv("ORG_UPLOADS_DIR", "uploads/org"))
_ORG_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads/org", StaticFiles(directory=str(_ORG_UPLOADS_DIR)), name="org_uploads")

# User profile picture uploads — served at /uploads/user/<filename>
_USER_UPLOADS_DIR = pathlib.Path(os.getenv("USER_UPLOADS_DIR", "uploads/user"))
_USER_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads/user", StaticFiles(directory=str(_USER_UPLOADS_DIR)), name="user_uploads")

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
# Regex covers all *.onrender.com subdomains and private LAN addresses — this is the
# primary guard so even if ALLOWED_ORIGINS env var is misconfigured, the correct
# origins are still permitted.
allowed_origin_regex = os.getenv(
    "ALLOWED_ORIGIN_REGEX",
    r"^https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$|^https://[a-zA-Z0-9][a-zA-Z0-9-]*\.onrender\.com$",
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
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_code VARCHAR(6)"))
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMP"))
            await conn.execute(text("ALTER TABLE planned_workouts ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER"))
            await conn.execute(text("ALTER TABLE planned_workouts ADD COLUMN IF NOT EXISTS season_plan_id INTEGER"))
            await conn.execute(text("ALTER TABLE planned_workouts ADD COLUMN IF NOT EXISTS planning_context JSONB"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_activities_athlete_created_at ON activities (athlete_id, created_at DESC)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_planned_workouts_user_date ON planned_workouts (user_id, date)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_planned_workouts_season_plan_id ON planned_workouts (season_plan_id)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_season_plans_athlete_updated_at ON season_plans (athlete_id, updated_at DESC)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_org_group_messages_org_created_at ON organization_group_messages (organization_id, created_at DESC, id DESC)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_org_coach_messages_thread_created_at ON organization_coach_messages (organization_id, athlete_id, coach_id, created_at DESC, id DESC)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_org_direct_messages_thread_created_at ON organization_direct_messages (organization_id, LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id), created_at DESC, id DESC)"))
            await conn.execute(text("UPDATE planned_workouts SET created_by_user_id = user_id WHERE created_by_user_id IS NULL"))
            await conn.execute(text("UPDATE users SET email_verified = TRUE WHERE email_verified IS NULL"))
            await conn.execute(text("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS country VARCHAR(100)"))
            await conn.execute(text("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255)"))
            await conn.execute(text("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS contact_number VARCHAR(50)"))
            await conn.execute(text("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS menstruation_available_to_coach BOOLEAN DEFAULT FALSE"))
            await conn.execute(text("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS training_days JSONB"))
            await conn.execute(text("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(10) DEFAULT 'en'"))
            await conn.execute(text("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS picture VARCHAR(255)"))
            await conn.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE"))
            await conn.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS duplicate_of_id INTEGER REFERENCES activities(id)"))
            await conn.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS rpe FLOAT"))
            await conn.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS notes TEXT"))
            await conn.execute(text("ALTER TABLE organization_group_messages ADD COLUMN IF NOT EXISTS attachment_url VARCHAR(500)"))
            await conn.execute(text("ALTER TABLE organization_group_messages ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255)"))
            await conn.execute(text("ALTER TABLE organization_coach_messages ADD COLUMN IF NOT EXISTS attachment_url VARCHAR(500)"))
            await conn.execute(text("ALTER TABLE organization_coach_messages ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255)"))
            await conn.execute(text("ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS message TEXT"))
            # Denormalized columns to avoid JSONB scanning on hot calendar/list paths
            await conn.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS aerobic_load FLOAT"))
            await conn.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS anaerobic_load FLOAT"))
            await conn.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS moving_time FLOAT"))
            await conn.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS local_date DATE"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_activities_athlete_local_date ON activities (athlete_id, local_date)"))
            # Backfill: populate new columns from streams JSONB for rows that are missing them
            await conn.execute(text("""
                UPDATE activities SET
                    aerobic_load = COALESCE(aerobic_load, (streams->'_meta'->>'aerobic_load')::float),
                    anaerobic_load = COALESCE(anaerobic_load, (streams->'_meta'->>'anaerobic_load')::float),
                    moving_time = COALESCE(moving_time,
                        NULLIF((streams->'stats'->>'total_timer_time')::float, 0),
                        NULLIF((streams->'provider_payload'->'summary'->>'moving_time')::float, 0)
                    ),
                    local_date = COALESCE(local_date,
                        (streams->'provider_payload'->'summary'->>'start_date_local')::timestamp::date,
                        (streams->'provider_payload'->'detail'->>'start_date_local')::timestamp::date,
                        DATE(created_at)
                    )
                WHERE is_deleted = FALSE
                  AND (aerobic_load IS NULL OR local_date IS NULL)
                  AND streams IS NOT NULL
            """))
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

    # Backfill duplicate_of_id for historic rows can be memory-heavy on small
    # instances. Keep it opt-in in production.
    duplicate_backfill_enabled = os.getenv("ENABLE_STARTUP_DUPLICATE_BACKFILL", "false").lower() in {"1", "true", "yes", "on"}
    if duplicate_backfill_enabled:
        try:
            from .services.activity_dedupe import _backfill_duplicates
            marked = await asyncio.wait_for(_backfill_duplicates(engine), timeout=_STARTUP_DB_TIMEOUT)
            if marked:
                logger.info("Duplicate backfill: marked %d historic duplicate(s)", marked)
        except asyncio.TimeoutError:
            logger.warning("Duplicate backfill timed out (non-fatal)")
        except Exception as exc:
            logger.warning("Duplicate backfill failed (non-fatal): %s", exc)
    else:
        logger.info("Startup duplicate backfill disabled (set ENABLE_STARTUP_DUPLICATE_BACKFILL=true to enable)")

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
