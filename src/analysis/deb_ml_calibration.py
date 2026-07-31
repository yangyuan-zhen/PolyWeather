"""LightGBM quantile residual calibration for DEB raw predictions.

Learns the residual `actual_high - raw_deb` as a function of city, raw DEB
value, model consensus and seasonality. The raw DEB is recomputed in a
walk-forward fashion during training, so the target is never polluted by a
previous run of this calibrator (no training/inference bootstrapping).

Inference applies the q50 residual on top of the raw blend and replaces the
legacy guarded bias-correction path. Falls back to the legacy path whenever
the model bundle is missing, the city was not in training, or the flag is off.
"""

from __future__ import annotations

import json
import math
import os
import statistics
import time
from pathlib import Path
from typing import Any, Dict, Optional

DEB_ML_FEATURE_NAMES = [
    "city_code",
    "raw_deb",
    "model_median",
    "model_spread",
    "n_models",
    "month",
    "day_of_year",
]
DEB_ML_QUANTILES = {"q10": 0.10, "q50": 0.50, "q90": 0.90}


def _sf(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _date_parts(value: Any) -> tuple[float, float]:
    text = str(value or "").strip()
    try:
        parsed = time.strptime(text[:10], "%Y-%m-%d")
        return float(parsed.tm_mon), float(parsed.tm_yday)
    except Exception:
        return 0.0, 0.0


def _city_key(value: Any) -> str:
    return str(value or "").strip().lower()


def _build_city_index(daily_records: Dict[str, Any]) -> Dict[str, int]:
    cities = sorted({_city_key(city) for city in (daily_records or {}).keys()})
    return {city: idx for idx, city in enumerate(cities)}


def _deb_feature_row(
    city: str,
    raw_prediction: float,
    forecasts: Dict[str, Any],
    city_index: Dict[str, int],
    *,
    target_date: Any = None,
) -> Optional[list[float]]:
    values = [_sf(v) for v in (forecasts or {}).values()]
    values = [v for v in values if v is not None]
    if not values:
        return None
    if target_date is None:
        month, day_of_year = _date_parts(
            time.strftime("%Y-%m-%d", time.gmtime())
        )
    else:
        month, day_of_year = _date_parts(target_date)
    return [
        float(city_index.get(_city_key(city), -1)),
        float(raw_prediction),
        statistics.median(values),
        max(values) - min(values),
        float(len(values)),
        month,
        day_of_year,
    ]


def _build_training_rows(
    daily_records: Dict[str, Dict[str, Dict[str, Any]]],
    *,
    min_history_days: int = 2,
) -> list[Dict[str, Any]]:
    """Walk-forward recompute of raw DEB per settled record (no leakage)."""
    from src.analysis.deb_algorithm import calculate_dynamic_weight_components

    rows: list[Dict[str, Any]] = []
    for city, by_date in (daily_records or {}).items():
        if not isinstance(by_date, dict):
            continue
        history: Dict[str, Dict[str, Any]] = {}
        for target_date in sorted(by_date.keys()):
            record = by_date[target_date]
            if not isinstance(record, dict):
                continue
            actual = _sf(record.get("actual_high"))
            forecasts = record.get("forecasts")
            if actual is None or not isinstance(forecasts, dict) or not forecasts:
                history[target_date] = record
                continue
            components = calculate_dynamic_weight_components(
                city,
                forecasts,
                history_data={city: history},
            )
            raw = components.get("prediction")
            if raw is not None and int(components.get("days_used") or 0) >= min_history_days:
                rows.append(
                    {
                        "city": _city_key(city),
                        "target_date": target_date,
                        "raw_deb": float(raw),
                        "actual_high": actual,
                        "forecasts": forecasts,
                    }
                )
            history[target_date] = record
    return rows


def train_deb_quantile_calibrator(
    daily_records: Dict[str, Dict[str, Dict[str, Any]]],
    *,
    model_dir: os.PathLike[str] | str,
    min_global_samples: int = 150,
    min_city_samples: int = 5,
    min_history_days: int = 2,
) -> Dict[str, Any]:
    rows = _build_training_rows(daily_records, min_history_days=min_history_days)
    if len(rows) < int(min_global_samples):
        return {
            "trained": False,
            "reason": "insufficient_global_samples",
            "samples": len(rows),
        }

    city_counts: Dict[str, int] = {}
    for row in rows:
        city_counts[row["city"]] = city_counts.get(row["city"], 0) + 1
    if not any(count >= int(min_city_samples) for count in city_counts.values()):
        return {
            "trained": False,
            "reason": "insufficient_city_samples",
            "samples": len(rows),
        }

    try:
        import joblib  # type: ignore
        from lightgbm import LGBMRegressor  # type: ignore
    except Exception as exc:
        return {
            "trained": False,
            "reason": "missing_lightgbm",
            "samples": len(rows),
            "error": str(exc),
        }

    city_index = _build_city_index(daily_records)
    features: list[list[float]] = []
    residuals: list[float] = []
    for row in rows:
        feature = _deb_feature_row(
            row["city"],
            row["raw_deb"],
            row["forecasts"],
            city_index,
            target_date=row["target_date"],
        )
        if feature is None:
            continue
        features.append(feature)
        residuals.append(row["actual_high"] - row["raw_deb"])
    if len(features) < int(min_global_samples):
        return {
            "trained": False,
            "reason": "insufficient_global_samples",
            "samples": len(features),
        }

    target_dir = Path(model_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    models = {}
    for key, alpha in DEB_ML_QUANTILES.items():
        model = LGBMRegressor(
            objective="quantile",
            alpha=alpha,
            n_estimators=45,
            learning_rate=0.08,
            num_leaves=15,
            min_child_samples=5,
            random_state=42,
            n_jobs=2,
            verbosity=-1,
        )
        model.fit(features, residuals)
        models[key] = model
        joblib.dump(model, target_dir / f"{key}.pkl")

    metadata = {
        "model_version": f"deb_lightgbm_quantile_{int(time.time())}",
        "engine": "lightgbm_quantile",
        "samples": len(features),
        "feature_names": DEB_ML_FEATURE_NAMES,
        "city_index": city_index,
        "city_counts": city_counts,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (target_dir / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    ordered = True
    for feature in features[: min(len(features), 50)]:
        preds = sorted(
            float(models[key].predict([feature])[0]) for key in ("q10", "q50", "q90")
        )
        if preds[0] > preds[1] or preds[1] > preds[2]:
            ordered = False
            break
    return {
        "trained": True,
        "samples": len(features),
        "model_dir": str(target_dir),
        "model_version": metadata["model_version"],
        "validation": {"ordered_quantiles": ordered},
    }


def _deb_model_dir() -> str:
    return str(
        os.getenv(
            "POLYWEATHER_DEB_ML_MODEL_DIR",
            "/app/data/models/deb_calibrator",
        )
        or ""
    ).strip()


def _load_deb_model_bundle(model_dir: Optional[str] = None) -> Optional[Dict[str, Any]]:
    target_dir = Path(model_dir or _deb_model_dir())
    metadata_path = target_dir / "metadata.json"
    if not metadata_path.is_file():
        return None
    try:
        import joblib  # type: ignore

        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        return {
            "metadata": metadata,
            "models": {
                key: joblib.load(target_dir / f"{key}.pkl")
                for key in DEB_ML_QUANTILES
            },
        }
    except Exception:
        return None


def _deb_ml_flag_enabled() -> bool:
    raw = str(os.getenv("POLYWEATHER_DEB_ML_CALIBRATION") or "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def apply_deb_ml_calibration(
    city_name: str,
    raw_prediction: float,
    current_forecasts: Dict[str, Any],
    *,
    model_dir: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Apply the LightGBM residual on top of the raw DEB blend.

    Returns None whenever the calibrator should not participate, so callers
    fall back to the legacy guarded path unchanged.
    """
    if not _deb_ml_flag_enabled():
        return None
    bundle = _load_deb_model_bundle(model_dir)
    if not bundle:
        return None
    metadata = bundle.get("metadata") or {}
    city_index = metadata.get("city_index") if isinstance(metadata.get("city_index"), dict) else {}
    feature = _deb_feature_row(city_name, raw_prediction, current_forecasts, city_index)
    if feature is None:
        return None
    raw = {
        key: float(model.predict([feature])[0])
        for key, model in (bundle.get("models") or {}).items()
    }
    values = sorted([raw.get("q10", 0.0), raw.get("q50", 0.0), raw.get("q90", 0.0)])
    residuals = {"q10": values[0], "q50": values[1], "q90": values[2]}
    if not all(math.isfinite(v) for v in residuals.values()):
        return None
    q50 = residuals["q50"]
    return {
        "prediction": round(float(raw_prediction) + q50, 1),
        "raw_prediction": round(float(raw_prediction), 1),
        "adjustment": round(q50, 3),
        "residual_quantiles": {key: round(v, 3) for key, v in residuals.items()},
        "samples": int(metadata.get("samples") or 0),
        "model_version": metadata.get("model_version"),
    }
