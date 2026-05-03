"""Pure-helper coverage tests for app.routers.calendar."""

from __future__ import annotations

from datetime import date, datetime

import pytest
from fastapi import HTTPException

from app.models import PlannedWorkout
from app.routers import calendar as cal


# ── _escape_ics_text ────────────────────────────────────────────────────────


@pytest.mark.parametrize("value, expected", [
    (None, ""),
    ("", ""),
    ("hello", "hello"),
    ("a;b,c\nd\\e", "a\\;b\\,c\\nd\\\\e"),
])
def test_escape_ics_text(value, expected):
    assert cal._escape_ics_text(value) == expected


# ── _normalize_calendar_share_settings ──────────────────────────────────────


def test_normalize_share_settings_defaults_when_invalid():
    out = cal._normalize_calendar_share_settings(None)
    assert out == {"enabled": False, "token": None, "include_completed": False, "include_descriptions": False}


def test_normalize_share_settings_from_dict():
    out = cal._normalize_calendar_share_settings({
        "enabled": True, "token": "  abc  ", "include_completed": True, "include_descriptions": False,
    })
    assert out["enabled"] is True
    assert out["token"] == "abc"
    assert out["include_completed"] is True


def test_normalize_share_settings_blank_token_to_none():
    out = cal._normalize_calendar_share_settings({"token": "   "})
    assert out["token"] is None


# ── _approval_from_planning_context ─────────────────────────────────────────


def test_approval_returns_none_when_not_dict():
    assert cal._approval_from_planning_context(None) is None
    assert cal._approval_from_planning_context([]) is None


def test_approval_returns_none_when_no_approval_key():
    assert cal._approval_from_planning_context({"foo": "bar"}) is None


def test_approval_returns_none_when_invalid_status_or_type():
    assert cal._approval_from_planning_context({"approval": {"status": "weird", "request_type": "create"}}) is None
    assert cal._approval_from_planning_context({"approval": {"status": "pending", "request_type": "weird"}}) is None


def test_approval_returns_dict_when_valid():
    out = cal._approval_from_planning_context({
        "approval": {"status": "PENDING", "request_type": "Create", "extra": 1}
    })
    assert out == {"status": "PENDING", "request_type": "Create", "extra": 1}


# ── _approval_datetime ──────────────────────────────────────────────────────


def test_approval_datetime_invalid_returns_none():
    assert cal._approval_datetime(None) is None
    assert cal._approval_datetime("") is None
    assert cal._approval_datetime("not a date") is None


def test_approval_datetime_z_suffix_parsed():
    out = cal._approval_datetime("2026-05-01T10:00:00Z")
    assert out is not None
    assert out.year == 2026


# ── _strip_approval_context ─────────────────────────────────────────────────


def test_strip_approval_context_removes_key():
    out = cal._strip_approval_context({"approval": {"x": 1}, "other": 2})
    assert out == {"other": 2}


def test_strip_approval_context_returns_none_when_only_approval():
    out = cal._strip_approval_context({"approval": {"x": 1}})
    assert out is None


def test_strip_approval_context_handles_non_dict():
    assert cal._strip_approval_context(None) is None


# ── _set_approval_context ───────────────────────────────────────────────────


def test_set_approval_context_creates_block():
    out = cal._set_approval_context(None, status="pending", request_type="create",
                                    requested_by_user_id=42)
    assert out["approval"]["status"] == "pending"
    assert out["approval"]["request_type"] == "create"
    assert out["approval"]["requested_by_user_id"] == 42
    assert out["approval"]["proposed_changes"] is None


def test_set_approval_context_preserves_other_keys():
    out = cal._set_approval_context({"k": 1}, status="approved", request_type="update",
                                    requested_by_user_id=1, proposed_changes={"title": "new"})
    assert out["k"] == 1
    assert out["approval"]["proposed_changes"] == {"title": "new"}


# ── _serialize_proposed_changes ─────────────────────────────────────────────


def test_serialize_proposed_changes_handles_dates():
    out = cal._serialize_proposed_changes({"date": date(2026, 5, 1), "when": datetime(2026, 5, 1, 10), "title": "x"})
    assert out["date"] == "2026-05-01"
    assert out["when"].startswith("2026-05-01T10")
    assert out["title"] == "x"


def test_serialize_proposed_changes_none_or_empty_returns_none():
    assert cal._serialize_proposed_changes(None) is None
    assert cal._serialize_proposed_changes({}) is None


# ── _annotate_workout_with_approval ─────────────────────────────────────────


def test_annotate_workout_no_approval_clears_fields():
    w = PlannedWorkout(id=1, user_id=1, date=date(2026, 5, 1), planning_context=None)
    cal._annotate_workout_with_approval(w)
    assert w.approval_status is None
    assert w.approval_request_type is None


def test_annotate_workout_with_approval_sets_fields():
    w = PlannedWorkout(id=1, user_id=1, date=date(2026, 5, 1),
                       planning_context={"approval": {
                           "status": "pending", "request_type": "create",
                           "requested_by_user_id": 7, "requested_at": "2026-05-01T10:00:00Z",
                       }})
    cal._annotate_workout_with_approval(w, display_by_id={7: "Coach"})
    assert w.approval_status == "pending"
    assert w.approval_request_type == "create"
    assert w.approval_requested_by_user_id == 7
    assert w.approval_requested_by_name == "Coach"
    assert w.approval_requested_at is not None


def test_annotate_workout_handles_missing_lookup():
    w = PlannedWorkout(id=1, user_id=1, date=date(2026, 5, 1),
                       planning_context={"approval": {
                           "status": "pending", "request_type": "create",
                           "requested_by_user_id": 7, "requested_at": "bad",
                       }})
    cal._annotate_workout_with_approval(w)
    assert w.approval_requested_by_name is None
    assert w.approval_requested_at is None


# ── _estimate_planned_duration_minutes ──────────────────────────────────────


def test_estimate_duration_returns_none_when_invalid():
    assert cal._estimate_planned_duration_minutes(None) is None
    assert cal._estimate_planned_duration_minutes([]) is None


def test_estimate_duration_basic_block():
    structure = [{"type": "block", "duration": {"type": "time", "value": 600}}]
    assert cal._estimate_planned_duration_minutes(structure) == 10


def test_estimate_duration_repeat_multiplies():
    structure = [{
        "type": "repeat", "repeats": 3,
        "steps": [{"type": "block", "duration": {"type": "time", "value": 60}}],
    }]
    assert cal._estimate_planned_duration_minutes(structure) == 3


def test_estimate_duration_skips_non_time_blocks():
    structure = [{"type": "block", "duration": {"type": "distance", "value": 1000}}]
    assert cal._estimate_planned_duration_minutes(structure) is None


def test_estimate_duration_handles_invalid_repeats_and_values():
    structure = [{
        "type": "repeat", "repeats": "bad",
        "steps": [{"type": "block", "duration": {"type": "time", "value": "bad"}}],
    }]
    assert cal._estimate_planned_duration_minutes(structure) is None


def test_estimate_duration_unknown_type_returns_zero_seconds():
    structure = [{"type": "unknown"}]
    assert cal._estimate_planned_duration_minutes(structure) is None


# ── _extract_recurrence ─────────────────────────────────────────────────────


def test_extract_recurrence_none_when_no_workout():
    assert cal._extract_recurrence(None) is None


def test_extract_recurrence_returns_dict():
    w = PlannedWorkout(id=1, user_id=1, date=date(2026, 5, 1),
                       planning_context={"recurrence": {"interval_weeks": 2}})
    assert cal._extract_recurrence(w) == {"interval_weeks": 2}


def test_extract_recurrence_returns_none_when_missing():
    w = PlannedWorkout(id=1, user_id=1, date=date(2026, 5, 1), planning_context={})
    assert cal._extract_recurrence(w) is None


# ── _merge_planning_context ─────────────────────────────────────────────────


def test_merge_planning_context_drops_recurrence_when_none():
    out = cal._merge_planning_context({"recurrence": {"x": 1}, "other": 2}, None)
    assert out == {"other": 2}


def test_merge_planning_context_sets_recurrence():
    out = cal._merge_planning_context({"k": 1}, {"interval_weeks": 1})
    assert out["recurrence"] == {"interval_weeks": 1}


def test_merge_planning_context_returns_none_when_empty():
    assert cal._merge_planning_context(None, None) is None


# ── _snapshot_workout / _compute_workout_diff / _apply_workout_snapshot ─────


def test_snapshot_workout_serialises_date():
    w = PlannedWorkout(id=1, user_id=1, date=date(2026, 5, 1), title="t")
    snap = cal._snapshot_workout(w)
    assert snap["date"] == "2026-05-01"
    assert snap["title"] == "t"


def test_compute_workout_diff_lists_changes():
    diff = cal._compute_workout_diff({"a": 1, "b": 2}, {"a": 1, "b": 3, "c": 4})
    fields = {row["field"] for row in diff}
    assert fields == {"b", "c"}


def test_compute_workout_diff_empty_when_equal():
    assert cal._compute_workout_diff({"a": 1}, {"a": 1}) == []


def test_compute_workout_diff_handles_none_inputs():
    assert cal._compute_workout_diff(None, None) == []


def test_apply_workout_snapshot_restores_fields():
    w = PlannedWorkout(id=1, user_id=1, date=date(2026, 5, 1), title="old")
    cal._apply_workout_snapshot(w, {"date": "2026-06-01", "title": "new"})
    assert w.date == date(2026, 6, 1)
    assert w.title == "new"


def test_apply_workout_snapshot_skips_unknown_fields():
    w = PlannedWorkout(id=1, user_id=1, date=date(2026, 5, 1), title="t")
    cal._apply_workout_snapshot(w, {"unknown": "x"})
    assert w.title == "t"


# ── _expand_weekly_recurrence_dates ─────────────────────────────────────────


def test_expand_weekly_recurrence_simple_span():
    # start Mon 2026-05-04, weekdays=Mon (0) and Wed (2), span 2 weeks
    out = cal._expand_weekly_recurrence_dates(
        date(2026, 5, 4), {"weekdays": [0, 2], "span_weeks": 2}
    )
    # Two weeks × 2 weekdays = 4 dates
    assert len(out) == 4
    assert out[0] == date(2026, 5, 4)


def test_expand_weekly_recurrence_uses_end_date():
    out = cal._expand_weekly_recurrence_dates(
        date(2026, 5, 4), {"weekdays": [0], "end_date": "2026-05-18"}
    )
    assert len(out) == 3
    assert out[-1] == date(2026, 5, 18)


def test_expand_weekly_recurrence_interval_weeks_skips():
    out = cal._expand_weekly_recurrence_dates(
        date(2026, 5, 4), {"weekdays": [0], "interval_weeks": 2, "span_weeks": 4}
    )
    # Weeks 1 and 3 → 2 dates
    assert len(out) == 2


def test_expand_weekly_recurrence_exception_dates_excluded():
    out = cal._expand_weekly_recurrence_dates(
        date(2026, 5, 4),
        {"weekdays": [0], "span_weeks": 3, "exception_dates": ["2026-05-11"]},
    )
    dates_list = [d.isoformat() for d in out]
    assert "2026-05-11" not in dates_list


def test_expand_weekly_recurrence_no_span_or_end_date_raises():
    with pytest.raises(HTTPException):
        cal._expand_weekly_recurrence_dates(
            date(2026, 5, 4), {"weekdays": [0]}
        )


def test_expand_weekly_recurrence_invalid_weekday_raises():
    with pytest.raises(HTTPException):
        cal._expand_weekly_recurrence_dates(
            date(2026, 5, 4), {"weekdays": [9], "span_weeks": 1}
        )


def test_expand_weekly_recurrence_end_before_start_raises():
    with pytest.raises(HTTPException):
        cal._expand_weekly_recurrence_dates(
            date(2026, 5, 10), {"weekdays": [0], "end_date": "2026-05-01"}
        )


def test_expand_weekly_recurrence_invalid_end_date_string_raises():
    with pytest.raises(HTTPException):
        cal._expand_weekly_recurrence_dates(
            date(2026, 5, 4), {"weekdays": [0], "end_date": "bad-date"}
        )


def test_expand_weekly_recurrence_invalid_exception_string_raises():
    with pytest.raises(HTTPException):
        cal._expand_weekly_recurrence_dates(
            date(2026, 5, 4),
            {"weekdays": [0], "span_weeks": 2, "exception_dates": ["bad"]},
        )


def test_expand_weekly_recurrence_no_dates_produced_raises():
    # All dates excluded → expect 422
    with pytest.raises(HTTPException):
        cal._expand_weekly_recurrence_dates(
            date(2026, 5, 4),
            {"weekdays": [0], "span_weeks": 1, "exception_dates": ["2026-05-04"]},
        )
