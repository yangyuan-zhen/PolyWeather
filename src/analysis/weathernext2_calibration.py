from __future__ import annotations

import json
import math
import os
import time
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

from src.data_collection.weathernext2_sources import build_weathernext2_city_probability


QUANTILES = {"q10": 0.10, "q50": 0.50, "q90": 0.90}
FEATURE_NAMES = [
    "city_code",
    "wn2_mean",
    "wn2_median",
    "wn2_p10",
    "wn2_p25",
    "wn2_p75",
    "wn2_p90",
    "wn2_spread",
    "deb_prediction_c",
    "model_median_c",
    "model_spread",
    "current_max_so_far_c",
    "local_hour",
    "month",
    "day_of_year",
    "observation_progress",
]


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


def _summary_from_record(record: Dict[str, Any]) -> Dict[str, Any]:
    wn2 = record.get("weathernext2") if isinstance(record.get("weathernext2"), dict) else {}
    summary = wn2.get("summary") if isinstance(wn2.get("summary"), dict) else {}
    return summary if isinstance(summary, dict) else {}


def _city_key(value: Any) -> str:
    return str(value or "").strip().lower()


def _build_city_index(records: Iterable[Dict[str, Any]]) -> Dict[str, int]:
    cities = sorted({_city_key(record.get("city")) for record in records if _city_key(record.get("city"))})
    return {city: idx for idx, city in enumerate(cities)}


def _feature_row(record: Dict[str, Any], city_index: Dict[str, int]) -> Optional[list[float]]:
    summary = _summary_from_record(record)
    median = _sf(summary.get("median"))
    if median is None:
        return None
    target_date = record.get("target_date") or record.get("date")
    month, day_of_year = _date_parts(target_date)
    city = _city_key(record.get("city"))
    current = _sf(record.get("current_max_so_far_c"))
    progress = _sf(record.get("observation_progress"))
    if progress is None:
        local_hour = _sf(record.get("local_hour"))
        progress = min(max((local_hour or 0.0) / 24.0, 0.0), 1.0)

    def fallback(name: str, default: float) -> float:
        parsed = _sf(summary.get(name))
        return default if parsed is None else parsed

    return [
        float(city_index.get(city, -1)),
        fallback("mean", median),
        median,
        fallback("p10", median),
        fallback("p25", median),
        fallback("p75", median),
        fallback("p90", median),
        fallback("spread", 0.0),
        _sf(record.get("deb_prediction_c")) or median,
        _sf(record.get("model_median_c")) or median,
        _sf(record.get("model_spread")) or 0.0,
        current if current is not None else median,
        _sf(record.get("local_hour")) or 0.0,
        month,
        day_of_year,
        progress,
    ]


def _training_xy(
    records: Iterable[Dict[str, Any]],
    city_index: Dict[str, int],
) -> tuple[list[list[float]], list[float], list[Dict[str, Any]]]:
    features: list[list[float]] = []
    residuals: list[float] = []
    kept: list[Dict[str, Any]] = []
    for record in records:
        summary = _summary_from_record(record)
        median = _sf(summary.get("median"))
        actual = _sf(record.get("actual_high_c", record.get("actual_high")))
        row = _feature_row(record, city_index)
        if median is None or actual is None or row is None:
            continue
        features.append(row)
        residuals.append(actual - median)
        kept.append(record)
    return features, residuals, kept


def train_lightgbm_quantile_calibrator(
    records: Iterable[Dict[str, Any]],
    *,
    model_dir: os.PathLike[str] | str,
    min_global_samples: int = 150,
    min_city_samples: int = 5,
) -> Dict[str, Any]:
    rows = [record for record in records if isinstance(record, dict)]
    city_index = _build_city_index(rows)
    features, residuals, kept = _training_xy(rows, city_index)
    if len(features) < int(min_global_samples):
        return {
            "trained": False,
            "reason": "insufficient_global_samples",
            "samples": len(features),
        }

    city_counts: Dict[str, int] = {}
    for record in kept:
        city_counts[_city_key(record.get("city"))] = city_counts.get(_city_key(record.get("city")), 0) + 1
    if not any(count >= int(min_city_samples) for count in city_counts.values()):
        return {
            "trained": False,
            "reason": "insufficient_city_samples",
            "samples": len(features),
        }

    try:
        import joblib  # type: ignore
        from lightgbm import LGBMRegressor  # type: ignore
    except Exception as exc:
        return {
            "trained": False,
            "reason": "missing_lightgbm",
            "samples": len(features),
            "error": str(exc),
        }

    target_dir = Path(model_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    models = {}
    for key, alpha in QUANTILES.items():
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
        "model_version": f"weathernext2_lightgbm_quantile_{int(time.time())}",
        "engine": "lightgbm_quantile",
        "samples": len(features),
        "feature_names": FEATURE_NAMES,
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
        preds = sorted(float(models[key].predict([feature])[0]) for key in ("q10", "q50", "q90"))
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


def _load_model_bundle(model_dir: os.PathLike[str] | str) -> Optional[Dict[str, Any]]:
    target_dir = Path(model_dir)
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
                for key in QUANTILES
            },
        }
    except Exception:
        return None


def _predict_residual_quantiles(record: Dict[str, Any], bundle: Dict[str, Any]) -> Optional[Dict[str, float]]:
    metadata = bundle.get("metadata") or {}
    city_index = metadata.get("city_index") if isinstance(metadata.get("city_index"), dict) else {}
    feature = _feature_row(record, city_index)
    if feature is None:
        return None
    raw = {
        key: float(model.predict([feature])[0])
        for key, model in (bundle.get("models") or {}).items()
    }
    values = sorted([raw.get("q10", 0.0), raw.get("q50", 0.0), raw.get("q90", 0.0)])
    return {"q10": values[0], "q50": values[1], "q90": values[2]}


def _calibrate_members(
    member_highs: Dict[str, Any],
    raw_summary: Dict[str, Any],
    residuals: Dict[str, float],
) -> Dict[str, float]:
    raw_median = _sf(raw_summary.get("median"))
    raw_p10 = _sf(raw_summary.get("p10"))
    raw_p90 = _sf(raw_summary.get("p90"))
    if raw_median is None:
        return {}
    target_p10 = (raw_p10 if raw_p10 is not None else raw_median) + residuals["q10"]
    target_median = raw_median + residuals["q50"]
    target_p90 = (raw_p90 if raw_p90 is not None else raw_median) + residuals["q90"]

    calibrated = {}
    for member_id, value in (member_highs or {}).items():
        parsed = _sf(value)
        if parsed is None:
            continue
        if parsed <= raw_median:
            raw_span = max(raw_median - (raw_p10 if raw_p10 is not None else raw_median), 0.1)
            target_span = max(target_median - target_p10, 0.1)
            adjusted = target_median - (raw_median - parsed) / raw_span * target_span
        else:
            raw_span = max((raw_p90 if raw_p90 is not None else raw_median) - raw_median, 0.1)
            target_span = max(target_p90 - target_median, 0.1)
            adjusted = target_median + (parsed - raw_median) / raw_span * target_span
        calibrated[str(member_id)] = round(adjusted, 1)
    return calibrated


def apply_quantile_calibration_to_payload(
    payload: Dict[str, Any],
    *,
    model_dir: os.PathLike[str] | str,
) -> Dict[str, Any]:
    bundle = _load_model_bundle(model_dir)
    if not bundle:
        return dict(payload)
    raw_summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    member_highs = payload.get("member_highs") if isinstance(payload.get("member_highs"), dict) else {}
    if not raw_summary or not member_highs:
        return dict(payload)

    record = {
        "city": payload.get("city"),
        "target_date": payload.get("target_date"),
        "weathernext2": {"summary": raw_summary},
    }
    residuals = _predict_residual_quantiles(record, bundle)
    if residuals is None:
        return dict(payload)

    calibrated_members = _calibrate_members(member_highs, raw_summary, residuals)
    if not calibrated_members:
        return dict(payload)

    calibrated = build_weathernext2_city_probability(
        city=str(payload.get("city") or ""),
        member_highs=calibrated_members,
        temp_symbol=str(payload.get("temp_symbol") or "°C"),
        target_date=payload.get("target_date"),
        source_run=payload.get("source_run"),
        generated_at=payload.get("generated_at"),
    )
    metadata = bundle.get("metadata") or {}
    calibrated["calibration"] = {
        "engine": "lightgbm_quantile",
        "model_version": metadata.get("model_version"),
        "samples": metadata.get("samples"),
        "residual_quantiles": {key: round(value, 3) for key, value in residuals.items()},
        "raw_summary": raw_summary,
        "calibrated_summary": calibrated.get("summary"),
    }
    calibrated["raw_weathernext2"] = {
        "summary": raw_summary,
        "buckets": payload.get("buckets") or [],
        "top_bucket": payload.get("top_bucket"),
    }
    return calibrated
