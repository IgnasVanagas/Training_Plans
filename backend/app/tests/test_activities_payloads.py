"""High-leverage tests for _build_planned_comparison_payload and other
big pure helpers in app.routers.activities."""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

import pytest

from app.routers import activities as act


def _wo(**kw):
    base = dict(
        id=1, user_id=1, title="Test Workout", description=None,
        sport_type="cycling",
        planned_duration=60, planned_distance=20,
        planned_intensity="zone 2", structure=None,
    )
    base.update(kw)
    return SimpleNamespace(**base)


def _activity(**kw):
    base = dict(
        id=1, athlete_id=1, sport="cycling",
        duration=3600, distance=20000,
        average_hr=140, average_watts=180, avg_speed=5.5,
        streams=None,
        created_at=datetime(2024, 5, 1, 10, 0, 0),
    )
    base.update(kw)
    return SimpleNamespace(**base)


# ── _activity_feedback_from_payload ─────────────────────────────────────────


def test_activity_feedback_extracts_rpe_notes_lactate():
    rpe, notes, lac = act._activity_feedback_from_payload({"_meta": {
        "rpe": 7, "notes": " hard ", "lactate_mmol_l": 4.5,
    }})
    assert rpe == 7
    assert notes == "hard"
    assert lac == 4.5


def test_activity_feedback_clamps_rpe_to_range():
    rpe, _, _ = act._activity_feedback_from_payload({"_meta": {"rpe": 20}})
    assert rpe is None
    rpe, _, _ = act._activity_feedback_from_payload({"_meta": {"rpe": "bad"}})
    assert rpe is None


def test_activity_feedback_clamps_lactate():
    _, _, lac = act._activity_feedback_from_payload({"_meta": {"lactate_mmol_l": 999}})
    assert lac is None


def test_activity_feedback_handles_non_dict_payload():
    assert act._activity_feedback_from_payload(None) == (None, None, None)


def test_activity_feedback_strips_blank_notes():
    _, notes, _ = act._activity_feedback_from_payload({"_meta": {"notes": "   "}})
    assert notes is None


# ── _is_activity_deleted ────────────────────────────────────────────────────


def test_is_activity_deleted_true_and_false():
    a1 = _activity(streams={"_meta": {"deleted": True}})
    a2 = _activity(streams={"_meta": {}})
    a3 = _activity(streams=None)
    assert act._is_activity_deleted(a1) is True
    assert act._is_activity_deleted(a2) is False
    assert act._is_activity_deleted(a3) is False


# ── _build_planned_comparison_payload ───────────────────────────────────────


def test_build_planned_comparison_payload_basic_no_intensity():
    workout = _wo(
        sport_type="running",
        planned_duration=30, planned_distance=5,
        planned_intensity=None, structure=None,
    )
    activity = _activity(
        sport="running", duration=1800, distance=5000,
        average_hr=140, avg_speed=2.78, average_watts=0,
    )
    out = act._build_planned_comparison_payload(
        workout, activity, splits_metric=None, laps=None,
        profile=None, stats={},
    )
    assert "planned" in out
    assert "actual" in out
    assert "summary" in out
    summary = out["summary"]
    # 30min planned, 30min actual → strong duration match
    assert summary["duration_match_pct"] >= 99
    assert summary["distance_match_pct"] >= 99
    assert summary["execution_status"] in {"great", "good", "ok", "fair",
                                            "subpar", "poor", "incomplete"}
    assert out["splits"] == [] or isinstance(out["splits"], list)


def test_build_planned_comparison_payload_with_splits():
    workout = _wo(
        planned_duration=30, planned_distance=10,
        structure=[
            {"type": "step", "duration": {"type": "time", "value": 600},
             "target": {"zone": 2}},
            {"type": "step", "duration": {"type": "time", "value": 1200},
             "target": {"zone": 2}},
        ],
    )
    activity = _activity(duration=1800, distance=10000)
    laps = [
        {"duration": 600, "distance": 3000},
        {"duration": 1200, "distance": 7000},
    ]
    out = act._build_planned_comparison_payload(
        workout, activity, splits_metric=None, laps=laps,
        profile=None, stats={},
    )
    assert isinstance(out["splits"], list)
    assert len(out["splits"]) == 2


def test_build_planned_comparison_payload_no_planned_distance():
    workout = _wo(planned_distance=0, planned_duration=30)
    activity = _activity(duration=1800, distance=0)
    out = act._build_planned_comparison_payload(
        workout, activity, splits_metric=None, laps=None,
        profile=None, stats={},
    )
    assert out["summary"]["distance_match_pct"] is None


def test_build_planned_comparison_payload_zero_actual_marks_incomplete():
    workout = _wo(planned_duration=30, planned_distance=5)
    activity = _activity(duration=0, distance=0)
    out = act._build_planned_comparison_payload(
        workout, activity, splits_metric=None, laps=None,
        profile=None, stats={},
    )
    assert out["summary"]["execution_status"] == "incomplete"


# ── _intensity_assessment with cycling/FTP ─────────────────────────────────


def test_intensity_assessment_cycling_returns_dict():
    workout = _wo(planned_intensity="zone 2", structure=None)
    profile = SimpleNamespace(ftp=250)
    activity = _activity(
        average_watts=170, streams={"stats": {"max_watts": 200,
                                              "normalized_power": 180}},
    )
    out = act._intensity_assessment(workout, activity, profile,
                                     stats={"max_watts": 200})
    assert isinstance(out, dict)
    assert out["sport"] == "cycling"
    assert "match_pct" in out
    assert out["status"] in {"green", "yellow", "red"}


def test_intensity_assessment_returns_none_when_no_zone():
    workout = _wo(planned_intensity=None, structure=None)
    out = act._intensity_assessment(workout, _activity(), profile=None,
                                     stats={})
    assert out is None


def test_intensity_assessment_returns_none_when_cycling_without_ftp():
    workout = _wo(planned_intensity="zone 2")
    out = act._intensity_assessment(workout, _activity(), profile=None,
                                     stats={})
    assert out is None


# ── _structured_intensity_assessment ───────────────────────────────────────


def test_structured_intensity_assessment_returns_none_when_no_targets():
    planned = [{"planned_duration_s": 60, "target": {}}]
    actual = [{"actual_duration_s": 60}]
    out = act._structured_intensity_assessment(planned, actual)
    assert out is None


def test_structured_intensity_assessment_with_power_targets():
    planned = [
        {"planned_duration_s": 60,
         "target": {"metric": "watts", "value": 200}},
        {"planned_duration_s": 60,
         "target": {"metric": "watts", "value": 200}},
    ]
    actual = [
        {"actual_duration_s": 60, "avg_power": 200},
        {"actual_duration_s": 60, "avg_power": 200},
    ]
    out = act._structured_intensity_assessment(planned, actual)
    assert out is not None
    assert out["sport"] == "structured"
    assert out["match_pct"] > 50


# ── _range_match_pct ────────────────────────────────────────────────────────


def test_range_match_pct_within_range_is_100():
    assert act._range_match_pct(150, 100, 200, tolerance=10.0) == 100.0


def test_range_match_pct_outside_decays():
    out = act._range_match_pct(110, 120, 180, tolerance=10.0)
    assert 0.0 <= out < 100.0


def test_range_match_pct_none_returns_none():
    assert act._range_match_pct(None, 1, 2, tolerance=1.0) is None


# ── _zone_bucket_key / _add_zone_seconds ────────────────────────────────────


def test_zone_bucket_key_clamps_to_existing_keys():
    seconds = {f"Z{i}": 0.0 for i in range(1, 6)}
    assert act._zone_bucket_key(seconds, 0) == "Z1"
    assert act._zone_bucket_key(seconds, 99) == "Z5"
    assert act._zone_bucket_key(seconds, 3) == "Z3"


def test_add_zone_seconds_accumulates():
    seconds = {f"Z{i}": 0.0 for i in range(1, 6)}
    act._add_zone_seconds(seconds, 2, 30.0)
    act._add_zone_seconds(seconds, 2, 15.0)
    assert seconds["Z2"] == 45.0


# ── _normalize_utc_iso (router copy) ───────────────────────────────────────


def test_normalize_utc_iso_router():
    out = act._normalize_utc_iso("2024-05-01T10:00:00Z")
    assert isinstance(out, str)
    assert out.endswith("Z")
    assert act._normalize_utc_iso(None) is None
    assert act._normalize_utc_iso("bad") is None


def test_normalize_activity_time_fields_detects_changes():
    data = {"created_at": "2024-05-01T10:00:00Z",
            "updated_at": "2024-05-01T11:00:00+00:00"}
    out, changed = act._normalize_activity_time_fields(data)
    assert isinstance(out, dict)
    assert isinstance(changed, bool)


# ── _round_bucket ──────────────────────────────────────────────────────────


def test_round_bucket_rounds_durations_and_distances():
    bucket = act._empty_bucket()
    bucket["total_duration_minutes"] = 12.3456
    bucket["total_distance_km"] = 7.89012
    bucket["sports"]["running"]["total_duration_minutes"] = 1.234
    out = act._round_bucket(bucket)
    assert out["total_duration_minutes"] == round(12.3456, 1)


# ── _cached_activity_load_from_meta / _load_from_meta_dict ─────────────────


def test_load_from_meta_dict_extracts_aerobic_anaerobic():
    out = act._load_from_meta_dict({"aerobic_load": 30.5,
                                     "anaerobic_load": 12.0})
    assert out == (30.5, 12.0)


def test_load_from_meta_dict_returns_none_when_missing():
    assert act._load_from_meta_dict({}) is None
    assert act._load_from_meta_dict("not-a-dict") is None


def test_cached_activity_load_from_meta_via_streams():
    activity = _activity(streams={"_meta": {"aerobic_load": 25.0,
                                             "anaerobic_load": 10.0}})
    out = act._cached_activity_load_from_meta(activity)
    assert out == (25.0, 10.0)


def test_cached_activity_load_from_meta_returns_none():
    activity = _activity(streams={"_meta": {}})
    assert act._cached_activity_load_from_meta(activity) is None
