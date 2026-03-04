from __future__ import annotations

from datetime import date, datetime, timedelta
from math import exp
from typing import Any

from sqlalchemy import and_, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PlannedWorkout, Activity, ComplianceStatusEnum, Profile, RHRDaily


def _is_activity_deleted(activity: Activity) -> bool:
    streams = activity.streams
    if isinstance(streams, dict):
        meta = streams.get("_meta")
        if isinstance(meta, dict):
            return bool(meta.get("deleted"))
    return False


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
        if parsed != parsed:
            return default
        return parsed
    except (TypeError, ValueError):
        return default


def _extract_stream_payload(activity: Activity) -> dict[str, Any]:
    return activity.streams if isinstance(activity.streams, dict) else {}


def _activity_date_candidates(activity: Activity) -> set[date]:
    candidates: set[date] = set()

    created_at = getattr(activity, "created_at", None)
    if isinstance(created_at, datetime):
        candidates.add(created_at.date())

    payload = _extract_stream_payload(activity)
    provider_payload = payload.get("provider_payload") if isinstance(payload.get("provider_payload"), dict) else {}
    summary = provider_payload.get("summary") if isinstance(provider_payload.get("summary"), dict) else {}
    detail = provider_payload.get("detail") if isinstance(provider_payload.get("detail"), dict) else {}

    for source in (summary, detail):
        for key in ("start_date_local", "start_date"):
            raw_value = source.get(key)
            if not isinstance(raw_value, str):
                continue
            text = raw_value.strip()
            if not text:
                continue

            try:
                parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
                candidates.add(parsed.date())
                continue
            except ValueError:
                pass

            try:
                candidates.add(date.fromisoformat(text[:10]))
            except ValueError:
                pass

    return candidates


def _resolve_effective_resting_hr(profile: Profile | None, lowest_recorded_rhr: float | None) -> float:
    profile_rhr = _safe_float(getattr(profile, "resting_hr", None), default=0.0)
    recorded = _safe_float(lowest_recorded_rhr, default=0.0)
    values = [value for value in (profile_rhr, recorded) if value > 0]
    if not values:
        return 60.0
    return min(values)


def _hrr_zone_bounds(max_hr: float, resting_hr: float) -> list[float]:
    if max_hr <= 0:
        return []
    floor_rest = max(30.0, min(resting_hr, max_hr - 1.0))
    reserve = max_hr - floor_rest
    if reserve <= 0:
        return [max_hr * 0.60, max_hr * 0.70, max_hr * 0.80, max_hr * 0.90]
    return [
        floor_rest + reserve * 0.60,
        floor_rest + reserve * 0.70,
        floor_rest + reserve * 0.80,
        floor_rest + reserve * 0.90,
    ]


def _zone_from_workout(workout: PlannedWorkout) -> int | None:
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
            target = node.get("target") if isinstance(node.get("target"), dict) else {}
            zone_raw = target.get("zone")
            zone_value = int(_safe_float(zone_raw, default=0.0))
            if zone_value > 0:
                zones.append(zone_value)

    walk(structure)
    if zones:
        counts: dict[int, int] = {}
        for zone in zones:
            counts[zone] = counts.get(zone, 0) + 1
        return sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))[0][0]

    token = str(workout.planned_intensity or "").lower().strip()
    if not token:
        return None
    for marker in ("zone", "z"):
        if marker in token:
            digits = "".join(ch for ch in token if ch.isdigit())
            if digits:
                zone = int(digits)
                if zone > 0:
                    return zone
    return None


def _compute_normalized_power_watts(activity: Activity) -> float | None:
    payload = _extract_stream_payload(activity)
    stats = payload.get("stats") if isinstance(payload.get("stats"), dict) else {}
    direct = _safe_float(stats.get("normalized_power"), default=0.0)
    if direct > 0:
        return direct

    curve = payload.get("power_curve") if isinstance(payload.get("power_curve"), dict) else {}
    curve_np = _safe_float(curve.get("normalized_power"), default=0.0)
    if curve_np > 0:
        return curve_np

    data_points = payload.get("data") if isinstance(payload.get("data"), list) else []
    power_samples = [
        _safe_float(point.get("power"), default=-1.0)
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
    np_value = mean_fourth ** 0.25
    return np_value if np_value > 0 else None


def _range_score(value: float | None, low: float, high: float, soft_tolerance: float, hard_tolerance: float) -> float | None:
    if value is None:
        return None
    if low <= value <= high:
        return 1.0

    distance = min(abs(value - low), abs(value - high))
    if distance <= soft_tolerance:
        return 0.72
    if distance <= hard_tolerance:
        return 0.45
    return 0.15


def _cycling_intensity_score(activity: Activity, zone: int, profile: Profile | None) -> float | None:
    ftp = _safe_float(getattr(profile, "ftp", None), default=0.0)
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
    bounded_zone = max(1, min(len(zone_bounds), zone))
    low_pct, high_pct = zone_bounds[bounded_zone - 1]

    avg_power = _safe_float(activity.average_watts, default=0.0)
    avg_pct = (avg_power / ftp) * 100.0 if avg_power > 0 else None

    np_watts = _compute_normalized_power_watts(activity)
    np_pct = (np_watts / ftp) * 100.0 if np_watts and np_watts > 0 else None

    payload = _extract_stream_payload(activity)
    stats = payload.get("stats") if isinstance(payload.get("stats"), dict) else {}
    max_watts = _safe_float(stats.get("max_watts"), default=0.0)
    if max_watts <= 0:
        max_watts = _safe_float(activity.average_watts, default=0.0)
    max_pct = (max_watts / ftp) * 100.0 if max_watts > 0 else None

    avg_score = _range_score(avg_pct, low_pct, high_pct, soft_tolerance=7.0, hard_tolerance=15.0)
    np_score = _range_score(np_pct, low_pct, high_pct, soft_tolerance=8.0, hard_tolerance=16.0)

    max_score: float | None = None
    if max_pct is not None:
        soft_cap = high_pct + 20.0
        hard_cap = high_pct + 40.0
        if max_pct <= soft_cap:
            max_score = 1.0
        elif max_pct <= hard_cap:
            max_score = 0.62
        else:
            max_score = 0.20

    components: list[tuple[float, float | None]] = [(0.35, avg_score), (0.45, np_score), (0.20, max_score)]
    weighted = 0.0
    total_weight = 0.0
    for weight, score in components:
        if score is None:
            continue
        weighted += weight * score
        total_weight += weight
    if total_weight <= 0:
        return None
    return weighted / total_weight


def _running_intensity_score(
    activity: Activity,
    zone: int,
    profile: Profile | None,
    lowest_recorded_rhr: float | None,
) -> float | None:
    bounded_zone = max(1, min(7, zone))

    lt2_pace_min_per_km = _safe_float(getattr(profile, "lt2", None), default=0.0)
    avg_speed = _safe_float(activity.avg_speed, default=0.0)
    avg_pace_min_per_km = (1000.0 / (avg_speed * 60.0)) if avg_speed > 0 else None

    pace_score: float | None = None
    if lt2_pace_min_per_km > 0 and avg_pace_min_per_km is not None:
        pace_ranges: list[tuple[float, float]] = [
            (135.0, 120.0),
            (120.0, 110.0),
            (110.0, 103.0),
            (103.0, 97.0),
            (97.0, 90.0),
            (90.0, 84.0),
            (84.0, 75.0),
        ]
        slow_pct, fast_pct = pace_ranges[bounded_zone - 1]
        low = lt2_pace_min_per_km * (fast_pct / 100.0)
        high = lt2_pace_min_per_km * (slow_pct / 100.0)
        pace_score = _range_score(avg_pace_min_per_km, low, high, soft_tolerance=0.20, hard_tolerance=0.45)

    max_hr = _safe_float(getattr(profile, "max_hr", None), default=0.0)
    resting_hr = _resolve_effective_resting_hr(profile, lowest_recorded_rhr)
    hr_score: float | None = None
    max_hr_score: float | None = None

    if max_hr > 0:
        hr_zone_idx = max(1, min(5, bounded_zone))
        hr_bounds = _hrr_zone_bounds(max_hr, resting_hr)
        low_hr = resting_hr if hr_zone_idx == 1 else hr_bounds[hr_zone_idx - 2]
        high_hr = hr_bounds[hr_zone_idx - 1] if hr_zone_idx <= 4 else max_hr

        avg_hr = _safe_float(activity.average_hr, default=0.0)
        hr_score = _range_score(avg_hr if avg_hr > 0 else None, low_hr, high_hr, soft_tolerance=5.0, hard_tolerance=10.0)

        payload = _extract_stream_payload(activity)
        stats = payload.get("stats") if isinstance(payload.get("stats"), dict) else {}
        max_hr_actual = _safe_float(stats.get("max_hr"), default=0.0)
        if max_hr_actual <= 0:
            max_hr_actual = avg_hr
        if max_hr_actual > 0:
            soft_cap = high_hr + 8.0
            hard_cap = high_hr + 18.0
            if max_hr_actual <= soft_cap:
                max_hr_score = 1.0
            elif max_hr_actual <= hard_cap:
                max_hr_score = 0.62
            else:
                max_hr_score = 0.20

    components: list[tuple[float, float | None]] = [
        (0.55, pace_score),
        (0.30, hr_score),
        (0.15, max_hr_score),
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
    return weighted / total_weight


def _compliance_status_for_match(
    workout: PlannedWorkout,
    activity: Activity,
    profile: Profile | None,
    lowest_recorded_rhr: float | None,
) -> ComplianceStatusEnum:
    planned_dur = _safe_float(workout.planned_duration, default=0.0)
    actual_dur = _safe_float(activity.duration, default=0.0) / 60.0

    if planned_dur > 0:
        duration_rel_error = abs(planned_dur - actual_dur) / planned_dur
        duration_score = exp(-3.0 * duration_rel_error)
    else:
        duration_rel_error = 0.0
        duration_score = 1.0

    workout_sport = _normalize_sport(workout.sport_type)
    zone = _zone_from_workout(workout)
    intensity_score: float | None = None

    if zone is not None:
        if workout_sport == "cycling":
            intensity_score = _cycling_intensity_score(activity, zone, profile)
        elif workout_sport == "running":
            intensity_score = _running_intensity_score(activity, zone, profile, lowest_recorded_rhr)

    overall_score = duration_score if intensity_score is None else (duration_score * 0.45 + intensity_score * 0.55)

    if duration_rel_error > 0.60:
        return ComplianceStatusEnum.completed_red

    if overall_score >= 0.78:
        return ComplianceStatusEnum.completed_green
    if overall_score >= 0.58:
        return ComplianceStatusEnum.completed_yellow
    return ComplianceStatusEnum.completed_red

async def match_and_score(db: AsyncSession, user_id: int, target_date: date):
    """
    Matches PlannedWorkouts with Activities for a given user and date.
    Updates compliance status based on duration deviation.
    """
    
    # 1. Fetch Planned Workouts for the date
    # Note: DB queries are async
    stmt_workouts = select(PlannedWorkout).where(
        and_(
            PlannedWorkout.user_id == user_id,
            PlannedWorkout.date == target_date
        )
    )
    result_workouts = await db.execute(stmt_workouts)
    planned_workouts = result_workouts.scalars().all()
    
    if not planned_workouts:
        return

    # Future workouts must never auto-match against historical activities.
    # They stay in planned state until their calendar date is reached.
    if target_date > date.today():
        for workout in planned_workouts:
            workout.matched_activity_id = None
            workout.compliance_status = ComplianceStatusEnum.planned
            db.add(workout)
        await db.commit()
        return

    # 2. Fetch Activities for exactly that day (00:00 to 23:59 local time if possible, but simplest is date matches).
    # NOTE: The user explicitly requested strict same-day comparison.
    # Previous window `target_date +/- 1 day` is too broad for this requirement.
    # Use exact date match on created_at.
    
    start_of_day = datetime.combine(target_date, datetime.min.time())
    end_of_day = datetime.combine(target_date, datetime.max.time())
    
    stmt_activities = select(Activity).where(
        and_(
            Activity.athlete_id == user_id,
            Activity.created_at >= start_of_day,
            Activity.created_at <= end_of_day
        )
    )

    # User requirement: Only compare planned workout to activities created on the EXACT same day.
    # The start/end window is now tight to target_date.
    
    result_activities = await db.execute(stmt_activities)
    activities = [
        activity
        for activity in result_activities.scalars().all()
        if not _is_activity_deleted(activity)
    ]


    profile = await db.scalar(select(Profile).where(Profile.user_id == user_id))
    lowest_recorded_rhr = await db.scalar(
        select(func.min(RHRDaily.resting_hr)).where(RHRDaily.user_id == user_id)
    )
    

    # 3. Sophisticated matching logic (one-to-one assignment by highest similarity score)
    # Reset all existing matches for this day first to ensure we find the GLOBAL BEST configuration
    for workout in planned_workouts:
        workout.matched_activity_id = None
        # Default fallback status
        if target_date < date.today():
             workout.compliance_status = ComplianceStatusEnum.missed
        else:
             workout.compliance_status = ComplianceStatusEnum.planned

    unmatched_pairs: list[tuple[float, PlannedWorkout, Activity]] = []
    for workout in planned_workouts:
        for activity in activities:
            score = _similarity_score(workout, activity)
            # Avoid low-confidence accidental matches.
            if score >= 0.45:
                # Add unique identifier to ensure we can sort consistently
                unmatched_pairs.append((score, workout, activity))

    # Sort pairs by highest score first to prioritize "best fit"
    unmatched_pairs.sort(key=lambda item: item[0], reverse=True)

    assigned_workout_ids: set[int] = set()
    assigned_activity_ids: set[int] = set()
    
    # Greedy assignment: best scores get locked in first.
    # This ensures that if there are multiple workouts/activities, the best matches "win".
    for _score, workout, activity in unmatched_pairs:
        if workout.id in assigned_workout_ids or activity.id in assigned_activity_ids:
            continue
            
        # Lock match
        assigned_workout_ids.add(workout.id)
        assigned_activity_ids.add(activity.id)
        
        workout.matched_activity_id = activity.id
        workout.compliance_status = _compliance_status_for_match(
            workout,
            activity,
            profile,
            _safe_float(lowest_recorded_rhr, default=0.0),
        )
        db.add(workout)
    
    # Save all changes (including resets for unassigned workouts)
    await db.commit()


def _normalize_sport(value: str | None) -> str:
    raw = (value or "").strip().lower()
    if not raw:
        return "other"
    if "run" in raw:
        return "running"
    if "cycl" in raw or "bike" in raw or "ride" in raw:
        return "cycling"
    if "swim" in raw:
        return "swimming"
    return raw


def _extract_activity_split_durations(activity: Activity) -> list[float]:
    streams = activity.streams if isinstance(activity.streams, dict) else {}

    laps = streams.get("laps")
    if isinstance(laps, list) and laps:
        durations = [float(item.get("duration") or 0.0) for item in laps if isinstance(item, dict)]
        durations = [value for value in durations if value > 0]
        if durations:
            return durations

    splits_metric = streams.get("splits_metric")
    if isinstance(splits_metric, list) and splits_metric:
        durations = [float(item.get("elapsed_time") or item.get("moving_time") or item.get("duration") or 0.0) for item in splits_metric if isinstance(item, dict)]
        durations = [value for value in durations if value > 0]
        if durations:
            return durations

    return []


def _extract_planned_split_durations(workout: PlannedWorkout) -> list[float]:
    structure = workout.structure if isinstance(workout.structure, list) else []
    out: list[float] = []

    def walk(nodes: list[dict[str, Any]], repeats_multiplier: int = 1) -> None:
        for node in nodes:
            if not isinstance(node, dict):
                continue
            node_type = str(node.get("type") or "")
            if node_type == "repeat":
                repeats = int(node.get("repeats") or 1)
                nested = node.get("steps") if isinstance(node.get("steps"), list) else []
                walk(nested, repeats_multiplier=max(1, repeats_multiplier * max(1, repeats)))
                continue

            duration_cfg = node.get("duration") if isinstance(node.get("duration"), dict) else {}
            duration_type = str(duration_cfg.get("type") or "")
            duration_value = float(duration_cfg.get("value") or 0.0)
            if duration_type == "time" and duration_value > 0:
                out.append(duration_value * repeats_multiplier)

    walk(structure)
    return [value for value in out if value > 0]


def _split_shape_similarity(planned: list[float], actual: list[float]) -> float | None:
    if not planned or not actual:
        return None

    planned_total = sum(planned)
    actual_total = sum(actual)
    if planned_total <= 0 or actual_total <= 0:
        return None

    planned_ratios = [value / planned_total for value in planned]
    actual_ratios = [value / actual_total for value in actual]
    compare_len = min(len(planned_ratios), len(actual_ratios))
    if compare_len <= 0:
        return None

    error = 0.0
    for idx in range(compare_len):
        error += abs(planned_ratios[idx] - actual_ratios[idx])

    count_penalty = abs(len(planned_ratios) - len(actual_ratios)) * 0.07
    normalized_error = min(1.0, (error / compare_len) * 3.0 + count_penalty)
    return max(0.0, 1.0 - normalized_error)


def _similarity_score(workout: PlannedWorkout, activity: Activity) -> float:
    workout_sport = _normalize_sport(workout.sport_type)
    activity_sport = _normalize_sport(activity.sport)

    sport_score = 1.0 if workout_sport == activity_sport else (0.55 if "other" in {workout_sport, activity_sport} else 0.0)

    planned_duration_s = max(1.0, float(workout.planned_duration or 0.0) * 60.0)
    actual_duration_s = max(1.0, float(activity.duration or 0.0))
    duration_rel_error = abs(planned_duration_s - actual_duration_s) / max(planned_duration_s, actual_duration_s)
    duration_score = exp(-3.0 * duration_rel_error)

    planned_distance_m = float(workout.planned_distance or 0.0) * 1000.0
    actual_distance_m = float(activity.distance or 0.0)
    if planned_distance_m > 0 and actual_distance_m > 0:
        distance_rel_error = abs(planned_distance_m - actual_distance_m) / max(planned_distance_m, actual_distance_m)
        distance_score = exp(-2.0 * distance_rel_error)
    else:
        distance_score = 0.5

    split_score = _split_shape_similarity(_extract_planned_split_durations(workout), _extract_activity_split_durations(activity))

    # Base factors
    # Sport type match: 40%
    # Duration accuracy: 40%
    # Distance accuracy: 20%
    # (Since date is strictly filtered to same day, we exclude it from "similarity")
    
    weighted_components: list[tuple[float, float]] = [
        (0.40, sport_score),
        (0.40, duration_score),
        (0.20, distance_score),
    ]

    if split_score is not None:
         weighted_components.append((0.15, split_score))

    numerator = sum(w * v for w, v in weighted_components)
    denominator = sum(w for w, v in weighted_components)
    
    if denominator <= 0:
        return 0.0

    weighted_score = numerator / denominator

    # Strictly disqualify different days (though they should be filtered out already)
    day_gap = abs((activity.created_at.date() - workout.date).days) if activity.created_at else 0
    if day_gap > 0:
        return 0.0

    # Small retention bonus for previously linked pair when still plausible.
    if workout.matched_activity_id and workout.matched_activity_id == activity.id:
        weighted_score = min(1.0, weighted_score + 0.05)

    return weighted_score
