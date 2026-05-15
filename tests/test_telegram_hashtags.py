from src.utils.telegram_push import (
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
                "observation_time": "2026-05-15T05:00:00Z",
                "runway_obs": {
                    "temperatures": [(23.0, "TDZ"), (23.2, "MID"), (23.1, "END")],
                },
            },
        },
        24.0,
        "13:00",
    )

    first_line = text.splitlines()[0]
    assert first_line == "#跑道观测 #Qingdao #ZSQD"
    assert "Qingdao / ZSQD 13:00" in text


def test_market_monitor_message_starts_with_market_hashtag_and_city():
    text = _build_market_monitor_message(
        "shanghai",
        {
            "local_time": "14:01",
            "current": {"temp": 29.4},
            "deb": {"prediction": 31.2},
            "market_scan": {
                "available": True,
                "signal_label": "MONITOR",
                "confidence": "medium",
                "selected_bucket": "31° or higher",
                "yes_buy": 0.42,
                "edge_percent": 8.4,
            },
        },
    )

    assert text.splitlines()[0] == "#市场监控 #Shanghai"
    assert "1分钟市场监控" in text
    assert "Edge：+8.4%" in text


def test_market_monitor_default_interval_is_one_minute():
    assert MARKET_MONITOR_INTERVAL_SEC == 60
