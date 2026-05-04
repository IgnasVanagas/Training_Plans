from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import secrets
import string
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import get_password_hash
from .database import AsyncSessionLocal
from .models import (
    Activity,
    CoachAthleteLink,
    ComplianceStatusEnum,
    Organization,
    OrganizationCoachMessage,
    OrganizationDirectMessage,
    OrganizationGroupMessage,
    OrganizationMember,
    PlannedWorkout,
    PlannedWorkoutVersion,
    Profile,
    RoleEnum,
    SeasonPlan,
    User,
)
from .parsing import parse_activity_file
from .services.compliance import match_and_score
from .services.personal_records import compute_activity_best_efforts
from .services.season_planner import build_generated_workouts

try:
    from .routers.activities import _activity_training_load as _existing_activity_training_load
except Exception:
    _existing_activity_training_load = None


DEMO_SEED_VERSION = "prod-demo-v1"
DEFAULT_ORGANIZATION_NAME = "North Harbour Endurance Collective"
DEFAULT_ACTIVITY_SOURCE_DIR = Path(__file__).resolve().parents[1] / "uploads" / "activities"


@dataclass(frozen=True)
class GoalRaceTemplate:
    name: str
    day_offset: int
    priority: str
    distance_km: float
    expected_time: str
    location: str
    notes: str


@dataclass(frozen=True)
class PeriodizationTemplate:
    weekly_hours_target: int
    longest_session_minutes: int
    training_days_per_week: int
    recovery_week_frequency: int
    taper_profile: str
    periodization_model: str


@dataclass(frozen=True)
class DemoPersona:
    key: str
    role: RoleEnum
    org_role: str
    first_name: str
    last_name: str
    gender: str
    birth_date: date
    timezone: str
    country: str
    weight: float | None
    sports: tuple[str, ...]
    main_sport: str | None
    preferred_language: str = "en"
    preferred_units: str = "metric"
    week_start_day: str = "monday"
    ftp: float | None = None
    lt2: float | None = None
    max_hr: float | None = None
    resting_hr: float | None = None
    training_days: tuple[str, ...] = ()
    narrative: str | None = None
    target_metrics: tuple[tuple[str, float | str, str | None], ...] = ()
    goal_races: tuple[GoalRaceTemplate, ...] = ()
    periodization: PeriodizationTemplate | None = None

    @property
    def display_name(self) -> str:
        return f"{self.first_name} {self.last_name}"

    @property
    def is_athlete(self) -> bool:
        return self.role == RoleEnum.athlete


@dataclass(frozen=True)
class DemoSeedConfig:
    gmail_base: str
    alias_prefix: str
    organization_name: str = DEFAULT_ORGANIZATION_NAME
    activity_source_dir: Path = DEFAULT_ACTIVITY_SOURCE_DIR
    dry_run: bool = False
    confirm_production: bool = False
    preserve_existing_passwords: bool = False

    @property
    def normalized_prefix(self) -> str:
        return sanitize_alias_prefix(self.alias_prefix)


@dataclass(frozen=True)
class DemoAccountSpec:
    persona: DemoPersona
    email: str


@dataclass(frozen=True)
class WorkoutBlueprint:
    key: str
    day_offset: int
    title: str
    description: str
    sport_type: str
    planned_duration: int
    planned_distance: float | None
    target_status: str
    planned_intensity: str | None = None
    structure: list[dict[str, Any]] | None = None


@dataclass(frozen=True)
class ActivityBlueprint:
    key: str
    day_offset: int
    title: str
    sport: str
    duration_minutes: int
    distance_km: float | None
    average_hr: float | None
    average_watts: float | None
    rpe: int | None
    notes: str
    duplicate_of_key: str | None = None
    device_name: str | None = None
    prefer_parsed_template: bool = False


@dataclass(frozen=True)
class OrganizationGroupMessageBlueprint:
    sender_key: str
    body: str
    days_ago: int
    hour: int
    minute: int


@dataclass(frozen=True)
class OrganizationCoachMessageBlueprint:
    athlete_key: str
    sender_key: str
    body: str
    days_ago: int
    hour: int
    minute: int


@dataclass(frozen=True)
class OrganizationDirectMessageBlueprint:
    sender_key: str
    recipient_key: str
    body: str
    days_ago: int
    hour: int
    minute: int


@dataclass(frozen=True)
class ParsedActivityTemplate:
    source_path: Path
    sport: str
    summary: dict[str, Any]
    stream_points: list[dict[str, Any]]
    power_curve: dict[str, Any] | None
    hr_zones: Any
    pace_curve: dict[str, Any] | None
    laps: list[dict[str, Any]] | None
    splits_metric: list[dict[str, Any]] | None
    stats: dict[str, Any]


@dataclass
class SeedCredentialResult:
    key: str
    role: str
    email: str
    password_status: str
    password: str | None = None


@dataclass
class DemoSeedReport:
    action: str
    prefix: str
    organization_name: str
    dry_run: bool
    accounts: list[dict[str, Any]] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "action": self.action,
            "prefix": self.prefix,
            "organization_name": self.organization_name,
            "dry_run": self.dry_run,
            "version": DEMO_SEED_VERSION,
            "accounts": self.accounts,
            "counts": self.counts,
        }


DEMO_PERSONAS: tuple[DemoPersona, ...] = (
    DemoPersona(
        key="coach",
        role=RoleEnum.coach,
        org_role="coach",
        first_name="Granite",
        last_name="Harbor",
        gender="Male",
        birth_date=date(1987, 3, 18),
        timezone="Europe/Vilnius",
        country="Lithuania",
        weight=74.0,
        sports=("cycling", "running"),
        main_sport="cycling",
        ftp=292.0,
        max_hr=188.0,
        resting_hr=49.0,
        training_days=("monday", "tuesday", "thursday", "friday", "saturday"),
        narrative="Head coach for a performance-focused amateur squad balancing threshold work, recovery discipline, and race-specific preparation.",
    ),
    DemoPersona(
        key="admin",
        role=RoleEnum.admin,
        org_role="admin",
        first_name="Silver",
        last_name="Ledger",
        gender="Female",
        birth_date=date(1990, 11, 7),
        timezone="Europe/Vilnius",
        country="Lithuania",
        weight=60.0,
        sports=("running", "cycling"),
        main_sport="running",
        lt2=4.15,
        max_hr=184.0,
        resting_hr=47.0,
        training_days=("tuesday", "wednesday", "friday", "sunday"),
        narrative="Operations lead who can also review the coaching workspace from inside the same demonstration organization.",
    ),
    DemoPersona(
        key="athlete-01",
        role=RoleEnum.athlete,
        org_role="athlete",
        first_name="Willow",
        last_name="Circuit",
        gender="Female",
        birth_date=date(1995, 6, 14),
        timezone="Europe/Vilnius",
        country="Lithuania",
        weight=57.0,
        sports=("running",),
        main_sport="running",
        lt2=4.02,
        max_hr=191.0,
        resting_hr=46.0,
        training_days=("monday", "wednesday", "thursday", "saturday", "sunday"),
        narrative="Consistent half-marathon athlete progressing from regional podium chases toward a stronger late-summer peak.",
        target_metrics=(("threshold_pace", 4.02, "min/km"), ("weekly_volume", 62, "km")),
        goal_races=(
            GoalRaceTemplate("Harbour Lights 10K", 18, "B", 10.0, "00:41:40", "Old Port Circuit", "Tune-up race to sharpen pacing before the main block."),
            GoalRaceTemplate("Amber River Half", 46, "A", 21.1, "01:29:30", "Riverside Boulevard", "Primary target for the current build with a controlled taper."),
        ),
        periodization=PeriodizationTemplate(7, 105, 5, 4, "standard", "pyramidal"),
    ),
    DemoPersona(
        key="athlete-02",
        role=RoleEnum.athlete,
        org_role="athlete",
        first_name="Copper",
        last_name="Ridge",
        gender="Male",
        birth_date=date(1992, 9, 2),
        timezone="Europe/Vilnius",
        country="Lithuania",
        weight=76.0,
        sports=("cycling",),
        main_sport="cycling",
        ftp=286.0,
        max_hr=186.0,
        resting_hr=48.0,
        training_days=("tuesday", "thursday", "friday", "saturday", "sunday"),
        narrative="Road-focused amateur cyclist preparing for a long gran fondo with stronger sustained power under fatigue.",
        target_metrics=(("ftp", 286, "w"), ("event_distance", 122, "km")),
        goal_races=(
            GoalRaceTemplate("Glass Coast Circuit", 20, "C", 68.0, "01:58:00", "West Bay Loop", "Short race-day rehearsal focused on fueling and start discipline."),
            GoalRaceTemplate("Northern Sound Gran Fondo", 52, "A", 122.0, "03:28:00", "Harbour Highlands", "Primary endurance target with a long, rolling second half."),
        ),
        periodization=PeriodizationTemplate(9, 185, 5, 4, "standard", "polarized"),
    ),
    DemoPersona(
        key="athlete-03",
        role=RoleEnum.athlete,
        org_role="athlete",
        first_name="Cinder",
        last_name="Brook",
        gender="Female",
        birth_date=date(1998, 1, 27),
        timezone="Europe/Riga",
        country="Latvia",
        weight=59.0,
        sports=("running",),
        main_sport="running",
        lt2=4.28,
        max_hr=193.0,
        resting_hr=45.0,
        training_days=("tuesday", "wednesday", "friday", "saturday", "sunday"),
        narrative="10 km specialist building confidence with more controlled threshold density and fewer overreaching weeks.",
        target_metrics=(("threshold_pace", 4.28, "min/km"), ("race_goal", 43.5, "min")),
        goal_races=(
            GoalRaceTemplate("Stone Bridge 5K", 16, "C", 5.0, "00:20:35", "Cathedral Quarter", "Low-pressure speed check to keep leg turnover sharp."),
            GoalRaceTemplate("Old Mill 10K", 42, "A", 10.0, "00:43:30", "City Park Circuit", "Main target race with a conservative opening kilometre plan."),
        ),
        periodization=PeriodizationTemplate(6, 95, 5, 4, "short", "threshold"),
    ),
    DemoPersona(
        key="athlete-04",
        role=RoleEnum.athlete,
        org_role="athlete",
        first_name="Marble",
        last_name="Summit",
        gender="Male",
        birth_date=date(1989, 4, 30),
        timezone="Europe/Warsaw",
        country="Poland",
        weight=79.0,
        sports=("cycling",),
        main_sport="cycling",
        ftp=301.0,
        max_hr=183.0,
        resting_hr=50.0,
        training_days=("monday", "wednesday", "thursday", "saturday", "sunday"),
        narrative="Diesel all-rounder aiming to race better after long efforts rather than chasing short-term peak watts.",
        target_metrics=(("ftp", 301, "w"), ("climbing_repeatability", 4, "reps")),
        goal_races=(
            GoalRaceTemplate("Pine Ridge Road Race", 19, "B", 86.0, "02:19:00", "Forest Ring", "Race simulation for pack positioning and late climbs."),
            GoalRaceTemplate("Granite Hills Classic", 49, "A", 108.0, "03:05:00", "Granite Valley", "Primary race with repeated threshold climbs in the second hour."),
        ),
        periodization=PeriodizationTemplate(10, 200, 5, 4, "extended", "pyramidal"),
    ),
    DemoPersona(
        key="athlete-05",
        role=RoleEnum.athlete,
        org_role="athlete",
        first_name="Juniper",
        last_name="Lane",
        gender="Female",
        birth_date=date(1991, 8, 11),
        timezone="Europe/Vilnius",
        country="Lithuania",
        weight=61.0,
        sports=("running",),
        main_sport="running",
        lt2=4.46,
        max_hr=189.0,
        resting_hr=47.0,
        training_days=("monday", "wednesday", "friday", "saturday", "sunday"),
        narrative="Marathon-oriented recreational athlete who responds well to steady volume and carefully controlled long-run progressions.",
        target_metrics=(("threshold_pace", 4.46, "min/km"), ("long_run", 28, "km")),
        goal_races=(
            GoalRaceTemplate("Market Square 15K", 24, "B", 15.0, "01:11:30", "Canal Promenade", "Mid-block checkpoint to validate rhythm and fueling."),
            GoalRaceTemplate("Seven Pines Marathon", 60, "A", 42.2, "03:27:00", "Seven Pines Loop", "Main target race with even pacing and strong final 12 km."),
        ),
        periodization=PeriodizationTemplate(8, 150, 5, 4, "extended", "pyramidal"),
    ),
    DemoPersona(
        key="athlete-06",
        role=RoleEnum.athlete,
        org_role="athlete",
        first_name="Orbit",
        last_name="Line",
        gender="Male",
        birth_date=date(1997, 12, 5),
        timezone="Europe/Vilnius",
        country="Lithuania",
        weight=72.0,
        sports=("cycling",),
        main_sport="cycling",
        ftp=268.0,
        max_hr=189.0,
        resting_hr=46.0,
        training_days=("tuesday", "wednesday", "friday", "saturday", "sunday"),
        narrative="Time-trial focused rider trying to become more durable at sweet spot without losing cadence discipline.",
        target_metrics=(("ftp", 268, "w"), ("tt_distance", 40, "km")),
        goal_races=(
            GoalRaceTemplate("Lakeside TT Series", 17, "C", 18.0, "00:27:30", "South Causeway", "Short efforts to check position comfort and aero pacing."),
            GoalRaceTemplate("Windline 40K TT", 44, "A", 40.0, "00:59:30", "Windline Highway", "Main target demanding disciplined pacing through crosswinds."),
        ),
        periodization=PeriodizationTemplate(8, 160, 5, 4, "short", "threshold"),
    ),
    DemoPersona(
        key="athlete-07",
        role=RoleEnum.athlete,
        org_role="athlete",
        first_name="Ember",
        last_name="Trail",
        gender="Female",
        birth_date=date(1994, 5, 20),
        timezone="Europe/Tallinn",
        country="Estonia",
        weight=55.0,
        sports=("running",),
        main_sport="running",
        lt2=4.36,
        max_hr=188.0,
        resting_hr=44.0,
        training_days=("monday", "tuesday", "thursday", "saturday", "sunday"),
        narrative="Trail-capable runner aiming to translate hill strength into a steadier sustained pace over rolling terrain.",
        target_metrics=(("threshold_pace", 4.36, "min/km"), ("vertical_gain", 650, "m")),
        goal_races=(
            GoalRaceTemplate("Hill Garden 12K", 22, "B", 12.0, "00:55:30", "Hill Garden Reserve", "Strength-focused preparatory race on rolling terrain."),
            GoalRaceTemplate("Forest Edge 25K", 50, "A", 25.0, "01:59:00", "Forest Edge Trails", "Primary goal with conservative climbing early and stronger descending late."),
        ),
        periodization=PeriodizationTemplate(7, 130, 5, 4, "standard", "polarized"),
    ),
    DemoPersona(
        key="athlete-08",
        role=RoleEnum.athlete,
        org_role="athlete",
        first_name="Falcon",
        last_name="Gravel",
        gender="Male",
        birth_date=date(1993, 2, 15),
        timezone="Europe/Vilnius",
        country="Lithuania",
        weight=77.0,
        sports=("cycling",),
        main_sport="cycling",
        ftp=279.0,
        max_hr=185.0,
        resting_hr=49.0,
        training_days=("monday", "wednesday", "friday", "saturday", "sunday"),
        narrative="Gravel-oriented rider whose best performances come from steady pacing, fueling consistency, and low-surprise race execution.",
        target_metrics=(("ftp", 279, "w"), ("event_distance", 98, "km")),
        goal_races=(
            GoalRaceTemplate("Dry Meadow Gravel 60", 21, "B", 60.0, "02:13:00", "Dry Meadow Farm Roads", "Race-pace rehearsal with pressure changes over loose sections."),
            GoalRaceTemplate("Silver Pines Gravel 98", 54, "A", 98.0, "03:18:00", "Silver Pines Forest", "Primary race with extended tempo riding over broken surfaces."),
        ),
        periodization=PeriodizationTemplate(9, 190, 5, 4, "standard", "polarized"),
    ),
)


def sanitize_alias_prefix(value: str) -> str:
    raw = (value or "").strip().lower()
    cleaned: list[str] = []
    previous_dash = False
    for char in raw:
        if char.isalnum():
            cleaned.append(char)
            previous_dash = False
            continue
        if char in {"-", "_", ".", " ", "/"} and not previous_dash:
            cleaned.append("-")
            previous_dash = True
    normalized = "".join(cleaned).strip("-")
    if not normalized:
        raise ValueError("Alias prefix must include at least one alphanumeric character")
    return normalized[:40]


def build_plus_address(base_email: str, alias: str) -> str:
    email = (base_email or "").strip().lower()
    if "@" not in email:
        raise ValueError("gmail_base must be a valid email address")
    local_part, domain = email.split("@", 1)
    local_part = local_part.split("+", 1)[0]
    alias_token = sanitize_alias_prefix(alias)
    return f"{local_part}+{alias_token}@{domain}"


def generate_secure_password(length: int = 20) -> str:
    if length < 16:
        raise ValueError("Password length must be at least 16 characters")
    required_sets = [
        string.ascii_lowercase,
        string.ascii_uppercase,
        string.digits,
        "!@#$%^&*-_=+?",
    ]
    password_chars = [secrets.choice(charset) for charset in required_sets]
    all_chars = "".join(required_sets)
    while len(password_chars) < length:
        password_chars.append(secrets.choice(all_chars))
    secrets.SystemRandom().shuffle(password_chars)
    return "".join(password_chars)


def ensure_mutation_allowed(config: DemoSeedConfig) -> None:
    if not config.dry_run and not config.confirm_production:
        raise ValueError("Refusing to mutate without --confirm-production")


def build_account_specs(config: DemoSeedConfig) -> list[DemoAccountSpec]:
    prefix = config.normalized_prefix
    return [
        DemoAccountSpec(persona=persona, email=build_plus_address(config.gmail_base, f"{prefix}-{persona.key}"))
        for persona in DEMO_PERSONAS
    ]


def build_seed_marker(config: DemoSeedConfig) -> dict[str, Any]:
    return {
        "version": DEMO_SEED_VERSION,
        "prefix": config.normalized_prefix,
        "gmail_base": config.gmail_base.strip().lower(),
    }


def get_athlete_personas() -> list[DemoPersona]:
    return [persona for persona in DEMO_PERSONAS if persona.is_athlete]


def _athlete_sequence(persona: DemoPersona) -> int:
    if not persona.key.startswith("athlete-"):
        return 0
    try:
        return int(persona.key.rsplit("-", 1)[1])
    except ValueError:
        return 0


def _running_distance_km(duration_minutes: int, pace_min_per_km: float) -> float:
    if pace_min_per_km <= 0:
        return round(duration_minutes / 5.5, 1)
    return round(duration_minutes / pace_min_per_km, 1)


def _cycling_distance_km(duration_minutes: int, speed_kmh: float) -> float:
    return round((duration_minutes / 60.0) * max(speed_kmh, 20.0), 1)


def _running_hr(persona: DemoPersona, intensity_fraction: float) -> int:
    max_hr = float(persona.max_hr or 188.0)
    resting_hr = float(persona.resting_hr or 46.0)
    return int(round(resting_hr + (max_hr - resting_hr) * intensity_fraction))


def _cycling_hr(persona: DemoPersona, intensity_fraction: float) -> int:
    return _running_hr(persona, intensity_fraction)


def _cycling_power(persona: DemoPersona, intensity_fraction: float) -> int:
    ftp = float(persona.ftp or 240.0)
    return int(round(ftp * intensity_fraction))


def _sport_title(persona: DemoPersona) -> str:
    return "Cycling" if persona.main_sport == "cycling" else "Running"


def _running_future_structures(persona: DemoPersona) -> list[list[dict[str, Any]]]:
    threshold_pace = max((persona.lt2 or 4.2) * 1.02, 3.6)
    return [
        [
            {"id": "easy-01", "type": "block", "category": "warmup", "duration": {"type": "time", "value": 900}, "target": {"type": "rpe", "value": 3}},
            {"id": "easy-02", "type": "block", "category": "work", "duration": {"type": "time", "value": 1800}, "target": {"type": "heart_rate_zone", "zone": 2}},
            {"id": "easy-03", "type": "block", "category": "work", "duration": {"type": "time", "value": 240}, "target": {"type": "rpe", "value": 6}},
            {"id": "easy-04", "type": "block", "category": "cooldown", "duration": {"type": "time", "value": 600}, "target": {"type": "rpe", "value": 2}},
        ],
        [
            {"id": "cruise-01", "type": "block", "category": "warmup", "duration": {"type": "time", "value": 900}, "target": {"type": "rpe", "value": 3}},
            {
                "id": "cruise-02",
                "type": "repeat",
                "repeats": 4,
                "steps": [
                    {"id": "cruise-02a", "type": "block", "category": "work", "duration": {"type": "time", "value": 480}, "target": {"type": "pace", "value": round(threshold_pace, 2), "unit": "min/km"}},
                    {"id": "cruise-02b", "type": "block", "category": "recovery", "duration": {"type": "time", "value": 150}, "target": {"type": "rpe", "value": 2}},
                ],
            },
            {"id": "cruise-03", "type": "block", "category": "cooldown", "duration": {"type": "time", "value": 600}, "target": {"type": "rpe", "value": 2}},
        ],
        [
            {"id": "long-01", "type": "block", "category": "work", "duration": {"type": "time", "value": 4200}, "target": {"type": "heart_rate_zone", "zone": 2}},
            {"id": "long-02", "type": "block", "category": "work", "duration": {"type": "time", "value": 900}, "target": {"type": "heart_rate_zone", "zone": 3}},
            {"id": "long-03", "type": "block", "category": "cooldown", "duration": {"type": "time", "value": 300}, "target": {"type": "rpe", "value": 2}},
        ],
        [
            {"id": "recovery-01", "type": "block", "category": "work", "duration": {"type": "time", "value": 2400}, "target": {"type": "rpe", "value": 2}},
        ],
    ]


def _cycling_future_structures(persona: DemoPersona) -> list[list[dict[str, Any]]]:
    ftp = float(persona.ftp or 240.0)
    return [
        [
            {"id": "spin-01", "type": "block", "category": "work", "duration": {"type": "time", "value": 3600}, "target": {"type": "power", "zone": 1}},
        ],
        [
            {"id": "sweet-01", "type": "block", "category": "warmup", "duration": {"type": "time", "value": 900}, "target": {"type": "power", "zone": 2}},
            {
                "id": "sweet-02",
                "type": "repeat",
                "repeats": 3,
                "steps": [
                    {"id": "sweet-02a", "type": "block", "category": "work", "duration": {"type": "time", "value": 720}, "target": {"type": "power", "value": 90, "unit": "percent_ftp"}},
                    {"id": "sweet-02b", "type": "block", "category": "recovery", "duration": {"type": "time", "value": 240}, "target": {"type": "power", "zone": 1}},
                ],
            },
            {"id": "sweet-03", "type": "block", "category": "cooldown", "duration": {"type": "time", "value": 600}, "target": {"type": "power", "zone": 1}},
        ],
        [
            {"id": "longride-01", "type": "block", "category": "work", "duration": {"type": "time", "value": 7200}, "target": {"type": "power", "zone": 2}},
            {"id": "longride-02", "type": "block", "category": "work", "duration": {"type": "time", "value": 1200}, "target": {"type": "power", "value": min(110, round((ftp * 0.84) / max(ftp, 1.0) * 100)), "unit": "percent_ftp"}},
        ],
        [
            {"id": "vo2-01", "type": "block", "category": "warmup", "duration": {"type": "time", "value": 900}, "target": {"type": "power", "zone": 2}},
            {
                "id": "vo2-02",
                "type": "repeat",
                "repeats": 5,
                "steps": [
                    {"id": "vo2-02a", "type": "block", "category": "work", "duration": {"type": "time", "value": 180}, "target": {"type": "power", "value": 112, "unit": "percent_ftp"}},
                    {"id": "vo2-02b", "type": "block", "category": "recovery", "duration": {"type": "time", "value": 180}, "target": {"type": "power", "zone": 1}},
                ],
            },
            {"id": "vo2-03", "type": "block", "category": "cooldown", "duration": {"type": "time", "value": 600}, "target": {"type": "power", "zone": 1}},
        ],
    ]


def build_workout_blueprints(persona: DemoPersona, anchor_date: date | None = None) -> list[WorkoutBlueprint]:
    del anchor_date
    if persona.main_sport == "cycling":
        future_structures = _cycling_future_structures(persona)
        return [
            WorkoutBlueprint("past-green", -12, "Endurance Ride", "Aerobic volume ride executed on rolling terrain.", "Cycling", 90, 46.0, "green"),
            WorkoutBlueprint("past-yellow", -8, "Steady Sweet Spot Ride", "Controlled effort with slight overrun late in the session.", "Cycling", 75, 39.0, "yellow"),
            WorkoutBlueprint("past-red", -5, "Threshold Session", "Session that started well but was cut short after fatigue built early.", "Cycling", 60, 34.0, "red"),
            WorkoutBlueprint("past-missed", -2, "Cadence Progression Ride", "Planned quality ride that was skipped during a busy work week.", "Cycling", 60, 31.0, "missed"),
            WorkoutBlueprint("future-01", 2, "Recovery Spin", "Low-stress ride to absorb recent quality and restore leg freshness.", "Cycling", 60, 28.0, "planned", "Recovery", future_structures[0]),
            WorkoutBlueprint("future-02", 5, "Sweet Spot 3x12", "Sustained work close to race demands without drifting above target power.", "Cycling", 78, 44.0, "planned", "Tempo", future_structures[1]),
            WorkoutBlueprint("future-03", 8, "Long Endurance Ride", "Steady-state endurance with late pressure on tired legs.", "Cycling", 150, 82.0, "planned", "Zone 2", future_structures[2]),
            WorkoutBlueprint("future-04", 12, "VO2 Build 5x3", "Short high-power repeats with full recoveries to sharpen race readiness.", "Cycling", 66, 35.0, "planned", "VO2", future_structures[3]),
        ]

    easy_pace = max((persona.lt2 or 4.3) * 1.18, 4.9)
    steady_pace = max((persona.lt2 or 4.3) * 1.08, 4.4)
    threshold_pace = max((persona.lt2 or 4.3) * 1.02, 4.1)
    future_structures = _running_future_structures(persona)
    return [
        WorkoutBlueprint("past-green", -12, "Aerobic Endurance Run", "Smooth aerobic run focused on rhythm and relaxed form.", "Running", 60, _running_distance_km(60, easy_pace), "green"),
        WorkoutBlueprint("past-yellow", -8, "Steady Tempo Run", "Slightly extended tempo run with good control until the final segment.", "Running", 60, _running_distance_km(60, steady_pace), "yellow"),
        WorkoutBlueprint("past-red", -5, "Threshold Session", "Workout that was shortened after the athlete failed to settle into the target rhythm.", "Running", 60, _running_distance_km(60, threshold_pace), "red"),
        WorkoutBlueprint("past-missed", -2, "Medium Long Run", "Planned medium-long run that was missed due to work and travel friction.", "Running", 50, _running_distance_km(50, easy_pace), "missed"),
        WorkoutBlueprint("future-01", 2, "Easy Run With Strides", "Low-cost aerobic run with short strides to keep cadence sharp.", "Running", 45, _running_distance_km(45, easy_pace), "planned", "Easy", future_structures[0]),
        WorkoutBlueprint("future-02", 5, "Cruise Intervals", "Threshold-focused session designed to bring race pace under better control.", "Running", 70, _running_distance_km(70, threshold_pace), "planned", "Threshold", future_structures[1]),
        WorkoutBlueprint("future-03", 8, "Long Run With Strong Finish", "Aerobic long run with a controlled pickup near marathon effort in the final block.", "Running", 95, _running_distance_km(95, easy_pace), "planned", "Endurance", future_structures[2]),
        WorkoutBlueprint("future-04", 12, "Recovery Jog", "Very light recovery run to freshen the legs before the next quality block.", "Running", 40, _running_distance_km(40, easy_pace * 1.05), "planned", "Recovery", future_structures[3]),
    ]


def build_activity_blueprints(persona: DemoPersona, anchor_date: date | None = None) -> list[ActivityBlueprint]:
    del anchor_date
    if persona.main_sport == "cycling":
        green_distance = _cycling_distance_km(90, 31.0)
        yellow_distance = _cycling_distance_km(86, 32.5)
        red_distance = _cycling_distance_km(20, 35.0)
        free_distance = _cycling_distance_km(72, 29.0)
        return [
            ActivityBlueprint("past-green-primary", -12, "Endurance Ride Completed", "Cycling", 90, green_distance, _cycling_hr(persona, 0.63), _cycling_power(persona, 0.64), 4, "Felt smooth throughout and stayed disciplined on the climbs.", None, "Garmin Edge 840"),
            ActivityBlueprint("past-yellow-primary", -8, "Sweet Spot Ride Completed", "Cycling", 86, yellow_distance, _cycling_hr(persona, 0.70), _cycling_power(persona, 0.78), 6, "Started under control and drifted a little long on the final block.", None, "Wahoo ROAM"),
            ActivityBlueprint("past-red-primary", -5, "Threshold Session Cut Short", "Cycling", 20, red_distance, _cycling_hr(persona, 0.78), _cycling_power(persona, 0.92), 8, "Legs were flat and the set was shut down after the second hard effort.", None, "Garmin Edge 840"),
            ActivityBlueprint("free-ride-primary", -1, "Aerobic Free Ride", "Cycling", 72, free_distance, _cycling_hr(persona, 0.60), _cycling_power(persona, 0.58), 3, "Unstructured endurance ride used to keep freshness without adding stress.", None, "Hammerhead Karoo", True),
            ActivityBlueprint("past-green-duplicate", -12, "Endurance Ride Secondary Recording", "Cycling", 90, green_distance, _cycling_hr(persona, 0.63), _cycling_power(persona, 0.63), 4, "Duplicate head-unit recording from the same endurance session.", "past-green-primary", "Apple Watch Ultra"),
            ActivityBlueprint("past-yellow-duplicate", -8, "Sweet Spot Ride Secondary Recording", "Cycling", 86, yellow_distance, _cycling_hr(persona, 0.70), _cycling_power(persona, 0.77), 6, "Duplicate watch file captured during the same sweet spot session.", "past-yellow-primary", "Garmin Forerunner 965"),
        ]

    easy_pace = max((persona.lt2 or 4.3) * 1.20, 5.0)
    steady_pace = max((persona.lt2 or 4.3) * 1.07, 4.5)
    hard_pace = max((persona.lt2 or 4.3) * 0.96, 4.0)
    free_pace = max((persona.lt2 or 4.3) * 1.16, 4.8)
    green_distance = _running_distance_km(60, easy_pace)
    yellow_distance = _running_distance_km(70, steady_pace)
    red_distance = _running_distance_km(20, hard_pace)
    free_distance = _running_distance_km(45, free_pace)
    return [
        ActivityBlueprint("past-green-primary", -12, "Aerobic Run Completed", "Running", 60, green_distance, _running_hr(persona, 0.64), None, 4, "Comfortable aerobic run with steady breathing and no mechanical issues.", None, "Garmin Forerunner 965"),
        ActivityBlueprint("past-yellow-primary", -8, "Tempo Run Completed", "Running", 70, yellow_distance, _running_hr(persona, 0.72), None, 6, "Progressed well but spilled slightly over the target duration on the final segment.", None, "COROS Pace 3"),
        ActivityBlueprint("past-red-primary", -5, "Threshold Run Cut Short", "Running", 20, red_distance, _running_hr(persona, 0.82), None, 8, "Session was cut short after the athlete never found the planned rhythm.", None, "Garmin Forerunner 965"),
        ActivityBlueprint("free-run-primary", -1, "Easy Free Run", "Running", 45, free_distance, _running_hr(persona, 0.60), None, 3, "Light aerobic run outside the formal plan to stay loose before the next block.", None, "Apple Watch", True),
        ActivityBlueprint("past-green-duplicate", -12, "Aerobic Run Secondary Recording", "Running", 60, green_distance, _running_hr(persona, 0.64), None, 4, "Duplicate watch capture from the same aerobic session.", "past-green-primary", "Apple Watch Ultra"),
        ActivityBlueprint("past-yellow-duplicate", -8, "Tempo Run Secondary Recording", "Running", 70, yellow_distance, _running_hr(persona, 0.72), None, 6, "Duplicate chest-strap-linked file from the same tempo session.", "past-yellow-primary", "Polar Vantage V3"),
    ]


def build_goal_race_payloads(persona: DemoPersona, anchor_date: date) -> list[dict[str, Any]]:
    return [
        {
            "name": race.name,
            "date": (anchor_date + timedelta(days=race.day_offset)).isoformat(),
            "priority": race.priority,
            "sport_type": _sport_title(persona),
            "distance_km": race.distance_km,
            "expected_time": race.expected_time,
            "location": race.location,
            "notes": race.notes,
            "target_metrics": [
                {"metric": metric, "value": value, "unit": unit}
                for metric, value, unit in persona.target_metrics
            ],
        }
        for race in persona.goal_races
    ]


def build_season_plan_payload(persona: DemoPersona, anchor_date: date) -> dict[str, Any]:
    periodization = persona.periodization or PeriodizationTemplate(7, 120, 5, 4, "standard", "pyramidal")
    return {
        "name": f"{persona.first_name} {persona.last_name} Summer Campaign",
        "sport_type": _sport_title(persona),
        "season_start": (anchor_date - timedelta(days=14)).isoformat(),
        "season_end": (anchor_date + timedelta(days=70)).isoformat(),
        "notes": persona.narrative,
        "target_metrics": [
            {"metric": metric, "value": value, "unit": unit}
            for metric, value, unit in persona.target_metrics
        ],
        "goal_races": build_goal_race_payloads(persona, anchor_date),
        "constraints": [],
        "periodization": {
            "weekly_hours_target": periodization.weekly_hours_target,
            "longest_session_minutes": periodization.longest_session_minutes,
            "training_days_per_week": periodization.training_days_per_week,
            "recovery_week_frequency": periodization.recovery_week_frequency,
            "taper_profile": periodization.taper_profile,
            "periodization_model": periodization.periodization_model,
        },
    }


def _chat_created_at(days_ago: int, hour: int, minute: int) -> datetime:
    return datetime.combine(
        date.today() - timedelta(days=max(days_ago, 0)),
        time(hour=hour % 24, minute=minute % 60),
    )


def build_group_chat_blueprints() -> list[OrganizationGroupMessageBlueprint]:
    return [
        OrganizationGroupMessageBlueprint(
            sender_key="coach",
            body="Weekly focus stays on clean execution. Please leave short notes after uploads so I can compare planned versus completed work without guessing.",
            days_ago=6,
            hour=8,
            minute=5,
        ),
        OrganizationGroupMessageBlueprint(
            sender_key="admin",
            body="Emergency contacts and consent records are current. If travel or equipment logistics changed, send me a direct message so I can update the demo roster notes.",
            days_ago=6,
            hour=8,
            minute=37,
        ),
        OrganizationGroupMessageBlueprint(
            sender_key="athlete-01",
            body="Half-marathon pacing felt smoother after the weekend aerobic run. I will keep Thursday's cruise intervals conservative on the opening rep.",
            days_ago=5,
            hour=18,
            minute=12,
        ),
        OrganizationGroupMessageBlueprint(
            sender_key="coach",
            body="Exactly. The first rep should feel almost too easy. The point is to lock rhythm before the race-specific work starts to bite.",
            days_ago=5,
            hour=18,
            minute=41,
        ),
        OrganizationGroupMessageBlueprint(
            sender_key="athlete-02",
            body="Gran fondo fueling went better with smaller, earlier sips. I also uploaded the head-unit duplicate so the workflow demo shows both device records.",
            days_ago=4,
            hour=19,
            minute=8,
        ),
        OrganizationGroupMessageBlueprint(
            sender_key="admin",
            body="Perfect. Duplicate uploads are useful for the demo as long as the primary file is still the one referenced during analysis.",
            days_ago=4,
            hour=19,
            minute=34,
        ),
        OrganizationGroupMessageBlueprint(
            sender_key="athlete-07",
            body="Trail shoes handled wet gravel well this morning. Descents were much calmer once cadence stayed high instead of forcing the pace.",
            days_ago=2,
            hour=7,
            minute=46,
        ),
        OrganizationGroupMessageBlueprint(
            sender_key="coach",
            body="Good note. Keep the same discipline this week and protect the recovery days, especially before the A-race rehearsal sessions.",
            days_ago=2,
            hour=8,
            minute=3,
        ),
    ]


def build_coach_chat_blueprints(persona: DemoPersona) -> list[OrganizationCoachMessageBlueprint]:
    athlete_index = max(1, _athlete_sequence(persona))
    review_activity = next(
        (item for item in build_activity_blueprints(persona) if item.key == "past-yellow-primary"),
        build_activity_blueprints(persona)[0],
    )
    quality_workout = next(
        (item for item in build_workout_blueprints(persona) if item.key == "future-02"),
        build_workout_blueprints(persona)[0],
    )
    goal_race_name = persona.goal_races[-1].name if persona.goal_races else f"{persona.display_name} target race"
    base_day = 6 - ((athlete_index - 1) % 4)
    review_hour = 7 + ((athlete_index - 1) % 3)
    reply_hour = 18 + ((athlete_index - 1) % 2)
    follow_up_day = max(base_day - 1, 0)

    if persona.main_sport == "cycling":
        coach_open = (
            f"I reviewed the {review_activity.title.lower()} file. Keep {quality_workout.title.lower()} controlled through the first interval and save the last set for clean cadence."
        )
        athlete_reply = "Understood. Legs felt better after the recovery spin and fueling is set so the second half stays steady."
        coach_follow_up = (
            f"Good. This block is about arriving at {goal_race_name} with repeatable power, not forcing hero numbers in training."
        )
        athlete_close = "Copy. I will cap the opener, note bottle timing in the upload, and send comments right after the ride."
    else:
        coach_open = (
            f"I reviewed the {review_activity.title.lower()} upload. Keep {quality_workout.title.lower()} relaxed early and do not chase pace in the first block."
        )
        athlete_reply = "Understood. Breathing has settled faster this week and the legs feel less stale than before the last threshold session."
        coach_follow_up = (
            f"Good. The goal is to stack clean work ahead of {goal_race_name}, not to turn a training day into a race."
        )
        athlete_close = "Copy. I will keep the opener conservative, note shoe choice and surface, and upload comments right after the run."

    return [
        OrganizationCoachMessageBlueprint(
            athlete_key=persona.key,
            sender_key="coach",
            body=coach_open,
            days_ago=base_day,
            hour=review_hour,
            minute=8 + athlete_index,
        ),
        OrganizationCoachMessageBlueprint(
            athlete_key=persona.key,
            sender_key=persona.key,
            body=athlete_reply,
            days_ago=base_day,
            hour=reply_hour,
            minute=20 + athlete_index,
        ),
        OrganizationCoachMessageBlueprint(
            athlete_key=persona.key,
            sender_key="coach",
            body=coach_follow_up,
            days_ago=follow_up_day,
            hour=6 + ((athlete_index - 1) % 2),
            minute=39 + athlete_index,
        ),
        OrganizationCoachMessageBlueprint(
            athlete_key=persona.key,
            sender_key=persona.key,
            body=athlete_close,
            days_ago=follow_up_day,
            hour=20,
            minute=6 + athlete_index,
        ),
    ]


def build_direct_chat_blueprints() -> list[OrganizationDirectMessageBlueprint]:
    return [
        OrganizationDirectMessageBlueprint(
            sender_key="admin",
            recipient_key="coach",
            body="I verified the demo credentials and support notes. Let me know before you start the organization walkthrough.",
            days_ago=5,
            hour=9,
            minute=10,
        ),
        OrganizationDirectMessageBlueprint(
            sender_key="coach",
            recipient_key="admin",
            body="Received. I will start with the roster, then calendar, then the private athlete threads.",
            days_ago=5,
            hour=9,
            minute=28,
        ),
        OrganizationDirectMessageBlueprint(
            sender_key="admin",
            recipient_key="coach",
            body="Perfect. If duplicate files come up, I already flagged which upload should be treated as the primary analysis record.",
            days_ago=4,
            hour=16,
            minute=12,
        ),
        OrganizationDirectMessageBlueprint(
            sender_key="coach",
            recipient_key="admin",
            body="That helps. I will also point out that all demo emails are plus-addressed and already verified.",
            days_ago=4,
            hour=16,
            minute=39,
        ),
        OrganizationDirectMessageBlueprint(
            sender_key="admin",
            recipient_key="athlete-03",
            body="Your race-week logistics are set. Bib pickup opens at 07:30 and parking is easiest from the south entrance.",
            days_ago=3,
            hour=11,
            minute=5,
        ),
        OrganizationDirectMessageBlueprint(
            sender_key="athlete-03",
            recipient_key="admin",
            body="Thanks. I added that to my notes and will travel the night before so the morning stays quiet.",
            days_ago=3,
            hour=11,
            minute=34,
        ),
        OrganizationDirectMessageBlueprint(
            sender_key="admin",
            recipient_key="athlete-06",
            body="I checked the TT start list. Your slot is still 09:12, so there is no need to rush warm-up timing.",
            days_ago=2,
            hour=14,
            minute=18,
        ),
        OrganizationDirectMessageBlueprint(
            sender_key="athlete-06",
            recipient_key="admin",
            body="Perfect. I can keep the usual opener and avoid cutting the final cadence block short.",
            days_ago=2,
            hour=14,
            minute=47,
        ),
    ]


def _estimate_activity_load(activity: Activity, profile: Profile | None) -> tuple[float, float]:
    if profile is not None and _existing_activity_training_load is not None:
        try:
            aerobic_load, anaerobic_load = _existing_activity_training_load(
                activity,
                float(getattr(profile, "ftp", 0.0) or 0.0),
                float(getattr(profile, "max_hr", 0.0) or 0.0),
                profile,
            )
            return float(aerobic_load or 0.0), float(anaerobic_load or 0.0)
        except Exception:
            pass

    duration_minutes = float(activity.duration or 0.0) / 60.0
    if duration_minutes <= 0:
        return 0.0, 0.0
    sport = str(activity.sport or "").lower()
    if "cycl" in sport:
        ftp = float(getattr(profile, "ftp", 0.0) or 0.0)
        avg_power = float(activity.average_watts or 0.0)
        intensity = avg_power / ftp if ftp > 0 and avg_power > 0 else 0.62
    else:
        max_hr = float(getattr(profile, "max_hr", 0.0) or 0.0)
        avg_hr = float(activity.average_hr or 0.0)
        intensity = avg_hr / max_hr if max_hr > 0 and avg_hr > 0 else 0.66
    aerobic = round(duration_minutes * max(0.35, min(intensity, 1.15)) * 0.95, 1)
    anaerobic = round(duration_minutes * max(0.0, intensity - 0.75) * 0.6, 1)
    return aerobic, anaerobic


def _build_org_code(prefix: str) -> str:
    return f"D{hashlib.sha1(prefix.encode('utf-8')).hexdigest()[:7].upper()}"


def _build_invite_token(prefix: str, athlete_key: str) -> str:
    return hashlib.sha1(f"{prefix}:{athlete_key}".encode("utf-8")).hexdigest()[:32]


def _find_org_marker_prefix(org: Organization | None) -> str | None:
    if not org or not isinstance(org.settings_json, dict):
        return None
    demo_seed = org.settings_json.get("demo_seed")
    if not isinstance(demo_seed, dict):
        return None
    prefix = demo_seed.get("prefix")
    return str(prefix) if prefix else None


def _build_org_settings(config: DemoSeedConfig, coach_id: int, admin_id: int, managed_emails: list[str]) -> dict[str, Any]:
    return {
        "admin_ids": [coach_id, admin_id],
        "creator_id": coach_id,
        "demo_seed": {
            "version": DEMO_SEED_VERSION,
            "prefix": config.normalized_prefix,
            "managed_emails": managed_emails,
            "generated_at": datetime.utcnow().isoformat(timespec="seconds"),
        },
    }


def _build_profile_updates(persona: DemoPersona) -> dict[str, Any]:
    return {
        "first_name": persona.first_name,
        "last_name": persona.last_name,
        "gender": persona.gender,
        "birth_date": persona.birth_date,
        "weight": persona.weight,
        "ftp": persona.ftp,
        "lt2": persona.lt2,
        "max_hr": persona.max_hr,
        "resting_hr": persona.resting_hr,
        "sports": list(persona.sports),
        "main_sport": persona.main_sport,
        "timezone": persona.timezone,
        "country": persona.country,
        "preferred_language": persona.preferred_language,
        "preferred_units": persona.preferred_units,
        "week_start_day": persona.week_start_day,
        "training_days": list(persona.training_days),
    }


def _build_manual_streams(
    *,
    marker: dict[str, Any],
    blueprint: ActivityBlueprint,
    avg_speed: float | None,
) -> dict[str, Any]:
    max_hr = round((blueprint.average_hr or 0) * 1.06) if blueprint.average_hr else None
    max_watts = round((blueprint.average_watts or 0) * 1.12) if blueprint.average_watts else None
    return {
        "data": [],
        "power_curve": None,
        "hr_zones": None,
        "pace_curve": None,
        "laps": None,
        "splits_metric": None,
        "best_efforts": None,
        "_meta": {
            "deleted": False,
            "manual": True,
            "demo_seed": marker,
            "recording_device": blueprint.device_name,
            "session_key": blueprint.key,
            "notes": blueprint.notes,
        },
        "stats": {
            "max_hr": max_hr,
            "max_speed": round((avg_speed or 0.0) * 1.1, 2) if avg_speed else None,
            "max_watts": max_watts,
            "max_cadence": 96 if blueprint.sport.lower() == "cycling" else 184,
            "avg_cadence": 88 if blueprint.sport.lower() == "cycling" else 172,
            "total_elevation_gain": 64 if blueprint.sport.lower() == "cycling" else 22,
            "total_calories": int(max(180, blueprint.duration_minutes * 10)),
        },
    }


def _normalize_sport_name(raw_sport: str | None) -> str:
    text = str(raw_sport or "").strip().lower()
    if "cycl" in text or "bike" in text or "ride" in text:
        return "cycling"
    if "run" in text or "jog" in text:
        return "running"
    return text or "other"


def load_parsed_activity_templates(activity_dir: Path) -> dict[str, list[ParsedActivityTemplate]]:
    if not activity_dir.exists() or not activity_dir.is_dir():
        return {}
    parsed_by_sport: dict[str, list[ParsedActivityTemplate]] = {}
    for file_path in sorted(activity_dir.iterdir(), key=lambda item: item.name.lower()):
        if not file_path.is_file() or file_path.suffix.lower() not in {".fit", ".gpx"}:
            continue
        try:
            parsed = parse_activity_file(str(file_path), file_path.suffix.lower().lstrip("."))
        except Exception:
            continue
        if not parsed:
            continue
        sport_key = _normalize_sport_name(parsed.get("sport"))
        if sport_key not in {"running", "cycling"}:
            continue
        summary = parsed.get("summary") if isinstance(parsed.get("summary"), dict) else {}
        stats = {
            "max_hr": summary.get("max_hr"),
            "max_speed": summary.get("max_speed"),
            "max_watts": summary.get("max_watts"),
            "max_cadence": summary.get("max_cadence"),
            "avg_cadence": summary.get("avg_cadence"),
            "total_elevation_gain": summary.get("total_elevation_gain"),
            "total_calories": summary.get("total_calories"),
            "total_timer_time": summary.get("total_timer_time") or summary.get("duration"),
        }
        parsed_by_sport.setdefault(sport_key, []).append(
            ParsedActivityTemplate(
                source_path=file_path,
                sport=sport_key,
                summary=summary,
                stream_points=list(parsed.get("streams") or []),
                power_curve=parsed.get("power_curve") if isinstance(parsed.get("power_curve"), dict) else None,
                hr_zones=parsed.get("hr_zones"),
                pace_curve=parsed.get("pace_curve") if isinstance(parsed.get("pace_curve"), dict) else None,
                laps=parsed.get("laps") if isinstance(parsed.get("laps"), list) else None,
                splits_metric=parsed.get("splits_metric") if isinstance(parsed.get("splits_metric"), list) else None,
                stats=stats,
            )
        )
    return parsed_by_sport


async def _load_demo_org(db: AsyncSession, config: DemoSeedConfig) -> Organization | None:
    result = await db.execute(select(Organization))
    orgs = result.scalars().all()
    by_prefix = next((org for org in orgs if _find_org_marker_prefix(org) == config.normalized_prefix), None)
    by_name = next((org for org in orgs if org.name == config.organization_name), None)
    if by_prefix and by_name and by_prefix.id != by_name.id:
        raise RuntimeError("Alias prefix and organization name resolve to different organizations")
    if by_prefix:
        return by_prefix
    if by_name and _find_org_marker_prefix(by_name) not in {None, config.normalized_prefix}:
        raise RuntimeError("Refusing to reuse an organization name already owned by a different demo seed prefix")
    if by_name and _find_org_marker_prefix(by_name) is None:
        raise RuntimeError("Refusing to mutate an existing non-demo organization with the requested name")
    return by_name


async def _upsert_users_profiles_org(
    db: AsyncSession,
    config: DemoSeedConfig,
    account_specs: list[DemoAccountSpec],
) -> tuple[Organization, dict[str, User], dict[int, Profile], list[SeedCredentialResult]]:
    existing_users_result = await db.execute(
        select(User).where(User.email.in_([spec.email for spec in account_specs]))
    )
    existing_by_email = {user.email: user for user in existing_users_result.scalars().all()}

    users_by_key: dict[str, User] = {}
    credentials: list[SeedCredentialResult] = []

    for spec in account_specs:
        user = existing_by_email.get(spec.email)
        password: str | None = None
        if user is None:
            password = generate_secure_password()
            user = User(
                email=spec.email,
                password_hash=get_password_hash(password),
                email_verified=True,
                role=spec.persona.role,
            )
            db.add(user)
            await db.flush()
            password_status = "generated"
        else:
            if config.preserve_existing_passwords:
                password_status = "preserved_existing"
            else:
                password = generate_secure_password()
                user.password_hash = get_password_hash(password)
                password_status = "rotated"

        user.email = spec.email
        user.role = spec.persona.role
        user.email_verified = True
        user.email_verification_code = None
        user.email_verification_expires_at = None
        db.add(user)
        users_by_key[spec.persona.key] = user
        credentials.append(
            SeedCredentialResult(
                key=spec.persona.key,
                role=spec.persona.role.value,
                email=spec.email,
                password_status=password_status,
                password=password,
            )
        )

    profile_result = await db.execute(
        select(Profile).where(Profile.user_id.in_([user.id for user in users_by_key.values()]))
    )
    profiles_by_user_id = {profile.user_id: profile for profile in profile_result.scalars().all()}

    for spec in account_specs:
        user = users_by_key[spec.persona.key]
        profile = profiles_by_user_id.get(user.id)
        if profile is None:
            profile = Profile(user_id=user.id)
            db.add(profile)
            profiles_by_user_id[user.id] = profile

        for field_name, field_value in _build_profile_updates(spec.persona).items():
            setattr(profile, field_name, field_value)
        db.add(profile)

    org = await _load_demo_org(db, config)
    if org is None:
        org = Organization(
            name=config.organization_name,
            code=_build_org_code(config.normalized_prefix),
            description="Production-safe demonstration organization populated with fictional endurance athletes.",
            settings_json={},
        )
        db.add(org)
        await db.flush()

    coach = users_by_key["coach"]
    admin = users_by_key["admin"]
    org.name = config.organization_name
    org.code = org.code or _build_org_code(config.normalized_prefix)
    org.description = "Production-safe demonstration organization populated with fictional endurance athletes."
    org.settings_json = _build_org_settings(config, coach.id, admin.id, [spec.email for spec in account_specs])
    db.add(org)
    await db.flush()

    membership_result = await db.execute(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org.id,
            OrganizationMember.user_id.in_([user.id for user in users_by_key.values()]),
        )
    )
    memberships_by_user_id = {membership.user_id: membership for membership in membership_result.scalars().all()}

    for spec in account_specs:
        user = users_by_key[spec.persona.key]
        membership = memberships_by_user_id.get(user.id)
        if membership is None:
            membership = OrganizationMember(user_id=user.id, organization_id=org.id, role=spec.persona.org_role, status="active")
            db.add(membership)
        membership.role = spec.persona.org_role
        membership.status = "active"
        if spec.persona.role == RoleEnum.athlete:
            membership.athlete_data_sharing_consent = True
            membership.athlete_data_sharing_consented_at = datetime.utcnow()
            membership.athlete_data_sharing_consent_version = DEMO_SEED_VERSION
        db.add(membership)

    athlete_ids = [users_by_key[persona.key].id for persona in get_athlete_personas()]
    link_result = await db.execute(
        select(CoachAthleteLink).where(
            CoachAthleteLink.coach_id == coach.id,
            CoachAthleteLink.athlete_id.in_(athlete_ids),
        )
    )
    links_by_athlete_id = {link.athlete_id: link for link in link_result.scalars().all()}
    for persona in get_athlete_personas():
        athlete = users_by_key[persona.key]
        link = links_by_athlete_id.get(athlete.id)
        if link is None:
            link = CoachAthleteLink(coach_id=coach.id, athlete_id=athlete.id, is_active=True, invite_token=_build_invite_token(config.normalized_prefix, persona.key))
            db.add(link)
        link.coach_id = coach.id
        link.athlete_id = athlete.id
        link.is_active = True
        link.invite_token = _build_invite_token(config.normalized_prefix, persona.key)
        db.add(link)

    await db.flush()
    return org, users_by_key, profiles_by_user_id, credentials


async def _clear_demo_training_slice(db: AsyncSession, athlete_ids: list[int]) -> None:
    if not athlete_ids:
        return
    await db.execute(delete(PlannedWorkoutVersion).where(PlannedWorkoutVersion.workout_user_id.in_(athlete_ids)))
    await db.execute(delete(PlannedWorkout).where(PlannedWorkout.user_id.in_(athlete_ids)))
    await db.execute(delete(SeasonPlan).where(SeasonPlan.athlete_id.in_(athlete_ids)))
    await db.execute(delete(Activity).where(Activity.athlete_id.in_(athlete_ids)))
    await db.flush()


async def _clear_demo_chat_slice(
    db: AsyncSession,
    *,
    organization_id: int,
    demo_user_ids: list[int],
    coach_id: int,
    athlete_ids: list[int],
) -> None:
    if not demo_user_ids:
        return
    await db.execute(
        delete(OrganizationGroupMessage).where(
            OrganizationGroupMessage.organization_id == organization_id,
            OrganizationGroupMessage.sender_id.in_(demo_user_ids),
        )
    )
    if athlete_ids:
        await db.execute(
            delete(OrganizationCoachMessage).where(
                OrganizationCoachMessage.organization_id == organization_id,
                OrganizationCoachMessage.athlete_id.in_(athlete_ids),
                OrganizationCoachMessage.coach_id == coach_id,
                OrganizationCoachMessage.sender_id.in_(demo_user_ids),
            )
        )
    await db.execute(
        delete(OrganizationDirectMessage).where(
            OrganizationDirectMessage.organization_id == organization_id,
            OrganizationDirectMessage.sender_id.in_(demo_user_ids),
            OrganizationDirectMessage.recipient_id.in_(demo_user_ids),
        )
    )
    await db.flush()


def _activity_datetime_for_offset(day_offset: int, sequence_index: int) -> datetime:
    hour = 6 + max(0, sequence_index % 5)
    minute = 10 + (sequence_index % 4) * 7
    return datetime.combine(date.today() + timedelta(days=day_offset), time(hour=hour, minute=minute))


def _build_parsed_streams(template: ParsedActivityTemplate, marker: dict[str, Any], blueprint: ActivityBlueprint) -> dict[str, Any]:
    best_efforts = compute_activity_best_efforts(template.stream_points, template.sport)
    return {
        "data": template.stream_points,
        "power_curve": template.power_curve,
        "hr_zones": template.hr_zones,
        "pace_curve": template.pace_curve,
        "laps": template.laps,
        "splits_metric": template.splits_metric,
        "best_efforts": best_efforts,
        "_meta": {
            "deleted": False,
            "demo_seed": marker,
            "recording_device": blueprint.device_name,
            "template_file": template.source_path.name,
            "session_key": blueprint.key,
        },
        "stats": dict(template.stats),
    }


def _create_activity_from_blueprint(
    *,
    athlete_id: int,
    persona: DemoPersona,
    profile: Profile,
    config: DemoSeedConfig,
    marker: dict[str, Any],
    blueprint: ActivityBlueprint,
    sequence_index: int,
    parsed_templates: dict[str, list[ParsedActivityTemplate]],
) -> Activity:
    local_date = date.today() + timedelta(days=blueprint.day_offset)
    created_at = _activity_datetime_for_offset(blueprint.day_offset, sequence_index)
    distance_m = blueprint.distance_km * 1000.0 if blueprint.distance_km is not None else None
    duration_s = float(blueprint.duration_minutes * 60)
    avg_speed = (distance_m / duration_s) if distance_m and duration_s > 0 else None

    streams = _build_manual_streams(marker=marker, blueprint=blueprint, avg_speed=avg_speed)
    file_type = "manual"
    filename = f"{blueprint.title}.manual"
    file_path = f"demo-seed/{config.normalized_prefix}/{persona.key}/{blueprint.key}.manual"

    if blueprint.prefer_parsed_template:
        available = parsed_templates.get(_normalize_sport_name(blueprint.sport), [])
        if available:
            template = available[sequence_index % len(available)]
            streams = _build_parsed_streams(template, marker, blueprint)
            template_distance = template.summary.get("distance")
            template_duration = template.summary.get("duration")
            if distance_m is None and template_distance:
                distance_m = float(template_distance)
            if duration_s <= 0 and template_duration:
                duration_s = float(template_duration)
            avg_speed = (distance_m / duration_s) if distance_m and duration_s > 0 else avg_speed
            file_type = template.source_path.suffix.lower().lstrip(".")
            filename = blueprint.title
            file_path = f"demo-seed/{config.normalized_prefix}/{persona.key}/{template.source_path.name}"

    activity = Activity(
        athlete_id=athlete_id,
        filename=filename,
        file_path=file_path,
        file_type=file_type,
        sport=blueprint.sport,
        created_at=created_at,
        distance=distance_m,
        duration=duration_s,
        avg_speed=avg_speed,
        average_hr=blueprint.average_hr,
        average_watts=blueprint.average_watts,
        rpe=blueprint.rpe,
        notes=blueprint.notes,
        streams=streams,
        local_date=local_date,
        moving_time=duration_s,
    )
    activity.aerobic_load, activity.anaerobic_load = _estimate_activity_load(activity, profile)
    return activity


async def _seed_athlete_training_data(
    db: AsyncSession,
    *,
    config: DemoSeedConfig,
    coach: User,
    athlete: User,
    profile: Profile,
    persona: DemoPersona,
    parsed_templates: dict[str, list[ParsedActivityTemplate]],
) -> dict[str, int]:
    marker = build_seed_marker(config)
    season_payload = build_season_plan_payload(persona, date.today())
    preview = build_generated_workouts(season_payload, profile)
    preview = dict(preview)
    preview["demo_seed"] = marker

    plan = SeasonPlan(
        athlete_id=athlete.id,
        coach_id=coach.id,
        name=season_payload["name"],
        sport_type=season_payload["sport_type"],
        season_start=date.fromisoformat(season_payload["season_start"]),
        season_end=date.fromisoformat(season_payload["season_end"]),
        notes=season_payload["notes"],
        target_metrics=season_payload["target_metrics"],
        goal_races=season_payload["goal_races"],
        constraints=season_payload["constraints"],
        periodization=season_payload["periodization"],
        generated_summary=preview,
    )
    db.add(plan)
    await db.flush()

    workout_blueprints = build_workout_blueprints(persona, date.today())
    for workout_blueprint in workout_blueprints:
        planning_context = {
            "demo_seed": marker,
            "target_status": workout_blueprint.target_status,
            "persona_key": persona.key,
        }
        workout = PlannedWorkout(
            user_id=athlete.id,
            created_by_user_id=coach.id,
            season_plan_id=plan.id,
            date=date.today() + timedelta(days=workout_blueprint.day_offset),
            title=workout_blueprint.title,
            description=workout_blueprint.description,
            sport_type=workout_blueprint.sport_type,
            planned_duration=workout_blueprint.planned_duration,
            planned_distance=workout_blueprint.planned_distance,
            planned_intensity=workout_blueprint.planned_intensity,
            structure=workout_blueprint.structure,
            planning_context=planning_context,
            compliance_status=ComplianceStatusEnum.planned,
        )
        db.add(workout)

    activity_blueprints = build_activity_blueprints(persona, date.today())
    created_by_key: dict[str, Activity] = {}
    duplicate_blueprints: list[ActivityBlueprint] = []

    for sequence_index, activity_blueprint in enumerate(activity_blueprints):
        if activity_blueprint.duplicate_of_key:
            duplicate_blueprints.append(activity_blueprint)
            continue
        activity = _create_activity_from_blueprint(
            athlete_id=athlete.id,
            persona=persona,
            profile=profile,
            config=config,
            marker=marker,
            blueprint=activity_blueprint,
            sequence_index=sequence_index,
            parsed_templates=parsed_templates,
        )
        db.add(activity)
        await db.flush()
        created_by_key[activity_blueprint.key] = activity

    for sequence_index, activity_blueprint in enumerate(duplicate_blueprints, start=len(created_by_key)):
        primary = created_by_key.get(activity_blueprint.duplicate_of_key or "")
        if primary is None:
            continue
        duplicate = _create_activity_from_blueprint(
            athlete_id=athlete.id,
            persona=persona,
            profile=profile,
            config=config,
            marker=marker,
            blueprint=activity_blueprint,
            sequence_index=sequence_index,
            parsed_templates=parsed_templates,
        )
        duplicate.duplicate_of_id = primary.id
        if isinstance(duplicate.streams, dict):
            duplicate_meta = dict(duplicate.streams.get("_meta") or {})
            duplicate_meta["duplicate_of_id"] = primary.id
            duplicate_meta["duplicate_type"] = "secondary_recording"
            duplicate.streams = {**duplicate.streams, "_meta": duplicate_meta}
        db.add(duplicate)

    await db.flush()
    past_dates = {
        date.today() + timedelta(days=workout.day_offset)
        for workout in workout_blueprints
        if workout.day_offset < 0
    }
    return {
        "season_plans": 1,
        "planned_workouts": len(workout_blueprints),
        "activities": len(activity_blueprints),
        "duplicates": len([item for item in activity_blueprints if item.duplicate_of_key]),
        "past_dates": len(past_dates),
    }


async def _seed_organization_chat_data(
    db: AsyncSession,
    *,
    organization: Organization,
    users_by_key: dict[str, User],
) -> dict[str, int]:
    counts = {
        "group_messages": 0,
        "coach_messages": 0,
        "direct_messages": 0,
    }

    for blueprint in build_group_chat_blueprints():
        db.add(
            OrganizationGroupMessage(
                organization_id=organization.id,
                sender_id=users_by_key[blueprint.sender_key].id,
                body=blueprint.body,
                created_at=_chat_created_at(blueprint.days_ago, blueprint.hour, blueprint.minute),
            )
        )
        counts["group_messages"] += 1

    coach = users_by_key["coach"]
    for persona in get_athlete_personas():
        athlete = users_by_key[persona.key]
        for blueprint in build_coach_chat_blueprints(persona):
            db.add(
                OrganizationCoachMessage(
                    organization_id=organization.id,
                    athlete_id=athlete.id,
                    coach_id=coach.id,
                    sender_id=users_by_key[blueprint.sender_key].id,
                    body=blueprint.body,
                    created_at=_chat_created_at(blueprint.days_ago, blueprint.hour, blueprint.minute),
                )
            )
            counts["coach_messages"] += 1

    for blueprint in build_direct_chat_blueprints():
        db.add(
            OrganizationDirectMessage(
                organization_id=organization.id,
                sender_id=users_by_key[blueprint.sender_key].id,
                recipient_id=users_by_key[blueprint.recipient_key].id,
                body=blueprint.body,
                created_at=_chat_created_at(blueprint.days_ago, blueprint.hour, blueprint.minute),
            )
        )
        counts["direct_messages"] += 1

    await db.flush()
    return counts


async def seed_production_demo(config: DemoSeedConfig) -> DemoSeedReport:
    ensure_mutation_allowed(config)
    account_specs = build_account_specs(config)
    athlete_personas = get_athlete_personas()
    group_message_count = len(build_group_chat_blueprints())
    coach_message_count = sum(len(build_coach_chat_blueprints(persona)) for persona in athlete_personas)
    direct_message_count = len(build_direct_chat_blueprints())
    if config.dry_run:
        return DemoSeedReport(
            action="seed",
            prefix=config.normalized_prefix,
            organization_name=config.organization_name,
            dry_run=True,
            accounts=[
                {
                    "key": spec.persona.key,
                    "name": spec.persona.display_name,
                    "role": spec.persona.role.value,
                    "organization_role": spec.persona.org_role,
                    "email": spec.email,
                }
                for spec in account_specs
            ],
            counts={
                "users": len(account_specs),
                "athletes": len(athlete_personas),
                "season_plans": len(athlete_personas),
                "planned_workouts": len(athlete_personas) * 8,
                "activities": len(athlete_personas) * 6,
                "duplicates": len(athlete_personas) * 2,
                "group_messages": group_message_count,
                "coach_messages": coach_message_count,
                "direct_messages": direct_message_count,
            },
        )

    parsed_templates = load_parsed_activity_templates(config.activity_source_dir)
    async with AsyncSessionLocal() as db:
        org, users_by_key, profiles_by_user_id, credentials = await _upsert_users_profiles_org(db, config, account_specs)
        athlete_ids = [users_by_key[persona.key].id for persona in athlete_personas]
        coach = users_by_key["coach"]
        demo_user_ids = [user.id for user in users_by_key.values()]
        await _clear_demo_training_slice(db, athlete_ids)
        await _clear_demo_chat_slice(
            db,
            organization_id=org.id,
            demo_user_ids=demo_user_ids,
            coach_id=coach.id,
            athlete_ids=athlete_ids,
        )

        counts = {
            "users": len(account_specs),
            "athletes": len(athlete_personas),
            "season_plans": 0,
            "planned_workouts": 0,
            "activities": 0,
            "duplicates": 0,
            "group_messages": 0,
            "coach_messages": 0,
            "direct_messages": 0,
        }

        for persona in athlete_personas:
            athlete = users_by_key[persona.key]
            profile = profiles_by_user_id[athlete.id]
            athlete_counts = await _seed_athlete_training_data(
                db,
                config=config,
                coach=coach,
                athlete=athlete,
                profile=profile,
                persona=persona,
                parsed_templates=parsed_templates,
            )
            counts["season_plans"] += athlete_counts["season_plans"]
            counts["planned_workouts"] += athlete_counts["planned_workouts"]
            counts["activities"] += athlete_counts["activities"]
            counts["duplicates"] += athlete_counts["duplicates"]

        chat_counts = await _seed_organization_chat_data(
            db,
            organization=org,
            users_by_key=users_by_key,
        )
        counts["group_messages"] += chat_counts["group_messages"]
        counts["coach_messages"] += chat_counts["coach_messages"]
        counts["direct_messages"] += chat_counts["direct_messages"]

        await db.commit()

        for persona in athlete_personas:
            athlete = users_by_key[persona.key]
            for workout_blueprint in build_workout_blueprints(persona, date.today()):
                if workout_blueprint.day_offset < 0:
                    await match_and_score(db, athlete.id, date.today() + timedelta(days=workout_blueprint.day_offset))

        return DemoSeedReport(
            action="seed",
            prefix=config.normalized_prefix,
            organization_name=org.name,
            dry_run=False,
            accounts=[
                {
                    "key": credential.key,
                    "role": credential.role,
                    "email": credential.email,
                    "password_status": credential.password_status,
                    "password": credential.password,
                }
                for credential in credentials
            ],
            counts=counts,
        )


async def purge_production_demo(config: DemoSeedConfig) -> DemoSeedReport:
    ensure_mutation_allowed(config)
    account_specs = build_account_specs(config)
    if config.dry_run:
        return DemoSeedReport(
            action="purge",
            prefix=config.normalized_prefix,
            organization_name=config.organization_name,
            dry_run=True,
            accounts=[
                {
                    "key": spec.persona.key,
                    "role": spec.persona.role.value,
                    "email": spec.email,
                }
                for spec in account_specs
            ],
            counts={},
        )

    async with AsyncSessionLocal() as db:
        org = await _load_demo_org(db, config)
        user_result = await db.execute(select(User).where(User.email.in_([spec.email for spec in account_specs])))
        users = user_result.scalars().all()
        user_ids = [user.id for user in users]
        athlete_ids = [user.id for user in users if user.role == RoleEnum.athlete]

        counts = {
            "users_deleted": len(users),
            "activities_deleted": 0,
            "planned_workouts_deleted": 0,
            "season_plans_deleted": 0,
            "memberships_deleted": 0,
            "links_deleted": 0,
            "profiles_deleted": 0,
            "group_messages_deleted": 0,
            "coach_messages_deleted": 0,
            "direct_messages_deleted": 0,
            "organization_deleted": 0,
        }

        if org is not None and user_ids:
            group_result = await db.execute(
                select(OrganizationGroupMessage).where(
                    OrganizationGroupMessage.organization_id == org.id,
                    OrganizationGroupMessage.sender_id.in_(user_ids),
                )
            )
            group_messages = group_result.scalars().all()
            coach_message_result = await db.execute(
                select(OrganizationCoachMessage).where(
                    OrganizationCoachMessage.organization_id == org.id,
                    OrganizationCoachMessage.athlete_id.in_(user_ids),
                    OrganizationCoachMessage.coach_id.in_(user_ids),
                    OrganizationCoachMessage.sender_id.in_(user_ids),
                )
            )
            coach_messages = coach_message_result.scalars().all()
            direct_message_result = await db.execute(
                select(OrganizationDirectMessage).where(
                    OrganizationDirectMessage.organization_id == org.id,
                    OrganizationDirectMessage.sender_id.in_(user_ids),
                    OrganizationDirectMessage.recipient_id.in_(user_ids),
                )
            )
            direct_messages = direct_message_result.scalars().all()

            counts["group_messages_deleted"] = len(group_messages)
            counts["coach_messages_deleted"] = len(coach_messages)
            counts["direct_messages_deleted"] = len(direct_messages)

            for row in group_messages:
                await db.delete(row)
            for row in coach_messages:
                await db.delete(row)
            for row in direct_messages:
                await db.delete(row)

        if athlete_ids:
            workout_result = await db.execute(select(PlannedWorkout).where(PlannedWorkout.user_id.in_(athlete_ids)))
            workouts = workout_result.scalars().all()
            counts["planned_workouts_deleted"] = len(workouts)
            version_result = await db.execute(select(PlannedWorkoutVersion).where(PlannedWorkoutVersion.workout_user_id.in_(athlete_ids)))
            versions = version_result.scalars().all()
            activity_result = await db.execute(select(Activity).where(Activity.athlete_id.in_(athlete_ids)))
            activities = activity_result.scalars().all()
            plan_result = await db.execute(select(SeasonPlan).where(SeasonPlan.athlete_id.in_(athlete_ids)))
            plans = plan_result.scalars().all()

            counts["activities_deleted"] = len(activities)
            counts["season_plans_deleted"] = len(plans)

            for row in versions:
                await db.delete(row)
            for row in workouts:
                await db.delete(row)
            for row in plans:
                await db.delete(row)
            for row in activities:
                await db.delete(row)

        if user_ids:
            link_result = await db.execute(
                select(CoachAthleteLink).where(
                    (CoachAthleteLink.coach_id.in_(user_ids)) | (CoachAthleteLink.athlete_id.in_(user_ids))
                )
            )
            links = link_result.scalars().all()
            membership_result = await db.execute(select(OrganizationMember).where(OrganizationMember.user_id.in_(user_ids)))
            memberships = membership_result.scalars().all()
            profile_result = await db.execute(select(Profile).where(Profile.user_id.in_(user_ids)))
            profiles = profile_result.scalars().all()

            counts["links_deleted"] = len(links)
            counts["memberships_deleted"] = len(memberships)
            counts["profiles_deleted"] = len(profiles)

            for row in links:
                await db.delete(row)
            for row in memberships:
                await db.delete(row)
            for row in profiles:
                await db.delete(row)
            for row in users:
                await db.delete(row)

        if org is not None:
            member_check = await db.execute(
                select(OrganizationMember).where(OrganizationMember.organization_id == org.id)
            )
            remaining_members = member_check.scalars().all()
            if not remaining_members:
                await db.delete(org)
                counts["organization_deleted"] = 1

        await db.commit()
        return DemoSeedReport(
            action="purge",
            prefix=config.normalized_prefix,
            organization_name=config.organization_name,
            dry_run=False,
            accounts=[
                {
                    "key": spec.persona.key,
                    "role": spec.persona.role.value,
                    "email": spec.email,
                }
                for spec in account_specs
            ],
            counts=counts,
        )


def _build_config_from_args(args: argparse.Namespace) -> DemoSeedConfig:
    return DemoSeedConfig(
        gmail_base=args.gmail_base,
        alias_prefix=args.alias_prefix,
        organization_name=args.organization_name,
        activity_source_dir=Path(args.activity_source_dir),
        dry_run=bool(args.dry_run),
        confirm_production=bool(args.confirm_production),
        preserve_existing_passwords=bool(getattr(args, "preserve_passwords", False)),
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Seed or purge a production-safe demonstration organization.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_shared_flags(command_parser: argparse.ArgumentParser) -> None:
        command_parser.add_argument("--gmail-base", required=True, help="Base inbox used for plus-addressing, for example test98765432987@gmail.com")
        command_parser.add_argument("--alias-prefix", required=True, help="Stable alias prefix used to derive the 10 deterministic demo addresses")
        command_parser.add_argument("--organization-name", default=DEFAULT_ORGANIZATION_NAME, help="Display name for the demo organization")
        command_parser.add_argument("--activity-source-dir", default=str(DEFAULT_ACTIVITY_SOURCE_DIR), help="Directory containing optional FIT or GPX files used to enrich seeded activities")
        command_parser.add_argument("--dry-run", action="store_true", help="Preview which accounts and counts would be generated without writing to the database")
        command_parser.add_argument("--confirm-production", action="store_true", help="Required for mutating commands so the operator explicitly confirms a production write")

    seed_parser = subparsers.add_parser("seed", help="Create or refresh the production demo organization")
    add_shared_flags(seed_parser)
    seed_parser.add_argument("--preserve-passwords", action="store_true", help="Preserve existing demo-account passwords instead of rotating fresh secure passwords on rerun")

    purge_parser = subparsers.add_parser("purge", help="Delete the production demo organization and its accounts")
    add_shared_flags(purge_parser)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    config = _build_config_from_args(args)
    try:
        if args.command == "seed":
            report = asyncio.run(seed_production_demo(config))
        else:
            report = asyncio.run(purge_production_demo(config))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 2

    print(json.dumps(report.to_dict(), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())