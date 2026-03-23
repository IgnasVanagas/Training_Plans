from __future__ import annotations

from datetime import datetime, timedelta
import hashlib
import json
from typing import Any, Optional

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from ..models import Activity


def sha256_hex(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def normalize_sport(sport: Optional[str]) -> str:
    if not sport:
        return "other"
    lowered = sport.lower()
    if any(x in lowered for x in ("run", "jog", "treadmill")):
        return "running"
    if any(x in lowered for x in ("cycl", "bike", "ride")):
        return "cycling"
    if any(x in lowered for x in ("swim", "pool")):
        return "swimming"
    if any(x in lowered for x in ("walk", "hik")):
        return "walking"
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
    # 1. Provider + source_id — search ALL activities (including ones previously marked as
    #    duplicates) so Strava re-syncing a marked duplicate doesn't create a brand-new row.
    if source_provider and source_activity_id:
        sp = source_provider.strip().lower()
        si = source_activity_id.strip()
        result = await db.scalar(
            select(Activity).where(
                Activity.athlete_id == athlete_id,
                Activity.streams['_meta']['source_provider'].astext == sp,
                Activity.streams['_meta']['source_activity_id'].astext == si,
            ).limit(1)
        )
        if result:
            # If the found activity is itself a duplicate, return its original
            if result.duplicate_of_id:
                orig = await db.get(Activity, result.duplicate_of_id)
                return orig or result
            return result

    # 2. File SHA256 (originals only)
    if file_sha256:
        result = await db.scalar(
            select(Activity).where(
                Activity.athlete_id == athlete_id,
                Activity.streams['_meta']['file_sha256'].astext == file_sha256,
                Activity.duplicate_of_id.is_(None),
            ).limit(1)
        )
        if result:
            return result

    # 3. Fingerprint (originals only)
    if fingerprint_v1:
        result = await db.scalar(
            select(Activity).where(
                Activity.athlete_id == athlete_id,
                Activity.streams['_meta']['fingerprint_v1'].astext == fingerprint_v1,
                Activity.duplicate_of_id.is_(None),
            ).limit(1)
        )
        if result:
            return result

    # 4. Fuzzy: narrow to ±15-minute window using the composite index, then check in Python
    if created_at is not None:
        ns = normalize_sport(sport)
        window_start = created_at - timedelta(seconds=900)
        window_end = created_at + timedelta(seconds=900)
        rows = await db.execute(
            select(Activity).options(load_only(
                Activity.id, Activity.sport, Activity.created_at,
                Activity.duration, Activity.distance, Activity.duplicate_of_id,
            )).where(
                Activity.athlete_id == athlete_id,
                Activity.duplicate_of_id.is_(None),
                Activity.created_at.between(window_start, window_end),
            )
        )
        for a in rows.scalars().all():
            as_ = normalize_sport(a.sport)
            if ns != "other" and as_ != "other" and as_ != ns:
                continue
            a_dist = float(a.distance or 0)
            q_dist = float(distance_m or 0)
            indoor_pair = a_dist == 0 or q_dist == 0
            if abs(float(a.duration or 0) - float(duration_s or 0)) > (3600 if indoor_pair else 600):
                continue
            if not indoor_pair and abs(a_dist - q_dist) > 500:
                continue
            return a

    return None


# ---------------------------------------------------------------------------
# Startup backfill — run once per server start to mark any historic duplicates
# that existed before the duplicate_of_id column was added.
# ---------------------------------------------------------------------------

def _row_meta(row: dict) -> dict:
    streams = row.get("streams") or {}
    if isinstance(streams, str):
        try:
            streams = json.loads(streams)
        except Exception:
            streams = {}
    m = streams.get("_meta") if isinstance(streams, dict) else None
    return m if isinstance(m, dict) else {}


def _rows_are_duplicate(existing: dict, candidate: dict) -> bool:
    """Same logic as find_duplicate_activity but operates on plain dicts."""
    em = _row_meta(existing)
    cm = _row_meta(candidate)

    eh = str(em.get("file_sha256", "")).strip()
    ch = str(cm.get("file_sha256", "")).strip()
    if eh and ch and eh == ch:
        return True

    ep = em.get("source_provider") or None
    es = em.get("source_activity_id") or None
    cp = cm.get("source_provider") or None
    cs = cm.get("source_activity_id") or None
    if ep and es and cp and cs and str(ep).strip().lower() == str(cp).strip().lower() and str(es).strip() == str(cs).strip():
        return True

    ef = str(em.get("fingerprint_v1", "")).strip()
    cf = str(cm.get("fingerprint_v1", "")).strip()
    if ef and cf and ef == cf:
        return True

    ec = existing.get("created_at")
    cc = candidate.get("created_at")
    if ec is None or cc is None:
        return False

    ns_e = normalize_sport(existing.get("sport"))
    ns_c = normalize_sport(candidate.get("sport"))
    if ns_e != "other" and ns_c != "other" and ns_e != ns_c:
        return False

    dist_e = float(existing.get("distance") or 0)
    dist_c = float(candidate.get("distance") or 0)
    indoor_pair = dist_e == 0 or dist_c == 0
    if abs((ec - cc).total_seconds()) > 900:
        return False
    if abs(float(existing.get("duration") or 0) - float(candidate.get("duration") or 0)) > (3600 if indoor_pair else 600):
        return False
    if not indoor_pair and abs(dist_e - dist_c) > 500:
        return False

    return True


async def _backfill_duplicates(engine) -> int:
    """
    Scan all activities with duplicate_of_id IS NULL, detect duplicates using
    the same rules as find_duplicate_activity(), and set duplicate_of_id on the
    newer copy.  Returns the number of rows updated.
    """
    async with engine.connect() as conn:
        result = await conn.execute(text(
            "SELECT id, athlete_id, sport, created_at, duration, distance, streams "
            "FROM activities WHERE duplicate_of_id IS NULL ORDER BY athlete_id, id"
        ))
        rows = [dict(r) for r in result.mappings().fetchall()]

    by_athlete: dict[int, list] = {}
    for r in rows:
        by_athlete.setdefault(r["athlete_id"], []).append(r)

    to_mark: list[tuple[int, int]] = []
    for activities in by_athlete.values():
        claimed: set[int] = set()
        for i, candidate in enumerate(activities):
            if candidate["id"] in claimed:
                continue
            for original in activities[:i]:
                if original["id"] in claimed:
                    continue
                if _rows_are_duplicate(original, candidate):
                    to_mark.append((candidate["id"], original["id"]))
                    claimed.add(candidate["id"])
                    break

    if not to_mark:
        return 0

    async with engine.begin() as conn:
        for dup_id, orig_id in to_mark:
            await conn.execute(
                text("UPDATE activities SET duplicate_of_id = :orig WHERE id = :dup"),
                {"orig": orig_id, "dup": dup_id},
            )
    return len(to_mark)
