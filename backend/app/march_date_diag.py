import asyncio
from datetime import datetime
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Activity

USER_ID = 4


async def main():
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(Activity)
                .where(Activity.athlete_id == USER_ID, Activity.file_type == "provider")
                .order_by(Activity.created_at.desc())
                .limit(120)
            )
        ).scalars().all()

        print("id | created_at | created_date | start_date_local | local_date | source_activity_id")
        mismatch = 0
        for activity in rows:
            streams = activity.streams if isinstance(activity.streams, dict) else {}
            meta = streams.get("_meta") if isinstance(streams.get("_meta"), dict) else {}
            if str(meta.get("source_provider") or "") != "strava":
                continue

            provider_payload = streams.get("provider_payload") if isinstance(streams.get("provider_payload"), dict) else {}
            summary = provider_payload.get("summary") if isinstance(provider_payload.get("summary"), dict) else {}
            local_raw = summary.get("start_date_local")

            local_date = None
            if isinstance(local_raw, str) and local_raw.strip():
                text = local_raw.strip()
                try:
                    local_date = datetime.fromisoformat(text.replace("Z", "+00:00")).date()
                except Exception:
                    try:
                        local_date = datetime.strptime(text[:10], "%Y-%m-%d").date()
                    except Exception:
                        local_date = None

            created_date = activity.created_at.date() if activity.created_at else None
            source_activity_id = meta.get("source_activity_id")

            print(
                "{} | {} | {} | {} | {} | {}".format(
                    activity.id,
                    activity.created_at,
                    created_date,
                    local_raw,
                    local_date,
                    source_activity_id,
                )
            )

            if local_date and created_date and local_date != created_date:
                mismatch += 1

        print("\nMismatched created_date vs local_date in recent set:", mismatch)


if __name__ == "__main__":
    asyncio.run(main())
