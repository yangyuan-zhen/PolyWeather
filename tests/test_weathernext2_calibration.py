from __future__ import annotations

from src.analysis.weathernext2_calibration import (
    apply_quantile_calibration_to_payload,
    train_lightgbm_quantile_calibrator,
)
from src.data_collection.weathernext2_sources import build_weathernext2_city_probability


def _synthetic_training_rows(count: int = 170):
    rows = []
    for idx in range(count):
        city = "houston" if idx % 2 == 0 else "shanghai"
        median = 30.0 + (idx % 7) * 0.2
        residual = 1.0 if city == "houston" else -0.5
        rows.append(
            {
                "city": city,
                "target_date": f"2026-05-{idx % 28 + 1:02d}",
                "actual_high_c": median + residual,
                "weathernext2": {
                    "summary": {
                        "mean": median,
                        "median": median,
                        "p10": median - 1.0,
                        "p25": median - 0.5,
                        "p75": median + 0.5,
                        "p90": median + 1.0,
                        "spread": 2.0,
                    }
                },
                "deb_prediction_c": median + 0.2,
                "model_median_c": median + 0.1,
                "model_spread": 1.4,
                "current_max_so_far_c": median - 2.0,
                "local_hour": 12,
            }
        )
    return rows


def test_lightgbm_quantile_calibrator_trains_and_saves_ordered_quantiles(tmp_path):
    result = train_lightgbm_quantile_calibrator(
        _synthetic_training_rows(),
        model_dir=tmp_path,
        min_global_samples=150,
        min_city_samples=5,
    )

    assert result["trained"] is True
    assert result["samples"] == 170
    assert (tmp_path / "metadata.json").is_file()
    assert (tmp_path / "q10.pkl").is_file()
    assert (tmp_path / "q50.pkl").is_file()
    assert (tmp_path / "q90.pkl").is_file()
    assert result["validation"]["ordered_quantiles"] is True


def test_lightgbm_quantile_calibrator_skips_when_samples_are_insufficient(tmp_path):
    result = train_lightgbm_quantile_calibrator(
        _synthetic_training_rows(20),
        model_dir=tmp_path,
        min_global_samples=150,
        min_city_samples=5,
    )

    assert result["trained"] is False
    assert result["reason"] == "insufficient_global_samples"


def test_calibrated_distribution_rebuilds_market_buckets_from_shifted_members(tmp_path):
    train_lightgbm_quantile_calibrator(
        _synthetic_training_rows(),
        model_dir=tmp_path,
        min_global_samples=150,
        min_city_samples=5,
    )
    raw = build_weathernext2_city_probability(
        city="houston",
        member_highs=[30.0, 30.2, 30.4, 30.6],
        temp_symbol="°C",
        target_date="2026-06-29",
    )

    calibrated = apply_quantile_calibration_to_payload(raw, model_dir=tmp_path)

    assert calibrated["calibration"]["engine"] == "lightgbm_quantile"
    assert calibrated["calibration"]["samples"] == 170
    assert calibrated["calibration"]["raw_summary"]["median"] == raw["summary"]["median"]
    assert calibrated["calibration"]["calibrated_summary"]["median"] > raw["summary"]["median"]
    assert calibrated["buckets"]
    assert calibrated["top_bucket"]["label"].endswith("°C")
