"""Direct-call test for activities.get_zone_summary endpoint with mocked DB."""

from __future__ import annotations

import asyncio
from datetime import date, datetime
from types import SimpleNamespace

import pytest

from app.routers import activities as act
from app.models import RoleEnum


class _Mappings:
    def __init__(self, items):
        self._items = list(items)

    def __iter__(self):
        return iter(self._items)


class _Result:
    def __init__(self, items, mappings_items=None):
        self._items = list(items)
        self._mappings = list(mappings_items) if mappings_items is not None else None

    def scalars(self):
        return self

    def all(self):
        return list(self._items)

    def mappings(self):
        return _Mappings(self._mappings if self._mappings is not None else [])


class _DB:
    def __init__(self, queue):
        self._queue = list(queue)
        self.committed = False

    async def execute(self, _stmt):
        if not self._queue:
            return _Result([])
        item = self._queue.pop(0)
        if isinstance(item, tuple) and len(item) == 2:
            scalars, mappings = item
            return _Result(scalars, mappings_items=mappings)
        return _Result(item)

    async def scalar(self, _stmt):
        return None

    async def commit(self):
        self.committed = True


def test_get_zone_summary_returns_athlete_summary():
    user = SimpleNamespace(id=1, role=RoleEnum.athlete, email="a@b.com")

    profile = SimpleNamespace(user_id=1, ftp=250, max_hr=190,
                                resting_hr=50, lt2=4.0, training_zones=None)
    user_db = SimpleNamespace(id=1, email="a@b.com")

    activity_mapping = {
        "id": 1, "athlete_id": 1, "sport": "cycling",
        "created_at": datetime.now().replace(hour=10, minute=0,
                                              second=0, microsecond=0),
        "duration": 3600, "distance": 20000, "filename": "ride",
        "average_hr": 140, "average_watts": 180, "is_deleted": False,
        "duplicate_of_id": None,
        "streams_lite": {"data": [], "_meta": {}},
    }

    queue = [
        # profiles
        [profile],
        # metric history
        [],
        # lowest_rhr (called via execute, returns rows of (user_id, min_rhr))
        [],
        # users
        [user_db],
        # activities (uses mappings)
        ([], [activity_mapping]),
    ]
    db = _DB(queue)

    out = asyncio.run(act.get_zone_summary(
        athlete_id=None, all_athletes=False, reference_date=None,
        week_start_day="monday", current_user=user, db=db,
    ))

    assert "athletes" in out
    assert len(out["athletes"]) == 1
    assert out["athletes"][0]["athlete_id"] == 1


def test_get_zone_summary_for_specific_athlete_id_self():
    user = SimpleNamespace(id=2, role=RoleEnum.athlete, email="a@b.com")
    queue = [[], [], [], [], ([], [])]
    db = _DB(queue)
    out = asyncio.run(act.get_zone_summary(
        athlete_id=2, all_athletes=False, reference_date=date(2025, 4, 1),
        week_start_day="sunday", current_user=user, db=db,
    ))
    assert "week" in out
    assert out["week"]["start_date"].isoformat() != ""
