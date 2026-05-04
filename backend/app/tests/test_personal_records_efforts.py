"""Tests for personal_records cycling-distance and running best-efforts paths."""

from __future__ import annotations

from app.services import personal_records as pr


def _stream_points(n: int, distance_step: float = 5.0,
                   power: float = 200.0, hr: float = 150.0):
    """Generate a 1Hz stream long enough to hit best-effort thresholds."""
    return [
        {"distance": i * distance_step, "power": power, "heart_rate": hr,
         "altitude": 100 + (i % 10)}
        for i in range(n)
    ]


def test_cycling_best_efforts_includes_distance_segments():
    # 1200 points at 5m/sec -> 6000m total, should hit 5km
    points = _stream_points(1300, distance_step=5.0, power=200.0)
    out = pr._cycling_best_efforts(points)
    assert out is not None
    # Should have both window-based and distance-based efforts
    has_window = any("window" in e for e in out)
    has_distance = any("distance" in e for e in out)
    assert has_window
    assert has_distance


def test_cycling_best_efforts_short_returns_only_windows():
    # Only 100 points -> no distance efforts (need >= 5km)
    points = _stream_points(100, distance_step=5.0, power=200.0)
    out = pr._cycling_best_efforts(points)
    if out is not None:
        # All entries should be window-only
        for entry in out:
            assert "window" in entry


def test_cycling_best_efforts_zero_power_skips_windows():
    points = _stream_points(2000, distance_step=5.0, power=0.0)
    out = pr._cycling_best_efforts(points)
    if out is not None:
        # No window entries (power=0 skipped) but maybe distance
        for entry in out:
            assert "distance" in entry or entry.get("power", 0) > 0


def test_running_best_efforts_basic():
    # 6000 points at 1.5m/step -> 9000m -> hits 1km, 1mi, 5km
    points = _stream_points(6000, distance_step=1.5, power=0, hr=150)
    out = pr._running_best_efforts(points)
    assert out is not None
    assert len(out) >= 1
    assert all("distance" in e for e in out)


def test_running_best_efforts_too_short_returns_none():
    points = [{"distance": 0}, {"distance": 100}]
    out = pr._running_best_efforts(points)
    assert out is None


def test_running_best_efforts_empty_distances():
    out = pr._running_best_efforts([{"power": 100}])
    assert out is None


def test_compute_activity_best_efforts_dispatches_running():
    points = _stream_points(2000, distance_step=2.0, power=0, hr=140)
    out = pr.compute_activity_best_efforts(points, "running")
    assert out is not None


def test_ffill_pads_none_with_last():
    out = pr._ffill([None, 5.0, None, 10.0, None])
    assert out == [0.0, 5.0, 5.0, 10.0, 10.0]


def test_ffill_all_none_zero():
    out = pr._ffill([None, None, None])
    assert out == [0.0, 0.0, 0.0]
