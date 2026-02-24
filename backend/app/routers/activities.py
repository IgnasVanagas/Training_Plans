from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from ..database import get_db
from ..models import User, Activity, CoachAthleteLink, OrganizationMember, RoleEnum, Profile
from ..integrations.crypto import decrypt_token, encrypt_token
from ..integrations.registry import get_connector
from ..integrations.service import get_connection
from ..schemas import ActivityOut, ActivityDetail, ActivityUpdate
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
from datetime import datetime, timezone, date, timedelta
from collections import defaultdict
import os
import uuid

router = APIRouter(prefix="/activities", tags=["activities"])

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


def _running_zone_index(hr_value: float, max_hr: float) -> int:
    ratio = hr_value / max_hr
    if ratio < 0.6:
        return 1
    if ratio < 0.7:
        return 2
    if ratio < 0.8:
        return 3
    if ratio < 0.9:
        return 4
    return 5


def _cycling_zone_index(power_value: float, ftp: float) -> int:
    ratio = (power_value / ftp) * 100
    if ratio <= 55:
        return 1
    if ratio <= 75:
        return 2
    if ratio <= 90:
        return 3
    if ratio <= 105:
        return 4
    if ratio <= 120:
        return 5
    if ratio <= 150:
        return 6
    return 7


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
        return [lt2f * 0.84, lt2f * 0.90, lt2f * 0.97, lt2f * 1.03, lt1f, lt1f * 1.10]

    if lt2f <= lt1f:
        return fallback_bounds

    if sport == "running" and metric == "hr":
        return [lt1f * 0.90, lt1f, (lt1f + lt2f) / 2.0, lt2f]
    if sport == "cycling" and metric == "hr":
        return [lt1f * 0.90, lt1f, (lt1f + lt2f) / 2.0, lt2f]
    if sport == "cycling" and metric == "power":
        return [lt1f * 0.80, lt1f, (lt1f + lt2f) / 2.0, lt2f, lt2f * 1.12, lt2f * 1.35]

    return fallback_bounds


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
        refreshed = await connector.refresh_token(refresh_token)
        access_token = refreshed.access_token
        connection.encrypted_access_token = encrypt_token(refreshed.access_token)
        if refreshed.refresh_token:
            connection.encrypted_refresh_token = encrypt_token(refreshed.refresh_token)
        connection.token_expires_at = refreshed.expires_at
        connection.scopes = refreshed.scopes
        await db.commit()

    return access_token


def _as_stream_payload(streams) -> dict:
    if isinstance(streams, dict):
        return streams
    if isinstance(streams, list):
        return {"data": streams}
    return {}


def _activity_feedback_from_payload(payload: dict) -> tuple[int | None, str | None]:
    if not isinstance(payload, dict):
        return None, None
    meta = payload.get("_meta") if isinstance(payload.get("_meta"), dict) else {}
    rpe_raw = meta.get("rpe")
    notes_raw = meta.get("notes")

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

    return rpe_value, notes_value


def _is_activity_deleted(activity: Activity) -> bool:
    payload = _as_stream_payload(activity.streams)
    meta = payload.get("_meta") if isinstance(payload, dict) else None
    return bool(meta.get("deleted")) if isinstance(meta, dict) else False


def _apply_activity_to_bucket(bucket: dict, activity: Activity, ftp: float, max_hr: float, profile: Profile | None = None) -> None:
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

    stored_streams = activity.streams if isinstance(activity.streams, dict) else {}
    data_points = stored_streams.get("data", []) if isinstance(stored_streams, dict) else []

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

        lt2_pace = _safe_number(getattr(profile, "lt2", None), default=0.0)
        running_hr_bounds = _metric_upper_bounds(
            profile,
            sport="running",
            metric="hr",
            fallback_bounds=[max_hr * 0.60, max_hr * 0.70, max_hr * 0.80, max_hr * 0.90],
        )
        running_pace_bounds = _metric_upper_bounds(
            profile,
            sport="running",
            metric="pace",
            fallback_bounds=[lt2_pace * 0.84, lt2_pace * 0.90, lt2_pace * 0.97, lt2_pace * 1.03, lt2_pace * 1.10, lt2_pace * 1.20] if lt2_pace > 0 else [],
        )

        if hr_samples and max_hr > 0 and duration_seconds > 0:
            seconds_per_sample = duration_seconds / len(hr_samples)
            for hr in hr_samples:
                zone = _zone_index_from_upper_bounds(hr, running_hr_bounds)
                sport_bucket["zone_seconds_by_metric"]["hr"][f"Z{zone}"] += seconds_per_sample
        else:
            hr_zones = stored_streams.get("hr_zones") if isinstance(stored_streams, dict) else None
            if isinstance(hr_zones, dict):
                for zone in range(1, 6):
                    sport_bucket["zone_seconds_by_metric"]["hr"][f"Z{zone}"] += _safe_number(hr_zones.get(f"Z{zone}"))

        if running_pace_bounds and speed_samples and duration_seconds > 0:
            seconds_per_sample = duration_seconds / len(speed_samples)
            for speed in speed_samples:
                pace_min_per_km = 1000.0 / (speed * 60.0)
                zone = _zone_index_from_upper_bounds(pace_min_per_km, running_pace_bounds, reverse=True)
                sport_bucket["zone_seconds_by_metric"]["pace"][f"Z{zone}"] += seconds_per_sample

        sport_bucket["zone_seconds"] = dict(sport_bucket["zone_seconds_by_metric"]["hr"])
        return

    # Cycling (7 zones)
    stored_streams = activity.streams if isinstance(activity.streams, dict) else {}
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
        fallback_bounds=[max_hr * 0.60, max_hr * 0.70, max_hr * 0.80, max_hr * 0.90],
    )

    if cycling_power_bounds and power_samples and duration_seconds > 0:
        seconds_per_sample = duration_seconds / len(power_samples)
        for watts in power_samples:
            zone = _zone_index_from_upper_bounds(watts, cycling_power_bounds)
            sport_bucket["zone_seconds_by_metric"]["power"][f"Z{zone}"] += seconds_per_sample

    if hr_samples and max_hr > 0 and duration_seconds > 0:
        seconds_per_sample = duration_seconds / len(hr_samples)
        for hr in hr_samples:
            zone = _zone_index_from_upper_bounds(hr, cycling_hr_bounds)
            sport_bucket["zone_seconds_by_metric"]["hr"][f"Z{zone}"] += seconds_per_sample
    else:
        hr_zones = stored_streams.get("hr_zones") if isinstance(stored_streams, dict) else None
        if isinstance(hr_zones, dict):
            for zone in range(1, 6):
                sport_bucket["zone_seconds_by_metric"]["hr"][f"Z{zone}"] += _safe_number(hr_zones.get(f"Z{zone}"))

    sport_bucket["zone_seconds"] = dict(sport_bucket["zone_seconds_by_metric"]["power"])


def _round_bucket(bucket: dict) -> dict:
    bucket["total_duration_minutes"] = round(bucket["total_duration_minutes"], 1)
    bucket["total_distance_km"] = round(bucket["total_distance_km"], 1)
    for sport in ("running", "cycling"):
        bucket["sports"][sport]["total_duration_minutes"] = round(bucket["sports"][sport]["total_duration_minutes"], 1)
        bucket["sports"][sport]["total_distance_km"] = round(bucket["sports"][sport]["total_distance_km"], 1)
    return bucket


def _build_activity_zone_summary(activity: Activity, ftp: float, max_hr: float, profile: Profile | None = None) -> dict | None:
    sport = _normalize_sport_name(activity.sport)
    if sport not in ("running", "cycling"):
        return None

    temp_bucket = _empty_bucket()
    _apply_activity_to_bucket(temp_bucket, activity, ftp, max_hr, profile)
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


def _activity_training_load(activity: Activity, ftp: float, max_hr: float) -> tuple[float, float]:
    sport = _normalize_sport_name(activity.sport)
    if sport not in ("running", "cycling"):
        duration_min = _safe_number(activity.duration) / 60.0 if activity.duration else 0.0
        # Generic fallback: light-moderate endurance load when no zone model is available.
        return round(duration_min * 1.5, 1), 0.0

    temp_bucket = _empty_bucket()
    _apply_activity_to_bucket(temp_bucket, activity, ftp, max_hr)
    zone_seconds = temp_bucket["sports"][sport]["zone_seconds"]

    zone_minutes = {key: (value or 0) / 60.0 for key, value in zone_seconds.items()}

    # Zone-based TRIMP split with fractional aerobic/anaerobic allocation.
    # This keeps both pathways represented across all intensities while preserving
    # higher anaerobic contribution at higher zones.
    if sport == "running":
        zone_weights = {"Z1": 1.0, "Z2": 2.0, "Z3": 3.0, "Z4": 4.0, "Z5": 5.0}
        aerobic_fraction = {"Z1": 0.95, "Z2": 0.90, "Z3": 0.75, "Z4": 0.55, "Z5": 0.35}
    else:
        zone_weights = {"Z1": 1.0, "Z2": 2.0, "Z3": 3.0, "Z4": 4.0, "Z5": 6.0, "Z6": 8.0, "Z7": 10.0}
        aerobic_fraction = {"Z1": 0.97, "Z2": 0.92, "Z3": 0.82, "Z4": 0.70, "Z5": 0.52, "Z6": 0.35, "Z7": 0.20}

    total_minutes = 0.0
    aerobic = 0.0
    anaerobic = 0.0
    for zone_key, weight in zone_weights.items():
        minutes = zone_minutes.get(zone_key, 0.0)
        total_minutes += minutes
        zone_trimp = minutes * weight
        aero_share = aerobic_fraction.get(zone_key, 0.5)
        aerobic += zone_trimp * aero_share
        anaerobic += zone_trimp * (1.0 - aero_share)

    if total_minutes > 0:
        if aerobic <= 0:
            aerobic = 0.1
        if anaerobic <= 0:
            anaerobic = 0.1

    return round(aerobic, 1), round(anaerobic, 1)


def _resolve_training_status(acute_load: float, chronic_load: float) -> str:
    # ACWR-based status bands (acute: 7-day avg, chronic: 42-day avg).
    if chronic_load < 12 and acute_load < 10:
        return "Detraining"
    if chronic_load <= 0:
        return "Maintaining"

    ratio = acute_load / chronic_load
    if ratio < 0.8:
        return "Recovering"
    if ratio <= 1.30:
        return "Productive"
    if ratio <= 1.50:
        return "Overreaching"
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

    profiles_stmt = select(Profile).where(Profile.user_id.in_(target_user_ids))
    profiles_res = await db.execute(profiles_stmt)
    profiles = {p.user_id: p for p in profiles_res.scalars().all()}

    users_stmt = select(User).where(User.id.in_(target_user_ids))
    users_res = await db.execute(users_stmt)
    users = {u.id: u for u in users_res.scalars().all()}

    start_dt = datetime.combine(week_start, datetime.min.time())
    end_dt = datetime.combine(month_end, datetime.max.time())

    activities_stmt = select(Activity).where(
        Activity.athlete_id.in_(target_user_ids),
        Activity.created_at >= start_dt,
        Activity.created_at <= end_dt
    )
    activities_res = await db.execute(activities_stmt)
    activities = activities_res.scalars().all()

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

    for activity in activities:
        if _is_activity_deleted(activity):
            continue
        activity_date = activity.created_at.date()
        athlete_summary = summaries.get(activity.athlete_id)
        if athlete_summary is None:
            continue

        profile = profiles.get(activity.athlete_id)
        ftp = _safe_number(getattr(profile, "ftp", None), default=0.0)
        max_hr = _safe_number(getattr(profile, "max_hr", None), default=190.0)
        activity_zone_summary = _build_activity_zone_summary(activity, ftp, max_hr, profile)

        if week_start <= activity_date <= week_end:
            _apply_activity_to_bucket(athlete_summary["weekly"], activity, ftp, max_hr, profile)
            if activity_zone_summary is not None:
                athlete_summary["weekly_activity_zones"].append(activity_zone_summary)
        if month_start <= activity_date <= month_end:
            _apply_activity_to_bucket(athlete_summary["monthly"], activity, ftp, max_hr, profile)
            if activity_zone_summary is not None:
                athlete_summary["monthly_activity_zones"].append(activity_zone_summary)

    for summary in summaries.values():
        summary["weekly"] = _round_bucket(summary["weekly"])
        summary["monthly"] = _round_bucket(summary["monthly"])

    return {
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

@router.post("/upload", status_code=status.HTTP_201_CREATED, response_model=ActivityDetail)
async def upload_activity(
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
    if duplicate:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(
            status_code=409,
            detail=f"Duplicate activity detected (existing id {duplicate.id})"
        )

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
        streams=streams
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
            "total_calories": summary.get("total_calories")
        }
    }
    
    new_activity.streams = composite_streams_data
    
    db.add(new_activity)
    await db.commit()
    await db.refresh(new_activity)

    # Run Compliance Check
    await match_and_score(db, current_user.id, new_activity.created_at.date())

    profile = await db.scalar(select(Profile).where(Profile.user_id == current_user.id))
    ftp = _safe_number(getattr(profile, "ftp", None), default=0.0)
    max_hr = _safe_number(getattr(profile, "max_hr", None), default=190.0)
    aerobic_load, anaerobic_load = _activity_training_load(new_activity, ftp, max_hr)
    
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
    )


@router.get("/training-status")
async def get_training_status(
    athlete_id: int | None = None,
    reference_date: date | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    ref_date = reference_date or date.today()
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

    profile = await db.scalar(select(Profile).where(Profile.user_id == target_athlete_id))
    ftp = _safe_number(getattr(profile, "ftp", None), default=0.0)
    max_hr = _safe_number(getattr(profile, "max_hr", None), default=190.0)

    start_date = ref_date - timedelta(days=41)
    start_dt = datetime.combine(start_date, datetime.min.time())
    end_dt = datetime.combine(ref_date, datetime.max.time())

    activities_stmt = select(Activity).where(
        Activity.athlete_id == target_athlete_id,
        Activity.created_at >= start_dt,
        Activity.created_at <= end_dt
    )
    activities_res = await db.execute(activities_stmt)
    activities = [activity for activity in activities_res.scalars().all() if not _is_activity_deleted(activity)]

    daily_aerobic: dict[date, float] = defaultdict(float)
    daily_anaerobic: dict[date, float] = defaultdict(float)

    for activity in activities:
        aerobic, anaerobic = _activity_training_load(activity, ftp, max_hr)
        activity_day = activity.created_at.date()
        daily_aerobic[activity_day] += aerobic
        daily_anaerobic[activity_day] += anaerobic

    acute_start = ref_date - timedelta(days=6)
    chronic_start = ref_date - timedelta(days=41)

    acute_aerobic = 0.0
    acute_anaerobic = 0.0
    chronic_aerobic = 0.0
    chronic_anaerobic = 0.0

    day_cursor = chronic_start
    while day_cursor <= ref_date:
        day_aerobic = daily_aerobic.get(day_cursor, 0.0)
        day_anaerobic = daily_anaerobic.get(day_cursor, 0.0)
        chronic_aerobic += day_aerobic
        chronic_anaerobic += day_anaerobic
        if day_cursor >= acute_start:
            acute_aerobic += day_aerobic
            acute_anaerobic += day_anaerobic
        day_cursor += timedelta(days=1)

    acute_load = (acute_aerobic + acute_anaerobic) / 7.0
    chronic_load = (chronic_aerobic + chronic_anaerobic) / 42.0

    return {
        "athlete_id": target_athlete_id,
        "reference_date": ref_date,
        "acute": {
            "aerobic": round(acute_aerobic, 1),
            "anaerobic": round(acute_anaerobic, 1),
            "daily_load": round(acute_load, 1)
        },
        "chronic": {
            "aerobic": round(chronic_aerobic, 1),
            "anaerobic": round(chronic_anaerobic, 1),
            "daily_load": round(chronic_load, 1)
        },
        "training_status": _resolve_training_status(acute_load, chronic_load)
    }

@router.get("/", response_model=list[ActivityOut])
async def get_activities(
    start_date: str | None = None,
    end_date: str | None = None,
    athlete_id: int | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = select(Activity)

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
            # check link
            link = await db.scalar(select(CoachAthleteLink).where(
                and_(
                    CoachAthleteLink.coach_id == current_user.id,
                    CoachAthleteLink.athlete_id == athlete_id,
                    CoachAthleteLink.is_active == True
                )
            ))
            if not link and athlete_id != current_user.id:
                 raise HTTPException(status_code=403, detail="Not authorized for this athlete")
            query = query.where(Activity.athlete_id == athlete_id)
        else:
            # Return all activities from linked athletes AND the coach themselves
            subq = select(CoachAthleteLink.athlete_id).where(
                CoachAthleteLink.coach_id == current_user.id,
                CoachAthleteLink.is_active == True
            )
            # We want activities where athlete_id is IN linked_athletes OR athlete_id is current_user.id
            query = query.where(
                (Activity.athlete_id.in_(subq)) | (Activity.athlete_id == current_user.id)
            )
            
    else:
        # Regular athlete, see only own
        query = query.where(Activity.athlete_id == current_user.id)

    result = await db.execute(query.order_by(Activity.created_at.desc()))
    activities = result.scalars().all()

    athlete_ids = list({activity.athlete_id for activity in activities})
    profile_map: dict[int, Profile] = {}
    if athlete_ids:
        profiles_res = await db.execute(select(Profile).where(Profile.user_id.in_(athlete_ids)))
        profile_map = {profile.user_id: profile for profile in profiles_res.scalars().all()}

    out: list[ActivityOut] = []
    for activity in activities:
        profile = profile_map.get(activity.athlete_id)
        ftp = _safe_number(getattr(profile, "ftp", None), default=0.0)
        max_hr = _safe_number(getattr(profile, "max_hr", None), default=190.0)
        aerobic_load, anaerobic_load = _activity_training_load(activity, ftp, max_hr)
        payload = _as_stream_payload(activity.streams)
        rpe, notes = _activity_feedback_from_payload(payload)
        out.append(
            ActivityOut(
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
                is_deleted=_is_activity_deleted(activity),
                aerobic_load=aerobic_load,
                anaerobic_load=anaerobic_load,
                total_load_impact=round(aerobic_load + anaerobic_load, 1),
                rpe=rpe,
                notes=notes,
            )
        )
    return out

@router.get("/{activity_id}", response_model=ActivityDetail)
async def get_activity(
    activity_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Activity).where(Activity.id == activity_id))
    activity = result.scalars().first()
    
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
        
    if activity.athlete_id != current_user.id and current_user.role != "coach": # Allow coach? (Need to check if coach linked)
         # Simplified permission check: Owner or Coach
         # For now allow owner.
         pass
         
    # Extract data from stored JSON structure
    # Stored as { "data": [...], "power_curve": ..., "hr_zones": ... }
    stored_data = activity.streams or {}
    
    # Backwards compatibility check if streams was just list
    streams_list = []
    power_curve = None
    hr_zones = None
    pace_curve = None
    laps = None
    splits_metric = None
    stats = {}
    
    if isinstance(stored_data, list):
        streams_list = stored_data
    elif isinstance(stored_data, dict):
        stored_data, time_fields_changed = _normalize_activity_time_fields(stored_data)
        if time_fields_changed:
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

    # Lazy-load deep provider data only when activity detail is opened.
    if isinstance(stored_data, dict):
        meta = stored_data.get("_meta") if isinstance(stored_data.get("_meta"), dict) else {}
        source_provider = meta.get("source_provider")
        source_activity_id = meta.get("source_activity_id")
        needs_streams = len(streams_list) == 0
        needs_laps = not laps

        if (
            activity.file_type == "provider"
            and source_provider == "strava"
            and source_activity_id
            and (needs_streams or needs_laps)
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
    ftp = _safe_number(getattr(profile, "ftp", None), default=0.0)
    max_hr = _safe_number(getattr(profile, "max_hr", None), default=190.0)
    aerobic_load, anaerobic_load = _activity_training_load(activity, ftp, max_hr)
        
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
        laps=laps,
        splits_metric=splits_metric,
        max_hr=stats.get("max_hr"),
        max_speed=stats.get("max_speed"),
        max_watts=stats.get("max_watts"),
        max_cadence=stats.get("max_cadence"),
        avg_cadence=stats.get("avg_cadence"),
        total_elevation_gain=stats.get("total_elevation_gain"),
        total_calories=stats.get("total_calories"),
        is_deleted=_is_activity_deleted(activity),
        aerobic_load=aerobic_load,
        anaerobic_load=anaerobic_load,
        total_load_impact=round(aerobic_load + anaerobic_load, 1),
        rpe=_activity_feedback_from_payload(stored_data)[0],
        notes=_activity_feedback_from_payload(stored_data)[1],
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
        meta["rpe"] = update_data.get("rpe")
    if "notes" in update_data:
        meta["notes"] = update_data.get("notes")
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
        athlete_permissions = await get_athlete_permissions(db, current_user.id)
        if not athlete_permissions.get('allow_delete_activities', False):
            raise HTTPException(status_code=403, detail="Coach has not allowed activity deletion")

    activity_date = activity.created_at.date()
    athlete_id = activity.athlete_id

    payload = _as_stream_payload(activity.streams)
    meta = payload.get("_meta") if isinstance(payload.get("_meta"), dict) else {}
    meta.update({
        "deleted": True,
        "deleted_at": datetime.utcnow().isoformat(),
        "deleted_by": current_user.id
    })
    payload["_meta"] = meta
    activity.streams = payload
    db.add(activity)
    await db.commit()

    await match_and_score(db, athlete_id, activity_date)

    return {"status": "success", "is_deleted": True}
