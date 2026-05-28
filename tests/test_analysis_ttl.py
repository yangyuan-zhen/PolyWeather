from web.analysis_service import (
    _analysis_ttl_for_city,
    _mgm_hourly_high,
    _runway_history_temp_for_city,
)
from web.core import CACHE_TTL


def test_high_frequency_airport_cities_use_one_minute_analysis_cache():
    assert _analysis_ttl_for_city("chongqing") == 60
    assert _analysis_ttl_for_city("shanghai") == 60
    assert _analysis_ttl_for_city("singapore") == 60


def test_non_high_frequency_city_keeps_default_analysis_cache_ttl():
    assert _analysis_ttl_for_city("new york") == CACHE_TTL


def test_mgm_hourly_high_fills_turkish_model_support():
    assert _mgm_hourly_high(
        {
            "hourly": [
                {"time": "2026-05-17T10:00:00Z", "temp": 18.0},
                {"time": "2026-05-17T11:00:00Z", "temp": 21.5},
                {"time": "2026-05-17T12:00:00Z", "temp": None},
            ]
        }
    ) == 21.5


def test_runway_history_temp_uses_settlement_endpoint_for_second_runway():
    assert _runway_history_temp_for_city(
        "chongqing",
        {
            "runway": "20R/02L",
            "tdz_temp": 33.8,
            "mid_temp": 34.5,
            "end_temp": 31.2,
            "target_runway_max": 34.5,
        },
    ) == 31.2


def test_runway_history_temp_uses_settlement_endpoint_for_first_runway():
    assert _runway_history_temp_for_city(
        "wuhan",
        {
            "runway": "04/22",
            "tdz_temp": 31.2,
            "mid_temp": 33.4,
            "end_temp": 32.6,
            "target_runway_max": 33.4,
        },
    ) == 31.2
