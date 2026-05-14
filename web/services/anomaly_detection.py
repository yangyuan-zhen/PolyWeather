"""Anomaly detection — pure math, no AI call.

Flags cities where current observations deviate from model predictions.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from web.scan_city_ai_helpers import _safe_float


def _check_city_anomaly(
    data: Dict[str, Any],
    *,
    high_temp_threshold: float = 2.0,
) -> Optional[Dict[str, Any]]:
    """Return anomaly flag if current observation breaks model cluster bounds."""
    current = data.get("current") if isinstance(data.get("current"), dict) else {}
    airport = data.get("airport_current") if isinstance(data.get("airport_current"), dict) else {}
    multi = data.get("multi_model") if isinstance(data.get("multi_model"), dict) else {}
    deb = data.get("deb") if isinstance(data.get("deb"), dict) else {}

    observed = _safe_float(current.get("temp") or airport.get("temp"))
    if observed is None:
        return None

    model_highs = [
        _safe_float(v)
        for v in multi.values()
        if _safe_float(v) is not None
    ]
    deb_pred = _safe_float(deb.get("prediction"))
    if deb_pred is not None:
        model_highs.append(deb_pred)

    if not model_highs:
        return None

    model_max = max(model_highs)
    model_min = min(model_highs)
    model_median = sorted(model_highs)[len(model_highs) // 2]

    delta_above_max = observed - model_max
    delta_below_min = model_min - observed
    delta_from_median = observed - model_median

    anomaly: Optional[Dict[str, Any]] = None

    if delta_above_max > high_temp_threshold:
        anomaly = {
            "level": "breakout_above",
            "observed": observed,
            "model_max": model_max,
            "delta": round(delta_above_max, 1),
            "model_count": len(model_highs),
        }
    elif delta_below_min > high_temp_threshold:
        anomaly = {
            "level": "breakout_below",
            "observed": observed,
            "model_min": model_min,
            "delta": round(delta_below_min, 1),
            "model_count": len(model_highs),
        }
    elif abs(delta_from_median) > 1.5:
        anomaly = {
            "level": "deviation",
            "observed": observed,
            "model_median": model_median,
            "delta": round(delta_from_median, 1),
            "model_count": len(model_highs),
        }

    if anomaly:
        anomaly.update(
            {
                "city": data.get("name") or data.get("city"),
                "local_date": data.get("local_date"),
                "temp_unit": data.get("temp_symbol", "°C"),
                "deb_prediction": deb_pred,
            }
        )
    return anomaly


def detect_scan_terminal_anomalies(
    rows: List[Dict[str, Any]],
    *,
    high_temp_threshold: float = 2.0,
) -> List[Dict[str, Any]]:
    """Scan all terminal rows and return anomaly flags."""
    anomalies = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        city_data = row.get("city_data") or row
        flag = _check_city_anomaly(city_data, high_temp_threshold=high_temp_threshold)
        if flag:
            flag["row_id"] = row.get("row_id") or row.get("id")
            anomalies.append(flag)
    return anomalies
