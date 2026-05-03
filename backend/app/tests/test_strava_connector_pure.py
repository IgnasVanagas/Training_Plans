"""Pure-helper tests for app.integrations.connectors.strava.

Targets sync-only methods on StravaConnector that don't require httpx or DB,
plus _normalize_utc_iso, _normalize_laps, _build_stream_points, _hr_zones,
_rolling_curve, _parse_scopes, missing_required_scopes, authorize_url and
the env-driven config probes.
"""

from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit

import pytest

from app.integrations.connectors.strava import StravaConnector


@pytest.fixture
def connector(monkeypatch):
    monkeypatch.setenv("STRAVA_CLIENT_ID", "client-123")
    monkeypatch.setenv("STRAVA_CLIENT_SECRET", "secret-xyz")
    monkeypatch.setenv("STRAVA_REDIRECT_URI", "https://app.example.com/cb")
    return StravaConnector()


# ── Config probes ────────────────────────────────────────────────────────────


@pytest.mark.parametrize("value, expected", [
    ("true", True), ("True", True), ("1", True), ("yes", True), ("on", True),
    ("false", False), ("0", False), ("", False), ("nope", False),
])
def test_is_enabled_env_flag(monkeypatch, value, expected):
    monkeypatch.setenv("ENABLE_STRAVA_INTEGRATION", value)
    assert StravaConnector().is_enabled() is expected


def test_is_configured_true_when_all_set(connector):
    assert connector.is_configured() is True


def test_is_configured_false_when_missing(monkeypatch):
    monkeypatch.delenv("STRAVA_CLIENT_ID", raising=False)
    monkeypatch.delenv("STRAVA_CLIENT_SECRET", raising=False)
    assert StravaConnector().is_configured() is False


def test_webhook_callback_and_verify_token(monkeypatch, connector):
    monkeypatch.setenv("STRAVA_WEBHOOK_CALLBACK_URL", " https://x/cb ")
    monkeypatch.setenv("STRAVA_WEBHOOK_VERIFY_TOKEN", " tok ")
    assert connector.webhook_callback_url() == "https://x/cb"
    assert connector.webhook_verify_token() == "tok"
    assert connector.is_webhook_configured() is True


def test_is_webhook_configured_false_when_missing(connector, monkeypatch):
    monkeypatch.delenv("STRAVA_WEBHOOK_CALLBACK_URL", raising=False)
    monkeypatch.delenv("STRAVA_WEBHOOK_VERIFY_TOKEN", raising=False)
    assert connector.is_webhook_configured() is False


# ── Scopes ───────────────────────────────────────────────────────────────────


def test_parse_scopes_string(connector):
    assert connector._parse_scopes("a, b ,a, ,c") == ["a", "b", "c"]


def test_parse_scopes_list(connector):
    assert connector._parse_scopes(["x", "x", "y"]) == ["x", "y"]


def test_parse_scopes_other_returns_empty(connector):
    assert connector._parse_scopes(None) == []
    assert connector._parse_scopes(123) == []


def test_requested_scopes_includes_required_then_configured(monkeypatch, connector):
    monkeypatch.setenv("STRAVA_SCOPES", "activity:read,profile:read_all")
    out = connector.requested_scopes()
    # required first, no duplicates, configured appended
    assert out[0] == "read"
    assert "activity:read" in out
    assert "profile:read_all" in out
    assert len(out) == len(set(out))


def test_missing_required_scopes(connector):
    # Only "read" granted → others missing
    assert set(connector.missing_required_scopes("read")) == {"activity:read", "activity:read_all"}
    # All granted → nothing missing
    assert connector.missing_required_scopes("read,activity:read,activity:read_all") == []


# ── authorize_url ────────────────────────────────────────────────────────────


def test_authorize_url_includes_state_and_scopes(connector):
    url = connector.authorize_url("opaque-state")
    parsed = urlsplit(url)
    assert parsed.netloc == "www.strava.com"
    assert parsed.path == "/oauth/authorize"
    qs = parse_qs(parsed.query)
    assert qs["state"] == ["opaque-state"]
    assert qs["client_id"] == ["client-123"]
    assert qs["redirect_uri"] == ["https://app.example.com/cb"]
    assert qs["response_type"] == ["code"]
    # All required scopes present in the comma-joined scope param
    scope_value = qs["scope"][0]
    for s in ("read", "activity:read", "activity:read_all"):
        assert s in scope_value


# ── _rolling_curve ───────────────────────────────────────────────────────────


def test_rolling_curve_empty_returns_zeros(connector):
    assert connector._rolling_curve([], {"5s": 5, "1m": 60}) == {"5s": 0.0, "1m": 0.0}


def test_rolling_curve_window_too_large_returns_zero(connector):
    assert connector._rolling_curve([1.0, 2.0], {"5s": 5}) == {"5s": 0.0}


def test_rolling_curve_picks_best_window(connector):
    values = [1.0] * 10 + [10.0] * 5 + [1.0] * 10
    result = connector._rolling_curve(values, {"5s": 5, "1s": 1})
    assert result["5s"] == 10.0
    assert result["1s"] == 10.0


def test_rolling_curve_zero_window_returns_zero(connector):
    assert connector._rolling_curve([5.0, 5.0], {"bad": 0}) == {"bad": 0.0}


# ── _hr_zones ────────────────────────────────────────────────────────────────


def test_hr_zones_empty_returns_zeros(connector):
    out = connector._hr_zones([])
    assert out == {f"Z{i}": 0 for i in range(1, 6)}


def test_hr_zones_distributes_across_zones(connector):
    # max 200 → ratios: 0.5(Z1), 0.65(Z2), 0.75(Z3), 0.85(Z4), 0.95(Z5)
    hr = [100, 130, 150, 170, 190]
    out = connector._hr_zones(hr, max_hr=200)
    assert out == {"Z1": 1, "Z2": 1, "Z3": 1, "Z4": 1, "Z5": 1}


def test_hr_zones_max_zero_falls_to_z1(connector):
    out = connector._hr_zones([120, 140], max_hr=0)
    assert out["Z1"] == 2


# ── _normalize_utc_iso ───────────────────────────────────────────────────────


def test_normalize_utc_iso_none(connector):
    assert connector._normalize_utc_iso(None) is None


def test_normalize_utc_iso_empty_string(connector):
    assert connector._normalize_utc_iso("   ") is None


def test_normalize_utc_iso_invalid_string(connector):
    assert connector._normalize_utc_iso("not-a-date") is None


def test_normalize_utc_iso_naive_datetime_assumed_utc(connector):
    out = connector._normalize_utc_iso(datetime(2026, 1, 2, 3, 4, 5))
    assert out == "2026-01-02T03:04:05Z"


def test_normalize_utc_iso_aware_datetime_converted(connector):
    from datetime import timedelta as _td
    tz = timezone(_td(hours=2))
    out = connector._normalize_utc_iso(datetime(2026, 1, 2, 5, 0, 0, tzinfo=tz))
    assert out == "2026-01-02T03:00:00Z"


def test_normalize_utc_iso_z_suffix_string(connector):
    assert connector._normalize_utc_iso("2026-01-02T03:04:05Z") == "2026-01-02T03:04:05Z"


def test_normalize_utc_iso_offset_string(connector):
    out = connector._normalize_utc_iso("2026-01-02T05:00:00+02:00")
    assert out == "2026-01-02T03:00:00Z"


# ── _normalize_laps ──────────────────────────────────────────────────────────


def test_normalize_laps_non_list_returns_empty(connector):
    assert connector._normalize_laps(None) == []
    assert connector._normalize_laps({"x": 1}) == []


def test_normalize_laps_skips_non_dict_entries(connector):
    laps = [
        {"distance": 1000, "elapsed_time": 300, "start_date": "2026-01-01T10:00:00Z",
         "average_heartrate": 150},
        "garbage",
        42,
    ]
    out = connector._normalize_laps(laps)
    assert len(out) == 1
    assert out[0]["split"] == 1
    assert out[0]["distance"] == 1000
    assert out[0]["duration"] == 300
    assert out[0]["avg_hr"] == 150
    assert out[0]["start_time"] == "2026-01-01T10:00:00Z"


def test_normalize_laps_filters_zero_distance(connector):
    laps = [
        {"distance": 0, "elapsed_time": 60},
        {"distance": 1500, "elapsed_time": 400, "moving_time": 380},
    ]
    out = connector._normalize_laps(laps)
    assert len(out) == 1
    assert out[0]["distance"] == 1500
    # elapsed_time wins over moving_time
    assert out[0]["duration"] == 400


def test_normalize_laps_uses_moving_time_when_no_elapsed(connector):
    laps = [{"distance": 1000, "moving_time": 300}]
    out = connector._normalize_laps(laps)
    assert out[0]["duration"] == 300


# ── _build_stream_points ─────────────────────────────────────────────────────


def test_build_stream_points_empty_returns_empty(connector):
    assert connector._build_stream_points(datetime(2026, 1, 1), {}) == []


def test_build_stream_points_skips_non_data_streams(connector):
    out = connector._build_stream_points(
        datetime(2026, 1, 1, tzinfo=timezone.utc),
        {"junk": "string", "other": {"data": "not-list"}},
    )
    assert out == []


def test_build_stream_points_aligns_streams(connector):
    payload = {
        "time": {"data": [0, 1, 2]},
        "latlng": {"data": [[10.0, 20.0], [10.1, 20.1], None]},
        "distance": {"data": [0, 5, 10]},
        "velocity_smooth": {"data": [3.0, 3.5, 4.0]},
        "heartrate": {"data": [100, 110, 120]},
        "watts": {"data": [200, 210, 220]},
        "cadence": {"data": [80, 81, 82]},
        "altitude": {"data": [100, 101, 102]},
    }
    out = connector._build_stream_points(datetime(2026, 1, 1, 12, 0, 0), payload)
    assert len(out) == 3
    assert out[0]["timestamp"] == "2026-01-01T12:00:00Z"
    assert out[1]["timestamp"] == "2026-01-01T12:00:01Z"
    assert out[0]["lat"] == 10.0 and out[0]["lon"] == 20.0
    # latlng[2] is None → no lat/lon on point 2
    assert "lat" not in out[2]
    assert out[2]["heart_rate"] == 120
    assert out[2]["power"] == 220
    assert out[2]["cadence"] == 82
    assert out[2]["altitude"] == 102
    assert out[1]["speed"] == 3.5
    assert out[1]["distance"] == 5


def test_build_stream_points_falls_back_to_index_for_time(connector):
    payload = {
        "heartrate": {"data": [100, 110]},
    }
    out = connector._build_stream_points(datetime(2026, 1, 1, 12, 0, 0), payload)
    assert out[0]["timestamp"].endswith("12:00:00Z")
    assert out[1]["timestamp"].endswith("12:00:01Z")


def test_build_stream_points_naive_datetime_treated_as_utc(connector):
    payload = {"heartrate": {"data": [100]}}
    naive = datetime(2026, 1, 1, 12, 0, 0)  # no tzinfo
    out = connector._build_stream_points(naive, payload)
    assert out[0]["timestamp"] == "2026-01-01T12:00:00Z"
