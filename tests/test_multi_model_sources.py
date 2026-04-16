from src.data_collection.nws_open_meteo_sources import (
    OPEN_METEO_MULTI_MODEL_ORDER,
    _parse_open_meteo_multi_model_daily,
)


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
