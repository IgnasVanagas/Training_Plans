"""Pure-helper coverage tests for app.routers.activities.

Targets the deep stack of zone/load/normalization helpers without spinning up
TestClient or DB. These are the highest-ROI functions in the router given
their branchy nature and >1100 missing lines on activities.py.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.models import Activity, PlannedWorkout, Profile
from app.routers import activities as act


# ── _normalize_sport_name ────────────────────────────────────────────────────


@pytest.mark.parametrize("value, expected", [
    (None, "other"), ("", "other"),
    ("Run", "running"), ("Trail Running", "running"),
    ("Cycling", "cycling"), ("Bike", "cycling"), ("Mountain Ride", "cycling"),
    ("Swim", "other"), ("Walk", "other"),
])
def test_normalize_sport_name(value, expected):
    assert act._normalize_sport_name(value) == expected


# ── _safe_number ─────────────────────────────────────────────────────────────


def test_safe_number_parses_str_and_float():
    assert act._safe_number("12.5") == 12.5
    assert act._safe_number(42) == 42.0


def test_safe_number_returns_default_on_invalid():
    assert act._safe_number(None) == 0.0
    assert act._safe_number("nope") == 0.0
    assert act._safe_number("nan", default=7.0) == 7.0  # NaN sentinel


# ── _empty_bucket / _round_bucket ────────────────────────────────────────────


def test_empty_bucket_shape():
    bucket = act._empty_bucket()
    assert bucket["activities_count"] == 0
    assert "running" in bucket["sports"]
    assert "cycling" in bucket["sports"]
    assert bucket["sports"]["running"]["zone_seconds"] == {f"Z{i}": 0 for i in range(1, 6)}
    assert bucket["sports"]["cycling"]["zone_seconds"] == {f"Z{i}": 0 for i in range(1, 8)}


def test_round_bucket_rounds_totals():
    bucket = act._empty_bucket()
    bucket["total_duration_minutes"] = 12.345678
    bucket["total_distance_km"] = 1.987654
    bucket["sports"]["running"]["total_duration_minutes"] = 5.111
    bucket["sports"]["cycling"]["total_distance_km"] = 7.999
    rounded = act._round_bucket(bucket)
    assert rounded["total_duration_minutes"] == 12.3
    assert rounded["total_distance_km"] == 2.0
    assert rounded["sports"]["running"]["total_duration_minutes"] == 5.1
    assert rounded["sports"]["cycling"]["total_distance_km"] == 8.0


# ── _hist_lookup ─────────────────────────────────────────────────────────────


def test_hist_lookup_returns_fallback_when_no_history():
    assert act._hist_lookup([], datetime(2026, 1, 1), 5.0) == 5.0


def test_hist_lookup_returns_most_recent_at_or_before():
    history = [
        (datetime(2026, 1, 1), 100.0),
        (datetime(2026, 2, 1), 200.0),
        (datetime(2026, 3, 1), 300.0),
    ]
    assert act._hist_lookup(history, datetime(2026, 2, 15), 0.0) == 200.0
    assert act._hist_lookup(history, datetime(2025, 12, 1), 50.0) == 50.0
    assert act._hist_lookup(history, datetime(2026, 4, 1), 0.0) == 300.0


# ── _extract_profile_zone_settings ───────────────────────────────────────────


def test_extract_profile_zone_settings_none_returns_empty():
    assert act._extract_profile_zone_settings(None) == {}


def test_extract_profile_zone_settings_returns_dict():
    p = Profile(user_id=1, sports={"zone_settings": {"running": {"hr": {"upper_bounds": [1, 2]}}}})
    out = act._extract_profile_zone_settings(p)
    assert "running" in out


def test_extract_profile_zone_settings_handles_non_dict_payload():
    p = Profile(user_id=1, sports=["running"])
    assert act._extract_profile_zone_settings(p) == {}


# ── _metric_upper_bounds ────────────────────────────────────────────────────


def test_metric_upper_bounds_returns_fallback_when_no_settings():
    assert act._metric_upper_bounds(None, sport="running", metric="hr",
                                    fallback_bounds=[1, 2, 3]) == [1, 2, 3]


def test_metric_upper_bounds_uses_explicit_upper_bounds():
    p = Profile(user_id=1, sports={"zone_settings": {"running": {"hr": {"upper_bounds": [120, 140, 160, 180]}}}})
    out = act._metric_upper_bounds(p, sport="running", metric="hr", fallback_bounds=[])
    assert out == [120.0, 140.0, 160.0, 180.0]


def test_metric_upper_bounds_rejects_non_monotonic():
    p = Profile(user_id=1, sports={"zone_settings": {"running": {"hr": {"upper_bounds": [120, 110, 160]}}}})
    out = act._metric_upper_bounds(p, sport="running", metric="hr", fallback_bounds=[1, 2, 3])
    assert out == [1, 2, 3]


def test_metric_upper_bounds_running_pace_minutes_passthrough():
    # Function requires strictly increasing bounds, so pace upper_bounds with
    # descending values is rejected → fallback used.
    p = Profile(user_id=1, sports={"zone_settings": {"running": {"pace": {
        "upper_bounds": [6.0, 5.0, 4.0, 3.5, 3.0]
    }}}})
    out = act._metric_upper_bounds(p, sport="running", metric="pace", fallback_bounds=["fb"])
    assert out == ["fb"]


def test_metric_upper_bounds_running_pace_too_large_falls_back():
    p = Profile(user_id=1, sports={"zone_settings": {"running": {"pace": {"upper_bounds": [50, 40]}}}})
    out = act._metric_upper_bounds(p, sport="running", metric="pace", fallback_bounds=[9, 8, 7])
    assert out == [9, 8, 7]


def test_metric_upper_bounds_cycling_power_lt1_lt2_derived():
    p = Profile(user_id=1, sports={"zone_settings": {"cycling": {"power": {"lt1": 200, "lt2": 280}}}})
    out = act._metric_upper_bounds(p, sport="cycling", metric="power", fallback_bounds=[])
    assert len(out) == 6
    assert out[1] == 200.0  # Z2 upper = lt1
    assert out[3] == 280.0  # Z4 upper = lt2


def test_metric_upper_bounds_lt2_below_lt1_falls_back():
    p = Profile(user_id=1, sports={"zone_settings": {"cycling": {"power": {"lt1": 280, "lt2": 200}}}})
    out = act._metric_upper_bounds(p, sport="cycling", metric="power", fallback_bounds=["fb"])
    assert out == ["fb"]


def test_metric_upper_bounds_running_pace_lt1_lt2_inverted_logic():
    # For pace lt2 must be < lt1 (faster pace = smaller min/km value)
    p = Profile(user_id=1, sports={"zone_settings": {"running": {"pace": {"lt1": 5.5, "lt2": 4.5}}}})
    out = act._metric_upper_bounds(p, sport="running", metric="pace", fallback_bounds=[])
    assert len(out) == 5


# ── _resolve_effective_resting_hr ────────────────────────────────────────────


def test_resolve_resting_hr_default_60():
    assert act._resolve_effective_resting_hr(None, None) == 60.0


def test_resolve_resting_hr_picks_minimum():
    p = Profile(user_id=1, resting_hr=55)
    assert act._resolve_effective_resting_hr(p, lowest_recorded_rhr=48) == 48.0
    assert act._resolve_effective_resting_hr(p, lowest_recorded_rhr=None) == 55.0


# ── _hr_zone_bounds_from_reserve ────────────────────────────────────────────


def test_hr_zone_bounds_from_reserve_returns_4_bounds():
    bounds = act._hr_zone_bounds_from_reserve(190, 50)
    assert len(bounds) == 4
    assert bounds[0] < bounds[-1]


def test_hr_zone_bounds_from_reserve_zero_max_returns_empty():
    assert act._hr_zone_bounds_from_reserve(0, 60) == []


def test_hr_zone_bounds_clamps_resting_hr():
    # Resting >= max → reserve is clamped to >0, fallback uses %max
    bounds = act._hr_zone_bounds_from_reserve(100, 200)
    assert len(bounds) == 4


# ── _zone_index_from_upper_bounds ───────────────────────────────────────────


def test_zone_index_empty_bounds_returns_1():
    assert act._zone_index_from_upper_bounds(150, []) == 1


def test_zone_index_increasing_bounds():
    # bounds [120, 140, 160, 180] → 5 zones
    assert act._zone_index_from_upper_bounds(110, [120, 140, 160, 180]) == 1
    assert act._zone_index_from_upper_bounds(140, [120, 140, 160, 180]) == 2
    assert act._zone_index_from_upper_bounds(170, [120, 140, 160, 180]) == 4
    assert act._zone_index_from_upper_bounds(200, [120, 140, 160, 180]) == 5


def test_zone_index_reverse_for_pace():
    # For pace (lower is better) — bounds in descending after reversal
    bounds = [6.0, 5.0, 4.0, 3.0]
    # value=2.5 → faster than all → highest zone
    assert act._zone_index_from_upper_bounds(2.5, bounds, reverse=True) == 5
    # value=6.5 → slowest → zone 1
    assert act._zone_index_from_upper_bounds(6.5, bounds, reverse=True) == 1


# ── _zone_bucket_key & _add_zone_seconds ─────────────────────────────────────


def test_zone_bucket_key_clamps_to_available_keys():
    seconds = {f"Z{i}": 0 for i in range(1, 6)}
    assert act._zone_bucket_key(seconds, 0) == "Z1"
    assert act._zone_bucket_key(seconds, 99) == "Z5"
    assert act._zone_bucket_key(seconds, 3) == "Z3"


def test_zone_bucket_key_empty_dict():
    assert act._zone_bucket_key({}, 4) == "Z4"


def test_add_zone_seconds_accumulates_and_clamps_negative():
    bucket = {f"Z{i}": 0 for i in range(1, 6)}
    act._add_zone_seconds(bucket, 2, 30)
    act._add_zone_seconds(bucket, 2, 15)
    act._add_zone_seconds(bucket, 7, 100)  # clamped to Z5
    act._add_zone_seconds(bucket, 1, -50)  # negative clamped to 0
    assert bucket["Z2"] == 45
    assert bucket["Z5"] == 100
    assert bucket["Z1"] == 0


# ── _normalize_utc_iso ───────────────────────────────────────────────────────


def test_normalize_utc_iso_none_and_blank():
    assert act._normalize_utc_iso(None) is None
    assert act._normalize_utc_iso("   ") is None


def test_normalize_utc_iso_invalid_string():
    assert act._normalize_utc_iso("not a date") is None


def test_normalize_utc_iso_datetime_naive_assumed_utc():
    out = act._normalize_utc_iso(datetime(2026, 5, 1, 10, 0, 0))
    assert out == "2026-05-01T10:00:00Z"


def test_normalize_utc_iso_string_with_z():
    assert act._normalize_utc_iso("2026-05-01T10:00:00Z") == "2026-05-01T10:00:00Z"


def test_normalize_utc_iso_offset_string_converted():
    out = act._normalize_utc_iso("2026-05-01T12:00:00+02:00")
    assert out == "2026-05-01T10:00:00Z"


# ── _normalize_activity_time_fields ─────────────────────────────────────────


def test_normalize_activity_time_fields_normalizes_data_and_laps():
    stored = {
        "data": [
            {"timestamp": "2026-05-01T10:00:00+00:00", "hr": 120},
            {"timestamp": "2026-05-01T10:00:01Z"},
            {"hr": 130},  # no timestamp
            "junk",
        ],
        "laps": [
            {"start_time": "2026-05-01T10:00:00+02:00"},
            "junk",
            {"distance": 1},
        ],
    }
    out, changed = act._normalize_activity_time_fields(stored)
    assert changed is True
    assert out["data"][0]["timestamp"] == "2026-05-01T10:00:00Z"
    # Already normalised → unchanged
    assert out["data"][1]["timestamp"] == "2026-05-01T10:00:01Z"
    assert out["laps"][0]["start_time"] == "2026-05-01T08:00:00Z"


def test_normalize_activity_time_fields_no_changes_when_already_normalized():
    stored = {"data": [{"timestamp": "2026-05-01T10:00:00Z"}]}
    _, changed = act._normalize_activity_time_fields(stored)
    assert changed is False


# ── _as_stream_payload ──────────────────────────────────────────────────────


def test_as_stream_payload_dict_passthrough():
    assert act._as_stream_payload({"x": 1}) == {"x": 1}


def test_as_stream_payload_list_wraps_into_data():
    assert act._as_stream_payload([1, 2, 3]) == {"data": [1, 2, 3]}


def test_as_stream_payload_other_returns_empty():
    assert act._as_stream_payload(None) == {}
    assert act._as_stream_payload("str") == {}


# ── _parse_stream_timestamp ─────────────────────────────────────────────────


def test_parse_stream_timestamp_naive_str_assumed_utc():
    out = act._parse_stream_timestamp("2026-05-01T10:00:00")
    assert out == datetime(2026, 5, 1, 10, tzinfo=timezone.utc)


def test_parse_stream_timestamp_z_suffix():
    out = act._parse_stream_timestamp("2026-05-01T10:00:00Z")
    assert out == datetime(2026, 5, 1, 10, tzinfo=timezone.utc)


def test_parse_stream_timestamp_invalid_returns_none():
    assert act._parse_stream_timestamp(None) is None
    assert act._parse_stream_timestamp("bad") is None
    assert act._parse_stream_timestamp("") is None


# ── _flatten_planned_time_steps ──────────────────────────────────────────────


def test_flatten_planned_time_steps_basic():
    structure = [
        {"category": "warmup",
         "duration": {"type": "time", "value": 600},
         "target": {"type": "zone", "metric": "hr", "zone": 1}},
        {"category": "work",
         "duration": {"type": "time", "value": 1200},
         "target": {"type": "zone", "metric": "hr", "zone": 3}},
    ]
    out = act._flatten_planned_time_steps(structure)
    assert len(out) == 2
    assert out[0]["planned_duration_s"] == 600
    assert out[1]["target"]["zone"] == 3


def test_flatten_planned_time_steps_repeats():
    structure = [{
        "type": "repeat",
        "repeats": 3,
        "steps": [{"duration": {"type": "time", "value": 60},
                   "target": {"zone": 5}}],
    }]
    out = act._flatten_planned_time_steps(structure)
    assert len(out) == 3
    assert all(step["planned_duration_s"] == 60 for step in out)


def test_flatten_planned_time_steps_skips_non_time_durations():
    structure = [
        {"duration": {"type": "distance", "value": 1000}, "target": {}},
        {"duration": {"type": "time", "value": 0}, "target": {}},  # zero duration skipped
        {"duration": {"type": "time", "value": 100}, "target": {"zone": 2}},
    ]
    out = act._flatten_planned_time_steps(structure)
    assert len(out) == 1


def test_flatten_planned_time_steps_handles_invalid_input():
    assert act._flatten_planned_time_steps(None) == []
    assert act._flatten_planned_time_steps("garbage") == []


# ── _extract_actual_split_rows ──────────────────────────────────────────────


def test_extract_actual_split_rows_prefers_laps_over_splits():
    laps = [{"duration": 100, "distance": 500, "avg_hr": 140}]
    splits = [{"elapsed_time": 200, "distance": 1000}]
    out = act._extract_actual_split_rows(splits, laps)
    assert len(out) == 1
    assert out[0]["actual_duration_s"] == 100
    assert out[0]["distance_m"] == 500


def test_extract_actual_split_rows_uses_splits_when_no_laps():
    out = act._extract_actual_split_rows(
        [{"elapsed_time": 200, "distance": 1000, "average_heartrate": 130}], None,
    )
    assert out[0]["actual_duration_s"] == 200
    assert out[0]["avg_hr"] == 130


def test_extract_actual_split_rows_empty_when_neither():
    assert act._extract_actual_split_rows(None, None) == []


def test_extract_actual_split_rows_skips_non_dict():
    out = act._extract_actual_split_rows([{"duration": 60, "distance": 100}, "junk"], None)
    assert len(out) == 1


# ── _compute_normalized_power_watts_from_payload ────────────────────────────


def test_normalized_power_uses_stats_value_when_present():
    out = act._compute_normalized_power_watts_from_payload({"stats": {"normalized_power": 250}})
    assert out == 250


def test_normalized_power_uses_curve_value_when_no_stats():
    out = act._compute_normalized_power_watts_from_payload({"power_curve": {"normalized_power": 240}})
    assert out == 240


def test_normalized_power_short_sample_returns_average():
    payload = {"data": [{"power": 100}, {"power": 200}]}
    out = act._compute_normalized_power_watts_from_payload(payload)
    assert out == 150.0


def test_normalized_power_no_data_returns_none():
    assert act._compute_normalized_power_watts_from_payload({}) is None
    assert act._compute_normalized_power_watts_from_payload({"data": []}) is None


def test_normalized_power_long_sample_uses_rolling_formula():
    # 60 samples of 200 W → NP should equal 200
    payload = {"data": [{"power": 200} for _ in range(60)]}
    out = act._compute_normalized_power_watts_from_payload(payload)
    assert round(out, 1) == 200.0


# ── _workout_target_zone / _is_steady_zone_workout ──────────────────────────


def test_workout_target_zone_from_planned_intensity_string():
    workout = PlannedWorkout(planned_intensity="Z3", structure=[])
    assert act._workout_target_zone(workout) == 3


def test_workout_target_zone_from_structure_majority():
    workout = PlannedWorkout(
        planned_intensity=None,
        structure=[
            {"category": "warmup", "target": {"zone": 1}},  # ignored
            {"category": "work", "target": {"zone": 3}},
            {"category": "work", "target": {"zone": 3}},
            {"category": "work", "target": {"zone": 4}},
        ],
    )
    assert act._workout_target_zone(workout) == 3


def test_workout_target_zone_returns_none_when_no_zones():
    workout = PlannedWorkout(planned_intensity=None, structure=[])
    assert act._workout_target_zone(workout) is None


def test_workout_target_zone_walks_repeats():
    workout = PlannedWorkout(
        planned_intensity=None,
        structure=[{"type": "repeat", "repeats": 4,
                    "steps": [{"category": "work", "target": {"zone": 5}}]}],
    )
    assert act._workout_target_zone(workout) == 5


def test_is_steady_zone_workout_true_when_one_zone_repeated():
    workout = PlannedWorkout(structure=[
        {"category": "work", "target": {"zone": 2}},
        {"category": "work", "target": {"zone": 2}},
    ])
    assert act._is_steady_zone_workout(workout) is True


def test_is_steady_zone_workout_false_when_mixed():
    workout = PlannedWorkout(structure=[
        {"category": "work", "target": {"zone": 2}},
        {"category": "work", "target": {"zone": 4}},
    ])
    assert act._is_steady_zone_workout(workout) is False


def test_is_steady_zone_workout_false_when_empty():
    assert act._is_steady_zone_workout(PlannedWorkout(structure=[])) is False
    assert act._is_steady_zone_workout(PlannedWorkout(structure=None)) is False


# ── _range_match_pct ─────────────────────────────────────────────────────────


def test_range_match_pct_within_range():
    assert act._range_match_pct(105.0, 100.0, 110.0, tolerance=10.0) == 100.0


def test_range_match_pct_just_outside_range():
    out = act._range_match_pct(115.0, 100.0, 110.0, tolerance=10.0)
    # distance=5, 100 - (5/10)*100 = 50
    assert out == 50.0


def test_range_match_pct_far_outside_returns_zero():
    assert act._range_match_pct(50.0, 100.0, 110.0, tolerance=10.0) == 0.0


def test_range_match_pct_none_returns_none():
    assert act._range_match_pct(None, 1.0, 2.0, tolerance=1.0) is None


# ── _activity_feedback_from_payload ─────────────────────────────────────────


def test_activity_feedback_extracts_valid_fields():
    rpe, notes, lactate = act._activity_feedback_from_payload({
        "_meta": {"rpe": 7, "notes": " hard ride ", "lactate_mmol_l": 4.5}
    })
    assert rpe == 7
    assert notes == "hard ride"
    assert lactate == 4.5


def test_activity_feedback_filters_invalid_ranges():
    rpe, notes, lactate = act._activity_feedback_from_payload({
        "_meta": {"rpe": 99, "notes": "  ", "lactate_mmol_l": 999.0}
    })
    assert rpe is None
    assert notes is None
    assert lactate is None


def test_activity_feedback_handles_non_dict_payload():
    assert act._activity_feedback_from_payload(None) == (None, None, None)
    assert act._activity_feedback_from_payload({}) == (None, None, None)
    assert act._activity_feedback_from_payload({"_meta": "junk"}) == (None, None, None)


# ── _is_activity_deleted ────────────────────────────────────────────────────


def test_is_activity_deleted_true_when_meta_flag():
    a = Activity(id=1, athlete_id=1, filename="x", file_path="/", file_type="fit",
                 streams={"_meta": {"deleted": True}})
    assert act._is_activity_deleted(a) is True


def test_is_activity_deleted_false_when_no_meta():
    a = Activity(id=1, athlete_id=1, filename="x", file_path="/", file_type="fit",
                 streams=None)
    assert act._is_activity_deleted(a) is False


# ── _resolve_training_status ─────────────────────────────────────────────────


@pytest.mark.parametrize("tsb, ctl, expected", [
    (0, 2, "Detraining"),
    (20, 30, "Fresh"),
    (10, 30, "Productive"),
    (0, 30, "Maintaining"),
    (-15, 30, "Fatigued"),
    (-30, 30, "Strained"),
])
def test_resolve_training_status(tsb, ctl, expected):
    assert act._resolve_training_status(tsb, ctl) == expected


# ── _compute_load_from_zone_minutes ─────────────────────────────────────────


def test_compute_load_from_zone_minutes_aerobic_skewed():
    zone_minutes = {"Z1": 60.0, "Z2": 30.0}
    weights = {"Z1": 1.0, "Z2": 2.0}
    aerobic_fraction = {"Z1": 0.95, "Z2": 0.85}
    aerobic, anaerobic = act._compute_load_from_zone_minutes(
        zone_minutes, zone_weights=weights, aerobic_fraction=aerobic_fraction,
    )
    assert aerobic > anaerobic
    assert aerobic > 0
    assert anaerobic > 0


def test_compute_load_from_zone_minutes_zero_returns_zeros():
    aerobic, anaerobic = act._compute_load_from_zone_minutes(
        {}, zone_weights={"Z1": 1.0}, aerobic_fraction={"Z1": 0.95},
    )
    assert aerobic == 0.0 and anaerobic == 0.0


def test_compute_load_from_zone_minutes_anaerobic_skewed():
    """All-out Z5 minutes → anaerobic should beat aerobic per the fraction map."""
    zone_minutes = {"Z5": 30.0}
    weights = {"Z5": 5.0}
    aerobic_fraction = {"Z5": 0.20}
    aerobic, anaerobic = act._compute_load_from_zone_minutes(
        zone_minutes, zone_weights=weights, aerobic_fraction=aerobic_fraction,
    )
    assert anaerobic > aerobic


# ── _load_from_meta_dict / _cached_activity_load_from_meta ──────────────────


def test_load_from_meta_dict_valid():
    out = act._load_from_meta_dict({"aerobic_load": 12.345, "anaerobic_load": 3.0})
    assert out == (12.3, 3.0)


def test_load_from_meta_dict_missing_returns_none():
    assert act._load_from_meta_dict({}) is None
    assert act._load_from_meta_dict(None) is None


def test_load_from_meta_dict_negative_returns_none():
    assert act._load_from_meta_dict({"aerobic_load": -1, "anaerobic_load": 2}) is None


def test_load_from_meta_dict_invalid_types_returns_none():
    assert act._load_from_meta_dict({"aerobic_load": "x", "anaerobic_load": 2}) is None


def test_cached_activity_load_from_meta_uses_stream_meta():
    a = Activity(id=1, athlete_id=1, filename="x", file_path="/", file_type="fit",
                 streams={"_meta": {"aerobic_load": 50, "anaerobic_load": 10}})
    assert act._cached_activity_load_from_meta(a) == (50.0, 10.0)


def test_cached_activity_load_from_meta_returns_none_when_absent():
    a = Activity(id=1, athlete_id=1, filename="x", file_path="/", file_type="fit",
                 streams={})
    assert act._cached_activity_load_from_meta(a) is None


# ── _estimate_load_from_activity_summary ────────────────────────────────────


def _activity(**kw) -> Activity:
    base = dict(id=1, athlete_id=1, filename="x", file_path="/", file_type="fit",
                duration=3600, distance=10000, sport="running", streams=None)
    base.update(kw)
    return Activity(**base)


def test_estimate_load_returns_none_when_no_duration():
    a = _activity(duration=0)
    assert act._estimate_load_from_activity_summary(
        a, sport="running", ftp=0, max_hr=190
    ) is None


def test_estimate_load_uses_power_when_available():
    a = _activity(average_watts=200, sport="cycling", duration=3600)
    out = act._estimate_load_from_activity_summary(
        a, sport="cycling", ftp=200, max_hr=190
    )
    assert out is not None
    aerobic, anaerobic = out
    assert aerobic > 0 and anaerobic > 0


def test_estimate_load_uses_hr_trimp_when_no_power():
    p = Profile(user_id=1, resting_hr=50)
    a = _activity(average_hr=150, average_watts=0, duration=3600)
    out = act._estimate_load_from_activity_summary(
        a, sport="running", ftp=0, max_hr=200, profile=p
    )
    assert out is not None
    assert out[0] > 0


def test_estimate_load_default_when_no_signals():
    a = _activity(average_hr=0, average_watts=0, duration=1800, sport="walking")
    out = act._estimate_load_from_activity_summary(
        a, sport="other", ftp=0, max_hr=0
    )
    assert out is not None
    aerobic, anaerobic = out
    # Anaerobic should be much smaller than aerobic in default case
    assert aerobic > anaerobic


# ── _activity_list_load (uses cache → estimate fallback) ────────────────────


def test_activity_list_load_uses_cached_meta_when_present():
    a = _activity(streams={"_meta": {"aerobic_load": 25, "anaerobic_load": 5}})
    assert act._activity_list_load(a, ftp=200, max_hr=190) == (25.0, 5.0)


def test_activity_list_load_falls_back_to_estimate():
    a = _activity(streams={}, average_watts=200, duration=3600, sport="cycling")
    out = act._activity_list_load(a, ftp=200, max_hr=190)
    assert out[0] > 0
