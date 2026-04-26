"""
Personal Records service tests.
Covers: normalize_pr_sport, _sport_matches, _has_best_efforts,
  _cycling_efforts_from_power_curve, compute_activity_best_efforts,
  CYCLING_EFFORT_WINDOWS/CYCLING_DISTANCES/RUNNING_DISTANCES constants.
"""
from __future__ import annotations

from datetime import datetime

import pytest

from app.models import Activity
from app.services.personal_records import (
    CYCLING_DISTANCES,
    CYCLING_EFFORT_WINDOWS,
    RUNNING_DISTANCES,
    SUPPORTED_PR_SPORTS,
    _cycling_efforts_from_power_curve,
    _has_best_efforts,
    _sport_matches,
    backfill_missing_best_efforts,
    compute_activity_best_efforts,
    get_activity_prs,
    get_personal_records,
    normalize_pr_sport,
)


# ---------------------------------------------------------------------------
# normalize_pr_sport
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("inp,expected", [
    ("Run", "running"),
    ("running", "running"),
    ("Trail Run", "running"),
    ("Cycling", "cycling"),
    ("bike", "cycling"),
    ("ride", "cycling"),
    (None, "other"),
    ("", "other"),
    ("Yoga", "yoga"),
    ("Strength Training", "strength training"),
])
def test_normalize_pr_sport(inp, expected):
    assert normalize_pr_sport(inp) == expected


# ---------------------------------------------------------------------------
# _sport_matches
# ---------------------------------------------------------------------------

def test_sport_matches_running():
    assert _sport_matches("running", "running") is True
    assert _sport_matches("Run", "running") is True


def test_sport_matches_cross_sport():
    assert _sport_matches("cycling", "running") is False


def test_sport_matches_none():
    assert _sport_matches(None, "running") is False


# ---------------------------------------------------------------------------
# _has_best_efforts
# ---------------------------------------------------------------------------

def test_has_best_efforts_true_for_nonempty_list():
    assert _has_best_efforts([{"window": "5min", "power": 300}]) is True


def test_has_best_efforts_false_for_empty_list():
    assert _has_best_efforts([]) is False


def test_has_best_efforts_false_for_none():
    assert _has_best_efforts(None) is False


def test_has_best_efforts_false_for_non_list():
    assert _has_best_efforts({}) is False


# ---------------------------------------------------------------------------
# _cycling_efforts_from_power_curve
# ---------------------------------------------------------------------------

def test_cycling_efforts_from_power_curve_happy_path():
    curve = {"5min": 320.0, "20min": 280.0, "60min": 240.0}
    efforts = _cycling_efforts_from_power_curve(curve)
    assert efforts is not None
    windows_found = {e["window"] for e in efforts}
    assert "5min" in windows_found
    assert "20min" in windows_found


def test_cycling_efforts_from_power_curve_none_input():
    assert _cycling_efforts_from_power_curve(None) is None


def test_cycling_efforts_from_power_curve_empty_dict():
    assert _cycling_efforts_from_power_curve({}) is None


def test_cycling_efforts_from_power_curve_skips_zero_power():
    curve = {"5min": 0.0, "20min": 300.0}
    efforts = _cycling_efforts_from_power_curve(curve)
    assert efforts is not None
    assert all(e["window"] != "5min" for e in efforts)


def test_cycling_efforts_have_required_fields():
    curve = {"5min": 310.0}
    efforts = _cycling_efforts_from_power_curve(curve)
    assert efforts and len(efforts) == 1
    effort = efforts[0]
    assert "window" in effort
    assert "seconds" in effort
    assert "power" in effort
    assert "avg_hr" in effort
    assert "elevation" in effort


# ---------------------------------------------------------------------------
# compute_activity_best_efforts
# ---------------------------------------------------------------------------

def _make_running_stream(n: int, speed: float = 4.0, hr: int = 150) -> list[dict]:
    """Generates n stream points at constant speed and HR."""
    points = []
    for i in range(n):
        points.append({
            "timestamp": f"2026-01-01T00:{i // 60:02d}:{i % 60:02d}Z",
            "distance": float(i) * speed,
            "heart_rate": hr + (i % 5),
            "speed": speed,
        })
    return points


def _make_cycling_stream(n: int, power: float = 250.0, hr: int = 155) -> list[dict]:
    points = []
    for i in range(n):
        points.append({
            "timestamp": f"2026-01-01T01:{i // 60:02d}:{i % 60:02d}Z",
            "distance": float(i) * 10.0,
            "heart_rate": hr + (i % 3),
            "power": power + (i % 10),
            "altitude": 100.0 + float(i % 5),
        })
    return points


def test_compute_best_efforts_returns_none_for_empty():
    assert compute_activity_best_efforts([], "running") is None


def test_compute_best_efforts_returns_none_for_single_point():
    assert compute_activity_best_efforts([{"speed": 4.0}], "running") is None


def test_compute_best_efforts_returns_none_for_unknown_sport():
    points = _make_running_stream(120)
    result = compute_activity_best_efforts(points, "yoga")
    assert result is None


def test_compute_best_efforts_cycling_returns_list():
    # 120 points → enough for 1min and 2min windows
    points = _make_cycling_stream(130, power=280.0)
    result = compute_activity_best_efforts(points, "cycling")
    assert isinstance(result, list)
    assert len(result) > 0


def test_compute_best_efforts_running_returns_list():
    # 500 points at 4m/s = 2000m — enough for 400m and 800m and 1km efforts
    points = _make_running_stream(500, speed=4.0)
    result = compute_activity_best_efforts(points, "running")
    assert isinstance(result, list)
    assert len(result) > 0


def test_compute_best_efforts_cycling_power_accuracy():
    # Uniform power → best power == average power
    points = _make_cycling_stream(70, power=300.0)  # 70 points → 1min window
    result = compute_activity_best_efforts(points, "cycling")
    assert result is not None
    effort_1min = next((e for e in result if e.get("window") == "1min"), None)
    if effort_1min:
        assert abs(effort_1min["power"] - 300) <= 5  # within 5W tolerance


# ---------------------------------------------------------------------------
# Constants sanity checks
# ---------------------------------------------------------------------------

def test_supported_pr_sports_contains_expected():
    assert "running" in SUPPORTED_PR_SPORTS
    assert "cycling" in SUPPORTED_PR_SPORTS


def test_cycling_effort_windows_keys_non_empty():
    assert len(CYCLING_EFFORT_WINDOWS) > 0
    for key, val in CYCLING_EFFORT_WINDOWS.items():
        assert isinstance(key, str)
        assert isinstance(val, int)
        assert val > 0


def test_running_distances_contains_marathon():
    assert "Marathon" in RUNNING_DISTANCES
    assert RUNNING_DISTANCES["Marathon"] == pytest.approx(42195, abs=5)


def test_cycling_distances_non_empty():
    assert len(CYCLING_DISTANCES) > 0
    assert CYCLING_DISTANCES["5km"] == 5000


class _Scalars:
    def __init__(self, values):
        self._values = list(values)

    def all(self):
        return list(self._values)


class _ExecResult:
    def __init__(self, *, rows=None, scalar_values=None):
        self._rows = list(rows or [])
        self._scalar_values = list(scalar_values or [])

    def all(self):
        return list(self._rows)

    def scalars(self):
        return _Scalars(self._scalar_values)


class _FakeDB:
    def __init__(self, execute_results=None):
        self.execute_results = list(execute_results or [])
        self.added = []
        self.commit_count = 0

    async def execute(self, _stmt):
        if self.execute_results:
            return self.execute_results.pop(0)
        return _ExecResult(rows=[])

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commit_count += 1


@pytest.mark.asyncio
async def test_get_personal_records_unsupported_sport_returns_ready_none_source():
    db = _FakeDB()
    out = await get_personal_records(db, athlete_id=1, sport="yoga")
    assert out["records_source"] == "none"
    assert out["backfill_status"] == "ready"
    assert out["has_activities_for_sport"] is False


@pytest.mark.asyncio
async def test_get_personal_records_running_aggregates_distance_rows():
    rows = [
        (1, datetime(2026, 4, 1), "running", [{"distance": "5km", "time_seconds": 1400, "avg_hr": 160}], None),
        (2, datetime(2026, 4, 2), "running", [{"distance": "5km", "time_seconds": 1380, "avg_hr": 162}], None),
    ]
    db = _FakeDB(execute_results=[_ExecResult(rows=rows)])
    out = await get_personal_records(db, athlete_id=3, sport="running")
    assert out["sport"] == "running"
    assert "5km" in out["best_efforts"]
    assert out["best_efforts"]["5km"][0]["value"] == 1380
    assert out["records_source"] == "best_efforts"


@pytest.mark.asyncio
async def test_get_personal_records_cycling_uses_power_curve_fallback_source():
    rows = [
        (10, datetime(2026, 4, 1), "cycling", None, {"5min": 300, "20min": 260}),
    ]
    db = _FakeDB(execute_results=[_ExecResult(rows=rows)])
    out = await get_personal_records(db, athlete_id=3, sport="cycling")
    assert out["sport"] == "cycling"
    assert out["records_source"] == "power_curve_fallback"
    assert "5min" in out["power"]


@pytest.mark.asyncio
async def test_get_personal_records_auto_backfill_reloads_when_missing(monkeypatch):
    first_rows = [
        (1, datetime(2026, 4, 1), "running", None, None),
    ]
    second_rows = [
        (1, datetime(2026, 4, 1), "running", [{"distance": "5km", "time_seconds": 1500}], None),
    ]

    async def _fake_backfill(_db, **_kwargs):
        return {"updated": 1}

    monkeypatch.setattr("app.services.personal_records.backfill_missing_best_efforts", _fake_backfill)
    db = _FakeDB(execute_results=[_ExecResult(rows=first_rows), _ExecResult(rows=second_rows)])
    out = await get_personal_records(db, athlete_id=1, sport="running", auto_backfill=True)
    assert out["backfill_updated_count"] == 1
    assert "5km" in out["best_efforts"]


@pytest.mark.asyncio
async def test_backfill_missing_best_efforts_updates_activity_streams_for_running():
    activity = Activity(
        id=21,
        athlete_id=1,
        filename="a.fit",
        file_path="uploads/a.fit",
        file_type="fit",
        sport="running",
        created_at=datetime(2026, 4, 1),
        streams={"data": _make_running_stream(500, speed=4.0)},
    )
    db = _FakeDB(execute_results=[_ExecResult(scalar_values=[activity])])

    out = await backfill_missing_best_efforts(db, athlete_id=1, sport="running", limit=5)
    assert out["updated"] >= 1
    assert out["missing"] >= 1
    assert db.commit_count == 1
    assert isinstance(activity.streams.get("best_efforts"), list)


@pytest.mark.asyncio
async def test_backfill_missing_best_efforts_unsupported_target_returns_zeroes():
    db = _FakeDB()
    out = await backfill_missing_best_efforts(db, sport="yoga")
    assert out == {"updated": 0, "missing": 0, "remaining_missing": 0}


@pytest.mark.asyncio
async def test_get_activity_prs_marks_ranks_for_running_activity(monkeypatch):
    activity = Activity(
        id=9,
        athlete_id=1,
        filename="a.fit",
        file_path="uploads/a.fit",
        file_type="fit",
        sport="running",
        created_at=datetime(2026, 4, 1),
        streams={},
    )

    async def _fake_records(_db, _athlete_id, _sport, **_kwargs):
        return {
            "best_efforts": {
                "5km": [
                    {"activity_id": 9, "value": 1400},
                    {"activity_id": 7, "value": 1450},
                ]
            }
        }

    monkeypatch.setattr("app.services.personal_records.get_personal_records", _fake_records)
    flags = await get_activity_prs(_FakeDB(), activity)
    assert flags["5km"] == 1
