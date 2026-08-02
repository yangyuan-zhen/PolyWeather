"""Lightweight realtime temperature stream for scrolling chart.

Maintains per-city deque buffers (max 1440 points) fed by cached latest
observations. The polling endpoint must not trigger external weather
fetches; collectors and cache refreshers feed DB state.
"""

from __future__ import annotations

import collections
import threading
import time
from typing import Any, Dict, List, Optional

from src.database.db_manager import DBManager

# Per-city ring buffers: city_name → deque of {timestamp, temp, source}
_STREAM_BUFFERS: Dict[str, collections.deque] = {}
_BUFFER_LOCK = threading.Lock()
_MAXLEN = 1440
_CACHE_DB = DBManager()
_analyze = None  # compatibility placeholder for older tests/monkeypatches


def _best_temp(data: Dict[str, Any]) -> Optional[float]:
    """METAR-first, then settlement current."""
    airport = data.get("airport_current") or {}
    t = airport.get("current", {}).get("temp") if isinstance(airport, dict) else None
    if t is not None:
        return float(t)
    # Settlement source
    curr = data.get("current") or {}
    if isinstance(curr, dict) and curr.get("temp") is not None:
        return float(curr["temp"])
    return None


def _extract_thresholds(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Extract threshold lines from market data."""
    thresholds: List[Dict[str, Any]] = []
    dist = (data.get("probabilities") or {}).get("distribution") or []
    current_temp = _best_temp(data)

    for bucket in dist:
        if not isinstance(bucket, dict):
            continue
        temp_val = bucket.get("temp")
        if temp_val is None:
            continue
        try:
            t = float(temp_val)
        except (TypeError, ValueError):
            continue
        label = str(bucket.get("label") or f"{t}°C")
        thresholds.append({
            "label": label,
            "threshold_c": t,
            "breached": current_temp is not None and current_temp >= t,
        })

    # Sort by temperature ascending
    thresholds.sort(key=lambda x: float(x["threshold_c"]))
    return thresholds


def _cached_city_payload(city: str) -> Dict[str, Any]:
    normalized_city = str(city or "").strip().lower()
    if not normalized_city:
        return {}
    for kind in ("panel", "full"):
        try:
            entry = _CACHE_DB.get_city_cache(kind, normalized_city)
        except Exception:
            continue
        if not isinstance(entry, dict):
            continue
        payload = entry.get("payload") or {}
        if isinstance(payload, dict) and payload:
            return payload
    return {}


def _latest_canonical_point(city: str) -> Optional[Dict[str, Any]]:
    normalized_city = str(city or "").strip().lower()
    if not normalized_city:
        return None
    try:
        row = _CACHE_DB.get_canonical_temperature(normalized_city)
    except Exception:
        return None
    if not isinstance(row, dict):
        return None
    canonical = row.get("payload") or row
    if not isinstance(canonical, dict):
        return None
    try:
        temp = float(canonical.get("value"))
    except (TypeError, ValueError):
        return None
    timestamp = str(
        canonical.get("observed_at")
        or canonical.get("observed_at_local")
        or canonical.get("fetched_at")
        or time.strftime("%H:%M:%S")
    )
    source = str(canonical.get("source") or "canonical")
    return {"timestamp": timestamp, "temp": round(temp, 1), "source": source}


def capture_sample(city: str) -> None:
    """Record one sample for *city* into its ring buffer."""
    point = _latest_canonical_point(city)
    if point is None:
        data = _cached_city_payload(city)
        temp = _best_temp(data)
        if temp is None:
            return
        current = data.get("current") if isinstance(data, dict) else {}
        source = "cache"
        if isinstance(current, dict):
            source = str(current.get("source_code") or current.get("settlement_source") or source)
        point = {"timestamp": time.strftime("%H:%M:%S"), "temp": round(temp, 1), "source": source}

    with _BUFFER_LOCK:
        buf = _STREAM_BUFFERS.get(city)
        if buf is None:
            buf = collections.deque(maxlen=_MAXLEN)
            _STREAM_BUFFERS[city] = buf
        buf.append(point)


def get_realtime_stream_payload(city: str) -> Dict[str, Any]:
    """Return {points, thresholds} for the scrolling chart."""
    # Capture a fresh sample
    capture_sample(city)

    with _BUFFER_LOCK:
        buf = _STREAM_BUFFERS.get(city)
        points = list(buf) if buf else []

    thresholds = _extract_thresholds(_cached_city_payload(city))

    return {"points": points, "thresholds": thresholds}
