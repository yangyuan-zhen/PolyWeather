import json
from pathlib import Path

from src.analysis.probability_calibration import (
    ENGINE_MODE_EMOS_PRIMARY,
    ENGINE_MODE_EMOS_SHADOW,
    ENGINE_MODE_LEGACY,
    apply_probability_calibration,
    build_probability_features,
    fit_calibration,
)


def _write_calibration(tmp_path: Path):
    payload = {
        "version": "test-emos-v1",
        "source": "tmp/test-emos-v1.json",
        "global": {
            "mu": {
                "intercept": 0.0,
                "raw_mu_coef": 0.0,
                "deb_coef": 1.0,
                "ens_median_coef": 0.0,
                "max_so_far_gap_coef": 0.0,
            },
            "sigma": {
                "intercept": 0.0,
                "raw_sigma_coef": 1.0,
                "spread_coef": 0.0,
                "peak_flag_coef": 0.0,
                "max_so_far_gap_coef": 0.0,
            },
        },
        "cities": {
            "ankara": {
                "mu_bias": 0.5,
                "sigma_scale": 1.0,
            }
        },
        "metrics": {"sample_count": 10, "mean_crps": 0.4},
    }
    path = tmp_path / "calibration.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_shadow_mode_keeps_legacy_distribution(tmp_path):
    calibration_path = _write_calibration(tmp_path)
    features = build_probability_features(
        city_name="ankara",
        raw_mu=9.0,
        raw_sigma=1.0,
        deb_prediction=10.0,
        ens_data={"median": 9.5, "p10": 8.0, "p90": 11.0},
        current_forecasts={"Open-Meteo": 9.0, "MGM": 10.0},
        max_so_far=8.8,
        peak_status="before",
        local_hour_frac=11.0,
    )
    legacy_distribution = [{"value": 9, "range": "[8.5~9.5)", "probability": 0.7}]

    result = apply_probability_calibration(
        city_name="ankara",
        temp_symbol="°C",
        raw_mu=9.0,
        raw_sigma=1.0,
        max_so_far=8.8,
        legacy_distribution=legacy_distribution,
        features=features,
        calibration_path=str(calibration_path),
        mode=ENGINE_MODE_EMOS_SHADOW,
    )

    assert result["mode"] == ENGINE_MODE_EMOS_SHADOW
    assert result["engine"] == ENGINE_MODE_LEGACY
    assert result["distribution"] == legacy_distribution
    assert result["shadow_distribution"]
    assert result["calibrated_mu"] == 10.5


def test_primary_mode_switches_to_calibrated_distribution(tmp_path):
    calibration_path = _write_calibration(tmp_path)
    features = build_probability_features(
        city_name="ankara",
        raw_mu=9.0,
        raw_sigma=1.0,
        deb_prediction=10.0,
        ens_data={"median": 9.5, "p10": 8.0, "p90": 11.0},
        current_forecasts={"Open-Meteo": 9.0, "MGM": 10.0},
        max_so_far=8.8,
        peak_status="before",
        local_hour_frac=11.0,
    )

    result = apply_probability_calibration(
        city_name="ankara",
        temp_symbol="°C",
        raw_mu=9.0,
        raw_sigma=1.0,
        max_so_far=8.8,
        legacy_distribution=[{"value": 9, "range": "[8.5~9.5)", "probability": 0.7}],
        features=features,
        calibration_path=str(calibration_path),
        mode=ENGINE_MODE_EMOS_PRIMARY,
    )

    assert result["mode"] == ENGINE_MODE_EMOS_PRIMARY
    assert result["engine"] == "emos"
    assert result["calibrated_mu"] == 10.5
    assert result["distribution"]
    assert result["distribution"][0]["value"] >= 10


def test_fit_calibration_returns_metrics():
    samples = [
        {
            "city": "ankara",
            "actual_high": 11.0,
            "raw_mu": 10.2,
            "raw_sigma": 1.0,
            "deb_prediction": 10.5,
            "ens_median": 10.6,
            "ensemble_spread": 0.9,
            "max_so_far_gap": 0.5,
            "peak_flag": 0.0,
        },
        {
            "city": "ankara",
            "actual_high": 12.0,
            "raw_mu": 11.1,
            "raw_sigma": 1.0,
            "deb_prediction": 11.3,
            "ens_median": 11.2,
            "ensemble_spread": 1.0,
            "max_so_far_gap": 0.4,
            "peak_flag": 0.5,
        },
        {
            "city": "new york",
            "actual_high": 19.0,
            "raw_mu": 18.2,
            "raw_sigma": 1.4,
            "deb_prediction": 18.4,
            "ens_median": 18.3,
            "ensemble_spread": 1.2,
            "max_so_far_gap": 0.6,
            "peak_flag": 1.0,
        },
    ]

    result = fit_calibration(samples, version="unit-test-v1")

    assert result["version"] == "unit-test-v1"
    assert result["metrics"]["sample_count"] == 3
    assert "mean_crps" in result["metrics"]
