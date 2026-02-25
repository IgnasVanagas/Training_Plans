from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
from sqlalchemy import text

from .database import Base, engine
from .routers import auth, users, activities, calendar, workouts, integrations
from .seed import seed_data

app = FastAPI(title="Endurance Sports Management Platform")

allowed_origins_raw = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
allowed_origins = [origin.strip() for origin in allowed_origins_raw.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS hrv_ms DOUBLE PRECISION"))

    if os.getenv("AUTO_SEED_DEMO", "true").lower() in {"1", "true", "yes", "on"}:
        await seed_data()


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(activities.router)
app.include_router(calendar.router)
app.include_router(workouts.router)
app.include_router(integrations.router)
