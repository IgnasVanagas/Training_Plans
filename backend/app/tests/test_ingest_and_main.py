"""Tests for app.integrations.ingest helpers."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.integrations import ingest as ing


def test_local_date_from_payload_summary():
    payload = {"summary": {"start_date_local": "2025-01-15T08:00:00"}}
    assert ing._local_date_from_payload(payload, datetime(2025, 1, 1)).isoformat() == "2025-01-15"


def test_local_date_from_payload_detail_fallback():
    payload = {"detail": {"start_date_local": "2025-02-20T05:00:00"}}
    assert ing._local_date_from_payload(payload, datetime(2025, 1, 1)).isoformat() == "2025-02-20"


def test_local_date_from_payload_invalid_falls_back():
    payload = {"summary": {"start_date_local": "garbage"}}
    fallback = datetime(2025, 3, 5)
    assert ing._local_date_from_payload(payload, fallback).isoformat() == "2025-03-05"


def test_local_date_from_payload_none_uses_fallback():
    fallback = datetime(2024, 7, 4)
    assert ing._local_date_from_payload(None, fallback).isoformat() == "2024-07-04"


def test_moving_time_from_parts_stats():
    assert ing._moving_time_from_parts({"total_timer_time": 1800.0}, None) == 1800.0


def test_moving_time_from_parts_summary_fallback():
    assert ing._moving_time_from_parts(None, {"summary": {"moving_time": 1500}}) == 1500.0


def test_moving_time_from_parts_none_returns_none():
    assert ing._moving_time_from_parts(None, None) is None


# ── ingest_provider_activity new activity ─────────────────────────────────


class _FakeDB:
    def __init__(self):
        self.added = []
        self.committed = False
        self.flushed = False

    def add(self, obj):
        self.added.append(obj)
        if not getattr(obj, "id", None):
            obj.id = 100 + len(self.added)

    async def commit(self):
        self.committed = True

    async def refresh(self, obj):
        return None

    async def flush(self):
        self.flushed = True


def test_ingest_creates_new_activity_when_no_duplicate(monkeypatch):
    monkeypatch.setattr(ing, "find_duplicate_activity", AsyncMock(return_value=None))
    monkeypatch.setattr(ing, "compute_activity_best_efforts", lambda points, sport: {"30s": 250})

    db = _FakeDB()

    activity, created = asyncio.run(ing.ingest_provider_activity(
        db, user_id=1, provider="strava", provider_activity_id="9001",
        name="Ride", start_time=datetime(2025, 4, 1, 8, 0, tzinfo=timezone.utc),
        duration_s=3600, distance_m=20000, sport="cycling",
        average_hr=140, average_watts=180, average_speed=5.5,
        payload={
            "summary": {"start_date_local": "2025-04-01T10:00:00"},
            "detail": {
                "data": [{"power": 180, "heart_rate": 140}],
                "stats": {"total_timer_time": 3500},
                "laps": [{"avg_power": 180}],
                "splits_metric": [],
            },
        },
    ))

    assert created is True
    assert db.committed is True
    assert activity.athlete_id == 1
    assert activity.streams["_meta"]["source_provider"] == "strava"


def test_ingest_cross_source_creates_secondary(monkeypatch):
    existing = SimpleNamespace(
        id=42, file_type="provider",
        streams={"_meta": {"source_provider": "garmin",
                            "source_activity_id": "g123"}},
    )
    monkeypatch.setattr(ing, "find_duplicate_activity",
                        AsyncMock(return_value=existing))
    monkeypatch.setattr(ing, "compute_activity_best_efforts",
                        lambda points, sport: None)

    db = _FakeDB()
    activity, created = asyncio.run(ing.ingest_provider_activity(
        db, user_id=1, provider="strava", provider_activity_id="9001",
        name="Ride", start_time=datetime(2025, 4, 1, 8, 0),
        duration_s=3600, distance_m=20000, sport="cycling",
        average_hr=None, average_watts=None, average_speed=None,
        payload={"detail": {}}, auto_commit=False,
    ))

    assert created is True
    assert activity.duplicate_of_id == 42
    assert db.flushed is True


def test_ingest_same_source_enriches_existing(monkeypatch):
    existing = SimpleNamespace(
        id=42, file_type="provider", filename="old.fit",
        sport="cycling", created_at=datetime(2025, 1, 1),
        duration=None, distance=None, avg_speed=None,
        average_hr=None, average_watts=None,
        local_date=None, moving_time=None,
        streams={"data": [], "_meta": {"source_provider": "strava",
                                        "source_activity_id": "9001"}},
    )
    monkeypatch.setattr(ing, "find_duplicate_activity",
                        AsyncMock(return_value=existing))
    monkeypatch.setattr(ing, "compute_activity_best_efforts",
                        lambda points, sport: {"30s": 200})

    db = _FakeDB()
    activity, created = asyncio.run(ing.ingest_provider_activity(
        db, user_id=1, provider="strava", provider_activity_id="9001",
        name="New Ride", start_time=datetime(2025, 4, 1, 8, 0),
        duration_s=3600, distance_m=20000, sport="cycling",
        average_hr=140, average_watts=180, average_speed=5.5,
        payload={
            "summary": {"start_date_local": "2025-04-01T10:00:00"},
            "detail": {"data": [{"power": 180}],
                        "laps": [{"avg_power": 180}],
                        "stats": {}},
        },
    ))

    assert created is False
    assert activity.id == 42
    assert activity.filename == "New Ride"
    assert activity.streams.get("data")  # enriched


# ── main.py memory helpers ─────────────────────────────────────────────────

def test_should_log_hot_path_memory_matches_prefixes():
    from app.main import _should_log_hot_path_memory
    assert _should_log_hot_path_memory("/activities/123") is True
    assert _should_log_hot_path_memory("/calendar/today") is True
    assert _should_log_hot_path_memory("/communications/notifications") is True
    assert _should_log_hot_path_memory("/communications/organizations/1") is True
    assert _should_log_hot_path_memory("/integrations/wellness/summary") is True
    assert _should_log_hot_path_memory("/users/me") is False
    assert _should_log_hot_path_memory("/health") is False


def test_read_process_memory_mb_returns_tuple():
    from app.main import _read_process_memory_mb
    out = _read_process_memory_mb()
    assert isinstance(out, tuple)
    assert len(out) == 2
