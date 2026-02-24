import asyncio
import os
import sys
from sqlalchemy import select, delete, update
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

# Add the parent directory to sys.path to import app modules
# When running inside the container: /app/app/reset_activities.py -> parent is /app
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.models import User, Activity, ProviderSyncState, ProviderConnection
from app.database import Base

# Default to localhost if running outside docker, but use db if inside
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://app:app@localhost:5432/endurance")

async def reset_activities(email: str):
    print(f"Connecting to database at {DATABASE_URL}...")
    engine = create_async_engine(DATABASE_URL, echo=False)
    async_session = async_sessionmaker(engine, expire_on_commit=False)

    async with async_session() as session:
        # Find user
        print(f"Finding user {email}...")
        result = await session.execute(select(User).where(User.email == email))
        user = result.scalars().first()
        
        if not user:
            print(f"User with email {email} not found.")
            return

        print(f"Found user ID: {user.id}")

        # Delete activities
        print("Deleting activities...")
        await session.execute(delete(Activity).where(Activity.athlete_id == user.id))
        
        # Reset sync state for Strava
        print("Resetting provider sync state...")
        await session.execute(delete(ProviderSyncState).where(ProviderSyncState.user_id == user.id))

        # Reset last_sync_at on connections
        print("Resetting provider connection last_sync_at...")
        await session.execute(
            update(ProviderConnection)
            .where(ProviderConnection.user_id == user.id)
            .values(last_sync_at=None, status="connected") # Ensure it's connected so we can sync
        )

        await session.commit()
        print("Done! Activities deleted and sync state reset.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python reset_activities.py <email>")
        sys.exit(1)
    
    email = sys.argv[1]
    asyncio.run(reset_activities(email))
