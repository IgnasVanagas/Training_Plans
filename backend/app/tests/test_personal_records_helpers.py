"""Pure-helper tests for app.services.personal_records."""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

import pytest

from app.services import personal_records as pr


def _act(act_id=1, sport="cycling", streams=None, created_at=None):
    return SimpleNamespace(
        id=act_id,
        athlete_id=1,
        sport=sport,
        created_at=created_at or datetime(2024, 1, 1),
        streams=streams,
    )


def test_safe_float_handles_invalid():
    assert pr._safe_float(None) == 0.0
    assert pr._safe_float("abc") == 0.0
    assert pr._safe_float("3.5") == 3.5
    assert pr._safe_float(7) == 7.0


def test_normalize_pr_sport_variants():
    assert pr.normalize_pr_sport(None) == "other"
    assert pr.normalize_pr_sport("") == "other"
    assert pr.normalize_pr_sport("Run") == "running"
    assert pr.normalize_pr_sport("trail run") == "running"
    assert pr.normalize_pr_sport("road bike") == "cycling"
    assert pr.normalize_pr_sport("ride") == "cycling"
    assert pr.normalize_pr_sport("swim") == "swim"


def test_sport_matches():
    assert pr._sport_matches("running", "running") is True
    assert pr._sport_matches("ride", "cycling") is True
    assert pr._sport_matches("swim", "running") is False


def test_has_best_efforts():
    assert pr._has_best_efforts([{"window": "1s"}]) is True
    assert pr._has_best_efforts([]) is False
    assert pr._has_best_efforts({}) is False
    assert pr._has_best_efforts(None) is False


def test_cycling_efforts_from_power_curve_basic():
    out = pr._cycling_efforts_from_power_curve(
        {"1s": 800, "5s": 750, "60min": 0, "junk": -5}
    )
    assert isinstance(out, list)
    windows = {e["window"] for e in out}
    assert windows == {"1s", "5s"}
    assert all(e["avg_hr"] is None for e in out)


def test_cycling_efforts_from_power_curve_empty_returns_none():
    assert pr._cycling_efforts_from_power_curve(None) is None
    assert pr._cycling_efforts_from_power_curve({}) is None
    assert pr._cycling_efforts_from_power_curve({"1s": 0}) is None


def test_compute_activity_best_efforts_routes_to_cycling():
    points = [
        {"power": 200, "heart_rate": 140, "altitude": 0},
        {"power": 250, "heart_rate": 145, "altitude": 1},
        {"power": 300, "heart_rate": 150, "altitude": 2},
    ]
    out = pr.compute_activity_best_efforts(points, "cycling")
    assert isinstance(out, list)
    assert any(e["window"] == "1s" for e in out)


def test_compute_activity_best_efforts_routes_to_running():
    points = [
        {"distance": i * 5, "heart_rate": 140, "altitude": 0}
        for i in range(800)
    ]
    out = pr.compute_activity_best_efforts(points, "running")
    assert isinstance(out, list)


def test_compute_activity_best_efforts_short_returns_none():
    assert pr.compute_activity_best_efforts([], "cycling") is None
    assert pr.compute_activity_best_efforts([{}], "cycling") is None


def test_compute_activity_best_efforts_unknown_sport():
    assert pr.compute_activity_best_efforts(
        [{"distance": 1}, {"distance": 5}], "swim"
    ) is None


def test_pr_entry_and_pr_entry_row():
    act = _act()
    e = pr._pr_entry(150, act)
    assert e == {"value": 150, "activity_id": 1, "date": "2024-01-01T00:00:00"}
    e2 = pr._pr_entry_row(120, 5, datetime(2024, 1, 1), avg_hr=142.7)
    assert e2["avg_hr"] == 143
    e3 = pr._pr_entry_row(120, 5, None)
    assert e3["date"] is None
    assert "avg_hr" not in e3


def test_stored_efforts_and_streams_key():
    act = _act(streams={"best_efforts": [{"window": "1s"}], "power_curve": {"1s": 100}})
    assert pr._stored_efforts(act) == [{"window": "1s"}]
    assert pr._streams_key(act, "power_curve") == {"1s": 100}
    assert pr._streams_key(_act(streams=None), "power_curve") is None
    assert pr._stored_efforts(_act(streams={"best_efforts": "bad"})) is None


def test_agg_cycling_prs_uses_efforts_and_curve():
    a1 = _act(act_id=1, streams={"best_efforts": [
        {"window": "1s", "power": 800},
        {"distance": "5km", "time_seconds": 600},
    ]})
    a2 = _act(act_id=2, streams={"best_efforts": [
        {"window": "1s", "power": 900},
    ]})
    a3 = _act(act_id=3, streams={"power_curve": {"5s": 700}})
    powers, dists = pr._agg_cycling_prs([a1, a2, a3])
    assert powers["1s"][0]["value"] == 900
    assert powers["5s"][0]["value"] == 700
    assert dists["5km"][0]["value"] == 600


def test_agg_cycling_prs_rows():
    rows = [
        (1, datetime(2024, 1, 1), [{"window": "1s", "power": 800, "avg_hr": 150}], None),
        (2, datetime(2024, 1, 2), [{"window": "1s", "power": 900}], None),
        (3, datetime(2024, 1, 3), None, {"5s": 600}),
    ]
    p, d, used = pr._agg_cycling_prs_rows(rows)
    assert p["1s"][0]["value"] == 900
    assert used is True
    assert d == {}


def test_agg_running_prs():
    a1 = _act(act_id=1, streams={"best_efforts": [
        {"distance": "5km", "time_seconds": 1200},
    ]})
    a2 = _act(act_id=2, streams={"best_efforts": [
        {"distance": "5km", "time_seconds": 1100},
    ]})
    out = pr._agg_running_prs([a1, a2])
    assert out["5km"][0]["value"] == 1100


def test_agg_running_prs_rows_filters_invalid():
    rows = [
        (1, datetime(2024, 1, 1), "not-a-list", None),
        (2, datetime(2024, 1, 2), [{"distance": "5km", "time_seconds": 1200, "avg_hr": 150}], None),
        (3, datetime(2024, 1, 3), [{"distance": "5km", "time_seconds": 1100}], None),
    ]
    out = pr._agg_running_prs_rows(rows)
    assert out["5km"][0]["value"] == 1100


@pytest.mark.asyncio
async def test_get_activity_prs_unsupported_sport():
    out = await pr.get_activity_prs(db=None, activity=_act(sport="swim"))
    assert out == {}
