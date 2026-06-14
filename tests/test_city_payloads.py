from web.services.city_payloads import build_city_detail_payload, build_city_summary_payload
from web.services import city_runtime


def test_city_summary_payload_preserves_deb_metadata():
    payload = build_city_summary_payload(
        {
            "name": "shanghai",
            "display_name": "Shanghai",
            "temp_symbol": "°C",
            "current": {},
            "risk": {},
            "deb": {
                "prediction": 29.7,
                "raw_prediction": 27.6,
                "version": "deb_v1_recent_bias_corrected",
                "bias_adjustment": 1.3,
                "bias_samples": 18,
            },
        }
    )

    assert payload["deb"] == {
        "prediction": 29.7,
        "raw_prediction": 27.6,
        "version": "deb_v1_recent_bias_corrected",
        "bias_adjustment": 1.3,
        "bias_samples": 18,
    }


def test_city_payloads_expose_wunderground_current():
    data = {
        "name": "shanghai",
        "display_name": "Shanghai",
        "temp_symbol": "°C",
        "current": {},
        "risk": {},
        "wunderground_current": {
            "source": "wunderground_historical",
            "station_code": "ZSPD",
            "max_so_far": 26,
            "today_obs": [{"time": "13:30", "temp": 26}],
        },
    }

    summary = build_city_summary_payload(data)
    detail = build_city_detail_payload(data)

    assert summary["wunderground_current"]["max_so_far"] == 26
    assert detail["wunderground_current"]["max_so_far"] == 26
    assert detail["official"]["wunderground_current"]["station_code"] == "ZSPD"
    assert detail["timeseries"]["wunderground_today_obs"] == [{"time": "13:30", "temp": 26}]


def test_api_payload_overlay_uses_cached_wunderground_state_without_fetch(monkeypatch):
    stale_payload = {
        "name": "guangzhou",
        "temp_symbol": "°C",
        "utc_offset_seconds": 28800,
        "wunderground_current": {
            "source": "wunderground_historical",
            "station_code": "ZGGG",
            "temp": 36,
            "max_so_far": 36,
            "today_obs": [{"time": "14:00", "temp": 36}],
        },
        "official": {
            "wunderground_current": {
                "source": "wunderground_historical",
                "station_code": "ZGGG",
                "temp": 36,
                "max_so_far": 36,
            },
        },
        "timeseries": {
            "wunderground_today_obs": [{"time": "14:00", "temp": 36}],
        },
    }

    fetch_calls = []

    def fail_fetch(*args, **kwargs):
        fetch_calls.append((args, kwargs))
        raise AssertionError("city API overlay must not fetch Wunderground directly")

    monkeypatch.setattr(city_runtime._weather, "fetch_wunderground_historical", fail_fetch)

    overlay = getattr(city_runtime, "_overlay_latest_wunderground_current", None)
    assert callable(overlay), "city API must preserve cached WU state without direct fetch"
    payload = overlay("guangzhou", stale_payload)

    assert payload["wunderground_current"]["temp"] == 36
    assert payload["wunderground_current"]["max_so_far"] == 36
    assert payload["official"]["wunderground_current"]["max_so_far"] == 36
    assert payload["timeseries"]["wunderground_today_obs"] == [{"time": "14:00", "temp": 36}]
    assert stale_payload["wunderground_current"]["max_so_far"] == 36
    assert fetch_calls == []
