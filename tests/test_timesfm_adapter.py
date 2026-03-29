import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.models.timesfm_adapter import predict_timesfm_daily


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def test_predict_timesfm_daily_disabled_by_default(monkeypatch):
    monkeypatch.delenv("POLYWEATHER_TIMESFM_ENABLED", raising=False)
    monkeypatch.delenv("POLYWEATHER_TIMESFM_SERVICE_URL", raising=False)

    result = predict_timesfm_daily(
        city_name="ankara",
        forecast_dates=["2026-03-15", "2026-03-16"],
    )

    assert result["predictions"] == {}
    assert result["enabled"] is False
    assert result["reason"] == "disabled"


def test_predict_timesfm_daily_posts_actual_history_to_remote_service(monkeypatch):
    captured = {}

    def fake_load_history(_filepath):
        return {
            "ankara": {
                "2026-03-01": {"actual_high": 10.0},
                "2026-03-02": {"actual_high": 11.0},
                "2026-03-03": {"actual_high": 12.0},
                "2026-03-04": {"actual_high": 13.0},
                "2026-03-05": {"actual_high": 14.0},
                "2026-03-06": {"actual_high": 15.0},
                "2026-03-07": {"actual_high": 16.0},
                "2026-03-08": {"actual_high": 15.0},
                "2026-03-09": {"actual_high": 14.0},
                "2026-03-10": {"actual_high": 15.0},
                "2026-03-11": {"actual_high": 16.0},
                "2026-03-12": {"actual_high": 17.0},
                "2026-03-13": {"actual_high": 16.0},
                "2026-03-14": {"actual_high": 15.0},
            }
        }

    def fake_post(url, json, timeout):
        captured["url"] = url
        captured["json"] = json
        captured["timeout"] = timeout
        return _FakeResponse(
            {
                "model": "TimesFM",
                "model_id": "google/timesfm-2.5-200m-pytorch",
                "predictions": {
                    "2026-03-15": 15.4,
                    "2026-03-16": 15.9,
                },
            }
        )

    monkeypatch.setenv("POLYWEATHER_TIMESFM_ENABLED", "true")
    monkeypatch.setenv("POLYWEATHER_TIMESFM_SERVICE_URL", "http://timesfm:8011")
    monkeypatch.setattr("src.analysis.deb_algorithm.load_history", fake_load_history)
    monkeypatch.setattr("src.models.timesfm_adapter.requests.post", fake_post)

    result = predict_timesfm_daily(
        city_name="ankara",
        forecast_dates=["2026-03-15", "2026-03-16"],
        daily_model_forecasts={
            "2026-03-15": {"ECMWF": 15.0, "GFS": 16.0},
            "2026-03-16": {"ECMWF": 16.0, "GFS": 17.0},
        },
    )

    assert captured["url"] == "http://timesfm:8011/predict/daily"
    assert captured["timeout"] == 12.0
    assert captured["json"]["series_frequency"] == "D"
    assert captured["json"]["series_kind"] == "actual_high"
    assert len(captured["json"]["series"]) == 14
    assert result["enabled"] is True
    assert result["reason"] == "ok"
    assert result["history_count"] == 14
    assert result["predictions"] == {
        "2026-03-15": 15.4,
        "2026-03-16": 15.9,
    }


def test_predict_timesfm_daily_skips_when_history_is_insufficient(monkeypatch):
    def fake_load_history(_filepath):
        return {
            "ankara": {
                "2026-03-10": {"actual_high": 15.0},
                "2026-03-11": {"actual_high": 16.0},
            }
        }

    monkeypatch.setenv("POLYWEATHER_TIMESFM_ENABLED", "true")
    monkeypatch.setenv("POLYWEATHER_TIMESFM_SERVICE_URL", "http://timesfm:8011")
    monkeypatch.setattr("src.analysis.deb_algorithm.load_history", fake_load_history)

    result = predict_timesfm_daily(
        city_name="ankara",
        forecast_dates=["2026-03-15", "2026-03-16"],
    )

    assert result["predictions"] == {}
    assert result["enabled"] is True
    assert result["reason"] == "insufficient_history"
    assert result["history_count"] == 2
