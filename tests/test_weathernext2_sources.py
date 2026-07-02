from datetime import datetime, timezone
import json

from src.data_collection.weather_sources import WeatherDataCollector
from src.data_collection.weathernext2_fetcher import (
    extract_member_hourly_from_grid_dataset,
    normalize_temperature_value,
    open_weathernext2_zarr_dataset,
    select_temperature_variable,
)
from src.data_collection.weathernext2_sources import (
    build_city_local_daily_highs_from_hourly,
    build_weathernext2_city_probability,
    market_bucket_for_temperature,
    summarize_member_highs,
)


def test_market_bucket_for_temperature_uses_single_celsius_options():
    bucket = market_bucket_for_temperature(32.6, "°C")

    assert bucket["label"] == "33°C"
    assert bucket["lower"] == 32.5
    assert bucket["upper"] == 33.5


def test_market_bucket_for_temperature_groups_fahrenheit_by_two_degree_market_option():
    assert market_bucket_for_temperature(94.2, "°F")["label"] == "94-95°F"
    assert market_bucket_for_temperature(95.4, "°F")["label"] == "94-95°F"
    assert market_bucket_for_temperature(96.1, "°F")["label"] == "96-97°F"


def test_weathernext2_probability_aggregates_member_highs_to_market_buckets():
    probability = build_weathernext2_city_probability(
        city="Houston",
        member_highs={
            "member_00": 94.1,
            "member_01": 94.8,
            "member_02": 95.2,
            "member_03": 96.7,
        },
        temp_symbol="°F",
        target_date="2026-06-29",
        source_run="2026-06-29T00:00:00Z",
    )

    assert probability["source"] == "weathernext2"
    assert probability["members"] == 4
    assert probability["top_bucket"]["label"] == "94-95°F"
    assert probability["top_bucket"]["probability"] == 0.75
    assert probability["buckets"] == [
        {
            "key": "94-95°F",
            "label": "94-95°F",
            "lower": 93.5,
            "upper": 95.5,
            "value": 94.7,
            "probability": 0.75,
            "member_count": 3,
            "total_members": 4,
        },
        {
            "key": "96-97°F",
            "label": "96-97°F",
            "lower": 95.5,
            "upper": 97.5,
            "value": 96.7,
            "probability": 0.25,
            "member_count": 1,
            "total_members": 4,
        },
    ]


def test_weathernext2_probability_keeps_celsius_market_option_labels():
    probability = build_weathernext2_city_probability(
        city="Shanghai",
        member_highs=[31.6, 32.2, 32.8, 33.1],
        temp_symbol="°C",
        target_date="2026-06-29",
    )

    labels = [bucket["label"] for bucket in probability["buckets"]]

    assert labels == ["32°C", "33°C"]
    assert probability["top_bucket"]["label"] == "33°C"
    assert probability["top_bucket"]["probability"] == 0.5


def test_city_local_daily_highs_from_hourly_uses_target_local_date():
    highs = build_city_local_daily_highs_from_hourly(
        member_hourly={
            "member_00": [21.0, 26.0, 28.0, 24.0],
            "member_01": [20.0, 25.0, None, 27.0],
        },
        utc_times=[
            datetime(2026, 6, 28, 15, tzinfo=timezone.utc),  # local 2026-06-28 23:00
            datetime(2026, 6, 28, 16, tzinfo=timezone.utc),  # local 2026-06-29 00:00
            datetime(2026, 6, 29, 6, tzinfo=timezone.utc),  # local 2026-06-29 14:00
            datetime(2026, 6, 29, 16, tzinfo=timezone.utc),  # local 2026-06-30 00:00
        ],
        timezone_offset_seconds=8 * 3600,
        target_local_date="2026-06-29",
    )

    assert highs == {"member_00": 28.0, "member_01": 25.0}


def test_summarize_member_highs_reports_ensemble_shape():
    summary = summarize_member_highs([30, 32, 34, 36, 38])

    assert summary == {
        "members": 5,
        "mean": 34.0,
        "median": 34.0,
        "p10": 30.8,
        "p25": 32.0,
        "p75": 36.0,
        "p90": 37.2,
        "min": 30.0,
        "max": 38.0,
        "spread": 8.0,
    }


def test_collector_reads_weathernext2_fixture_when_enabled(monkeypatch, tmp_path):
    fixture_path = tmp_path / "weathernext2.json"
    fixture_path.write_text(
        json.dumps(
            {
                "houston": {
                    "target_date": "2026-06-29",
                    "source_run": "2026-06-29T00:00:00Z",
                    "member_highs": [94.1, 94.8, 95.2, 96.7],
                }
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("WEATHERNEXT2_ENABLED", "1")
    monkeypatch.setenv("WEATHERNEXT2_FIXTURE_PATH", str(fixture_path))

    collector = WeatherDataCollector({})

    payload = collector.fetch_weathernext2_probability(
        "Houston",
        lat=29.7604,
        lon=-95.3698,
        use_fahrenheit=True,
        target_date="2026-06-29",
        timezone_offset_seconds=-5 * 3600,
    )

    assert payload["source"] == "weathernext2"
    assert payload["top_bucket"]["label"] == "94-95°F"
    assert payload["buckets"][0]["probability"] == 0.75


def test_collector_reads_weathernext2_worker_artifact_before_fixture(monkeypatch, tmp_path):
    artifact_path = tmp_path / "weathernext2_city_highs.json"
    fixture_path = tmp_path / "fixture.json"
    artifact_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "cities": {
                    "houston": {
                        "target_date": "2026-06-29",
                        "source_run": "2026-06-29T00:00:00Z",
                        "member_highs": [94.1, 94.8, 95.2, 96.7],
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    fixture_path.write_text(
        json.dumps({"houston": {"member_highs": [80.0, 80.2]}}),
        encoding="utf-8",
    )
    monkeypatch.setenv("WEATHERNEXT2_ENABLED", "1")
    monkeypatch.setenv("WEATHERNEXT2_CITY_HIGHS_PATH", str(artifact_path))
    monkeypatch.setenv("WEATHERNEXT2_FIXTURE_PATH", str(fixture_path))
    monkeypatch.setenv("WEATHERNEXT2_MODEL_DIR", str(tmp_path / "missing-model"))

    collector = WeatherDataCollector({})

    payload = collector.fetch_weathernext2_probability(
        "Houston",
        lat=29.7604,
        lon=-95.3698,
        use_fahrenheit=True,
        target_date="2026-06-29",
        timezone_offset_seconds=-5 * 3600,
    )

    assert payload["source"] == "weathernext2"
    assert payload["top_bucket"]["label"] == "94-95°F"
    assert payload["buckets"][0]["probability"] == 0.75


def test_weathernext2_grid_extractor_selects_temp_var_nearest_point_and_converts_kelvin():
    dataset = {
        "lat": [10.0, 20.0],
        "lon": [30.0, 40.0],
        "member": [0, 1],
        "time": [
            "2026-06-29T00:00:00Z",
            "2026-06-29T06:00:00Z",
            "2026-06-29T12:00:00Z",
        ],
        "temperature_2m": [
            [
                [[290.0, 291.0], [292.0, 293.0]],
                [[294.0, 295.0], [296.0, 297.0]],
                [[298.0, 299.0], [300.0, 301.0]],
            ],
            [
                [[289.0, 290.0], [291.0, 292.0]],
                [[293.0, 294.0], [295.0, 296.0]],
                [[297.0, 298.0], [299.0, 300.0]],
            ],
        ],
        "units": {"temperature_2m": "K"},
    }

    assert select_temperature_variable(dataset) == "temperature_2m"
    assert normalize_temperature_value(300.15, "K") == 27.0

    extracted = extract_member_hourly_from_grid_dataset(
        dataset,
        lat=18.0,
        lon=38.0,
    )

    assert extracted["temp_var"] == "temperature_2m"
    assert extracted["nearest_lat"] == 20.0
    assert extracted["nearest_lon"] == 40.0
    assert extracted["member_hourly"]["member_00"] == [19.9, 23.9, 27.9]
    assert extracted["member_hourly"]["member_01"] == [18.9, 22.9, 26.9]


def test_weathernext2_zarr_uses_google_default_credentials(monkeypatch):
    calls = []

    class FakeXarray:
        @staticmethod
        def open_zarr(uri, **kwargs):
            calls.append((uri, kwargs))
            return {"ok": True}

    import src.data_collection.weathernext2_fetcher as fetcher

    monkeypatch.setattr(fetcher, "xr", FakeXarray, raising=False)
    monkeypatch.setitem(__import__("sys").modules, "xarray", FakeXarray)
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", "/app/secrets/gcp-sa.json")

    assert open_weathernext2_zarr_dataset("gs://weathernext/example") == {"ok": True}
    assert calls[0][1]["storage_options"]["token"] == "google_default"
