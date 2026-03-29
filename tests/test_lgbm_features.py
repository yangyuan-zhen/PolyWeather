from src.models.lgbm_features import build_runtime_feature_map


def test_build_runtime_feature_map_derives_history_and_model_summary():
    history_data = {
        "ankara": {
            "2026-03-20": {"actual_high": 10.0},
            "2026-03-21": {"actual_high": 11.0},
            "2026-03-22": {"actual_high": 13.0},
            "2026-03-23": {"actual_high": 12.0},
        }
    }

    feature_map, meta = build_runtime_feature_map(
        city_name="ankara",
        current_forecasts={
            "Open-Meteo": 12.4,
            "ECMWF": 12.1,
            "GFS": 11.9,
            "GEM": 12.8,
        },
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

    assert meta["reason"] == "ok"
    assert meta["history_count"] == 4
    assert feature_map["actual_high_lag_1"] == 12.0
    assert feature_map["actual_high_lag_2"] == 13.0
    assert feature_map["actual_high_trend_3"] == 1.0
    assert feature_map["model_median"] == 12.4
    assert round(feature_map["model_spread"], 3) == 0.9
    assert feature_map["peak_status_code"] == 0.0


def test_build_runtime_feature_map_returns_none_without_history():
    feature_map, meta = build_runtime_feature_map(
        city_name="unknown-city",
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

    assert feature_map is None
    assert meta["reason"] == "no_history"
