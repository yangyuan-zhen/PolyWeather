from src.utils.refresh_policy import (
    METAR_POLL_TTL_SEC,
    MODEL_CACHE_TTL_SEC,
    OBSERVATION_REFRESH_SEC,
    SCAN_ROWS_REFRESH_SEC,
)


def test_refresh_policy_cadences_are_layered():
    assert OBSERVATION_REFRESH_SEC == 60
    assert METAR_POLL_TTL_SEC == 300
    assert SCAN_ROWS_REFRESH_SEC == 300
    assert MODEL_CACHE_TTL_SEC == 1800


def test_backend_defaults_use_refresh_policy():
    import src.data_collection.weather_sources as weather_sources
    import web.services.city_runtime as city_runtime
    import web.services.scan_ai_config as scan_ai_config

    assert scan_ai_config.SCAN_TERMINAL_PAYLOAD_TTL_SEC == SCAN_ROWS_REFRESH_SEC
    assert city_runtime.CITY_FULL_CACHE_TTL_SEC == OBSERVATION_REFRESH_SEC
    assert city_runtime.CITY_PANEL_CACHE_TTL_SEC == SCAN_ROWS_REFRESH_SEC
    assert city_runtime.CITY_MARKET_CACHE_TTL_SEC == SCAN_ROWS_REFRESH_SEC

    source = weather_sources.WeatherDataCollector({})
    assert source.metar_cache_ttl_sec == METAR_POLL_TTL_SEC
    assert source.hko_obs_cache_ttl_sec == OBSERVATION_REFRESH_SEC
    assert source.settlement_cache_ttl_sec == OBSERVATION_REFRESH_SEC
    assert source.open_meteo_cache_ttl_sec == MODEL_CACHE_TTL_SEC
    assert source.open_meteo_multi_model_cache_ttl_sec == MODEL_CACHE_TTL_SEC
