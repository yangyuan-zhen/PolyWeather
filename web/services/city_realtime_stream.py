"""Lightweight realtime temperature stream for scrolling chart.

Maintains per-city deque buffers (max 1440 points) fed by _analyze()
refreshes.  The /api/city/{name}/realtime-stream endpoint reads from
these buffers and returns a simple {points, thresholds} payload that
the frontend RealtimeScrollChart polls every 30 seconds.
"""

from __future__ import annotations

import collections
import threading
import time
from typing import Any, Dict, List, Optional

from web.analysis_service import _analyze
from web.core import CITIES

# Per-city ring buffers: city_name → deque of {timestamp, temp, source}
_STREAM_BUFFERS: Dict[str, collections.deque] = {}
_BUFFER_LOCK = threading.Lock()
_MAXLEN = 1440


def _best_temp(data: Dict[str, Any]) -> Optional[float]:
    """METAR-first, then runway sensor, then settlement current."""
    airport = data.get("airport_current") or {}
    t = airport.get("current", {}).get("temp") if isinstance(airport, dict) else None
    if t is not None:
        return float(t)
    # AMOS / runway sensor
    amos = data.get("amos") or {}
    if isinstance(amos, dict):
        runway_obs = amos.get("runway_obs") or {}
        temps = runway_obs.get("temperatures") if isinstance(runway_obs, dict) else []
        if isinstance(temps, list) and temps:
            for pair in temps:
                vals = pair if isinstance(pair, list) else []
                for v in vals:
                    try:
                        if v is not None:
                            return float(v)
                    except (TypeError, ValueError):
                        continue
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


def capture_sample(city: str) -> None:
    """Record one sample for *city* into its ring buffer."""
    try:
        data = _analyze(city, force_refresh=False, detail_mode="panel")
    except Exception:
        return

    temp = _best_temp(data)
    if temp is None:
        return

    ts = time.strftime("%H:%M:%S")
    point = {"timestamp": ts, "temp": round(temp, 1), "source": "metar"}

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

    # Build thresholds from cached analysis
    try:
        data = _analyze(city, force_refresh=False, detail_mode="panel")
        thresholds = _extract_thresholds(data)
    except Exception:
        thresholds = []

    return {"points": points, "thresholds": thresholds}
