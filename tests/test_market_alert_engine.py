from src.analysis.market_alert_engine import build_trading_alerts


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
                "name": "Ankara (Bölge/Center)",
                "istNo": "17130",
                "lat": 39.95,
                "lon": 32.97,
                "temp": 12.4,
            },
            {
                "name": "Airport (MGM/17128)",
                "istNo": "17128",
                "lat": 40.1281,
                "lon": 32.9951,
                "temp": 11.2,
            },
        ],
    }


def _sample_market_snapshot():
    return {
        "city": "ankara",
        "target_date": "2026-03-07",
        "markets": [
            {
                "id": "m1",
                "question": "Will temperature in Ankara exceed 11.5°C on March 7?",
                "threshold": 11.5,
                "threshold_unit": "C",
                "contract_type": "exceed",
                "outcomes": [
                    {"name": "Yes", "buy_price": 0.73, "last_price": 0.72},
                    {"name": "No", "buy_price": 0.27, "last_price": 0.28},
                ],
            }
        ],
    }


def test_trading_alerts_all_core_rules_trigger():
    out = build_trading_alerts(
        city_weather=_sample_weather_payload(),
        market_snapshot=_sample_market_snapshot(),
        map_url="https://example.com/map",
    )

    assert out["trigger_count"] >= 3
    assert out["rules"]["momentum_spike"]["triggered"] is True
    assert out["rules"]["forecast_breakthrough"]["triggered"] is True
    assert out["rules"]["kill_zone"]["triggered"] is True
    assert out["rules"]["advection"]["triggered"] is True

    msg = out["telegram"]["zh"]
    assert "PolyWeather 异动预警" in msg
    assert "动量突变" in msg
    assert "盘口：" in msg
    assert "Yes 买 73c / 卖 -" in msg
    assert "No 买 27c / 卖 -" in msg
    assert "No\" 单需谨慎" in msg
    assert "https://example.com/map" in msg


def test_forecast_breakthrough_not_triggered_when_current_not_above_margin():
    city_weather = _sample_weather_payload()
    city_weather["current"]["temp"] = 11.0

    out = build_trading_alerts(
        city_weather=city_weather,
        market_snapshot=_sample_market_snapshot(),
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
        market_snapshot={"city": "ankara", "target_date": "2026-03-07", "markets": []},
    )

    center_rule = out["rules"]["ankara_center_deb_hit"]
    assert center_rule["triggered"] is True
    assert center_rule["force_push"] is True
    assert out["severity"] in ("medium", "high")
    assert "Center信号" in out["telegram"]["zh"]
