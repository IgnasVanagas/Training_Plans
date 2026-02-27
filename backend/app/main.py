from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
from sqlalchemy import text

from .database import Base, engine
from .routers import auth, users, activities, calendar, workouts, integrations, communications
from .seed import seed_data

app = FastAPI(title="Endurance Sports Management Platform")

allowed_origins_raw = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
allowed_origins = [origin.strip() for origin in allowed_origins_raw.split(",") if origin.strip()]
allowed_origin_regex = os.getenv(
    "ALLOWED_ORIGIN_REGEX",
    r"^https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=allowed_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS hrv_ms DOUBLE PRECISION"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE"))
        await conn.execute(text("ALTER TABLE planned_workouts ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_activities_athlete_created_at ON activities (athlete_id, created_at DESC)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_planned_workouts_user_date ON planned_workouts (user_id, date)"))
        await conn.execute(text("UPDATE planned_workouts SET created_by_user_id = user_id WHERE created_by_user_id IS NULL"))
        await conn.execute(text("UPDATE users SET email_verified = TRUE WHERE email_verified IS NULL"))

    if os.getenv("AUTO_SEED_DEMO", "true").lower() in {"1", "true", "yes", "on"}:
        await seed_data()


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(activities.router)
app.include_router(calendar.router)
app.include_router(workouts.router)
app.include_router(integrations.router)
app.include_router(communications.router)
