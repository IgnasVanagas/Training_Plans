from __future__ import annotations

from datetime import timezone

from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Activity
from ..services.activity_dedupe import build_fingerprint, find_duplicate_activity


async def ingest_provider_activity(
    db: AsyncSession,
    *,
    user_id: int,
    provider: str,
    provider_activity_id: str,
    name: str,
    start_time,
    duration_s: float | None,
    distance_m: float | None,
    sport: str | None,
    average_hr: float | None,
    average_watts: float | None,
    average_speed: float | None,
    payload: dict | None,
    auto_commit: bool = True,
) -> tuple[Activity, bool]:
    ts = start_time
    if ts.tzinfo is not None:
        ts = ts.astimezone(timezone.utc).replace(tzinfo=None)

    fingerprint = build_fingerprint(
        sport=sport,
        created_at=ts,
        duration_s=duration_s,
        distance_m=distance_m,
    )

    duplicate = await find_duplicate_activity(
        db,
        athlete_id=user_id,
        source_provider=provider,
        source_activity_id=provider_activity_id,
        fingerprint_v1=fingerprint,
        sport=sport,
        created_at=ts,
        duration_s=duration_s,
        distance_m=distance_m,
    )
    detail_payload = payload.get("detail") if isinstance(payload, dict) and isinstance(payload.get("detail"), dict) else {}
    stream_points = detail_payload.get("data") if isinstance(detail_payload.get("data"), list) else []
    power_curve = detail_payload.get("power_curve")
    hr_zones = detail_payload.get("hr_zones")
    pace_curve = detail_payload.get("pace_curve")
    laps = detail_payload.get("laps") if isinstance(detail_payload.get("laps"), list) else None
    splits_metric = detail_payload.get("splits_metric") if isinstance(detail_payload.get("splits_metric"), list) else None
    stats = detail_payload.get("stats") if isinstance(detail_payload.get("stats"), dict) else {}

    if duplicate:
        duplicate_streams = getattr(duplicate, "streams", None)
        existing_streams = duplicate_streams if isinstance(duplicate_streams, dict) else {}
        existing_points = existing_streams.get("data") if isinstance(existing_streams.get("data"), list) else []
        existing_meta = existing_streams.get("_meta") if isinstance(existing_streams.get("_meta"), dict) else {}

        should_enrich = (
            getattr(duplicate, "file_type", None) == "provider"
            and (
                (len(existing_points) == 0 and len(stream_points) > 0)
                or (not existing_streams.get("laps") and laps)
            )
        )

        if getattr(duplicate, "file_type", None) == "provider":
            duplicate.filename = name or duplicate.filename
            duplicate.sport = sport or duplicate.sport
            duplicate.created_at = ts
            duplicate.duration = duration_s if duration_s is not None else duplicate.duration
            duplicate.distance = distance_m if distance_m is not None else duplicate.distance
            duplicate.avg_speed = average_speed if average_speed is not None else duplicate.avg_speed
            duplicate.average_hr = average_hr if average_hr is not None else duplicate.average_hr
            duplicate.average_watts = average_watts if average_watts is not None else duplicate.average_watts

            merged_streams = dict(existing_streams)
            merged_streams["provider_payload"] = payload or merged_streams.get("provider_payload") or {}
            merged_meta = dict(existing_meta)
            merged_meta.update({
                "deleted": False,
                "source_provider": provider,
                "source_activity_id": provider_activity_id,
                "fingerprint_v1": fingerprint,
                "import_channel": "integration_sync",
            })
            merged_streams["_meta"] = merged_meta
            duplicate.streams = merged_streams
            db.add(duplicate)

        if should_enrich:
            duplicate.streams = {
                "data": stream_points,
                "power_curve": power_curve,
                "hr_zones": hr_zones,
                "pace_curve": pace_curve,
                "laps": laps,
                "splits_metric": splits_metric,
                "provider_payload": payload or {},
                "stats": stats,
                "_meta": {
                    "deleted": False,
                    "source_provider": provider,
                    "source_activity_id": provider_activity_id,
                    "fingerprint_v1": fingerprint,
                    "import_channel": "integration_sync",
                    "enriched_at": ts.isoformat(),
                },
            }
            db.add(duplicate)
        if auto_commit:
            await db.commit()
            await db.refresh(duplicate)
        else:
            await db.flush()
        return duplicate, False

    activity = Activity(
        athlete_id=user_id,
        filename=name,
        file_path=f"provider://{provider}/{provider_activity_id}",
        file_type="provider",
        sport=sport,
        created_at=ts,
        duration=duration_s,
        distance=distance_m,
        avg_speed=average_speed,
        average_hr=average_hr,
        average_watts=average_watts,
        streams={
            "data": stream_points,
            "power_curve": power_curve,
            "hr_zones": hr_zones,
            "pace_curve": pace_curve,
            "laps": laps,
            "splits_metric": splits_metric,
            "provider_payload": payload or {},
            "stats": stats,
            "_meta": {
                "deleted": False,
                "source_provider": provider,
                "source_activity_id": provider_activity_id,
                "fingerprint_v1": fingerprint,
                "import_channel": "integration_sync",
            },
        },
    )
    db.add(activity)
    if auto_commit:
        await db.commit()
        await db.refresh(activity)
    else:
        await db.flush()
    return activity, True
