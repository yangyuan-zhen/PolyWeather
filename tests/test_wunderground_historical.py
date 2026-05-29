from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import httpx

from src.data_collection.weather_sources import WeatherDataCollector


def _collector(monkeypatch, tmp_path) -> WeatherDataCollector:
    monkeypatch.setenv("OPEN_METEO_DISK_CACHE_PATH", str(tmp_path / "om-cache.json"))
    return WeatherDataCollector({"weather": {}})


def test_fetch_wunderground_historical_uses_weather_com_historical_json(monkeypatch, tmp_path):
    collector = _collector(monkeypatch, tmp_path)
    called = {}

    def fake_get(url: str, **_kwargs):
        called["url"] = url
        return httpx.Response(
            200,
            json={
                "metadata": {
                    "status_code": 200,
                    "location_id": "ZSPD:9:CN",
                    "units": "m",
                },
                "observations": [
                    {
                        "obs_id": "ZSPD",
                        "obs_name": "Shanghai/Pudong",
                        "valid_time_gmt": 1780027200,
                        "temp": 25,
                        "wx_phrase": "Fair",
                    },
                    {
                        "obs_id": "ZSPD",
                        "obs_name": "Shanghai/Pudong",
                        "valid_time_gmt": 1780029000,
                        "temp": 26,
                        "wx_phrase": "Fair",
                    },
                    {
                        "obs_id": "ZSPD",
                        "obs_name": "Shanghai/Pudong",
                        "valid_time_gmt": 1780032600,
                        "temp": 26,
                        "wx_phrase": "Fair",
                    },
                ],
            },
            request=httpx.Request("GET", url),
        )

    monkeypatch.setattr(collector, "_http_get", fake_get)

    payload = collector.fetch_wunderground_historical(
        "shanghai",
        use_fahrenheit=False,
        utc_offset=28800,
        local_date="2026-05-29",
    )

    parsed = urlparse(called["url"])
    query = parse_qs(parsed.query)
    assert parsed.path == "/v1/location/ZSPD:9:CN/observations/historical.json"
    assert query["units"] == ["m"]
    assert query["startDate"] == ["20260529"]
    assert query["endDate"] == ["20260529"]
    assert payload["source"] == "wunderground_historical"
    assert payload["station_code"] == "ZSPD"
    assert payload["location_id"] == "ZSPD:9:CN"
    assert payload["temp"] == 26
    assert payload["max_so_far"] == 26
    assert payload["max_temp_time"] == "12:30"
    assert payload["obs_time"] == "13:30"


def test_fetch_wunderground_historical_uses_current_json_to_lift_latest_and_high(monkeypatch, tmp_path):
    collector = _collector(monkeypatch, tmp_path)
    calls = []

    def fake_get(url: str, **kwargs):
        calls.append({"url": url, "headers": kwargs.get("headers") or {}})
        if urlparse(url).path.endswith("/current.json"):
            return httpx.Response(
                200,
                json={
                    "metadata": {
                        "status_code": 200,
                        "location_id": "ZGGG:9:CN",
                        "units": "m",
                    },
                    "observation": {
                        "obs_time": 1780039020,
                        "obs_time_local": "2026-05-29T15:17:00+0800",
                        "metric": {
                            "temp": 38,
                            "temp_max_24hour": 38,
                        },
                    },
                },
                request=httpx.Request("GET", url),
            )
        return httpx.Response(
            200,
            json={
                "metadata": {
                    "status_code": 200,
                    "location_id": "ZGGG:9:CN",
                    "units": "m",
                },
                "observations": [
                    {
                        "obs_id": "ZGGG",
                        "valid_time_gmt": 1780034400,
                        "temp": 36,
                    },
                ],
            },
            request=httpx.Request("GET", url),
        )

    monkeypatch.setattr(collector, "_http_get", fake_get)

    payload = collector.fetch_wunderground_historical(
        "guangzhou",
        use_fahrenheit=False,
        utc_offset=28800,
        local_date="2026-05-29",
    )

    paths = [urlparse(call["url"]).path for call in calls]
    assert "/v1/location/ZGGG:9:CN/observations/historical.json" in paths
    assert "/v1/location/ZGGG:9:CN/observations/current.json" in paths
    assert all(call["headers"].get("Cache-Control") == "no-cache" for call in calls)
    assert all(call["headers"].get("Pragma") == "no-cache" for call in calls)
    assert payload["temp"] == 38
    assert payload["obs_time"] == "15:17"
    assert payload["max_so_far"] == 38
    assert payload["max_temp_time"] == "15:17"


def test_fetch_wunderground_historical_keeps_fahrenheit_for_us_cities(monkeypatch, tmp_path):
    collector = _collector(monkeypatch, tmp_path)
    called = {}

    def fake_get(url: str, **_kwargs):
        called["url"] = url
        return httpx.Response(
            200,
            json={
                "metadata": {
                    "status_code": 200,
                    "location_id": "KLGA:9:US",
                    "units": "e",
                },
                "observations": [
                    {"obs_id": "KLGA", "valid_time_gmt": 1780027200, "temp": 73},
                    {"obs_id": "KLGA", "valid_time_gmt": 1780030800, "temp": 75},
                ],
            },
            request=httpx.Request("GET", url),
        )

    monkeypatch.setattr(collector, "_http_get", fake_get)

    payload = collector.fetch_wunderground_historical(
        "new york",
        use_fahrenheit=True,
        utc_offset=-14400,
        local_date="2026-05-29",
    )

    parsed = urlparse(called["url"])
    assert parsed.path == "/v1/location/KLGA:9:US/observations/historical.json"
    assert parse_qs(parsed.query)["units"] == ["e"]
    assert payload["temp_symbol"] == "°F"
    assert payload["max_so_far"] == 75


def test_fetch_all_sources_attaches_wunderground_historical(monkeypatch, tmp_path):
    collector = _collector(monkeypatch, tmp_path)
    called = {}

    monkeypatch.setattr(collector, "fetch_settlement_current", lambda _city: None)
    monkeypatch.setattr(collector, "_supports_aviationweather", lambda _city: False)

    def fake_fetch(city: str, *, use_fahrenheit: bool, utc_offset: int, local_date=None):
        called["city"] = city
        called["use_fahrenheit"] = use_fahrenheit
        called["utc_offset"] = utc_offset
        called["local_date"] = local_date
        return {
            "source": "wunderground_historical",
            "location_id": "ZSPD:9:CN",
            "max_so_far": 26,
        }

    monkeypatch.setattr(collector, "fetch_wunderground_historical", fake_fetch)

    payload = collector.fetch_all_sources("shanghai")

    assert payload["wunderground_current"]["max_so_far"] == 26
    assert called == {
        "city": "shanghai",
        "use_fahrenheit": False,
        "utc_offset": 28800,
        "local_date": None,
    }
