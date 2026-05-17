from src.utils.telegram_push import (
    HIGH_FREQ_AIRPORT_CITIES,
    HIGH_FREQ_AIRPORT_ICAO,
    MARKET_MONITOR_CITIES,
    MARKET_MONITOR_INTERVAL_SEC,
    _build_airport_status_message,
    _build_market_monitor_message,
)


def test_airport_status_message_starts_with_runway_city_and_station_hashtags():
    text = _build_airport_status_message(
        "qingdao",
        {
            "current": {"temp": 22.8},
            "deb": {"prediction": 24.0},
            "airport_current": {"max_so_far": 23.1, "max_temp_time": "13:00"},
            "amos": {
                "source": "amsc_awos",
                "observation_time": "2026-05-15T05:00:00Z",
                "runway_obs": {
                    "runway_pairs": [("17", "35"), ("16", "34")],
                    "temperatures": [(23.0, None), (23.2, None)],
                    "point_temperatures": [
                        {"tdz_temp": 23.0, "mid_temp": None, "end_temp": 23.1},
                        {"tdz_temp": 23.2, "mid_temp": None, "end_temp": 23.3},
                    ],
                },
            },
        },
        24.0,
        "13:00",
    )

    first_line = text.splitlines()[0]
    assert first_line == "#跑道观测 #Qingdao"
    assert "Qingdao / Jiaodong" in text
    assert "TDZ:23.0" in text
    assert "DEB" in text and "24.0" in text


def test_market_monitor_message_starts_with_market_hashtag_and_city():
    text = _build_market_monitor_message(
        "shanghai",
        {
            "local_time": "14:01",
            "airport_current": {"temp": 29.4},
            "deb": {"prediction": 31.2},
            "market_scan": {"available": True},
        },
    )

    assert text.splitlines()[0] == "#市场监控 #Shanghai"
    assert "Shanghai 14:01" in text
    assert "当前：29.4°C · DEB：31.2°C" in text


def test_market_monitor_uses_focus_runway_temperature_for_key_airports():
    text = _build_market_monitor_message(
        "shanghai",
        {
            "local_time": "14:01",
            "airport_current": {"temp": 29.4},
            "deb": {"prediction": 31.2},
            "amos": {
                "source": "amsc_awos",
                "runway_obs": {
                    "runway_pairs": [("16L", "34R"), ("17L", "35R")],
                    "temperatures": [(36.0, None), (31.8, None)],
                },
            },
        },
    )

    assert "当前：31.8°C · DEB：31.2°C" in text


def test_airport_status_hides_non_focus_runways_for_key_airports():
    text = _build_airport_status_message(
        "chongqing",
        {
            "current": {"temp": 28.0},
            "airport_current": {"max_so_far": 30.0, "max_temp_time": "13:00"},
            "amos": {
                "source": "amsc_awos",
                "runway_obs": {
                    "runway_pairs": [("02L", "20R"), ("02R", "20L")],
                    "temperatures": [(31.1, None), (34.9, None)],
                    "point_temperatures": [
                        {"tdz_temp": 31.0, "mid_temp": 31.1, "end_temp": 31.2},
                        {"tdz_temp": 34.8, "mid_temp": 34.9, "end_temp": 35.0},
                    ],
                },
            },
        },
        32.0,
        "13:00",
    )

    assert "02L/20R" in text
    assert "02R/20L" not in text
    assert "当前：31.1°C" in text


def test_market_monitor_default_interval_is_five_minutes():
    assert MARKET_MONITOR_INTERVAL_SEC == 300


def test_singapore_is_in_telegram_push_city_lists():
    assert "singapore" not in MARKET_MONITOR_CITIES
    assert "singapore" in HIGH_FREQ_AIRPORT_CITIES
    assert HIGH_FREQ_AIRPORT_ICAO["singapore"] == "WSSS"


def test_shenzhen_is_removed_from_telegram_push_city_lists():
    assert "shenzhen" not in MARKET_MONITOR_CITIES
    assert "shenzhen" not in HIGH_FREQ_AIRPORT_CITIES
    assert "shenzhen" not in HIGH_FREQ_AIRPORT_ICAO
