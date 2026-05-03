"""Pure-helper tests for app.services.compliance."""

from __future__ import annotations

from datetime import date, datetime
from types import SimpleNamespace

import pytest

from app.models import ComplianceStatusEnum
from app.services import compliance as cmp


def _act(streams=None, sport="cycling", duration=3600, distance=10000,
         created_at=None, average_hr=140, avg_speed=3.0, average_watts=200,
         local_date=None, is_deleted=False, duplicate_of_id=None, id=1,
         athlete_id=1):
    return SimpleNamespace(
        id=id, athlete_id=athlete_id,
        sport=sport, streams=streams,
        duration=duration, distance=distance,
        created_at=created_at or datetime(2024, 1, 1, 12, 0),
        average_hr=average_hr, avg_speed=avg_speed,
        average_watts=average_watts,
        local_date=local_date,
        is_deleted=is_deleted, duplicate_of_id=duplicate_of_id,
    )


def _workout(structure=None, sport_type="cycling", planned_duration=60,
             planned_distance=10, planned_intensity=None, date_=None,
             matched_activity_id=None, id=1):
    return SimpleNamespace(
        id=id, structure=structure, sport_type=sport_type,
        planned_duration=planned_duration,
        planned_distance=planned_distance,
        planned_intensity=planned_intensity,
        date=date_ or date(2024, 1, 1),
        matched_activity_id=matched_activity_id,
    )


# ── parse / dates ───────────────────────────────────────────────────────────


def test_parse_activity_date_value_handles_invalid():
    assert cmp._parse_activity_date_value(None) is None
    assert cmp._parse_activity_date_value("") is None
    assert cmp._parse_activity_date_value("not-a-date") is None


def test_parse_activity_date_value_iso_full():
    assert cmp._parse_activity_date_value("2024-05-12T10:30:00Z") == date(2024, 5, 12)


def test_parse_activity_date_value_short():
    assert cmp._parse_activity_date_value("2024-05-12") == date(2024, 5, 12)


def test_activity_date_candidates_collects_all_sources():
    streams = {"provider_payload": {
        "summary": {"start_date_local": "2024-05-12T08:00:00",
                    "start_date": "2024-05-12T07:00:00Z"},
        "detail": {"start_date_local": "2024-05-12"},
    }}
    act = _act(streams=streams, created_at=datetime(2024, 5, 12, 9))
    out = cmp._activity_date_candidates(act)
    assert date(2024, 5, 12) in out


def test_activity_effective_date_prefers_local_date():
    act = _act(local_date=date(2024, 6, 1))
    assert cmp._activity_effective_date(act) == date(2024, 6, 1)


def test_activity_effective_date_uses_provider_local():
    streams = {"provider_payload": {
        "summary": {"start_date_local": "2024-05-12"}, "detail": {}
    }}
    act = _act(streams=streams, local_date=None,
               created_at=datetime(2024, 5, 13))
    assert cmp._activity_effective_date(act) == date(2024, 5, 12)


def test_activity_effective_date_falls_back_to_created():
    act = _act(streams={}, local_date=None,
               created_at=datetime(2024, 5, 13, 8))
    assert cmp._activity_effective_date(act) == date(2024, 5, 13)


def test_activity_occurs_on_target_date():
    act = _act(local_date=date(2024, 5, 12))
    assert cmp._activity_occurs_on_target_date(act, date(2024, 5, 12)) is True
    assert cmp._activity_occurs_on_target_date(act, date(2024, 5, 13)) is False


# ── HR & zones ──────────────────────────────────────────────────────────────


def test_resolve_effective_resting_hr_defaults():
    assert cmp._resolve_effective_resting_hr(None, None) == 60.0


def test_resolve_effective_resting_hr_picks_lowest():
    profile = SimpleNamespace(resting_hr=55)
    assert cmp._resolve_effective_resting_hr(profile, 50) == 50.0
    assert cmp._resolve_effective_resting_hr(profile, None) == 55.0


def test_hrr_zone_bounds_returns_4_thresholds():
    out = cmp._hrr_zone_bounds(190, 50)
    assert len(out) == 4
    assert out == sorted(out)


def test_hrr_zone_bounds_zero_max_hr():
    assert cmp._hrr_zone_bounds(0, 50) == []


def test_hrr_zone_bounds_invalid_resting_falls_back():
    out = cmp._hrr_zone_bounds(100, 200)  # rest>max → reserve <= 0
    # falls back to fractional bounds
    assert len(out) == 4


def test_zone_from_workout_uses_structure_majority():
    structure = [
        {"type": "step", "category": "work", "target": {"zone": 2}},
        {"type": "step", "category": "work", "target": {"zone": 3}},
        {"type": "step", "category": "work", "target": {"zone": 3}},
    ]
    w = _workout(structure=structure)
    assert cmp._zone_from_workout(w) == 3


def test_zone_from_workout_skips_warmup_and_recovery():
    structure = [
        {"type": "step", "category": "warmup", "target": {"zone": 1}},
        {"type": "step", "category": "recovery", "target": {"zone": 1}},
        {"type": "step", "category": "work", "target": {"zone": 4}},
    ]
    assert cmp._zone_from_workout(_workout(structure=structure)) == 4


def test_zone_from_workout_repeats_expanded():
    structure = [{
        "type": "repeat", "repeats": 3,
        "steps": [{"type": "step", "category": "work", "target": {"zone": 5}}],
    }]
    assert cmp._zone_from_workout(_workout(structure=structure)) == 5


def test_zone_from_workout_falls_back_to_intensity_token():
    w = _workout(structure=[], planned_intensity="Zone 3")
    assert cmp._zone_from_workout(w) == 3


def test_zone_from_workout_returns_none_when_unknown():
    w = _workout(structure=[], planned_intensity=None)
    assert cmp._zone_from_workout(w) is None


# ── normalize sport ─────────────────────────────────────────────────────────


def test_normalize_sport_variants():
    assert cmp._normalize_sport(None) == "other"
    assert cmp._normalize_sport("Run") == "running"
    assert cmp._normalize_sport("ride") == "cycling"
    assert cmp._normalize_sport("Open Water Swim") == "swimming"
    assert cmp._normalize_sport("hike") == "hike"


# ── split helpers ───────────────────────────────────────────────────────────


def test_extract_activity_split_durations_from_laps():
    act = _act(streams={"laps": [{"duration": 600}, {"duration": 900},
                                  {"duration": 0}, "junk"]})
    assert cmp._extract_activity_split_durations(act) == [600.0, 900.0]


def test_extract_activity_split_durations_from_splits_metric():
    act = _act(streams={"splits_metric": [
        {"elapsed_time": 300}, {"moving_time": 250}, {"duration": 100},
    ]})
    assert cmp._extract_activity_split_durations(act) == [300.0, 250.0, 100.0]


def test_extract_activity_split_durations_empty():
    assert cmp._extract_activity_split_durations(_act(streams={})) == []


def test_extract_planned_split_durations_with_repeats():
    structure = [
        {"type": "step", "duration": {"type": "time", "value": 60}},
        {"type": "repeat", "repeats": 3, "steps": [
            {"type": "step", "duration": {"type": "time", "value": 30}},
        ]},
    ]
    out = cmp._extract_planned_split_durations(_workout(structure=structure))
    assert 60.0 in out
    assert out.count(90.0) == 1


def test_split_shape_similarity_handles_empty():
    assert cmp._split_shape_similarity([], [1.0]) is None
    assert cmp._split_shape_similarity([1.0], []) is None
    assert cmp._split_shape_similarity([0.0], [0.0]) is None


def test_split_shape_similarity_basic():
    out = cmp._split_shape_similarity([1.0, 1.0], [1.0, 1.0])
    assert 0.99 <= out <= 1.0


# ── similarity_score ────────────────────────────────────────────────────────


def test_similarity_score_zero_for_other_day():
    w = _workout(date_=date(2024, 1, 1))
    a = _act(local_date=date(2024, 1, 5))
    assert cmp._similarity_score(w, a) == 0.0


def test_similarity_score_high_for_matching():
    w = _workout(date_=date(2024, 1, 1), planned_duration=60,
                 planned_distance=10, sport_type="cycling")
    a = _act(local_date=date(2024, 1, 1), duration=3600, distance=10000,
             sport="cycling")
    assert cmp._similarity_score(w, a) > 0.85


def test_similarity_score_retention_bonus():
    w = _workout(date_=date(2024, 1, 1), matched_activity_id=1, id=10)
    a = _act(id=1, local_date=date(2024, 1, 1))
    base = cmp._similarity_score(_workout(date_=date(2024, 1, 1), id=10), a)
    boosted = cmp._similarity_score(w, a)
    assert boosted >= base


# ── compliance status helper ────────────────────────────────────────────────


def test_compliance_status_for_match_red_when_long_overrun():
    w = _workout(planned_duration=60, structure=[])
    a = _act(duration=3600 * 10)  # 10x planned
    out = cmp._compliance_status_for_match(w, a, profile=None,
                                            lowest_recorded_rhr=None)
    assert out == ComplianceStatusEnum.completed_red


def test_compliance_status_for_match_green_when_close():
    w = _workout(planned_duration=60, structure=[])
    a = _act(duration=3600)
    out = cmp._compliance_status_for_match(w, a, profile=None,
                                            lowest_recorded_rhr=None)
    assert out == ComplianceStatusEnum.completed_green
