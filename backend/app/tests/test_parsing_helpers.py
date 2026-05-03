from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
import xml.etree.ElementTree as ET

import pandas as pd
import pytest

from app import parsing


def test_numeric_curve_and_gpx_metric_helpers(monkeypatch):
    assert parsing.safe_float("12.5") == pytest.approx(12.5)
    assert parsing.safe_float(float("nan")) is None
    assert parsing.safe_float(float("inf")) is None

    assert parsing._cycling_efforts_from_power_curve({"5s": 600.4, "1min": 320})
    assert parsing._cycling_efforts_from_power_curve(None) is None

    monkeypatch.setattr(parsing, "compute_activity_best_efforts", lambda streams, sport: [])
    cycling_efforts = parsing._compute_best_efforts([], "cycling", {"5s": 500})
    assert cycling_efforts is not None
    assert cycling_efforts[0]["power"] == 500

    monkeypatch.setattr(parsing, "compute_activity_best_efforts", lambda streams, sport: [{"window": "1s"}])
    assert parsing._compute_best_efforts([], "running") == [{"window": "1s"}]

    df = pd.DataFrame(
        {
            "timestamp": pd.to_datetime(
                [
                    "2026-03-10T10:00:00Z",
                    "2026-03-10T10:00:01Z",
                    "2026-03-10T10:00:02Z",
                ],
                utc=True,
            ),
            "speed": [3.0, 3.2, 3.4],
            "power": [210, 220, 230],
            "heart_rate": [120, 150, 185],
            "cadence": [170, 172, 174],
            "vertical_oscillation": [8.0, 8.1, 8.2],
            "altitude": [100.0, 101.5, 101.0],
        }
    )

    curve = parsing.calculate_curve(df, "speed")
    assert curve is not None
    assert curve["1s"] == pytest.approx(3.4)
    assert parsing.calculate_power_curve(df)["1s"] == 230
    assert parsing.calculate_pace_curve(df)["1s"] == pytest.approx(3.4)
    assert parsing.calculate_hr_zones(df, max_hr=200) == {"Z1": 0, "Z2": 1, "Z3": 1, "Z4": 0, "Z5": 1}

    cleaned = parsing.clean_streams(pd.DataFrame({"value": [1.0, None, float("inf")]}))
    assert cleaned == [{"value": 1.0}, {"value": None}, {"value": None}]

    with_distance = parsing._ensure_distance_column(df[["timestamp", "speed"]])
    assert with_distance["distance"].iloc[-1] > with_distance["distance"].iloc[0]
    assert parsing.infer_sport(df) == "running"
    assert parsing.normalize_fit_sport("e_biking", df) == "cycling"
    assert parsing.normalize_fit_sport("generic", df) == "running"
    assert parsing._haversine_distance_m(54.0, 25.0, 54.0001, 25.0001) > 0
    assert parsing._strip_xml_namespace("{urn:test}hr") == "hr"

    extension = ET.fromstring(
        "<ext xmlns:tp='urn:test'><tp:TrackPointExtension><tp:hr>150</tp:hr><cad>172</cad><power>240</power></tp:TrackPointExtension></ext>"
    )
    point = SimpleNamespace(extensions=[extension])
    assert parsing._extract_gpx_extension_metrics(point) == {"heart_rate": 150.0, "cadence": 172.0, "power": 240.0}


def test_metric_split_helpers_cover_points_and_dataframe_paths():
    points = [
        {"distance": 0, "heart_rate": 140, "power": 200},
        {"distance": 600, "heart_rate": 145, "power": 210},
        {"distance": 1100, "heart_rate": 150, "power": 220},
        {"distance": 1700, "heart_rate": 155, "power": 230},
        {"distance": 2100, "heart_rate": 160, "power": 240},
    ]
    point_splits = parsing.compute_metric_splits_from_points(points, interval=1000)

    assert len(point_splits) == 2
    assert point_splits[0]["distance"] == pytest.approx(1100.0)
    assert point_splits[0]["avg_hr"] == pytest.approx(145.0)
    assert point_splits[1]["avg_power"] == pytest.approx(230.0)

    df = pd.DataFrame(
        {
            "timestamp": pd.to_datetime(
                [
                    "2026-03-10T10:00:00Z",
                    "2026-03-10T10:04:00Z",
                    "2026-03-10T10:08:00Z",
                    "2026-03-10T10:12:00Z",
                ],
                utc=True,
            ),
            "distance": [0, 1000, 2000, 2900],
            "heart_rate": [140, 145, 150, 155],
            "power": [200, 210, 220, 230],
        }
    )
    df_splits = parsing.calculate_metric_splits(df, interval=1000)

    assert len(df_splits) == 1
    assert df_splits[0]["distance"] == pytest.approx(900.0)
    assert df_splits[0]["avg_hr"] == pytest.approx(152.5)
    assert df_splits[0]["avg_power"] == pytest.approx(225.0)


def test_parse_fit_decode_builds_summary_laps_and_streams(monkeypatch):
    class FakeFitDataMessage:
        def __init__(self, name, values):
            self.name = name
            self._values = values

        def has_field(self, key):
            return key in self._values and self._values[key] is not None

        def get_value(self, key, fallback=None):
            return self._values.get(key, fallback)

    class FakeFitReader:
        def __init__(self, _file_path):
            timestamp = datetime(2026, 3, 10, 10, 0, 0, tzinfo=timezone.utc)
            self.frames = [
                FakeFitDataMessage(
                    "session",
                    {
                        "sport": "generic",
                        "start_time": timestamp,
                        "total_ascent": 25,
                        "total_calories": 400,
                        "avg_cadence": 172,
                        "max_cadence": 176,
                        "max_heart_rate": 165,
                        "max_speed": 3.5,
                        "max_power": 8,
                        "avg_speed": 3.2,
                        "total_distance": 1200,
                        "total_elapsed_time": 360,
                        "total_timer_time": 350,
                        "avg_power": 6,
                        "avg_heart_rate": 152,
                    },
                ),
                FakeFitDataMessage(
                    "lap",
                    {
                        "start_time": timestamp,
                        "total_elapsed_time": 300,
                        "total_distance": 1000,
                        "avg_speed": 3.3,
                        "avg_heart_rate": 150,
                        "max_heart_rate": 160,
                        "avg_power": 6,
                    },
                ),
                FakeFitDataMessage(
                    "record",
                    {
                        "timestamp": timestamp,
                        "distance": 0,
                        "enhanced_speed": 3.1,
                        "heart_rate": 148,
                        "power": 5,
                        "cadence": 170,
                        "enhanced_altitude": 100.0,
                        "vertical_oscillation": 8.0,
                    },
                ),
                FakeFitDataMessage(
                    "record",
                    {
                        "timestamp": timestamp.replace(second=10),
                        "distance": 600,
                        "enhanced_speed": 3.2,
                        "heart_rate": 152,
                        "power": 6,
                        "cadence": 172,
                        "enhanced_altitude": 105.0,
                        "vertical_oscillation": 8.1,
                    },
                ),
                FakeFitDataMessage(
                    "record",
                    {
                        "timestamp": timestamp.replace(second=20),
                        "distance": 1200,
                        "enhanced_speed": 3.3,
                        "heart_rate": 156,
                        "power": 7,
                        "cadence": 174,
                        "enhanced_altitude": 103.0,
                        "vertical_oscillation": 8.2,
                    },
                ),
            ]

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return None

        def __iter__(self):
            return iter(self.frames)

    monkeypatch.setattr(parsing.fitdecode, "FitDataMessage", FakeFitDataMessage)
    monkeypatch.setattr(parsing.fitdecode, "FitReader", FakeFitReader)
    monkeypatch.setattr(parsing, "compute_activity_best_efforts", lambda streams, sport: [{"window": "1s"}])

    parsed = parsing.parse_fit_decode("dummy.fit")

    assert parsed is not None
    assert parsed["sport"] == "running"
    assert parsed["summary"]["distance"] == pytest.approx(1200.0)
    assert parsed["summary"]["total_timer_time"] == pytest.approx(350.0)
    assert parsed["power_curve"] is None
    assert parsed["best_efforts"] == [{"window": "1s"}]
    assert parsed["laps"][0]["start_time"] == "2026-03-10 10:00:00+00:00"
    assert parsed["streams"][0]["timestamp"] == "2026-03-10 10:00:00+00:00"
    assert parsed["start_time"] == datetime(2026, 3, 10, 10, 0, 0, tzinfo=timezone.utc)


def test_parse_fit_falls_back_to_fitparse(monkeypatch):
    class FakeField:
        def __init__(self, name, value):
            self.name = name
            self.value = value

    class FakeMessage:
        def __init__(self, name, values):
            self.name = name
            self._values = values

        def get_value(self, key):
            return self._values.get(key)

        def __iter__(self):
            return iter([FakeField(name, value) for name, value in self._values.items()])

    class FakeFitFile:
        def __init__(self, _file_path, check_crc=False):
            timestamp = datetime(2026, 3, 10, 10, 0, 0, tzinfo=timezone.utc)
            self._messages = iter(
                [
                    FakeMessage("session", {"sport": "e_biking", "start_time": timestamp}),
                    FakeMessage(
                        "record",
                        {
                            "timestamp": timestamp,
                            "enhanced_speed": 10.0,
                            "heart_rate": 130,
                            "power": 220,
                            "cadence": 90,
                            "enhanced_altitude": 100.0,
                        },
                    ),
                    FakeMessage(
                        "record",
                        {
                            "timestamp": timestamp.replace(second=1),
                            "enhanced_speed": 10.0,
                            "heart_rate": 132,
                            "power": 230,
                            "cadence": 92,
                            "enhanced_altitude": 105.0,
                        },
                    ),
                ]
            )

        def get_messages(self):
            return self._messages

    monkeypatch.setattr(parsing, "parse_fit_decode", lambda _path: (_ for _ in ()).throw(RuntimeError("boom")))
    monkeypatch.setattr(parsing.fitparse, "FitFile", FakeFitFile)
    monkeypatch.setattr(parsing, "compute_activity_best_efforts", lambda streams, sport: [{"window": "5s"}])

    parsed = parsing.parse_fit("fallback.fit")

    assert parsed is not None
    assert parsed["sport"] == "cycling"
    assert parsed["summary"]["distance"] == pytest.approx(20.0)
    assert parsed["summary"]["average_watts"] == pytest.approx(225.0)
    assert parsed["summary"]["total_elevation_gain"] == pytest.approx(5.0)
    assert parsed["best_efforts"] == [{"window": "5s"}]
    assert parsed["start_time"] == datetime(2026, 3, 10, 10, 0, 0, tzinfo=timezone.utc)


def test_parse_gpx_and_activity_dispatch(tmp_path: Path, monkeypatch):
    gpx_path = tmp_path / "sample.gpx"
    gpx_path.write_text(
        """
<gpx version="1.1" creator="pytest" xmlns="http://www.topografix.com/GPX/1/1" xmlns:tp="urn:test">
  <trk><name>Run</name><trkseg>
    <trkpt lat="54.0000" lon="25.0000">
      <ele>100</ele>
      <time>2026-03-10T10:00:00Z</time>
      <extensions><tp:TrackPointExtension><tp:hr>150</tp:hr><tp:cad>170</tp:cad><tp:power>210</tp:power></tp:TrackPointExtension></extensions>
    </trkpt>
    <trkpt lat="54.0002" lon="25.0002">
      <ele>110</ele>
      <time>2026-03-10T10:00:10Z</time>
      <extensions><tp:TrackPointExtension><tp:hr>160</tp:hr><tp:cad>172</tp:cad><tp:power>220</tp:power></tp:TrackPointExtension></extensions>
    </trkpt>
  </trkseg></trk>
</gpx>
        """.strip(),
        encoding="utf-8",
    )

    parsed_gpx = parsing.parse_gpx(str(gpx_path))

    assert parsed_gpx is not None
    assert parsed_gpx["sport"] == "running"
    assert parsed_gpx["summary"]["duration"] == pytest.approx(10.0)
    assert parsed_gpx["summary"]["average_hr"] == pytest.approx(155.0)
    assert parsed_gpx["summary"]["total_elevation_gain"] == pytest.approx(10.0)
    assert parsed_gpx["streams"][0]["timestamp"] == "2026-03-10 10:00:00+00:00"

    monkeypatch.setattr(parsing, "parse_fit", lambda path: {"kind": "fit", "path": path})
    monkeypatch.setattr(parsing, "parse_gpx", lambda path: {"kind": "gpx", "path": path})

    assert parsing.parse_activity_file("a.fit", "fit") == {"kind": "fit", "path": "a.fit"}
    assert parsing.parse_activity_file("a.gpx", "gpx") == {"kind": "gpx", "path": "a.gpx"}
    assert parsing.parse_activity_file("a.txt", "txt") is None