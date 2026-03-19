"""Personal Records and Best Efforts computation service."""

from __future__ import annotations

import os

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Activity


def _safe_float(value, default: float = 0.0) -> float:
    """Convert a value to float, returning *default* on failure."""
    if value is None:
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        return default


# ---------------------------------------------------------------------------
# Cycling: power-based time windows (1s to 60min matching Strava's set)
# ---------------------------------------------------------------------------
CYCLING_EFFORT_WINDOWS = {
    "1s": 1, "5s": 5, "15s": 15, "30s": 30,
    "1min": 60, "2min": 120, "3min": 180, "5min": 300,
    "8min": 480, "10min": 600, "15min": 900, "20min": 1200,
    "30min": 1800, "45min": 2700, "60min": 3600,
}

# ---------------------------------------------------------------------------
# Running: standard distance best-efforts (400m to 100 miles)
# ---------------------------------------------------------------------------
RUNNING_DISTANCES = {
    "400m": 400, "800m": 800, "1km": 1000, "1mi": 1609, "1.5mi": 2414,
    "2km": 2000, "5km": 5000, "5mi": 8047, "10km": 10000, "10mi": 16094,
    "15km": 15000, "Half Marathon": 21097, "20mi": 32187,
    "Marathon": 42195, "50km": 50000, "50mi": 80467, "100km": 100000, "100mi": 160934,
}


SUPPORTED_PR_SPORTS = {"running", "cycling"}


def normalize_pr_sport(sport: str | None) -> str:
    raw = (sport or "").strip().lower()
    if not raw:
        return "other"
    if "run" in raw:
        return "running"
    if "cycl" in raw or "bike" in raw or "ride" in raw:
        return "cycling"
    return raw


def _sport_matches(raw_sport: str | None, target_sport: str) -> bool:
    return normalize_pr_sport(raw_sport) == target_sport


def _has_best_efforts(best_efforts: object) -> bool:
    return isinstance(best_efforts, list) and len(best_efforts) > 0


def _cycling_efforts_from_power_curve(power_curve: object) -> list[dict] | None:
    if not isinstance(power_curve, dict):
        return None

    efforts: list[dict] = []
    for window, seconds in CYCLING_EFFORT_WINDOWS.items():
        power = _safe_float(power_curve.get(window), default=0.0)
        if power <= 0:
            continue
        efforts.append(
            {
                "window": window,
                "seconds": seconds,
                "power": round(power),
                "avg_hr": None,
                "elevation": 0,
            }
        )

    return efforts if efforts else None


# ===================================================================
# Per-activity best-effort computation
# ===================================================================
def compute_activity_best_efforts(
    stream_points: list, sport: str
) -> list[dict] | None:
    """Compute best efforts for a single activity from 1-Hz stream data.

    Returns a list of effort dicts ready to be stored in ``streams.best_efforts``.
    """
    if not stream_points or len(stream_points) < 2:
        return None
    sport_lower = (sport or "").lower()
    if "cycl" in sport_lower or "bike" in sport_lower or "ride" in sport_lower:
        return _cycling_best_efforts(stream_points)
    if "run" in sport_lower:
        return _running_best_efforts(stream_points)
    return None


# ------- cycling (power-based windows) --------------------------------
def _cycling_best_efforts(points: list) -> list[dict] | None:
    n = len(points)
    powers = [_safe_float(p.get("power")) for p in points]
    hrs = [_safe_float(p.get("heart_rate")) for p in points]
    alts = [_safe_float(p.get("altitude")) for p in points]

    # prefix sums
    psum_pow = [0.0] * (n + 1)
    psum_hr = [0.0] * (n + 1)
    for i in range(n):
        psum_pow[i + 1] = psum_pow[i] + powers[i]
        psum_hr[i + 1] = psum_hr[i] + hrs[i]

    efforts: list[dict] = []
    for label, seconds in CYCLING_EFFORT_WINDOWS.items():
        if n < seconds:
            continue

        best_avg = -1.0
        best_start = 0
        for i in range(n - seconds + 1):
            avg = (psum_pow[i + seconds] - psum_pow[i]) / seconds
            if avg > best_avg:
                best_avg = avg
                best_start = i

        if best_avg <= 0:
            continue

        end = best_start + seconds
        avg_hr = (psum_hr[end] - psum_hr[best_start]) / seconds

        elev_gain = 0.0
        for j in range(best_start + 1, min(end, n)):
            diff = alts[j] - alts[j - 1]
            if diff > 0:
                elev_gain += diff

        efforts.append({
            "window": label,
            "seconds": seconds,
            "power": round(best_avg),
            "avg_hr": round(avg_hr) if avg_hr > 0 else None,
            "elevation": round(elev_gain),
        })

    return efforts if efforts else None


# ------- running (distance-based efforts) -----------------------------
def _running_best_efforts(points: list) -> list[dict] | None:
    n = len(points)
    hrs = [_safe_float(p.get("heart_rate")) for p in points]
    alts = [_safe_float(p.get("altitude")) for p in points]

    # build cumulative-distance array, forward-fill gaps
    raw_dist: list[float | None] = []
    for p in points:
        d = p.get("distance")
        raw_dist.append(float(d) if d is not None else None)
    distances = _ffill(raw_dist)
    if not distances or len(distances) < 2:
        return None

    total_dist = distances[-1] - distances[0]

    psum_hr = [0.0] * (n + 1)
    for i in range(n):
        psum_hr[i + 1] = psum_hr[i] + hrs[i]

    efforts: list[dict] = []
    for label, target_m in RUNNING_DISTANCES.items():
        if total_dist < target_m:
            continue

        best_time: float | None = None
        best_i = 0
        best_j = 0
        j = 0
        for i in range(n):
            while j < n and (distances[j] - distances[i]) < target_m:
                j += 1
            if j < n:
                elapsed = float(j - i)
                if best_time is None or elapsed < best_time:
                    best_time = elapsed
                    best_i = i
                    best_j = j

        if best_time is None or best_time <= 0:
            continue

        span = best_j - best_i if best_j > best_i else 1
        avg_hr = (psum_hr[best_j + 1] - psum_hr[best_i]) / (span + 1)

        elev_gain = 0.0
        for k in range(best_i + 1, min(best_j + 1, n)):
            diff = alts[k] - alts[k - 1]
            if diff > 0:
                elev_gain += diff

        efforts.append({
            "distance": label,
            "meters": target_m,
            "time_seconds": best_time,
            "avg_hr": round(avg_hr) if avg_hr > 0 else None,
            "elevation": round(elev_gain),
        })

    return efforts if efforts else None


def _ffill(vals: list[float | None]) -> list[float]:
    """Forward-fill None values, default to 0."""
    out: list[float] = []
    last = 0.0
    for v in vals:
        if v is not None:
            last = v
        out.append(last)
    return out


# ===================================================================
# Aggregate PRs across all activities for an athlete + sport
# ===================================================================
async def get_personal_records(
    db: AsyncSession,
    athlete_id: int,
    sport: str,
    *,
    auto_backfill: bool = False,
    backfill_batch_size: int | None = None,
) -> dict:
    target_sport = normalize_pr_sport(sport)
    if target_sport not in SUPPORTED_PR_SPORTS:
        return {
            "sport": sport,
            "has_activities_for_sport": False,
            "missing_best_efforts_count": 0,
            "backfill_status": "ready",
            "backfill_updated_count": 0,
            "records_source": "none",
        }

    # Only extract the JSONB sub-keys needed (best_efforts, power_curve)
    # to avoid loading the large streams.data arrays.
    stmt = (
        select(
            Activity.id,
            Activity.created_at,
            Activity.sport,
            Activity.streams['best_efforts'].label('best_efforts'),
            Activity.streams['power_curve'].label('power_curve'),
        )
        .where(Activity.athlete_id == athlete_id)
    )
    rows = (await db.execute(stmt)).all()
    sport_rows = [
        (activity_id, created_at, best_efforts, power_curve)
        for activity_id, created_at, raw_sport, best_efforts, power_curve in rows
        if _sport_matches(raw_sport, target_sport)
    ]

    has_activities = len(sport_rows) > 0
    missing_best_efforts_count = sum(1 for _, _, best_efforts, _ in sport_rows if not _has_best_efforts(best_efforts))
    backfill_updated_count = 0

    if target_sport == "cycling":
        records, used_fallback = _agg_cycling_prs_rows(sport_rows)
    else:
        records = _agg_running_prs_rows(sport_rows)
        used_fallback = False

    records_empty = len(records) == 0

    if auto_backfill and has_activities and records_empty and missing_best_efforts_count > 0:
        configured_batch = max(1, int(os.getenv("PERSONAL_RECORDS_BACKFILL_BATCH_SIZE", "150")))
        batch_size = configured_batch if backfill_batch_size is None else max(1, backfill_batch_size)
        backfill_result = await backfill_missing_best_efforts(
            db,
            athlete_id=athlete_id,
            sport=target_sport,
            limit=batch_size,
        )
        backfill_updated_count = int(backfill_result.get("updated", 0) or 0)

        rows = (await db.execute(stmt)).all()
        sport_rows = [
            (activity_id, created_at, best_efforts, power_curve)
            for activity_id, created_at, raw_sport, best_efforts, power_curve in rows
            if _sport_matches(raw_sport, target_sport)
        ]
        missing_best_efforts_count = sum(1 for _, _, best_efforts, _ in sport_rows if not _has_best_efforts(best_efforts))

        if target_sport == "cycling":
            records, used_fallback = _agg_cycling_prs_rows(sport_rows)
        else:
            records = _agg_running_prs_rows(sport_rows)
            used_fallback = False
        records_empty = len(records) == 0

    backfill_status = (
        "processing"
        if has_activities and records_empty and missing_best_efforts_count > 0 and backfill_updated_count > 0
        else "ready"
    )
    records_source = "power_curve_fallback" if used_fallback else "best_efforts"

    if target_sport == "cycling":
        return {
            "sport": "cycling",
            "power": records,
            "has_activities_for_sport": has_activities,
            "missing_best_efforts_count": missing_best_efforts_count,
            "backfill_status": backfill_status,
            "backfill_updated_count": backfill_updated_count,
            "records_source": records_source,
        }

    return {
        "sport": "running",
        "best_efforts": records,
        "has_activities_for_sport": has_activities,
        "missing_best_efforts_count": missing_best_efforts_count,
        "backfill_status": backfill_status,
        "backfill_updated_count": backfill_updated_count,
        "records_source": records_source,
    }


async def backfill_missing_best_efforts(
    db: AsyncSession,
    *,
    athlete_id: int | None = None,
    sport: str | None = None,
    limit: int = 200,
) -> dict[str, int]:
    target_sport = normalize_pr_sport(sport) if sport else None
    if target_sport is not None and target_sport not in SUPPORTED_PR_SPORTS:
        return {
            "updated": 0,
            "missing": 0,
            "remaining_missing": 0,
        }

    batch_limit = max(1, int(limit))

    stmt = select(Activity).where(Activity.streams.is_not(None)).order_by(Activity.created_at.desc())
    if athlete_id is not None:
        stmt = stmt.where(Activity.athlete_id == athlete_id)

    activities = list((await db.execute(stmt)).scalars().all())

    updated = 0
    missing = 0
    for activity in activities:
        normalized_sport = normalize_pr_sport(activity.sport)
        if normalized_sport not in SUPPORTED_PR_SPORTS:
            continue
        if target_sport is not None and normalized_sport != target_sport:
            continue

        streams = activity.streams if isinstance(activity.streams, dict) else {}
        best_efforts = streams.get("best_efforts")
        if _has_best_efforts(best_efforts):
            continue

        missing += 1
        if updated >= batch_limit:
            continue

        stream_points = streams.get("data") if isinstance(streams.get("data"), list) else []
        computed = compute_activity_best_efforts(stream_points, activity.sport or "")
        if not computed and normalized_sport == "cycling":
            computed = _cycling_efforts_from_power_curve(streams.get("power_curve"))
        if not computed:
            continue

        next_streams = dict(streams)
        next_streams["best_efforts"] = computed
        activity.streams = next_streams
        db.add(activity)
        updated += 1

    if updated > 0:
        await db.commit()

    return {
        "updated": updated,
        "missing": missing,
        "remaining_missing": max(0, missing - updated),
    }


def _agg_cycling_prs(activities: list) -> dict:
    """``{window: [{value, activity_id, date}, ...]}`` -- top 3 power per window."""
    all_vals: dict = {}
    for act in activities:
        efforts = _stored_efforts(act)
        if efforts:
            for e in efforts:
                w = e.get("window")
                v = e.get("power", 0)
                if w and v and v > 0:
                    all_vals.setdefault(w, []).append(_pr_entry(v, act))
        else:
            pc = _streams_key(act, "power_curve")
            if isinstance(pc, dict):
                for w, v in pc.items():
                    if v and v > 0:
                        all_vals.setdefault(w, []).append(_pr_entry(v, act))
    # keep top 3 per window (highest power)
    bests: dict = {}
    for w, entries in all_vals.items():
        entries.sort(key=lambda x: x["value"], reverse=True)
        bests[w] = entries[:3]
    return bests


def _pr_entry_row(value, activity_id: int, created_at, *, avg_hr=None) -> dict:
    entry = {
        "value": value,
        "activity_id": activity_id,
        "date": created_at.isoformat() if created_at else None,
    }
    if avg_hr is not None:
        entry["avg_hr"] = round(float(avg_hr))
    return entry


def _agg_cycling_prs_rows(rows: list) -> tuple[dict, bool]:
    """Lightweight version that works with (id, created_at, best_efforts, power_curve) rows."""
    all_vals: dict = {}
    used_fallback = False
    for activity_id, created_at, best_efforts, power_curve in rows:
        if isinstance(best_efforts, list):
            for e in best_efforts:
                w = e.get("window") if isinstance(e, dict) else None
                v = e.get("power", 0) if isinstance(e, dict) else 0
                if w and v and v > 0:
                    avg_hr = e.get("avg_hr") if isinstance(e, dict) else None
                    all_vals.setdefault(w, []).append(_pr_entry_row(v, activity_id, created_at, avg_hr=avg_hr))
        elif isinstance(power_curve, dict):
            used_fallback = True
            for w, v in power_curve.items():
                if v and v > 0:
                    all_vals.setdefault(w, []).append(_pr_entry_row(v, activity_id, created_at))
    bests: dict = {}
    for w, entries in all_vals.items():
        entries.sort(key=lambda x: x["value"], reverse=True)
        bests[w] = entries[:3]
    return bests, used_fallback


def _agg_running_prs(activities: list) -> dict:
    """``{distance: [{value, activity_id, date}, ...]}`` -- top 3 times per distance."""
    all_vals: dict = {}
    for act in activities:
        efforts = _stored_efforts(act)
        if not efforts:
            continue
        for e in efforts:
            d = e.get("distance")
            v = e.get("time_seconds", 0)
            if d and v and v > 0:
                all_vals.setdefault(d, []).append(_pr_entry(v, act))
    # keep top 3 per distance (lowest time)
    bests: dict = {}
    for d, entries in all_vals.items():
        entries.sort(key=lambda x: x["value"])
        bests[d] = entries[:3]
    return bests


def _agg_running_prs_rows(rows: list) -> dict:
    """Lightweight version that works with (id, created_at, best_efforts, power_curve) rows."""
    all_vals: dict = {}
    for activity_id, created_at, best_efforts, _power_curve in rows:
        if not isinstance(best_efforts, list):
            continue
        for e in best_efforts:
            if not isinstance(e, dict):
                continue
            d = e.get("distance")
            v = e.get("time_seconds", 0)
            if d and v and v > 0:
                avg_hr = e.get("avg_hr")
                all_vals.setdefault(d, []).append(_pr_entry_row(v, activity_id, created_at, avg_hr=avg_hr))
    bests: dict = {}
    for d, entries in all_vals.items():
        entries.sort(key=lambda x: x["value"])
        bests[d] = entries[:3]
    return bests


# ===================================================================
# Activity-level PR flags  (which efforts in *this* activity are PRs)
# ===================================================================
async def get_activity_prs(
    db: AsyncSession, activity: Activity
) -> dict[str, int]:
    """Return ``{effort_key: rank}`` where rank is 1 (PR), 2, or 3."""
    sport = (activity.sport or "").lower()
    if sport not in ("cycling", "running"):
        return {}

    all_prs = await get_personal_records(db, activity.athlete_id, sport)
    flags: dict[str, int] = {}

    if sport == "cycling":
        for w, entries in all_prs.get("power", {}).items():
            for rank, info in enumerate(entries, 1):
                if info.get("activity_id") == activity.id:
                    flags[w] = rank
                    break
    elif sport == "running":
        for d, entries in all_prs.get("best_efforts", {}).items():
            for rank, info in enumerate(entries, 1):
                if info.get("activity_id") == activity.id:
                    flags[d] = rank
                    break

    return flags


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------
def _pr_entry(value, act: Activity) -> dict:
    return {
        "value": value,
        "activity_id": act.id,
        "date": act.created_at.isoformat() if act.created_at else None,
    }


def _stored_efforts(act: Activity) -> list | None:
    s = act.streams
    if isinstance(s, dict):
        be = s.get("best_efforts")
        return be if isinstance(be, list) else None
    return None


def _streams_key(act: Activity, key: str):
    s = act.streams
    if isinstance(s, dict):
        return s.get(key)
    return None
