from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...models import HRVDaily, RHRDaily, SleepSession, StressDaily


async def _upsert_wellness(db: AsyncSession, *, user_id: int, provider: str, wellness_payload: dict) -> dict[str, int]:
    counts = {"hrv_daily": 0, "rhr_daily": 0, "sleep_sessions": 0, "stress_daily": 0}

    for item in wellness_payload.get("hrv_daily", []) or []:
        record = await db.scalar(
            select(HRVDaily).where(
                HRVDaily.user_id == user_id,
                HRVDaily.source_provider == provider,
                HRVDaily.record_date == item.get("date"),
            )
        )
        if not record:
            record = HRVDaily(
                user_id=user_id,
                source_provider=provider,
                record_date=item.get("date"),
                hrv_ms=float(item.get("hrv_ms") or 0),
                external_record_id=item.get("provider_record_id"),
            )
            db.add(record)
        else:
            record.hrv_ms = float(item.get("hrv_ms") or record.hrv_ms)
        counts["hrv_daily"] += 1

    for item in wellness_payload.get("rhr_daily", []) or []:
        record = await db.scalar(
            select(RHRDaily).where(
                RHRDaily.user_id == user_id,
                RHRDaily.source_provider == provider,
                RHRDaily.record_date == item.get("date"),
            )
        )
        if not record:
            record = RHRDaily(
                user_id=user_id,
                source_provider=provider,
                record_date=item.get("date"),
                resting_hr=float(item.get("resting_hr") or 0),
                external_record_id=item.get("provider_record_id"),
            )
            db.add(record)
        else:
            record.resting_hr = float(item.get("resting_hr") or record.resting_hr)
        counts["rhr_daily"] += 1

    for item in wellness_payload.get("sleep_sessions", []) or []:
        external_record_id = item.get("provider_record_id")
        if not external_record_id:
            continue
        record = await db.scalar(
            select(SleepSession).where(
                SleepSession.user_id == user_id,
                SleepSession.source_provider == provider,
                SleepSession.external_record_id == external_record_id,
            )
        )
        if not record:
            record = SleepSession(
                user_id=user_id,
                source_provider=provider,
                external_record_id=external_record_id,
                start_time=item.get("start_time"),
                end_time=item.get("end_time"),
                duration_seconds=int(item.get("duration_seconds") or 0),
                quality_score=item.get("quality_score"),
            )
            db.add(record)
        else:
            record.start_time = item.get("start_time") or record.start_time
            record.end_time = item.get("end_time") or record.end_time
            record.duration_seconds = int(item.get("duration_seconds") or record.duration_seconds)
            record.quality_score = item.get("quality_score", record.quality_score)
        counts["sleep_sessions"] += 1

    for item in wellness_payload.get("stress_daily", []) or []:
        record = await db.scalar(
            select(StressDaily).where(
                StressDaily.user_id == user_id,
                StressDaily.source_provider == provider,
                StressDaily.record_date == item.get("date"),
            )
        )
        if not record:
            record = StressDaily(
                user_id=user_id,
                source_provider=provider,
                record_date=item.get("date"),
                stress_score=float(item.get("stress_score") or 0),
                external_record_id=item.get("provider_record_id"),
            )
            db.add(record)
        else:
            record.stress_score = float(item.get("stress_score") or record.stress_score)
        counts["stress_daily"] += 1

    await db.commit()
    return counts
