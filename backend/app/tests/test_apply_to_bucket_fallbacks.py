"""Coverage for cycling/running fallback branches in _apply_activity_to_bucket."""

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


# ── Cycling fallback branches ─────────────────────────────────────────────


def test_cycling_lap_power_fallback_when_no_samples():
    activity = _activity(
        sport="cycling", duration=3600,
        average_watts=0,
        streams={"data": [], "laps": [
            {"avg_power": 200, "duration": 1200},
            {"avg_power": 150, "duration": 2400},
        ]},
    )
    bucket = act._empty_bucket()
    act._apply_activity_to_bucket(bucket, activity, ftp=250, max_hr=190,
                                    profile=_profile())
    power_zones = bucket["sports"]["cycling"]["zone_seconds_by_metric"]["power"]
    assert sum(power_zones.values()) > 0


def test_cycling_hr_zones_dict_fallback():
    activity = _activity(
        sport="cycling", duration=3600,
        average_watts=0, average_hr=0,
        streams={"data": [], "hr_zones": {"Z1": 600, "Z2": 1200,
                                            "Z3": 900, "Z4": 600,
                                            "Z5": 300}},
    )
    bucket = act._empty_bucket()
    act._apply_activity_to_bucket(bucket, activity, ftp=0, max_hr=190,
                                    profile=_profile(ftp=0))
    hr_zones = bucket["sports"]["cycling"]["zone_seconds_by_metric"]["hr"]
    assert hr_zones["Z1"] == 600


def test_cycling_lap_hr_fallback():
    activity = _activity(
        sport="cycling", duration=3600,
        average_watts=0, average_hr=0,
        streams={"data": [], "laps": [
            {"avg_hr": 140, "duration": 1800},
            {"avg_hr": 160, "duration": 1800},
        ]},
    )
    bucket = act._empty_bucket()
    act._apply_activity_to_bucket(bucket, activity, ftp=0, max_hr=190,
                                    profile=_profile(ftp=0))
    hr_zones = bucket["sports"]["cycling"]["zone_seconds_by_metric"]["hr"]
    assert sum(hr_zones.values()) > 0


def test_cycling_estimate_ftp_from_power_curve_path():
    # Just exercise the FTP estimation path; assert it doesn't error.
    activity = _activity(
        sport="cycling", duration=3600,
        streams={"data": [{"power": 200} for _ in range(20)],
                 "power_curve": {"20min": 250}},
    )
    bucket = act._empty_bucket()
    act._apply_activity_to_bucket(bucket, activity, ftp=0, max_hr=190,
                                    profile=_profile(ftp=0))
    power_zones = bucket["sports"]["cycling"]["zone_seconds_by_metric"]["power"]
    assert sum(power_zones.values()) > 0


# ── Running fallback branches ────────────────────────────────────────────


def test_running_hr_zones_dict_fallback():
    activity = _activity(
        sport="running", duration=3600, distance=10000,
        average_hr=0, average_watts=0,
        streams={"data": [], "hr_zones": {"Z1": 300, "Z2": 600,
                                            "Z3": 1500, "Z4": 600,
                                            "Z5": 600}},
    )
    bucket = act._empty_bucket()
    act._apply_activity_to_bucket(bucket, activity, ftp=0, max_hr=190,
                                    profile=_profile())
    hr_zones = bucket["sports"]["running"]["zone_seconds_by_metric"]["hr"]
    assert hr_zones["Z3"] == 1500


def test_running_lap_hr_fallback():
    activity = _activity(
        sport="running", duration=3600, distance=10000,
        average_hr=0,
        streams={"data": [], "laps": [
            {"avg_hr": 145, "duration": 1800},
            {"avg_hr": 165, "duration": 1800},
        ]},
    )
    bucket = act._empty_bucket()
    act._apply_activity_to_bucket(bucket, activity, ftp=0, max_hr=190,
                                    profile=_profile())
    hr_zones = bucket["sports"]["running"]["zone_seconds_by_metric"]["hr"]
    assert sum(hr_zones.values()) > 0


def test_running_pace_zones_from_speed_samples():
    activity = _activity(
        sport="running", duration=3600, distance=10000,
        streams={"data": [{"speed": 3.0, "heart_rate": 150}
                          for _ in range(60)]},
    )
    bucket = act._empty_bucket()
    act._apply_activity_to_bucket(bucket, activity, ftp=0, max_hr=190,
                                    profile=_profile(lt2=5.0))
    pace_zones = bucket["sports"]["running"]["zone_seconds_by_metric"]["pace"]
    assert sum(pace_zones.values()) > 0


def test_apply_unsupported_sport_only_increments_overall():
    activity = _activity(sport="hiking", duration=3600, distance=5000)
    bucket = act._empty_bucket()
    act._apply_activity_to_bucket(bucket, activity, ftp=0, max_hr=190)
    assert bucket["activities_count"] == 1
    assert bucket["sports"]["running"]["activities_count"] == 0
    assert bucket["sports"]["cycling"]["activities_count"] == 0
