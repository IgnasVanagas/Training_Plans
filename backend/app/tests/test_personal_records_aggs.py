"""Tests for personal_records aggregator + get_personal_records / get_activity_prs."""

from __future__ import annotations

import asyncio
from datetime import datetime
from types import SimpleNamespace

import pytest

from app.services import personal_records as pr


def _make_act(activity_id=1, sport="cycling", streams=None,
              created_at=None, athlete_id=1):
    return SimpleNamespace(
        id=activity_id, sport=sport, athlete_id=athlete_id,
        created_at=created_at or datetime(2025, 4, 1, 10, 0),
        streams=streams,
    )


# ── _agg_cycling_prs (object-form) ────────────────────────────────────────


def test_agg_cycling_prs_with_efforts():
    activity = _make_act(streams={"best_efforts": [
        {"window": "5min", "power": 320},
        {"distance": "10k", "time_seconds": 1800},
    ]})
    power, dist = pr._agg_cycling_prs([activity])
    assert "5min" in power
    assert power["5min"][0]["value"] == 320
    assert "10k" in dist


def test_agg_cycling_prs_falls_back_to_power_curve():
    activity = _make_act(streams={"power_curve": {"5min": 300, "20min": 280}})
    power, dist = pr._agg_cycling_prs([activity])
    assert power["5min"][0]["value"] == 300
    assert dist == {}


# ── _agg_running_prs ──────────────────────────────────────────────────────


def test_agg_running_prs_keeps_top_three():
    acts = [
        _make_act(activity_id=i, sport="running",
                  streams={"best_efforts": [
                      {"distance": "5k", "time_seconds": 1500 + i * 10},
                  ]})
        for i in range(5)
    ]
    bests = pr._agg_running_prs(acts)
    assert "5k" in bests
    assert len(bests["5k"]) == 3
    # Sorted ascending (lowest time first)
    assert bests["5k"][0]["value"] < bests["5k"][1]["value"]


def test_agg_running_prs_skips_empty_efforts():
    activity = _make_act(sport="running", streams={"data": []})
    assert pr._agg_running_prs([activity]) == {}


# ── _agg_running_prs_rows ────────────────────────────────────────────────


def test_agg_running_prs_rows_with_avg_hr():
    rows = [
        (1, datetime(2025, 4, 1), [
            {"distance": "5k", "time_seconds": 1400, "avg_hr": 165},
        ], None),
        (2, datetime(2025, 4, 2), [
            {"distance": "5k", "time_seconds": 1450},
        ], None),
    ]
    bests = pr._agg_running_prs_rows(rows)
    assert bests["5k"][0]["activity_id"] == 1
    assert bests["5k"][0]["avg_hr"] == 165


def test_agg_running_prs_rows_skips_invalid():
    rows = [(1, datetime(2025, 4, 1), None, None)]
    assert pr._agg_running_prs_rows(rows) == {}


# ── get_activity_prs ─────────────────────────────────────────────────────


class _Result:
    def __init__(self, items):
        self._items = list(items)

    def all(self):
        return list(self._items)


class _DB:
    def __init__(self, rows):
        self._rows = rows

    async def execute(self, _stmt):
        return _Result(self._rows)

    async def commit(self):
        pass


def test_get_activity_prs_returns_empty_for_unsupported_sport():
    db = _DB([])
    activity = _make_act(sport="swimming", athlete_id=1, activity_id=1)
    out = asyncio.run(pr.get_activity_prs(db, activity))
    assert out == {}


def test_get_activity_prs_returns_rank_for_cycling_pr():
    activity = _make_act(activity_id=1, sport="cycling")
    rows = [
        (1, datetime(2025, 4, 1), "cycling",
         [{"window": "5min", "power": 320},
          {"distance": "10k", "time_seconds": 1500}], None),
        (2, datetime(2025, 3, 1), "cycling",
         [{"window": "5min", "power": 280}], None),
    ]
    db = _DB(rows)
    out = asyncio.run(pr.get_activity_prs(db, activity))
    assert out.get("5min") == 1
    assert out.get("10k") == 1


def test_get_activity_prs_running_distance_pr():
    activity = _make_act(activity_id=7, sport="running")
    rows = [
        (7, datetime(2025, 4, 1), "running",
         [{"distance": "5k", "time_seconds": 1300}], None),
        (8, datetime(2025, 3, 1), "running",
         [{"distance": "5k", "time_seconds": 1400}], None),
    ]
    db = _DB(rows)
    out = asyncio.run(pr.get_activity_prs(db, activity))
    assert out.get("5k") == 1


# ── get_personal_records branches ────────────────────────────────────────


def test_get_personal_records_unsupported_sport_returns_default():
    db = _DB([])
    out = asyncio.run(pr.get_personal_records(db, 1, "swimming"))
    assert out["has_activities_for_sport"] is False
    assert out["records_source"] == "none"


def test_get_personal_records_cycling_basic():
    rows = [
        (1, datetime(2025, 4, 1), "cycling",
         [{"window": "5min", "power": 300}], None),
    ]
    db = _DB(rows)
    out = asyncio.run(pr.get_personal_records(db, 1, "cycling"))
    assert out["has_activities_for_sport"] is True
    assert "power" in out
    assert out["records_source"] == "best_efforts"


def test_get_personal_records_running_basic():
    rows = [
        (1, datetime(2025, 4, 1), "running",
         [{"distance": "5k", "time_seconds": 1500}], None),
    ]
    db = _DB(rows)
    out = asyncio.run(pr.get_personal_records(db, 1, "running"))
    assert out["has_activities_for_sport"] is True
    assert "best_efforts" in out


def test_get_personal_records_no_activities():
    db = _DB([])
    out = asyncio.run(pr.get_personal_records(db, 1, "cycling"))
    assert out["has_activities_for_sport"] is False


# ── _stored_efforts / _streams_key ──────────────────────────────────────


def test_stored_efforts_returns_list():
    act = _make_act(streams={"best_efforts": [{"window": "5min"}]})
    assert pr._stored_efforts(act) == [{"window": "5min"}]


def test_stored_efforts_returns_none_when_invalid():
    act = _make_act(streams=None)
    assert pr._stored_efforts(act) is None
    act = _make_act(streams={"best_efforts": "garbage"})
    assert pr._stored_efforts(act) is None


def test_streams_key_returns_value():
    act = _make_act(streams={"power_curve": {"5min": 300}})
    assert pr._streams_key(act, "power_curve") == {"5min": 300}
    assert pr._streams_key(_make_act(streams=None), "power_curve") is None
