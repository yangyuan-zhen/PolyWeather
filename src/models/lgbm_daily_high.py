from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger

from src.models.lgbm_features import (
    FEATURE_NAMES,
    build_runtime_feature_map,
)

_MODEL_CACHE: Dict[str, Any] = {"path": None, "mtime": None, "booster": None}
_SCHEMA_CACHE: Dict[str, Any] = {"path": None, "mtime": None, "schema": None}


def _sf(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _truthy_env(name: str, default: str = "false") -> bool:
    return str(os.getenv(name, default)).strip().lower() in {"1", "true", "yes", "on"}


def lgbm_model_path() -> str:
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return str(
        os.getenv(
            "POLYWEATHER_LGBM_MODEL_PATH",
            os.path.join(root, "artifacts", "models", "lgbm_daily_high.txt"),
        )
    ).strip()


def lgbm_schema_path() -> str:
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return str(
        os.getenv(
            "POLYWEATHER_LGBM_SCHEMA_PATH",
            os.path.join(root, "artifacts", "models", "lgbm_daily_high_schema.json"),
        )
    ).strip()


def lgbm_min_history_points() -> int:
    try:
        return max(1, int(os.getenv("POLYWEATHER_LGBM_MIN_HISTORY_POINTS", "3")))
    except Exception:
        return 3


def is_lgbm_enabled() -> bool:
    return _truthy_env("POLYWEATHER_LGBM_ENABLED", "false")


def _load_schema(schema_path: str) -> Optional[Dict[str, Any]]:
    if not schema_path or not os.path.exists(schema_path):
        return None
    mtime = os.path.getmtime(schema_path)
    if (
        _SCHEMA_CACHE["schema"] is not None
        and _SCHEMA_CACHE["path"] == schema_path
        and _SCHEMA_CACHE["mtime"] == mtime
    ):
        return _SCHEMA_CACHE["schema"]
    with open(schema_path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        return None
    _SCHEMA_CACHE.update({"path": schema_path, "mtime": mtime, "schema": data})
    return data


def _load_booster(model_path: str):
    if not model_path or not os.path.exists(model_path):
        return None
    mtime = os.path.getmtime(model_path)
    if (
        _MODEL_CACHE["booster"] is not None
        and _MODEL_CACHE["path"] == model_path
        and _MODEL_CACHE["mtime"] == mtime
    ):
        return _MODEL_CACHE["booster"]
    try:
        import lightgbm as lgb
    except Exception as exc:
        logger.warning(f"LGBM runtime dependency missing: {exc}")
        return None
    booster = lgb.Booster(model_file=model_path)
    _MODEL_CACHE.update({"path": model_path, "mtime": mtime, "booster": booster})
    return booster


def _vector_from_features(
    feature_map: Dict[str, Optional[float]],
    schema: Optional[Dict[str, Any]],
) -> List[float]:
    feature_names = schema.get("feature_names") if isinstance(schema, dict) else None
    ordered_names = feature_names if isinstance(feature_names, list) and feature_names else FEATURE_NAMES
    vector: List[float] = []
    for name in ordered_names:
        value = feature_map.get(str(name))
        vector.append(float("nan") if value is None else float(value))
    return vector


def predict_lgbm_daily_high(
    *,
    city_name: str,
    current_forecasts: Dict[str, Any],
    deb_prediction: Optional[float],
    current_temp: Optional[float],
    max_so_far: Optional[float],
    humidity: Optional[float],
    wind_speed_kt: Optional[float],
    visibility_mi: Optional[float],
    local_hour: int,
    local_date: str,
    peak_status: str,
    history_data: Optional[Dict[str, Any]] = None,
) -> Tuple[Optional[float], Dict[str, Any]]:
    if not is_lgbm_enabled():
        return None, {"reason": "disabled"}

    schema = _load_schema(lgbm_schema_path())
    booster = _load_booster(lgbm_model_path())
    if schema is None or booster is None:
        return None, {"reason": "artifact_missing"}

    feature_map, meta = build_runtime_feature_map(
        city_name=city_name,
        current_forecasts=current_forecasts,
        deb_prediction=deb_prediction,
        current_temp=current_temp,
        max_so_far=max_so_far,
        humidity=humidity,
        wind_speed_kt=wind_speed_kt,
        visibility_mi=visibility_mi,
        local_hour=local_hour,
        local_date=local_date,
        peak_status=peak_status,
        history_data=history_data,
    )
    if not feature_map:
        return None, meta

    if int(meta.get("history_count") or 0) < lgbm_min_history_points():
        return None, {
            "reason": "insufficient_history",
            "history_count": int(meta.get("history_count") or 0),
        }

    try:
        vector = _vector_from_features(feature_map, schema)
        prediction = booster.predict([vector], num_iteration=booster.best_iteration)
        value = _sf(prediction[0] if prediction is not None else None)
        if value is None:
            return None, {"reason": "empty_prediction"}
        return round(float(value), 1), {
            "reason": "ok",
            "history_count": int(meta.get("history_count") or 0),
        }
    except Exception as exc:
        logger.warning(f"LGBM prediction failed for {city_name}: {exc}")
        return None, {"reason": "predict_failed", "error": str(exc)}
