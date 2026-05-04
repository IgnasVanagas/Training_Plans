"""Tests for activities load/training-load helpers."""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

from app.routers import activities as act


def _activity(**kw):
    base = dict(
        id=1, athlete_id=1, sport="cycling",
        filename="ride.fit", duration=3600, distance=20000,
        average_hr=140, average_watts=180, avg_speed=5.5,
        streams=None, aerobic_load=None, anaerobic_load=None,
        moving_time=None, local_date=None,
        created_at=datetime(2024, 5, 1, 10, 0),
    )
    base.update(kw)
    return SimpleNamespace(**base)


def _profile(**kw):
    base = dict(ftp=250, max_hr=190, resting_hr=50, lt2=0,
                training_zones=None)
    base.update(kw)
    return SimpleNamespace(**base)


# ── _estimate_load_from_activity_summary ────────────────────────────────────


def test_estimate_load_zero_duration_returns_none():
    activity = _activity(duration=0)
    out = act._estimate_load_from_activity_summary(
        activity, sport="cycling", ftp=250, max_hr=190, profile=_profile()
    )
    assert out is None


def test_estimate_load_uses_power_when_available():
    activity = _activity(average_watts=200, average_hr=0)
    out = act._estimate_load_from_activity_summary(
        activity, sport="cycling", ftp=250, max_hr=190, profile=_profile()
    )
    assert out is not None
    aerobic, anaerobic = out
    assert aerobic > 0


def test_estimate_load_uses_hr_when_no_power():
    activity = _activity(average_watts=0, average_hr=140)
    out = act._estimate_load_from_activity_summary(
        activity, sport="running", ftp=0, max_hr=190, profile=_profile()
    )
    assert out is not None


def test_estimate_load_falls_back_to_duration_only():
    activity = _activity(average_watts=0, average_hr=0)
    out = act._estimate_load_from_activity_summary(
        activity, sport="running", ftp=0, max_hr=0, profile=_profile()
    )
    assert out is not None


# ── _compute_load_from_zone_minutes ─────────────────────────────────────────


def test_compute_load_from_zone_minutes_basic():
    weights = {"Z1": 1, "Z2": 2, "Z3": 3, "Z4": 4, "Z5": 5}
    aerobic_fraction = {"Z1": 0.95, "Z2": 0.85, "Z3": 0.70, "Z4": 0.50, "Z5": 0.30}
    aerobic, anaerobic = act._compute_load_from_zone_minutes(
        {"Z1": 30, "Z2": 20}, zone_weights=weights,
        aerobic_fraction=aerobic_fraction,
    )
    assert aerobic > 0
    assert anaerobic > 0


def test_compute_load_from_zone_minutes_zero_returns_zero():
    weights = {"Z1": 1, "Z2": 2}
    fraction = {"Z1": 0.95, "Z2": 0.85}
    aerobic, anaerobic = act._compute_load_from_zone_minutes(
        {}, zone_weights=weights, aerobic_fraction=fraction,
    )
    assert aerobic == 0.0
    assert anaerobic == 0.0


# ── _activity_list_load uses cached when present ────────────────────────────


def test_activity_list_load_uses_cached_meta():
    activity = _activity(streams={"_meta": {"aerobic_load": 50.0,
                                              "anaerobic_load": 20.0}})
    out = act._activity_list_load(activity, ftp=250, max_hr=190,
                                    profile=_profile())
    assert out == (50.0, 20.0)


def test_activity_list_load_falls_back_to_estimate():
    activity = _activity(streams=None, average_watts=200, average_hr=140,
                          duration=3600)
    out = act._activity_list_load(activity, ftp=250, max_hr=190,
                                    profile=_profile())
    assert out is not None
    aerobic, anaerobic = out
    assert aerobic >= 0


# ── _activity_training_load with running/cycling/other ─────────────────────


def test_activity_training_load_running_with_hr_samples():
    activity = _activity(
        sport="running", duration=3600, distance=10000,
        average_hr=145, average_watts=0, avg_speed=3.0,
        streams={"data": [
            {"heart_rate": 130 + (i % 30), "speed": 3.0}
            for i in range(50)
        ]},
    )
    profile = _profile(max_hr=190, resting_hr=50, lt2=5.0)
    aerobic, anaerobic = act._activity_training_load(
        activity, ftp=0, max_hr=190, profile=profile
    )
    assert aerobic >= 0
    assert anaerobic >= 0


def test_activity_training_load_cycling_with_power_samples():
    activity = _activity(
        sport="cycling", duration=3600,
        average_watts=200, average_hr=140,
        streams={"data": [
            {"power": 180 + (i % 50), "heart_rate": 140}
            for i in range(50)
        ]},
    )
    aerobic, anaerobic = act._activity_training_load(
        activity, ftp=250, max_hr=190, profile=_profile()
    )
    assert aerobic >= 0


def test_activity_training_load_cycling_with_hr_only_falls_back():
    activity = _activity(
        sport="cycling", duration=3600,
        average_watts=0, average_hr=140,
        streams={"data": [{"heart_rate": 140} for _ in range(50)]},
    )
    aerobic, anaerobic = act._activity_training_load(
        activity, ftp=0, max_hr=190, profile=_profile(ftp=0)
    )
    assert aerobic >= 0


def test_activity_training_load_other_sport_uses_hr_zone_minutes():
    activity = _activity(
        sport="swimming", duration=3600,
        average_hr=140, average_watts=0,
        streams={"data": [{"heart_rate": 130 + (i % 20)}
                          for i in range(50)]},
    )
    aerobic, anaerobic = act._activity_training_load(
        activity, ftp=0, max_hr=190, profile=_profile()
    )
    assert aerobic >= 0


def test_activity_training_load_other_sport_uses_hr_zones_dict():
    activity = _activity(
        sport="other", duration=3600,
        streams={"hr_zones": {"Z1": 600, "Z2": 1200, "Z3": 900,
                              "Z4": 600, "Z5": 300}},
    )
    aerobic, anaerobic = act._activity_training_load(
        activity, ftp=0, max_hr=0, profile=None
    )
    assert aerobic > 0


def test_activity_training_load_other_sport_zero_falls_back_to_estimate():
    activity = _activity(
        sport="hiking", duration=3600,
        average_watts=0, average_hr=130,
        streams=None,
    )
    out = act._activity_training_load(
        activity, ftp=0, max_hr=190, profile=_profile()
    )
    assert out is not None


# ── _build_activity_zone_summary populated branch ──────────────────────────


def test_build_activity_zone_summary_returns_dict_for_supported_sport():
    activity = _activity(
        sport="cycling", duration=3600, distance=20000,
        average_watts=180,
        streams={"data": [{"power": 170 + (i % 60), "heart_rate": 140}
                          for i in range(60)]},
    )
    out = act._build_activity_zone_summary(
        activity, ftp=250, max_hr=190, profile=_profile()
    )
    assert isinstance(out, dict)
    assert out["sport"] == "cycling"
    assert "zone_seconds" in out


def test_build_activity_zone_summary_returns_none_for_unsupported_sport():
    activity = _activity(sport="swimming")
    assert act._build_activity_zone_summary(
        activity, ftp=250, max_hr=190
    ) is None


# ── _resolve_training_status branches ──────────────────────────────────────


def test_resolve_training_status_detraining():
    assert act._resolve_training_status(0, 2) == "Detraining"


def test_resolve_training_status_fresh():
    assert act._resolve_training_status(20, 100) == "Fresh"


def test_resolve_training_status_productive():
    assert act._resolve_training_status(10, 100) == "Productive"


def test_resolve_training_status_maintaining():
    assert act._resolve_training_status(0, 100) == "Maintaining"


def test_resolve_training_status_fatigued():
    assert act._resolve_training_status(-15, 100) == "Fatigued"


def test_resolve_training_status_strained():
    assert act._resolve_training_status(-30, 100) == "Strained"
