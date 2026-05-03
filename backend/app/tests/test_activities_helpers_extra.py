"""Additional pure-helper tests for activities.py: caches, intensity, planned templates."""

from __future__ import annotations

import time
from datetime import date, datetime, timezone

import pytest

from app.models import Activity, PlannedWorkout, Profile
from app.routers import activities as act


# ── _cache_get / _cache_set / _invalidate_athlete_caches ─────────────────────


def test_cache_get_returns_none_when_missing():
    store = {}
    assert act._cache_get(store, "k", ttl=60) is None


def test_cache_set_then_get_returns_value():
    store = {}
    act._cache_set(store, "k", "v")
    assert act._cache_get(store, "k", ttl=60) == "v"


def test_cache_get_returns_none_when_expired():
    store = {"k": (time.monotonic() - 100, "v")}
    assert act._cache_get(store, "k", ttl=10) is None


def test_invalidate_athlete_caches_drops_matching_prefix():
    act._PERF_TREND_CACHE["7:foo"] = (time.monotonic(), "x")
    act._PERF_TREND_CACHE["8:bar"] = (time.monotonic(), "y")
    act._ZONE_SUMMARY_CACHE["7:zone"] = (time.monotonic(), "z")
    act._invalidate_athlete_caches(7)
    assert "7:foo" not in act._PERF_TREND_CACHE
    assert "8:bar" in act._PERF_TREND_CACHE
    assert "7:zone" not in act._ZONE_SUMMARY_CACHE
    # Cleanup
    act._PERF_TREND_CACHE.pop("8:bar", None)


# ── _build_activity_zone_summary ────────────────────────────────────────────


def test_build_activity_zone_summary_returns_none_for_other_sport():
    a = Activity(id=1, athlete_id=1, filename="x", file_path="/", file_type="fit",
                 sport="swimming", duration=600, distance=500, streams={},
                 created_at=datetime(2026, 5, 1))
    out = act._build_activity_zone_summary(a, ftp=200, max_hr=190)
    assert out is None


def test_build_activity_zone_summary_running_basic():
    streams = {"data": [{"heart_rate": 150}, {"heart_rate": 160}]}
    a = Activity(id=1, athlete_id=1, filename="run.fit", file_path="/", file_type="fit",
                 sport="running", duration=3600, distance=10000, streams=streams,
                 created_at=datetime(2026, 5, 1))
    out = act._build_activity_zone_summary(a, ftp=0, max_hr=190)
    assert out is not None
    assert out["sport"] == "running"
    assert out["activity_id"] == 1
    assert out["distance_km"] == 10.0


# ── _structured_intensity_assessment ────────────────────────────────────────


def test_structured_intensity_returns_none_when_no_data():
    assert act._structured_intensity_assessment([], []) is None


def test_structured_intensity_returns_none_when_no_watts_targets():
    planned = [{"target": {"metric": "hr", "value": 150}}]
    actual = [{"avg_power": 200}]
    assert act._structured_intensity_assessment(planned, actual) is None


def test_structured_intensity_perfect_score():
    planned = [{"target": {"metric": "watts", "value": 200}}]
    actual = [{"avg_power": 200}]
    out = act._structured_intensity_assessment(planned, actual)
    assert out is not None
    assert out["match_pct"] == 100.0
    assert out["status"] == "green"


def test_structured_intensity_red_when_far_off():
    planned = [{"target": {"unit": "W", "value": 200}}]
    actual = [{"avg_power": 80}]
    out = act._structured_intensity_assessment(planned, actual)
    assert out["status"] == "red"


# ── _intensity_assessment ───────────────────────────────────────────────────


def test_intensity_assessment_returns_none_no_zone():
    workout = PlannedWorkout(planned_intensity=None, structure=[], sport_type="cycling")
    activity = Activity(id=1, athlete_id=1, filename="x", file_path="/", file_type="fit",
                        sport="cycling", duration=3600, streams={})
    assert act._intensity_assessment(workout, activity, None, {}) is None


def test_intensity_assessment_cycling_no_ftp_returns_none():
    workout = PlannedWorkout(planned_intensity="Z3", structure=[], sport_type="cycling")
    activity = Activity(id=1, athlete_id=1, filename="x", file_path="/", file_type="fit",
                        sport="cycling", duration=3600, streams={})
    profile = Profile(user_id=1, ftp=0)
    assert act._intensity_assessment(workout, activity, profile, {}) is None


def test_intensity_assessment_cycling_returns_dict_with_status():
    workout = PlannedWorkout(planned_intensity="Z3", structure=[], sport_type="cycling")
    activity = Activity(id=1, athlete_id=1, filename="x", file_path="/", file_type="fit",
                        sport="cycling", duration=3600, average_watts=180, streams={})
    profile = Profile(user_id=1, ftp=200)
    out = act._intensity_assessment(workout, activity, profile, {"max_watts": 240})
    assert out is not None
    assert out["sport"] == "cycling"
    assert "status" in out
    assert out["zone"] == 3


def test_intensity_assessment_running_returns_dict():
    workout = PlannedWorkout(planned_intensity="Z2", structure=[], sport_type="running")
    activity = Activity(id=1, athlete_id=1, filename="x", file_path="/", file_type="fit",
                        sport="running", duration=3600, avg_speed=3.5, average_hr=145,
                        streams={})
    profile = Profile(user_id=1, lt2=4.5, max_hr=190)
    out = act._intensity_assessment(workout, activity, profile, {"max_hr": 165})
    assert out is not None
    assert out["sport"] == "running"


def test_intensity_assessment_other_sport_returns_none():
    workout = PlannedWorkout(planned_intensity="Z2", structure=[], sport_type="swimming")
    activity = Activity(id=1, athlete_id=1, filename="x", file_path="/", file_type="fit",
                        sport="swimming", duration=3600, streams={})
    assert act._intensity_assessment(workout, activity, None, {}) is None


# ── _extract_actual_split_rows_from_planned_template ────────────────────────


def test_planned_template_splits_empty_when_no_steps():
    a = Activity(id=1, athlete_id=1, filename="x", file_path="/", file_type="fit",
                 duration=3600, streams={"data": [{"elapsed_s": 0, "heart_rate": 140}]})
    assert act._extract_actual_split_rows_from_planned_template(a, []) == []


def test_planned_template_splits_empty_when_no_data_points():
    a = Activity(id=1, athlete_id=1, filename="x", file_path="/", file_type="fit",
                 duration=3600, streams={})
    out = act._extract_actual_split_rows_from_planned_template(
        a, [{"planned_duration_s": 60}]
    )
    assert out == []


def test_planned_template_splits_distributes_proportionally():
    points = [
        {"elapsed_s": 0, "distance": 0, "heart_rate": 130, "power": 100, "speed": 2.5},
        {"elapsed_s": 30, "distance": 100, "heart_rate": 140, "power": 150, "speed": 3.0},
        {"elapsed_s": 60, "distance": 200, "heart_rate": 150, "power": 200, "speed": 3.5},
        {"elapsed_s": 90, "distance": 300, "heart_rate": 160, "power": 220, "speed": 4.0},
    ]
    a = Activity(id=1, athlete_id=1, filename="x", file_path="/", file_type="fit",
                 duration=90, streams={"data": points})
    planned = [
        {"planned_duration_s": 30},
        {"planned_duration_s": 60},
    ]
    out = act._extract_actual_split_rows_from_planned_template(a, planned)
    assert len(out) == 2
    assert out[0]["split"] == 1
    assert out[1]["split"] == 2
    assert out[0]["source"] == "planned_template"
    assert all("avg_hr" in row for row in out)


def test_planned_template_splits_uses_timestamp_when_no_elapsed():
    points = [
        {"timestamp": "2026-05-01T10:00:00Z", "heart_rate": 140},
        {"timestamp": "2026-05-01T10:00:30Z", "heart_rate": 150},
        {"timestamp": "2026-05-01T10:01:00Z", "heart_rate": 160},
    ]
    a = Activity(id=1, athlete_id=1, filename="x", file_path="/", file_type="fit",
                 duration=60, streams={"data": points})
    out = act._extract_actual_split_rows_from_planned_template(
        a, [{"planned_duration_s": 60}]
    )
    assert len(out) == 1
    assert out[0]["avg_hr"] is not None


def test_planned_template_splits_skips_non_dict_points():
    points = [
        "garbage",
        {"elapsed_s": 0, "heart_rate": 130},
        {"elapsed_s": 30, "heart_rate": 140},
    ]
    a = Activity(id=1, athlete_id=1, filename="x", file_path="/", file_type="fit",
                 duration=30, streams={"data": points})
    out = act._extract_actual_split_rows_from_planned_template(
        a, [{"planned_duration_s": 30}]
    )
    assert len(out) == 1


def test_planned_template_splits_zero_planned_total_returns_empty():
    a = Activity(id=1, athlete_id=1, filename="x", file_path="/", file_type="fit",
                 duration=60, streams={"data": [{"elapsed_s": 0}]})
    out = act._extract_actual_split_rows_from_planned_template(
        a, [{"planned_duration_s": 0}]
    )
    assert out == []
