"""Tests for pure-function compliance helpers around similarity/match_and_score."""

from __future__ import annotations

import asyncio
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services import compliance as cm


class _Result:
    def __init__(self, items):
        self._items = list(items)

    def scalars(self):
        return self

    def all(self):
        return list(self._items)


class _DB:
    def __init__(self, queries=None, scalars=None):
        self._queries = list(queries or [])
        self._scalars = list(scalars or [])
        self.committed = False
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    async def execute(self, _stmt):
        if not self._queries:
            return _Result([])
        return _Result(self._queries.pop(0))

    async def scalar(self, _stmt):
        if not self._scalars:
            return None
        return self._scalars.pop(0)

    async def commit(self):
        self.committed = True


def _wo(**kw):
    base = dict(
        id=1, user_id=1, date=date(2025, 4, 1),
        sport_type="cycling", title="Workout",
        planned_duration=60, planned_distance=20,
        planned_intensity=None, structure=None,
        compliance_status=None, matched_activity_id=None,
        planning_context=None, intensity_assessment=None,
        rest_day_workout=False,
    )
    base.update(kw)
    return SimpleNamespace(**base)


def _act(**kw):
    base = dict(
        id=1, athlete_id=1, sport="cycling",
        created_at=datetime(2025, 4, 1, 10, 0),
        local_date=date(2025, 4, 1),
        duration=3600, distance=20000,
        average_hr=140, average_watts=180, avg_speed=5.5,
        streams={}, is_deleted=False, duplicate_of_id=None,
        moving_time=None,
    )
    base.update(kw)
    return SimpleNamespace(**base)


# ── _normalize_sport ───────────────────────────────────────────────────────


def test_normalize_sport_running():
    assert cm._normalize_sport("Trail Running") == "running"


def test_normalize_sport_cycling_variants():
    assert cm._normalize_sport("road bike") == "cycling"
    assert cm._normalize_sport("ride") == "cycling"


def test_normalize_sport_swimming():
    assert cm._normalize_sport("Pool Swim") == "swimming"


def test_normalize_sport_other_when_blank():
    assert cm._normalize_sport(None) == "other"
    assert cm._normalize_sport("") == "other"


def test_normalize_sport_passthrough_unknown():
    assert cm._normalize_sport("yoga") == "yoga"


# ── _extract_activity_split_durations ─────────────────────────────────────


def test_extract_activity_split_durations_uses_laps():
    activity = _act(streams={"laps": [{"duration": 600}, {"duration": 1200}]})
    assert cm._extract_activity_split_durations(activity) == [600.0, 1200.0]


def test_extract_activity_split_durations_falls_back_to_splits():
    activity = _act(streams={"splits_metric": [{"elapsed_time": 300},
                                                {"moving_time": 500}]})
    assert cm._extract_activity_split_durations(activity) == [300.0, 500.0]


def test_extract_activity_split_durations_empty_when_missing():
    activity = _act(streams={})
    assert cm._extract_activity_split_durations(activity) == []


# ── _extract_planned_split_durations ──────────────────────────────────────


def test_extract_planned_split_durations_basic():
    workout = _wo(structure=[
        {"type": "step", "duration": {"type": "time", "value": 600}},
        {"type": "step", "duration": {"type": "time", "value": 1200}},
    ])
    assert cm._extract_planned_split_durations(workout) == [600.0, 1200.0]


def test_extract_planned_split_durations_handles_repeats():
    workout = _wo(structure=[
        {"type": "repeat", "repeats": 3, "steps": [
            {"type": "step", "duration": {"type": "time", "value": 60}},
        ]},
    ])
    out = cm._extract_planned_split_durations(workout)
    assert out == [180.0]


def test_extract_planned_split_durations_skips_non_time():
    workout = _wo(structure=[
        {"type": "step", "duration": {"type": "distance", "value": 1000}},
    ])
    assert cm._extract_planned_split_durations(workout) == []


# ── _split_shape_similarity ───────────────────────────────────────────────


def test_split_shape_similarity_perfect():
    assert cm._split_shape_similarity([100, 200], [100, 200]) > 0.95


def test_split_shape_similarity_returns_none_when_empty():
    assert cm._split_shape_similarity([], [100]) is None
    assert cm._split_shape_similarity([100], []) is None


def test_split_shape_similarity_returns_none_with_zero_total():
    assert cm._split_shape_similarity([0, 0], [100]) is None


# ── _similarity_score ─────────────────────────────────────────────────────


def test_similarity_score_high_for_matching_pair():
    workout = _wo(planned_duration=60, planned_distance=20, sport_type="cycling")
    activity = _act(duration=3600, distance=20000, sport="cycling")
    assert cm._similarity_score(workout, activity) > 0.9


def test_similarity_score_zero_when_dates_diverge():
    workout = _wo(date=date(2025, 4, 1))
    activity = _act(local_date=date(2025, 4, 5),
                    created_at=datetime(2025, 4, 5, 10, 0))
    assert cm._similarity_score(workout, activity) == 0.0


def test_similarity_score_other_sport_partial():
    workout = _wo(sport_type=None, planned_duration=60, planned_distance=20)
    activity = _act(sport="cycling", duration=3600, distance=20000)
    score = cm._similarity_score(workout, activity)
    assert 0 < score < 1


def test_similarity_score_retention_bonus_for_matched_pair():
    workout = _wo(matched_activity_id=1)
    activity = _act(id=1)
    assert cm._similarity_score(workout, activity) > 0.9


# ── match_and_score (DB-backed but with mocked AsyncSession) ─────────────


def test_match_and_score_returns_when_no_workouts():
    db = _DB(queries=[[]])
    asyncio.run(cm.match_and_score(db, user_id=1, target_date=date(2025, 4, 1)))
    assert db.committed is False


def test_match_and_score_future_date_resets_to_planned():
    workout = _wo(date=date(2099, 1, 1))
    db = _DB(queries=[[workout]])
    asyncio.run(cm.match_and_score(
        db, user_id=1, target_date=date(2099, 1, 1)
    ))
    assert workout.compliance_status == cm.ComplianceStatusEnum.planned
    assert workout.matched_activity_id is None
    assert db.committed is True
