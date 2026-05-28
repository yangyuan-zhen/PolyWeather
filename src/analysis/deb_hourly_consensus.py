from __future__ import annotations

from typing import Any, Dict, List, Optional

from src.analysis.deb_algorithm import calculate_dynamic_weight_components

DEB_HOURLY_CONSENSUS_VERSION = "deb_hourly_consensus.v1"


def _to_float(value: Any) -> Optional[float]:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if result != result:
        return None
    return result


def _time_part(value: Any) -> str:
    text = str(value or "").strip()
    if "T" in text:
        text = text.split("T", 1)[1]
    if " " in text:
        text = text.rsplit(" ", 1)[-1]
    return text[:5]


def _matches_local_date(value: Any, local_date: Optional[str]) -> bool:
    if not local_date:
        return True
    text = str(value or "").strip()
    if "T" not in text and " " not in text:
        return True
    return text.startswith(local_date)


def _weighted_value_at_index(
    index: int,
    hourly_forecasts: Dict[str, Any],
    weights: Dict[str, float],
) -> Optional[float]:
    weighted_sum = 0.0
    weight_sum = 0.0
    for model_name, model_weight in weights.items():
        series = hourly_forecasts.get(model_name)
        if not isinstance(series, (list, tuple)) or index >= len(series):
            continue
        value = _to_float(series[index])
        if value is None:
            continue
        weighted_sum += value * model_weight
        weight_sum += model_weight
    if weight_sum <= 0:
        return None
    return weighted_sum / weight_sum


def build_deb_hourly_consensus_path(
    *,
    city: str,
    hourly_times: List[Any],
    hourly_forecasts: Dict[str, Any],
    daily_forecasts: Dict[str, Any],
    deb_prediction: Optional[float],
    local_date: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    if not hourly_times or not isinstance(hourly_forecasts, dict):
        return None

    components = calculate_dynamic_weight_components(city, daily_forecasts or {})
    weights = {
        model: float(weight)
        for model, weight in (components.get("weights") or {}).items()
        if model in hourly_forecasts and _to_float(weight) is not None
    }
    if not weights:
        return None

    times: List[str] = []
    raw_temps: List[Optional[float]] = []
    for idx, raw_time in enumerate(hourly_times):
        if not _matches_local_date(raw_time, local_date):
            continue
        value = _weighted_value_at_index(idx, hourly_forecasts, weights)
        if value is None:
            continue
        times.append(_time_part(raw_time))
        raw_temps.append(round(value, 3))

    numeric_raw = [value for value in raw_temps if value is not None]
    if not times or not numeric_raw:
        return None

    deb_value = _to_float(deb_prediction)
    anchor_adjustment = 0.0
    if deb_value is not None:
        anchor_adjustment = deb_value - max(numeric_raw)
    temps = [
        round(value + anchor_adjustment, 1) if value is not None else None
        for value in raw_temps
    ]

    return {
        "version": DEB_HOURLY_CONSENSUS_VERSION,
        "source": DEB_HOURLY_CONSENSUS_VERSION,
        "base_source": "multi_model_hourly_deb_weights",
        "times": times,
        "temps": temps,
        "raw_temps": [round(value, 1) if value is not None else None for value in raw_temps],
        "weights": {model: round(weight, 4) for model, weight in weights.items()},
        "weights_info": components.get("weights_info") or "",
        "anchor_adjustment": round(anchor_adjustment, 3),
    }
