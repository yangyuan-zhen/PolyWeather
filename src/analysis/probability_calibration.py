from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

import numpy as np

from src.analysis.settlement_rounding import apply_city_settlement, is_exact_settlement_city

ENGINE_MODE_LEGACY = "legacy"
ENGINE_MODE_EMOS_SHADOW = "emos_shadow"
ENGINE_MODE_EMOS_PRIMARY = "emos_primary"
VALID_ENGINE_MODES = {
    ENGINE_MODE_LEGACY,
    ENGINE_MODE_EMOS_SHADOW,
    ENGINE_MODE_EMOS_PRIMARY,
}

DEFAULT_CALIBRATION_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "artifacts",
    "probability_calibration",
    "default.json",
)

_CALIBRATION_CACHE: Dict[str, Dict[str, Any]] = {}
_CALIBRATION_MTIME: Dict[str, float] = {}


def _sf(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _coalesce_float(value: Any, default: float) -> float:
    parsed = _sf(value)
    return default if parsed is None else parsed


def _mean(values: Iterable[float]) -> Optional[float]:
    values = list(values)
    return (sum(values) / len(values)) if values else None


def resolve_probability_engine_mode(explicit_mode: Optional[str] = None) -> str:
    mode = str(
        explicit_mode
        or os.getenv("POLYWEATHER_PROBABILITY_ENGINE")
        or ENGINE_MODE_EMOS_SHADOW
    ).strip().lower()
    if mode not in VALID_ENGINE_MODES:
        return ENGINE_MODE_EMOS_SHADOW
    return mode


def load_calibration(calibration_path: Optional[str] = None) -> Dict[str, Any]:
    path = str(
        calibration_path
        or os.getenv("POLYWEATHER_PROBABILITY_CALIBRATION_FILE")
        or DEFAULT_CALIBRATION_FILE
    ).strip()
    if not path:
        return {}
    if not os.path.exists(path):
        return {}

    try:
        mtime = os.path.getmtime(path)
        cached = _CALIBRATION_CACHE.get(path)
        if cached and _CALIBRATION_MTIME.get(path) == mtime:
            return cached

        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            return {}

        _CALIBRATION_CACHE[path] = data
        _CALIBRATION_MTIME[path] = mtime
        return data
    except Exception:
        return {}


def build_probability_features(
    city_name: str,
    raw_mu: Optional[float],
    raw_sigma: Optional[float],
    deb_prediction: Optional[float],
    ens_data: Optional[Dict[str, Any]],
    current_forecasts: Optional[Dict[str, Any]],
    max_so_far: Optional[float],
    peak_status: str,
    local_hour_frac: Optional[float],
) -> Dict[str, Any]:
    ens_data = ens_data or {}
    current_forecasts = current_forecasts or {}
    forecast_values = [
        v for v in (_sf(val) for val in current_forecasts.values()) if v is not None
    ]
    forecast_values.sort()
    forecast_median = None
    if forecast_values:
        forecast_median = forecast_values[len(forecast_values) // 2]

    ens_median = _sf(ens_data.get("median"))
    ens_p10 = _sf(ens_data.get("p10"))
    ens_p90 = _sf(ens_data.get("p90"))

    ensemble_spread = None
    if ens_p10 is not None and ens_p90 is not None and ens_p90 >= ens_p10:
        ensemble_spread = max(0.1, (ens_p90 - ens_p10) / 2.56)
    elif len(forecast_values) >= 2:
        ensemble_spread = max(0.6, (forecast_values[-1] - forecast_values[0]) / 2.0)
    elif raw_sigma is not None:
        ensemble_spread = max(0.1, raw_sigma)

    baseline = deb_prediction if deb_prediction is not None else raw_mu
    max_so_far_gap = None
    if baseline is not None and max_so_far is not None:
        max_so_far_gap = baseline - max_so_far

    peak_flag = 0.0
    if peak_status == "in_window":
        peak_flag = 0.5
    elif peak_status == "past":
        peak_flag = 1.0

    return {
        "city": str(city_name or "").strip().lower(),
        "raw_mu": raw_mu,
        "raw_sigma": raw_sigma,
        "deb_prediction": deb_prediction,
        "ens_median": ens_median,
        "ens_p10": ens_p10,
        "ens_p90": ens_p90,
        "forecast_median": forecast_median,
        "forecast_spread": forecast_values[-1] - forecast_values[0]
        if len(forecast_values) >= 2
        else None,
        "ensemble_spread": ensemble_spread,
        "max_so_far": max_so_far,
        "max_so_far_gap": max_so_far_gap,
        "peak_status": peak_status,
        "peak_flag": peak_flag,
        "local_hour_frac": local_hour_frac,
        "model_count": len(forecast_values),
    }


def _normal_cdf(x: float, mean: float, sigma: float) -> float:
    return 0.5 * (1.0 + math.erf((x - mean) / (sigma * math.sqrt(2.0))))


def _normal_pdf(x: float) -> float:
    return math.exp(-(x ** 2) / 2.0) / math.sqrt(2.0 * math.pi)


def _bucket_probabilities(
    mu: float,
    sigma: float,
    max_so_far: Optional[float],
    city_name: str,
) -> Tuple[List[Dict[str, Any]], List[Tuple[int, float]]]:
    sigma = max(0.1, float(sigma))
    min_possible = (
        apply_city_settlement(city_name, max_so_far) if max_so_far is not None else -999
    )
    probs: Dict[int, float] = {}
    search_range = max(2, int(sigma * 2.5))
    is_exact = is_exact_settlement_city(city_name)
    target_mu = apply_city_settlement(city_name, mu)
    if is_exact:
        target_mu = int(math.floor(mu))

    for value in range(target_mu - search_range, target_mu + search_range + 1):
        if value < min_possible:
            continue
        if is_exact:
            prob = _normal_cdf(value + 1.0, mu, sigma) - _normal_cdf(value, mu, sigma)
        else:
            prob = _normal_cdf(value + 0.5, mu, sigma) - _normal_cdf(value - 0.5, mu, sigma)
        if prob > 0.01:
            probs[value] = prob

    total = sum(probs.values())
    if total <= 0:
        return [], []

    normalized = {key: val / total for key, val in probs.items()}
    sorted_probs = sorted(normalized.items(), key=lambda item: item[1], reverse=True)
    distribution = []
    for value, prob in sorted_probs[:4]:
        if is_exact:
            bucket_range = "[{0}.0~{1}.0)".format(value, value + 1)
        else:
            bucket_range = "[{0}~{1})".format(value - 0.5, value + 0.5)
        distribution.append(
            {
                "value": int(value),
                "range": bucket_range,
                "probability": round(prob, 3),
            }
        )
    return distribution, sorted_probs


def _top_bucket_value(distribution: Optional[List[Dict[str, Any]]]) -> Optional[int]:
    if not distribution:
        return None
    top = max(
        (row for row in distribution if isinstance(row, dict)),
        key=lambda row: float(row.get("probability") or 0.0),
        default=None,
    )
    if not top:
        return None
    value = top.get("value")
    return int(value) if value is not None else None


def _composite_score(mean_crps: float, mean_mae: float, bucket_hit_rate: float) -> float:
    return mean_crps + 0.1 * mean_mae + 2.0 * (1.0 - bucket_hit_rate)


def _blend_value(raw_value: float, calibrated_value: float, alpha: float) -> float:
    return (1.0 - alpha) * raw_value + alpha * calibrated_value


def apply_probability_calibration(
    city_name: str,
    temp_symbol: str,
    raw_mu: Optional[float],
    raw_sigma: Optional[float],
    max_so_far: Optional[float],
    legacy_distribution: Optional[List[Dict[str, Any]]],
    features: Optional[Dict[str, Any]] = None,
    calibration_path: Optional[str] = None,
    mode: Optional[str] = None,
) -> Dict[str, Any]:
    selected_mode = resolve_probability_engine_mode(mode)
    if raw_mu is None or raw_sigma is None:
        return {
            "mode": selected_mode,
            "engine": ENGINE_MODE_LEGACY,
            "distribution": legacy_distribution or [],
            "shadow_distribution": [],
            "raw_mu": raw_mu,
            "raw_sigma": raw_sigma,
            "calibrated_mu": None,
            "calibrated_sigma": None,
            "calibration_version": None,
            "calibration_source": None,
        }

    calibration = load_calibration(calibration_path)
    if not calibration:
        return {
            "mode": selected_mode,
            "engine": ENGINE_MODE_LEGACY,
            "distribution": legacy_distribution or [],
            "shadow_distribution": [],
            "raw_mu": raw_mu,
            "raw_sigma": raw_sigma,
            "calibrated_mu": None,
            "calibrated_sigma": None,
            "calibration_version": None,
            "calibration_source": None,
        }

    features = features or {}
    city_key = str(city_name or "").strip().lower()
    global_params = calibration.get("global", {}) or {}
    city_params = (calibration.get("cities", {}) or {}).get(city_key, {}) or {}
    blending_cfg = calibration.get("blending", {}) or {}

    mu_cfg = global_params.get("mu", {}) or {}
    sigma_cfg = global_params.get("sigma", {}) or {}
    city_confidence = max(0.0, min(1.0, _coalesce_float(city_params.get("confidence"), 1.0)))
    city_mu_bias = _coalesce_float(city_params.get("mu_bias"), 0.0) * city_confidence
    city_sigma_scale = 1.0 + (
        (_coalesce_float(city_params.get("sigma_scale"), 1.0) - 1.0) * city_confidence
    )

    deb_prediction = _sf(features.get("deb_prediction"))
    ens_median = _sf(features.get("ens_median"))
    max_so_far_gap = _sf(features.get("max_so_far_gap"))
    peak_flag = _sf(features.get("peak_flag")) or 0.0
    ensemble_spread = _sf(features.get("ensemble_spread"))

    mu_intercept = _coalesce_float(mu_cfg.get("intercept"), 0.0)
    mu_raw_coef = _coalesce_float(mu_cfg.get("raw_mu_coef"), 1.0)
    mu_deb_coef = _coalesce_float(mu_cfg.get("deb_coef"), 0.0)
    mu_ens_coef = _coalesce_float(mu_cfg.get("ens_median_coef"), 0.0)
    mu_gap_coef = _coalesce_float(mu_cfg.get("max_so_far_gap_coef"), 0.0)

    sigma_intercept = _coalesce_float(
        sigma_cfg.get("intercept"),
        math.log(max(raw_sigma, 0.1)),
    )
    sigma_raw_coef = _coalesce_float(sigma_cfg.get("raw_sigma_coef"), 1.0)
    sigma_spread_coef = _coalesce_float(sigma_cfg.get("spread_coef"), 0.0)
    sigma_peak_coef = _coalesce_float(sigma_cfg.get("peak_flag_coef"), 0.0)
    sigma_gap_coef = _coalesce_float(sigma_cfg.get("max_so_far_gap_coef"), 0.0)

    calibrated_mu = (
        mu_intercept
        + mu_raw_coef * raw_mu
        + mu_deb_coef * (deb_prediction if deb_prediction is not None else raw_mu)
        + mu_ens_coef * (ens_median if ens_median is not None else raw_mu)
        + mu_gap_coef * (max_so_far_gap if max_so_far_gap is not None else 0.0)
        + city_mu_bias
    )
    sigma_log = (
        sigma_intercept
        + sigma_raw_coef * math.log(max(raw_sigma, 0.1))
        + sigma_spread_coef * math.log(max(ensemble_spread or raw_sigma, 0.1))
        + sigma_peak_coef * peak_flag
        + sigma_gap_coef * (max_so_far_gap if max_so_far_gap is not None else 0.0)
    )
    calibrated_sigma = max(0.1, math.exp(sigma_log) * city_sigma_scale)
    blend_alpha_mu = max(0.0, min(1.0, _coalesce_float(blending_cfg.get("alpha_mu"), 1.0)))
    blend_alpha_sigma = max(0.0, min(1.0, _coalesce_float(blending_cfg.get("alpha_sigma"), 1.0)))
    calibrated_mu = _blend_value(raw_mu, calibrated_mu, blend_alpha_mu)
    calibrated_sigma = max(0.1, _blend_value(raw_sigma, calibrated_sigma, blend_alpha_sigma))
    calibrated_distribution, calibrated_sorted = _bucket_probabilities(
        calibrated_mu,
        calibrated_sigma,
        max_so_far=max_so_far,
        city_name=city_key,
    )

    engine = ENGINE_MODE_LEGACY
    selected_distribution = legacy_distribution or []
    selected_sorted: List[Tuple[int, float]] = []
    shadow_distribution: List[Dict[str, Any]] = []
    shadow_sorted: List[Tuple[int, float]] = []
    if selected_mode == ENGINE_MODE_EMOS_PRIMARY:
        engine = "emos"
        selected_distribution = calibrated_distribution
        selected_sorted = calibrated_sorted
    elif selected_mode == ENGINE_MODE_EMOS_SHADOW:
        shadow_distribution = calibrated_distribution
        shadow_sorted = calibrated_sorted

    return {
        "mode": selected_mode,
        "engine": engine,
        "distribution": selected_distribution,
        "selected_sorted_probs": selected_sorted,
        "shadow_distribution": shadow_distribution,
        "shadow_sorted_probs": shadow_sorted,
        "raw_mu": raw_mu,
        "raw_sigma": raw_sigma,
        "calibrated_mu": calibrated_mu,
        "calibrated_sigma": calibrated_sigma,
        "blend_alpha_mu": blend_alpha_mu,
        "blend_alpha_sigma": blend_alpha_sigma,
        "calibration_version": calibration.get("version"),
        "calibration_source": calibration.get("source")
        or os.path.relpath(
            calibration_path or DEFAULT_CALIBRATION_FILE,
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        ),
    }


def _gaussian_crps(observation: float, mean: float, sigma: float) -> float:
    sigma = max(0.1, float(sigma))
    z = (observation - mean) / sigma
    return sigma * (
        z * (2.0 * _normal_cdf(z, 0.0, 1.0) - 1.0)
        + 2.0 * _normal_pdf(z)
        - 1.0 / math.sqrt(math.pi)
    )


def _fit_linear(xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    if len(xs) == 0:
        return np.zeros(xs.shape[1], dtype=float)
    coeffs, _, _, _ = np.linalg.lstsq(xs, ys, rcond=None)
    return coeffs


def fit_calibration(
    samples: Iterable[Dict[str, Any]],
    version: Optional[str] = None,
) -> Dict[str, Any]:
    normalized_samples: List[Dict[str, Any]] = []
    city_residuals: Dict[str, List[float]] = {}
    city_sigma_ratios: Dict[str, List[float]] = {}

    for raw_sample in samples:
        actual = _sf(raw_sample.get("actual_high"))
        raw_mu = _sf(raw_sample.get("raw_mu"))
        raw_sigma = _sf(raw_sample.get("raw_sigma"))
        if actual is None or raw_mu is None or raw_sigma is None:
            continue
        feature_row = {
            "city": str(raw_sample.get("city") or "").strip().lower(),
            "actual_high": actual,
            "raw_mu": raw_mu,
            "raw_sigma": max(0.1, raw_sigma),
            "deb_prediction": _sf(raw_sample.get("deb_prediction")),
            "ens_median": _sf(raw_sample.get("ens_median")),
            "ensemble_spread": _sf(raw_sample.get("ensemble_spread")),
            "max_so_far_gap": _sf(raw_sample.get("max_so_far_gap")),
            "peak_flag": _sf(raw_sample.get("peak_flag")) or 0.0,
        }
        normalized_samples.append(feature_row)

    if len(normalized_samples) < 3:
        return default_calibration_payload(version=version, reason="insufficient_samples")

    mu_rows = []
    mu_targets = []
    for sample in normalized_samples:
        deb = sample["deb_prediction"] if sample["deb_prediction"] is not None else sample["raw_mu"]
        ens_median = sample["ens_median"] if sample["ens_median"] is not None else sample["raw_mu"]
        gap = sample["max_so_far_gap"] if sample["max_so_far_gap"] is not None else 0.0
        mu_rows.append([1.0, sample["raw_mu"], deb, ens_median, gap])
        mu_targets.append(sample["actual_high"])

    mu_coeffs = _fit_linear(np.array(mu_rows, dtype=float), np.array(mu_targets, dtype=float))

    sigma_rows = []
    sigma_targets = []
    mu_predictions = []
    for idx, sample in enumerate(normalized_samples):
        predicted_mu = float(np.dot(mu_coeffs, np.array(mu_rows[idx], dtype=float)))
        mu_predictions.append(predicted_mu)
        residual = max(abs(sample["actual_high"] - predicted_mu), 0.1)
        spread = max(sample["ensemble_spread"] or sample["raw_sigma"], 0.1)
        gap = sample["max_so_far_gap"] if sample["max_so_far_gap"] is not None else 0.0
        sigma_rows.append([1.0, math.log(sample["raw_sigma"]), math.log(spread), sample["peak_flag"], gap])
        sigma_targets.append(math.log(residual))
        city_residuals.setdefault(sample["city"], []).append(sample["actual_high"] - predicted_mu)
        city_sigma_ratios.setdefault(sample["city"], []).append(residual / max(sample["raw_sigma"], 0.1))

    sigma_coeffs = _fit_linear(np.array(sigma_rows, dtype=float), np.array(sigma_targets, dtype=float))

    crps_values = []
    for idx, sample in enumerate(normalized_samples):
        predicted_mu = mu_predictions[idx]
        sigma_log = float(np.dot(sigma_coeffs, np.array(sigma_rows[idx], dtype=float)))
        predicted_sigma = max(0.1, math.exp(sigma_log))
        crps_values.append(_gaussian_crps(sample["actual_high"], predicted_mu, predicted_sigma))

    city_params: Dict[str, Dict[str, Any]] = {}
    for city, residuals in city_residuals.items():
        if len(residuals) < 3:
            continue
        sigma_ratios = city_sigma_ratios.get(city) or [1.0]
        confidence = max(0.25, min(1.0, len(residuals) / 8.0))
        city_params[city] = {
            "samples": len(residuals),
            "mu_bias": round(sum(residuals) / len(residuals), 6),
            "sigma_scale": round(
                max(0.5, min(2.0, sum(sigma_ratios) / len(sigma_ratios))),
                6,
            ),
            "confidence": round(confidence, 6),
        }

    legacy_crps_values = []
    legacy_mae_values = []
    legacy_bucket_hits = []
    candidate_predictions = []
    for idx, sample in enumerate(normalized_samples):
        city = sample["city"]
        city_meta = city_params.get(city, {})
        city_confidence = max(
            0.0,
            min(1.0, _coalesce_float(city_meta.get("confidence"), 1.0)),
        )
        city_mu_bias = _coalesce_float(city_meta.get("mu_bias"), 0.0) * city_confidence
        city_sigma_scale = 1.0 + (
            (_coalesce_float(city_meta.get("sigma_scale"), 1.0) - 1.0) * city_confidence
        )

        legacy_mu = sample["raw_mu"]
        legacy_sigma = sample["raw_sigma"]
        actual_high = sample["actual_high"]
        legacy_crps_values.append(_gaussian_crps(actual_high, legacy_mu, legacy_sigma))
        legacy_mae_values.append(abs(legacy_mu - actual_high))
        legacy_bucket_hits.append(
            1.0
            if apply_city_settlement(city, legacy_mu)
            == apply_city_settlement(city, actual_high)
            else 0.0
        )

        calibrated_mu = mu_predictions[idx] + city_mu_bias
        sigma_log = float(np.dot(sigma_coeffs, np.array(sigma_rows[idx], dtype=float)))
        calibrated_sigma = max(0.1, math.exp(sigma_log) * city_sigma_scale)
        candidate_predictions.append(
            {
                "city": city,
                "actual_high": actual_high,
                "raw_mu": legacy_mu,
                "raw_sigma": legacy_sigma,
                "calibrated_mu": calibrated_mu,
                "calibrated_sigma": calibrated_sigma,
            }
        )

    legacy_mean_crps = _mean(legacy_crps_values) or 0.0
    legacy_mean_mae = _mean(legacy_mae_values) or 0.0
    legacy_bucket_hit_rate = _mean(legacy_bucket_hits) or 0.0
    legacy_score = _composite_score(
        legacy_mean_crps,
        legacy_mean_mae,
        legacy_bucket_hit_rate,
    )

    best_alpha_mu = 0.0
    best_alpha_sigma = 0.0
    best_score = legacy_score
    best_metrics = {
        "mean_crps": legacy_mean_crps,
        "mean_mae": legacy_mean_mae,
        "bucket_hit_rate": legacy_bucket_hit_rate,
    }
    alpha_grid = [step / 20.0 for step in range(21)]
    for alpha_mu in alpha_grid:
        for alpha_sigma in alpha_grid:
            crps_values = []
            mae_values = []
            bucket_hits = []
            for row in candidate_predictions:
                mu_hat = _blend_value(row["raw_mu"], row["calibrated_mu"], alpha_mu)
                sigma_hat = max(
                    0.1,
                    _blend_value(row["raw_sigma"], row["calibrated_sigma"], alpha_sigma),
                )
                actual_high = row["actual_high"]
                city = row["city"]
                crps_values.append(_gaussian_crps(actual_high, mu_hat, sigma_hat))
                mae_values.append(abs(mu_hat - actual_high))
                distribution, _ = _bucket_probabilities(
                    mu_hat,
                    sigma_hat,
                    max_so_far=None,
                    city_name=city,
                )
                predicted_bucket = _top_bucket_value(distribution)
                actual_bucket = apply_city_settlement(city, actual_high)
                bucket_hits.append(1.0 if predicted_bucket == actual_bucket else 0.0)

            mean_crps = _mean(crps_values) or 0.0
            mean_mae = _mean(mae_values) or 0.0
            bucket_hit_rate = _mean(bucket_hits) or 0.0
            score = _composite_score(mean_crps, mean_mae, bucket_hit_rate)
            if score + 1e-9 < best_score:
                best_score = score
                best_alpha_mu = alpha_mu
                best_alpha_sigma = alpha_sigma
                best_metrics = {
                    "mean_crps": mean_crps,
                    "mean_mae": mean_mae,
                    "bucket_hit_rate": bucket_hit_rate,
                }

    return {
        "version": version or datetime.now(timezone.utc).strftime("emos-%Y%m%d%H%M%S"),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "global": {
            "mu": {
                "intercept": round(float(mu_coeffs[0]), 8),
                "raw_mu_coef": round(float(mu_coeffs[1]), 8),
                "deb_coef": round(float(mu_coeffs[2]), 8),
                "ens_median_coef": round(float(mu_coeffs[3]), 8),
                "max_so_far_gap_coef": round(float(mu_coeffs[4]), 8),
            },
            "sigma": {
                "intercept": round(float(sigma_coeffs[0]), 8),
                "raw_sigma_coef": round(float(sigma_coeffs[1]), 8),
                "spread_coef": round(float(sigma_coeffs[2]), 8),
                "peak_flag_coef": round(float(sigma_coeffs[3]), 8),
                "max_so_far_gap_coef": round(float(sigma_coeffs[4]), 8),
            },
        },
        "blending": {
            "alpha_mu": round(best_alpha_mu, 6),
            "alpha_sigma": round(best_alpha_sigma, 6),
        },
        "cities": city_params,
        "metrics": {
            "sample_count": len(normalized_samples),
            "mean_crps": round(sum(crps_values) / len(crps_values), 6),
            "legacy_mean_crps": round(legacy_mean_crps, 6),
            "legacy_mean_mae": round(legacy_mean_mae, 6),
            "legacy_bucket_hit_rate": round(legacy_bucket_hit_rate, 6),
            "selected_mean_crps": round(best_metrics["mean_crps"], 6),
            "selected_mean_mae": round(best_metrics["mean_mae"], 6),
            "selected_bucket_hit_rate": round(best_metrics["bucket_hit_rate"], 6),
            "selected_score": round(best_score, 6),
            "legacy_score": round(legacy_score, 6),
        },
    }


def default_calibration_payload(
    version: Optional[str] = None,
    reason: str = "bootstrap",
) -> Dict[str, Any]:
    return {
        "version": version or "emos-bootstrap-v1",
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "global": {
            "mu": {
                "intercept": 0.0,
                "raw_mu_coef": 1.0,
                "deb_coef": 0.0,
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
        "blending": {
            "alpha_mu": 1.0,
            "alpha_sigma": 1.0,
        },
        "cities": {},
        "metrics": {
            "sample_count": 0,
            "mean_crps": None,
            "reason": reason,
        },
    }
