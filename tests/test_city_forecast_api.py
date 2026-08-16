"""Tests for the /api/cities/deb-forecast external forecast API."""

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
        "deb": {
            "prediction": 33.5,
            "weights_info": "ECMWF 0.35 · GFS 0.30 · DEB 0.35",
            "quality_tier": "good",
        },
        "forecast": {
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
            "daily_forecasts": {
                "2026-08-16": {"ecmwf": 33.2, "gfs": 32.8, "deb": 33.5},
                "2026-08-17": {"ecmwf": 34.0, "gfs": 33.1, "deb": 34.2},
            },
        },
    }


def test_deb_forecast_requires_entitlement(monkeypatch):
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
    response = client.get("/api/cities/deb-forecast")
    assert response.status_code == 503


def test_deb_forecast_default_watchlist_shape(monkeypatch):
    monkeypatch.setattr(
        "web.analysis_service._analyze", _fake_analyze, raising=False
    )
    monkeypatch.setattr(
        "web.routes._assert_entitlement", lambda request: None
    )

    response = client.get("/api/cities/deb-forecast")
    assert response.status_code == 200
    payload = response.json()

    assert payload["count"] == len(city_forecast.DEFAULT_FORECAST_CITIES)
    assert "generated_at" in payload
    assert set(payload["cities"]) == set(city_forecast.DEFAULT_FORECAST_CITIES)

    beijing = payload["cities"]["beijing"]
    assert beijing["deb_prediction"] == 33.5
    assert "ECMWF" in beijing["deb_weights"]
    assert beijing["models_daily"]["2026-08-17"]["gfs"] == 33.1
    assert beijing["forecast_daily"][0]["max_temp"] == 33.0
    assert beijing["local_date"] == "2026-08-16"


def test_deb_forecast_custom_city_list(monkeypatch):
    monkeypatch.setattr(
        "web.analysis_service._analyze", _fake_analyze, raising=False
    )
    monkeypatch.setattr(
        "web.routes._assert_entitlement", lambda request: None
    )

    response = client.get(
        "/api/cities/deb-forecast", params={"cities": "beijing,shanghai"}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 2
    assert set(payload["cities"]) == {"beijing", "shanghai"}


def test_deb_forecast_unknown_cities_filtered(monkeypatch):
    monkeypatch.setattr(
        "web.analysis_service._analyze", _fake_analyze, raising=False
    )
    monkeypatch.setattr(
        "web.routes._assert_entitlement", lambda request: None
    )

    response = client.get(
        "/api/cities/deb-forecast", params={"cities": "beijing,atlantis,nowhere"}
    )
    assert response.status_code == 200
    payload = response.json()
    assert set(payload["cities"]) == {"beijing"}
