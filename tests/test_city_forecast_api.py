"""Tests for the /api/v1/forecasts external forecast API."""

from fastapi.testclient import TestClient

from web.app import app
from web.routers import city_forecast

client = TestClient(app)


def _fake_analyze(city, force_refresh=False, detail_mode="panel"):
    return {
        "city": city,
        "local_date": "2026-08-16",
        "local_time": "14:30",
        "temp_symbol": "°C",
        "current": {
            "temp": 32.4,
            "max_so_far": 33.0,
            "max_temp_time": "13:30",
        },
        "deb": {
            "prediction": 33.5,
            "weights_info": "ECMWF 0.35 · GFS 0.30 · DEB 0.35",
            "quality_tier": "good",
            "hourly_path": {
                "times": ["13:00", "14:00", "15:00"],
                "temps": [32.1, 33.5, 33.5],
            },
        },
        "forecast": {
            "today_high": 33.0,
            "daily": [
                {
                    "date": "2026-08-16",
                    "max_temp": 33.0,
                    "min_temp": 26.0,
                    "condition": "晴",
                }
            ]
        },
        "multi_model": {
            "model_keys": ["ecmwf", "gfs", "deb"],
            "hourly_times": [
                "2026-08-16T13:00",
                "2026-08-16T14:00",
            ],
            "hourly_forecasts": {
                "ecmwf": [32.1, 33.2],
                "gfs": [31.8, 32.8],
            },
            "daily_forecasts": {
                "2026-08-16": {"ecmwf": 33.2, "gfs": 32.8, "deb": 33.5},
                "2026-08-17": {"ecmwf": 34.0, "gfs": 33.1, "deb": 34.2},
            },
        },
    }


def test_forecasts_requires_entitlement(monkeypatch):
    monkeypatch.setattr(
        "web.analysis_service._analyze", _fake_analyze, raising=False
    )
    # Force the entitlement guard on with no token configured: the endpoint
    # must refuse to serve the forecast.
    monkeypatch.setattr(
        "web.auth.guards._get_entitlement_guard_enabled", lambda: True
    )
    monkeypatch.setattr(
        "web.auth.guards._get_entitlement_token", lambda: ""
    )
    response = client.get("/api/v1/forecasts")
    assert response.status_code == 503


def test_forecasts_default_watchlist_shape(monkeypatch):
    monkeypatch.setattr(
        "web.analysis_service._analyze", _fake_analyze, raising=False
    )
    monkeypatch.setattr(
        "web.routes._assert_entitlement", lambda request: None
    )

    response = client.get("/api/v1/forecasts")
    assert response.status_code == 200
    payload = response.json()

    assert payload["count"] == len(city_forecast.DEFAULT_FORECAST_CITIES)
    assert "generated_at" in payload
    assert set(payload["forecasts"]) == set(city_forecast.DEFAULT_FORECAST_CITIES)

    beijing = payload["forecasts"]["beijing"]
    assert beijing["deb"]["prediction"] == 33.5
    assert beijing["current"]["max_temp_time"] == "13:30"
    assert beijing["forecast"]["max_temp_time"] == "14:00"
    assert beijing["hourly"]["times"] == ["13:00", "14:00", "15:00"]
    assert beijing["hourly"]["temps"] == [32.1, 33.5, 33.5]
    assert beijing["hourly"]["peak_times"] == ["14:00", "15:00"]
    assert "ECMWF" in beijing["deb"]["weights"]
    assert beijing["models"]["daily"]["2026-08-17"]["gfs"] == 33.1
    assert beijing["models"]["hourly"]["times"] == [
        "2026-08-16T13:00",
        "2026-08-16T14:00",
    ]
    assert beijing["models"]["hourly"]["curves"]["ecmwf"] == [32.1, 33.2]
    assert beijing["daily"][0]["max_temp"] == 33.0
    assert beijing["local_date"] == "2026-08-16"


def test_forecasts_custom_city_list(monkeypatch):
    monkeypatch.setattr(
        "web.analysis_service._analyze", _fake_analyze, raising=False
    )
    monkeypatch.setattr(
        "web.routes._assert_entitlement", lambda request: None
    )

    response = client.get(
        "/api/v1/forecasts", params={"cities": "beijing,shanghai"}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 2
    assert set(payload["forecasts"]) == {"beijing", "shanghai"}


def test_v1_forecasts_returns_normalized_public_shape(monkeypatch):
    monkeypatch.setattr(
        "web.analysis_service._analyze", _fake_analyze, raising=False
    )
    monkeypatch.setattr(
        "web.routes._assert_entitlement", lambda request: None
    )
    monkeypatch.setattr("web.routers.city_forecast._FORECAST_CACHE", {})

    response = client.get("/api/v1/forecasts", params={"cities": "beijing"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    beijing = payload["forecasts"]["beijing"]
    assert beijing["current"]["max_temp_time"] == "13:30"
    assert beijing["forecast"]["max_temp_time"] == "14:00"
    assert beijing["forecast"]["max_temp_times"] == ["14:00", "15:00"]
    assert beijing["hourly"]["source"] == "deb_hourly_path"
    assert beijing["hourly"]["times"] == ["13:00", "14:00", "15:00"]
    assert beijing["hourly"]["temps"] == [32.1, 33.5, 33.5]
    assert beijing["deb"]["prediction"] == 33.5
    assert beijing["daily"][0]["max_temp"] == 33.0
    assert beijing["models"]["keys"] == ["ecmwf", "gfs", "deb"]
    assert beijing["models"]["hourly"]["times"] == [
        "2026-08-16T13:00",
        "2026-08-16T14:00",
    ]
    assert beijing["models"]["hourly"]["curves"]["ecmwf"] == [32.1, 33.2]


def test_forecasts_resolves_aliases(monkeypatch):
    monkeypatch.setattr(
        "web.analysis_service._analyze", _fake_analyze, raising=False
    )
    monkeypatch.setattr(
        "web.routes._assert_entitlement", lambda request: None
    )
    monkeypatch.setattr(
        "web.routers.city_forecast._FORECAST_CACHE", {}
    )

    # telaviv (no space), saopaulo (no space), hko, haneda must resolve to
    # their canonical registry cities.
    response = client.get(
        "/api/v1/forecasts",
        params={"cities": "telaviv,saopaulo,hko,haneda"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert set(payload["forecasts"]) == {
        "tel aviv",
        "sao paulo",
        "hong kong",
        "tokyo",
    }


def test_forecasts_unknown_cities_filtered(monkeypatch):
    monkeypatch.setattr(
        "web.analysis_service._analyze", _fake_analyze, raising=False
    )
    monkeypatch.setattr(
        "web.routes._assert_entitlement", lambda request: None
    )

    response = client.get(
        "/api/v1/forecasts", params={"cities": "beijing,atlantis,nowhere"}
    )
    assert response.status_code == 200
    payload = response.json()
    assert set(payload["forecasts"]) == {"beijing"}


def test_forecasts_result_cache_serves_without_recompute(monkeypatch):
    calls = []

    def _counting_analyze(city, force_refresh=False, detail_mode="panel"):
        calls.append(city)
        return _fake_analyze(city, force_refresh, detail_mode)

    monkeypatch.setattr(
        "web.analysis_service._analyze", _counting_analyze, raising=False
    )
    monkeypatch.setattr(
        "web.routes._assert_entitlement", lambda request: None
    )
    monkeypatch.setattr(
        "web.routers.city_forecast._FORECAST_CACHE_TS", 0.0
    )
    monkeypatch.setattr(
        "web.routers.city_forecast._FORECAST_CACHE", {}
    )

    first = client.get(
        "/api/v1/forecasts", params={"cities": "beijing,shanghai"}
    )
    assert first.status_code == 200
    assert first.json()["count"] == 2
    assert sorted(calls) == ["beijing", "shanghai"]

    # Second call inside the TTL window must be served from the result cache:
    # no city analysis is triggered at all.
    calls.clear()
    second = client.get(
        "/api/v1/forecasts", params={"cities": "beijing,shanghai"}
    )
    assert second.status_code == 200
    assert second.json()["count"] == 2
    assert calls == []


def test_legacy_forecast_endpoint_removed():
    response = client.get("/api/cities/deb-forecast")
    assert response.status_code == 404
