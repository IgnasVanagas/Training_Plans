"""Pure-function tests for app.integrations.connectors.strava."""

from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest

from app.integrations.connectors.strava import StravaConnector


@pytest.fixture
def conn(monkeypatch):
    monkeypatch.setenv("STRAVA_CLIENT_ID", "cid")
    monkeypatch.setenv("STRAVA_CLIENT_SECRET", "secret")
    monkeypatch.setenv("STRAVA_REDIRECT_URI", "https://app/strava/cb")
    return StravaConnector()


def test_is_enabled_default_false(monkeypatch):
    monkeypatch.delenv("ENABLE_STRAVA_INTEGRATION", raising=False)
    assert StravaConnector().is_enabled() is False


def test_is_enabled_true(monkeypatch):
    monkeypatch.setenv("ENABLE_STRAVA_INTEGRATION", "true")
    assert StravaConnector().is_enabled() is True


def test_is_configured_requires_creds(monkeypatch, conn):
    assert conn.is_configured() is True
    monkeypatch.delenv("STRAVA_CLIENT_ID", raising=False)
    assert StravaConnector().is_configured() is False


def test_parse_scopes_string_dedup(conn):
    out = conn._parse_scopes("read, activity:read , activity:read")
    assert out == ["read", "activity:read"]


def test_parse_scopes_list_or_tuple(conn):
    assert conn._parse_scopes(["read", "read"]) == ["read"]
    assert conn._parse_scopes(("a", "b")) == ["a", "b"]
    assert conn._parse_scopes(None) == []


def test_requested_scopes_includes_required(conn):
    out = conn.requested_scopes()
    assert "read" in out and "activity:read" in out and "activity:read_all" in out


def test_missing_required_scopes(conn):
    assert conn.missing_required_scopes("read") == ["activity:read", "activity:read_all"]
    assert conn.missing_required_scopes(["read", "activity:read", "activity:read_all"]) == []


def test_webhook_helpers(monkeypatch, conn):
    monkeypatch.setenv("STRAVA_WEBHOOK_CALLBACK_URL", "https://x/webhook")
    monkeypatch.setenv("STRAVA_WEBHOOK_VERIFY_TOKEN", "tok")
    assert conn.webhook_callback_url() == "https://x/webhook"
    assert conn.webhook_verify_token() == "tok"
    assert conn.is_webhook_configured() is True


def test_webhook_not_configured(monkeypatch, conn):
    monkeypatch.delenv("STRAVA_WEBHOOK_CALLBACK_URL", raising=False)
    monkeypatch.delenv("STRAVA_WEBHOOK_VERIFY_TOKEN", raising=False)
    assert conn.is_webhook_configured() is False


def test_authorize_url(conn):
    url = conn.authorize_url("state-123")
    assert url.startswith("https://www.strava.com/oauth/authorize?")
    assert "state=state-123" in url
    assert "client_id=cid" in url


def test_normalize_utc_iso_with_datetime(conn):
    dt = datetime(2024, 5, 1, 10, 0, tzinfo=timezone.utc)
    assert conn._normalize_utc_iso(dt) == "2024-05-01T10:00:00Z"


def test_normalize_utc_iso_with_string_z(conn):
    assert conn._normalize_utc_iso("2024-05-01T10:00:00Z") == "2024-05-01T10:00:00Z"


def test_normalize_utc_iso_naive_string(conn):
    assert conn._normalize_utc_iso("2024-05-01T10:00:00") == "2024-05-01T10:00:00Z"


def test_normalize_utc_iso_none_or_blank(conn):
    assert conn._normalize_utc_iso(None) is None
    assert conn._normalize_utc_iso("") is None


def test_normalize_utc_iso_invalid_string(conn):
    assert conn._normalize_utc_iso("not a date") is None


def test_normalize_laps_filters_zero_distance(conn):
    laps = [
        {"elapsed_time": 60, "distance": 100, "start_date": "2024-05-01T00:00:00Z"},
        {"elapsed_time": 60, "distance": 0},
        "junk",
    ]
    out = conn._normalize_laps(laps)
    assert len(out) == 1
    assert out[0]["distance"] == 100
    assert out[0]["split"] == 1


def test_normalize_laps_non_list(conn):
    assert conn._normalize_laps(None) == []


def test_rolling_curve_basic(conn):
    out = conn._rolling_curve([1.0, 2.0, 3.0, 4.0], {"1s": 1, "2s": 2, "10s": 10})
    assert out["1s"] == 4.0
    assert out["2s"] == 3.5
    assert out["10s"] == 0.0


def test_rolling_curve_empty(conn):
    assert conn._rolling_curve([], {"1s": 1}) == {"1s": 0.0}


def test_hr_zones_distribution(conn):
    out = conn._hr_zones([100, 120, 140, 160, 180], max_hr=200)
    assert out["Z1"] == 1
    assert out["Z2"] == 1
    assert out["Z3"] == 1
    assert out["Z4"] == 1
    assert out["Z5"] == 1


def test_hr_zones_empty(conn):
    out = conn._hr_zones([])
    assert out == {f"Z{i}": 0 for i in range(1, 6)}


def test_hr_zones_zero_max(conn):
    out = conn._hr_zones([100, 200], max_hr=0)
    assert out["Z1"] == 2


def test_build_stream_points_basic(conn):
    start = datetime(2024, 5, 1, 0, 0, tzinfo=timezone.utc)
    payload = {
        "time": {"data": [0, 1, 2]},
        "distance": {"data": [0, 5, 10]},
        "heartrate": {"data": [120, 125, 130]},
        "watts": {"data": [200, 210, 220]},
        "altitude": {"data": [100, 101, 102]},
        "cadence": {"data": [80, 81, 82]},
        "velocity_smooth": {"data": [3.0, 3.1, 3.2]},
        "latlng": {"data": [[1.0, 2.0], [1.1, 2.1], "bad"]},
    }
    points = conn._build_stream_points(start, payload)
    assert len(points) == 3
    assert points[0]["timestamp"].endswith("Z")
    assert points[0]["heart_rate"] == 120
    assert points[0]["lat"] == 1.0


def test_build_stream_points_empty(conn):
    assert conn._build_stream_points(datetime(2024, 1, 1), {}) == []
