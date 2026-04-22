from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, status, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, case
from sqlalchemy.orm import defer
from ..database import get_db, AsyncSessionLocal
from ..models import User, Activity, OrganizationMember, RoleEnum, Profile, ProfileMetricHistory, PlannedWorkout, RHRDaily
from ..integrations.crypto import decrypt_token, encrypt_token
from ..integrations.registry import get_connector
from ..integrations.service import get_connection
from ..schemas import ActivityOut, ActivityDetail, ActivityUpdate, ActivityManualCreate, TrendDataPoint, PerformanceTrendResponse
from ..auth import get_current_user
from ..parsing import parse_activity_file
from ..services.compliance import match_and_score
from ..services.permissions import get_athlete_permissions
from ..services.activity_dedupe import (
    sha256_hex,
    build_fingerprint,
    extract_source_identity,
    find_duplicate_activity,
)
from ..services.personal_records import compute_activity_best_efforts, get_activity_prs, get_personal_records
from ..parsing import compute_metric_splits_from_points
from datetime import datetime, timezone, date, timedelta
from collections import defaultdict, deque
from typing import Any
import math
import os
import uuid
import logging
import time

router = APIRouter(prefix="/activities", tags=["activities"])

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Simple in-process TTL cache for expensive read-only aggregations.
# Maps cache_key -> (stored_at_monotonic, result).  Invalidated by athlete_id
# when activities are mutated (upload / delete / reparse).
# ---------------------------------------------------------------------------
_PERF_TREND_CACHE: dict[str, tuple[float, Any]] = {}
_ZONE_SUMMARY_CACHE: dict[str, tuple[float, Any]] = {}
_PERF_TREND_TTL = 3600.0   # 1 hour
_ZONE_SUMMARY_TTL = 1800.0  # 30 minutes

def _cache_get(store: dict, key: str, ttl: float) -> Any:
    entry = store.get(key)
    if entry and (time.monotonic() - entry[0]) < ttl:
        return entry[1]
    return None

def _cache_set(store: dict, key: str, value: Any) -> None:
    store[key] = (time.monotonic(), value)

def _invalidate_athlete_caches(athlete_id: int) -> None:
    prefix = f"{athlete_id}:"
    for store in (_PERF_TREND_CACHE, _ZONE_SUMMARY_CACHE):
        stale = [k for k in store if k.startswith(prefix)]
        for k in stale:
            del store[k]


async def _bg_match_and_score(athlete_id: int, activity_date: date) -> None:
    """Background task wrapper: opens its own DB session so the request session
    can be closed before this runs."""
    try:
        async with AsyncSessionLocal() as db:
            await match_and_score(db, athlete_id, activity_date)
    except Exception as exc:
        logger.warning("Background match_and_score failed for athlete %s: %s", athlete_id, exc)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
MAX_UPLOAD_SIZE_BYTES = int(os.getenv("MAX_UPLOAD_SIZE_BYTES", str(20 * 1024 * 1024)))


def _normalize_sport_name(sport: str | None) -> str:
    if not sport:
        return "other"
    lowered = sport.lower()
    if "run" in lowered:
        return "running"
    if "cycl" in lowered or "bike" in lowered or "ride" in lowered:
        return "cycling"
    return "other"


def _empty_bucket() -> dict:
    return {
        "activities_count": 0,
        "total_duration_minutes": 0.0,
        "total_distance_km": 0.0,
        "sports": {
            "running": {
                "activities_count": 0,
                "total_duration_minutes": 0.0,
                "total_distance_km": 0.0,
                "zone_seconds": {f"Z{i}": 0 for i in range(1, 6)},
                "zone_seconds_by_metric": {
                    "hr": {f"Z{i}": 0 for i in range(1, 6)},
                    "pace": {f"Z{i}": 0 for i in range(1, 8)},
                }
            },
            "cycling": {
                "activities_count": 0,
                "total_duration_minutes": 0.0,
                "total_distance_km": 0.0,
                "zone_seconds": {f"Z{i}": 0 for i in range(1, 8)},
                "zone_seconds_by_metric": {
                    "hr": {f"Z{i}": 0 for i in range(1, 6)},
                    "power": {f"Z{i}": 0 for i in range(1, 8)},
                }
            }
        }
    }


def _hist_lookup(history: list[tuple[datetime, float]], at: datetime, fallback: float) -> float:
    """Return the most recent value in a sorted (asc) history list that is <= `at`, or fallback."""
    result = fallback
    for dt, val in history:
        if dt <= at:
            result = val
        else:
            break
    return result


async def _get_metric_at_date(db: AsyncSession, user_id: int, metric: str, activity_date: datetime):
    """Return the most recent value of metric ('ftp'|'weight') recorded on or before activity_date."""
    row = await db.scalar(
        select(ProfileMetricHistory)
        .where(
            ProfileMetricHistory.user_id == user_id,
            ProfileMetricHistory.metric == metric,
            ProfileMetricHistory.recorded_at <= activity_date,
        )
        .order_by(ProfileMetricHistory.recorded_at.desc())
        .limit(1)
    )
    return row.value if row else None


def _safe_number(value, default: float = 0.0) -> float:
    try:
        parsed = float(value)
        if parsed != parsed:
            return default
        return parsed
    except (TypeError, ValueError):
        return default


def _extract_profile_zone_settings(profile: Profile | None) -> dict:
    if not profile:
        return {}
    sports_payload = getattr(profile, "sports", None)
    if isinstance(sports_payload, dict):
        zone_settings = sports_payload.get("zone_settings")
        if isinstance(zone_settings, dict):
            return zone_settings
    return {}


def _metric_upper_bounds(
    profile: Profile | None,
    *,
    sport: str,
    metric: str,
    fallback_bounds: list[float],
) -> list[float]:
    zone_settings = _extract_profile_zone_settings(profile)
    sport_cfg = zone_settings.get(sport) if isinstance(zone_settings, dict) else None
    metric_cfg = sport_cfg.get(metric) if isinstance(sport_cfg, dict) else None
    if not isinstance(metric_cfg, dict):
        return fallback_bounds

    upper_bounds = metric_cfg.get("upper_bounds")
    if isinstance(upper_bounds, list) and upper_bounds:
        parsed_bounds: list[float] = []
        for raw in upper_bounds:
            try:
                parsed_bounds.append(float(raw))
            except (TypeError, ValueError):
                return fallback_bounds

        if sport == "running" and metric == "pace":
            # Running pace is interpreted as min/km. Older payloads may contain seconds or percentages.
            if min(parsed_bounds) >= 60.0 and max(parsed_bounds) <= 1200.0:
                parsed_bounds = [bound / 60.0 for bound in parsed_bounds]
            elif max(parsed_bounds) > 20.0:
                return fallback_bounds

        if any(parsed_bounds[i] <= parsed_bounds[i - 1] for i in range(1, len(parsed_bounds))):
            return fallback_bounds
        return parsed_bounds

    lt1 = metric_cfg.get("lt1")
    lt2 = metric_cfg.get("lt2")
    try:
        if lt1 is None or lt2 is None:
            return fallback_bounds
        lt1f = float(lt1)
        lt2f = float(lt2)
    except (TypeError, ValueError):
        return fallback_bounds

    if sport == "running" and metric == "pace":
        if lt2f >= lt1f:
            return fallback_bounds
        # Zones based on %LT2 speed: Z1=50-60%, Z2=60-75%, Z3=75-90%, Z4=90-100%, Z5=100%+
        # Stored as % of LT2 pace time (inverse of speed %)
        return [
            lt2f * 1.80,  # Z1 upper: 50-60% LT2 speed
            lt2f * 1.50,  # Z2 upper: 60-75% LT2 speed
            lt2f * 1.20,  # Z3 upper: 75-90% LT2 speed
            lt2f * 1.05,  # Z4 upper: 90-100% LT2 speed
            lt2f * 0.95,  # Z5 upper: 100%+ LT2 speed
        ]

    if lt2f <= lt1f:
        return fallback_bounds

    if sport == "running" and metric == "hr":
        return [lt1f * 0.90, lt1f, (lt1f + lt2f) / 2.0, lt2f]
    if sport == "cycling" and metric == "hr":
        return [lt1f * 0.90, lt1f, (lt1f + lt2f) / 2.0, lt2f]
    if sport == "cycling" and metric == "power":
        return [lt1f * 0.80, lt1f, (lt1f + lt2f) / 2.0, lt2f, lt2f * 1.12, lt2f * 1.35]

    return fallback_bounds


def _resolve_effective_resting_hr(profile: Profile | None, lowest_recorded_rhr: float | None = None) -> float:
    profile_rhr = _safe_number(getattr(profile, "resting_hr", None), default=0.0)
    recorded_rhr = _safe_number(lowest_recorded_rhr, default=0.0)

    candidates = [value for value in (profile_rhr, recorded_rhr) if value > 0]
    if not candidates:
        return 60.0
    return min(candidates)


def _hr_zone_bounds_from_reserve(max_hr: float, resting_hr: float) -> list[float]:
    if max_hr <= 0:
        return []

    effective_resting_hr = max(30.0, min(resting_hr, max_hr - 1.0))
    reserve = max_hr - effective_resting_hr
    if reserve <= 0:
        return [max_hr * 0.60, max_hr * 0.70, max_hr * 0.80, max_hr * 0.90]

    return [
        effective_resting_hr + reserve * 0.60,
        effective_resting_hr + reserve * 0.70,
        effective_resting_hr + reserve * 0.80,
        effective_resting_hr + reserve * 0.90,
    ]


def _zone_index_from_upper_bounds(value: float, upper_bounds: list[float], reverse: bool = False) -> int:
    if not upper_bounds:
        return 1
    if reverse:
        for idx, bound in enumerate(reversed(upper_bounds), start=1):
            if value >= bound:
                return idx
        return len(upper_bounds) + 1

    for idx, bound in enumerate(upper_bounds, start=1):
        if value <= bound:
            return idx
    return len(upper_bounds) + 1


def _zone_bucket_key(zone_seconds: dict[str, float], zone: int) -> str:
    zone_indexes = [
        int(key[1:])
        for key in zone_seconds.keys()
        if isinstance(key, str) and key.startswith("Z") and key[1:].isdigit()
    ]
    if not zone_indexes:
        return f"Z{max(1, zone)}"

    min_zone = min(zone_indexes)
    max_zone = max(zone_indexes)
    clamped_zone = max(min_zone, min(max_zone, zone))
    return f"Z{clamped_zone}"


def _add_zone_seconds(zone_seconds: dict[str, float], zone: int, seconds: float) -> None:
    key = _zone_bucket_key(zone_seconds, zone)
    zone_seconds[key] = _safe_number(zone_seconds.get(key), default=0.0) + max(0.0, _safe_number(seconds, default=0.0))


def _normalize_utc_iso(value) -> str | None:
    if value is None:
        return None

    dt_value = None
    if isinstance(value, datetime):
        dt_value = value
    elif isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        if raw.endswith("Z"):
            raw = f"{raw[:-1]}+00:00"
        try:
            dt_value = datetime.fromisoformat(raw)
        except ValueError:
            return None

    if dt_value is None:
        return None

    if dt_value.tzinfo is None:
        dt_value = dt_value.replace(tzinfo=timezone.utc)
    else:
        dt_value = dt_value.astimezone(timezone.utc)

    return dt_value.isoformat().replace("+00:00", "Z")


def _normalize_activity_time_fields(stored_data: dict) -> tuple[dict, bool]:
    changed = False

    data_points = stored_data.get("data")
    if isinstance(data_points, list):
        for point in data_points:
            if not isinstance(point, dict):
                continue
            raw_ts = point.get("timestamp")
            if raw_ts is None:
                continue
            normalized_ts = _normalize_utc_iso(raw_ts)
            if normalized_ts and normalized_ts != raw_ts:
                point["timestamp"] = normalized_ts
                changed = True

    laps = stored_data.get("laps")
    if isinstance(laps, list):
        for lap in laps:
            if not isinstance(lap, dict):
                continue
            raw_start = lap.get("start_time")
            if raw_start is None:
                continue
            normalized_start = _normalize_utc_iso(raw_start)
            if normalized_start and normalized_start != raw_start:
                lap["start_time"] = normalized_start
                changed = True

    return stored_data, changed


async def _resolve_provider_access_token(
    db: AsyncSession,
    *,
    user_id: int,
    provider: str,
) -> str | None:
    connection = await get_connection(db, user_id=user_id, provider=provider)
    if not connection or connection.status != "connected" or not connection.encrypted_access_token:
        return None

    connector = get_connector(provider)
    access_token = decrypt_token(connection.encrypted_access_token)
    refresh_token = decrypt_token(connection.encrypted_refresh_token)

    now = datetime.utcnow()
    if connection.token_expires_at and connection.token_expires_at <= (now + timedelta(minutes=2)) and refresh_token:
        try:
            refreshed = await connector.refresh_token(refresh_token)
            access_token = refreshed.access_token
            connection.encrypted_access_token = encrypt_token(refreshed.access_token)
            if refreshed.refresh_token:
                connection.encrypted_refresh_token = encrypt_token(refreshed.refresh_token)
            connection.token_expires_at = refreshed.expires_at
            connection.scopes = refreshed.scopes
            await db.commit()
        except Exception:
            # Concurrent sync may have already rotated tokens; keep request resilient.
            logger.warning(
                "Token refresh failed for user_id=%s provider=%s (possible concurrent refresh)",
                user_id,
                provider,
                exc_info=True,
            )
            await db.rollback()

    return access_token


def _as_stream_payload(streams) -> dict:
    if isinstance(streams, dict):
        return streams
    if isinstance(streams, list):
        return {"data": streams}
    return {}


def _flatten_planned_time_steps(structure) -> list[dict]:
    steps = structure if isinstance(structure, list) else []
    out: list[dict] = []

    def walk(nodes, multiplier: int = 1):
        for node in nodes:
            if not isinstance(node, dict):
                continue

            node_type = str(node.get("type") or "")
            if node_type == "repeat":
                repeats = max(1, int(node.get("repeats") or 1))
                nested = node.get("steps") if isinstance(node.get("steps"), list) else []
                for _ in range(repeats):
                    walk(nested, multiplier)
                continue

            duration = node.get("duration") if isinstance(node.get("duration"), dict) else {}
            if str(duration.get("type") or "") != "time":
                continue

            duration_seconds = float(duration.get("value") or 0.0) * multiplier
            if duration_seconds <= 0:
                continue

            target = node.get("target") if isinstance(node.get("target"), dict) else {}
            out.append(
                {
                    "category": node.get("category"),
                    "planned_duration_s": duration_seconds,
                    "target": {
                        "type": target.get("type"),
                        "metric": target.get("metric"),
                        "zone": target.get("zone"),
                        "min": target.get("min"),
                        "max": target.get("max"),
                        "value": target.get("value"),
                        "unit": target.get("unit"),
                    },
                }
            )

    walk(steps)
    return out


def _extract_actual_split_rows(splits_metric, laps) -> list[dict]:
    # Prefer laps (device-recorded intervals) over splits_metric (auto per-km splits).
    # Laps reflect user-pressed interval markers, which align with structured workouts.
    source = laps if isinstance(laps, list) and laps else splits_metric if isinstance(splits_metric, list) and splits_metric else []
    out: list[dict] = []
    for idx, item in enumerate(source):
        if not isinstance(item, dict):
            continue
        duration_s = float(item.get("duration") or item.get("elapsed_time") or item.get("moving_time") or 0.0)
        out.append(
            {
                "split": idx + 1,
                "actual_duration_s": duration_s,
                "distance_m": float(item.get("distance") or 0.0),
                "avg_hr": item.get("avg_hr") or item.get("average_heartrate"),
                "avg_power": item.get("avg_power") or item.get("average_watts"),
                "avg_speed": item.get("avg_speed") or item.get("average_speed"),
            }
        )
    return out


def _parse_stream_timestamp(value) -> datetime | None:
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = f"{raw[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _extract_actual_split_rows_from_planned_template(activity: Activity, planned_steps: list[dict]) -> list[dict]:
    if not planned_steps:
        return []

    payload = _as_stream_payload(activity.streams)
    raw_points = payload.get("data") if isinstance(payload.get("data"), list) else []
    if not raw_points:
        return []

    normalized_points: list[dict[str, float | int | None]] = []
    stream_start: datetime | None = None
    fallback_total_s = _safe_number(getattr(activity, "duration", None), default=0.0)

    for index, point in enumerate(raw_points):
        if not isinstance(point, dict):
            continue

        elapsed_s: float | None = None
        for key in ("elapsed_s", "elapsed_time", "time"):
            candidate = point.get(key)
            if candidate is None:
                continue
            parsed = _safe_number(candidate, default=-1.0)
            if parsed >= 0:
                elapsed_s = parsed
                break

        if elapsed_s is None:
            point_ts = _parse_stream_timestamp(point.get("timestamp"))
            if point_ts is not None:
                if stream_start is None:
                    stream_start = point_ts
                elapsed_s = max(0.0, (point_ts - stream_start).total_seconds())

        if elapsed_s is None:
            elapsed_s = float(index)

        normalized_points.append(
            {
                "elapsed_s": float(elapsed_s),
                "distance_m": _safe_number(point.get("distance"), default=0.0),
                "heart_rate": _safe_number(point.get("heart_rate"), default=-1.0),
                "power": _safe_number(point.get("power"), default=-1.0),
                "speed": _safe_number(point.get("speed"), default=-1.0),
            }
        )

    if not normalized_points:
        return []

    normalized_points.sort(key=lambda item: float(item.get("elapsed_s") or 0.0))
    derived_total_s = float(normalized_points[-1].get("elapsed_s") or 0.0)
    total_actual_s = max(fallback_total_s, derived_total_s)
    if total_actual_s <= 0:
        return []

    planned_total_s = sum(float(step.get("planned_duration_s") or 0.0) for step in planned_steps)
    if planned_total_s <= 0:
        return []

    out: list[dict] = []
    segment_start_s = 0.0
    accumulated_ratio = 0.0

    for index, step in enumerate(planned_steps):
        planned_duration_s = float(step.get("planned_duration_s") or 0.0)
        accumulated_ratio += planned_duration_s / planned_total_s
        segment_end_s = total_actual_s if index == len(planned_steps) - 1 else total_actual_s * accumulated_ratio

        segment_points = [
            row
            for row in normalized_points
            if float(row.get("elapsed_s") or 0.0) >= segment_start_s
            and (
                float(row.get("elapsed_s") or 0.0) <= segment_end_s
                if index == len(planned_steps) - 1
                else float(row.get("elapsed_s") or 0.0) < segment_end_s
            )
        ]

        distance_values = [float(row.get("distance_m") or 0.0) for row in segment_points if float(row.get("distance_m") or 0.0) > 0]
        hr_values = [float(row.get("heart_rate") or 0.0) for row in segment_points if float(row.get("heart_rate") or -1.0) >= 0]
        power_values = [float(row.get("power") or 0.0) for row in segment_points if float(row.get("power") or -1.0) >= 0]
        speed_values = [float(row.get("speed") or 0.0) for row in segment_points if float(row.get("speed") or -1.0) >= 0]

        out.append(
            {
                "split": index + 1,
                "actual_duration_s": max(0.0, segment_end_s - segment_start_s),
                "distance_m": max(distance_values) - min(distance_values) if len(distance_values) >= 2 else 0.0,
                "avg_hr": (sum(hr_values) / len(hr_values)) if hr_values else None,
                "avg_power": (sum(power_values) / len(power_values)) if power_values else None,
                "avg_speed": (sum(speed_values) / len(speed_values)) if speed_values else None,
                "source": "planned_template",
            }
        )
        segment_start_s = segment_end_s

    return out


def _compute_normalized_power_watts_from_payload(payload: dict) -> float | None:
    stats = payload.get("stats") if isinstance(payload.get("stats"), dict) else {}
    direct = _safe_number(stats.get("normalized_power"), default=0.0)
    if direct > 0:
        return direct

    power_curve = payload.get("power_curve") if isinstance(payload.get("power_curve"), dict) else {}
    curve_np = _safe_number(power_curve.get("normalized_power"), default=0.0)
    if curve_np > 0:
        return curve_np

    data_points = payload.get("data") if isinstance(payload.get("data"), list) else []
    power_samples = [
        _safe_number(point.get("power"), default=-1.0)
        for point in data_points
        if isinstance(point, dict)
    ]
    power_samples = [sample for sample in power_samples if sample >= 0]
    if not power_samples:
        return None

    if len(power_samples) < 30:
        avg = sum(power_samples) / len(power_samples)
        return avg if avg > 0 else None

    rolling: list[float] = []
    for idx in range(0, len(power_samples) - 29):
        window = power_samples[idx: idx + 30]
        rolling.append(sum(window) / len(window))
    if not rolling:
        return None

    mean_fourth = sum(value ** 4 for value in rolling) / len(rolling)
    normalized_power = mean_fourth ** 0.25
    return normalized_power if normalized_power > 0 else None


def _workout_target_zone(workout: PlannedWorkout) -> int | None:
    token = str(workout.planned_intensity or "").lower()
    digits = "".join(ch for ch in token if ch.isdigit())
    if digits:
        zone = int(digits)
        if zone > 0:
            return zone

    structure = workout.structure if isinstance(workout.structure, list) else []
    zones: list[int] = []

    def walk(nodes: list[dict[str, Any]]) -> None:
        for node in nodes:
            if not isinstance(node, dict):
                continue
            if str(node.get("type") or "") == "repeat":
                nested = node.get("steps") if isinstance(node.get("steps"), list) else []
                repeats = max(1, int(node.get("repeats") or 1))
                for _ in range(repeats):
                    walk(nested)
                continue
            # Skip recovery/warmup/cooldown — their default zone:1 is not meaningful
            category = str(node.get("category") or "work")
            if category in ("recovery", "warmup", "cooldown"):
                continue
            target = node.get("target") if isinstance(node.get("target"), dict) else {}
            value = int(_safe_number(target.get("zone"), default=0.0))
            if value > 0:
                zones.append(value)

    walk(structure)
    if not zones:
        return None

    counts: dict[int, int] = {}
    for zone in zones:
        counts[zone] = counts.get(zone, 0) + 1
    return sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))[0][0]


def _is_steady_zone_workout(workout: PlannedWorkout) -> bool:
    structure = workout.structure if isinstance(workout.structure, list) else []
    if not structure:
        return False

    zones: list[int] = []

    def walk(nodes: list[dict[str, Any]]) -> None:
        for node in nodes:
            if not isinstance(node, dict):
                continue
            if str(node.get("type") or "") == "repeat":
                nested = node.get("steps") if isinstance(node.get("steps"), list) else []
                repeats = max(1, int(node.get("repeats") or 1))
                for _ in range(repeats):
                    walk(nested)
                continue
            category = str(node.get("category") or "work")
            if category in ("recovery", "warmup", "cooldown"):
                continue
            target = node.get("target") if isinstance(node.get("target"), dict) else {}
            value = int(_safe_number(target.get("zone"), default=0.0))
            if value > 0:
                zones.append(value)

    walk(structure)
    if not zones:
        return False
    return len(set(zones)) == 1


def _range_match_pct(value: float | None, low: float, high: float, tolerance: float) -> float | None:
    if value is None:
        return None
    if low <= value <= high:
        return 100.0
    distance = min(abs(value - low), abs(value - high))
    return max(0.0, 100.0 - (distance / max(1.0, tolerance)) * 100.0)


def _intensity_assessment(workout: PlannedWorkout, activity: Activity, profile: Profile | None, stats: dict) -> dict | None:
    zone = _workout_target_zone(workout)
    if zone is None:
        return None

    sport = _normalize_sport_name(workout.sport_type)
    if sport == "cycling":
        ftp = _safe_number(getattr(profile, "ftp", None), default=0.0)
        if ftp <= 0:
            return None

        zone_bounds: list[tuple[float, float]] = [
            (50.0, 55.0),
            (56.0, 75.0),
            (76.0, 90.0),
            (91.0, 105.0),
            (106.0, 120.0),
            (121.0, 150.0),
            (151.0, 200.0),
        ]
        idx = max(1, min(len(zone_bounds), zone)) - 1
        low_pct, high_pct = zone_bounds[idx]

        avg_watts = _safe_number(activity.average_watts, default=0.0)
        avg_pct = (avg_watts / ftp) * 100.0 if avg_watts > 0 else None

        payload = _as_stream_payload(activity.streams)
        np_watts = _compute_normalized_power_watts_from_payload(payload)
        np_pct = (np_watts / ftp) * 100.0 if np_watts and np_watts > 0 else None

        max_watts = _safe_number(stats.get("max_watts"), default=0.0)
        max_pct = (max_watts / ftp) * 100.0 if max_watts > 0 else None

        avg_match = _range_match_pct(avg_pct, low_pct, high_pct, tolerance=15.0)
        np_match = _range_match_pct(np_pct, low_pct, high_pct, tolerance=16.0)

        max_cap = high_pct + 20.0
        max_warn = high_pct + 40.0
        if max_pct is None:
            max_match = None
        elif max_pct <= max_cap:
            max_match = 100.0
        elif max_pct <= max_warn:
            max_match = 65.0
        else:
            max_match = 20.0

        components: list[tuple[float, float | None]] = [
            (0.35, avg_match),
            (0.45, np_match),
            (0.20, max_match),
        ]
        weighted = 0.0
        total_weight = 0.0
        for weight, score in components:
            if score is None:
                continue
            weighted += weight * score
            total_weight += weight
        if total_weight <= 0:
            return None

        match_pct = weighted / total_weight
        status = "green" if match_pct >= 78 else "yellow" if match_pct >= 58 else "red"
        return {
            "sport": "cycling",
            "zone": zone,
            "match_pct": round(match_pct, 1),
            "status": status,
            "metrics": {
                "avg_power_w": round(avg_watts, 1) if avg_watts > 0 else None,
                "np_power_w": round(np_watts, 1) if np_watts else None,
                "max_power_w": round(max_watts, 1) if max_watts > 0 else None,
                "target_power_pct": {"min": low_pct, "max": high_pct},
                "actual_power_pct": {
                    "avg": round(avg_pct, 1) if avg_pct is not None else None,
                    "np": round(np_pct, 1) if np_pct is not None else None,
                    "max": round(max_pct, 1) if max_pct is not None else None,
                },
            },
            "note": "For steady rides, intensity quality (NP/avg/max) is prioritized over split count.",
        }

    if sport == "running":
        lt2 = _safe_number(getattr(profile, "lt2", None), default=0.0)
        max_hr = _safe_number(getattr(profile, "max_hr", None), default=0.0)

        avg_speed = _safe_number(activity.avg_speed, default=0.0)
        avg_pace = (1000.0 / (avg_speed * 60.0)) if avg_speed > 0 else None
        avg_hr = _safe_number(activity.average_hr, default=0.0)
        max_hr_actual = _safe_number(stats.get("max_hr"), default=0.0)

        match_scores: list[float] = []
        metrics: dict[str, Any] = {}

        if lt2 > 0 and avg_pace is not None:
            pace_ranges: list[tuple[float, float]] = [
                (135.0, 120.0),
                (120.0, 110.0),
                (110.0, 103.0),
                (103.0, 97.0),
                (97.0, 90.0),
                (90.0, 84.0),
                (84.0, 75.0),
            ]
            idx = max(1, min(len(pace_ranges), zone)) - 1
            slow_pct, fast_pct = pace_ranges[idx]
            low = lt2 * (fast_pct / 100.0)
            high = lt2 * (slow_pct / 100.0)
            pace_match = _range_match_pct(avg_pace, low, high, tolerance=0.45)
            if pace_match is not None:
                match_scores.append(pace_match)
            metrics["target_pace_min_per_km"] = {"min": round(low, 2), "max": round(high, 2)}
            metrics["actual_pace_min_per_km"] = round(avg_pace, 2)

        if max_hr > 0 and avg_hr > 0:
            low = max_hr * 0.60
            high = max_hr * 0.70 if zone <= 2 else max_hr * 0.80 if zone == 3 else max_hr * 0.90
            hr_match = _range_match_pct(avg_hr, low, high, tolerance=10.0)
            if hr_match is not None:
                match_scores.append(hr_match)
            metrics["target_hr_bpm"] = {"min": round(low), "max": round(high)}
            metrics["actual_avg_hr_bpm"] = round(avg_hr)
            if max_hr_actual > 0:
                metrics["actual_max_hr_bpm"] = round(max_hr_actual)

        if not match_scores:
            return None

        match_pct = sum(match_scores) / len(match_scores)
        status = "green" if match_pct >= 78 else "yellow" if match_pct >= 58 else "red"
        return {
            "sport": "running",
            "zone": zone,
            "match_pct": round(match_pct, 1),
            "status": status,
            "metrics": metrics,
            "note": "Running intensity uses pace and heart-rate adherence to target zone.",
        }

    return None


def _structured_intensity_assessment(planned_steps: list[dict], actual_splits: list[dict]) -> dict | None:
    """Per-split intensity scoring for structured workouts with specific watt targets."""
    split_scores: list[dict] = []
    compare_len = min(len(planned_steps), len(actual_splits))
    if compare_len == 0:
        return None

    scored_count = 0
    total_match = 0.0

    for idx in range(compare_len):
        planned = planned_steps[idx]
        actual = actual_splits[idx]
        target = planned.get("target") if isinstance(planned.get("target"), dict) else {}
        metric = target.get("metric") or ""
        planned_value = _safe_number(target.get("value"), default=0.0)
        unit = target.get("unit") or ""

        actual_power = _safe_number(actual.get("avg_power"), default=0.0)

        # Score watts-based targets
        if (metric == "watts" or unit == "W") and planned_value > 0 and actual_power > 0:
            error_pct = abs(actual_power - planned_value) / planned_value * 100.0
            match_pct = max(0.0, 100.0 - error_pct)
            total_match += match_pct
            scored_count += 1
            split_scores.append({"split": idx + 1, "match_pct": round(match_pct, 1)})

    if scored_count == 0:
        return None

    overall_match = total_match / scored_count
    status = "green" if overall_match >= 78 else "yellow" if overall_match >= 58 else "red"
    return {
        "sport": "structured",
        "zone": None,
        "match_pct": round(overall_match, 1),
        "status": status,
        "metrics": {
            "scored_splits": scored_count,
            "total_splits": compare_len,
        },
        "note": "Structured intensity compares planned vs actual power per interval split.",
    }


def _build_planned_comparison_payload(
    workout: PlannedWorkout,
    activity: Activity,
    splits_metric,
    laps,
    profile: Profile | None,
    stats: dict,
) -> dict:
    planned_duration_min = float(workout.planned_duration or 0.0)
    actual_duration_min = float((activity.duration or 0.0) / 60.0)
    planned_distance_km = float(workout.planned_distance or 0.0)
    actual_distance_km = float((activity.distance or 0.0) / 1000.0)
    has_planned_distance = planned_distance_km > 0

    planned_steps = _flatten_planned_time_steps(workout.structure)
    actual_splits = _extract_actual_split_rows(splits_metric, laps)
    used_planned_template_splits = False
    # When actual split count is close to planned (within ±5), trim/use as-is.
    # Only fall to proportional derivation when splits are far off or unavailable.
    if planned_steps and actual_splits:
        count_delta = abs(len(actual_splits) - len(planned_steps))
        if count_delta > 5:
            derived_splits = _extract_actual_split_rows_from_planned_template(activity, planned_steps)
            if len(derived_splits) == len(planned_steps):
                actual_splits = derived_splits
                used_planned_template_splits = True
    elif planned_steps and not actual_splits:
        derived_splits = _extract_actual_split_rows_from_planned_template(activity, planned_steps)
        if len(derived_splits) == len(planned_steps):
            actual_splits = derived_splits
            used_planned_template_splits = True
    intensity = _intensity_assessment(workout, activity, profile, stats)
    # For structured workouts with per-step targets, compute per-split intensity
    if intensity is None and planned_steps and actual_splits:
        intensity = _structured_intensity_assessment(planned_steps, actual_splits)

    steady_zone_workout = _is_steady_zone_workout(workout)
    split_importance = "high"
    if steady_zone_workout and len(actual_splits) > (len(planned_steps) + 2):
        split_importance = "low"

    split_comparison: list[dict] = []
    if split_importance != "low":
        max_len = max(len(planned_steps), len(actual_splits))
        for idx in range(max_len):
            planned = planned_steps[idx] if idx < len(planned_steps) else None
            actual = actual_splits[idx] if idx < len(actual_splits) else None
            planned_s = float((planned or {}).get("planned_duration_s") or 0.0)
            actual_s = float((actual or {}).get("actual_duration_s") or 0.0)
            delta_s = actual_s - planned_s
            delta_pct = (delta_s / planned_s * 100.0) if planned_s > 0 else None
            split_comparison.append(
                {
                    "split": idx + 1,
                    "planned": planned,
                    "actual": actual,
                    "delta_duration_s": delta_s,
                    "delta_duration_pct": delta_pct,
                }
            )

    planned_steps_duration_min = sum(float(step.get("planned_duration_s") or 0.0) for step in planned_steps) / 60.0
    if planned_steps_duration_min > 0:
        planned_duration_min = planned_steps_duration_min

    duration_match_pct = (
        max(0.0, 100.0 - abs(actual_duration_min - planned_duration_min) / planned_duration_min * 100.0)
        if planned_duration_min > 0
        else None
    )
    distance_match_pct = (
        max(0.0, 100.0 - abs(actual_distance_km - planned_distance_km) / planned_distance_km * 100.0)
        if has_planned_distance
        else None
    )
    intensity_match_pct = intensity.get("match_pct") if isinstance(intensity, dict) else None

    split_match_pct: float | None = None
    if split_importance == "high" and split_comparison:
        split_scores: list[float] = []
        for row in split_comparison:
            planned = row.get("planned") if isinstance(row, dict) else None
            if not isinstance(planned, dict):
                continue
            delta_pct = row.get("delta_duration_pct") if isinstance(row, dict) else None
            if delta_pct is None:
                continue
            split_scores.append(max(0.0, 100.0 - abs(float(delta_pct))))
        if split_scores:
            split_match_pct = sum(split_scores) / len(split_scores)

    execution_components: dict[str, float] = {}
    if duration_match_pct is not None:
        execution_components["duration"] = float(duration_match_pct)
    if distance_match_pct is not None:
        execution_components["distance"] = float(distance_match_pct)
    if intensity_match_pct is not None:
        execution_components["intensity"] = float(intensity_match_pct)
    if split_match_pct is not None:
        execution_components["splits"] = float(split_match_pct)

    execution_weights = {
        "duration": 0.35,
        "distance": 0.20,
        "intensity": 0.35,
        "splits": 0.10,
    }
    execution_component_labels = {
        "duration": "Duration Match",
        "distance": "Distance Match",
        "intensity": "Intensity Match",
        "splits": "Split Adherence",
    }

    weighted_total = 0.0
    used_weight = 0.0
    for key, value in execution_components.items():
        weight = execution_weights.get(key, 0.0)
        if weight <= 0:
            continue
        weighted_total += value * weight
        used_weight += weight

    execution_score_pct: float | None = None
    execution_status = "incomplete"
    if used_weight > 0:
        execution_score_pct = weighted_total / used_weight
        if execution_score_pct >= 92:
            execution_status = "great"
        elif execution_score_pct >= 82:
            execution_status = "good"
        elif execution_score_pct >= 72:
            execution_status = "ok"
        elif execution_score_pct >= 62:
            execution_status = "fair"
        elif execution_score_pct >= 50:
            execution_status = "subpar"
        elif execution_score_pct >= 35:
            execution_status = "poor"
        else:
            execution_status = "incomplete"

    if actual_duration_min <= 0:
        execution_status = "incomplete"
        execution_score_pct = None

    trace_components: list[dict] = []
    for key, weight in execution_weights.items():
        component_score = execution_components.get(key)
        available = component_score is not None
        weighted_points = (float(component_score) * weight) if available else None
        normalized_contribution = (
            (weighted_points / used_weight) if (weighted_points is not None and used_weight > 0)
            else None
        )
        trace_components.append(
            {
                "key": key,
                "label": execution_component_labels.get(key, key.replace("_", " ").title()),
                "available": available,
                "weight_fraction": weight,
                "weight_pct": round(weight * 100.0, 1),
                "component_score_pct": round(float(component_score), 1) if available else None,
                "weighted_points": round(weighted_points, 2) if weighted_points is not None else None,
                "normalized_contribution_pct": (
                    round(normalized_contribution * 100.0, 1)
                    if normalized_contribution is not None
                    else None
                ),
                "note": (
                    None
                    if available
                    else "Excluded from this session score because required data was unavailable or not applicable."
                ),
            }
        )

    status_thresholds = [
        {"status": "great", "min_score_pct": 92.0},
        {"status": "good", "min_score_pct": 82.0},
        {"status": "ok", "min_score_pct": 72.0},
        {"status": "fair", "min_score_pct": 62.0},
        {"status": "subpar", "min_score_pct": 50.0},
        {"status": "poor", "min_score_pct": 35.0},
        {"status": "incomplete", "min_score_pct": 0.0},
    ]

    return {
        "workout_id": workout.id,
        "workout_title": workout.title,
        "sport_type": workout.sport_type,
        "planned": {
            "duration_min": planned_duration_min,
            "distance_km": planned_distance_km,
            "intensity": workout.planned_intensity,
            "description": workout.description,
            "structure": workout.structure,
        },
        "actual": {
            "activity_id": activity.id,
            "duration_min": actual_duration_min,
            "distance_km": actual_distance_km,
        },
        "summary": {
            "has_planned_distance": has_planned_distance,
            "duration_delta_min": (actual_duration_min - planned_duration_min) if has_planned_distance else None,
            "distance_delta_km": (actual_distance_km - planned_distance_km) if has_planned_distance else None,
            "duration_match_pct": duration_match_pct,
            "distance_match_pct": distance_match_pct,
            "intensity_match_pct": intensity_match_pct,
            "intensity_status": intensity.get("status") if isinstance(intensity, dict) else None,
            "execution_score_pct": round(execution_score_pct, 1) if execution_score_pct is not None else None,
            "execution_status": execution_status,
            "execution_components": execution_components,
            "execution_trace": {
                "model_version": "v1",
                "scoring_basis": "weighted_normalized_average",
                "used_weight_pct": round(used_weight * 100.0, 1),
                "weighted_total_points": round(weighted_total, 2) if used_weight > 0 else None,
                "normalization_divisor": round(used_weight, 3) if used_weight > 0 else None,
                "components": trace_components,
                "status_thresholds": status_thresholds,
            },
            "split_importance": split_importance,
            "split_source": "planned_template" if used_planned_template_splits else ("provider" if actual_splits else "unavailable"),
            "split_note": (
                " ".join(
                    note
                    for note in [
                        "This is a steady zone workout; intensity adherence matters more than matching every auto-split."
                        if split_importance == "low"
                        else None,
                        "Actual splits were auto-derived from the planned workout because provider splits were unavailable or did not match the planned structure."
                        if used_planned_template_splits
                        else None,
                    ]
                    if note
                )
                or None
            ),
        },
        "intensity": intensity,
        "splits": split_comparison,
    }


def _activity_feedback_from_payload(payload: dict) -> tuple[int | None, str | None, float | None]:
    if not isinstance(payload, dict):
        return None, None, None
    meta = payload.get("_meta") if isinstance(payload.get("_meta"), dict) else {}
    rpe_raw = meta.get("rpe")
    notes_raw = meta.get("notes")
    lactate_raw = meta.get("lactate_mmol_l")

    rpe_value = None
    if rpe_raw is not None:
        try:
            parsed = int(rpe_raw)
            if 1 <= parsed <= 10:
                rpe_value = parsed
        except (TypeError, ValueError):
            pass

    notes_value = str(notes_raw).strip() if isinstance(notes_raw, str) else None
    if notes_value == "":
        notes_value = None

    lactate_value = None
    if lactate_raw is not None:
        try:
            parsed = float(lactate_raw)
            if 0.0 <= parsed <= 40.0:
                lactate_value = parsed
        except (TypeError, ValueError):
            pass

    return rpe_value, notes_value, lactate_value


def _is_activity_deleted(activity: Activity) -> bool:
    payload = _as_stream_payload(activity.streams)
    meta = payload.get("_meta") if isinstance(payload, dict) else None
    return bool(meta.get("deleted")) if isinstance(meta, dict) else False


def _apply_activity_to_bucket(
    bucket: dict,
    activity: Activity,
    ftp: float,
    max_hr: float,
    profile: Profile | None = None,
    resting_hr: float | None = None,
) -> None:
    duration_seconds = _safe_number(activity.duration)
    distance_km = _safe_number(activity.distance) / 1000.0 if activity.distance else 0.0
    duration_minutes = duration_seconds / 60.0 if duration_seconds else 0.0

    bucket["activities_count"] += 1
    bucket["total_duration_minutes"] += duration_minutes
    bucket["total_distance_km"] += distance_km

    sport = _normalize_sport_name(activity.sport)
    if sport not in ("running", "cycling"):
        return

    sport_bucket = bucket["sports"][sport]
    sport_bucket["activities_count"] += 1
    sport_bucket["total_duration_minutes"] += duration_minutes
    sport_bucket["total_distance_km"] += distance_km

    stored_streams = _as_stream_payload(activity.streams)
    data_points = stored_streams.get("data", []) if isinstance(stored_streams, dict) else []
    laps = stored_streams.get("laps") if isinstance(stored_streams.get("laps"), list) else []

    if sport == "running":
        hr_samples = []
        speed_samples = []
        if isinstance(data_points, list):
            for point in data_points:
                if isinstance(point, dict):
                    hr = _safe_number(point.get("heart_rate"), default=-1)
                    speed = _safe_number(point.get("speed"), default=-1)
                    if hr > 0:
                        hr_samples.append(hr)
                    if speed > 0.1:
                        speed_samples.append(speed)

        effective_resting_hr = _resolve_effective_resting_hr(profile, resting_hr)
        lt2_pace = _safe_number(getattr(profile, "lt2", None), default=0.0)
        running_hr_bounds = _metric_upper_bounds(
            profile,
            sport="running",
            metric="hr",
            fallback_bounds=_hr_zone_bounds_from_reserve(max_hr, effective_resting_hr),
        )
        running_pace_bounds = _metric_upper_bounds(
            profile,
            sport="running",
            metric="pace",
            fallback_bounds=[lt2_pace * 1.80, lt2_pace * 1.50, lt2_pace * 1.20, lt2_pace * 1.05, lt2_pace * 0.95] if lt2_pace > 0 else [],
        )

        if hr_samples and max_hr > 0 and duration_seconds > 0:
            seconds_per_sample = duration_seconds / len(hr_samples)
            for hr in hr_samples:
                zone = _zone_index_from_upper_bounds(hr, running_hr_bounds)
                _add_zone_seconds(sport_bucket["zone_seconds_by_metric"]["hr"], zone, seconds_per_sample)
        else:
            hr_zones = stored_streams.get("hr_zones") if isinstance(stored_streams, dict) else None
            if isinstance(hr_zones, dict):
                for zone in range(1, 6):
                    sport_bucket["zone_seconds_by_metric"]["hr"][f"Z{zone}"] += _safe_number(hr_zones.get(f"Z{zone}"))
            elif isinstance(laps, list) and max_hr > 0:
                for lap in laps:
                    if not isinstance(lap, dict):
                        continue
                    lap_avg_hr = _safe_number(
                        lap.get("avg_hr") if lap.get("avg_hr") is not None else lap.get("average_heartrate"),
                        default=0.0,
                    )
                    lap_duration = _safe_number(
                        lap.get("duration") if lap.get("duration") is not None else lap.get("elapsed_time"),
                        default=0.0,
                    )
                    if lap_avg_hr <= 0 or lap_duration <= 0:
                        continue
                    zone = _zone_index_from_upper_bounds(lap_avg_hr, running_hr_bounds)
                    _add_zone_seconds(sport_bucket["zone_seconds_by_metric"]["hr"], zone, lap_duration)
            elif max_hr > 0 and duration_seconds > 0:
                avg_hr_val = _safe_number(getattr(activity, "average_hr", None), default=0.0)
                if avg_hr_val > 0:
                    zone = _zone_index_from_upper_bounds(avg_hr_val, running_hr_bounds)
                    _add_zone_seconds(sport_bucket["zone_seconds_by_metric"]["hr"], zone, duration_seconds)

        if running_pace_bounds and speed_samples and duration_seconds > 0:
            seconds_per_sample = duration_seconds / len(speed_samples)
            for speed in speed_samples:
                pace_min_per_km = 1000.0 / (speed * 60.0)
                zone = _zone_index_from_upper_bounds(pace_min_per_km, running_pace_bounds, reverse=True)
                _add_zone_seconds(sport_bucket["zone_seconds_by_metric"]["pace"], zone, seconds_per_sample)

        sport_bucket["zone_seconds"] = dict(sport_bucket["zone_seconds_by_metric"]["hr"])
        return

    # Cycling (7 zones)
    power_curve = stored_streams.get("power_curve") if isinstance(stored_streams, dict) else None

    # If athlete profile FTP is missing, estimate from power curve only.
    effective_ftp = ftp
    if effective_ftp <= 0:
        if isinstance(power_curve, dict):
            p20 = _safe_number(power_curve.get("20min"), default=0.0)
            if p20 > 0:
                effective_ftp = p20 * 0.95

    power_samples = []
    hr_samples = []
    if isinstance(data_points, list):
        for point in data_points:
            if isinstance(point, dict):
                watts = _safe_number(point.get("power"), default=-1)
                hr = _safe_number(point.get("heart_rate"), default=-1)
                if watts >= 0:
                    power_samples.append(watts)
                if hr > 0:
                    hr_samples.append(hr)

    effective_resting_hr = _resolve_effective_resting_hr(profile, resting_hr)
    cycling_power_bounds = _metric_upper_bounds(
        profile,
        sport="cycling",
        metric="power",
        fallback_bounds=[effective_ftp * 0.55, effective_ftp * 0.75, effective_ftp * 0.90, effective_ftp * 1.05, effective_ftp * 1.20, effective_ftp * 1.50] if effective_ftp > 0 else [],
    )
    cycling_hr_bounds = _metric_upper_bounds(
        profile,
        sport="cycling",
        metric="hr",
        fallback_bounds=_hr_zone_bounds_from_reserve(max_hr, effective_resting_hr),
    )

    if cycling_power_bounds and power_samples and duration_seconds > 0:
        seconds_per_sample = duration_seconds / len(power_samples)
        for watts in power_samples:
            zone = _zone_index_from_upper_bounds(watts, cycling_power_bounds)
            _add_zone_seconds(sport_bucket["zone_seconds_by_metric"]["power"], zone, seconds_per_sample)
    elif cycling_power_bounds and isinstance(laps, list):
        for lap in laps:
            if not isinstance(lap, dict):
                continue
            lap_avg_power = _safe_number(
                lap.get("avg_power") if lap.get("avg_power") is not None else lap.get("average_watts"),
                default=0.0,
            )
            lap_duration = _safe_number(
                lap.get("duration") if lap.get("duration") is not None else lap.get("elapsed_time"),
                default=0.0,
            )
            if lap_avg_power < 0 or lap_duration <= 0:
                continue
            zone = _zone_index_from_upper_bounds(lap_avg_power, cycling_power_bounds)
            _add_zone_seconds(sport_bucket["zone_seconds_by_metric"]["power"], zone, lap_duration)
    elif cycling_power_bounds and duration_seconds > 0:
        avg_watts_val = _safe_number(getattr(activity, "average_watts", None), default=0.0)
        if avg_watts_val > 0:
            zone = _zone_index_from_upper_bounds(avg_watts_val, cycling_power_bounds)
            _add_zone_seconds(sport_bucket["zone_seconds_by_metric"]["power"], zone, duration_seconds)

    if hr_samples and max_hr > 0 and duration_seconds > 0:
        seconds_per_sample = duration_seconds / len(hr_samples)
        for hr in hr_samples:
            zone = _zone_index_from_upper_bounds(hr, cycling_hr_bounds)
            _add_zone_seconds(sport_bucket["zone_seconds_by_metric"]["hr"], zone, seconds_per_sample)
    else:
        hr_zones = stored_streams.get("hr_zones") if isinstance(stored_streams, dict) else None
        if isinstance(hr_zones, dict):
            for zone in range(1, 6):
                sport_bucket["zone_seconds_by_metric"]["hr"][f"Z{zone}"] += _safe_number(hr_zones.get(f"Z{zone}"))
        elif isinstance(laps, list) and max_hr > 0:
            for lap in laps:
                if not isinstance(lap, dict):
                    continue
                lap_avg_hr = _safe_number(
                    lap.get("avg_hr") if lap.get("avg_hr") is not None else lap.get("average_heartrate"),
                    default=0.0,
                )
                lap_duration = _safe_number(
                    lap.get("duration") if lap.get("duration") is not None else lap.get("elapsed_time"),
                    default=0.0,
                )
                if lap_avg_hr <= 0 or lap_duration <= 0:
                    continue
                zone = _zone_index_from_upper_bounds(lap_avg_hr, cycling_hr_bounds)
                _add_zone_seconds(sport_bucket["zone_seconds_by_metric"]["hr"], zone, lap_duration)
        elif max_hr > 0 and duration_seconds > 0:
            avg_hr_val = _safe_number(getattr(activity, "average_hr", None), default=0.0)
            if avg_hr_val > 0:
                zone = _zone_index_from_upper_bounds(avg_hr_val, cycling_hr_bounds)
                _add_zone_seconds(sport_bucket["zone_seconds_by_metric"]["hr"], zone, duration_seconds)

    sport_bucket["zone_seconds"] = dict(sport_bucket["zone_seconds_by_metric"]["power"])


def _round_bucket(bucket: dict) -> dict:
    bucket["total_duration_minutes"] = round(bucket["total_duration_minutes"], 1)
    bucket["total_distance_km"] = round(bucket["total_distance_km"], 1)
    for sport in ("running", "cycling"):
        bucket["sports"][sport]["total_duration_minutes"] = round(bucket["sports"][sport]["total_duration_minutes"], 1)
        bucket["sports"][sport]["total_distance_km"] = round(bucket["sports"][sport]["total_distance_km"], 1)
    return bucket


def _build_activity_zone_summary(
    activity: Activity,
    ftp: float,
    max_hr: float,
    profile: Profile | None = None,
    resting_hr: float | None = None,
) -> dict | None:
    sport = _normalize_sport_name(activity.sport)
    if sport not in ("running", "cycling"):
        return None

    temp_bucket = _empty_bucket()
    _apply_activity_to_bucket(temp_bucket, activity, ftp, max_hr, profile, resting_hr)
    sport_bucket = temp_bucket["sports"][sport]

    duration_minutes = (_safe_number(activity.duration) / 60.0) if activity.duration else 0.0
    distance_km = (_safe_number(activity.distance) / 1000.0) if activity.distance else 0.0

    return {
        "activity_id": activity.id,
        "date": activity.created_at.date(),
        "sport": sport,
        "title": activity.filename or "Activity",
        "duration_minutes": round(duration_minutes, 1),
        "distance_km": round(distance_km, 1),
        "zone_seconds": sport_bucket["zone_seconds"],
        "zone_seconds_by_metric": sport_bucket.get("zone_seconds_by_metric", {})
    }


def _compute_load_from_zone_minutes(
    zone_minutes: dict[str, float],
    *,
    zone_weights: dict[str, float],
    aerobic_fraction: dict[str, float],
) -> tuple[float, float]:
    aerobic = 0.0
    anaerobic = 0.0
    total_minutes = 0.0

    for zone_key, weight in zone_weights.items():
        minutes = max(0.0, _safe_number(zone_minutes.get(zone_key), default=0.0))
        total_minutes += minutes
        weighted_minutes = minutes * weight
        aerobic_share = min(1.0, max(0.0, _safe_number(aerobic_fraction.get(zone_key), default=0.5)))
        aerobic += weighted_minutes * aerobic_share
        anaerobic += weighted_minutes * (1.0 - aerobic_share)

    if total_minutes > 0:
        if aerobic <= 0:
            aerobic = 0.1
        if anaerobic <= 0:
            anaerobic = 0.1

    return aerobic, anaerobic


def _estimate_load_from_activity_summary(
    activity: Activity,
    *,
    sport: str,
    ftp: float,
    max_hr: float,
    profile: Profile | None = None,
) -> tuple[float, float] | None:
    duration_minutes = max(0.0, _safe_number(getattr(activity, "duration", None), default=0.0) / 60.0)
    if duration_minutes <= 0:
        return None

    resting_hr = _safe_number(getattr(profile, "resting_hr", None), default=60.0)
    avg_hr = _safe_number(getattr(activity, "average_hr", None), default=0.0)
    avg_watts = _safe_number(getattr(activity, "average_watts", None), default=0.0)

    if avg_watts > 0 and ftp > 0:
        intensity_factor = max(0.3, min(2.0, avg_watts / ftp))
        total_load = (duration_minutes / 60.0) * 100.0 * (intensity_factor ** 2)
        anaerobic_share = min(0.80, max(0.08, (intensity_factor - 0.75) / 0.65))
        aerobic = total_load * (1.0 - anaerobic_share)
        anaerobic = total_load * anaerobic_share
        return round(aerobic, 1), round(anaerobic, 1)

    if avg_hr > 0 and max_hr > 0 and max_hr > resting_hr:
        heart_rate_reserve = (avg_hr - resting_hr) / (max_hr - resting_hr)
        heart_rate_reserve = min(1.0, max(0.0, heart_rate_reserve))
        trimp = duration_minutes * heart_rate_reserve * 0.64 * math.exp(1.92 * heart_rate_reserve)
        anaerobic_share = min(0.70, max(0.05, (heart_rate_reserve - 0.70) / 0.30))
        aerobic = trimp * (1.0 - anaerobic_share)
        anaerobic = trimp * anaerobic_share
        return round(aerobic, 1), round(anaerobic, 1)

    base_rate_per_minute = 0.8 if sport == "running" else 0.9 if sport == "cycling" else 0.7
    total_load = duration_minutes * base_rate_per_minute
    aerobic = total_load * 0.92
    anaerobic = total_load * 0.08
    return round(aerobic, 1), round(anaerobic, 1)


def _cached_activity_load_from_meta(activity: Activity) -> tuple[float, float] | None:
    payload = _as_stream_payload(activity.streams)
    meta = payload.get("_meta") if isinstance(payload.get("_meta"), dict) else {}
    return _load_from_meta_dict(meta)


def _load_from_meta_dict(meta: dict) -> tuple[float, float] | None:
    """Extract cached aerobic/anaerobic load from a _meta dict (no full streams needed)."""
    if not isinstance(meta, dict):
        return None

    aerobic_raw = meta.get("aerobic_load")
    anaerobic_raw = meta.get("anaerobic_load")
    try:
        aerobic = float(aerobic_raw)
        anaerobic = float(anaerobic_raw)
    except (TypeError, ValueError):
        return None

    if aerobic < 0 or anaerobic < 0:
        return None

    return round(aerobic, 1), round(anaerobic, 1)


def _activity_list_load(
    activity: Activity,
    ftp: float,
    max_hr: float,
    profile: Profile | None = None,
) -> tuple[float, float]:
    cached = _cached_activity_load_from_meta(activity)
    if cached is not None:
        return cached

    sport = _normalize_sport_name(activity.sport)
    estimated = _estimate_load_from_activity_summary(
        activity,
        sport=sport,
        ftp=ftp,
        max_hr=max_hr,
        profile=profile,
    )
    if estimated is not None:
        return estimated

    return _activity_training_load(activity, ftp, max_hr, profile)


def _activity_training_load(
    activity: Activity,
    ftp: float,
    max_hr: float,
    profile: Profile | None = None,
) -> tuple[float, float]:
    sport = _normalize_sport_name(activity.sport)

    # Zone-minute models grounded in commonly-used endurance physiology heuristics:
    # - Running/HR: Edwards-style 5-zone weighting.
    # - Cycling/Power: Coggan 7-zone weighting for intensity distribution.
    # Each zone then contributes to aerobic/anaerobic pathways using intensity-based fractions.
    running_hr_weights = {"Z1": 1.0, "Z2": 2.0, "Z3": 3.0, "Z4": 4.0, "Z5": 5.0}
    running_hr_aerobic_fraction = {"Z1": 0.98, "Z2": 0.93, "Z3": 0.80, "Z4": 0.52, "Z5": 0.25}
    running_pace_weights = {"Z1": 1.0, "Z2": 2.0, "Z3": 3.0, "Z4": 4.0, "Z5": 5.0, "Z6": 6.0, "Z7": 8.0}
    running_pace_aerobic_fraction = {"Z1": 0.99, "Z2": 0.95, "Z3": 0.88, "Z4": 0.72, "Z5": 0.55, "Z6": 0.34, "Z7": 0.20}
    cycling_weights = {"Z1": 1.0, "Z2": 2.0, "Z3": 3.0, "Z4": 4.0, "Z5": 6.0, "Z6": 8.0, "Z7": 10.0}
    cycling_aerobic_fraction = {"Z1": 0.99, "Z2": 0.94, "Z3": 0.84, "Z4": 0.66, "Z5": 0.44, "Z6": 0.28, "Z7": 0.16}
    cycling_hr_weights = {"Z1": 1.0, "Z2": 2.0, "Z3": 3.0, "Z4": 4.0, "Z5": 5.0}
    cycling_hr_aerobic_fraction = {"Z1": 0.98, "Z2": 0.93, "Z3": 0.80, "Z4": 0.52, "Z5": 0.25}

    temp_bucket = _empty_bucket()
    _apply_activity_to_bucket(temp_bucket, activity, ftp, max_hr, profile)

    if sport in ("running", "cycling"):
        by_metric = temp_bucket["sports"][sport].get("zone_seconds_by_metric", {})

        def _to_minutes(raw: dict | None) -> dict[str, float]:
            if not isinstance(raw, dict):
                return {}
            return {key: (value or 0.0) / 60.0 for key, value in raw.items()}

        def _total_seconds(raw: dict | None) -> float:
            if not isinstance(raw, dict):
                return 0.0
            return sum(_safe_number(v, default=0.0) for v in raw.values())

        if sport == "running":
            hr_seconds = _total_seconds(by_metric.get("hr"))
            pace_seconds = _total_seconds(by_metric.get("pace"))
            # Prefer the richer signal when available (HR or pace), without falling back to activity averages.
            if hr_seconds >= pace_seconds and hr_seconds > 0:
                zone_minutes = _to_minutes(by_metric.get("hr"))
                aerobic, anaerobic = _compute_load_from_zone_minutes(
                    zone_minutes,
                    zone_weights=running_hr_weights,
                    aerobic_fraction=running_hr_aerobic_fraction,
                )
            elif pace_seconds > 0:
                zone_minutes = _to_minutes(by_metric.get("pace"))
                aerobic, anaerobic = _compute_load_from_zone_minutes(
                    zone_minutes,
                    zone_weights=running_pace_weights,
                    aerobic_fraction=running_pace_aerobic_fraction,
                )
            else:
                zone_minutes = {key: (value or 0) / 60.0 for key, value in temp_bucket["sports"][sport]["zone_seconds"].items()}
                aerobic, anaerobic = _compute_load_from_zone_minutes(
                    zone_minutes,
                    zone_weights=running_hr_weights,
                    aerobic_fraction=running_hr_aerobic_fraction,
                )
        else:
            power_seconds = _total_seconds(by_metric.get("power"))
            hr_seconds = _total_seconds(by_metric.get("hr"))
            # Cycling: use power zones when present; otherwise use HR zones instead of returning zero.
            if power_seconds > 0:
                zone_minutes = _to_minutes(by_metric.get("power"))
                aerobic, anaerobic = _compute_load_from_zone_minutes(
                    zone_minutes,
                    zone_weights=cycling_weights,
                    aerobic_fraction=cycling_aerobic_fraction,
                )
            elif hr_seconds > 0:
                zone_minutes = _to_minutes(by_metric.get("hr"))
                aerobic, anaerobic = _compute_load_from_zone_minutes(
                    zone_minutes,
                    zone_weights=cycling_hr_weights,
                    aerobic_fraction=cycling_hr_aerobic_fraction,
                )
            else:
                zone_minutes = {key: (value or 0) / 60.0 for key, value in temp_bucket["sports"][sport]["zone_seconds"].items()}
                aerobic, anaerobic = _compute_load_from_zone_minutes(
                    zone_minutes,
                    zone_weights=cycling_weights,
                    aerobic_fraction=cycling_aerobic_fraction,
                )

        if aerobic <= 0 and anaerobic <= 0:
            estimated = _estimate_load_from_activity_summary(
                activity,
                sport=sport,
                ftp=ftp,
                max_hr=max_hr,
                profile=profile,
            )
            if estimated:
                return estimated

        return round(aerobic, 1), round(anaerobic, 1)

    # Fallback for other sports: derive from HR zone-minutes if available (not averages).
    payload = _as_stream_payload(activity.streams)
    data_points = payload.get("data") if isinstance(payload, dict) else None
    hr_zone_minutes: dict[str, float] = {f"Z{i}": 0.0 for i in range(1, 6)}

    hr_samples: list[float] = []
    duration_seconds = _safe_number(activity.duration)
    if isinstance(data_points, list):
        for point in data_points:
            if not isinstance(point, dict):
                continue
            hr_value = _safe_number(point.get("heart_rate"), default=-1)
            if hr_value > 0:
                hr_samples.append(hr_value)

    if hr_samples and max_hr > 0 and duration_seconds > 0:
        seconds_per_sample = duration_seconds / len(hr_samples)
        resting_hr = _resolve_effective_resting_hr(profile, None)
        upper_bounds = _hr_zone_bounds_from_reserve(max_hr, resting_hr)
        for hr_value in hr_samples:
            zone_idx = _zone_index_from_upper_bounds(hr_value, upper_bounds)
            key = f"Z{zone_idx}"
            hr_zone_minutes[key] = hr_zone_minutes.get(key, 0.0) + (seconds_per_sample / 60.0)
    else:
        hr_zones = payload.get("hr_zones") if isinstance(payload, dict) else None
        if isinstance(hr_zones, dict):
            for zone_idx in range(1, 6):
                seconds = _safe_number(hr_zones.get(f"Z{zone_idx}"), default=0.0)
                hr_zone_minutes[f"Z{zone_idx}"] = seconds / 60.0

    aerobic, anaerobic = _compute_load_from_zone_minutes(
        hr_zone_minutes,
        zone_weights=running_hr_weights,
        aerobic_fraction=running_hr_aerobic_fraction,
    )

    if aerobic <= 0 and anaerobic <= 0:
        estimated = _estimate_load_from_activity_summary(
            activity,
            sport=sport,
            ftp=ftp,
            max_hr=max_hr,
            profile=profile,
        )
        if estimated:
            return estimated

    return round(aerobic, 1), round(anaerobic, 1)


def _resolve_training_status(tsb: float, ctl: float) -> str:
    """PMC TSB-based training status."""
    if ctl < 5:
        return "Detraining"
    if tsb > 15:
        return "Fresh"
    if tsb >= 5:
        return "Productive"
    if tsb >= -10:
        return "Maintaining"
    if tsb >= -25:
        return "Fatigued"
    return "Strained"


@router.get("/zone-summary")
async def get_zone_summary(
    athlete_id: int | None = None,
    all_athletes: bool = False,
    reference_date: date | None = None,
    week_start_day: str = Query("monday"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    ref_date = reference_date or date.today()

    week_starts_on = 0 if week_start_day.lower() == "monday" else 6
    week_start = ref_date - timedelta(days=(ref_date.weekday() - week_starts_on) % 7)
    week_end = week_start + timedelta(days=6)

    month_start = ref_date.replace(day=1)
    if month_start.month == 12:
        next_month = month_start.replace(year=month_start.year + 1, month=1, day=1)
    else:
        next_month = month_start.replace(month=month_start.month + 1, day=1)
    month_end = next_month - timedelta(days=1)

    target_user_ids: list[int] = []

    if current_user.role == RoleEnum.coach and all_athletes:
        coach_orgs_subq = select(OrganizationMember.organization_id).where(
            OrganizationMember.user_id == current_user.id,
            OrganizationMember.role == RoleEnum.coach.value,
            OrganizationMember.status == 'active'
        )

        athletes_stmt = select(OrganizationMember.user_id).where(
            OrganizationMember.organization_id.in_(coach_orgs_subq),
            OrganizationMember.role == RoleEnum.athlete.value,
            OrganizationMember.status == 'active'
        )
        athletes_res = await db.execute(athletes_stmt)
        target_user_ids = list(set(athletes_res.scalars().all()))
    elif athlete_id is not None:
        if current_user.role != RoleEnum.coach and athlete_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized for this athlete")

        if current_user.role == RoleEnum.coach and athlete_id != current_user.id:
            access_stmt = select(OrganizationMember).where(
                OrganizationMember.user_id == athlete_id,
                OrganizationMember.status == 'active',
                OrganizationMember.organization_id.in_(
                    select(OrganizationMember.organization_id).where(
                        OrganizationMember.user_id == current_user.id,
                        OrganizationMember.role == RoleEnum.coach.value,
                        OrganizationMember.status == 'active'
                    )
                )
            )
            access_res = await db.execute(access_stmt)
            if access_res.scalar_one_or_none() is None:
                raise HTTPException(status_code=403, detail="Not authorized for this athlete")

        target_user_ids = [athlete_id]
    else:
        target_user_ids = [current_user.id]

    if not target_user_ids:
        return {
            "reference_date": ref_date,
            "week": {"start_date": week_start, "end_date": week_end},
            "month": {"start_date": month_start, "end_date": month_end},
            "athletes": []
        }

    _zs_cache_key = f"{','.join(str(u) for u in sorted(target_user_ids))}:{ref_date.isoformat()}:{week_start_day}:{all_athletes}"
    _zs_cached = _cache_get(_ZONE_SUMMARY_CACHE, _zs_cache_key, _ZONE_SUMMARY_TTL)
    if _zs_cached is not None:
        return _zs_cached

    profiles_stmt = select(Profile).where(Profile.user_id.in_(target_user_ids))
    profiles_res = await db.execute(profiles_stmt)
    profiles = {p.user_id: p for p in profiles_res.scalars().all()}

    # Pre-fetch metric history for historical FTP/weight lookups (avoid N+1 in activity loop)
    metric_hist_res = await db.execute(
        select(ProfileMetricHistory)
        .where(ProfileMetricHistory.user_id.in_(target_user_ids))
        .order_by(ProfileMetricHistory.user_id, ProfileMetricHistory.metric, ProfileMetricHistory.recorded_at)
    )
    _ftp_hist: dict[int, list[tuple[datetime, float]]] = {}
    _weight_hist: dict[int, list[tuple[datetime, float]]] = {}
    for row in metric_hist_res.scalars().all():
        if row.metric == "ftp":
            _ftp_hist.setdefault(row.user_id, []).append((row.recorded_at, row.value))
        elif row.metric == "weight":
            _weight_hist.setdefault(row.user_id, []).append((row.recorded_at, row.value))

    lowest_rhr_stmt = (
        select(RHRDaily.user_id, func.min(RHRDaily.resting_hr))
        .where(RHRDaily.user_id.in_(target_user_ids))
        .group_by(RHRDaily.user_id)
    )
    lowest_rhr_res = await db.execute(lowest_rhr_stmt)
    lowest_rhr_by_user: dict[int, float] = {
        int(user_id): _safe_number(min_rhr, default=0.0)
        for user_id, min_rhr in lowest_rhr_res.all()
    }

    users_stmt = select(User).where(User.id.in_(target_user_ids))
    users_res = await db.execute(users_stmt)
    users = {u.id: u for u in users_res.scalars().all()}

    start_dt = datetime.combine(min(week_start, month_start), datetime.min.time())
    end_dt = datetime.combine(max(week_end, month_end), datetime.max.time())

    # Load activities without the heavy per-second streams["data"] array.
    # hr_zones, laps, _meta, stats, power_curve are all still present and sufficient
    # for zone computation. This avoids transferring/parsing MB of stream data.
    from types import SimpleNamespace
    streams_lite = Activity.streams.op('-')('data').label('streams_lite')
    activities_stmt = select(
        Activity.id,
        Activity.athlete_id,
        Activity.sport,
        Activity.created_at,
        Activity.duration,
        Activity.distance,
        Activity.filename,
        Activity.average_hr,
        Activity.average_watts,
        Activity.is_deleted,
        Activity.duplicate_of_id,
        streams_lite,
    ).where(
        Activity.athlete_id.in_(target_user_ids),
        Activity.created_at >= start_dt,
        Activity.created_at <= end_dt,
        Activity.duplicate_of_id.is_(None),
    )

    summaries: dict[int, dict] = {}
    for user_id in target_user_ids:
        summaries[user_id] = {
            "athlete_id": user_id,
            "athlete_email": users[user_id].email if user_id in users else None,
            "weekly": _empty_bucket(),
            "monthly": _empty_bucket(),
            "weekly_activity_zones": [],
            "monthly_activity_zones": []
        }

    activities_res = await db.execute(activities_stmt)
    for row in activities_res.mappings():
        activity = SimpleNamespace(
            id=row["id"],
            athlete_id=row["athlete_id"],
            sport=row["sport"],
            created_at=row["created_at"],
            duration=row["duration"],
            distance=row["distance"],
            filename=row["filename"],
            average_hr=row["average_hr"],
            average_watts=row["average_watts"],
            is_deleted=row["is_deleted"],
            duplicate_of_id=row["duplicate_of_id"],
            streams=row["streams_lite"],
        )
        if _is_activity_deleted(activity):
            continue
        activity_date = activity.created_at.date()
        athlete_summary = summaries.get(activity.athlete_id)
        if athlete_summary is None:
            continue

        profile = profiles.get(activity.athlete_id)
        _profile_ftp = _safe_number(getattr(profile, "ftp", None), default=0.0)
        ftp = _hist_lookup(_ftp_hist.get(activity.athlete_id, []), activity.created_at, _profile_ftp)
        max_hr = _safe_number(getattr(profile, "max_hr", None), default=190.0)
        lowest_recorded_rhr = lowest_rhr_by_user.get(activity.athlete_id)
        effective_resting_hr = _resolve_effective_resting_hr(profile, lowest_recorded_rhr)
        activity_zone_summary = _build_activity_zone_summary(activity, ftp, max_hr, profile, effective_resting_hr)

        if week_start <= activity_date <= week_end:
            _apply_activity_to_bucket(athlete_summary["weekly"], activity, ftp, max_hr, profile, effective_resting_hr)
            if activity_zone_summary is not None:
                athlete_summary["weekly_activity_zones"].append(activity_zone_summary)
        if month_start <= activity_date <= month_end:
            _apply_activity_to_bucket(athlete_summary["monthly"], activity, ftp, max_hr, profile, effective_resting_hr)
            if activity_zone_summary is not None:
                athlete_summary["monthly_activity_zones"].append(activity_zone_summary)

    for summary in summaries.values():
        summary["weekly"] = _round_bucket(summary["weekly"])
        summary["monthly"] = _round_bucket(summary["monthly"])

    _zs_result = {
        "reference_date": ref_date,
        "week": {
            "start_date": week_start,
            "end_date": week_end
        },
        "month": {
            "start_date": month_start,
            "end_date": month_end
        },
        "athletes": list(summaries.values())
    }
    _cache_set(_ZONE_SUMMARY_CACHE, _zs_cache_key, _zs_result)
    return _zs_result

@router.post("/{activity_id}/reparse")
async def reparse_activity(
    activity_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Re-parse an activity from its stored FIT/GPX file to refresh streams, splits, etc."""
    activity = await db.get(Activity, activity_id)
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    if activity.athlete_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorised")
    if not activity.file_path or not os.path.exists(activity.file_path):
        raise HTTPException(status_code=400, detail="Original file not available for re-parse")

    try:
        parsed_data = parse_activity_file(activity.file_path, activity.file_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Re-parse failed: {str(e)}")
    if not parsed_data:
        raise HTTPException(status_code=500, detail="Re-parse returned no data")

    summary = parsed_data.get("summary", {})
    streams = parsed_data.get("streams", [])

    activity.distance = summary.get("distance")
    activity.duration = summary.get("duration")
    activity.avg_speed = summary.get("avg_speed")
    activity.average_hr = summary.get("average_hr")
    activity.average_watts = summary.get("average_watts")
    activity.sport = parsed_data.get("sport") or activity.sport

    # Preserve existing _meta (rpe, notes, split_annotations, etc.) and old stats fallbacks
    old_meta = {}
    old_stats: dict = {}
    if isinstance(activity.streams, dict):
        old_meta = activity.streams.get("_meta", {})
        old_stats = activity.streams.get("stats") or {}

    composite_streams_data = {
        "data": streams,
        "power_curve": parsed_data.get("power_curve"),
        "hr_zones": parsed_data.get("hr_zones"),
        "pace_curve": parsed_data.get("pace_curve"),
        "laps": parsed_data.get("laps"),
        "splits_metric": parsed_data.get("splits_metric"),
        "best_efforts": parsed_data.get("best_efforts"),
        "_meta": {**old_meta, "reparsed_at": datetime.utcnow().isoformat()},
        "stats": {
            "max_hr": summary.get("max_hr"),
            "max_speed": summary.get("max_speed"),
            "max_watts": summary.get("max_watts"),
            "max_cadence": summary.get("max_cadence"),
            "avg_cadence": summary.get("avg_cadence"),
            "total_elevation_gain": summary.get("total_elevation_gain"),
            "total_calories": summary.get("total_calories"),
            # Preserve previously stored moving time if the parser can't compute it
            # (fallback FIT parser and GPX files don't produce total_timer_time)
            "total_timer_time": summary.get("total_timer_time") or old_stats.get("total_timer_time"),
        }
    }
    activity.streams = composite_streams_data
    activity.moving_time = summary.get("total_timer_time") or summary.get("duration") or activity.moving_time
    if activity.local_date is None:
        activity.local_date = activity.created_at.date() if activity.created_at else None
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(activity, "streams")

    await db.commit()
    return {"status": "ok", "activity_id": activity_id}


@router.post("/manual", status_code=status.HTTP_201_CREATED, response_model=ActivityDetail)
async def create_manual_activity(
    payload: ActivityManualCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Log an activity manually without uploading a file."""
    # Convert distance from km to meters for storage
    distance_m = payload.distance * 1000.0 if payload.distance else None
    avg_speed = (distance_m / payload.duration) if (distance_m and payload.duration > 0) else None

    activity_date = datetime(
        payload.date.year, payload.date.month, payload.date.day,
        12, 0, 0,  # noon as default time
    )

    new_activity = Activity(
        athlete_id=current_user.id,
        filename="Manual Entry",
        file_path="manual",
        file_type="manual",
        sport=payload.sport,
        created_at=activity_date,
        distance=distance_m,
        duration=payload.duration,
        avg_speed=avg_speed,
        average_hr=payload.average_hr,
        average_watts=payload.average_watts,
        rpe=payload.rpe,
        notes=payload.notes,
        local_date=payload.date,
        moving_time=payload.duration if payload.duration else None,
        streams={
            "data": [],
            "power_curve": None,
            "hr_zones": None,
            "pace_curve": None,
            "laps": None,
            "splits_metric": None,
            "_meta": {
                "deleted": False,
                "manual": True,
                "rpe": payload.rpe,
                "notes": payload.notes,
            },
            "stats": {
                "max_hr": None,
                "max_speed": None,
                "max_watts": None,
                "max_cadence": None,
                "avg_cadence": None,
                "total_elevation_gain": None,
                "total_calories": None,
            },
        },
    )

    db.add(new_activity)
    await db.commit()
    await db.refresh(new_activity)

    await match_and_score(db, current_user.id, new_activity.created_at.date())

    profile = await db.scalar(select(Profile).where(Profile.user_id == current_user.id))
    ftp = _safe_number(getattr(profile, "ftp", None), default=0.0)
    max_hr_val = _safe_number(getattr(profile, "max_hr", None), default=190.0)
    aerobic_load, anaerobic_load = _activity_training_load(new_activity, ftp, max_hr_val, profile)
    new_activity.aerobic_load = aerobic_load
    new_activity.anaerobic_load = anaerobic_load
    db.add(new_activity)
    await db.commit()
    _invalidate_athlete_caches(current_user.id)

    return ActivityDetail(
        id=new_activity.id,
        athlete_id=new_activity.athlete_id,
        filename=new_activity.filename,
        created_at=new_activity.created_at,
        file_type=new_activity.file_type,
        sport=new_activity.sport,
        distance=new_activity.distance,
        duration=new_activity.duration,
        avg_speed=new_activity.avg_speed,
        average_hr=new_activity.average_hr,
        average_watts=new_activity.average_watts,
        aerobic_load=aerobic_load,
        anaerobic_load=anaerobic_load,
        total_load_impact=round(aerobic_load + anaerobic_load, 1),
        rpe=payload.rpe,
        notes=payload.notes,
    )


@router.post("/upload", status_code=status.HTTP_201_CREATED, response_model=ActivityDetail)
async def upload_activity(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Validate file type
    file_type = "unknown"
    filename_lower = (file.filename or "").lower()
    if not filename_lower:
        raise HTTPException(status_code=400, detail="Missing filename")
    if filename_lower.endswith(".fit"):
        file_type = "fit"
    elif filename_lower.endswith(".gpx"):
        file_type = "gpx"
    else:
        raise HTTPException(status_code=400, detail="Invalid file format. Only .fit and .gpx supported.")

    # Save file
    file_id = str(uuid.uuid4())
    ext = filename_lower.split(".")[-1]
    saved_filename = f"{file_id}.{ext}"
    file_path = os.path.join(UPLOAD_DIR, saved_filename)
    
    try:
        content = await file.read()
        if len(content) > MAX_UPLOAD_SIZE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"File too large. Max allowed size is {MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)} MB."
            )
        file_sha256 = sha256_hex(content)

        duplicate_by_hash = await find_duplicate_activity(
            db,
            athlete_id=current_user.id,
            file_sha256=file_sha256,
        )
        if duplicate_by_hash:
            raise HTTPException(
                status_code=409,
                detail=f"Duplicate activity detected (existing id {duplicate_by_hash.id})"
            )

        # Use simple open since we are writing bytes, block is minimal for these file sizes
        # or use aiofiles if installed, but standard write is blocking. 
        # Assuming files < 10MB, sync write is acceptable for MVP.
        with open(file_path, "wb") as f:
            f.write(content)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not save file: {str(e)}")

    # Parse file
    try:
        # Parsing is CPU bound/blocking. Ideally run in run_in_executor
        parsed_data = parse_activity_file(file_path, file_type)
    except Exception as e:
        # Cleanup file if parse fails?
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {str(e)}")

    if not parsed_data:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=400, detail="Could not parse activity data")
        
    summary = parsed_data.get("summary", {})
    streams = parsed_data.get("streams", [])

    # Create DB entry
    created_at_date = parsed_data.get("start_time")
    if created_at_date:
        # Ensure it's a datetime object (handle possible string or pandas timestamp)
        if isinstance(created_at_date, str):
            try:
                created_at_date = datetime.fromisoformat(created_at_date.replace("Z", "+00:00"))
            except ValueError:
                created_at_date = datetime.utcnow()
        elif hasattr(created_at_date, 'to_pydatetime'): # Handle pandas Timestamp
             created_at_date = created_at_date.to_pydatetime()
        
        # Ensure timezone naivety (for SQLite/Postgres naive columns)
        if created_at_date.tzinfo is not None:
             created_at_date = created_at_date.astimezone(timezone.utc).replace(tzinfo=None)
    else:
        created_at_date = datetime.utcnow()

    source_provider, source_activity_id = extract_source_identity(parsed_data)
    fingerprint_v1 = build_fingerprint(
        sport=parsed_data.get("sport"),
        created_at=created_at_date,
        duration_s=summary.get("duration"),
        distance_m=summary.get("distance"),
    )

    duplicate = await find_duplicate_activity(
        db,
        athlete_id=current_user.id,
        file_sha256=file_sha256,
        source_provider=source_provider,
        source_activity_id=source_activity_id,
        fingerprint_v1=fingerprint_v1,
        sport=parsed_data.get("sport"),
        created_at=created_at_date,
        duration_s=summary.get("duration"),
        distance_m=summary.get("distance"),
    )
    # Fuzzy duplicates are saved as alternate recordings linked to the original.
    # Only exact-file duplicates (same SHA256) are rejected outright (caught above).
    _duplicate_of_id = duplicate.id if duplicate else None

    new_activity = Activity(
        athlete_id=current_user.id,
        filename=file.filename,
        file_path=file_path,
        file_type=file_type,
        created_at=created_at_date,
        distance=summary.get("distance"),
        duration=summary.get("duration"),
        avg_speed=summary.get("avg_speed"),
        average_hr=summary.get("average_hr"),
        average_watts=summary.get("average_watts"),
        streams=streams,
        duplicate_of_id=_duplicate_of_id,
    )
    
    # Store calculated stats in JSON for MVP (ideally separate columns)
    # Using streams column to store everything in a structured way if needed or just let schema handle response
    # For now, let's keep it simple on DB model side and just rely on parse response for immediate return?
    # No, we must simple save streams.
    # Wait, we need to save sport!
    new_activity.sport = parsed_data.get("sport")
    
    # We really should have columns for power_curve/hr_zones or put them in streams JSON?
    # Let's put extended data into streams column as a wrapper object or separate keys if column supports JSONB
    # Actually 'streams' column in DB is JSONB. We can put whatever we want.
    # Let's change the structure of what we save to 'streams' column to be a dict containing proper streams + stats
    
    # Update: Parsing returns { "summary": ..., "streams": [...], "sport": ..., "power_curve": ..., "hr_zones": ... }
    # We want to save streams list to streams column.
    # But where do we save power_curve and hr_zones?
    # Option 1: Add columns.
    # Option 2: Wrap streams column content.
    # Let's go with Option 2 for MVP flexibility.
    
    composite_streams_data = {
        "data": streams,
        "power_curve": parsed_data.get("power_curve"),
        "hr_zones": parsed_data.get("hr_zones"),
        "pace_curve": parsed_data.get("pace_curve"),
        "laps": parsed_data.get("laps"),
        "splits_metric": parsed_data.get("splits_metric"),
        "best_efforts": parsed_data.get("best_efforts"),
        "_meta": {
            "deleted": False,
            "file_sha256": file_sha256,
            "fingerprint_v1": fingerprint_v1,
            "source_provider": source_provider,
            "source_activity_id": source_activity_id,
            "rpe": None,
            "notes": None
        },
        "stats": {
            "max_hr": summary.get("max_hr"),
            "max_speed": summary.get("max_speed"),
            "max_watts": summary.get("max_watts"),
            "max_cadence": summary.get("max_cadence"),
            "avg_cadence": summary.get("avg_cadence"),
            "total_elevation_gain": summary.get("total_elevation_gain"),
            "total_calories": summary.get("total_calories"),
            "total_timer_time": summary.get("total_timer_time"),
        }
    }
    
    new_activity.streams = composite_streams_data
    new_activity.local_date = created_at_date.date() if hasattr(created_at_date, 'date') else created_at_date
    new_activity.moving_time = summary.get("total_timer_time") or summary.get("duration")

    db.add(new_activity)
    await db.commit()
    await db.refresh(new_activity)

    # Schedule compliance re-scoring in the background so the response returns fast.
    background_tasks.add_task(_bg_match_and_score, current_user.id, new_activity.created_at.date())

    profile = await db.scalar(select(Profile).where(Profile.user_id == current_user.id))
    ftp = _safe_number(getattr(profile, "ftp", None), default=0.0)
    max_hr = _safe_number(getattr(profile, "max_hr", None), default=190.0)
    aerobic_load, anaerobic_load = _activity_training_load(new_activity, ftp, max_hr, profile)
    new_activity.aerobic_load = aerobic_load
    new_activity.anaerobic_load = anaerobic_load
    db.add(new_activity)
    await db.commit()
    _invalidate_athlete_caches(current_user.id)

    return ActivityDetail(
        id=new_activity.id,
        athlete_id=new_activity.athlete_id,
        filename=new_activity.filename,
        created_at=new_activity.created_at,
        file_type=new_activity.file_type,
        sport=new_activity.sport,
        distance=new_activity.distance,
        duration=new_activity.duration,
        avg_speed=new_activity.avg_speed,
        average_hr=new_activity.average_hr,
        average_watts=new_activity.average_watts,
        streams=streams,
        power_curve=parsed_data.get("power_curve"),
        hr_zones=parsed_data.get("hr_zones"),
        pace_curve=parsed_data.get("pace_curve"),
        best_efforts=parsed_data.get("best_efforts"),
        laps=parsed_data.get("laps"),
        splits_metric=parsed_data.get("splits_metric"),
        max_hr=summary.get("max_hr"),
        max_speed=summary.get("max_speed"),
        max_watts=summary.get("max_watts"),
        max_cadence=summary.get("max_cadence"),
        avg_cadence=summary.get("avg_cadence"),
        total_elevation_gain=summary.get("total_elevation_gain"),
        total_calories=summary.get("total_calories"),
        aerobic_load=aerobic_load,
        anaerobic_load=anaerobic_load,
        total_load_impact=round(aerobic_load + anaerobic_load, 1),
        rpe=None,
        notes=None,
        duplicate_of_id=new_activity.duplicate_of_id,
    )


async def _resolve_training_status_target_athlete(
    db: AsyncSession,
    *,
    current_user: User,
    athlete_id: int | None,
) -> int:
    target_athlete_id = current_user.id

    if athlete_id is not None and athlete_id != current_user.id:
        if current_user.role != RoleEnum.coach:
            raise HTTPException(status_code=403, detail="Not authorized for this athlete")
        access_stmt = select(OrganizationMember).where(
            OrganizationMember.user_id == athlete_id,
            OrganizationMember.status == 'active',
            OrganizationMember.organization_id.in_(
                select(OrganizationMember.organization_id).where(
                    OrganizationMember.user_id == current_user.id,
                    OrganizationMember.role == RoleEnum.coach.value,
                    OrganizationMember.status == 'active'
                )
            )
        )
        access_res = await db.execute(access_stmt)
        if access_res.scalar_one_or_none() is None:
            raise HTTPException(status_code=403, detail="Not authorized for this athlete")
        target_athlete_id = athlete_id
    elif athlete_id is not None:
        target_athlete_id = athlete_id

    return target_athlete_id


def _serialize_training_status_row(
    *,
    athlete_id: int,
    reference_date: date,
    acute_aerobic: float,
    acute_anaerobic: float,
    chronic_aerobic: float,
    chronic_anaerobic: float,
    atl: float,
    ctl: float,
) -> dict[str, Any]:
    tsb = ctl - atl
    acute_load = (acute_aerobic + acute_anaerobic) / 7.0
    chronic_load = (chronic_aerobic + chronic_anaerobic) / 42.0

    return {
        "athlete_id": athlete_id,
        "reference_date": reference_date,
        "acute": {
            "aerobic": round(acute_aerobic, 1),
            "anaerobic": round(acute_anaerobic, 1),
            "daily_load": round(acute_load, 1),
        },
        "chronic": {
            "aerobic": round(chronic_aerobic, 1),
            "anaerobic": round(chronic_anaerobic, 1),
            "daily_load": round(chronic_load, 1),
        },
        "atl": round(atl, 1),
        "ctl": round(ctl, 1),
        "tsb": round(tsb, 1),
        "training_status": _resolve_training_status(tsb, ctl),
    }


async def _build_training_status_history(
    db: AsyncSession,
    *,
    athlete_id: int,
    reference_dates: list[date],
) -> list[dict[str, Any]]:
    sorted_dates = sorted(set(reference_dates))
    if not sorted_dates:
        return []

    earliest_ref = sorted_dates[0]
    latest_ref = sorted_dates[-1]

    profile = await db.scalar(select(Profile).where(Profile.user_id == athlete_id))
    profile_ftp = _safe_number(getattr(profile, "ftp", None), default=0.0)
    max_hr = _safe_number(getattr(profile, "max_hr", None), default=190.0)

    pmc_window = 89
    start_date = earliest_ref - timedelta(days=pmc_window)
    start_dt = datetime.combine(start_date, datetime.min.time())
    end_dt = datetime.combine(latest_ref, datetime.max.time())

    ftp_history_res = await db.execute(
        select(ProfileMetricHistory)
        .where(
            ProfileMetricHistory.user_id == athlete_id,
            ProfileMetricHistory.metric == "ftp",
        )
        .order_by(ProfileMetricHistory.recorded_at)
    )
    ftp_history: list[tuple[datetime, float]] = [
        (row.recorded_at, row.value) for row in ftp_history_res.scalars().all()
    ]

    activities_stmt = select(
        Activity,
        Activity.streams['_meta'].label('streams_meta'),
    ).options(defer(Activity.streams)).where(
        Activity.athlete_id == athlete_id,
        Activity.created_at >= start_dt,
        Activity.created_at <= end_dt,
        Activity.duplicate_of_id.is_(None)
    )
    activities_res = await db.execute(activities_stmt)
    rows = activities_res.all()

    daily_aerobic: dict[date, float] = defaultdict(float)
    daily_anaerobic: dict[date, float] = defaultdict(float)
    needs_full_streams: list[int] = []

    for activity, streams_meta in rows:
        meta = streams_meta if isinstance(streams_meta, dict) else {}
        if meta.get("deleted"):
            continue
        sport = _normalize_sport_name(activity.sport)
        ftp = _hist_lookup(ftp_history, activity.created_at, profile_ftp)
        cached = _load_from_meta_dict(meta)
        if cached is not None:
            aerobic, anaerobic = cached
        else:
            estimated = _estimate_load_from_activity_summary(
                activity, sport=sport, ftp=ftp, max_hr=max_hr, profile=profile,
            )
            if estimated is not None:
                aerobic, anaerobic = estimated
            else:
                needs_full_streams.append(activity.id)
                continue
        activity_day = activity.created_at.date()
        daily_aerobic[activity_day] += aerobic
        daily_anaerobic[activity_day] += anaerobic

    if needs_full_streams:
        full_stmt = select(Activity).where(Activity.id.in_(needs_full_streams))
        full_res = await db.execute(full_stmt)
        for activity in full_res.scalars().all():
            ftp = _hist_lookup(ftp_history, activity.created_at, profile_ftp)
            aerobic, anaerobic = _activity_training_load(activity, ftp, max_hr, profile)
            activity_day = activity.created_at.date()
            daily_aerobic[activity_day] += aerobic
            daily_anaerobic[activity_day] += anaerobic

    decay_ctl = 1.0 - math.exp(-1.0 / 42)
    decay_atl = 1.0 - math.exp(-1.0 / 7)
    ctl = 0.0
    atl = 0.0

    acute_aerobic_window: deque[float] = deque()
    acute_anaerobic_window: deque[float] = deque()
    chronic_aerobic_window: deque[float] = deque()
    chronic_anaerobic_window: deque[float] = deque()
    acute_aerobic_sum = 0.0
    acute_anaerobic_sum = 0.0
    chronic_aerobic_sum = 0.0
    chronic_anaerobic_sum = 0.0

    target_dates = set(sorted_dates)
    history_by_date: dict[date, dict[str, Any]] = {}
    day_cursor = start_date

    while day_cursor <= latest_ref:
        day_aerobic = daily_aerobic.get(day_cursor, 0.0)
        day_anaerobic = daily_anaerobic.get(day_cursor, 0.0)
        day_tss = day_aerobic + day_anaerobic

        ctl += (day_tss - ctl) * decay_ctl
        atl += (day_tss - atl) * decay_atl

        acute_aerobic_window.append(day_aerobic)
        acute_anaerobic_window.append(day_anaerobic)
        chronic_aerobic_window.append(day_aerobic)
        chronic_anaerobic_window.append(day_anaerobic)
        acute_aerobic_sum += day_aerobic
        acute_anaerobic_sum += day_anaerobic
        chronic_aerobic_sum += day_aerobic
        chronic_anaerobic_sum += day_anaerobic

        if len(acute_aerobic_window) > 7:
            acute_aerobic_sum -= acute_aerobic_window.popleft()
            acute_anaerobic_sum -= acute_anaerobic_window.popleft()
        if len(chronic_aerobic_window) > 42:
            chronic_aerobic_sum -= chronic_aerobic_window.popleft()
            chronic_anaerobic_sum -= chronic_anaerobic_window.popleft()

        if day_cursor in target_dates:
            history_by_date[day_cursor] = _serialize_training_status_row(
                athlete_id=athlete_id,
                reference_date=day_cursor,
                acute_aerobic=acute_aerobic_sum,
                acute_anaerobic=acute_anaerobic_sum,
                chronic_aerobic=chronic_aerobic_sum,
                chronic_anaerobic=chronic_anaerobic_sum,
                atl=atl,
                ctl=ctl,
            )

        day_cursor += timedelta(days=1)

    return [history_by_date[ref_date] for ref_date in sorted_dates if ref_date in history_by_date]


@router.get("/training-status")
async def get_training_status(
    athlete_id: int | None = None,
    reference_date: date | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    ref_date = reference_date or date.today()
    target_athlete_id = await _resolve_training_status_target_athlete(
        db,
        current_user=current_user,
        athlete_id=athlete_id,
    )
    rows = await _build_training_status_history(
        db,
        athlete_id=target_athlete_id,
        reference_dates=[ref_date],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Training status unavailable")
    return rows[0]


@router.get("/training-status-history")
async def get_training_status_history(
    athlete_id: int | None = None,
    days: int = Query(default=14, ge=1, le=60),
    end_date: date | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target_athlete_id = await _resolve_training_status_target_athlete(
        db,
        current_user=current_user,
        athlete_id=athlete_id,
    )
    history_end_date = end_date or date.today()
    reference_dates = [history_end_date - timedelta(days=offset) for offset in range(days - 1, -1, -1)]
    return await _build_training_status_history(
        db,
        athlete_id=target_athlete_id,
        reference_dates=reference_dates,
    )

@router.get("/performance-trend", response_model=PerformanceTrendResponse)
async def get_performance_trend(
    days: int = Query(default=180, ge=30, le=365),
    athlete_id: int | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Return daily Fitness/Fatigue/Form series for the Performance Trend Chart."""
    ref_date = date.today()
    target_athlete_id = current_user.id

    if athlete_id is not None and athlete_id != current_user.id:
        if current_user.role != RoleEnum.coach:
            raise HTTPException(status_code=403, detail="Not authorized for this athlete")
        access_stmt = select(OrganizationMember).where(
            OrganizationMember.user_id == athlete_id,
            OrganizationMember.status == 'active',
            OrganizationMember.organization_id.in_(
                select(OrganizationMember.organization_id).where(
                    OrganizationMember.user_id == current_user.id,
                    OrganizationMember.role == RoleEnum.coach.value,
                    OrganizationMember.status == 'active'
                )
            )
        )
        access_res = await db.execute(access_stmt)
        if access_res.scalar_one_or_none() is None:
            raise HTTPException(status_code=403, detail="Not authorized for this athlete")
        target_athlete_id = athlete_id
    elif athlete_id is not None:
        target_athlete_id = athlete_id

    _pt_cache_key = f"{target_athlete_id}:{days}:{date.today().isoformat()}"
    _pt_cached = _cache_get(_PERF_TREND_CACHE, _pt_cache_key, _PERF_TREND_TTL)
    if _pt_cached is not None:
        return _pt_cached

    profile = await db.scalar(select(Profile).where(Profile.user_id == target_athlete_id))
    _profile_ftp = _safe_number(getattr(profile, "ftp", None), default=0.0)
    max_hr = _safe_number(getattr(profile, "max_hr", None), default=190.0)

    # Need enough warmup for the 42-day fitness EWA — fetch days + 89 extra
    warmup = 89
    total_window = days + warmup
    window_start = ref_date - timedelta(days=total_window)
    start_dt = datetime.combine(window_start, datetime.min.time())
    end_dt = datetime.combine(ref_date, datetime.max.time())

    _pt_ftp_hist_res = await db.execute(
        select(ProfileMetricHistory)
        .where(
            ProfileMetricHistory.user_id == target_athlete_id,
            ProfileMetricHistory.metric == "ftp",
        )
        .order_by(ProfileMetricHistory.recorded_at)
    )
    _pt_ftp_hist: list[tuple[datetime, float]] = [
        (row.recorded_at, row.value) for row in _pt_ftp_hist_res.scalars().all()
    ]

    activities_stmt = select(
        Activity,
        Activity.streams['_meta'].label('streams_meta'),
    ).options(defer(Activity.streams)).where(
        Activity.athlete_id == target_athlete_id,
        Activity.created_at >= start_dt,
        Activity.created_at <= end_dt,
        Activity.duplicate_of_id.is_(None)
    )
    activities_res = await db.execute(activities_stmt)
    rows = activities_res.all()

    daily_aerobic: dict[date, float] = defaultdict(float)
    daily_anaerobic: dict[date, float] = defaultdict(float)
    needs_full_streams: list[int] = []

    for activity, streams_meta in rows:
        meta = streams_meta if isinstance(streams_meta, dict) else {}
        if meta.get("deleted"):
            continue
        sport = _normalize_sport_name(activity.sport)
        ftp = _hist_lookup(_pt_ftp_hist, activity.created_at, _profile_ftp)
        cached = _load_from_meta_dict(meta)
        if cached is not None:
            aerobic, anaerobic = cached
        else:
            estimated = _estimate_load_from_activity_summary(
                activity, sport=sport, ftp=ftp, max_hr=max_hr, profile=profile,
            )
            if estimated is not None:
                aerobic, anaerobic = estimated
            else:
                needs_full_streams.append(activity.id)
                continue
        activity_day = activity.created_at.date()
        daily_aerobic[activity_day] += aerobic
        daily_anaerobic[activity_day] += anaerobic

    if needs_full_streams:
        full_stmt = select(Activity).where(Activity.id.in_(needs_full_streams))
        full_res = await db.execute(full_stmt)
        for activity in full_res.scalars().all():
            ftp = _hist_lookup(_pt_ftp_hist, activity.created_at, _profile_ftp)
            aerobic, anaerobic = _activity_training_load(activity, ftp, max_hr, profile)
            activity_day = activity.created_at.date()
            daily_aerobic[activity_day] += aerobic
            daily_anaerobic[activity_day] += anaerobic

    _DECAY_FITNESS = 1.0 - math.exp(-1.0 / 42)
    _DECAY_FATIGUE = 1.0 - math.exp(-1.0 / 7)
    fitness = 0.0
    fatigue = 0.0

    series_start = ref_date - timedelta(days=days - 1)
    result_points: list[TrendDataPoint] = []

    day_cursor = window_start
    while day_cursor <= ref_date:
        day_load = daily_aerobic.get(day_cursor, 0.0) + daily_anaerobic.get(day_cursor, 0.0)
        fitness += (day_load - fitness) * _DECAY_FITNESS
        fatigue += (day_load - fatigue) * _DECAY_FATIGUE
        if day_cursor >= series_start:
            result_points.append(TrendDataPoint(
                date=day_cursor.isoformat(),
                fitness=round(fitness, 2),
                fatigue=round(fatigue, 2),
                form=round(fitness - fatigue, 2),
                load=round(day_load, 1),
            ))
        day_cursor += timedelta(days=1)

    _pt_result = PerformanceTrendResponse(data=result_points)
    _cache_set(_PERF_TREND_CACHE, _pt_cache_key, _pt_result)
    return _pt_result


@router.get("/personal-records")
async def get_personal_records_endpoint(
    sport: str = "cycling",
    athlete_id: int | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return aggregate personal records (top-3 per window/distance) for an athlete."""
    target_athlete_id = current_user.id

    if athlete_id is not None and athlete_id != current_user.id:
        if current_user.role != RoleEnum.coach:
            raise HTTPException(status_code=403, detail="Not authorized for this athlete")
        access_stmt = select(OrganizationMember).where(
            OrganizationMember.user_id == athlete_id,
            OrganizationMember.status == "active",
            OrganizationMember.organization_id.in_(
                select(OrganizationMember.organization_id).where(
                    OrganizationMember.user_id == current_user.id,
                    OrganizationMember.role == RoleEnum.coach.value,
                    OrganizationMember.status == "active",
                )
            ),
        )
        access_res = await db.execute(access_stmt)
        if access_res.scalar_one_or_none() is None:
            raise HTTPException(status_code=403, detail="Not authorized for this athlete")
        target_athlete_id = athlete_id
    elif athlete_id is not None:
        target_athlete_id = athlete_id

    return await get_personal_records(
        db,
        target_athlete_id,
        sport,
        auto_backfill=True,
    )


@router.get("/", response_model=list[ActivityOut])
async def get_activities(
    start_date: str | None = None,
    end_date: str | None = None,
    athlete_id: int | None = None,
    include_load_metrics: bool = False,
    sort_by: str = Query("created_at", pattern="^(created_at|ingested_at)$"),
    limit: int = 120,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    response: Response = None,
):
    if response is not None:
        response.headers["Cache-Control"] = "private, max-age=60"
    limit = max(1, min(limit, 500))
    offset = max(0, offset)

    query = select(
        Activity,
        Activity.streams['_meta'].label('streams_meta'),
    ).options(defer(Activity.streams))

    if start_date:
        try:
             # Just strict YYYY-MM-DD for now
             start_dt = datetime.strptime(start_date, "%Y-%m-%d")
             query = query.where(Activity.created_at >= start_dt)
        except: pass
    
    if end_date:
         try:
             # Inclusive of exact date? Or range?
             # created_at is timestamp. end_date is date.
             # end_date + 1 day
             end_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
             query = query.where(Activity.created_at <= end_dt)
         except: pass

    if current_user.role == "coach":
        if athlete_id:
            if athlete_id != current_user.id:
                coach_orgs_subq = select(OrganizationMember.organization_id).where(
                    OrganizationMember.user_id == current_user.id,
                    OrganizationMember.role == RoleEnum.coach.value,
                    OrganizationMember.status == 'active'
                )
                membership = await db.scalar(
                    select(OrganizationMember).where(
                        OrganizationMember.user_id == athlete_id,
                        OrganizationMember.organization_id.in_(coach_orgs_subq),
                        OrganizationMember.status == 'active'
                    )
                )
                if not membership:
                    raise HTTPException(status_code=403, detail="Not authorized for this athlete")
            query = query.where(Activity.athlete_id == athlete_id)
        else:
            coach_orgs_subq = select(OrganizationMember.organization_id).where(
                OrganizationMember.user_id == current_user.id,
                OrganizationMember.role == RoleEnum.coach.value,
                OrganizationMember.status == 'active'
            )
            athlete_ids_subq = select(OrganizationMember.user_id).where(
                OrganizationMember.organization_id.in_(coach_orgs_subq),
                OrganizationMember.role == RoleEnum.athlete.value,
                OrganizationMember.status == 'active'
            )
            query = query.where(
                (Activity.athlete_id.in_(athlete_ids_subq)) | (Activity.athlete_id == current_user.id)
            )
            
    else:
        # Regular athlete, see only own
        query = query.where(Activity.athlete_id == current_user.id)

    # Hide secondary recordings from the list (they are accessible via the primary)
    query = query.where(Activity.duplicate_of_id.is_(None))
    # Hide deleted activities
    query = query.where(Activity.is_deleted == False)  # noqa: E712

    order_expr = Activity.created_at.desc() if sort_by == "created_at" else Activity.id.desc()
    result = await db.execute(query.order_by(order_expr).limit(limit).offset(offset))
    rows = result.all()

    # Count alternate recordings for each primary activity
    primary_ids = [row[0].id for row in rows]
    dup_count_map: dict[int, int] = {}
    if primary_ids:
        dup_counts_res = await db.execute(
            select(Activity.duplicate_of_id, func.count(Activity.id).label("cnt"))
            .where(Activity.duplicate_of_id.in_(primary_ids))
            .group_by(Activity.duplicate_of_id)
        )
        for orig_id, cnt in dup_counts_res.all():
            dup_count_map[orig_id] = cnt

    profile_map: dict[int, Profile] = {}
    ftp_hist_map: dict[int, list[tuple[datetime, float]]] = {}
    if include_load_metrics:
        athlete_ids = list({row[0].athlete_id for row in rows})
        if athlete_ids:
            profiles_res = await db.execute(select(Profile).where(Profile.user_id.in_(athlete_ids)))
            profile_map = {profile.user_id: profile for profile in profiles_res.scalars().all()}
            ftp_hist_res = await db.execute(
                select(ProfileMetricHistory)
                .where(
                    ProfileMetricHistory.user_id.in_(athlete_ids),
                    ProfileMetricHistory.metric == "ftp",
                )
                .order_by(ProfileMetricHistory.user_id, ProfileMetricHistory.recorded_at)
            )
            for row in ftp_hist_res.scalars().all():
                ftp_hist_map.setdefault(row.user_id, []).append((row.recorded_at, row.value))

    out: list[ActivityOut] = []
    for activity, streams_meta in rows:
        meta = streams_meta if isinstance(streams_meta, dict) else {}
        is_deleted = bool(meta.get("deleted"))
        aerobic_load = None
        anaerobic_load = None
        total_load_impact = None
        if include_load_metrics:
            profile = profile_map.get(activity.athlete_id)
            _pf = _safe_number(getattr(profile, "ftp", None), default=0.0)
            ftp = _hist_lookup(ftp_hist_map.get(activity.athlete_id, []), activity.created_at, _pf)
            max_hr = _safe_number(getattr(profile, "max_hr", None), default=190.0)
            # Try cached load from _meta, then estimate from summary fields
            cached = _load_from_meta_dict(meta)
            if cached is not None:
                aerobic_load, anaerobic_load = cached
            else:
                estimated = _estimate_load_from_activity_summary(
                    activity, sport=_normalize_sport_name(activity.sport),
                    ftp=ftp, max_hr=max_hr, profile=profile,
                )
                if estimated is not None:
                    aerobic_load, anaerobic_load = estimated
                else:
                    aerobic_load, anaerobic_load = 0.0, 0.0
            total_load_impact = round((aerobic_load or 0) + (anaerobic_load or 0), 1)

        # Prefer new columns, fallback to streams._meta (legacy)
        rpe = activity.rpe
        notes = activity.notes
        lactate_mmol_l = None
        if rpe is None:
            rpe_raw = meta.get("rpe")
            if rpe_raw is not None:
                try:
                    parsed = int(rpe_raw)
                    if 1 <= parsed <= 10:
                        rpe = parsed
                except (TypeError, ValueError):
                    pass
        if notes is None:
            notes_raw = meta.get("notes")
            if isinstance(notes_raw, str) and notes_raw.strip():
                notes = notes_raw.strip()
        if lactate_mmol_l is None:
            lactate_raw = meta.get("lactate_mmol_l")
            if lactate_raw is not None:
                try:
                    parsed = float(lactate_raw)
                    if 0.0 <= parsed <= 40.0:
                        lactate_mmol_l = parsed
                except (TypeError, ValueError):
                    pass

        stats = meta.get("stats") if isinstance(meta, dict) else {}
        moving_time_val: float | None = None
        if isinstance(stats, dict) and stats.get("total_timer_time"):
            moving_time_val = float(stats["total_timer_time"])

        out.append(
            ActivityOut(
                id=activity.id,
                athlete_id=activity.athlete_id,
                filename=activity.filename,
                created_at=activity.created_at,
                local_date=activity.local_date,
                file_type=activity.file_type,
                sport=activity.sport,
                distance=activity.distance,
                duration=activity.duration,
                avg_speed=activity.avg_speed,
                average_hr=activity.average_hr,
                average_watts=activity.average_watts,
                is_deleted=is_deleted,
                aerobic_load=aerobic_load,
                anaerobic_load=anaerobic_load,
                total_load_impact=total_load_impact,
                rpe=rpe,
                lactate_mmol_l=lactate_mmol_l,
                notes=notes,
                duplicate_recordings_count=dup_count_map.get(activity.id, 0) or None,
                source_provider=meta.get("source_provider"),
                moving_time=moving_time_val,
            )
        )
    return out

@router.get("/{activity_id}/duplicates", response_model=list[ActivityOut])
async def get_activity_duplicates(
    activity_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return alternate recordings linked to this activity."""
    activity = await db.scalar(select(Activity).where(Activity.id == activity_id))
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    if activity.athlete_id != current_user.id and current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail="Not authorized")

    result = await db.execute(
        select(Activity, Activity.streams['_meta'].label('streams_meta'))
        .options(defer(Activity.streams))
        .where(Activity.duplicate_of_id == activity_id)
        .order_by(Activity.created_at)
    )
    rows = result.all()

    out: list[ActivityOut] = []
    for dup, streams_meta in rows:
        meta = streams_meta if isinstance(streams_meta, dict) else {}
        out.append(
            ActivityOut(
                id=dup.id,
                athlete_id=dup.athlete_id,
                filename=dup.filename,
                created_at=dup.created_at,
                file_type=dup.file_type,
                sport=dup.sport,
                distance=dup.distance,
                duration=dup.duration,
                avg_speed=dup.avg_speed,
                average_hr=dup.average_hr,
                average_watts=dup.average_watts,
                is_deleted=bool(meta.get("deleted")),
                duplicate_of_id=dup.duplicate_of_id,
                source_provider=meta.get("source_provider"),
            )
        )
    return out


@router.post("/{activity_id}/make-primary", status_code=204)
async def make_activity_primary(
    activity_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Promote a secondary recording to be the primary (canonical) activity."""
    activity = await db.scalar(select(Activity).where(Activity.id == activity_id))
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    if activity.athlete_id != current_user.id and current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail="Not authorized")

    if activity.duplicate_of_id is None:
        # Already primary, nothing to do
        return

    old_primary_id = activity.duplicate_of_id

    # Fetch old primary and all siblings
    old_primary = await db.scalar(select(Activity).where(Activity.id == old_primary_id))
    siblings_res = await db.execute(
        select(Activity).where(Activity.duplicate_of_id == old_primary_id)
    )
    siblings = siblings_res.scalars().all()

    # Promote target to primary
    activity.duplicate_of_id = None
    db.add(activity)

    # Demote old primary to secondary of new primary
    if old_primary:
        old_primary.duplicate_of_id = activity_id
        db.add(old_primary)

    # Re-link all other siblings to the new primary
    for sibling in siblings:
        if sibling.id != activity_id:
            sibling.duplicate_of_id = activity_id
            db.add(sibling)

    await db.commit()

    # Re-trigger compliance scoring so the planned workout re-matches
    # against the new primary instead of the old one.
    from ..services.compliance import match_and_score
    activity_date = activity.created_at.date() if activity.created_at else None
    if activity_date:
        await match_and_score(db, activity.athlete_id, activity_date)


@router.post("/{activity_id1}/check-duplicate-with/{activity_id2}")
async def check_duplicate_diagnostic(
    activity_id1: int,
    activity_id2: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Diagnostic endpoint to check if two activities should be detected as duplicates.
    Returns detailed information about why they matched or didn't match.
    This helps diagnose duplicate detection issues.
    """
    act1 = await db.scalar(select(Activity).where(Activity.id == activity_id1))
    act2 = await db.scalar(select(Activity).where(Activity.id == activity_id2))
    
    if not act1:
        raise HTTPException(status_code=404, detail=f"Activity {activity_id1} not found")
    if not act2:
        raise HTTPException(status_code=404, detail=f"Activity {activity_id2} not found")
    
    if act1.athlete_id != current_user.id and current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail="Not authorized")
    if act2.athlete_id != current_user.id and current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    from ..services.activity_dedupe import _rows_are_duplicate, normalize_sport, build_fingerprint

    result = _rows_are_duplicate(
        {
            "id": act1.id,
            "athlete_id": act1.athlete_id,
            "sport": act1.sport,
            "created_at": act1.created_at,
            "duration": act1.duration,
            "distance": act1.distance,
            "streams": act1.streams,
        },
        {
            "id": act2.id,
            "athlete_id": act2.athlete_id,
            "sport": act2.sport,
            "created_at": act2.created_at,
            "duration": act2.duration,
            "distance": act2.distance,
            "streams": act2.streams,
        },
    )
    
    # Build diagnostic info
    meta1 = act1.streams.get("_meta") if isinstance(act1.streams, dict) else {}
    meta2 = act2.streams.get("_meta") if isinstance(act2.streams, dict) else {}
    
    fp1 = build_fingerprint(sport=act1.sport, created_at=act1.created_at, duration_s=act1.duration, distance_m=act1.distance)
    fp2 = build_fingerprint(sport=act2.sport, created_at=act2.created_at, duration_s=act2.duration, distance_m=act2.distance)
    
    time_delta_seconds = abs((act1.created_at - act2.created_at).total_seconds()) if act1.created_at and act2.created_at else None
    duration_delta = abs((act1.duration or 0) - (act2.duration or 0))
    distance_delta = abs((act1.distance or 0) - (act2.distance or 0))
    
    is_indoor_pair = (act1.distance or 0) == 0 or (act2.distance or 0) == 0
    
    return {
        "are_duplicates": result,
        "activity_1": {
            "id": act1.id,
            "sport": act1.sport,
            "created_at": act1.created_at.isoformat() if act1.created_at else None,
            "duration": act1.duration,
            "distance": act1.distance,
            "fingerprint_v1": fp1,
            "meta_has_fingerprint": bool(meta1.get("fingerprint_v1")),
            "meta_has_file_sha256": bool(meta1.get("file_sha256")),
        },
        "activity_2": {
            "id": act2.id,
            "sport": act2.sport,
            "created_at": act2.created_at.isoformat() if act2.created_at else None,
            "duration": act2.duration,
            "distance": act2.distance,
            "fingerprint_v1": fp2,
            "meta_has_fingerprint": bool(meta2.get("fingerprint_v1")),
            "meta_has_file_sha256": bool(meta2.get("file_sha256")),
        },
        "comparison": {
            "time_delta_seconds": time_delta_seconds,
            "time_within_15min_window": time_delta_seconds is not None and time_delta_seconds <= 900,
            "duration_delta_seconds": duration_delta,
            "duration_threshold": 3600 if is_indoor_pair else 600,
            "duration_acceptable": duration_delta <= (3600 if is_indoor_pair else 600),
            "distance_delta_meters": distance_delta,
            "distance_threshold": float('inf') if is_indoor_pair else 500,
            "distance_acceptable": is_indoor_pair or distance_delta <= 500,
            "normalized_sports_match": normalize_sport(act1.sport) == normalize_sport(act2.sport),
            "is_indoor_pair": is_indoor_pair,
            "fingerprints_match": fp1 == fp2,
        },
    }


@router.post("/{activity_id1}/mark-as-duplicate-of/{activity_id2}", status_code=204)
async def mark_as_duplicate(
    activity_id1: int,
    activity_id2: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Manually mark one activity as a duplicate of another.
    activity_id1 will be marked as duplicate_of activity_id2.
    Use this if automatic duplicate detection fails.
    """
    act1 = await db.scalar(select(Activity).where(Activity.id == activity_id1))
    act2 = await db.scalar(select(Activity).where(Activity.id == activity_id2))
    
    if not act1:
        raise HTTPException(status_code=404, detail=f"Activity {activity_id1} not found")
    if not act2:
        raise HTTPException(status_code=404, detail=f"Activity {activity_id2} not found")
    
    if act1.athlete_id != current_user.id and current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail="Not authorized")
    if act2.athlete_id != current_user.id and current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    if act1.athlete_id != act2.athlete_id:
        raise HTTPException(status_code=400, detail="Activities must belong to the same athlete")
    
    if act1.id == act2.id:
        raise HTTPException(status_code=400, detail="Cannot mark an activity as a duplicate of itself")
    
    # If act2 is itself a duplicate, resolve to its primary
    if act2.duplicate_of_id:
        act2_primary = await db.get(Activity, act2.duplicate_of_id)
        if act2_primary:
            act2 = act2_primary
        else:
            raise HTTPException(status_code=400, detail="Could not resolve primary for second activity")
    
    # Mark act1 as duplicate of act2
    act1.duplicate_of_id = act2.id
    db.add(act1)
    await db.commit()


@router.get("/{activity_id}", response_model=ActivityDetail)
async def get_activity(
    activity_id: int,
    include_streams: bool = Query(True),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    response: Response = None,
):
    if response is not None:
        response.headers["Cache-Control"] = "private, max-age=300"
    result = await db.execute(select(Activity).where(Activity.id == activity_id))
    activity = result.scalars().first()

    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    if activity.athlete_id != current_user.id:
        if current_user.role != RoleEnum.coach:
            raise HTTPException(status_code=403, detail="Not authorized for this activity")

        access_stmt = select(OrganizationMember).where(
            OrganizationMember.user_id == activity.athlete_id,
            OrganizationMember.status == 'active',
            OrganizationMember.organization_id.in_(
                select(OrganizationMember.organization_id).where(
                    OrganizationMember.user_id == current_user.id,
                    OrganizationMember.role == RoleEnum.coach.value,
                    OrganizationMember.status == 'active'
                )
            )
        )
        access_res = await db.execute(access_stmt)
        if access_res.scalar_one_or_none() is None:
            raise HTTPException(status_code=403, detail="Not authorized for this activity")
         
    # Extract data from stored JSON structure
    # Stored as { "data": [...], "power_curve": ..., "hr_zones": ... }
    stored_data = activity.streams or {}
    
    # Backwards compatibility check if streams was just list
    streams_list = []
    power_curve = None
    hr_zones = None
    pace_curve = None
    best_efforts = None
    laps = None
    splits_metric = None
    stats = {}
    
    if isinstance(stored_data, list):
        streams_list = stored_data
    elif isinstance(stored_data, dict):
        stored_data, time_fields_changed = _normalize_activity_time_fields(stored_data)
        if time_fields_changed:
            activity.streams = stored_data
            try:
                await db.commit()
                await db.refresh(activity)
            except Exception:
                logger.warning(
                    "Failed to persist normalized time fields for activity %s",
                    activity.id,
                    exc_info=True,
                )
                await db.rollback()

        streams_list = stored_data.get("data", [])
        power_curve = stored_data.get("power_curve")
        hr_zones = stored_data.get("hr_zones")
        pace_curve = stored_data.get("pace_curve")
        best_efforts = stored_data.get("best_efforts")
        laps = stored_data.get("laps")
        splits_metric = stored_data.get("splits_metric")
        stats = stored_data.get("stats", {})

    # Lazy-load deep provider data on demand (enabled by default; set STRAVA_ALLOW_LAZY_DETAIL_FETCH=false to disable).
    allow_lazy_provider_detail_fetch = os.getenv("STRAVA_ALLOW_LAZY_DETAIL_FETCH", "true").lower() in {"1", "true", "yes", "on"}

    if isinstance(stored_data, dict):
        meta = stored_data.get("_meta") if isinstance(stored_data.get("_meta"), dict) else {}
        source_provider = meta.get("source_provider")
        source_activity_id = meta.get("source_activity_id")
        needs_streams = len(streams_list) == 0
        needs_laps = not laps
        needs_curves = not power_curve and not hr_zones and not pace_curve

        if (
            activity.file_type == "provider"
            and source_provider == "strava"
            and source_activity_id
            and (needs_streams or needs_laps or needs_curves)
            and allow_lazy_provider_detail_fetch
        ):
            try:
                access_token = await _resolve_provider_access_token(
                    db,
                    user_id=activity.athlete_id,
                    provider="strava",
                )
                if access_token:
                    connector = get_connector("strava")
                    if hasattr(connector, "fetch_activity_deep_data"):
                        detail_payload = await connector.fetch_activity_deep_data(
                            access_token=access_token,
                            activity_id=str(source_activity_id),
                            start_time=activity.created_at,
                        )

                        stored_data["data"] = detail_payload.get("data") or []
                        stored_data["power_curve"] = detail_payload.get("power_curve")
                        stored_data["hr_zones"] = detail_payload.get("hr_zones")
                        stored_data["pace_curve"] = detail_payload.get("pace_curve")
                        stored_data["laps"] = detail_payload.get("laps") or []
                        stored_data["splits_metric"] = detail_payload.get("splits_metric") or []
                        stored_data["stats"] = detail_payload.get("stats") or {}

                        provider_payload = stored_data.get("provider_payload") if isinstance(stored_data.get("provider_payload"), dict) else {}
                        provider_payload["detail"] = detail_payload.get("provider_activity_detail") or {}
                        stored_data["provider_payload"] = provider_payload

                        meta["enriched_at"] = datetime.utcnow().isoformat()
                        stored_data["_meta"] = meta

                        activity.streams = stored_data
                        await db.commit()
                        await db.refresh(activity)

                        streams_list = stored_data.get("data", [])
                        power_curve = stored_data.get("power_curve")
                        hr_zones = stored_data.get("hr_zones")
                        pace_curve = stored_data.get("pace_curve")
                        laps = stored_data.get("laps")
                        splits_metric = stored_data.get("splits_metric")
                        stats = stored_data.get("stats", {})
            except Exception:
                # Keep endpoint resilient: return summary even if deep-data fetch fails.
                pass

    profile = await db.scalar(select(Profile).where(Profile.user_id == activity.athlete_id))
    ftp_hist = await _get_metric_at_date(db, activity.athlete_id, "ftp", activity.created_at)
    weight_hist = await _get_metric_at_date(db, activity.athlete_id, "weight", activity.created_at)
    ftp = _safe_number(ftp_hist if ftp_hist is not None else getattr(profile, "ftp", None), default=0.0)
    ftp_at_time = ftp if ftp > 0 else None
    weight_at_time = weight_hist if weight_hist is not None else getattr(profile, "weight", None)
    max_hr = _safe_number(getattr(profile, "max_hr", None), default=190.0)
    aerobic_load, anaerobic_load = _activity_training_load(activity, ftp, max_hr, profile)

    matched_workout = await db.scalar(
        select(PlannedWorkout).where(
            PlannedWorkout.user_id == activity.athlete_id,
            PlannedWorkout.matched_activity_id == activity.id,
        )
    )
    planned_comparison = (
        _build_planned_comparison_payload(matched_workout, activity, splits_metric, laps, profile, stats)
        if matched_workout
        else None
    )
        
    legacy_rpe, legacy_notes, legacy_lactate = _activity_feedback_from_payload(stored_data)

    # Lazy-compute best_efforts for activities that pre-date the feature
    needs_persist = False
    try:
        if best_efforts is None and streams_list:
            best_efforts = compute_activity_best_efforts(streams_list, activity.sport or "")
            if best_efforts and isinstance(stored_data, dict):
                stored_data["best_efforts"] = best_efforts
                needs_persist = True
    except Exception:
        logger.warning("Failed to compute best_efforts for activity %s", activity.id, exc_info=True)

    # Lazy-compute splits_metric for provider activities that lack them
    try:
        if not splits_metric and streams_list:
            splits_metric = compute_metric_splits_from_points(streams_list)
            if splits_metric and isinstance(stored_data, dict):
                stored_data["splits_metric"] = splits_metric
                needs_persist = True
    except Exception:
        logger.warning("Failed to compute splits for activity %s", activity.id, exc_info=True)

    # Lazy-expand sparse power curves (e.g. Strava activities stored with only 8 windows)
    try:
        if power_curve is not None and len(power_curve) < 50 and streams_list:
            pv = [float(p["power"]) for p in streams_list if isinstance(p.get("power"), (int, float))]
            if pv:
                _pc_windows: dict[str, int] = {f'{s}s': s for s in range(1, 60)}
                _pc_windows.update({f'{m}min': m * 60 for m in range(1, 121)})
                _prefix = [0.0]
                for _v in pv:
                    _prefix.append(_prefix[-1] + _v)
                _n = len(pv)
                _pc: dict[str, int] = {}
                for _lbl, _w in _pc_windows.items():
                    if _n < _w:
                        _pc[_lbl] = 0
                    else:
                        _best = max((_prefix[i + _w] - _prefix[i]) / _w for i in range(_n - _w + 1))
                        _pc[_lbl] = int(_best)
                power_curve = _pc
                if isinstance(stored_data, dict):
                    stored_data["power_curve"] = power_curve
                    needs_persist = True
    except Exception:
        logger.warning("Failed to expand power curve for activity %s", activity.id, exc_info=True)

    if needs_persist and isinstance(stored_data, dict):
        try:
            activity.streams = stored_data
            await db.commit()
            await db.refresh(activity)
        except Exception:
            logger.warning("Failed to persist lazy-computed data for activity %s", activity.id, exc_info=True)
            await db.rollback()

    # Check which best efforts are all-time PRs
    try:
        pr_flags = await get_activity_prs(db, activity)
    except Exception:
        logger.warning("Failed to compute PRs for activity %s", activity.id, exc_info=True)
        pr_flags = {}

    # Build Strava "View on Strava" link (Strava Brand Guidelines §3)
    strava_activity_url = None
    if isinstance(stored_data, dict):
        _meta = stored_data.get("_meta") if isinstance(stored_data.get("_meta"), dict) else {}
        if _meta.get("source_provider") == "strava" and _meta.get("source_activity_id"):
            strava_activity_url = f"https://www.strava.com/activities/{_meta['source_activity_id']}"

    # Compute moving time (time athlete was actually moving, excluding pauses)
    moving_time: float | None = None
    # 1. FIT total_timer_time or Strava moving_time stored in stats
    if isinstance(stats, dict) and stats.get("total_timer_time"):
        moving_time = float(stats["total_timer_time"])
    # 2. Raw Strava moving_time from provider_payload (when stats.total_timer_time is missing)
    if moving_time is None and isinstance(stored_data, dict):
        pp = stored_data.get("provider_payload")
        if isinstance(pp, dict):
            raw_mt = (pp.get("detail") or {}).get("moving_time") or (pp.get("summary") or {}).get("moving_time")
            if raw_mt:
                moving_time = float(raw_mt)
    # 3. Compute from stream data (speed > 0.5 m/s threshold) as last resort
    if moving_time is None and streams_list and activity.duration and activity.duration > 0:
        total_pts = len(streams_list)
        if total_pts > 0:
            moving_pts = sum(
                1 for p in streams_list
                if isinstance(p, dict) and float(p.get("speed") or 0) > 0.5
            )
            if moving_pts > 0:
                secs_per_sample = activity.duration / total_pts
                moving_time = round(moving_pts * secs_per_sample)

    if not include_streams:
        streams_list = []

    activity_response = ActivityDetail(
        id=activity.id,
        athlete_id=activity.athlete_id,
        filename=activity.filename,
        created_at=activity.created_at,
        file_type=activity.file_type,
        sport=activity.sport,
        distance=activity.distance,
        duration=activity.duration,
        avg_speed=activity.avg_speed,
        average_hr=activity.average_hr,
        average_watts=activity.average_watts,
        streams=streams_list,
        power_curve=power_curve,
        hr_zones=hr_zones,
        pace_curve=pace_curve,
        best_efforts=best_efforts,
        personal_records=pr_flags if pr_flags else None,
        laps=laps,
        splits_metric=splits_metric,
        max_hr=stats.get("max_hr"),
        max_speed=stats.get("max_speed"),
        max_watts=stats.get("max_watts"),
        max_cadence=stats.get("max_cadence"),
        avg_cadence=stats.get("avg_cadence"),
        total_elevation_gain=stats.get("total_elevation_gain"),
        total_calories=stats.get("total_calories"),
        moving_time=moving_time,
        planned_comparison=planned_comparison,
        is_deleted=_is_activity_deleted(activity),
        aerobic_load=aerobic_load,
        anaerobic_load=anaerobic_load,
        total_load_impact=round(aerobic_load + anaerobic_load, 1),
        rpe=activity.rpe if activity.rpe is not None else legacy_rpe,
        lactate_mmol_l=legacy_lactate,
        notes=activity.notes if activity.notes is not None else legacy_notes,
        ftp_at_time=ftp_at_time,
        weight_at_time=weight_at_time,
        strava_activity_url=strava_activity_url,
    )
    return activity_response


@router.patch("/{activity_id}", response_model=ActivityDetail)
async def update_activity_feedback(
    activity_id: int,
    payload: ActivityUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Activity).where(Activity.id == activity_id))
    activity = result.scalars().first()

    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    if current_user.role == RoleEnum.coach:
        if activity.athlete_id != current_user.id:
            access_stmt = select(OrganizationMember).where(
                OrganizationMember.user_id == activity.athlete_id,
                OrganizationMember.status == 'active',
                OrganizationMember.organization_id.in_(
                    select(OrganizationMember.organization_id).where(
                        OrganizationMember.user_id == current_user.id,
                        OrganizationMember.role == RoleEnum.coach.value,
                        OrganizationMember.status == 'active'
                    )
                )
            )
            access_res = await db.execute(access_stmt)
            if access_res.scalar_one_or_none() is None:
                raise HTTPException(status_code=403, detail="Not authorized")
    else:
        if activity.athlete_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized")

    stored_data = _as_stream_payload(activity.streams)
    meta = stored_data.get("_meta") if isinstance(stored_data.get("_meta"), dict) else {}

    update_data = payload.model_dump(exclude_unset=True)
    if "rpe" in update_data:
        rpe_val = update_data.get("rpe")
        activity.rpe = rpe_val
        meta["rpe"] = rpe_val # Keep sync for now
    if "lactate_mmol_l" in update_data:
        meta["lactate_mmol_l"] = update_data.get("lactate_mmol_l")
    if "notes" in update_data:
        notes_val = update_data.get("notes")
        activity.notes = notes_val
        meta["notes"] = notes_val # Keep sync for now

    stored_data["_meta"] = meta

    split_annotations = update_data.get("split_annotations") or []
    if split_annotations:
        for annotation in split_annotations:
            split_type = annotation.get("split_type")
            split_index = annotation.get("split_index")
            if split_type not in ("metric", "laps"):
                continue
            key = "splits_metric" if split_type == "metric" else "laps"
            split_list = stored_data.get(key)
            if not isinstance(split_list, list):
                continue
            if split_index < 0 or split_index >= len(split_list):
                continue
            split_item = split_list[split_index]
            if not isinstance(split_item, dict):
                continue
            if "rpe" in annotation:
                split_item["rpe"] = annotation.get("rpe")
            if "lactate_mmol_l" in annotation:
                split_item["lactate_mmol_l"] = annotation.get("lactate_mmol_l")
            if "note" in annotation:
                split_item["note"] = annotation.get("note")
            split_list[split_index] = split_item
            stored_data[key] = split_list

    activity.streams = stored_data
    db.add(activity)
    await db.commit()
    await db.refresh(activity)

    return await get_activity(activity_id=activity.id, current_user=current_user, db=db)


@router.delete("/{activity_id}")
async def delete_activity(
    activity_id: int,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Activity).where(Activity.id == activity_id))
    activity = result.scalars().first()

    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    if current_user.role == RoleEnum.coach:
        if activity.athlete_id != current_user.id:
            access_stmt = select(OrganizationMember).where(
                OrganizationMember.user_id == activity.athlete_id,
                OrganizationMember.status == 'active',
                OrganizationMember.organization_id.in_(
                    select(OrganizationMember.organization_id).where(
                        OrganizationMember.user_id == current_user.id,
                        OrganizationMember.role == RoleEnum.coach.value,
                        OrganizationMember.status == 'active'
                    )
                )
            )
            access_res = await db.execute(access_stmt)
            if access_res.scalar_one_or_none() is None:
                raise HTTPException(status_code=403, detail="Not authorized")
    else:
        if activity.athlete_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized")
        # Skip permission gate when cleaning up duplicate recordings — the user owns the
        # activity and is just resolving system-detected duplicates.
        is_duplicate_cleanup = activity.duplicate_of_id is not None or bool(
            (await db.execute(
                select(Activity.id).where(Activity.duplicate_of_id == activity.id).limit(1)
            )).scalar_one_or_none()
        )
        if not is_duplicate_cleanup:
            athlete_permissions = await get_athlete_permissions(db, current_user.id)
            if not athlete_permissions.get('allow_delete_activities', True):
                raise HTTPException(status_code=403, detail="Coach has not allowed activity deletion")

    activity_date = activity.created_at.date()
    athlete_id = activity.athlete_id

    # If this is a primary activity, promote its duplicate recordings to standalone
    if activity.duplicate_of_id is None:
        dupes_res = await db.execute(
            select(Activity).where(Activity.duplicate_of_id == activity.id)
        )
        for dup in dupes_res.scalars().all():
            dup.duplicate_of_id = None
            db.add(dup)

    payload = _as_stream_payload(activity.streams)
    meta = payload.get("_meta") if isinstance(payload.get("_meta"), dict) else {}
    meta.update({
        "deleted": True,
        "deleted_at": datetime.utcnow().isoformat(),
        "deleted_by": current_user.id
    })
    payload["_meta"] = meta
    activity.streams = payload
    activity.is_deleted = True
    db.add(activity)
    await db.commit()

    # Run compliance re-scoring in the background so the DELETE response returns
    # immediately after the commit.
    _invalidate_athlete_caches(athlete_id)
    background_tasks.add_task(_bg_match_and_score, athlete_id, activity_date)

    return {"status": "success", "is_deleted": True}
