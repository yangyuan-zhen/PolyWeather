from __future__ import annotations

import os
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

import requests
from loguru import logger

from src.utils.metrics import record_source_call


TIMESFM_MODEL_NAME = "TimesFM"
TIMESFM_DEFAULT_MODEL_ID = "google/timesfm-2.5-200m-pytorch"


def _sf(value: object) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _parse_date(raw: object) -> Optional[datetime]:
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d")
    except Exception:
        return None


def _get_default_history_file() -> str:
    project_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
    return os.path.join(project_root, "data", "daily_records.json")


def _is_enabled() -> bool:
    return str(os.getenv("POLYWEATHER_TIMESFM_ENABLED", "false")).strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _get_service_url() -> str:
    return str(os.getenv("POLYWEATHER_TIMESFM_SERVICE_URL", "")).strip().rstrip("/")


def _load_actual_history(
    city_name: str,
    history_file: Optional[str] = None,
    max_points: Optional[int] = None,
) -> List[Dict[str, object]]:
    from src.analysis.deb_algorithm import load_history
    from src.data_collection.city_registry import ALIASES

    city_key = ALIASES.get(
        str(city_name or "").strip().lower(),
        str(city_name or "").strip().lower(),
    )
    if not city_key:
        return []

    data = load_history(history_file or _get_default_history_file())
    city_data = data.get(city_key) if isinstance(data, dict) else None
    if not isinstance(city_data, dict):
        return []

    rows: List[Dict[str, object]] = []
    for date_key, record in city_data.items():
        if not isinstance(record, dict):
            continue
        stamp = _parse_date(date_key)
        actual = _sf(record.get("actual_high"))
        if stamp is None or actual is None:
            continue
        rows.append(
            {
                "timestamp": stamp.strftime("%Y-%m-%d"),
                "value": round(actual, 1),
            }
        )

    rows.sort(key=lambda item: str(item.get("timestamp") or ""))
    if max_points and max_points > 0:
        rows = rows[-max_points:]
    return rows


def predict_timesfm_daily(
    *,
    city_name: str,
    forecast_dates: List[str],
    daily_model_forecasts: Optional[Dict[str, Dict[str, object]]] = None,
    history_file: Optional[str] = None,
) -> Dict[str, Any]:
    started = time.perf_counter()
    service_url = _get_service_url()
    timeout_sec = float(os.getenv("POLYWEATHER_TIMESFM_TIMEOUT_SEC", "12"))
    max_history_points = int(os.getenv("POLYWEATHER_TIMESFM_HISTORY_LIMIT", "60"))
    min_history_points = int(os.getenv("POLYWEATHER_TIMESFM_MIN_HISTORY_POINTS", "14"))

    if not _is_enabled():
        return {
            "predictions": {},
            "enabled": False,
            "reason": "disabled",
        }

    if not service_url:
        return {
            "predictions": {},
            "enabled": False,
            "reason": "service_not_configured",
        }

    normalized_dates = [
        str(date_str or "").strip()
        for date_str in (forecast_dates or [])
        if _parse_date(date_str) is not None
    ]
    normalized_dates = list(dict.fromkeys(normalized_dates))
    if not normalized_dates:
        return {
            "predictions": {},
            "enabled": True,
            "reason": "no_valid_future_dates",
        }

    history_rows = _load_actual_history(
        city_name=city_name,
        history_file=history_file,
        max_points=max_history_points,
    )
    if len(history_rows) < min_history_points:
        return {
            "predictions": {},
            "enabled": True,
            "reason": "insufficient_history",
            "history_count": len(history_rows),
        }

    payload = {
        "city": city_name,
        "series_frequency": "D",
        "series_kind": "actual_high",
        "series": history_rows,
        "future_dates": normalized_dates,
        "daily_model_forecasts": daily_model_forecasts or {},
    }

    try:
        response = requests.post(
            f"{service_url}/predict/daily",
            json=payload,
            timeout=timeout_sec,
        )
        response.raise_for_status()
        data = response.json()
        raw_predictions = data.get("predictions", {}) if isinstance(data, dict) else {}

        predictions: Dict[str, float] = {}
        for date_str in normalized_dates:
            parsed = _sf((raw_predictions or {}).get(date_str))
            if parsed is None:
                continue
            predictions[date_str] = round(parsed, 1)

        record_source_call(
            "timesfm",
            "predict",
            "success" if predictions else "empty",
            (time.perf_counter() - started) * 1000.0,
        )
        return {
            "predictions": predictions,
            "enabled": True,
            "reason": "ok" if predictions else "empty",
            "history_count": len(history_rows),
            "service_url": service_url,
            "model": data.get("model") if isinstance(data, dict) else None,
            "model_id": data.get("model_id") if isinstance(data, dict) else None,
            "series_frequency": "D",
            "series_kind": "actual_high",
            "quantiles": data.get("quantiles") if isinstance(data, dict) else None,
        }
    except Exception as exc:
        logger.warning(f"TimesFM remote request failed for {city_name}: {exc}")
        record_source_call(
            "timesfm",
            "predict",
            "error",
            (time.perf_counter() - started) * 1000.0,
        )
        return {
            "predictions": {},
            "enabled": True,
            "reason": "request_failed",
            "history_count": len(history_rows),
            "service_url": service_url,
            "error": str(exc),
        }
