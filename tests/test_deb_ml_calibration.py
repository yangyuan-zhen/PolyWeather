"""Tests for the LightGBM quantile residual calibrator (DEB layer 3)."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone

import pytest

from src.analysis.deb_algorithm import calculate_deb_prediction
from src.analysis.deb_ml_calibration import (
    apply_deb_ml_calibration,
    train_deb_quantile_calibrator,
)

_DAYS = 60
_CITIES = ["ankara", "london", "tokyo"]


def _past_date(days_ago: int) -> str:
    return (
        datetime.now(timezone.utc) - timedelta(days=days_ago)
    ).strftime("%Y-%m-%d")


def _build_daily_records(
    cities=None,
    days: int = _DAYS,
    *,
    residual: float = 1.5,
    forecast_values=(20.0, 21.0),
):
    """History where raw DEB lands on the equal-weight mean and actuals
    carry a constant residual above it, so the calibrator has a signal."""
    cities = cities or _CITIES
    records = {}
    for city in cities:
        by_date = {}
        for offset in range(days, 0, -1):
            date_str = _past_date(offset)
            forecasts = {
                "ECMWF": forecast_values[0],
                "GFS": forecast_values[1],
            }
            by_date[date_str] = {
                "actual_high": sum(forecasts.values()) / len(forecasts) + residual,
                "forecasts": dict(forecasts),
            }
        records[city] = by_date
    return records


def test_train_insufficient_global_samples(tmp_path):
    records = _build_daily_records(["ankara"], days=5)
    result = train_deb_quantile_calibrator(
        records,
        model_dir=str(tmp_path / "models"),
    )
    assert result["trained"] is False
    assert result["reason"] == "insufficient_global_samples"
    assert result["samples"] < 150


def test_train_insufficient_city_samples(tmp_path):
    records = _build_daily_records(
        ["ankara", "london", "tokyo"],
        days=6,
    )
    result = train_deb_quantile_calibrator(
        records,
        model_dir=str(tmp_path / "models"),
        min_global_samples=10,
        min_city_samples=5,
    )
    assert result["trained"] is False
    assert result["reason"] == "insufficient_city_samples"


def test_train_success_writes_bundle(tmp_path):
    model_dir = tmp_path / "models"
    records = _build_daily_records()
    result = train_deb_quantile_calibrator(
        records,
        model_dir=str(model_dir),
    )
    assert result["trained"] is True
    assert result["samples"] >= 150
    assert "model_version" in result
    assert result["validation"]["ordered_quantiles"] is True

    for key in ("q10.pkl", "q50.pkl", "q90.pkl", "metadata.json"):
        assert (model_dir / key).is_file(), f"missing {key}"

    metadata = json.loads((model_dir / "metadata.json").read_text(encoding="utf-8"))
    assert set(metadata["city_index"]) == set(_CITIES)
    assert metadata["feature_names"] == [
        "city_code",
        "raw_deb",
        "model_median",
        "model_spread",
        "n_models",
        "month",
        "day_of_year",
    ]
    for city in _CITIES:
        assert metadata["city_counts"][city] >= 5


def test_train_missing_lightgbm(tmp_path, monkeypatch):
    monkeypatch.setitem(sys.modules, "lightgbm", None)
    records = _build_daily_records()
    result = train_deb_quantile_calibrator(
        records,
        model_dir=str(tmp_path / "models"),
    )
    assert result["trained"] is False
    assert result["reason"] == "missing_lightgbm"


def test_apply_flag_off_returns_none(tmp_path, monkeypatch):
    monkeypatch.delenv("POLYWEATHER_DEB_ML_CALIBRATION", raising=False)
    result = apply_deb_ml_calibration(
        "ankara",
        20.0,
        {"ECMWF": 20.0, "GFS": 21.0},
        model_dir=str(tmp_path / "models"),
    )
    assert result is None


def test_apply_missing_model_returns_none(tmp_path, monkeypatch):
    monkeypatch.setenv("POLYWEATHER_DEB_ML_CALIBRATION", "1")
    result = apply_deb_ml_calibration(
        "ankara",
        20.0,
        {"ECMWF": 20.0, "GFS": 21.0},
        model_dir=str(tmp_path / "models"),
    )
    assert result is None


def test_apply_success_uses_trained_bundle(tmp_path, monkeypatch):
    monkeypatch.setenv("POLYWEATHER_DEB_ML_CALIBRATION", "1")
    model_dir = tmp_path / "models"
    train_deb_quantile_calibrator(
        _build_daily_records(),
        model_dir=str(model_dir),
    )

    result = apply_deb_ml_calibration(
        "ankara",
        20.0,
        {"ECMWF": 20.0, "GFS": 21.0},
        model_dir=str(model_dir),
    )
    assert result is not None
    residuals = result["residual_quantiles"]
    assert residuals["q10"] <= residuals["q50"] <= residuals["q90"]
    assert result["adjustment"] == residuals["q50"]
    assert result["prediction"] == round(20.0 + residuals["q50"], 1)
    assert result["raw_prediction"] == 20.0
    assert result["samples"] >= 150
    assert "model_version" in result


def test_apply_unknown_city_still_predicts(tmp_path, monkeypatch):
    monkeypatch.setenv("POLYWEATHER_DEB_ML_CALIBRATION", "1")
    model_dir = tmp_path / "models"
    train_deb_quantile_calibrator(
        _build_daily_records(),
        model_dir=str(model_dir),
    )

    result = apply_deb_ml_calibration(
        "not_in_training",
        20.0,
        {"ECMWF": 20.0, "GFS": 21.0},
        model_dir=str(model_dir),
    )
    # Unknown cities fall back to the global pattern via city_code=-1.
    assert result is not None
    assert result["raw_prediction"] == 20.0


def test_apply_no_forecasts_returns_none(tmp_path, monkeypatch):
    monkeypatch.setenv("POLYWEATHER_DEB_ML_CALIBRATION", "1")
    model_dir = tmp_path / "models"
    train_deb_quantile_calibrator(
        _build_daily_records(),
        model_dir=str(model_dir),
    )

    result = apply_deb_ml_calibration(
        "ankara",
        20.0,
        {},
        model_dir=str(model_dir),
    )
    assert result is None


def test_calculate_deb_prediction_uses_ml_path_when_enabled(tmp_path, monkeypatch):
    monkeypatch.setenv("POLYWEATHER_DEB_ML_CALIBRATION", "1")
    model_dir = tmp_path / "models"
    train_deb_quantile_calibrator(
        _build_daily_records(),
        model_dir=str(model_dir),
    )
    monkeypatch.setenv("POLYWEATHER_DEB_ML_MODEL_DIR", str(model_dir))
    monkeypatch.setattr(
        "src.analysis.deb_algorithm.load_history",
        lambda _: {
            "ankara": {
                _past_date(1): {
                    "actual_high": 22.0,
                    "deb_prediction": 20.0,
                    "forecasts": {"ECMWF": 20.0, "GFS": 20.0},
                },
                _past_date(2): {
                    "actual_high": 23.0,
                    "deb_prediction": 21.0,
                    "forecasts": {"ECMWF": 21.0, "GFS": 21.0},
                },
                _past_date(3): {
                    "actual_high": 25.0,
                    "deb_prediction": 24.0,
                    "forecasts": {"ECMWF": 24.0, "GFS": 24.0},
                },
            }
        },
    )

    result = calculate_deb_prediction(
        "ankara",
        {"ECMWF": 24.0, "GFS": 24.0},
    )

    assert result["version"] == "deb_v4_lightgbm_calibrated"
    assert result["selected_version"] == "deb_v4_lightgbm_calibrated"
    assert result["guard_reason"] == "lightgbm_calibrated"
    assert result["raw_prediction"] == 24.0
    ml = result["ml_calibration"]
    assert ml["raw_prediction"] == 24.0
    assert result["prediction"] == ml["prediction"]
    assert result["bias_adjustment"] == ml["adjustment"]
    assert "lightgbm_calib" in result["weights_info"]


def test_calculate_deb_prediction_falls_back_when_flag_off(tmp_path, monkeypatch):
    monkeypatch.delenv("POLYWEATHER_DEB_ML_CALIBRATION", raising=False)
    model_dir = tmp_path / "models"
    train_deb_quantile_calibrator(
        _build_daily_records(),
        model_dir=str(model_dir),
    )
    monkeypatch.setenv("POLYWEATHER_DEB_ML_MODEL_DIR", str(model_dir))
    monkeypatch.setattr(
        "src.analysis.deb_algorithm.load_history",
        lambda _: {
            "ankara": {
                _past_date(1): {
                    "actual_high": 22.0,
                    "deb_prediction": 20.0,
                    "forecasts": {"ECMWF": 20.0, "GFS": 20.0},
                },
                _past_date(2): {
                    "actual_high": 23.0,
                    "deb_prediction": 21.0,
                    "forecasts": {"ECMWF": 21.0, "GFS": 21.0},
                },
                _past_date(3): {
                    "actual_high": 25.0,
                    "deb_prediction": 24.0,
                    "forecasts": {"ECMWF": 24.0, "GFS": 24.0},
                },
            }
        },
    )

    result = calculate_deb_prediction(
        "ankara",
        {"ECMWF": 24.0, "GFS": 24.0},
    )

    assert result["version"] == "deb_v3_guarded_calibrated"
    assert "ml_calibration" not in result


@pytest.mark.parametrize(
    "flag_value,enabled",
    [
        ("1", True),
        ("true", True),
        ("on", True),
        ("0", False),
        ("", False),
        ("no", False),
    ],
)
def test_flag_parsing(flag_value, enabled, monkeypatch):
    if flag_value:
        monkeypatch.setenv("POLYWEATHER_DEB_ML_CALIBRATION", flag_value)
    else:
        monkeypatch.delenv("POLYWEATHER_DEB_ML_CALIBRATION", raising=False)
    from src.analysis.deb_ml_calibration import _deb_ml_flag_enabled

    assert _deb_ml_flag_enabled() is enabled
