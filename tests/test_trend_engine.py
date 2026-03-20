"""
Unit tests for trend_engine core logic.
Tests: μ/σ calculation, dead market detection, forecast bust grading.
"""

import sys
import os

# Ensure project root is in path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from unittest.mock import patch
from src.analysis.trend_engine import analyze_weather_trend, _sf


# ─── Helpers ───

def _make_weather_data(
    cur_temp=25.0,
    max_so_far=28.0,
    om_today_high=30.0,
    ens_median=29.0,
    ens_p10=27.0,
    ens_p90=31.0,
    local_time="2026-03-04 14:30",
    recent_temps=None,
    multi_model=None,
    recent_obs=None,
):
    """Build a minimal weather_data dict for testing."""
    data = {
        "metar": {
            "current": {
                "temp": cur_temp,
                "max_temp_so_far": max_so_far,
                "max_temp_time": "14:00",
                "wind_speed_kt": 5,
                "wind_dir": 180,
                "humidity": 50,
                "clouds": [{"cover": "SCT", "base": 5000}],
            },
            "recent_temps": recent_temps or [("14:00", 27.0), ("13:00", 26.0), ("12:00", 25.0)],
            "recent_obs": recent_obs or [],
        },
        "open-meteo": {
            "current": {"local_time": local_time},
            "daily": {
                "temperature_2m_max": [om_today_high],
                "sunrise": ["06:30"],
                "sunset": ["18:30"],
            },
            "hourly": {
                "time": [f"2026-03-04T{h:02d}:00" for h in range(24)],
                "temperature_2m": [15 + (h - 6) * 1.5 if 6 <= h <= 14 else 20 - (h - 14) * 0.5 for h in range(24)],
                "shortwave_radiation": [0 if h < 6 or h > 18 else 200 + h * 20 for h in range(24)],
            },
        },
        "ensemble": {
            "median": ens_median,
            "p10": ens_p10,
            "p90": ens_p90,
        },
        "multi_model": {"forecasts": multi_model or {}},
        "nws": {},
    }
    return data


# ─── Tests: _sf ───

class TestSafeFloat:
    def test_none(self):
        assert _sf(None) is None

    def test_int(self):
        assert _sf(5) == 5.0

    def test_str_number(self):
        assert _sf("3.14") == 3.14

    def test_invalid_str(self):
        assert _sf("abc") is None


# ─── Tests: μ Calculation ───

class TestMuCalculation:
    @patch("src.analysis.trend_engine.calculate_dynamic_weights", return_value=(None, ""))
    @patch("src.analysis.trend_engine.get_deb_accuracy", return_value=None)
    @patch("src.analysis.trend_engine.update_daily_record")
    def test_normal_mu_blends_forecast_and_ensemble(self, _udr, _deb_acc, _dw):
        """Normal case: μ = forecast_median * 0.7 + ens_median * 0.3"""
        data = _make_weather_data(
            cur_temp=25.0, max_so_far=26.0,
            om_today_high=30.0, ens_median=29.0,
            local_time="2026-03-04 10:00"  # Before peak window to prevent early bust override
        )
        _, _, sd = analyze_weather_trend(data, "°C", "test_city")

        mu = sd["mu"]
        # forecast_median = 30.0, ens_median = 29.0 → 30*0.7 + 29*0.3 = 29.7
        assert mu is not None
        assert 29.0 <= mu <= 31.0  # Reasonable range

    @patch("src.analysis.trend_engine.calculate_dynamic_weights", return_value=(None, ""))
    @patch("src.analysis.trend_engine.get_deb_accuracy", return_value=None)
    @patch("src.analysis.trend_engine.update_daily_record")
    def test_reality_anchored_mu_on_forecast_bust(self, _udr, _deb_acc, _dw):
        """When past peak and actual << forecasts, μ anchors on actual max."""
        data = _make_weather_data(
            cur_temp=22.0, max_so_far=23.0,
            om_today_high=30.0, ens_median=29.0,
            local_time="2026-03-04 17:00",  # Past peak
            recent_temps=[("17:00", 22.0), ("16:00", 23.0), ("15:00", 23.0)],
        )
        _, _, sd = analyze_weather_trend(data, "°C", "test_city")

        mu = sd["mu"]
        # max_so_far=23 vs forecast_median=30 → bust → μ ≈ 23
        assert mu is not None
        assert mu <= 24.0, f"μ should anchor on actual max (23°C), got {mu}"

    @patch("src.analysis.trend_engine.calculate_dynamic_weights", return_value=(None, ""))
    @patch("src.analysis.trend_engine.get_deb_accuracy", return_value=None)
    @patch("src.analysis.trend_engine.update_daily_record")
    def test_mu_rises_when_actual_exceeds_forecast(self, _udr, _deb_acc, _dw):
        """When actual max exceeds μ, μ adjusts upward."""
        data = _make_weather_data(
            cur_temp=32.0, max_so_far=33.0,
            om_today_high=30.0, ens_median=29.0,
            local_time="2026-03-04 14:00",
            recent_temps=[("14:00", 32.0), ("13:00", 31.0), ("12:00", 30.0)],
        )
        _, _, sd = analyze_weather_trend(data, "°C", "test_city")

        mu = sd["mu"]
        assert mu is not None
        assert mu >= 33.0, f"μ should be >= actual max (33°C), got {mu}"


# ─── Tests: Dead Market ───

class TestDeadMarket:
    @patch("src.analysis.trend_engine.calculate_dynamic_weights", return_value=(None, ""))
    @patch("src.analysis.trend_engine.get_deb_accuracy", return_value=None)
    @patch("src.analysis.trend_engine.update_daily_record")
    def test_dead_market_after_peak_with_cooling(self, _udr, _deb_acc, _dw):
        """Past peak + 1.5°C drop → dead market."""
        data = _make_weather_data(
            cur_temp=26.0, max_so_far=28.0,
            local_time="2026-03-04 17:00",
            recent_temps=[("17:00", 26.0), ("16:00", 27.0), ("15:00", 28.0)],
        )
        _, _, sd = analyze_weather_trend(data, "°C", "test_city")

        ti = sd["trend_info"]
        assert ti["is_dead_market"] is True

    @patch("src.analysis.trend_engine.calculate_dynamic_weights", return_value=(None, ""))
    @patch("src.analysis.trend_engine.get_deb_accuracy", return_value=None)
    @patch("src.analysis.trend_engine.update_daily_record")
    def test_not_dead_market_during_peak_warming(self, _udr, _deb_acc, _dw):
        """During peak window while still warming → NOT dead market."""
        data = _make_weather_data(
            cur_temp=28.0, max_so_far=28.0,
            local_time="2026-03-04 14:00",
            recent_temps=[("14:00", 28.0), ("13:00", 27.0), ("12:00", 26.0)],
        )
        _, _, sd = analyze_weather_trend(data, "°C", "test_city")

        ti = sd["trend_info"]
        assert ti["is_dead_market"] is False

    @patch("src.analysis.trend_engine.calculate_dynamic_weights", return_value=(None, ""))
    @patch("src.analysis.trend_engine.get_deb_accuracy", return_value=None)
    @patch("src.analysis.trend_engine.update_daily_record")
    def test_dead_market_probability_is_100_percent(self, _udr, _deb_acc, _dw):
        """When dead market, probabilities collapse to 100% at settled value."""
        data = _make_weather_data(
            cur_temp=25.0, max_so_far=28.0,
            local_time="2026-03-04 22:00",  # Late night
            recent_temps=[("22:00", 25.0), ("21:00", 26.0), ("20:00", 27.0)],
        )
        _, _, sd = analyze_weather_trend(data, "°C", "test_city")

        assert sd["trend_info"]["is_dead_market"] is True
        probs = sd["probabilities"]
        assert len(probs) == 1
        assert probs[0]["value"] == 28  # round(28.0)
        assert probs[0]["probability"] == 1.0


# ─── Tests: Forecast Bust Detection ───

class TestForecastBust:
    @patch("src.analysis.trend_engine.calculate_dynamic_weights", return_value=(None, ""))
    @patch("src.analysis.trend_engine.get_deb_accuracy", return_value=None)
    @patch("src.analysis.trend_engine.update_daily_record")
    def test_heavy_forecast_bust_detected(self, _udr, _deb_acc, _dw):
        """Heavy bust: forecast_median - max_so_far > 5.0"""
        data = _make_weather_data(
            cur_temp=22.0, max_so_far=23.0,
            om_today_high=30.0, ens_median=29.0,
            local_time="2026-03-04 16:00",
            recent_temps=[("16:00", 22.0), ("15:00", 23.0), ("14:00", 23.0)],
        )
        _, ai_context, sd = analyze_weather_trend(data, "°C", "test_city")

        # forecast_median=30, max_so_far=23 → miss = 7°C → heavy
        assert "预报崩盘" in ai_context
        assert "重" in ai_context or "级失准" in ai_context

    @patch("src.analysis.trend_engine.calculate_dynamic_weights", return_value=(None, ""))
    @patch("src.analysis.trend_engine.get_deb_accuracy", return_value=None)
    @patch("src.analysis.trend_engine.update_daily_record")
    def test_no_bust_when_on_track(self, _udr, _deb_acc, _dw):
        """No bust when actual is close to forecast."""
        data = _make_weather_data(
            cur_temp=29.0, max_so_far=29.5,
            om_today_high=30.0, ens_median=29.5,
            local_time="2026-03-04 14:00",
            recent_temps=[("14:00", 29.0), ("13:00", 28.5), ("12:00", 28.0)],
        )
        _, ai_context, _ = analyze_weather_trend(data, "°C", "test_city")

        assert "预报崩盘" not in ai_context


# ─── Tests: Trend Direction ───

class TestTrendDirection:
    @patch("src.analysis.trend_engine.calculate_dynamic_weights", return_value=(None, ""))
    @patch("src.analysis.trend_engine.get_deb_accuracy", return_value=None)
    @patch("src.analysis.trend_engine.update_daily_record")
    def test_rising_trend(self, _udr, _deb_acc, _dw):
        data = _make_weather_data(
            recent_temps=[("14:00", 28.0), ("13:00", 27.0), ("12:00", 26.0)],
        )
        _, _, sd = analyze_weather_trend(data, "°C", "test_city")
        assert sd["trend_info"]["direction"] == "rising"

    @patch("src.analysis.trend_engine.calculate_dynamic_weights", return_value=(None, ""))
    @patch("src.analysis.trend_engine.get_deb_accuracy", return_value=None)
    @patch("src.analysis.trend_engine.update_daily_record")
    def test_falling_trend(self, _udr, _deb_acc, _dw):
        data = _make_weather_data(
            recent_temps=[("16:00", 25.0), ("15:00", 26.0), ("14:00", 27.0)],
        )
        _, _, sd = analyze_weather_trend(data, "°C", "test_city")
        assert sd["trend_info"]["direction"] == "falling"

    @patch("src.analysis.trend_engine.calculate_dynamic_weights", return_value=(None, ""))
    @patch("src.analysis.trend_engine.get_deb_accuracy", return_value=None)
    @patch("src.analysis.trend_engine.update_daily_record")
    def test_stagnant_trend(self, _udr, _deb_acc, _dw):
        data = _make_weather_data(
            recent_temps=[("14:00", 27.0), ("13:00", 27.0), ("12:00", 27.0)],
        )
        _, _, sd = analyze_weather_trend(data, "°C", "test_city")
        assert sd["trend_info"]["direction"] == "stagnant"
