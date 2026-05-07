from src.analysis.market_alert_engine import build_trading_alerts
from src.utils.telegram_push import _run_market_monitor_cycle


def _sample_weather_payload():
    return {
        "name": "ankara",
        "display_name": "Ankara",
        "lat": 40.1281,
        "lon": 32.9951,
        "temp_symbol": "°C",
        "current": {
            "temp": 11.3,
            "wind_dir": 180.0,
            "wind_speed_kt": 11.0,
        },
        "trend": {
            "recent": [
                {"time": "10:30", "temp": 11.3},
                {"time": "10:00", "temp": 10.3},
                {"time": "09:30", "temp": 9.9},
            ]
        },
        "multi_model": {
            "MGM": 10.8,
            "GFS": 10.4,
            "ECMWF": 10.6,
        },
        "deb": {
            "prediction": 11.8,
        },
        "metar_recent_obs": [
            {"time": "10:30", "wdir": 180},
            {"time": "10:00", "wdir": 60},
        ],
        "mgm_nearby": [
            {
                "name": "Airport (MGM/17128)",
                "istNo": "17128",
                "lat": 39.95,
                "lon": 32.97,
                "temp": 12.4,
            },
            {
                "name": "Ankara (Bölge/Center)",
                "istNo": "17130",
                "lat": 40.1281,
                "lon": 32.9951,
                "temp": 11.2,
            },
        ],
    }


def test_trading_alerts_all_core_rules_trigger():
    out = build_trading_alerts(
        city_weather=_sample_weather_payload(),
        map_url="https://example.com/map",
    )

    assert out["trigger_count"] >= 2
    assert out["rules"]["momentum_spike"]["triggered"] is True
    assert out["rules"]["forecast_breakthrough"]["triggered"] is True
    assert out["rules"]["advection"]["triggered"] is True

    msg = out["telegram"]["zh"]
    assert "PolyWeather 市场提醒" in msg
    assert "动量突变" in msg
    assert "https://example.com/map" in msg


def test_forecast_breakthrough_not_triggered_when_current_not_above_margin():
    city_weather = _sample_weather_payload()
    city_weather["current"]["temp"] = 11.0

    out = build_trading_alerts(
        city_weather=city_weather,
    )
    assert out["rules"]["forecast_breakthrough"]["triggered"] is False


def test_ankara_center_hits_deb_triggers_force_push():
    city_weather = _sample_weather_payload()
    city_weather["current"]["temp"] = 10.7
    city_weather["deb"]["prediction"] = 11.2
    city_weather["trend"]["recent"] = [
        {"time": "10:30", "temp": 10.7},
        {"time": "10:00", "temp": 10.7},
        {"time": "09:30", "temp": 10.6},
    ]
    city_weather["multi_model"] = {"MGM": 11.2, "GFS": 11.2, "ECMWF": 11.2}

    out = build_trading_alerts(
        city_weather=city_weather,
    )

    center_rule = out["rules"]["ankara_center_deb_hit"]
    assert center_rule["triggered"] is True
    assert center_rule["force_push"] is True
    assert out["severity"] in ("medium", "high")
    assert "Center信号" in out["telegram"]["zh"]


def test_ankara_center_signal_only_uses_official_center_station():
    city_weather = _sample_weather_payload()
    city_weather["deb"]["prediction"] = 11.2
    city_weather["current"]["temp"] = 10.7
    city_weather["mgm_nearby"] = [
        {
            "name": "Etimesgut",
            "istNo": "17069",
            "lat": 39.95,
            "lon": 32.68,
            "temp": 12.6,
        },
        {
            "name": "Airport (MGM/17128)",
            "istNo": "17128",
            "lat": 39.95,
            "lon": 32.97,
            "temp": 11.3,
        },
    ]

    out = build_trading_alerts(city_weather=city_weather)

    center_rule = out["rules"]["ankara_center_deb_hit"]
    assert center_rule["triggered"] is True
    assert center_rule["center_station"]["istNo"] == "17128"
    assert center_rule["center_station"]["name"] == "Airport (MGM/17128)"
    assert "Airport (MGM/17128)" in out["telegram"]["zh"]
    assert "Etimesgut" not in out["telegram"]["zh"]


def test_peak_passed_guard_suppresses_late_day_cooldown_alerts():
    city_weather = {
        "name": "wellington",
        "display_name": "Wellington",
        "temp_symbol": "°C",
        "local_time": "16:40",
        "current": {
            "temp": 19.0,
            "max_so_far": 20.2,
            "max_temp_time": "15:20",
            "wind_dir": 220.0,
            "wind_speed_kt": 8.0,
        },
        "trend": {
            "recent": [
                {"time": "16:40", "temp": 19.0},
                {"time": "16:10", "temp": 20.0},
                {"time": "15:40", "temp": 20.5},
            ]
        },
        "multi_model": {
            "MGM": 18.2,
            "GFS": 18.4,
            "ECMWF": 18.5,
        },
        "deb": {"prediction": 18.7},
        "metar_recent_obs": [
            {"time": "16:40", "wdir": 220},
            {"time": "16:10", "wdir": 210},
        ],
        "mgm_nearby": [],
    }

    out = build_trading_alerts(city_weather=city_weather)

    assert out["suppression"]["suppressed"] is True
    assert out["severity"] == "none"
    assert out["trigger_count"] == 0
    assert out["rules"]["momentum_spike"]["raw_triggered"] is True
    assert out["rules"]["forecast_breakthrough"]["raw_triggered"] is True
    assert "高温已过（暂停推送）" in out["telegram"]["zh"]
    assert "暂停主动推送" in out["telegram"]["zh"]


class _DigestBot:
    def __init__(self):
        self.messages = []

    def send_message(self, chat_id, text, **kwargs):
        self.messages.append(
            {
                "chat_id": chat_id,
                "text": text,
                "kwargs": kwargs,
            }
        )


def _focus_payload(
    *,
    city: str = "madrid",
    local_time: str = "14:00",
    peak_time: str = "12:00",
    severity: str = "medium",
    trigger_count: int = 1,
    edge_percent: float = 5.0,
    signal_label: str = "MONITOR",
    yes_buy: float = 0.18,
):
    return {
        "city": city,
        "severity": severity,
        "trigger_count": trigger_count,
        "rules": {
            "momentum_spike": {
                "triggered": trigger_count > 0,
            },
        },
        "market_snapshot": {
            "available": True,
            "forecast_bucket": {
                "label": "30°C",
                "value": 30,
                "yes_buy": yes_buy,
                "yes_sell": min(0.99, yes_buy + 0.02),
                "market_url": "https://example.com/market",
            },
            "market_url": "https://example.com/market",
            "confidence": "medium",
            "edge_percent": edge_percent,
            "signal_label": signal_label,
            "market_active": True,
            "market_closed": False,
            "market_accepting_orders": True,
            "market_tradable": True,
        },
        "evidence": {
            "generated_local_time": local_time,
            "inputs": {
                "current_temp": 29.0,
                "deb_prediction": 30.2,
            },
            "trigger_summary": {
                "trigger_types": ["momentum_spike"] if trigger_count > 0 else [],
                "suppression_snapshot": {
                    "max_temp_time": peak_time,
                },
            },
            "market": {
                "low_yes_signal": {
                    "should_push": signal_label in {"BUY YES", "BUY NO"},
                },
            },
        },
        "triggered_alerts": [
            {
                "type": "momentum_spike",
            }
        ]
        if trigger_count > 0
        else [],
        "telegram": {
            "zh": f"CRITICAL {city}",
        },
    }


def test_market_monitor_cycle_restores_critical_alert_push(monkeypatch):
    payload = _focus_payload(
        city="ankara",
        severity="high",
        trigger_count=2,
        signal_label="BUY YES",
        yes_buy=0.05,
        edge_percent=12.0,
    )
    monkeypatch.setattr(
        "src.utils.telegram_push.build_trade_alert_for_city",
        lambda city, config: payload,
    )
    bot = _DigestBot()
    state = {}

    dirty = _run_market_monitor_cycle(
        bot=bot,
        config={},
        chat_ids=["chat"],
        cities=["ankara"],
        state=state,
        alert_cooldown_sec=1800,
        min_severity="medium",
        min_trigger_count=2,
        sleep_between_cities_sec=0,
    )

    assert dirty is True
    assert [row["text"] for row in bot.messages] == ["CRITICAL ankara"]
    assert state["last_by_city"]["ankara"]["active"] is True


