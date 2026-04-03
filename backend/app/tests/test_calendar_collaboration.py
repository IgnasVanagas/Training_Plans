from __future__ import annotations

from app.routers import calendar as calendar_router
from app.services import permissions as permissions_service


def test_merge_effective_permissions_is_restrictive_for_grants_and_escalates_approval_requirement():
    current = permissions_service.DEFAULT_PERMISSIONS.copy()
    parsed = permissions_service.normalize_permissions({
        "allow_edit_workouts": False,
        "allow_export_calendar": False,
        "require_workout_approval": True,
    })

    merged = permissions_service._merge_effective_permissions(current, parsed)

    assert merged["allow_edit_workouts"] is False
    assert merged["allow_export_calendar"] is False
    assert merged["require_workout_approval"] is True


def test_normalize_calendar_share_settings_applies_safe_defaults():
    settings = calendar_router._normalize_calendar_share_settings({
        "enabled": True,
        "token": "abc123",
        "include_completed": True,
    })

    assert settings == {
        "enabled": True,
        "token": "abc123",
        "include_completed": True,
        "include_descriptions": False,
    }


def test_approval_from_planning_context_ignores_invalid_payloads():
    assert calendar_router._approval_from_planning_context(None) is None
    assert calendar_router._approval_from_planning_context({"approval": {"status": "other"}}) is None

    approval = calendar_router._approval_from_planning_context({
        "approval": {
            "status": "pending",
            "request_type": "update",
            "requested_by_user_id": 14,
        }
    })

    assert approval is not None
    assert approval["status"] == "pending"
    assert approval["request_type"] == "update"


def test_compute_workout_diff_detects_field_changes():
    before = {
        "title": "Tempo",
        "planned_duration": 60,
        "planning_context": {"a": 1},
    }
    after = {
        "title": "Tempo + strides",
        "planned_duration": 60,
        "planning_context": {"a": 2},
    }

    diff = calendar_router._compute_workout_diff(before, after)

    assert {item["field"] for item in diff} == {"title", "planning_context"}
    assert any(item["field"] == "title" and item["before"] == "Tempo" and item["after"] == "Tempo + strides" for item in diff)