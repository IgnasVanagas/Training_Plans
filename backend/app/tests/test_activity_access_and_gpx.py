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
