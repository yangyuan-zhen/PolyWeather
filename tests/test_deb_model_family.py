from src.analysis.deb_algorithm import (
    _collapse_forecasts_for_deb,
    calculate_dynamic_weights,
)


def test_deb_collapses_regional_model_families_before_blending():
    collapsed = _collapse_forecasts_for_deb(
        {
            "ECMWF": 20.0,
            "ECMWF AIFS": 20.5,
            "GFS": 19.5,
            "ICON": 21.0,
            "ICON-EU": 21.4,
            "ICON-D2": 21.8,
            "GEM": 18.8,
            "GDPS": 19.0,
            "RDPS": 19.4,
            "HRDPS": 20.2,
            "JMA": 19.8,
        }
    )

    assert collapsed == {
        "ECMWF": 20.0,
        "ECMWF AIFS": 20.5,
        "GFS": 19.5,
        "ICON-D2": 21.8,
        "HRDPS": 20.2,
        "JMA": 19.8,
    }


def test_deb_equal_weight_uses_deduped_family_values(monkeypatch):
    monkeypatch.setattr("src.analysis.deb_algorithm.load_history", lambda _: {})

    blended, info = calculate_dynamic_weights(
        "ankara",
        {
            "ECMWF": 20.0,
            "GFS": 20.0,
            "ICON": 30.0,
            "ICON-EU": 40.0,
            "ICON-D2": 50.0,
        },
    )

    assert blended == 30.0
    assert "家族去重" in info


def test_deb_weighted_path_uses_deduped_family_values(monkeypatch):
    monkeypatch.setattr(
        "src.analysis.deb_algorithm.load_history",
        lambda _: {
            "ankara": {
                "2026-04-14": {
                    "actual_high": 22.0,
                    "forecasts": {
                        "ECMWF": 22.0,
                        "GFS": 21.0,
                        "ICON-D2": 30.0,
                    },
                },
                "2026-04-15": {
                    "actual_high": 23.0,
                    "forecasts": {
                        "ECMWF": 23.0,
                        "GFS": 22.0,
                        "ICON-D2": 31.0,
                    },
                },
            }
        },
    )

    blended, info = calculate_dynamic_weights(
        "ankara",
        {
            "ECMWF": 24.0,
            "GFS": 24.0,
            "ICON": 32.0,
            "ICON-EU": 34.0,
            "ICON-D2": 36.0,
        },
        lookback_days=5,
    )

    assert blended < 30.0
    assert "ICON-D2" in info
    assert "家族去重" in info


def test_compute_hourly_model_errors_basic():
    from src.analysis.deb_algorithm import compute_hourly_model_errors

    hourly_forecasts = {
        "ECMWF": [15.0, 15.5, 16.0, 16.5, 17.0, 17.5],
        "GFS":   [14.5, 15.0, 15.5, 16.0, 16.5, 17.0],
    }
    hourly_actuals = [15.2, 15.8, 16.3, 16.8, 17.4, 18.0]

    result = compute_hourly_model_errors(hourly_forecasts, hourly_actuals)

    assert "ECMWF" in result
    assert "GFS" in result
    assert result["ECMWF"]["samples"] == 6
    assert result["GFS"]["samples"] == 6
    # ECMWF predicted lower, should have smaller MAE
    assert result["ECMWF"]["mae"] < result["GFS"]["mae"]
    assert result["ECMWF"]["rmse"] > 0
    assert result["GFS"]["rmse"] > 0


def test_compute_hourly_model_errors_too_few_samples():
    from src.analysis.deb_algorithm import compute_hourly_model_errors

    hourly_forecasts = {"ECMWF": [15.0, 15.5]}
    hourly_actuals = [15.0, 15.5]

    result = compute_hourly_model_errors(hourly_forecasts, hourly_actuals)
    assert result == {}  # < 6 samples, returns empty


def test_blend_mae_with_hourly():
    from src.analysis.deb_algorithm import _blend_mae

    # Full 24 hourly samples → 0.7 hourly weight
    h_err = {"mae": 0.8, "rmse": 1.0, "samples": 24}
    blended = _blend_mae(1.5, h_err)
    # 1.5 * 0.3 + 0.8 * 0.7 = 0.45 + 0.56 = 1.01
    assert abs(blended - 1.01) < 0.01

    # 12 hourly samples → ~0.35 hourly weight
    h_err2 = {"mae": 1.0, "rmse": 1.2, "samples": 12}
    blended2 = _blend_mae(2.0, h_err2)
    # 12/24 * 0.7 = 0.35 hourly weight
    expected = 2.0 * (1 - 0.35) + 1.0 * 0.35  # 1.30 + 0.35 = 1.65
    assert abs(blended2 - expected) < 0.01

    # No hourly error → returns daily MAE unchanged
    blended3 = _blend_mae(2.5, None)
    assert blended3 == 2.5

    # Too few samples (< 6) → returns daily MAE unchanged
    h_err4 = {"mae": 0.5, "samples": 3}
    blended4 = _blend_mae(3.0, h_err4)
    assert blended4 == 3.0
