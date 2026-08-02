import pytest

from web.realtime_patch_schema import (
    PatchValidationError,
    normalize_observation_patch,
)


def test_legacy_temperature_patch_normalizes_to_v1():
    event = normalize_observation_patch(
        {
            "city": " Seoul ",
            "changes": {
                "temp": "31.25",
                "max_so_far": 32.1,
                "obs_time": "2026-05-26T08:15:00Z",
                "source": "metar",
                "station_code": "RKSS",
                "station_label": "Gimpo Airport",
            },
        }
    )

    assert event["type"] == "city_observation_patch.v1"
    assert event["schema_type"] == "city_observation_patch"
    assert event["schema_version"] == 1
    assert event["city"] == "seoul"
    assert event["source"] == "metar"
    assert event["obs_time"] == "2026-05-26T08:15:00Z"
    assert event["payload"]["temp"] == 31.25
    assert event["payload"]["max_so_far"] == 32.1
    assert event["payload"]["station_code"] == "RKSS"
    assert event["payload"]["station_label"] == "Gimpo Airport"
    assert event["payload"]["unit"] == "celsius"


def test_v1_patch_payload_is_accepted_and_normalized():
    event = normalize_observation_patch(
        {
            "type": "city_observation_patch.v1",
            "city": "Taipei",
            "source": "noaa",
            "obs_time": "2026-05-26T07:01:00Z",
            "payload": {
                "temp": 29.4,
                "max_so_far": 30.1,
                "signed_gap": 0.6,
                "gap_to_target": -0.6,
                "touch_distance": 0,
                "edge": 0.04,
                "edge_percent": 4.0,
                "station_code": "46692",
            },
        }
    )

    assert event["city"] == "taipei"
    assert event["source"] == "noaa"
    assert event["payload"]["temp"] == 29.4
    assert event["payload"]["max_so_far"] == 30.1
    assert event["payload"]["signed_gap"] == 0.6
    assert event["payload"]["gap_to_target"] == -0.6
    assert event["payload"]["touch_distance"] == 0
    assert event["payload"]["edge"] == 0.04
    assert event["payload"]["edge_percent"] == 4.0


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


def test_patch_records_received_time_and_latency_for_late_observation(monkeypatch):
    monkeypatch.setattr("web.realtime_patch_schema.time.time", lambda: 1780750864.062)

    event = normalize_observation_patch(
        {
            "city": "Busan",
            "changes": {
                "temp": 23.0,
                "obs_time": "2026-06-06T12:59:00Z",
                "source": "metar",
                "station_code": "RKPK",
            },
        }
    )

    assert event["received_at_utc"] == "2026-06-06T13:01:04Z"
    assert event["latency_sec"] == 124
    assert event["payload"]["received_at_utc"] == "2026-06-06T13:01:04Z"
    assert event["payload"]["latency_sec"] == 124



def test_invalid_patch_without_city_or_observation_data_is_rejected():
    with pytest.raises(PatchValidationError):
        normalize_observation_patch({"changes": {"temp": 21.0}})

    with pytest.raises(PatchValidationError):
        normalize_observation_patch({"city": "taipei", "changes": {"source": "metar"}})
