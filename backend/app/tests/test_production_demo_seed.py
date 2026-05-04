from __future__ import annotations

import asyncio
from datetime import date, datetime

import pytest

from app import production_demo_seed as demo_seed
from app.models import Activity, ComplianceStatusEnum, PlannedWorkout, Profile
from app.schemas import CalendarEvent
from app.services import compliance as compliance_service


class _Result:
    def __init__(self, values):
        self._values = list(values)

    def scalars(self):
        return self

    def all(self):
        return list(self._values)


class _FakeDB:
    def __init__(self, execute_results):
        self.execute_results = list(execute_results)
        self.added = []
        self._next_id = 100

    async def execute(self, _stmt):
        if not self.execute_results:
            raise AssertionError("Unexpected execute call")
        return self.execute_results.pop(0)

    def add(self, obj):
        self.added.append(obj)
        if hasattr(obj, "id") and getattr(obj, "id", None) is None:
            setattr(obj, "id", self._next_id)
            self._next_id += 1

    async def flush(self):
        return None


def test_build_plus_address_replaces_existing_plus_alias():
    out = demo_seed.build_plus_address("test98765432987+old@gmail.com", "Prod Demo Athlete 01")
    assert out == "test98765432987+prod-demo-athlete-01@gmail.com"


def test_generate_secure_password_meets_complexity_rules():
    password = demo_seed.generate_secure_password(20)
    assert len(password) == 20
    assert any(char.islower() for char in password)
    assert any(char.isupper() for char in password)
    assert any(char.isdigit() for char in password)
    assert any(not char.isalnum() for char in password)


def test_ensure_mutation_allowed_requires_confirmation_for_writes():
    config = demo_seed.DemoSeedConfig(
        gmail_base="test98765432987@gmail.com",
        alias_prefix="prod-demo",
        dry_run=False,
        confirm_production=False,
    )
    with pytest.raises(ValueError):
        demo_seed.ensure_mutation_allowed(config)


def test_build_account_specs_returns_ten_unique_demo_addresses():
    config = demo_seed.DemoSeedConfig(
        gmail_base="test98765432987@gmail.com",
        alias_prefix="vps-may-2026",
    )
    specs = demo_seed.build_account_specs(config)
    assert len(specs) == 10
    assert len({spec.email for spec in specs}) == 10
    assert specs[0].persona.key == "coach"
    assert specs[1].persona.key == "admin"
    assert specs[-1].persona.key == "athlete-08"
    assert specs[0].email == "test98765432987+vps-may-2026-coach@gmail.com"


def test_build_workout_blueprints_cover_required_status_mix_for_athlete():
    athlete = demo_seed.get_athlete_personas()[0]
    workouts = demo_seed.build_workout_blueprints(athlete, date(2026, 5, 4))
    assert len(workouts) == 8
    assert len([item for item in workouts if item.day_offset < 0]) == 4
    assert len([item for item in workouts if item.day_offset > 0]) == 4
    past_statuses = {item.target_status for item in workouts if item.day_offset < 0}
    assert past_statuses == {"green", "yellow", "red", "missed"}
    assert all(item.target_status == "planned" for item in workouts if item.day_offset > 0)


def test_future_seed_workout_structures_validate_as_calendar_events():
    index = 1
    for athlete in demo_seed.get_athlete_personas():
        future_workouts = [item for item in demo_seed.build_workout_blueprints(athlete, date(2026, 5, 4)) if item.day_offset > 0]
        for workout in future_workouts:
            event = CalendarEvent(
                id=index,
                user_id=1,
                date=date(2026, 5, 4),
                title=workout.title,
                sport_type=workout.sport_type,
                duration=float(workout.planned_duration),
                distance=workout.planned_distance,
                is_planned=True,
                compliance_status=ComplianceStatusEnum.planned,
                planned_duration=workout.planned_duration,
                planned_distance=workout.planned_distance,
                structure=workout.structure,
            )
            assert event.structure is not None
            assert len(event.structure) == len(workout.structure or [])
            index += 1


def test_build_activity_blueprints_include_required_duplicates():
    athlete = demo_seed.get_athlete_personas()[1]
    activities = demo_seed.build_activity_blueprints(athlete, date(2026, 5, 4))
    assert len(activities) == 6
    primary = [item for item in activities if item.duplicate_of_key is None]
    duplicates = [item for item in activities if item.duplicate_of_key is not None]
    assert len(primary) == 4
    assert len(duplicates) == 2
    assert {item.duplicate_of_key for item in duplicates} == {"past-green-primary", "past-yellow-primary"}
    assert any(item.prefer_parsed_template for item in primary)


def test_chat_blueprints_cover_group_coach_and_direct_threads():
    athlete = demo_seed.get_athlete_personas()[0]
    group_messages = demo_seed.build_group_chat_blueprints()
    coach_messages = demo_seed.build_coach_chat_blueprints(athlete)
    direct_messages = demo_seed.build_direct_chat_blueprints()

    assert len(group_messages) == 8
    assert {item.sender_key for item in group_messages} >= {"coach", "admin", "athlete-01", "athlete-02"}
    assert len(coach_messages) == 4
    assert {item.sender_key for item in coach_messages} == {"coach", athlete.key}
    assert all(item.athlete_key == athlete.key for item in coach_messages)
    direct_threads = {frozenset((item.sender_key, item.recipient_key)) for item in direct_messages}
    assert frozenset(("admin", "coach")) in direct_threads
    assert frozenset(("admin", "athlete-03")) in direct_threads
    assert frozenset(("admin", "athlete-06")) in direct_threads


def test_admin_persona_is_both_system_admin_and_org_admin_candidate():
    config = demo_seed.DemoSeedConfig(
        gmail_base="test98765432987@gmail.com",
        alias_prefix="prod-demo",
    )
    settings = demo_seed._build_org_settings(config, coach_id=11, admin_id=22, managed_emails=["a@example.com"])
    admin_persona = demo_seed.DEMO_PERSONAS[1]
    assert admin_persona.key == "admin"
    assert admin_persona.role.value == "admin"
    assert admin_persona.org_role == "admin"
    assert settings["creator_id"] == 11
    assert settings["admin_ids"] == [11, 22]


def test_build_goal_race_payloads_preserves_two_races_per_athlete():
    athlete = demo_seed.get_athlete_personas()[2]
    payload = demo_seed.build_goal_race_payloads(athlete, date(2026, 5, 4))
    assert len(payload) == 2
    assert payload[0]["priority"] in {"B", "C"}
    assert payload[1]["priority"] == "A"
    assert payload[0]["date"] < payload[1]["date"]


def test_seed_dry_run_report_exposes_expected_counts_and_accounts():
    config = demo_seed.DemoSeedConfig(
        gmail_base="test98765432987@gmail.com",
        alias_prefix="prod-demo",
        dry_run=True,
    )
    report = asyncio.run(demo_seed.seed_production_demo(config))
    payload = report.to_dict()
    assert payload["action"] == "seed"
    assert payload["dry_run"] is True
    assert payload["counts"]["users"] == 10
    assert payload["counts"]["athletes"] == 8
    assert payload["counts"]["planned_workouts"] == 64
    assert payload["counts"]["activities"] == 48
    assert payload["counts"]["group_messages"] == 8
    assert payload["counts"]["coach_messages"] == 32
    assert payload["counts"]["direct_messages"] == 8
    assert payload["accounts"][0]["email"] == "test98765432987+prod-demo-coach@gmail.com"


def test_purge_dry_run_report_uses_same_account_set():
    config = demo_seed.DemoSeedConfig(
        gmail_base="test98765432987@gmail.com",
        alias_prefix="prod-demo",
        dry_run=True,
    )
    report = asyncio.run(demo_seed.purge_production_demo(config))
    payload = report.to_dict()
    assert payload["action"] == "purge"
    assert payload["dry_run"] is True
    assert len(payload["accounts"]) == 10
    assert payload["accounts"][-1]["email"] == "test98765432987+prod-demo-athlete-08@gmail.com"


@pytest.mark.asyncio
async def test_upsert_users_profiles_org_rotates_existing_passwords_and_sets_admin_roles(monkeypatch):
    config = demo_seed.DemoSeedConfig(
        gmail_base="test98765432987@gmail.com",
        alias_prefix="prod-demo",
        preserve_existing_passwords=False,
    )
    specs = demo_seed.build_account_specs(config)
    existing_coach = demo_seed.User(
        id=7,
        email=specs[0].email,
        password_hash="old-hash",
        role=demo_seed.RoleEnum.coach,
        email_verified=False,
    )
    fake_db = _FakeDB(
        execute_results=[
            _Result([existing_coach]),
            _Result([]),
            _Result([]),
            _Result([]),
            _Result([]),
        ]
    )
    monkeypatch.setattr(demo_seed, "generate_secure_password", lambda length=20: "SecurePass1234!ABcd")
    monkeypatch.setattr(demo_seed, "get_password_hash", lambda password: f"HASH::{password}")

    org, users_by_key, _profiles_by_user_id, credentials = await demo_seed._upsert_users_profiles_org(fake_db, config, specs)

    coach = users_by_key["coach"]
    admin = users_by_key["admin"]
    coach_credential = next(item for item in credentials if item.key == "coach")
    admin_credential = next(item for item in credentials if item.key == "admin")

    assert coach.password_hash == "HASH::SecurePass1234!ABcd"
    assert coach.email_verified is True
    assert coach_credential.password_status == "rotated"
    assert coach_credential.password == "SecurePass1234!ABcd"
    assert admin.role == demo_seed.RoleEnum.admin
    assert admin_credential.password_status == "generated"
    assert org.settings_json["admin_ids"] == [coach.id, admin.id]
    assert org.settings_json["creator_id"] == coach.id


def _build_match_pair(persona_key: str, workout_key: str, activity_key: str):
    persona = next(item for item in demo_seed.get_athlete_personas() if item.key == persona_key)
    workout_blueprint = next(item for item in demo_seed.build_workout_blueprints(persona) if item.key == workout_key)
    activity_blueprint = next(item for item in demo_seed.build_activity_blueprints(persona) if item.key == activity_key)
    target_date = date(2026, 5, 4)

    workout = PlannedWorkout(
        id=1,
        user_id=7,
        date=target_date,
        title=workout_blueprint.title,
        description=workout_blueprint.description,
        sport_type=workout_blueprint.sport_type,
        planned_duration=workout_blueprint.planned_duration,
        planned_distance=workout_blueprint.planned_distance,
        planned_intensity=workout_blueprint.planned_intensity,
        structure=workout_blueprint.structure,
        compliance_status=ComplianceStatusEnum.planned,
    )

    distance_m = activity_blueprint.distance_km * 1000.0 if activity_blueprint.distance_km is not None else None
    duration_s = float(activity_blueprint.duration_minutes * 60)
    avg_speed = (distance_m / duration_s) if distance_m and duration_s > 0 else None
    activity = Activity(
        id=9,
        athlete_id=7,
        filename=activity_blueprint.title,
        file_path="demo-seed/test.fit",
        file_type="manual",
        sport=activity_blueprint.sport,
        created_at=datetime(2026, 5, 4, 7, 30, 0),
        distance=distance_m,
        duration=duration_s,
        avg_speed=avg_speed,
        average_hr=activity_blueprint.average_hr,
        average_watts=activity_blueprint.average_watts,
        rpe=activity_blueprint.rpe,
        notes=activity_blueprint.notes,
        local_date=target_date,
        streams={"_meta": {"deleted": False}},
    )
    profile = Profile(
        user_id=7,
        ftp=persona.ftp,
        lt2=persona.lt2,
        max_hr=persona.max_hr,
        resting_hr=persona.resting_hr,
    )
    return workout, activity, profile


@pytest.mark.parametrize(
    ("persona_key", "workout_key", "activity_key", "expected_status"),
    [
        ("athlete-01", "past-green", "past-green-primary", ComplianceStatusEnum.completed_green),
        ("athlete-01", "past-yellow", "past-yellow-primary", ComplianceStatusEnum.completed_yellow),
        ("athlete-01", "past-red", "past-red-primary", ComplianceStatusEnum.completed_red),
        ("athlete-02", "past-green", "past-green-primary", ComplianceStatusEnum.completed_green),
        ("athlete-02", "past-yellow", "past-yellow-primary", ComplianceStatusEnum.completed_yellow),
        ("athlete-02", "past-red", "past-red-primary", ComplianceStatusEnum.completed_red),
    ],
)
def test_seed_blueprints_produce_expected_compliance_statuses(persona_key: str, workout_key: str, activity_key: str, expected_status: ComplianceStatusEnum):
    workout, activity, profile = _build_match_pair(persona_key, workout_key, activity_key)
    similarity = compliance_service._similarity_score(workout, activity)
    status = compliance_service._compliance_status_for_match(workout, activity, profile, None)
    assert similarity >= 0.45
    assert status == expected_status