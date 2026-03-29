import src.models.lgbm_daily_high as runtime


class _FakeBooster:
    best_iteration = 7

    def predict(self, rows, num_iteration=None):
        assert len(rows) == 1
        return [14.36]


def test_predict_lgbm_daily_high_skips_when_disabled(monkeypatch):
    monkeypatch.setenv("POLYWEATHER_LGBM_ENABLED", "false")
    prediction, meta = runtime.predict_lgbm_daily_high(
        city_name="ankara",
        current_forecasts={"Open-Meteo": 12.4},
        deb_prediction=12.3,
        current_temp=11.0,
        max_so_far=11.4,
        humidity=62.0,
        wind_speed_kt=8.0,
        visibility_mi=6.0,
        local_hour=10,
        local_date="2026-03-24",
        peak_status="before",
        history_data={},
    )
    assert prediction is None
    assert meta["reason"] == "disabled"


def test_predict_lgbm_daily_high_returns_prediction(monkeypatch):
    monkeypatch.setenv("POLYWEATHER_LGBM_ENABLED", "true")
    monkeypatch.setenv("POLYWEATHER_LGBM_MIN_HISTORY_POINTS", "3")
    monkeypatch.setattr(runtime, "_load_schema", lambda path: {"feature_names": runtime.FEATURE_NAMES})
    monkeypatch.setattr(runtime, "_load_booster", lambda path: _FakeBooster())

    history_data = {
        "ankara": {
            "2026-03-20": {"actual_high": 10.0},
            "2026-03-21": {"actual_high": 11.0},
            "2026-03-22": {"actual_high": 13.0},
            "2026-03-23": {"actual_high": 12.0},
        }
    }
    prediction, meta = runtime.predict_lgbm_daily_high(
        city_name="ankara",
        current_forecasts={"Open-Meteo": 12.4, "ECMWF": 12.1, "GFS": 11.9},
        deb_prediction=12.3,
        current_temp=11.0,
        max_so_far=11.4,
        humidity=62.0,
        wind_speed_kt=8.0,
        visibility_mi=6.0,
        local_hour=10,
        local_date="2026-03-24",
        peak_status="before",
        history_data=history_data,
    )
    assert prediction == 14.4
    assert meta["reason"] == "ok"
    assert meta["history_count"] == 4


def test_predict_lgbm_daily_high_requires_min_history(monkeypatch):
    monkeypatch.setenv("POLYWEATHER_LGBM_ENABLED", "true")
    monkeypatch.setenv("POLYWEATHER_LGBM_MIN_HISTORY_POINTS", "5")
    monkeypatch.setattr(runtime, "_load_schema", lambda path: {"feature_names": runtime.FEATURE_NAMES})
    monkeypatch.setattr(runtime, "_load_booster", lambda path: _FakeBooster())

    history_data = {
        "ankara": {
            "2026-03-21": {"actual_high": 11.0},
            "2026-03-22": {"actual_high": 13.0},
            "2026-03-23": {"actual_high": 12.0},
        }
    }
    prediction, meta = runtime.predict_lgbm_daily_high(
        city_name="ankara",
        current_forecasts={"Open-Meteo": 12.4},
        deb_prediction=12.3,
        current_temp=11.0,
        max_so_far=11.4,
        humidity=62.0,
        wind_speed_kt=8.0,
        visibility_mi=6.0,
        local_hour=10,
        local_date="2026-03-24",
        peak_status="before",
        history_data=history_data,
    )
    assert prediction is None
    assert meta["reason"] == "insufficient_history"
