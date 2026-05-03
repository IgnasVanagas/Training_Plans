from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app import models
from app.routers import workouts as workouts_router
from app.schemas import StructuredWorkoutCreate, StructuredWorkoutUpdate


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalars(self):
        return self

    def all(self):
        return list(self._value or [])

    def first(self):
        return self._value


class _WorkoutDB:
    def __init__(self, *, execute_results=None):
        self.execute_results = list(execute_results or [])
        self.added = []
        self.deleted = []
        self.commits = 0
        self.refreshed = []
        self._next_id = 100

    async def execute(self, stmt):
        if not self.execute_results:
            return _ScalarResult([])
        return self.execute_results.pop(0)

    def add(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = self._next_id
            self._next_id += 1
        if getattr(obj, "created_at", None) is None:
            obj.created_at = datetime(2026, 3, 10, 10, 0, 0)
        obj.updated_at = datetime(2026, 3, 10, 10, 5, 0)
        self.added.append(obj)

    async def delete(self, obj):
        self.deleted.append(obj)

    async def commit(self):
        self.commits += 1

    async def refresh(self, obj):
        self.refreshed.append(obj)


def test_workout_structure_normalization_helpers(monkeypatch):
    monkeypatch.setattr(workouts_router.uuid, "uuid4", lambda: SimpleNamespace(hex="abcdef123456"))

    assert workouts_router._zone_defaults(4) == (91.0, 105.0, 98.0)
    assert workouts_router._zone_defaults(99) == (56.0, 75.0, 66.0)

    power_target = workouts_router._normalize_target({"type": "power_zone", "zone": "3"})
    assert power_target == {
        "type": "power",
        "zone": 3,
        "metric": "percent_ftp",
        "unit": "%",
        "min": 76.0,
        "max": 90.0,
        "value": 83.0,
    }
    assert workouts_router._normalize_target({"type": "invalid"}) == {"type": "open"}

    block = workouts_router._normalize_node(
        {
            "category": "tempo",
            "duration": {"type": "invalid", "value": 10},
            "target": {"type": "heart_rate_zone", "zone": "4"},
        }
    )
    repeat = workouts_router._normalize_node({"type": "repeat", "repeats": "x", "steps": [{"type": "block"}]})

    assert block["id"] == "abcdef1234"
    assert block["category"] == "work"
    assert block["duration"] == {"type": "time", "value": 10}
    assert block["target"] == {"type": "heart_rate_zone", "zone": 4}
    assert repeat["repeats"] == 1
    assert repeat["steps"][0]["type"] == "block"
    assert workouts_router._normalize_structure(None) == []


@pytest.mark.asyncio
async def test_workout_library_crud_and_read_routes_cover_success_and_error_paths():
    current_user = models.User(id=99, email="coach@example.com", password_hash="x", role=models.RoleEnum.coach, email_verified=True)

    create_db = _WorkoutDB()
    created = await workouts_router.create_workout(
        StructuredWorkoutCreate(
            title="Tempo",
            description="Main set",
            sport_type="Running",
            structure=[
                {
                    "id": "step-1",
                    "type": "block",
                    "category": "work",
                    "description": "Tempo",
                    "duration": {"type": "time", "value": 600},
                    "target": {"type": "power", "zone": 3},
                }
            ],
            tags=None,
            is_favorite=True,
        ),
        current_user=current_user,
        db=create_db,
    )

    assert created["id"] == 100
    assert created["coach_id"] == 99
    assert created["tags"] == []
    assert created["structure"][0]["target"]["type"] == "power"

    existing = models.StructuredWorkout(
        id=200,
        coach_id=99,
        title="Tempo",
        description="Main set",
        sport_type="Running",
        structure=[{"id": "step-1", "type": "block", "category": "work", "duration": {"type": "time", "value": 600}, "target": {"type": "open"}}],
        tags=["quality"],
        is_favorite=False,
        created_at=datetime(2026, 3, 10, 10, 0, 0),
        updated_at=datetime(2026, 3, 10, 10, 5, 0),
    )
    update_db = _WorkoutDB(execute_results=[_ScalarResult(existing)])
    updated = await workouts_router.update_workout_library(
        200,
        StructuredWorkoutUpdate(title="Tempo + strides", is_favorite=True),
        current_user=current_user,
        db=update_db,
    )
    assert updated["title"] == "Tempo + strides"
    assert updated["is_favorite"] is True

    delete_db = _WorkoutDB(execute_results=[_ScalarResult(existing)])
    assert await workouts_router.delete_workout_library(200, current_user=current_user, db=delete_db) is None
    assert delete_db.deleted == [existing]

    list_db = _WorkoutDB(execute_results=[_ScalarResult([existing])])
    listed = await workouts_router.read_workouts(skip=0, limit=10, current_user=current_user, db=list_db)
    assert listed[0]["id"] == 200

    read_db = _WorkoutDB(execute_results=[_ScalarResult(existing)])
    single = await workouts_router.read_workout(200, current_user=current_user, db=read_db)
    assert single["id"] == 200

    forbidden_workout = models.StructuredWorkout(id=201, coach_id=55, title="Other", sport_type="Running", structure=[])
    forbidden_db = _WorkoutDB(execute_results=[_ScalarResult(forbidden_workout)])
    with pytest.raises(HTTPException) as forbidden_exc:
        await workouts_router.read_workout(201, current_user=current_user, db=forbidden_db)
    assert forbidden_exc.value.status_code == 403

    missing_db = _WorkoutDB(execute_results=[_ScalarResult(None), _ScalarResult(None)])
    with pytest.raises(HTTPException) as update_exc:
        await workouts_router.update_workout_library(999, StructuredWorkoutUpdate(title="Missing"), current_user=current_user, db=missing_db)
    assert update_exc.value.status_code == 404
    with pytest.raises(HTTPException) as read_exc:
        await workouts_router.read_workout(999, current_user=current_user, db=missing_db)
    assert read_exc.value.status_code == 404