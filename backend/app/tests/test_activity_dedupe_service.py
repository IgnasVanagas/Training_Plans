"""
Activity deduplication service tests.
Covers: sha256_hex, normalize_sport, _bucket_distance_m, _bucket_duration_s,
  build_fingerprint, extract_source_identity, and higher-level matching logic.
"""
from __future__ import annotations

from datetime import datetime

import pytest

from app.services.activity_dedupe import (
    _bucket_distance_m,
    _bucket_duration_s,
    build_fingerprint,
    extract_source_identity,
    normalize_sport,
    sha256_hex,
)


# ---------------------------------------------------------------------------
# sha256_hex
# ---------------------------------------------------------------------------

def test_sha256_hex_returns_64_char_hex():
    result = sha256_hex(b"hello world")
    assert len(result) == 64
    assert all(c in "0123456789abcdef" for c in result)


def test_sha256_hex_deterministic():
    assert sha256_hex(b"test") == sha256_hex(b"test")


def test_sha256_hex_different_for_different_inputs():
    assert sha256_hex(b"a") != sha256_hex(b"b")


def test_sha256_hex_empty_bytes():
    result = sha256_hex(b"")
    assert len(result) == 64


# ---------------------------------------------------------------------------
# normalize_sport
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("input_sport,expected", [
    ("Run", "running"),
    ("running", "running"),
    ("Jog", "running"),
    ("Treadmill Run", "running"),
    ("Cycling", "cycling"),
    ("Bike Ride", "cycling"),
    ("ride", "cycling"),
    ("Swim", "swimming"),
    ("Pool Swim", "swimming"),
    ("Walk", "walking"),
    ("Hiking", "walking"),
    (None, "other"),
    ("", "other"),
    ("Yoga", "yoga"),
    ("Strength", "strength"),
])
def test_normalize_sport(input_sport, expected):
    assert normalize_sport(input_sport) == expected


# ---------------------------------------------------------------------------
# _bucket_distance_m
# ---------------------------------------------------------------------------

def test_bucket_distance_rounds_to_25():
    assert _bucket_distance_m(1012.0) == 1000   # 1012 → round(1012/25)*25 = 1000
    assert _bucket_distance_m(1013.0) == 1025   # 1013 → round(1013/25)*25 = 1025


def test_bucket_distance_exact_multiple():
    assert _bucket_distance_m(5000.0) == 5000


def test_bucket_distance_zero():
    assert _bucket_distance_m(0.0) == 0


# ---------------------------------------------------------------------------
# _bucket_duration_s
# ---------------------------------------------------------------------------

def test_bucket_duration_rounds_to_5():
    assert _bucket_duration_s(3602.0) == 3600   # round(3602/5)*5 = 3600
    assert _bucket_duration_s(3603.0) == 3605   # round(3603/5)*5 = 3605


def test_bucket_duration_exact_multiple():
    assert _bucket_duration_s(1800.0) == 1800


def test_bucket_duration_zero():
    assert _bucket_duration_s(0.0) == 0


# ---------------------------------------------------------------------------
# build_fingerprint
# ---------------------------------------------------------------------------

def test_build_fingerprint_format():
    dt = datetime(2026, 3, 15, 7, 30, 45)
    fp = build_fingerprint(sport="running", created_at=dt, duration_s=1800.0, distance_m=5000.0)
    # Must start with v1 prefix
    assert fp.startswith("v1|running|")
    # Seconds and microseconds are zeroed out in start_key
    assert "07:30:00" in fp
    # Duration bucketed: 1800 → 1800
    assert "|1800|" in fp
    # Distance bucketed: 5000 → 5000
    assert fp.endswith("|5000")


def test_build_fingerprint_consistent_for_close_times():
    # Two activities 30 seconds apart but same minute → same fingerprint
    dt1 = datetime(2026, 3, 15, 7, 30, 10)
    dt2 = datetime(2026, 3, 15, 7, 30, 50)
    fp1 = build_fingerprint(sport="cycling", created_at=dt1, duration_s=3600.0, distance_m=40000.0)
    fp2 = build_fingerprint(sport="cycling", created_at=dt2, duration_s=3600.0, distance_m=40000.0)
    assert fp1 == fp2


def test_build_fingerprint_differs_for_different_sports():
    dt = datetime(2026, 3, 15, 7, 30, 0)
    fp_run = build_fingerprint(sport="running", created_at=dt, duration_s=1800.0, distance_m=5000.0)
    fp_bike = build_fingerprint(sport="cycling", created_at=dt, duration_s=1800.0, distance_m=5000.0)
    assert fp_run != fp_bike


def test_build_fingerprint_none_datetime():
    fp = build_fingerprint(sport="running", created_at=None, duration_s=1200.0, distance_m=3000.0)
    assert fp.startswith("v1|running|unknown|")


def test_build_fingerprint_none_duration_distance():
    dt = datetime(2026, 1, 1, 6, 0, 0)
    fp = build_fingerprint(sport="swimming", created_at=dt, duration_s=None, distance_m=None)
    assert fp.startswith("v1|swimming|")
    assert fp.endswith("|0|0")


# ---------------------------------------------------------------------------
# extract_source_identity
# ---------------------------------------------------------------------------

def test_extract_source_identity_from_direct_fields():
    data = {"source_provider": "strava", "source_activity_id": "123456"}
    provider, source_id = extract_source_identity(data)
    assert provider == "strava"
    assert source_id == "123456"


def test_extract_source_identity_fallbacks_to_provider_activity_id():
    data = {"provider": "garmin", "activity_id": "ABC"}
    provider, source_id = extract_source_identity(data)
    assert provider == "garmin"
    assert source_id == "ABC"


def test_extract_source_identity_from_source_meta():
    data = {"source_meta": {"provider": "suunto", "activity_id": "xyz"}}
    provider, source_id = extract_source_identity(data)
    assert provider == "suunto"
    assert source_id == "xyz"


def test_extract_source_identity_normalizes_case():
    data = {"source_provider": "STRAVA", "source_activity_id": "999"}
    provider, source_id = extract_source_identity(data)
    assert provider == "strava"


def test_extract_source_identity_returns_none_for_empty():
    provider, source_id = extract_source_identity({})
    assert provider is None
    assert source_id is None


def test_extract_source_identity_strips_whitespace():
    data = {"source_provider": "  garmin  ", "source_activity_id": " id123 "}
    provider, source_id = extract_source_identity(data)
    assert provider == "garmin"
    assert source_id == "id123"
