import asyncio
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://app:app@localhost:5432/endurance")


async def add_columns() -> None:
    engine = create_async_engine(DATABASE_URL)
    async with engine.begin() as conn:
        print("Migrating users privacy policy columns...")
        try:
            await conn.execute(text("ALTER TABLE users ADD COLUMN privacy_policy_accepted_at TIMESTAMP;"))
            print("Added users.privacy_policy_accepted_at")
        except Exception as exc:
            print(f"users.privacy_policy_accepted_at may already exist: {exc}")

        try:
            await conn.execute(text("ALTER TABLE users ADD COLUMN privacy_policy_version VARCHAR(50);"))
            print("Added users.privacy_policy_version")
        except Exception as exc:
            print(f"users.privacy_policy_version may already exist: {exc}")

        try:
            await conn.execute(text("ALTER TABLE users ADD COLUMN privacy_policy_url VARCHAR(500);"))
            print("Added users.privacy_policy_url")
        except Exception as exc:
            print(f"users.privacy_policy_url may already exist: {exc}")

        print("Migrating organization member sharing consent columns...")
        try:
            await conn.execute(text("ALTER TABLE organization_members ADD COLUMN athlete_data_sharing_consent BOOLEAN DEFAULT FALSE;"))
            print("Added organization_members.athlete_data_sharing_consent")
        except Exception as exc:
            print(f"organization_members.athlete_data_sharing_consent may already exist: {exc}")

        try:
            await conn.execute(text("ALTER TABLE organization_members ADD COLUMN athlete_data_sharing_consented_at TIMESTAMP;"))
            print("Added organization_members.athlete_data_sharing_consented_at")
        except Exception as exc:
            print(f"organization_members.athlete_data_sharing_consented_at may already exist: {exc}")

        try:
            await conn.execute(text("ALTER TABLE organization_members ADD COLUMN athlete_data_sharing_consent_version VARCHAR(50);"))
            print("Added organization_members.athlete_data_sharing_consent_version")
        except Exception as exc:
            print(f"organization_members.athlete_data_sharing_consent_version may already exist: {exc}")

        await conn.execute(text("UPDATE organization_members SET athlete_data_sharing_consent = FALSE WHERE athlete_data_sharing_consent IS NULL;"))
        print("Backfilled null organization_members.athlete_data_sharing_consent values")

    await engine.dispose()
    print("Done")


if __name__ == "__main__":
    asyncio.run(add_columns())
