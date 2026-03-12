from __future__ import annotations

from datetime import date

import pytest

from app.models import RoleEnum, User
from app.routers import calendar as calendar_router


class _ScalarResult:
    def __init__(self, values):
        self._values = values

    def scalars(self):
        return self

    def all(self):
        return list(self._values)


class _EmptyResult:
    def scalars(self):
        return self

    def all(self):
        return []


class _InspectingDB:
    def __init__(self):
        self.calls = 0
        self.workout_user_ids = None
        self.activity_user_ids = None

    async def execute(self, stmt):
        self.calls += 1
        compiled = stmt.compile()

        if self.calls == 1:
            return _ScalarResult([201, 202])

        if self.calls == 2:
            self.workout_user_ids = compiled.params.get("user_id_1")
            return _EmptyResult()

        if self.calls == 3:
            self.activity_user_ids = compiled.params.get("athlete_id_1")
            return _EmptyResult()

        return _EmptyResult()


@pytest.mark.asyncio
async def test_team_calendar_only_targets_linked_athletes():
    db = _InspectingDB()
    current_user = User(
        id=99,
        email="coach@example.com",
        password_hash="x",
        role=RoleEnum.coach,
        email_verified=True,
    )

    events = await calendar_router.get_calendar_events(
        start_date=date(2026, 3, 1),
        end_date=date(2026, 3, 31),
        athlete_id=None,
        all_athletes=True,
        current_user=current_user,
        db=db,
    )

    assert events == []
    assert db.workout_user_ids == [201, 202]
    assert db.activity_user_ids == [201, 202]
    assert current_user.id not in db.workout_user_ids
    assert current_user.id not in db.activity_user_ids


def test_expand_weekly_recurrence_dates_skips_exceptions():
    dates = calendar_router._expand_weekly_recurrence_dates(
        date(2026, 3, 10),
        {
            "frequency": "weekly",
            "interval_weeks": 1,
            "weekdays": [1, 3],
            "span_weeks": 3,
            "exception_dates": [date(2026, 3, 19)],
        },
    )

    assert dates == [
        date(2026, 3, 10),
        date(2026, 3, 12),
        date(2026, 3, 17),
        date(2026, 3, 24),
        date(2026, 3, 26),
    ]