from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from typing import Any, Dict, List

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

import lightgbm as lgb
import numpy as np

from src.models.lgbm_features import (
    FEATURE_NAMES,
    build_training_samples,
    schema_payload,
)


MODEL_PATH = os.path.join(ROOT_DIR, "artifacts", "models", "lgbm_daily_high.txt")
SCHEMA_PATH = os.path.join(ROOT_DIR, "artifacts", "models", "lgbm_daily_high_schema.json")


def _mae(pairs: List[tuple[float, float]]) -> float | None:
    if not pairs:
        return None
    return round(sum(abs(pred - actual) for pred, actual in pairs) / len(pairs), 3)


def _best_single_forecast(sample: Dict[str, Any]) -> float | None:
    target = float(sample["target"])
    forecasts = sample.get("forecasts") or {}
    best_value = None
    best_error = None
    for value in forecasts.values():
        try:
            numeric = float(value)
        except Exception:
            continue
        error = abs(numeric - target)
        if best_error is None or error < best_error:
            best_error = error
            best_value = numeric
    return best_value


def _chronological_split(samples: List[Dict[str, Any]]) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    if len(samples) < 12:
        return samples, []
    ordered = sorted(samples, key=lambda row: (row["date"], row["city"]))
    validation_count = max(12, int(round(len(ordered) * 0.2)))
    validation_count = min(validation_count, len(ordered) - 1)
    if validation_count <= 0:
        return ordered, []
    return ordered[:-validation_count], ordered[-validation_count:]


def _dataset_from_samples(samples: List[Dict[str, Any]]) -> tuple[np.ndarray, np.ndarray]:
    features = np.asarray([row["vector"] for row in samples], dtype=np.float32)
    targets = np.asarray([row["target"] for row in samples], dtype=np.float32)
    return features, targets


def _train_model(train_samples: List[Dict[str, Any]], valid_samples: List[Dict[str, Any]]) -> lgb.Booster:
    train_x, train_y = _dataset_from_samples(train_samples)
    train_data = lgb.Dataset(train_x, label=train_y, feature_name=FEATURE_NAMES, free_raw_data=True)
    valid_sets = [train_data]
    valid_names = ["train"]

    params = {
        "objective": "regression",
        "metric": "l1",
        "learning_rate": 0.05,
        "num_leaves": 15,
        "feature_fraction": 0.9,
        "bagging_fraction": 0.9,
        "bagging_freq": 1,
        "min_data_in_leaf": 4,
        "verbosity": -1,
        "seed": 42,
    }

    callbacks = []
    if valid_samples:
        valid_x, valid_y = _dataset_from_samples(valid_samples)
        valid_data = lgb.Dataset(valid_x, label=valid_y, feature_name=FEATURE_NAMES, reference=train_data)
        valid_sets.append(valid_data)
        valid_names.append("valid")
        callbacks.append(lgb.early_stopping(stopping_rounds=15, verbose=False))

    return lgb.train(
        params=params,
        train_set=train_data,
        num_boost_round=120,
        valid_sets=valid_sets,
        valid_names=valid_names,
        callbacks=callbacks,
    )


def _evaluate(booster: lgb.Booster, samples: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not samples:
        return {
            "sample_count": 0,
            "lgbm_mae": None,
            "deb_mae": None,
            "best_single_mae": None,
            "median_mae": None,
        }

    features, _ = _dataset_from_samples(samples)
    preds = booster.predict(features, num_iteration=booster.best_iteration)
    lgbm_pairs: List[tuple[float, float]] = []
    deb_pairs: List[tuple[float, float]] = []
    best_single_pairs: List[tuple[float, float]] = []
    median_pairs: List[tuple[float, float]] = []

    for sample, pred in zip(samples, preds):
        actual = float(sample["target"])
        lgbm_pairs.append((float(pred), actual))

        deb_prediction = sample.get("deb_prediction")
        if deb_prediction is not None:
            deb_pairs.append((float(deb_prediction), actual))

        best_single = _best_single_forecast(sample)
        if best_single is not None:
            best_single_pairs.append((best_single, actual))

        median_prediction = (sample.get("features") or {}).get("model_median")
        if median_prediction is not None:
            median_pairs.append((float(median_prediction), actual))

    return {
        "sample_count": len(samples),
        "lgbm_mae": _mae(lgbm_pairs),
        "deb_mae": _mae(deb_pairs),
        "best_single_mae": _mae(best_single_pairs),
        "median_mae": _mae(median_pairs),
    }


def main() -> int:
    samples = build_training_samples()
    if len(samples) < 16:
        raise SystemExit(f"Not enough supervised samples for LightGBM training: {len(samples)}")

    train_samples, valid_samples = _chronological_split(samples)
    booster = _train_model(train_samples, valid_samples)

    all_features, all_targets = _dataset_from_samples(samples)
    final_train = lgb.Dataset(all_features, label=all_targets, feature_name=FEATURE_NAMES, free_raw_data=True)
    final_booster = lgb.train(
        params={
            "objective": "regression",
            "metric": "l1",
            "learning_rate": 0.05,
            "num_leaves": 15,
            "feature_fraction": 0.9,
            "bagging_fraction": 0.9,
            "bagging_freq": 1,
            "min_data_in_leaf": 4,
            "verbosity": -1,
            "seed": 42,
        },
        train_set=final_train,
        num_boost_round=max(int(booster.best_iteration or 60), 20),
    )

    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    final_booster.save_model(MODEL_PATH)

    metrics = {
        "validation": _evaluate(booster, valid_samples),
        "full_sample": _evaluate(final_booster, samples),
    }
    schema = schema_payload(
        model_path=os.path.relpath(MODEL_PATH, ROOT_DIR),
        sample_count=len(samples),
        train_count=len(train_samples),
        validation_count=len(valid_samples),
        metrics=metrics,
    )
    schema["trained_at"] = datetime.utcnow().isoformat() + "Z"
    with open(SCHEMA_PATH, "w", encoding="utf-8") as fh:
        json.dump(schema, fh, ensure_ascii=False, indent=2)

    print(json.dumps({"model_path": MODEL_PATH, "schema_path": SCHEMA_PATH, "metrics": metrics}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
