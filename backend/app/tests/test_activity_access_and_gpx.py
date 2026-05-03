from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.models import Activity, PlannedWorkout, Profile, RoleEnum, User
from app.parsing import parse_gpx
from app.routers import activities as activities_router


class _ExecuteResult:
    def __init__(self, value):
        self._value = value

    def scalars(self):
        return self

    def first(self):
        return self._value

    def scalar_one_or_none(self):
        return self._value


class _FakeDB:
    def __init__(self, *, execute_results=None, scalar_results=None):
        self.execute_results = list(execute_results or [])
        self.scalar_results = list(scalar_results or [])

    async def execute(self, _stmt):
        if self.execute_results:
            return self.execute_results.pop(0)
        return _ExecuteResult(None)

    async def scalar(self, _stmt):
        if self.scalar_results:
            return self.scalar_results.pop(0)
        return None

    async def commit(self):
        return None

    async def refresh(self, _obj):
        return None


def _activity_for_user(*, athlete_id: int) -> Activity:
    return Activity(
        id=42,
        athlete_id=athlete_id,
        filename="sample.fit",
        file_path="uploads/sample.fit",
        file_type="fit",
        created_at=datetime.utcnow(),
        streams={"data": [], "stats": {}},
    )


def _comparison_workout() -> PlannedWorkout:
    return PlannedWorkout(
        id=7,
        user_id=3,
        created_by_user_id=3,
        date=date(2026, 3, 12),
        title="Structured Run",
        sport_type="Running",
        planned_duration=30,
        planned_distance=6.0,
        planned_intensity="Zone 3",
        structure=[
            {"type": "block", "duration": {"type": "time", "value": 600}, "target": {"type": "pace", "zone": 2}},
            {"type": "block", "duration": {"type": "time", "value": 900}, "target": {"type": "pace", "zone": 3}},
            {"type": "block", "duration": {"type": "time", "value": 300}, "target": {"type": "pace", "zone": 2}},
        ],
    )


def _comparison_activity() -> Activity:
    start = datetime(2026, 3, 12, 7, 0, 0, tzinfo=timezone.utc)
    stream_rows = []
    for minute in range(0, 31):
        if minute < 10:
            hr = 140
            power = 180
            speed = 3.6
        elif minute < 25:
            hr = 158
            power = 220
            speed = 4.2
        else:
            hr = 145
            power = 170
            speed = 3.4
        stream_rows.append(
            {
                "timestamp": (start + timedelta(minutes=minute)).isoformat().replace("+00:00", "Z"),
                "distance": float(minute * 200),
                "heart_rate": hr,
                "power": power,
                "speed": speed,
            }
        )

    return Activity(
        id=99,
        athlete_id=3,
        filename="comparison.fit",
        file_path="uploads/comparison.fit",
        file_type="fit",
        created_at=datetime.utcnow(),
        sport="running",
        duration=1800,
        distance=6000,
        avg_speed=4.0,
        average_hr=151,
        average_watts=205,
        streams={"data": stream_rows, "stats": {}},
    )


@pytest.mark.asyncio
async def test_get_activity_blocks_unrelated_athlete_access():
    current_user = User(
        id=1,
        email="athlete@example.com",
        password_hash="x",
        role=RoleEnum.athlete,
        email_verified=True,
    )
    db = _FakeDB(execute_results=[_ExecuteResult(_activity_for_user(athlete_id=2))])

    with pytest.raises(HTTPException) as exc:
        await activities_router.get_activity(42, current_user=current_user, db=db)

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_get_activity_blocks_unlinked_coach_access():
    current_user = User(
        id=10,
        email="coach@example.com",
        password_hash="x",
        role=RoleEnum.coach,
        email_verified=True,
    )
    db = _FakeDB(
        execute_results=[_ExecuteResult(_activity_for_user(athlete_id=2)), _ExecuteResult(None)],
    )

    with pytest.raises(HTTPException) as exc:
        await activities_router.get_activity(42, current_user=current_user, db=db)

    assert exc.value.status_code == 403


def test_parse_gpx_extracts_distance_duration_speed_and_hr(tmp_path):
    gpx_content = """<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<gpx version=\"1.1\" creator=\"pytest\" xmlns=\"http://www.topografix.com/GPX/1/1\" xmlns:gpxtpx=\"http://www.garmin.com/xmlschemas/TrackPointExtension/v1\">
  <trk>
    <name>Test Run</name>
    <trkseg>
      <trkpt lat=\"54.687157\" lon=\"25.279652\">
        <ele>110.0</ele>
        <time>2026-03-06T10:00:00Z</time>
        <extensions>
          <gpxtpx:TrackPointExtension>
            <gpxtpx:hr>150</gpxtpx:hr>
            <gpxtpx:cad>82</gpxtpx:cad>
            <power>205</power>
          </gpxtpx:TrackPointExtension>
        </extensions>
      </trkpt>
      <trkpt lat=\"54.696157\" lon=\"25.279652\">
        <ele>120.0</ele>
        <time>2026-03-06T10:05:00Z</time>
        <extensions>
          <gpxtpx:TrackPointExtension>
            <gpxtpx:hr>158</gpxtpx:hr>
            <gpxtpx:cad>86</gpxtpx:cad>
            <power>220</power>
          </gpxtpx:TrackPointExtension>
        </extensions>
      </trkpt>
    </trkseg>
  </trk>
</gpx>
"""

    gpx_path = tmp_path / "sample.gpx"
    gpx_path.write_text(gpx_content, encoding="utf-8")

    parsed = parse_gpx(str(gpx_path))

    assert parsed is not None
    summary = parsed["summary"]
    assert summary["distance"] is not None and summary["distance"] > 900
    assert summary["duration"] == 300
    assert summary["avg_speed"] is not None and summary["avg_speed"] > 0
    assert summary["average_hr"] is not None and summary["average_hr"] >= 150
    assert summary["max_hr"] == 158
    assert parsed["sport"] in {"running", "cycling", "unknown", "other"}
    assert isinstance(parsed["streams"], list)
    assert len(parsed["streams"]) == 2


def test_planned_comparison_derives_actual_splits_when_provider_splits_missing():
    comparison = activities_router._build_planned_comparison_payload(
        _comparison_workout(),
        _comparison_activity(),
        splits_metric=[],
        laps=[],
        profile=None,
        stats={},
    )

    assert comparison["summary"]["split_source"] == "planned_template"
    assert len(comparison["splits"]) == 3
    assert [round(row["actual"]["actual_duration_s"]) for row in comparison["splits"]] == [600, 900, 300]
    assert "auto-derived" in (comparison["summary"]["split_note"] or "")


def test_planned_comparison_replaces_mismatched_provider_splits_with_template_extraction():
    # Provider splits count must differ from planned steps by more than 5 to trigger template derivation.
    # Planned workout has 3 steps; pass 9 provider splits so delta = 6 > 5.
    many_provider_splits = [
        {"duration": 200, "distance": 400, "avg_hr": 148 + i}
        for i in range(9)
    ]
    comparison = activities_router._build_planned_comparison_payload(
        _comparison_workout(),
        _comparison_activity(),
        splits_metric=many_provider_splits,
        laps=[],
        profile=None,
        stats={},
    )

    assert comparison["summary"]["split_source"] == "planned_template"
    assert len(comparison["splits"]) == 3
    assert comparison["splits"][1]["actual"]["avg_hr"] is not None


def test_activity_feedback_parses_legacy_lactate_payload():
    rpe, notes, lactate = activities_router._activity_feedback_from_payload(
        {"_meta": {"rpe": 7, "notes": "Felt controlled", "lactate_mmol_l": 3.2}}
    )

    assert rpe == 7
    assert notes == "Felt controlled"
    assert lactate == pytest.approx(3.2)


def test_apply_activity_to_bucket_clamps_hr_zone_to_available_keys():
    # Five HR upper bounds can produce an index of 6 for values above the top bound.
    # The accumulation code should clamp to the highest available HR bucket (Z5), not crash.
    profile = Profile(
        user_id=3,
        sports={
            "zone_settings": {
                "cycling": {
                    "hr": {
                        "upper_bounds": [100, 120, 140, 160, 180],
                    }
                }
            }
        },
    )
    activity = Activity(
        id=301,
        athlete_id=3,
        filename="edge-case.fit",
        file_path="uploads/edge-case.fit",
        file_type="fit",
        created_at=datetime.utcnow(),
        sport="cycling",
        duration=120,
        distance=1000,
        streams={
            "data": [
                {"heart_rate": 170, "power": 180},
                {"heart_rate": 185, "power": 182},
            ],
            "stats": {},
        },
    )
    bucket = activities_router._empty_bucket()

    activities_router._apply_activity_to_bucket(
        bucket,
        activity,
        ftp=250,
        max_hr=190,
        profile=profile,
    )

    hr_zones = bucket["sports"]["cycling"]["zone_seconds_by_metric"]["hr"]
    assert "Z6" not in hr_zones
    assert hr_zones["Z5"] > 0


def test_safe_number_and_extract_profile_zone_settings_helpers():
    assert activities_router._safe_number("12.5") == pytest.approx(12.5)
    assert activities_router._safe_number("not-a-number", default=7.0) == pytest.approx(7.0)
    assert activities_router._safe_number(float("nan"), default=3.0) == pytest.approx(3.0)

    profile = Profile(
        user_id=7,
        sports={
            "zone_settings": {
                "running": {
                    "pace": {"upper_bounds": [4.5, 5.0, 5.5]},
                }
            }
        },
    )

    assert activities_router._extract_profile_zone_settings(profile) == profile.sports["zone_settings"]
    assert activities_router._extract_profile_zone_settings(Profile(user_id=8, sports=[])) == {}
    assert activities_router._extract_profile_zone_settings(None) == {}


def test_metric_upper_bounds_prefers_valid_custom_values_and_threshold_fallbacks():
    running_profile = Profile(
        user_id=9,
        sports={
            "zone_settings": {
                "running": {
                    "pace": {"upper_bounds": [270, 300, 330]},
                }
            }
        },
    )
    fallback = [1.0, 2.0, 3.0]

    assert activities_router._metric_upper_bounds(
        running_profile,
        sport="running",
        metric="pace",
        fallback_bounds=fallback,
    ) == [4.5, 5.0, 5.5]

    invalid_profile = Profile(
        user_id=10,
        sports={
            "zone_settings": {
                "running": {
                    "pace": {"upper_bounds": [25, 30]},
                }
            }
        },
    )
    assert activities_router._metric_upper_bounds(
        invalid_profile,
        sport="running",
        metric="pace",
        fallback_bounds=fallback,
    ) == fallback

    threshold_profile = Profile(
        user_id=11,
        sports={
            "zone_settings": {
                "cycling": {
                    "power": {"lt1": 200, "lt2": 250},
                    "hr": {"lt1": 140, "lt2": 170},
                }
            }
        },
    )

    assert activities_router._metric_upper_bounds(
        threshold_profile,
        sport="cycling",
        metric="power",
        fallback_bounds=fallback,
    ) == [160.0, 200.0, 225.0, 250.0, 280.0, 337.5]
    assert activities_router._metric_upper_bounds(
        threshold_profile,
        sport="cycling",
        metric="hr",
        fallback_bounds=fallback,
    ) == [126.0, 140.0, 155.0, 170.0]


def test_normalize_utc_iso_and_activity_time_fields_normalize_strings():
    naive = datetime(2026, 1, 1, 10, 0, 0)
    aware = datetime(2026, 1, 1, 10, 0, 0, tzinfo=timezone.utc)

    assert activities_router._normalize_utc_iso(naive) == "2026-01-01T10:00:00Z"
    assert activities_router._normalize_utc_iso(aware) == "2026-01-01T10:00:00Z"
    assert activities_router._normalize_utc_iso("2026-01-01T12:00:00+02:00") == "2026-01-01T10:00:00Z"
    assert activities_router._normalize_utc_iso("bad-value") is None

    stored = {
        "data": [{"timestamp": "2026-01-01T10:00:00"}],
        "laps": [{"start_time": "2026-01-01T10:05:00"}],
    }
    normalized, changed = activities_router._normalize_activity_time_fields(stored)

    assert changed is True
    assert normalized["data"][0]["timestamp"] == "2026-01-01T10:00:00Z"
    assert normalized["laps"][0]["start_time"] == "2026-01-01T10:05:00Z"

    _, changed_again = activities_router._normalize_activity_time_fields(normalized)
    assert changed_again is False


def test_flatten_planned_time_steps_and_split_extraction_helpers():
    structure = [
        {
            "type": "block",
            "category": "work",
            "duration": {"type": "time", "value": 300},
            "target": {"type": "power", "metric": "percent_ftp", "zone": 3, "value": 85, "unit": "%"},
        },
        {
            "type": "repeat",
            "repeats": 2,
            "steps": [
                {
                    "type": "block",
                    "category": "recovery",
                    "duration": {"type": "time", "value": 60},
                    "target": {"type": "power", "zone": 1},
                }
            ],
        },
        {"type": "block", "duration": {"type": "distance", "value": 1000}},
    ]

    flattened = activities_router._flatten_planned_time_steps(structure)

    assert len(flattened) == 3
    assert flattened[0]["planned_duration_s"] == pytest.approx(300.0)
    assert flattened[1]["category"] == "recovery"
    assert flattened[2]["planned_duration_s"] == pytest.approx(60.0)

    rows = activities_router._extract_actual_split_rows(
        [{"duration": 100, "avg_hr": 150}],
        [{"elapsed_time": 120, "average_heartrate": 155, "average_watts": 210, "average_speed": 3.8, "distance": 500}],
    )

    assert rows == [
        {
            "split": 1,
            "actual_duration_s": 120.0,
            "distance_m": 500.0,
            "avg_hr": 155,
            "avg_power": 210,
            "avg_speed": 3.8,
        }
    ]

    parsed = activities_router._parse_stream_timestamp("2026-01-01T10:00:00Z")
    assert parsed is not None
    assert parsed.tzinfo == timezone.utc
    assert activities_router._parse_stream_timestamp(123) is None


def test_compute_normalized_power_helpers_cover_stats_curve_and_sample_fallbacks():
    assert activities_router._compute_normalized_power_watts_from_payload({"stats": {"normalized_power": 250}}) == pytest.approx(250.0)
    assert activities_router._compute_normalized_power_watts_from_payload({"power_curve": {"normalized_power": 260}}) == pytest.approx(260.0)
    assert activities_router._compute_normalized_power_watts_from_payload(
        {"data": [{"power": 200}, {"power": 220}, {"power": 210}]}
    ) == pytest.approx(210.0)
    assert activities_router._compute_normalized_power_watts_from_payload(
        {"data": [{"power": 200} for _ in range(35)]}
    ) == pytest.approx(200.0)
    assert activities_router._compute_normalized_power_watts_from_payload({"data": []}) is None


def test_workout_target_zone_steady_state_and_range_match_helpers():
    assert activities_router._range_match_pct(None, 100, 120, 10) is None
    assert activities_router._range_match_pct(110, 100, 120, 10) == pytest.approx(100.0)
    assert activities_router._range_match_pct(130, 100, 120, 20) == pytest.approx(50.0)

    steady_workout = PlannedWorkout(
        title="Tempo",
        sport_type="Running",
        planned_duration=45,
        planned_intensity="",
        structure=[
            {"type": "block", "category": "warmup", "target": {"zone": 1}},
            {
                "type": "repeat",
                "repeats": 2,
                "steps": [
                    {"type": "block", "category": "work", "target": {"zone": 3}},
                    {"type": "block", "category": "recovery", "target": {"zone": 1}},
                ],
            },
        ],
    )
    mixed_workout = PlannedWorkout(
        title="Mixed",
        sport_type="Running",
        planned_duration=45,
        planned_intensity="",
        structure=[
            {"type": "block", "category": "work", "target": {"zone": 3}},
            {"type": "block", "category": "work", "target": {"zone": 4}},
        ],
    )

    assert activities_router._workout_target_zone(steady_workout) == 3
    assert activities_router._is_steady_zone_workout(steady_workout) is True
    assert activities_router._is_steady_zone_workout(mixed_workout) is False


@pytest.mark.parametrize(
    ("tsb", "ctl", "expected"),
    [
        (0, 4, "Detraining"),
        (16, 10, "Fresh"),
        (6, 10, "Productive"),
        (-5, 10, "Maintaining"),
        (-20, 10, "Fatigued"),
        (-30, 10, "Strained"),
    ],
)
def test_resolve_training_status_branches(tsb, ctl, expected):
    assert activities_router._resolve_training_status(tsb, ctl) == expected


def test_compute_load_meta_and_estimate_helpers():
    aerobic, anaerobic = activities_router._compute_load_from_zone_minutes(
        {"Z1": 10.0},
        zone_weights={"Z1": 1.0},
        aerobic_fraction={"Z1": 1.0},
    )
    assert aerobic == pytest.approx(10.0)
    assert anaerobic == pytest.approx(0.1)

    assert activities_router._load_from_meta_dict({"aerobic_load": "5.44", "anaerobic_load": "1.06"}) == (5.4, 1.1)
    assert activities_router._load_from_meta_dict({"aerobic_load": -1, "anaerobic_load": 2}) is None

    cached_activity = Activity(
        id=401,
        athlete_id=3,
        filename="cached.fit",
        file_path="uploads/cached.fit",
        file_type="fit",
        created_at=datetime(2026, 4, 1, 7, 0, 0),
        sport="cycling",
        streams={"_meta": {"aerobic_load": 8.24, "anaerobic_load": 3.18}},
    )
    assert activities_router._cached_activity_load_from_meta(cached_activity) == (8.2, 3.2)

    profile = Profile(user_id=12, resting_hr=50)
    cycling_activity = Activity(
        id=402,
        athlete_id=3,
        filename="cycling.fit",
        file_path="uploads/cycling.fit",
        file_type="fit",
        created_at=datetime(2026, 4, 1, 7, 0, 0),
        sport="cycling",
        duration=3600,
        average_watts=250,
    )
    assert activities_router._estimate_load_from_activity_summary(
        cycling_activity,
        sport="cycling",
        ftp=250,
        max_hr=190,
        profile=profile,
    ) == (61.5, 38.5)

    fallback_activity = Activity(
        id=403,
        athlete_id=3,
        filename="swim.fit",
        file_path="uploads/swim.fit",
        file_type="fit",
        created_at=datetime(2026, 4, 1, 7, 0, 0),
        sport="swimming",
        duration=3600,
    )
    assert activities_router._estimate_load_from_activity_summary(
        fallback_activity,
        sport="swimming",
        ftp=0,
        max_hr=0,
        profile=profile,
    ) == (38.6, 3.4)


def test_activity_list_load_training_load_and_zone_summary_helpers(monkeypatch):
    activity = Activity(
        id=404,
        athlete_id=3,
        filename="run.fit",
        file_path="uploads/run.fit",
        file_type="fit",
        created_at=datetime(2026, 4, 1, 7, 0, 0),
        sport="running",
        duration=600,
        distance=2000,
        avg_speed=3.5,
        average_hr=155,
        streams={
            "data": [
                {"heart_rate": 150, "speed": 3.4},
                {"heart_rate": 160, "speed": 3.6},
                {"heart_rate": 158, "speed": 3.5},
            ],
            "stats": {},
        },
    )
    profile = Profile(user_id=13, resting_hr=50, max_hr=190, lt2=5.0)

    training_load = activities_router._activity_training_load(activity, ftp=0, max_hr=190, profile=profile)
    assert training_load[0] > 0
    assert training_load[1] > 0

    summary = activities_router._build_activity_zone_summary(activity, ftp=0, max_hr=190, profile=profile)
    assert summary is not None
    assert summary["sport"] == "running"
    assert summary["duration_minutes"] == pytest.approx(10.0)
    assert summary["distance_km"] == pytest.approx(2.0)
    assert sum(summary["zone_seconds_by_metric"]["hr"].values()) > 0

    rounded_bucket = activities_router._round_bucket(
        {
            "activities_count": 1,
            "total_duration_minutes": 10.04,
            "total_distance_km": 2.04,
            "sports": {
                "running": {
                    "activities_count": 1,
                    "total_duration_minutes": 10.04,
                    "total_distance_km": 2.04,
                    "zone_seconds": {f"Z{i}": 0 for i in range(1, 6)},
                    "zone_seconds_by_metric": {"hr": {f"Z{i}": 0 for i in range(1, 6)}, "pace": {f"Z{i}": 0 for i in range(1, 8)}},
                },
                "cycling": {
                    "activities_count": 0,
                    "total_duration_minutes": 0.04,
                    "total_distance_km": 0.04,
                    "zone_seconds": {f"Z{i}": 0 for i in range(1, 8)},
                    "zone_seconds_by_metric": {"hr": {f"Z{i}": 0 for i in range(1, 6)}, "power": {f"Z{i}": 0 for i in range(1, 8)}},
                },
            },
        }
    )
    assert rounded_bucket["total_duration_minutes"] == pytest.approx(10.0)
    assert rounded_bucket["sports"]["running"]["total_distance_km"] == pytest.approx(2.0)

    cached_activity = Activity(
        id=405,
        athlete_id=3,
        filename="cached.fit",
        file_path="uploads/cached.fit",
        file_type="fit",
        created_at=datetime(2026, 4, 1, 7, 0, 0),
        sport="cycling",
        duration=600,
        streams={"_meta": {"aerobic_load": 4.2, "anaerobic_load": 1.8}},
    )
    assert activities_router._activity_list_load(cached_activity, ftp=250, max_hr=190, profile=profile) == (4.2, 1.8)

    monkeypatch.setattr(activities_router, "_estimate_load_from_activity_summary", lambda *args, **kwargs: None)
    monkeypatch.setattr(activities_router, "_activity_training_load", lambda *args, **kwargs: (1.2, 0.8))

    no_cache_activity = Activity(
        id=406,
        athlete_id=3,
        filename="fallback.fit",
        file_path="uploads/fallback.fit",
        file_type="fit",
        created_at=datetime(2026, 4, 1, 7, 0, 0),
        sport="cycling",
        duration=600,
        streams={},
    )
    assert activities_router._activity_list_load(no_cache_activity, ftp=0, max_hr=0, profile=profile) == (1.2, 0.8)

    other_sport = Activity(
        id=407,
        athlete_id=3,
        filename="swim.fit",
        file_path="uploads/swim.fit",
        file_type="fit",
        created_at=datetime(2026, 4, 1, 7, 0, 0),
        sport="swimming",
        duration=600,
        streams={"data": [{"heart_rate": 150}, {"heart_rate": 160}, {"heart_rate": 170}]},
    )
    other_load = activities_router._activity_training_load(other_sport, ftp=0, max_hr=190, profile=profile)
    assert other_load[0] > other_load[1] > 0

    assert activities_router._build_activity_zone_summary(
        Activity(
            id=408,
            athlete_id=3,
            filename="yoga.fit",
            file_path="uploads/yoga.fit",
            file_type="fit",
            created_at=datetime(2026, 4, 1, 7, 0, 0),
            sport="yoga",
        ),
        ftp=0,
        max_hr=0,
        profile=profile,
    ) is None
