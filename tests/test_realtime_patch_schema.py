import pytest

from web.realtime_patch_schema import (
    PatchValidationError,
    normalize_observation_patch,
)


def test_legacy_temperature_patch_normalizes_to_v1_with_runway_points():
    event = normalize_observation_patch(
        {
            "city": " Seoul ",
            "changes": {
                "temp": "31.25",
                "max_so_far": 32.1,
                "obs_time": "2026-05-26T08:15:00Z",
                "source": "amos",
                "amos": {
                    "icao": "RKSS",
                    "station_label": "Gimpo Airport",
                    "runway_obs": {
                        "point_temperatures": [
                            {
                                "runway": "14L/32R",
                                "tdz_temp": 31.2,
                                "mid_temp": 31.6,
                                "end_temp": 31.8,
                                "target_runway_max": 31.8,
                            }
                        ]
                    },
                },
            },
        }
    )

    assert event["type"] == "city_observation_patch.v1"
    assert event["schema_type"] == "city_observation_patch"
    assert event["schema_version"] == 1
    assert event["city"] == "seoul"
    assert event["source"] == "amos"
    assert event["obs_time"] == "2026-05-26T08:15:00Z"
    assert event["payload"]["temp"] == 31.25
    assert event["payload"]["max_so_far"] == 32.1
    assert event["payload"]["station_code"] == "RKSS"
    assert event["payload"]["station_label"] == "Gimpo Airport"
    assert event["payload"]["unit"] == "celsius"
    assert event["payload"]["runway_points"] == [
        {
            "runway": "14L/32R",
            "temp": 31.8,
            "tdz_temp": 31.2,
            "mid_temp": 31.6,
            "end_temp": 31.8,
            "target_runway_max": 31.8,
        }
    ]


def test_v1_patch_payload_is_accepted_and_normalized():
    event = normalize_observation_patch(
        {
            "type": "city_observation_patch.v1",
            "city": "Taipei",
            "source": "cwa",
            "obs_time": "2026-05-26T07:01:00Z",
            "payload": {
                "temp": 29.4,
                "station_code": "46692",
                "runway_points": [{"runway": "05/23", "temp": 30.2}],
            },
        }
    )

    assert event["city"] == "taipei"
    assert event["source"] == "cwa"
    assert event["payload"]["temp"] == 29.4
    assert event["payload"]["runway_points"][0]["temp"] == 30.2


def test_patch_adds_city_local_time_contract_from_observation_time():
    event = normalize_observation_patch(
        {
            "type": "city_observation_patch.v1",
            "city": "Toronto",
            "source": "metar",
            "obs_time": "2026-05-27T23:16:00Z",
            "payload": {
                "temp": 26,
                "station_code": "CYYZ",
            },
        }
    )

    assert event["obs_time"] == "2026-05-27T23:16:00Z"
    assert event["observed_at_utc"] == "2026-05-27T23:16:00Z"
    assert event["observed_at_local"] == "2026-05-27T19:16:00-04:00"
    assert event["city_local_date"] == "2026-05-27"
    assert event["city_timezone"] == "America/Toronto"
    assert event["city_utc_offset_seconds"] == -4 * 60 * 60
    assert event["source_cadence_sec"] == 1800
    assert event["payload"]["observed_at_utc"] == "2026-05-27T23:16:00Z"
    assert event["payload"]["observed_at_local"] == "2026-05-27T19:16:00-04:00"


def test_invalid_patch_without_city_or_observation_data_is_rejected():
    with pytest.raises(PatchValidationError):
        normalize_observation_patch({"changes": {"temp": 21.0}})

    with pytest.raises(PatchValidationError):
        normalize_observation_patch({"city": "taipei", "changes": {"source": "metar"}})
