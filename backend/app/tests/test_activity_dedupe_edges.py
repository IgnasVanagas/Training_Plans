"""Edge-case tests for app.services.activity_dedupe.

Complements test_activity_dedupe_service.py by covering:

- _meta_from_streams (dict / JSON string / invalid / non-dict)
- _identity_from_row, _identity_from_activity, _activity_meta
- _rows_are_duplicate
- _identities_match all four tiers + indoor/outdoor tolerance + sport mismatch
- find_duplicate_activity tier 1/2/3/4 paths and primary resolution
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from app.models import Activity
from app.services import activity_dedupe as dedupe_svc
from app.services.activity_dedupe import (
    _ActivityIdentity,
    _activity_meta,
    _identity_from_activity,
    _identity_from_row,
    _identities_match,
    _meta_from_streams,
    _rows_are_duplicate,
    find_duplicate_activity,
)


# ── _meta_from_streams ────────────────────────────────────────────────────────


def test_meta_from_streams_returns_meta_dict():
    assert _meta_from_streams({"_meta": {"k": "v"}}) == {"k": "v"}


def test_meta_from_streams_parses_json_string():
    raw = '{"_meta": {"file_sha256": "abc"}}'
    assert _meta_from_streams(raw) == {"file_sha256": "abc"}


def test_meta_from_streams_handles_invalid_json():
    assert _meta_from_streams("not-json") == {}


def test_meta_from_streams_handles_non_dict():
    assert _meta_from_streams(None) == {}
    assert _meta_from_streams(["x"]) == {}


def test_meta_from_streams_missing_meta_key():
    assert _meta_from_streams({"hr": [1, 2]}) == {}


def test_meta_from_streams_meta_not_dict():
    assert _meta_from_streams({"_meta": "string"}) == {}


# ── _identity_from_row / _identity_from_activity / _activity_meta ─────────────


def test_identity_from_row_extracts_meta_fields():
    row = {
        "streams": {
            "_meta": {
                "file_sha256": "SHA",
                "source_provider": "Strava",
                "source_activity_id": "999",
                "fingerprint_v1": "FP",
            }
        },
        "sport": "running",
        "created_at": datetime(2026, 1, 1, 12),
        "duration": 1800,
        "distance": 5000,
    }
    identity = _identity_from_row(row)
    assert identity.file_sha256 == "SHA"
    assert identity.source_provider == "strava"
    assert identity.source_activity_id == "999"
    assert identity.fingerprint_v1 == "FP"
    assert identity.duration_s == 1800.0
    assert identity.distance_m == 5000.0


def test_identity_from_activity_uses_streams():
    act = Activity(
        id=1,
        athlete_id=1,
        filename="x.fit",
        file_path="/x",
        file_type="fit",
        sport="cycling",
        duration=3600,
        distance=20000,
        created_at=datetime(2026, 2, 1, 10),
        streams={"_meta": {"source_provider": "garmin", "source_activity_id": "abc"}},
    )
    ident = _identity_from_activity(act)
    assert ident.source_provider == "garmin"
    assert ident.source_activity_id == "abc"
    assert ident.sport == "cycling"


def test_activity_meta_returns_dict():
    act = Activity(
        id=1,
        athlete_id=1,
        filename="x",
        file_path="/x",
        file_type="fit",
        streams={"_meta": {"k": "v"}},
    )
    assert _activity_meta(act) == {"k": "v"}


# ── _identities_match — every tier + tier-4 sub-branches ──────────────────────


def _ident(**kw) -> _ActivityIdentity:
    return _ActivityIdentity(
        file_sha256=kw.get("sha"),
        source_provider=kw.get("provider"),
        source_activity_id=kw.get("source_id"),
        fingerprint_v1=kw.get("fp"),
        sport=kw.get("sport"),
        created_at=kw.get("created_at"),
        duration_s=float(kw.get("duration_s", 0)),
        distance_m=float(kw.get("distance_m", 0)),
    )


def test_match_tier1_provider_and_source_id():
    a = _ident(provider="strava", source_id="123")
    b = _ident(provider="strava", source_id="123")
    assert _identities_match(a, b) is True


def test_match_tier1_mismatched_source_id():
    # Different source_ids → tier1 fails. Without created_at the function
    # returns False before tier4 ever runs.
    a = _ident(provider="strava", source_id="123")
    b = _ident(provider="strava", source_id="456")
    assert _identities_match(a, b) is False


def test_match_tier2_file_sha():
    a = _ident(sha="SHA")
    b = _ident(sha="SHA")
    assert _identities_match(a, b) is True


def test_match_tier3_fingerprint():
    a = _ident(fp="FP1")
    b = _ident(fp="FP1")
    assert _identities_match(a, b) is True


def test_match_tier4_no_created_at_returns_false():
    a = _ident(sport="running")
    b = _ident(sport="running")
    assert _identities_match(a, b) is False


def test_match_tier4_outside_window():
    a = _ident(sport="running", created_at=datetime(2026, 1, 1, 10),
               duration_s=1800, distance_m=5000)
    b = _ident(sport="running", created_at=datetime(2026, 1, 1, 12),
               duration_s=1800, distance_m=5000)
    assert _identities_match(a, b) is False


def test_match_tier4_sport_mismatch():
    t = datetime(2026, 1, 1, 10)
    a = _ident(sport="running", created_at=t, duration_s=1800, distance_m=5000)
    b = _ident(sport="cycling", created_at=t, duration_s=1800, distance_m=5000)
    assert _identities_match(a, b) is False


def test_match_tier4_outdoor_within_tolerances():
    t = datetime(2026, 1, 1, 10)
    a = _ident(sport="running", created_at=t, duration_s=1800, distance_m=5000)
    b = _ident(sport="running", created_at=t + timedelta(seconds=30),
               duration_s=1830, distance_m=5200)
    assert _identities_match(a, b) is True


def test_match_tier4_outdoor_distance_diff_too_large():
    t = datetime(2026, 1, 1, 10)
    a = _ident(sport="running", created_at=t, duration_s=1800, distance_m=5000)
    b = _ident(sport="running", created_at=t, duration_s=1810, distance_m=6000)
    assert _identities_match(a, b) is False


def test_match_tier4_outdoor_duration_diff_too_large():
    t = datetime(2026, 1, 1, 10)
    a = _ident(sport="running", created_at=t, duration_s=1800, distance_m=5000)
    b = _ident(sport="running", created_at=t, duration_s=2500, distance_m=5050)
    assert _identities_match(a, b) is False


def test_match_tier4_indoor_uses_loose_tolerance():
    """When both distances are 0 (treadmill/trainer), allow 60min duration drift."""
    t = datetime(2026, 1, 1, 10)
    a = _ident(sport="running", created_at=t, duration_s=1800, distance_m=0)
    b = _ident(sport="running", created_at=t, duration_s=4800, distance_m=0)
    # Diff = 3000s < 3600s indoor tolerance → match
    assert _identities_match(a, b) is True


def test_match_tier4_indoor_above_tolerance():
    t = datetime(2026, 1, 1, 10)
    a = _ident(sport="running", created_at=t, duration_s=1800, distance_m=0)
    b = _ident(sport="running", created_at=t, duration_s=6000, distance_m=0)
    assert _identities_match(a, b) is False


def test_match_tier4_other_sport_passes_sport_check():
    """If either sport normalises to 'other', the sport gate is skipped."""
    t = datetime(2026, 1, 1, 10)
    a = _ident(sport=None, created_at=t, duration_s=1800, distance_m=5000)
    b = _ident(sport="running", created_at=t, duration_s=1800, distance_m=5050)
    assert _identities_match(a, b) is True


# ── _rows_are_duplicate ──────────────────────────────────────────────────────


def test_rows_are_duplicate_provider_match():
    base_streams = {"_meta": {"source_provider": "strava", "source_activity_id": "X"}}
    row_a = {"streams": base_streams, "sport": "running",
             "created_at": datetime(2026, 1, 1), "duration": 1, "distance": 1}
    row_b = {"streams": base_streams, "sport": "running",
             "created_at": datetime(2026, 1, 1), "duration": 1, "distance": 1}
    assert _rows_are_duplicate(row_a, row_b) is True


def test_rows_are_duplicate_no_match():
    row_a = {"streams": {"_meta": {"source_provider": "strava", "source_activity_id": "1"}},
             "sport": "running", "created_at": datetime(2026, 1, 1),
             "duration": 1800, "distance": 5000}
    row_b = {"streams": {"_meta": {"source_provider": "garmin", "source_activity_id": "2"}},
             "sport": "cycling", "created_at": datetime(2026, 6, 1),
             "duration": 3600, "distance": 20000}
    assert _rows_are_duplicate(row_a, row_b) is False


# ── find_duplicate_activity ───────────────────────────────────────────────────


class _ScalarsResult:
    def __init__(self, items):
        self._items = list(items)

    def scalars(self):
        return iter(self._items)


class _DedupeDB:
    def __init__(self, *, scalar_queue=None, execute_queue=None, get_map=None):
        self.scalar_queue = list(scalar_queue or [])
        self.execute_queue = list(execute_queue or [])
        self.get_map = dict(get_map or {})

    async def scalar(self, _stmt):
        return self.scalar_queue.pop(0) if self.scalar_queue else None

    async def execute(self, _stmt):
        return self.execute_queue.pop(0) if self.execute_queue else _ScalarsResult([])

    async def get(self, model, pk):
        return self.get_map.get((model, pk))


def _make_activity(**overrides) -> Activity:
    base = dict(
        id=1, athlete_id=1, filename="x", file_path="/x", file_type="fit",
        sport="running", duration=1800, distance=5000,
        created_at=datetime(2026, 1, 1, 10), streams={"_meta": {}},
        duplicate_of_id=None,
    )
    base.update(overrides)
    return Activity(**base)


@pytest.mark.asyncio
async def test_find_duplicate_tier1_returns_match():
    match = _make_activity(id=10)
    db = _DedupeDB(scalar_queue=[match])

    result = await find_duplicate_activity(
        db,
        athlete_id=1,
        source_provider="Strava",
        source_activity_id="42",
    )
    assert result is match


@pytest.mark.asyncio
async def test_find_duplicate_tier1_resolves_primary():
    secondary = _make_activity(id=10, duplicate_of_id=5)
    primary = _make_activity(id=5)
    db = _DedupeDB(scalar_queue=[secondary], get_map={(Activity, 5): primary})

    result = await find_duplicate_activity(
        db,
        athlete_id=1,
        source_provider="strava",
        source_activity_id="42",
    )
    assert result is primary


@pytest.mark.asyncio
async def test_find_duplicate_tier1_primary_lookup_falls_back():
    """If duplicate_of points to a missing row, return the secondary itself."""
    secondary = _make_activity(id=10, duplicate_of_id=999)
    db = _DedupeDB(scalar_queue=[secondary], get_map={})

    result = await find_duplicate_activity(
        db,
        athlete_id=1,
        source_provider="strava",
        source_activity_id="x",
    )
    assert result is secondary


@pytest.mark.asyncio
async def test_find_duplicate_tier2_sha_match():
    match = _make_activity(id=20)
    # Tier1 returns None, tier2 returns match
    db = _DedupeDB(scalar_queue=[None, match])

    result = await find_duplicate_activity(
        db,
        athlete_id=1,
        source_provider="strava",
        source_activity_id="x",
        file_sha256="SHA",
    )
    assert result is match


@pytest.mark.asyncio
async def test_find_duplicate_tier3_fingerprint_match():
    match = _make_activity(id=30)
    db = _DedupeDB(scalar_queue=[None, None, match])

    result = await find_duplicate_activity(
        db,
        athlete_id=1,
        source_provider="strava",
        source_activity_id="x",
        file_sha256="SHA",
        fingerprint_v1="FP",
    )
    assert result is match


@pytest.mark.asyncio
async def test_find_duplicate_tier4_fuzzy_match():
    candidate = _make_activity(
        id=40,
        sport="running",
        created_at=datetime(2026, 1, 1, 10, 1),
        duration=1820,
        distance=5050,
        streams={"_meta": {}},
    )
    db = _DedupeDB(
        scalar_queue=[None, None, None],
        execute_queue=[_ScalarsResult([candidate])],
    )

    result = await find_duplicate_activity(
        db,
        athlete_id=1,
        sport="running",
        created_at=datetime(2026, 1, 1, 10, 0),
        duration_s=1800,
        distance_m=5000,
    )
    assert result is candidate


@pytest.mark.asyncio
async def test_find_duplicate_tier4_no_candidates_returns_none():
    db = _DedupeDB(
        scalar_queue=[None, None, None],
        execute_queue=[_ScalarsResult([])],
    )
    result = await find_duplicate_activity(
        db,
        athlete_id=1,
        sport="running",
        created_at=datetime(2026, 1, 1, 10),
        duration_s=1800,
        distance_m=5000,
    )
    assert result is None


@pytest.mark.asyncio
async def test_find_duplicate_no_signals_returns_none():
    db = _DedupeDB()
    result = await find_duplicate_activity(db, athlete_id=1)
    assert result is None
