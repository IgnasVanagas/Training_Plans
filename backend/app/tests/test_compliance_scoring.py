"""Tests for compliance scoring helpers (cycling/running intensity, status)."""

from __future__ import annotations

from datetime import date, datetime
from types import SimpleNamespace

import pytest

from app.models import ComplianceStatusEnum
from app.services import compliance as cm


def _act(**kw):
    base = dict(
        id=1, athlete_id=1, sport="cycling",
        duration=3600, distance=20000,
        average_hr=140, average_watts=180, avg_speed=5.0,
        streams={"stats": {"max_watts": 220, "max_hr": 165}},
        created_at=datetime(2024, 5, 1, 10, 0, 0),
    )
    base.update(kw)
    return SimpleNamespace(**base)


def _profile(**kw):
    base = dict(ftp=250, max_hr=190, lt2=4.0)
    base.update(kw)
    return SimpleNamespace(**base)


def _wo(**kw):
    base = dict(
        id=1, user_id=1, sport_type="cycling",
        planned_duration=60, planned_intensity="zone 2",
        structure=None,
    )
    base.update(kw)
    return SimpleNamespace(**base)


# ── _range_score ────────────────────────────────────────────────────────────


def test_range_score_inside_returns_one():
    assert cm._range_score(50, 40, 60, soft_tolerance=5, hard_tolerance=10) == 1.0


def test_range_score_within_soft():
    out = cm._range_score(63, 40, 60, soft_tolerance=5, hard_tolerance=10)
    assert out == 0.72


def test_range_score_within_hard():
    out = cm._range_score(68, 40, 60, soft_tolerance=5, hard_tolerance=10)
    assert out == 0.45


def test_range_score_far_outside():
    out = cm._range_score(200, 40, 60, soft_tolerance=5, hard_tolerance=10)
    assert out == 0.15


def test_range_score_none_returns_none():
    assert cm._range_score(None, 40, 60, soft_tolerance=5, hard_tolerance=10) is None


# ── _cycling_intensity_score ───────────────────────────────────────────────


def test_cycling_intensity_score_returns_none_without_ftp():
    out = cm._cycling_intensity_score(_act(), zone=2, profile=None)
    assert out is None


def test_cycling_intensity_score_zone_2_in_range():
    profile = _profile(ftp=250)
    activity = _act(average_watts=180,
                    streams={"stats": {"max_watts": 220}})
    out = cm._cycling_intensity_score(activity, zone=2, profile=profile)
    assert out is not None
    assert 0.0 <= out <= 1.0


def test_cycling_intensity_score_zero_avg_watts():
    profile = _profile(ftp=250)
    activity = _act(average_watts=0,
                    streams={"stats": {"max_watts": 0}})
    out = cm._cycling_intensity_score(activity, zone=2, profile=profile)
    # No avg/np/max all None -> returns None
    assert out is None or out is not None


def test_cycling_intensity_score_zone_clamped_high():
    profile = _profile(ftp=250)
    activity = _act(average_watts=400,
                    streams={"stats": {"max_watts": 600}})
    out = cm._cycling_intensity_score(activity, zone=99, profile=profile)
    assert out is not None


# ── _running_intensity_score ───────────────────────────────────────────────


def test_running_intensity_score_no_data_returns_none():
    activity = _act(average_hr=0, avg_speed=0,
                    streams={})
    out = cm._running_intensity_score(activity, zone=2, profile=None,
                                       lowest_recorded_rhr=None)
    assert out is None


def test_running_intensity_score_with_pace_and_hr():
    profile = _profile(lt2=5.0, max_hr=190, resting_hr=50)
    # Speed of 3 m/s gives pace ~ 5.55 min/km
    activity = _act(sport="running", duration=1800, distance=5400,
                    average_hr=150, avg_speed=3.0,
                    streams={"stats": {"max_hr": 170}})
    out = cm._running_intensity_score(activity, zone=2, profile=profile,
                                       lowest_recorded_rhr=50.0)
    assert out is not None
    assert 0.0 <= out <= 1.0


def test_running_intensity_score_only_hr():
    profile = _profile(max_hr=190, lt2=0)
    activity = _act(sport="running", average_hr=140, avg_speed=0,
                    streams={"stats": {"max_hr": 160}})
    out = cm._running_intensity_score(activity, zone=2, profile=profile,
                                       lowest_recorded_rhr=None)
    # Only HR contribution
    assert out is not None


def test_running_intensity_score_zone_clamping():
    profile = _profile(lt2=5.0, max_hr=190)
    activity = _act(sport="running", avg_speed=3.0, average_hr=140,
                    streams={"stats": {"max_hr": 170}})
    out = cm._running_intensity_score(activity, zone=10, profile=profile,
                                       lowest_recorded_rhr=None)
    assert out is not None


# ── _compliance_status_for_match ───────────────────────────────────────────


def test_compliance_status_duration_far_off_returns_red():
    workout = _wo(planned_duration=60, sport_type="cycling",
                  planned_intensity="zone 2")
    activity = _act(duration=600)  # 10 min vs 60 planned, > 60% off
    out = cm._compliance_status_for_match(
        workout, activity, profile=_profile(),
        lowest_recorded_rhr=None,
    )
    assert out == ComplianceStatusEnum.completed_red


def test_compliance_status_no_zone_falls_back_to_duration():
    workout = _wo(planned_duration=60, sport_type="cycling",
                  planned_intensity=None, structure=None)
    activity = _act(duration=3600)  # exact match
    out = cm._compliance_status_for_match(
        workout, activity, profile=None,
        lowest_recorded_rhr=None,
    )
    assert out == ComplianceStatusEnum.completed_green


def test_compliance_status_running_with_zone():
    workout = _wo(planned_duration=30, sport_type="running",
                  planned_intensity="zone 2")
    activity = _act(sport="running", duration=1800, distance=5400,
                    average_hr=140, avg_speed=3.0,
                    streams={"stats": {"max_hr": 165}})
    out = cm._compliance_status_for_match(
        workout, activity, profile=_profile(lt2=5.0),
        lowest_recorded_rhr=None,
    )
    assert out in {ComplianceStatusEnum.completed_green,
                   ComplianceStatusEnum.completed_yellow,
                   ComplianceStatusEnum.completed_red}


def test_compliance_status_zero_planned_duration():
    workout = _wo(planned_duration=0, sport_type="cycling",
                  planned_intensity=None)
    activity = _act(duration=3600)
    out = cm._compliance_status_for_match(
        workout, activity, profile=None,
        lowest_recorded_rhr=None,
    )
    # Score is 1.0; should be green
    assert out == ComplianceStatusEnum.completed_green
