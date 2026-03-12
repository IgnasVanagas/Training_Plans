from __future__ import annotations

from datetime import date, timedelta
from math import ceil
from typing import Any, Iterable


MACRO_STAGE_BY_PHASE = {
    "base": "Foundation",
    "build": "Build",
    "peak": "Competition",
    "taper": "Competition",
    "race": "Competition",
    "recovery": "Recovery",
    "transition": "Transition",
}

PHASE_VOLUME_MULTIPLIER = {
    "base": 0.92,
    "build": 1.04,
    "peak": 0.88,
    "taper": 0.62,
    "race": 0.58,
    "recovery": 0.55,
    "transition": 0.48,
}

SEVERITY_LOAD_MULTIPLIER = {
    "low": 0.9,
    "moderate": 0.72,
    "high": 0.45,
}

TAPER_PROFILES = {
    "short": {
        "A": {"taper_days": 9, "peak_days": 7, "build_days": 28},
        "B": {"taper_days": 5, "peak_days": 4, "build_days": 18},
        "C": {"taper_days": 2, "peak_days": 2, "build_days": 10},
    },
    "standard": {
        "A": {"taper_days": 14, "peak_days": 10, "build_days": 42},
        "B": {"taper_days": 7, "peak_days": 6, "build_days": 21},
        "C": {"taper_days": 3, "peak_days": 3, "build_days": 10},
    },
    "extended": {
        "A": {"taper_days": 18, "peak_days": 14, "build_days": 49},
        "B": {"taper_days": 9, "peak_days": 7, "build_days": 28},
        "C": {"taper_days": 4, "peak_days": 3, "build_days": 12},
    },
}

SESSION_WEEKDAYS = {
    2: [2, 5],
    3: [1, 3, 5],
    4: [1, 2, 4, 6],
    5: [1, 2, 3, 5, 6],
    6: [0, 1, 2, 3, 5, 6],
    7: [0, 1, 2, 3, 4, 5, 6],
}

SESSION_DISTRIBUTION = {
    2: [0.42, 0.58],
    3: [0.24, 0.28, 0.48],
    4: [0.18, 0.2, 0.22, 0.4],
    5: [0.14, 0.17, 0.17, 0.28, 0.24],
    6: [0.12, 0.15, 0.15, 0.16, 0.22, 0.2],
    7: [0.1, 0.13, 0.13, 0.14, 0.15, 0.2, 0.15],
}


def _coerce_date(value: Any) -> date:
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def _as_dict(payload: Any) -> dict[str, Any]:
    if hasattr(payload, "model_dump"):
        return payload.model_dump()
    return dict(payload)


def _normalize_races(raw_races: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    races = []
    for index, race in enumerate(raw_races):
        item = dict(race)
        item["date"] = _coerce_date(item["date"])
        item.setdefault("priority", "C")
        item.setdefault("target_metrics", [])
        item["_order"] = index
        races.append(item)
    return sorted(races, key=lambda row: (row["date"], row.get("priority", "C"), row["_order"]))


def _normalize_constraints(raw_constraints: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for constraint in raw_constraints:
        item = dict(constraint)
        item["start_date"] = _coerce_date(item["start_date"])
        item["end_date"] = _coerce_date(item["end_date"])
        if item["end_date"] < item["start_date"]:
            item["start_date"], item["end_date"] = item["end_date"], item["start_date"]
        item.setdefault("severity", "moderate")
        item.setdefault("impact", "reduce")
        rows.append(item)
    return sorted(rows, key=lambda row: (row["start_date"], row["end_date"]))


def _profile_value(profile: Any, key: str) -> Any:
    if profile is None:
        return None
    return getattr(profile, key, None)


def _windows_for_race(priority: str, taper_profile: str) -> dict[str, int]:
    profile_windows = TAPER_PROFILES.get(taper_profile, TAPER_PROFILES["standard"])
    return profile_windows.get(priority, profile_windows["C"])


def _constraints_for_range(
    constraints: Iterable[dict[str, Any]],
    range_start: date,
    range_end: date,
) -> list[dict[str, Any]]:
    return [
        row for row in constraints
        if row["start_date"] <= range_end and row["end_date"] >= range_start
    ]


def _phase_for_week(
    week_start: date,
    week_end: date,
    *,
    races: list[dict[str, Any]],
    constraints: list[dict[str, Any]],
    taper_profile: str,
    week_index: int,
    recovery_frequency: int,
) -> tuple[str, dict[str, Any] | None]:
    active_constraints = _constraints_for_range(constraints, week_start, week_end)
    if active_constraints:
        highest = max(active_constraints, key=lambda item: SEVERITY_LOAD_MULTIPLIER.get(item.get("severity", "moderate"), 0.72))
        if highest.get("kind") in {"injury", "sickness"} and highest.get("severity") == "high":
            return "recovery", None

    week_race = next((race for race in races if week_start <= race["date"] <= week_end), None)
    if week_race is not None:
        return "race", week_race

    next_race = next((race for race in races if race["date"] >= week_start), None)
    if next_race is None:
        if active_constraints:
            return "transition", None
        return ("recovery", None) if week_index > 0 and (week_index + 1) % recovery_frequency == 0 else ("build", None)

    days_to_race = (next_race["date"] - week_start).days
    windows = _windows_for_race(str(next_race.get("priority") or "C"), taper_profile)
    if days_to_race <= windows["taper_days"]:
        return "taper", next_race
    if days_to_race <= windows["taper_days"] + windows["peak_days"]:
        return "peak", next_race
    if week_index > 0 and (week_index + 1) % recovery_frequency == 0:
        return "recovery", None
    if days_to_race <= windows["taper_days"] + windows["peak_days"] + windows["build_days"]:
        return "build", next_race
    return "base", next_race


def _focus_for_phase(phase: str, sport_type: str) -> str:
    sport = (sport_type or "endurance").strip().lower()
    is_running = "run" in sport
    if phase == "base":
        return "Aerobic durability and technical economy" if is_running else "Aerobic durability and steady endurance"
    if phase == "build":
        return "Threshold development and race-specific strength"
    if phase == "peak":
        return "Specific sharpening and sustainable race rhythm"
    if phase == "taper":
        return "Freshness, confidence, and sharpness"
    if phase == "race":
        return "Protect freshness and execute the target event"
    if phase == "recovery":
        return "Absorb load, restore readiness, and keep movement quality"
    return "Maintain consistency while honoring external constraints"


def _key_sessions_for_phase(phase: str, sport_type: str) -> list[str]:
    sport = (sport_type or "endurance").strip().lower()
    is_running = "run" in sport
    if phase == "base":
        return ["Long aerobic session", "Economy drills / strides" if is_running else "Cadence technique", "Steady Zone 2 support"]
    if phase == "build":
        return ["Threshold intervals", "Race-pace support set", "Long progression session"]
    if phase == "peak":
        return ["Race-pace repetitions", "Openers", "Reduced long session"]
    if phase == "taper":
        return ["Short sharpeners", "Openers", "Easy endurance"]
    if phase == "race":
        return ["Openers", "Target race", "Optional recovery flush"]
    if phase == "recovery":
        return ["Recovery endurance", "Mobility or strides", "Off-feet recovery"]
    return ["Maintenance endurance", "Constraint-aware mobility", "Optional easy flush"]


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value is not None else None


def _group_contiguous(rows: list[dict[str, Any]], key_name: str) -> list[list[dict[str, Any]]]:
    groups: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    last_value: Any = object()
    for row in rows:
        value = row.get(key_name)
        if current and value != last_value:
            groups.append(current)
            current = []
        current.append(row)
        last_value = value
    if current:
        groups.append(current)
    return groups


def _build_macro_cycles(micro_cycles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = []
    for row in micro_cycles:
        item = dict(row)
        item["macro_stage"] = MACRO_STAGE_BY_PHASE.get(str(row.get("phase") or "transition"), "Transition")
        normalized.append(item)

    groups = _group_contiguous(normalized, "macro_stage")
    output = []
    for index, group in enumerate(groups, start=1):
        output.append({
            "index": index,
            "label": group[0]["macro_stage"],
            "start_date": group[0]["week_start"],
            "end_date": group[-1]["week_end"],
            "weeks": len(group),
            "dominant_phase": group[0]["phase"],
            "focus": group[0]["focus"],
        })
    return output


def _build_meso_cycles(micro_cycles: list[dict[str, Any]], recovery_frequency: int) -> list[dict[str, Any]]:
    groups: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    for row in micro_cycles:
        current.append(row)
        if (
            row["phase"] in {"recovery", "taper", "race", "transition"}
            or len(current) >= recovery_frequency
        ):
            groups.append(current)
            current = []
    if current:
        groups.append(current)

    output = []
    for index, group in enumerate(groups, start=1):
        avg_hours = sum(float(item.get("target_hours") or 0.0) for item in group) / max(1, len(group))
        output.append({
            "index": index,
            "label": f"Meso {index}",
            "start_date": group[0]["week_start"],
            "end_date": group[-1]["week_end"],
            "weeks": len(group),
            "focus": group[0]["focus"],
            "average_target_hours": round(avg_hours, 1),
            "phases": [item["phase"] for item in group],
        })
    return output


def _build_season_blocks(macro_cycles: list[dict[str, Any]], countdowns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    blocks = []
    for index, macro in enumerate(macro_cycles, start=1):
        related_race = next(
            (
                row for row in countdowns
                if row["date"] >= macro["start_date"] and row["date"] <= macro["end_date"]
            ),
            None,
        )
        label = macro["label"]
        if related_race is not None:
            label = f"{label} toward {related_race['name']}"
        blocks.append({
            "index": index,
            "label": label,
            "start_date": macro["start_date"],
            "end_date": macro["end_date"],
            "focus": macro["focus"],
        })
    return blocks


def _describe_constraint(constraint: dict[str, Any]) -> str:
    label = constraint.get("name") or str(constraint.get("kind") or "Constraint").replace("_", " ").title()
    severity = str(constraint.get("severity") or "moderate").title()
    return f"{label} ({severity})"


def _micro_cycle_rows(plan: dict[str, Any], profile: Any | None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    season_start = _coerce_date(plan["season_start"])
    season_end = _coerce_date(plan["season_end"])
    if season_end < season_start:
        raise ValueError("season_end must not be earlier than season_start")

    races = _normalize_races(plan.get("goal_races") or [])
    constraints = _normalize_constraints(plan.get("constraints") or [])
    periodization = dict(plan.get("periodization") or {})
    taper_profile = str(periodization.get("taper_profile") or "standard")
    recovery_frequency = max(2, int(periodization.get("recovery_week_frequency") or 4))
    weekly_hours_target = float(periodization.get("weekly_hours_target") or 8.0)

    total_weeks = max(1, ceil(((season_end - season_start).days + 1) / 7.0))
    micro_cycles: list[dict[str, Any]] = []
    countdowns = []

    for race in races:
        windows = _windows_for_race(str(race.get("priority") or "C"), taper_profile)
        countdowns.append({
            "name": race["name"],
            "date": race["date"].isoformat(),
            "priority": race.get("priority", "C"),
            "days_until": (race["date"] - date.today()).days,
            "days_from_season_start": (race["date"] - season_start).days,
            "taper_starts_on": (race["date"] - timedelta(days=windows["taper_days"])).isoformat(),
            "target_metrics": race.get("target_metrics") or [],
        })

    for week_index in range(total_weeks):
        week_start = season_start + timedelta(days=week_index * 7)
        week_end = min(season_end, week_start + timedelta(days=6))
        phase, anchor_race = _phase_for_week(
            week_start,
            week_end,
            races=races,
            constraints=constraints,
            taper_profile=taper_profile,
            week_index=week_index,
            recovery_frequency=recovery_frequency,
        )
        overlapping_constraints = _constraints_for_range(constraints, week_start, week_end)
        load_modifier = PHASE_VOLUME_MULTIPLIER.get(phase, 0.6)
        for constraint in overlapping_constraints:
            load_modifier *= SEVERITY_LOAD_MULTIPLIER.get(str(constraint.get("severity") or "moderate"), 0.72)
            if constraint.get("impact") == "rest":
                load_modifier *= 0.8
            if constraint.get("impact") == "avoid_intensity" and phase in {"build", "peak"}:
                phase = "recovery"

        load_modifier = max(0.2, min(load_modifier, 1.2))
        target_hours = round(weekly_hours_target * load_modifier, 1)
        focus = _focus_for_phase(phase, str(plan.get("sport_type") or ""))
        next_race = anchor_race or next((race for race in races if race["date"] >= week_start), None)

        micro_cycles.append({
            "week_index": week_index + 1,
            "week_start": week_start.isoformat(),
            "week_end": week_end.isoformat(),
            "phase": phase,
            "focus": focus,
            "target_hours": target_hours,
            "load_modifier": round(load_modifier, 2),
            "key_sessions": _key_sessions_for_phase(phase, str(plan.get("sport_type") or "")),
            "constraints": [_describe_constraint(item) for item in overlapping_constraints],
            "countdown_days": (next_race["date"] - week_start).days if next_race is not None else None,
            "anchor_race": {
                "name": next_race["name"],
                "date": next_race["date"].isoformat(),
                "priority": next_race.get("priority", "C"),
            } if next_race is not None else None,
            "profile_targets": {
                "ftp": _profile_value(profile, "ftp"),
                "lt2": _profile_value(profile, "lt2"),
                "max_hr": _profile_value(profile, "max_hr"),
            },
        })

    return micro_cycles, countdowns


def _session_template(phase: str, sport_type: str) -> list[dict[str, str]]:
    sport = (sport_type or "endurance").strip().lower()
    is_running = "run" in sport
    if phase == "base":
        return [
            {"title": "Aerobic Endurance", "intensity": "Zone 2"},
            {"title": "Technique / Economy", "intensity": "Zone 1-2" if is_running else "Zone 2"},
            {"title": "Steady Support", "intensity": "Tempo" if is_running else "Upper Zone 2"},
            {"title": "Long Endurance", "intensity": "Zone 2"},
            {"title": "Easy Flush", "intensity": "Zone 1"},
        ]
    if phase == "build":
        return [
            {"title": "Threshold Intervals", "intensity": "Threshold"},
            {"title": "Aerobic Support", "intensity": "Zone 2"},
            {"title": "Race Specific Set", "intensity": "Race pace"},
            {"title": "Long Progression", "intensity": "Zone 2-3"},
            {"title": "Recovery Session", "intensity": "Zone 1"},
        ]
    if phase == "peak":
        return [
            {"title": "Specific Sharpening", "intensity": "Race pace"},
            {"title": "Maintenance Endurance", "intensity": "Zone 2"},
            {"title": "Openers", "intensity": "High cadence / strides"},
            {"title": "Reduced Long Session", "intensity": "Zone 2"},
        ]
    if phase == "taper":
        return [
            {"title": "Taper Endurance", "intensity": "Zone 1-2"},
            {"title": "Short Sharpeners", "intensity": "Race pace"},
            {"title": "Openers", "intensity": "Priming"},
        ]
    if phase == "race":
        return [
            {"title": "Openers", "intensity": "Priming"},
            {"title": "Recovery Flush", "intensity": "Zone 1"},
        ]
    return [
        {"title": "Recovery Session", "intensity": "Zone 1"},
        {"title": "Mobility / Technique", "intensity": "Easy"},
        {"title": "Easy Endurance", "intensity": "Zone 1-2"},
    ]


def _daily_constraints(constraints: list[dict[str, Any]], target_date: date) -> list[dict[str, Any]]:
    return [
        item for item in constraints
        if item["start_date"] <= target_date <= item["end_date"]
    ]


def build_generated_workouts(plan_payload: Any, profile: Any | None = None) -> dict[str, Any]:
    plan = _as_dict(plan_payload)
    micro_cycles, countdowns = _micro_cycle_rows(plan, profile)
    periodization = dict(plan.get("periodization") or {})
    training_days_per_week = max(2, int(periodization.get("training_days_per_week") or 5))
    longest_session_minutes = int(periodization.get("longest_session_minutes") or 180)
    constraints = _normalize_constraints(plan.get("constraints") or [])
    races = _normalize_races(plan.get("goal_races") or [])
    season_start = _coerce_date(plan["season_start"])
    season_end = _coerce_date(plan["season_end"])

    workouts: list[dict[str, Any]] = []
    for micro in micro_cycles:
        week_start = _coerce_date(micro["week_start"])
        week_end = _coerce_date(micro["week_end"])
        phase = str(micro["phase"])
        session_days = SESSION_WEEKDAYS.get(training_days_per_week, SESSION_WEEKDAYS[5])
        weights = SESSION_DISTRIBUTION.get(training_days_per_week, SESSION_DISTRIBUTION[5])
        session_templates = _session_template(phase, str(plan.get("sport_type") or ""))
        target_minutes = max(60, int(round(float(micro.get("target_hours") or 1.0) * 60)))
        anchor_race = micro.get("anchor_race") or None
        anchor_race_date = _coerce_date(anchor_race["date"]) if isinstance(anchor_race, dict) and anchor_race.get("date") else None

        used_dates: set[date] = set()
        for index, weekday in enumerate(session_days):
            target_date = week_start + timedelta(days=weekday)
            if target_date < season_start or target_date > season_end or target_date > week_end:
                continue

            day_constraints = _daily_constraints(constraints, target_date)
            template = session_templates[min(index, len(session_templates) - 1)]
            duration = int(round(target_minutes * weights[min(index, len(weights) - 1)]))
            if weekday in {5, 6}:
                duration = min(longest_session_minutes, max(duration, int(target_minutes * 0.32)))
            duration = max(25, duration)

            title = template["title"]
            intensity = template["intensity"]
            description_parts = [
                f"Phase: {phase.title()}",
                f"Focus: {micro['focus']}",
            ]

            if anchor_race_date is not None:
                countdown_days = (anchor_race_date - target_date).days
                description_parts.append(f"Countdown: {countdown_days} days to {anchor_race['name']}")
                if countdown_days == 0:
                    title = f"{anchor_race.get('priority', 'C')} Race: {anchor_race['name']}"
                    intensity = "Race execution"
                    duration = max(60, min(longest_session_minutes, target_minutes))
                elif countdown_days == 1 and phase in {"race", "taper", "peak"}:
                    title = f"Openers for {anchor_race['name']}"
                    intensity = "Priming"
                    duration = min(duration, 40)
                elif countdown_days < 0:
                    continue

            for constraint in day_constraints:
                description_parts.append(f"Constraint: {_describe_constraint(constraint)}")
                kind = str(constraint.get("kind") or "constraint")
                impact = str(constraint.get("impact") or "reduce")
                severity = str(constraint.get("severity") or "moderate")
                reduction = SEVERITY_LOAD_MULTIPLIER.get(severity, 0.72)
                if impact == "rest" or (kind in {"injury", "sickness"} and severity == "high"):
                    title = "Recovery / Rest Day"
                    intensity = "Recovery"
                    duration = 25
                elif kind == "travel":
                    title = f"Travel-adjusted {title}"
                    intensity = "Zone 1-2" if intensity != "Race execution" else intensity
                    duration = max(25, int(round(duration * reduction)))
                else:
                    duration = max(25, int(round(duration * reduction)))
                    if impact == "avoid_intensity" and intensity not in {"Race execution", "Priming"}:
                        intensity = "Zone 1-2"

            if target_date in used_dates:
                continue
            used_dates.add(target_date)

            workouts.append({
                "date": target_date.isoformat(),
                "title": title,
                "sport_type": plan.get("sport_type") or "Cycling",
                "planned_duration": duration,
                "planned_intensity": intensity,
                "description": " | ".join(description_parts),
                "planned_distance": None,
                "planning_context": {
                    "phase": phase,
                    "focus": micro["focus"],
                    "week_index": micro["week_index"],
                    "countdown_days": (anchor_race_date - target_date).days if anchor_race_date is not None else None,
                    "anchor_race": anchor_race,
                    "constraints": [
                        {
                            "kind": constraint.get("kind"),
                            "severity": constraint.get("severity"),
                            "impact": constraint.get("impact"),
                            "name": constraint.get("name"),
                        }
                        for constraint in day_constraints
                    ],
                },
            })

        for race in races:
            if not (week_start <= race["date"] <= week_end):
                continue
            if race["date"] in used_dates:
                continue
            workouts.append({
                "date": race["date"].isoformat(),
                "title": f"{race.get('priority', 'C')} Race: {race['name']}",
                "sport_type": plan.get("sport_type") or "Cycling",
                "planned_duration": max(60, min(longest_session_minutes, int(round(float(micro.get('target_hours') or 1.0) * 45)))),
                "planned_intensity": "Race execution",
                "description": " | ".join([
                    f"Race day for {race['name']}",
                    f"Priority: {race.get('priority', 'C')}",
                ]),
                "planned_distance": None,
                "planning_context": {
                    "phase": "race",
                    "focus": micro["focus"],
                    "week_index": micro["week_index"],
                    "countdown_days": 0,
                    "anchor_race": {
                        "name": race["name"],
                        "date": race["date"].isoformat(),
                        "priority": race.get("priority", "C"),
                        "target_metrics": race.get("target_metrics") or [],
                    },
                    "constraints": [],
                },
            })

    workouts.sort(key=lambda row: (row["date"], row["title"]))
    macro_cycles = _build_macro_cycles(micro_cycles)
    meso_cycles = _build_meso_cycles(micro_cycles, max(2, int(periodization.get("recovery_week_frequency") or 4)))
    season_blocks = _build_season_blocks(macro_cycles, countdowns)

    constrained_weeks = sum(1 for row in micro_cycles if row.get("constraints"))
    target_metrics = plan.get("target_metrics") or []
    summary = {
        "season_name": plan.get("name"),
        "sport_type": plan.get("sport_type"),
        "season_start": _iso(season_start),
        "season_end": _iso(season_end),
        "total_weeks": len(micro_cycles),
        "race_count": len(races),
        "constraint_count": len(constraints),
        "constrained_weeks": constrained_weeks,
        "generated_workout_count": len(workouts),
        "available_days_per_week": training_days_per_week,
        "weekly_hours_target": float(periodization.get("weekly_hours_target") or 8.0),
        "target_metrics": target_metrics,
    }

    return {
        "countdowns": countdowns,
        "season_blocks": season_blocks,
        "macro_cycles": macro_cycles,
        "meso_cycles": meso_cycles,
        "micro_cycles": micro_cycles,
        "generated_workouts": workouts,
        "summary": summary,
    }
