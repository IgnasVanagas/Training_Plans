from __future__ import annotations

from datetime import datetime
import hashlib
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Activity


def sha256_hex(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def normalize_sport(sport: Optional[str]) -> str:
    if not sport:
        return "other"
    lowered = sport.lower()
    if "run" in lowered:
        return "running"
    if "cycl" in lowered or "bike" in lowered:
        return "cycling"
    return lowered


def _bucket_distance_m(distance_m: float) -> int:
    return int(round(distance_m / 25.0) * 25)


def _bucket_duration_s(duration_s: float) -> int:
    return int(round(duration_s / 5.0) * 5)


def build_fingerprint(
    *,
    sport: Optional[str],
    created_at: Optional[datetime],
    duration_s: Optional[float],
    distance_m: Optional[float],
) -> str:
    start_key = created_at.replace(second=0, microsecond=0).isoformat() if created_at else "unknown"
    normalized_sport = normalize_sport(sport)
    duration_key = _bucket_duration_s(float(duration_s or 0.0))
    distance_key = _bucket_distance_m(float(distance_m or 0.0))
    return f"v1|{normalized_sport}|{start_key}|{duration_key}|{distance_key}"


def extract_source_identity(parsed_data: dict[str, Any]) -> tuple[Optional[str], Optional[str]]:
    provider = (
        parsed_data.get("source_provider")
        or parsed_data.get("provider")
        or parsed_data.get("source")
    )

    source_id = (
        parsed_data.get("source_activity_id")
        or parsed_data.get("activity_id")
        or parsed_data.get("external_activity_id")
    )

    source_meta = parsed_data.get("source_meta")
    if isinstance(source_meta, dict):
        provider = provider or source_meta.get("provider")
        source_id = source_id or source_meta.get("activity_id") or source_meta.get("id")

    provider_str = str(provider).strip().lower() if provider else None
    source_id_str = str(source_id).strip() if source_id else None
    return provider_str, source_id_str


def _activity_meta(activity: Activity) -> dict[str, Any]:
    streams = activity.streams
    if isinstance(streams, dict):
        meta = streams.get("_meta")
        if isinstance(meta, dict):
            return meta
    return {}


async def find_duplicate_activity(
    db: AsyncSession,
    *,
    athlete_id: int,
    file_sha256: Optional[str] = None,
    source_provider: Optional[str] = None,
    source_activity_id: Optional[str] = None,
    fingerprint_v1: Optional[str] = None,
    sport: Optional[str] = None,
    created_at: Optional[datetime] = None,
    duration_s: Optional[float] = None,
    distance_m: Optional[float] = None,
) -> Optional[Activity]:
    res = await db.execute(select(Activity).where(Activity.athlete_id == athlete_id))
    activities = res.scalars().all()

    normalized_provider = source_provider.strip().lower() if source_provider else None
    normalized_source_id = source_activity_id.strip() if source_activity_id else None
    normalized_sport = normalize_sport(sport)

    for activity in activities:
        meta = _activity_meta(activity)

        existing_hash = str(meta.get("file_sha256", "")).strip() if meta.get("file_sha256") else None
        if file_sha256 and existing_hash and existing_hash == file_sha256:
            return activity

        existing_provider = str(meta.get("source_provider", "")).strip().lower() if meta.get("source_provider") else None
        existing_source_id = str(meta.get("source_activity_id", "")).strip() if meta.get("source_activity_id") else None
        if normalized_provider and normalized_source_id and existing_provider and existing_source_id:
            if existing_provider == normalized_provider and existing_source_id == normalized_source_id:
                return activity

        existing_fingerprint = str(meta.get("fingerprint_v1", "")).strip() if meta.get("fingerprint_v1") else None
        if fingerprint_v1 and existing_fingerprint and existing_fingerprint == fingerprint_v1:
            return activity

    if created_at is None:
        return None

    for activity in activities:
        existing_sport = normalize_sport(activity.sport)
        if normalized_sport != "other" and existing_sport != normalized_sport:
            continue

        delta_seconds = abs((activity.created_at - created_at).total_seconds())
        if delta_seconds > 180:
            continue

        existing_duration = float(activity.duration or 0.0)
        incoming_duration = float(duration_s or 0.0)
        if abs(existing_duration - incoming_duration) > 90:
            continue

        existing_distance = float(activity.distance or 0.0)
        incoming_distance = float(distance_m or 0.0)
        if abs(existing_distance - incoming_distance) > 150:
            continue

        return activity

    return None
