from __future__ import annotations

from datetime import date, datetime

import pytest

from app.models import Organization, OrganizationMember, Profile, RoleEnum, User
from app.routers import users as users_router
from app.schemas import ProfileUpdate


class _RowsResult:
    def __init__(self, rows):
        self._rows = list(rows)

    def all(self):
        return list(self._rows)


class _UsersHelperDB:
    def __init__(self, *, execute_results=None, scalar_results=None):
        self.execute_results = list(execute_results or [])
        self.scalar_results = list(scalar_results or [])
        self.added = []
        self.commits = 0
        self.refreshed = []

    async def execute(self, stmt):
        if not self.execute_results:
            return _RowsResult([])
        return self.execute_results.pop(0)

    async def scalar(self, stmt):
        if not self.scalar_results:
            return None
        return self.scalar_results.pop(0)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commits += 1

    async def refresh(self, obj):
        self.refreshed.append(obj)


def test_consent_profile_and_risk_helpers_cover_normalization_paths(monkeypatch):
    monkeypatch.setenv("ATHLETE_DATA_SHARING_CONSENT_VERSION", "2026-05-01")

    membership = OrganizationMember(user_id=2, organization_id=1, role=RoleEnum.athlete.value, status="active")
    users_router._apply_athlete_data_sharing_consent(membership, None)

    assert membership.athlete_data_sharing_consent is True
    assert membership.athlete_data_sharing_consent_version == "2026-05-01"
    assert membership.athlete_data_sharing_consented_at is not None

    sports, zones, auto_sync = users_router._extract_profile_sports_and_zones(
        {
            "items": ["running"],
            "zone_settings": {"running": {"pace": {"upper_bounds": [4.5]}}},
            "integration_settings": {"auto_sync_integrations": False},
        }
    )
    assert sports == ["running"]
    assert zones == {"running": {"pace": {"upper_bounds": [4.5]}}}
    assert auto_sync is False
    assert users_router._extract_profile_sports_and_zones(["cycling"]) == (["cycling"], None, True)
    assert users_router._extract_profile_sports_and_zones(None) == (None, None, True)

    profile = Profile(user_id=7, sports={"items": ["running"], "zone_settings": {"running": {}}, "integration_settings": {"auto_sync_integrations": False}})
    users_router._normalize_profile_for_response(profile)
    assert profile.sports == ["running"]
    assert profile.zone_settings == {"running": {}}
    assert profile.auto_sync_integrations is False

    user = User(id=7, email="athlete@example.com", password_hash="x", role=RoleEnum.athlete, email_verified=True)
    user.profile = Profile(user_id=7, first_name="Ada", last_name="Runner")
    users_router._normalize_user_for_response(user)
    assert users_router._athlete_display_name(user) == "Ada Runner"
    assert users_router._athlete_display_name(User(id=8, email="fallback@example.com", password_hash="x", role=RoleEnum.athlete, email_verified=True)) == "fallback@example.com"

    assert users_router._build_next_coach_workout_lookup([(2, date(2026, 3, 10)), (2, date(2026, 3, 12)), (3, date(2026, 3, 11))]) == {
        2: date(2026, 3, 10),
        3: date(2026, 3, 11),
    }
    assert users_router._clamp_float(2.5, 0.0, 2.0) == pytest.approx(2.0)
    assert users_router._estimate_activity_load_points(duration_seconds=0, average_hr=None, max_hr=None, average_watts=None, ftp=None) == pytest.approx(0.0)
    assert users_router._estimate_activity_load_points(duration_seconds=3600, average_hr=160, max_hr=200, average_watts=250, ftp=300) == pytest.approx(50.0)

    risk_score, reasons = users_router._build_risk_and_reasons(
        days_since_last_activity=8,
        acwr=1.5,
        last_7d_load=130,
        previous_28d_weekly_avg_load=100,
        planned_7d_minutes=0,
        overdue_planned_count=3,
        missed_compliance_count=2,
        workload_delta_minutes=200,
        has_threshold_metrics=False,
    )
    assert risk_score == 14
    assert {
        "activity_gap_8d",
        "overdue_planned_multiple",
        "missed_compliance_repeated",
        "no_planned_next_7d",
        "acwr_high_spike",
        "workload_delta_high",
        "missing_threshold_metrics",
    }.issubset(set(reasons))


def test_apply_profile_update_to_user_merges_nested_sports_payloads():
    target_user = User(id=7, email="athlete@example.com", password_hash="x", role=RoleEnum.athlete, email_verified=True)
    target_user.profile = Profile(
        user_id=7,
        first_name="Old",
        sports={
            "items": ["running"],
            "zone_settings": {"running": {"pace": {"upper_bounds": [4.5]}}},
            "integration_settings": {"auto_sync_integrations": True},
        },
    )

    users_router._apply_profile_update_to_user(
        target_user,
        ProfileUpdate(
            first_name="New",
            sports=["cycling"],
            zone_settings={"cycling": {"power": {"lt1": 200}}},
            auto_sync_integrations=False,
        ),
    )

    assert target_user.profile.first_name == "New"
    assert target_user.profile.sports == {
        "items": ["cycling"],
        "zone_settings": {"cycling": {"power": {"lt1": 200}}},
        "integration_settings": {"auto_sync_integrations": False},
    }

    users_router._apply_profile_update_to_user(target_user, ProfileUpdate(auto_sync_integrations=True))
    assert target_user.profile.sports["items"] == ["cycling"]
    assert target_user.profile.sports["integration_settings"]["auto_sync_integrations"] is True


@pytest.mark.asyncio
async def test_upcoming_workout_metric_logging_and_coach_summary_helpers():
    athlete_one = User(id=2, email="one@example.com", password_hash="x", role=RoleEnum.athlete, email_verified=True)
    athlete_two = User(id=3, email="two@example.com", password_hash="x", role=RoleEnum.athlete, email_verified=True)
    annotate_db = _UsersHelperDB(execute_results=[_RowsResult([(2, date(2026, 3, 10)), (2, date(2026, 3, 12)), (3, date(2026, 3, 11))])])

    await users_router._annotate_athletes_with_upcoming_workout_status(annotate_db, coach_id=99, athletes=[athlete_one, athlete_two], horizon_days=7)

    assert athlete_one.has_upcoming_coach_workout is True
    assert athlete_one.next_coach_workout_date == date(2026, 3, 10)
    assert athlete_two.next_coach_workout_date == date(2026, 3, 11)

    metrics_db = _UsersHelperDB()
    await users_router._log_metric_change(metrics_db, user_id=7, metric="ftp", old_value=250, new_value=250)
    await users_router._log_metric_change(metrics_db, user_id=7, metric="ftp", old_value=250, new_value=None)
    await users_router._log_metric_change(metrics_db, user_id=7, metric="ftp", old_value=250, new_value=260)
    assert len(metrics_db.added) == 1
    assert metrics_db.added[0].metric == "ftp"
    assert metrics_db.added[0].value == 260

    athlete = User(id=7, email="athlete@example.com", password_hash="x", role=RoleEnum.athlete, email_verified=True)
    athlete.organization_memberships = [OrganizationMember(user_id=7, organization_id=1, role=RoleEnum.athlete.value, status="active")]
    coach_rows = _RowsResult([
        (10, "coach@example.com", "Coach", "One", 1, "Org A"),
        (10, "coach@example.com", "Coach", "One", 2, "Org B"),
        (11, "assistant@example.com", None, None, 1, "Org A"),
    ])
    coach_db = _UsersHelperDB(execute_results=[coach_rows])
    summaries = await users_router._get_athlete_coach_summaries(coach_db, athlete)

    assert len(summaries) == 2
    assert summaries[0].organization_names


@pytest.mark.asyncio
async def test_org_admin_helpers_and_load_org_for_admin_cover_bootstrap_and_forbidden_paths():
    org = Organization(id=5, name="Team", settings_json={"admin_ids": [7]})
    assert users_router._get_org_admin_ids(org) == [7]
    assert users_router._is_org_admin(org, 7) is True

    users_router._set_org_admin(org, 9, True)
    users_router._set_org_admin(org, 7, False)
    assert org.settings_json["admin_ids"] == [9]

    bootstrap_org = Organization(id=6, name="Bootstrap", settings_json={})
    coach_membership = OrganizationMember(user_id=9, organization_id=6, role=RoleEnum.coach.value, status="active")
    bootstrap_db = _UsersHelperDB(scalar_results=[bootstrap_org, coach_membership])
    loaded = await users_router._load_org_for_admin(bootstrap_db, org_id=6, user_id=9)
    assert loaded.settings_json["admin_ids"] == [9]
    assert bootstrap_db.commits == 1
    assert bootstrap_db.refreshed == [bootstrap_org]

    forbidden_org = Organization(id=7, name="Forbidden", settings_json={"admin_ids": [3]})
    forbidden_db = _UsersHelperDB(scalar_results=[forbidden_org])
    with pytest.raises(Exception) as exc_info:
        await users_router._load_org_for_admin(forbidden_db, org_id=7, user_id=9)
    assert exc_info.value.status_code == 403


def test_build_next_coach_workout_lookup_keeps_earliest_date_per_athlete():
    lookup = users_router._build_next_coach_workout_lookup(
        [
            (10, date(2026, 3, 18)),
            (10, date(2026, 3, 20)),
            (11, date(2026, 3, 19)),
        ]
    )

    assert lookup == {
        10: date(2026, 3, 18),
        11: date(2026, 3, 19),
    }


def test_apply_profile_update_to_user_merges_zone_settings_without_losing_existing_sports():
    athlete = User(id=42, email='athlete@example.com', password_hash='x')
    athlete.profile = Profile(
        user_id=42,
        sports={
            'items': ['running'],
            'zone_settings': {
                'running': {
                    'hr': {
                        'upper_bounds': [120, 135, 150, 165],
                    }
                }
            },
            'integration_settings': {
                'auto_sync_integrations': True,
            },
        },
        ftp=250,
    )

    users_router._apply_profile_update_to_user(
        athlete,
        ProfileUpdate(
            ftp=275,
            zone_settings={
                'cycling': {
                    'power': {
                        'upper_bounds': [150, 200, 240, 280, 320, 380],
                        'lt1': 210,
                        'lt2': 260,
                    }
                }
            },
        ),
    )

    assert athlete.profile.ftp == 275
    assert athlete.profile.sports['items'] == ['running']
    assert athlete.profile.sports['zone_settings'] == {
        'cycling': {
            'power': {
                'upper_bounds': [150, 200, 240, 280, 320, 380],
                'lt1': 210,
                'lt2': 260,
            }
        }
    }
    assert athlete.profile.sports['integration_settings']['auto_sync_integrations'] is True