"""
Extended compliance service tests.
Covers: _is_activity_deleted, _safe_float, _is_rest_day_workout,
  _default_compliance_status_for_unmatched_workout, _activity_date_candidates,
  _resolve_effective_resting_hr, _hrr_zone_bounds, _zone_from_workout,
  _compute_normalized_power_watts, _range_score, _cycling_intensity_score,
  and related helpers.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

import pytest

from app.models import Activity, ComplianceStatusEnum, PlannedWorkout, Profile
from app.services import compliance as svc


# ---------------------------------------------------------------------------
# _is_activity_deleted
# ---------------------------------------------------------------------------

def test_is_activity_deleted_returns_false_for_no_streams():
    activity = Activity(streams=None)
    assert svc._is_activity_deleted(activity) is False


def test_is_activity_deleted_returns_false_when_deleted_is_false():
    activity = Activity(streams={"_meta": {"deleted": False}})
    assert svc._is_activity_deleted(activity) is False


def test_is_activity_deleted_returns_true_when_meta_deleted():
    activity = Activity(streams={"_meta": {"deleted": True}})
    assert svc._is_activity_deleted(activity) is True


def test_is_activity_deleted_non_dict_streams():
    activity = Activity(streams="raw string")
    assert svc._is_activity_deleted(activity) is False


def test_is_activity_deleted_meta_not_dict():
    activity = Activity(streams={"_meta": "string_meta"})
    assert svc._is_activity_deleted(activity) is False


# ---------------------------------------------------------------------------
# _safe_float
# ---------------------------------------------------------------------------

def test_safe_float_converts_string_number():
    assert svc._safe_float("3.14") == pytest.approx(3.14)


def test_safe_float_returns_default_for_none():
    assert svc._safe_float(None) == 0.0


def test_safe_float_returns_default_for_non_numeric_string():
    assert svc._safe_float("abc", default=-1.0) == -1.0


def test_safe_float_returns_default_for_nan():
    assert svc._safe_float(float("nan"), default=99.0) == 99.0


def test_safe_float_custom_default_for_empty():
    assert svc._safe_float(None, default=42.0) == 42.0


def test_safe_float_handles_int():
    assert svc._safe_float(7) == 7.0


# ---------------------------------------------------------------------------
# _is_rest_day_workout
# ---------------------------------------------------------------------------

def _make_workout(**kwargs) -> PlannedWorkout:
    defaults = dict(
        title="Test",
        sport_type="Cycling",
        planned_duration=60,
        planned_intensity="Zone 2",
    )
    defaults.update(kwargs)
    return PlannedWorkout(**defaults)


def test_is_rest_day_sport_type_rest():
    w = _make_workout(sport_type="Rest", planned_duration=0)
    assert svc._is_rest_day_workout(w) is True


def test_is_rest_day_title_contains_rest_day():
    w = _make_workout(title="Rest Day", sport_type="Running", planned_duration=0)
    assert svc._is_rest_day_workout(w) is True


def test_is_rest_day_intensity_rest_zero_duration():
    w = _make_workout(planned_intensity="Rest", planned_duration=0)
    assert svc._is_rest_day_workout(w) is True


def test_is_rest_day_intensity_rest_but_has_duration():
    # duration > 0 despite "Rest" intensity → not a rest day
    w = _make_workout(planned_intensity="Rest", planned_duration=30)
    assert svc._is_rest_day_workout(w) is False


def test_is_rest_day_normal_training():
    w = _make_workout(sport_type="Cycling", planned_duration=60)
    assert svc._is_rest_day_workout(w) is False


# ---------------------------------------------------------------------------
# _default_compliance_status (extended scenarios)
# ---------------------------------------------------------------------------

def test_compliance_today_date_defaults_to_planned():
    w = _make_workout(sport_type="Cycling", planned_duration=60)
    status = svc._default_compliance_status_for_unmatched_workout(
        w, date.today(), today=date.today()
    )
    assert status == ComplianceStatusEnum.planned


def test_compliance_future_date_is_planned():
    w = _make_workout(sport_type="Running", planned_duration=30)
    future = date.today() + timedelta(days=5)
    status = svc._default_compliance_status_for_unmatched_workout(w, future, today=date.today())
    assert status == ComplianceStatusEnum.planned


def test_compliance_past_rest_day_is_completed_green():
    w = _make_workout(sport_type="Rest", planned_duration=0)
    past = date.today() - timedelta(days=2)
    status = svc._default_compliance_status_for_unmatched_workout(w, past, today=date.today())
    assert status == ComplianceStatusEnum.completed_green


def test_compliance_past_training_day_is_missed():
    w = _make_workout(sport_type="Running", planned_duration=60)
    past = date.today() - timedelta(days=2)
    status = svc._default_compliance_status_for_unmatched_workout(w, past, today=date.today())
    assert status == ComplianceStatusEnum.missed


# ---------------------------------------------------------------------------
# _activity_date_candidates
# ---------------------------------------------------------------------------

def _make_activity(created_at=None, streams=None) -> Activity:
    return Activity(
        id=1,
        athlete_id=1,
        filename="test.fit",
        file_path="uploads/test.fit",
        file_type="fit",
        created_at=created_at,
        streams=streams or {},
    )


def test_activity_date_candidates_from_created_at():
    dt = datetime(2026, 4, 10, 8, 0, 0)
    activity = _make_activity(created_at=dt)
    candidates = svc._activity_date_candidates(activity)
    assert date(2026, 4, 10) in candidates


def test_activity_date_candidates_from_provider_payload_summary():
    activity = _make_activity(streams={
        "provider_payload": {
            "summary": {"start_date_local": "2026-03-20T07:30:00"},
        }
    })
    candidates = svc._activity_date_candidates(activity)
    assert date(2026, 3, 20) in candidates


def test_activity_date_candidates_from_provider_payload_with_z_suffix():
    activity = _make_activity(streams={
        "provider_payload": {
            "summary": {"start_date": "2026-03-20T07:30:00Z"},
        }
    })
    candidates = svc._activity_date_candidates(activity)
    assert date(2026, 3, 20) in candidates


def test_activity_date_candidates_returns_empty_when_no_date_info():
    activity = _make_activity(streams={})
    candidates = svc._activity_date_candidates(activity)
    assert len(candidates) == 0


def test_activity_date_candidates_handles_date_only_string():
    activity = _make_activity(streams={
        "provider_payload": {
            "summary": {"start_date_local": "2026-05-01"},
        }
    })
    candidates = svc._activity_date_candidates(activity)
    assert date(2026, 5, 1) in candidates


# ---------------------------------------------------------------------------
# _resolve_effective_resting_hr
# ---------------------------------------------------------------------------

def _make_profile(**kwargs) -> Profile:
    return Profile(user_id=1, **kwargs)


def test_resolve_resting_hr_uses_profile_when_no_recorded():
    profile = _make_profile(resting_hr=55.0)
    assert svc._resolve_effective_resting_hr(profile, None) == pytest.approx(55.0)


def test_resolve_resting_hr_uses_lower_of_two():
    profile = _make_profile(resting_hr=58.0)
    assert svc._resolve_effective_resting_hr(profile, 52.0) == pytest.approx(52.0)


def test_resolve_resting_hr_defaults_60_when_both_zero():
    assert svc._resolve_effective_resting_hr(None, None) == pytest.approx(60.0)


def test_resolve_resting_hr_uses_recorded_when_profile_none():
    assert svc._resolve_effective_resting_hr(None, 50.0) == pytest.approx(50.0)


def test_resolve_resting_hr_ignores_zero_profile_value():
    profile = _make_profile(resting_hr=0.0)
    assert svc._resolve_effective_resting_hr(profile, 54.0) == pytest.approx(54.0)


# ---------------------------------------------------------------------------
# _hrr_zone_bounds
# ---------------------------------------------------------------------------

def test_hrr_zone_bounds_returns_four_thresholds():
    bounds = svc._hrr_zone_bounds(max_hr=185.0, resting_hr=55.0)
    assert len(bounds) == 4
    # Each bound should be higher than the previous
    assert all(bounds[i] < bounds[i + 1] for i in range(len(bounds) - 1))


def test_hrr_zone_bounds_returns_fallback_for_zero_max_hr():
    bounds = svc._hrr_zone_bounds(max_hr=0.0, resting_hr=55.0)
    assert bounds == []


def test_hrr_zone_bounds_clamps_resting_hr_to_floor():
    # resting_hr way above max_hr should clamp reserve to safe values
    bounds = svc._hrr_zone_bounds(max_hr=150.0, resting_hr=5.0)
    assert len(bounds) == 4


def test_hrr_zone_bounds_values_within_expected_range():
    bounds = svc._hrr_zone_bounds(max_hr=190.0, resting_hr=60.0)
    # Z1 bound should be below Z4 bound
    assert bounds[0] < bounds[3]
    # All bounds should be below max_hr
    assert all(b < 190.0 for b in bounds)


# ---------------------------------------------------------------------------
# _zone_from_workout
# ---------------------------------------------------------------------------

def test_zone_from_workout_extracts_from_target_zone():
    w = PlannedWorkout(
        title="Intervals",
        sport_type="Cycling",
        planned_duration=60,
        planned_intensity="Zone 4",
        structure=[
            {"type": "block", "duration": {"type": "time", "value": 600}, "target": {"type": "power", "zone": 4}},
        ],
    )
    assert svc._zone_from_workout(w) == 4


def test_zone_from_workout_falls_back_to_planned_intensity_text():
    w = _make_workout(planned_intensity="Zone 3", structure=[])
    assert svc._zone_from_workout(w) == 3


def test_zone_from_workout_returns_none_for_no_info():
    w = _make_workout(planned_intensity="", structure=[])
    assert svc._zone_from_workout(w) is None


def test_zone_from_workout_skips_recovery_blocks():
    w = PlannedWorkout(
        title="Tempo",
        sport_type="Running",
        planned_duration=60,
        planned_intensity="Zone 4",
        structure=[
            {"type": "block", "target": {"zone": 1}, "category": "recovery"},
            {"type": "block", "target": {"zone": 4}, "category": "work"},
        ],
    )
    # Mode should be Z4 (recovery blocks excluded)
    assert svc._zone_from_workout(w) == 4


def test_zone_from_workout_handles_repeat_blocks():
    w = PlannedWorkout(
        title="Intervals",
        sport_type="Cycling",
        planned_duration=60,
        planned_intensity="Zone 5",
        structure=[
            {
                "type": "repeat",
                "repeats": 4,
                "steps": [
                    {"type": "block", "target": {"zone": 5}, "category": "work"},
                    {"type": "block", "target": {"zone": 1}, "category": "recovery"},
                ],
            }
        ],
    )
    assert svc._zone_from_workout(w) == 5


def test_zone_from_workout_mode_zone_wins_when_multiple():
    w = PlannedWorkout(
        title="Progressive",
        sport_type="Cycling",
        planned_duration=90,
        planned_intensity="Mixed",
        structure=[
            {"type": "block", "target": {"zone": 3}, "category": "work"},
            {"type": "block", "target": {"zone": 3}, "category": "work"},
            {"type": "block", "target": {"zone": 4}, "category": "work"},
        ],
    )
    # Zone 3 appears twice, should win
    assert svc._zone_from_workout(w) == 3


# ---------------------------------------------------------------------------
# _compute_normalized_power_watts
# ---------------------------------------------------------------------------

def _activity_with_streams(streams: dict) -> Activity:
    return Activity(
        id=1,
        athlete_id=1,
        filename="test.fit",
        file_path="uploads/test.fit",
        file_type="fit",
        streams=streams,
    )


def test_compute_np_uses_stats_direct():
    activity = _activity_with_streams({"stats": {"normalized_power": 280.0}})
    assert svc._compute_normalized_power_watts(activity) == pytest.approx(280.0)


def test_compute_np_uses_power_curve_fallback():
    activity = _activity_with_streams({"power_curve": {"normalized_power": 265.0}})
    assert svc._compute_normalized_power_watts(activity) == pytest.approx(265.0)


def test_compute_np_returns_none_for_empty_streams():
    activity = _activity_with_streams({})
    assert svc._compute_normalized_power_watts(activity) is None


def test_compute_np_from_short_power_data():
    power_values = [250, 260, 255, 252, 248]
    data = [{"power": p, "timestamp": "2026-01-01T00:00:00Z"} for p in power_values]
    activity = _activity_with_streams({"data": data})
    result = svc._compute_normalized_power_watts(activity)
    assert result is not None
    assert result > 0


def test_compute_np_from_rolling_data():
    # 50 data points — long enough for rolling window
    power_values = [200 + i % 10 for i in range(50)]
    data = [{"power": p, "timestamp": "2026-01-01T00:00:00Z"} for p in power_values]
    activity = _activity_with_streams({"data": data})
    result = svc._compute_normalized_power_watts(activity)
    assert result is not None
    assert result > 0


def test_compute_np_returns_none_when_all_power_zero():
    data = [{"power": 0, "timestamp": "2026-01-01T00:00:00Z"} for _ in range(50)]
    activity = _activity_with_streams({"data": data})
    assert svc._compute_normalized_power_watts(activity) is None


# ---------------------------------------------------------------------------
# _range_score
# ---------------------------------------------------------------------------

def test_range_score_returns_1_when_in_range():
    assert svc._range_score(80.0, 75.0, 85.0, 5.0, 10.0) == pytest.approx(1.0)


def test_range_score_returns_none_for_none_value():
    assert svc._range_score(None, 75.0, 85.0, 5.0, 10.0) is None


def test_range_score_soft_miss():
    # value at 87 — 2 outside high bound of 85, within soft tolerance of 5
    assert svc._range_score(87.0, 75.0, 85.0, 5.0, 10.0) == pytest.approx(0.72)


def test_range_score_hard_miss():
    # 9 outside high bound, within hard tolerance of 10
    assert svc._range_score(94.0, 75.0, 85.0, 5.0, 10.0) == pytest.approx(0.45)


def test_range_score_full_miss():
    # 20 outside high bound, beyond hard tolerance
    assert svc._range_score(105.0, 75.0, 85.0, 5.0, 10.0) == pytest.approx(0.15)


def test_range_score_at_exact_boundary():
    assert svc._range_score(75.0, 75.0, 85.0, 5.0, 10.0) == pytest.approx(1.0)
    assert svc._range_score(85.0, 75.0, 85.0, 5.0, 10.0) == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# _cycling_intensity_score
# ---------------------------------------------------------------------------

def test_cycling_intensity_returns_none_without_ftp():
    activity = _activity_with_streams({})
    activity.average_watts = 250
    profile = _make_profile(ftp=None)
    assert svc._cycling_intensity_score(activity, zone=3, profile=profile) is None


def test_cycling_intensity_returns_none_when_ftp_zero():
    activity = _activity_with_streams({})
    activity.average_watts = 250
    profile = _make_profile(ftp=0)
    assert svc._cycling_intensity_score(activity, zone=3, profile=profile) is None


def test_cycling_intensity_zone3_in_range_gives_high_score():
    # Zone 3 = 76–90% FTP; FTP 300; avg_power 240 = 80% FTP → in range
    activity = _activity_with_streams({})
    activity.average_watts = 240
    profile = _make_profile(ftp=300)
    score = svc._cycling_intensity_score(activity, zone=3, profile=profile)
    assert score is not None
    assert score > 0.5


def test_cycling_intensity_zone4_far_out_gives_low_score():
    # Zone 4 = 91–105% FTP; FTP 300; avg_power 100 = 33% → far from range
    activity = _activity_with_streams({})
    activity.average_watts = 100
    profile = _make_profile(ftp=300)
    score = svc._cycling_intensity_score(activity, zone=4, profile=profile)
    assert score is not None
    assert score < 0.5
