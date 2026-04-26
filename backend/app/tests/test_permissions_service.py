"""
Permissions service tests.
Covers: normalize_permissions, _merge_effective_permissions, and edge cases
around RESTRICTIVE_ANY_TRUE_KEYS logic.
"""
from __future__ import annotations

import pytest

from app.models import Organization
from app.services.permissions import (
    DEFAULT_PERMISSIONS,
    PERMISSION_KEYS,
    get_athlete_org_ids,
    get_athlete_permissions,
    get_shared_org_ids,
    normalize_permissions,
    set_athlete_permissions_for_shared_orgs,
    _merge_effective_permissions,
)


# ---------------------------------------------------------------------------
# normalize_permissions
# ---------------------------------------------------------------------------

def test_normalize_permissions_returns_defaults_for_none():
    result = normalize_permissions(None)
    assert result == DEFAULT_PERMISSIONS


def test_normalize_permissions_returns_defaults_for_non_dict():
    result = normalize_permissions("not a dict")
    assert result == DEFAULT_PERMISSIONS


def test_normalize_permissions_all_keys_present():
    result = normalize_permissions({})
    assert set(result.keys()) == set(PERMISSION_KEYS)


def test_normalize_permissions_overrides_single_key():
    result = normalize_permissions({"allow_edit_workouts": False})
    assert result["allow_edit_workouts"] is False
    # Others should still be default
    assert result["allow_delete_activities"] is True


def test_normalize_permissions_converts_truthy_values():
    result = normalize_permissions({"allow_edit_workouts": 1, "require_workout_approval": 0})
    assert result["allow_edit_workouts"] is True
    assert result["require_workout_approval"] is False


def test_normalize_permissions_full_restrictive():
    raw = {key: False for key in PERMISSION_KEYS}
    result = normalize_permissions(raw)
    for key in PERMISSION_KEYS:
        assert result[key] is False


def test_normalize_permissions_unknown_keys_are_ignored():
    result = normalize_permissions({"allow_edit_workouts": True, "unknown_key": True})
    assert "unknown_key" not in result


# ---------------------------------------------------------------------------
# _merge_effective_permissions
# ---------------------------------------------------------------------------

def test_merge_apply_restrictive_flag():
    current = DEFAULT_PERMISSIONS.copy()
    parsed = normalize_permissions({"require_workout_approval": True})

    merged = _merge_effective_permissions(current, parsed)

    assert merged["require_workout_approval"] is True


def test_merge_approval_required_stays_true_if_either_is_true():
    # RESTRICTIVE_ANY_TRUE_KEYS: if either current or parsed has True, result is True
    current = DEFAULT_PERMISSIONS.copy()
    current["require_workout_approval"] = True
    parsed = normalize_permissions({"require_workout_approval": False})

    merged = _merge_effective_permissions(current, parsed)
    assert merged["require_workout_approval"] is True


def test_merge_restrictive_non_approval_key_both_must_be_true():
    # For non-RESTRICTIVE_ANY_TRUE keys: both must agree True to keep True
    current = DEFAULT_PERMISSIONS.copy()
    parsed = normalize_permissions({"allow_edit_workouts": False})

    merged = _merge_effective_permissions(current, parsed)
    assert merged["allow_edit_workouts"] is False


def test_merge_returns_all_true_when_both_default():
    current = DEFAULT_PERMISSIONS.copy()
    parsed = normalize_permissions({})

    merged = _merge_effective_permissions(current, parsed)

    assert merged["allow_delete_activities"] is True
    assert merged["allow_edit_workouts"] is True
    assert merged["require_workout_approval"] is False


def test_merge_multiple_restrictive_overrides():
    current = DEFAULT_PERMISSIONS.copy()
    parsed = normalize_permissions({
        "allow_delete_activities": False,
        "allow_export_calendar": False,
        "allow_public_calendar_share": False,
    })

    merged = _merge_effective_permissions(current, parsed)

    assert merged["allow_delete_activities"] is False
    assert merged["allow_export_calendar"] is False
    assert merged["allow_public_calendar_share"] is False
    # Unaffected keys stay True
    assert merged["allow_edit_workouts"] is True


def test_merge_preserves_dict_keys_exactly():
    current = DEFAULT_PERMISSIONS.copy()
    parsed = DEFAULT_PERMISSIONS.copy()
    merged = _merge_effective_permissions(current, parsed)
    assert set(merged.keys()) == set(PERMISSION_KEYS)


def test_merge_does_not_mutate_input():
    current = DEFAULT_PERMISSIONS.copy()
    current_copy = current.copy()
    parsed = normalize_permissions({"require_workout_approval": True})

    _merge_effective_permissions(current, parsed)

    # current must not have been mutated
    assert current == current_copy


class _ScalarsResult:
    def __init__(self, values):
        self._values = values

    def all(self):
        return list(self._values)


class _Result:
    def __init__(self, values=None, scalar_value=None):
        self._values = list(values or [])
        self._scalar_value = scalar_value

    def scalars(self):
        return _ScalarsResult(self._values)

    def scalar_one_or_none(self):
        return self._scalar_value


class _FakeDB:
    def __init__(self, execute_results=None):
        self.execute_results = list(execute_results or [])
        self.added = []
        self.commit_count = 0

    async def execute(self, _stmt):
        if self.execute_results:
            return self.execute_results.pop(0)
        return _Result([])

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commit_count += 1


@pytest.mark.asyncio
async def test_get_shared_org_ids_returns_intersection():
    db = _FakeDB(
        execute_results=[
            _Result(values=[10, 20, 20]),
            _Result(values=[20]),
        ]
    )

    out = await get_shared_org_ids(db, coach_id=1, athlete_id=2)
    assert out == [20]


@pytest.mark.asyncio
async def test_get_shared_org_ids_empty_when_coach_has_no_orgs():
    db = _FakeDB(execute_results=[_Result(values=[])])
    out = await get_shared_org_ids(db, coach_id=1, athlete_id=2)
    assert out == []


@pytest.mark.asyncio
async def test_get_athlete_org_ids_returns_unique_ids():
    db = _FakeDB(execute_results=[_Result(values=[1, 1, 2])])
    out = await get_athlete_org_ids(db, athlete_id=5)
    assert sorted(out) == [1, 2]


@pytest.mark.asyncio
async def test_get_athlete_permissions_self_no_orgs_returns_permissive():
    db = _FakeDB(execute_results=[_Result(values=[])])
    out = await get_athlete_permissions(db, athlete_id=7)
    assert out["allow_edit_workouts"] is True
    assert out["require_workout_approval"] is False


@pytest.mark.asyncio
async def test_get_athlete_permissions_coach_no_shared_orgs_defaults():
    db = _FakeDB(execute_results=[_Result(values=[])])
    out = await get_athlete_permissions(db, athlete_id=7, coach_id=3)
    assert out == DEFAULT_PERMISSIONS


@pytest.mark.asyncio
async def test_get_athlete_permissions_self_with_org_but_no_active_coach():
    db = _FakeDB(
        execute_results=[
            _Result(values=[11]),
            _Result(scalar_value=None),
        ]
    )
    out = await get_athlete_permissions(db, athlete_id=7)
    assert out["allow_delete_activities"] is True
    assert out["require_workout_approval"] is False


@pytest.mark.asyncio
async def test_get_athlete_permissions_merges_org_specific_rules():
    org = Organization(
        id=12,
        name="Org",
        code="o12",
        settings_json={
            "athlete_permissions": {
                "7": {
                    "allow_edit_workouts": False,
                    "allow_export_calendar": False,
                    "require_workout_approval": True,
                }
            }
        },
    )
    db = _FakeDB(
        execute_results=[
            _Result(values=[12]),
            _Result(scalar_value=1),
            _Result(values=[org]),
        ]
    )

    out = await get_athlete_permissions(db, athlete_id=7)
    assert out["allow_edit_workouts"] is False
    assert out["allow_export_calendar"] is False
    assert out["require_workout_approval"] is True


@pytest.mark.asyncio
async def test_set_athlete_permissions_for_shared_orgs_no_shared_returns_zero():
    db = _FakeDB(execute_results=[_Result(values=[])])
    updated = await set_athlete_permissions_for_shared_orgs(
        db,
        coach_id=1,
        athlete_id=2,
        permissions={"allow_edit_workouts": False},
    )
    assert updated == 0
    assert db.commit_count == 0


@pytest.mark.asyncio
async def test_set_athlete_permissions_for_shared_orgs_updates_settings_and_commits():
    org = Organization(id=77, name="Org", code="o77", settings_json={})
    db = _FakeDB(execute_results=[_Result(values=[77]), _Result(values=[77]), _Result(values=[org])])

    updated = await set_athlete_permissions_for_shared_orgs(
        db,
        coach_id=1,
        athlete_id=2,
        permissions={"allow_edit_workouts": False, "require_workout_approval": True},
    )
    assert updated == 1
    assert db.commit_count == 1
    assert org.settings_json["athlete_permissions"]["2"]["allow_edit_workouts"] is False
    assert org.settings_json["athlete_permissions"]["2"]["require_workout_approval"] is True
