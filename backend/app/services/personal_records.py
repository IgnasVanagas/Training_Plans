"""Personal Records and Best Efforts computation service."""

from __future__ import annotations

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

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
# Cycling: power-based time windows (matching Strava's set)
# ---------------------------------------------------------------------------
CYCLING_EFFORT_WINDOWS = {
    "5s": 5, "15s": 15, "30s": 30,
    "1min": 60, "2min": 120, "3min": 180,
    "5min": 300, "8min": 480, "10min": 600,
    "15min": 900, "20min": 1200, "30min": 1800,
    "45min": 2700, "60min": 3600,
}

# ---------------------------------------------------------------------------
# Running: standard distance best-efforts
# ---------------------------------------------------------------------------
RUNNING_DISTANCES = {
    "400m": 400, "800m": 800, "1km": 1000, "1mi": 1609,
    "5km": 5000, "10km": 10000, "15km": 15000,
    "Half Marathon": 21097, "Marathon": 42195,
}


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
    db: AsyncSession, athlete_id: int, sport: str
) -> dict:
    # Only extract the JSONB sub-keys needed (best_efforts, power_curve) —
    # avoids loading the multi-MB streams.data array into Python memory.
    stmt = (
        select(
            Activity.id,
            Activity.created_at,
            Activity.streams['best_efforts'].label('best_efforts'),
            Activity.streams['power_curve'].label('power_curve'),
        )
        .where(and_(Activity.athlete_id == athlete_id, Activity.sport == sport))
    )
    result = await db.execute(stmt)
    rows = result.all()

    if sport == "cycling":
        return {"sport": "cycling", "power": _agg_cycling_prs_rows(rows)}
    elif sport == "running":
        return {"sport": "running", "best_efforts": _agg_running_prs_rows(rows)}
    return {"sport": sport}


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


def _pr_entry_row(value, activity_id: int, created_at) -> dict:
    return {
        "value": value,
        "activity_id": activity_id,
        "date": created_at.isoformat() if created_at else None,
    }


def _agg_cycling_prs_rows(rows: list) -> dict:
    """Lightweight version that works with (id, created_at, best_efforts, power_curve) rows."""
    all_vals: dict = {}
    for activity_id, created_at, best_efforts, power_curve in rows:
        if isinstance(best_efforts, list):
            for e in best_efforts:
                w = e.get("window") if isinstance(e, dict) else None
                v = e.get("power", 0) if isinstance(e, dict) else 0
                if w and v and v > 0:
                    all_vals.setdefault(w, []).append(_pr_entry_row(v, activity_id, created_at))
        elif isinstance(power_curve, dict):
            for w, v in power_curve.items():
                if v and v > 0:
                    all_vals.setdefault(w, []).append(_pr_entry_row(v, activity_id, created_at))
    bests: dict = {}
    for w, entries in all_vals.items():
        entries.sort(key=lambda x: x["value"], reverse=True)
        bests[w] = entries[:3]
    return bests


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
                all_vals.setdefault(d, []).append(_pr_entry_row(v, activity_id, created_at))
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
