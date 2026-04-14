from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import hashlib
import json
from typing import Any, Optional

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Activity

# ---------------------------------------------------------------------------
# Thresholds — single source of truth for all matching tiers
# ---------------------------------------------------------------------------

_FUZZY_WINDOW_S: int = 2700             # ±45 minutes
_INDOOR_DURATION_TOLERANCE_S: int = 3600  # 60 min — treadmill/trainer drift
_OUTDOOR_DURATION_TOLERANCE_S: int = 600  # 10 min — GPS drift
_OUTDOOR_DISTANCE_TOLERANCE_M: int = 500  # 500 m


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Identity dataclass — canonical representation of dedup-relevant fields
# ---------------------------------------------------------------------------

@dataclass
class _ActivityIdentity:
    file_sha256: Optional[str]
    source_provider: Optional[str]
    source_activity_id: Optional[str]
    fingerprint_v1: Optional[str]
    sport: Optional[str]
    created_at: Optional[datetime]
    duration_s: float
    distance_m: float


def _meta_from_streams(streams: Any) -> dict:
    """Extract the _meta dict from a streams value (dict, JSON string, or None)."""
    if isinstance(streams, str):
        try:
            streams = json.loads(streams)
        except Exception:
            return {}
    if not isinstance(streams, dict):
        return {}
    meta = streams.get("_meta")
    return meta if isinstance(meta, dict) else {}


def _identity_from_meta(meta: dict, *, sport: Any, created_at: Any, duration: Any, distance: Any) -> _ActivityIdentity:
    sha = str(meta.get("file_sha256", "")).strip() or None
    prov = str(meta.get("source_provider", "")).strip().lower() or None
    sid = str(meta.get("source_activity_id", "")).strip() or None
    fp = str(meta.get("fingerprint_v1", "")).strip() or None
    return _ActivityIdentity(
        file_sha256=sha,
        source_provider=prov,
        source_activity_id=sid,
        fingerprint_v1=fp,
        sport=sport,
        created_at=created_at,
        duration_s=float(duration or 0),
        distance_m=float(distance or 0),
    )


def _identity_from_row(row: dict) -> _ActivityIdentity:
    return _identity_from_meta(
        _meta_from_streams(row.get("streams")),
        sport=row.get("sport"),
        created_at=row.get("created_at"),
        duration=row.get("duration"),
        distance=row.get("distance"),
    )


def _identity_from_activity(activity: Activity) -> _ActivityIdentity:
    return _identity_from_meta(
        _meta_from_streams(activity.streams),
        sport=activity.sport,
        created_at=activity.created_at,
        duration=activity.duration,
        distance=activity.distance,
    )


# ---------------------------------------------------------------------------
# Single matching function — used by both DB-backed and plain-dict paths
# ---------------------------------------------------------------------------

def _identities_match(a: _ActivityIdentity, b: _ActivityIdentity) -> bool:
    """Four-tier duplicate check. First matching tier wins."""
    # Tier 1: Provider + external ID (strongest signal; checked before SHA so
    #         a resync of a previously-marked duplicate is always recognised)
    if (
        a.source_provider and a.source_activity_id
        and b.source_provider and b.source_activity_id
        and a.source_provider == b.source_provider
        and a.source_activity_id == b.source_activity_id
    ):
        return True

    # Tier 2: File SHA-256
    if a.file_sha256 and b.file_sha256 and a.file_sha256 == b.file_sha256:
        return True

    # Tier 3: Fingerprint v1
    if a.fingerprint_v1 and b.fingerprint_v1 and a.fingerprint_v1 == b.fingerprint_v1:
        return True

    # Tier 4: Fuzzy — time window + sport + duration + distance
    if a.created_at is None or b.created_at is None:
        return False
    if abs((a.created_at - b.created_at).total_seconds()) > _FUZZY_WINDOW_S:
        return False

    ns_a = normalize_sport(a.sport)
    ns_b = normalize_sport(b.sport)
    if ns_a != "other" and ns_b != "other" and ns_a != ns_b:
        return False

    indoor_pair = a.distance_m == 0 or b.distance_m == 0
    duration_tol = _INDOOR_DURATION_TOLERANCE_S if indoor_pair else _OUTDOOR_DURATION_TOLERANCE_S
    if abs(a.duration_s - b.duration_s) > duration_tol:
        return False
    if not indoor_pair and abs(a.distance_m - b.distance_m) > _OUTDOOR_DISTANCE_TOLERANCE_M:
        return False

    return True


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def _activity_meta(activity: Activity) -> dict[str, Any]:
    """Extract the _meta dict from an Activity ORM instance."""
    return _meta_from_streams(activity.streams)


def _rows_are_duplicate(existing: dict, candidate: dict) -> bool:
    """Return True if two activity row dicts should be considered duplicates."""
    return _identities_match(_identity_from_row(existing), _identity_from_row(candidate))


# ---------------------------------------------------------------------------
# DB-backed duplicate lookup (called at ingest time)
# ---------------------------------------------------------------------------

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
    """
    Return the canonical (primary) activity that matches the given identity, or None.

    The DB queries cover Tiers 1–3 using indexed JSONB paths for speed.
    Tier 4 (fuzzy) pulls a narrow time window and matches in Python via
    _identities_match(), keeping the matching logic in one place.
    """

    async def _resolve_primary(activity: Activity) -> Activity:
        if activity.duplicate_of_id:
            primary = await db.get(Activity, activity.duplicate_of_id)
            return primary or activity
        return activity

    # Tier 1: Provider + source_id — search ALL rows (including secondaries) so
    #         re-syncing a previously-marked duplicate doesn't create a new row.
    #         Deleted activities are excluded so re-syncing after deletion works.
    if source_provider and source_activity_id:
        sp = source_provider.strip().lower()
        si = source_activity_id.strip()
        found = await db.scalar(
            select(Activity).where(
                Activity.athlete_id == athlete_id,
                Activity.is_deleted == False,  # noqa: E712
                Activity.streams["_meta"]["source_provider"].astext == sp,
                Activity.streams["_meta"]["source_activity_id"].astext == si,
            ).limit(1)
        )
        if found:
            return await _resolve_primary(found)

    # Tier 2: File SHA-256 (originals only, non-deleted)
    if file_sha256:
        found = await db.scalar(
            select(Activity).where(
                Activity.athlete_id == athlete_id,
                Activity.is_deleted == False,  # noqa: E712
                Activity.streams["_meta"]["file_sha256"].astext == file_sha256,
                Activity.duplicate_of_id.is_(None),
            ).limit(1)
        )
        if found:
            return found

    # Tier 3: Fingerprint v1 (originals only, non-deleted)
    if fingerprint_v1:
        found = await db.scalar(
            select(Activity).where(
                Activity.athlete_id == athlete_id,
                Activity.is_deleted == False,  # noqa: E712
                Activity.streams["_meta"]["fingerprint_v1"].astext == fingerprint_v1,
                Activity.duplicate_of_id.is_(None),
            ).limit(1)
        )
        if found:
            return found

    # Tier 4: Fuzzy — pull narrow window from DB, match in Python (non-deleted only)
    if created_at is not None:
        window_start = created_at - timedelta(seconds=_FUZZY_WINDOW_S)
        window_end = created_at + timedelta(seconds=_FUZZY_WINDOW_S)
        candidates_res = await db.execute(
            select(Activity).where(
                Activity.athlete_id == athlete_id,
                Activity.is_deleted == False,  # noqa: E712
                Activity.duplicate_of_id.is_(None),
                Activity.created_at.between(window_start, window_end),
            )
        )
        query_identity = _ActivityIdentity(
            file_sha256=file_sha256,
            source_provider=source_provider,
            source_activity_id=source_activity_id,
            fingerprint_v1=fingerprint_v1,
            sport=sport,
            created_at=created_at,
            duration_s=float(duration_s or 0),
            distance_m=float(distance_m or 0),
        )
        for candidate in candidates_res.scalars():
            if _identities_match(query_identity, _identity_from_activity(candidate)):
                return candidate

    return None


# ---------------------------------------------------------------------------
# Startup backfill — run once per server start to retroactively mark historic
# duplicates that predate the duplicate_of_id column.
# ---------------------------------------------------------------------------

async def _backfill_duplicates(engine) -> int:
    """
    Scan all primary activities per athlete and set duplicate_of_id on any
    newer copy that matches. Returns the number of rows updated.
    """
    async with engine.connect() as conn:
        result = await conn.execute(text(
            "SELECT id, athlete_id, sport, created_at, duration, distance, streams "
            "FROM activities WHERE duplicate_of_id IS NULL AND is_deleted = false "
            "ORDER BY athlete_id, id"
        ))
        rows = [dict(r) for r in result.mappings().fetchall()]

    by_athlete: dict[int, list] = {}
    for r in rows:
        by_athlete.setdefault(r["athlete_id"], []).append(r)

    to_mark: list[tuple[int, int]] = []  # (duplicate_id, original_id)
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
        await conn.execute(
            text("UPDATE activities SET duplicate_of_id = :orig WHERE id = :dup"),
            [{"orig": orig_id, "dup": dup_id} for dup_id, orig_id in to_mark],
        )
    return len(to_mark)
