from src.data_collection.nws_open_meteo_sources import (
    OPEN_METEO_MULTI_MODEL_ORDER,
    _parse_open_meteo_multi_model_daily,
)
import src.data_collection.open_meteo_cache as open_meteo_cache_module
from src.data_collection.weather_sources import WeatherDataCollector
from src.database.runtime_state import OpenMeteoRateLimitRepository, RuntimeStateDB


def test_multi_model_parser_exposes_open_recommended_models():
    daily = {
        "time": ["2026-04-17", "2026-04-18"],
        "temperature_2m_max_ecmwf_ifs025": [20.1, 21.1],
        "temperature_2m_max_ecmwf_aifs025_single": [20.2, 21.2],
        "temperature_2m_max_icon_eu": [20.3, 21.3],
        "temperature_2m_max_icon_d2": [20.4, None],
        "temperature_2m_max_gem_global": [19.8, 20.8],
        "temperature_2m_max_gem_regional": [21.0, 22.0],
        "temperature_2m_max_gem_hrdps_continental": [21.5, None],
    }

    dates, forecasts, metadata, model_keys = _parse_open_meteo_multi_model_daily(daily)

    assert dates == ["2026-04-17", "2026-04-18"]
    assert forecasts["2026-04-17"]["ECMWF"] == 20.1
    assert forecasts["2026-04-17"]["ECMWF AIFS"] == 20.2
    assert forecasts["2026-04-17"]["ICON-EU"] == 20.3
    assert forecasts["2026-04-17"]["ICON-D2"] == 20.4
    assert forecasts["2026-04-17"]["GDPS"] == 19.8
    assert forecasts["2026-04-17"]["RDPS"] == 21.0
    assert forecasts["2026-04-17"]["HRDPS"] == 21.5
    assert "ICON-D2" not in forecasts["2026-04-18"]
    assert metadata["ECMWF AIFS"]["provider"] == "ECMWF"
    assert metadata["HRDPS"]["resolution_km"] == 2.5
    assert model_keys["RDPS"] == "gem_regional"


def test_multi_model_order_includes_legacy_and_new_sources():
    assert "ecmwf_ifs025" in OPEN_METEO_MULTI_MODEL_ORDER
    assert "ecmwf_aifs025_single" in OPEN_METEO_MULTI_MODEL_ORDER
    assert "gfs_seamless" in OPEN_METEO_MULTI_MODEL_ORDER
    assert "icon_seamless" in OPEN_METEO_MULTI_MODEL_ORDER
    assert "icon_eu" in OPEN_METEO_MULTI_MODEL_ORDER
    assert "icon_d2" in OPEN_METEO_MULTI_MODEL_ORDER
    assert "gem_seamless" in OPEN_METEO_MULTI_MODEL_ORDER
    assert "gem_global" in OPEN_METEO_MULTI_MODEL_ORDER
    assert "gem_regional" in OPEN_METEO_MULTI_MODEL_ORDER
    assert "gem_hrdps_continental" in OPEN_METEO_MULTI_MODEL_ORDER
    assert "jma_seamless" in OPEN_METEO_MULTI_MODEL_ORDER


def test_fetch_all_sources_prioritizes_multi_model_before_forecast(monkeypatch, tmp_path):
    monkeypatch.setenv("OPEN_METEO_DISK_CACHE_PATH", str(tmp_path / "om-cache.json"))
    collector = WeatherDataCollector({})
    calls = []

    monkeypatch.setattr(collector, "_log_temperature_unit", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_settlement_sources", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_supports_aviationweather", lambda city: False)
    monkeypatch.setattr(collector, "_attach_turkish_mgm_data", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_korean_amos_data", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_china_amsc_awos_data", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_madis_hfmetar_data", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_singapore_mss_data", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_china_official_nearby", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_japan_official_nearby", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_fmi_official_nearby", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_knmi_official_nearby", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_hko_obs_official_nearby", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_cwa_settlement_nearby", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_global_nearby_cluster", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "fetch_ensemble", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "fetch_nws", lambda *args, **kwargs: None)

    def fake_multi_model(*args, **kwargs):
        calls.append("multi_model")
        return {"forecasts": {"ECMWF": 24.0, "GFS": 25.0}}

    def fake_open_meteo(*args, **kwargs):
        calls.append("open_meteo")
        return {"utc_offset": 10800, "daily": {"temperature_2m_max": [24]}}

    monkeypatch.setattr(collector, "fetch_multi_model", fake_multi_model)
    monkeypatch.setattr(collector, "fetch_from_open_meteo", fake_open_meteo)

    result = collector.fetch_all_sources(
        "ankara",
        lat=40.1281,
        lon=32.9951,
        include_ensemble=False,
        include_nearby=False,
        include_taf=False,
        include_mgm=False,
    )

    assert calls[:2] == ["multi_model", "open_meteo"]
    assert result["multi_model"]["forecasts"]["ECMWF"] == 24.0


def test_force_refresh_preserves_open_meteo_model_caches_by_default(monkeypatch, tmp_path):
    monkeypatch.setenv("OPEN_METEO_DISK_CACHE_PATH", str(tmp_path / "om-cache.json"))
    collector = WeatherDataCollector({})
    captured = {}

    def fake_evict(*args, **kwargs):
        captured["keep_model_caches"] = kwargs.get("keep_model_caches")

    monkeypatch.setattr(collector, "_evict_city_caches", fake_evict)
    monkeypatch.setattr(collector, "_log_temperature_unit", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_settlement_sources", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_supports_aviationweather", lambda city: False)
    monkeypatch.setattr(collector, "fetch_multi_model", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "fetch_from_open_meteo", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_nws_and_models", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_turkish_mgm_data", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_korean_amos_data", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_china_amsc_awos_data", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_madis_hfmetar_data", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_singapore_mss_data", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_china_official_nearby", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_japan_official_nearby", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_fmi_official_nearby", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_knmi_official_nearby", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_hko_obs_official_nearby", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_cwa_settlement_nearby", lambda *args, **kwargs: None)
    monkeypatch.setattr(collector, "_attach_global_nearby_cluster", lambda *args, **kwargs: None)

    collector.fetch_all_sources(
        "ankara",
        lat=40.1281,
        lon=32.9951,
        force_refresh=True,
        include_ensemble=False,
        include_nearby=False,
        include_taf=False,
        include_mgm=False,
    )

    assert captured["keep_model_caches"] is True


def test_persisted_open_meteo_cooldown_skips_outbound_request(monkeypatch, tmp_path):
    monkeypatch.setenv("POLYWEATHER_STATE_STORAGE_MODE", "sqlite")
    monkeypatch.setenv("POLYWEATHER_DB_PATH", str(tmp_path / "polyweather.db"))
    monkeypatch.setenv("OPEN_METEO_DISK_CACHE_PATH", str(tmp_path / "om-cache.json"))
    db = RuntimeStateDB(str(tmp_path / "polyweather.db"))
    rate_repo = OpenMeteoRateLimitRepository(db)
    rate_repo.set_until(9999999999.0, reason="test_429")
    monkeypatch.setattr(open_meteo_cache_module, "_open_meteo_rate_limit_repo", rate_repo)

    collector = WeatherDataCollector({})

    def fail_http(*args, **kwargs):
        raise AssertionError("Open-Meteo HTTP request should be skipped during persisted cooldown")

    monkeypatch.setattr(collector, "_http_get", fail_http)

    result = collector.fetch_multi_model(40.1281, 32.9951, city="ankara")

    assert result is None


def test_multi_model_hourly_parser():
    from src.data_collection.nws_open_meteo_sources import _parse_open_meteo_multi_model_hourly

    hourly = {
        "time": ["2026-05-21T00:00", "2026-05-21T01:00"],
        "temperature_2m_ecmwf_ifs025": [15.2, 15.0],
        "temperature_2m_gfs_seamless": [14.8, None],
        "temperature_2m_icon_d2": [None, None],  # completely empty, should be ignored
    }

    times, forecasts = _parse_open_meteo_multi_model_hourly(hourly)

    assert times == ["2026-05-21T00:00", "2026-05-21T01:00"]
    assert forecasts["ECMWF"] == [15.2, 15.0]
    assert forecasts["GFS"] == [14.8, None]
    assert "ICON-D2" not in forecasts


def test_merge_multi_model_result_with_cache_hourly():
    from src.data_collection.nws_open_meteo_sources import _merge_multi_model_result_with_cache

    cached = {
        "forecasts": {"ECMWF": 20.0, "GFS": 19.5, "ICON-EU": 19.8},
        "daily_forecasts": {
            "2026-05-21": {"ECMWF": 20.0, "GFS": 19.5, "ICON-EU": 19.8}
        },
        "hourly_times": ["2026-05-21T00:00", "2026-05-21T01:00"],
        "hourly_forecasts": {
            "ECMWF": [15.2, 15.0],
            "GFS": [14.8, 14.5],
            "ICON-EU": [15.0, 14.8],
        },
    }

    fresh = {
        "forecasts": {"ECMWF": 20.2},  # Only ECMWF returned (e.g. subset refresh)
        "daily_forecasts": {
            "2026-05-21": {"ECMWF": 20.2}
        },
        "hourly_times": ["2026-05-21T01:00", "2026-05-21T02:00"],  # time shifts forward
        "hourly_forecasts": {
            "ECMWF": [15.1, 15.3],
        },
    }

    merged = _merge_multi_model_result_with_cache(cached, fresh)

    # Standard checks
    assert merged["forecasts"]["ECMWF"] == 20.2
    assert merged["forecasts"]["GFS"] == 19.5
    assert merged["forecasts"]["ICON-EU"] == 19.8

    # Hourly merge and alignment checks
    assert merged["hourly_times"] == ["2026-05-21T01:00", "2026-05-21T02:00"]
    # At T01:00, fresh has ECMWF=15.1, cached has GFS=14.5, ICON-EU=14.8
    assert merged["hourly_forecasts"]["ECMWF"] == [15.1, 15.3]
    assert merged["hourly_forecasts"]["GFS"] == [14.5, None]
    assert merged["hourly_forecasts"]["ICON-EU"] == [14.8, None]

