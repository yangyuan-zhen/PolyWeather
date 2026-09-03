"""Unified observation data-quality layer.

Single place that derives freshness/status/quality flags for one canonical
observation. Collector, API and frontend must reuse these helpers instead of
implementing their own freshness thresholds.

Status vocabulary (stable, additive only):
  fresh / delayed / stale / invalid / source_error / fallback
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from web.services.analysis_utils import parse_utc_datetime
from web.services.observation_freshness import build_observation_freshness

FRESH = "fresh"
DELAYED = "delayed"
STALE = "stale"
INVALID = "invalid"
SOURCE_ERROR = "source_error"
FALLBACK = "fallback"

_VALID_STATUSES = {FRESH, DELAYED, STALE, INVALID, SOURCE_ERROR, FALLBACK}

# Conservative physical bounds (Celsius). Wide enough to never reject real
# extreme weather; only catches unit mixups / sensor garbage.
ABS_MIN_C = -80.0
ABS_MAX_C = 60.0
# Short-term jump guard: larger than any plausible 30-min swing.
MAX_JUMP_C_30MIN = 15.0
# Future tolerance for clock skew.
FUTURE_TOLERANCE_SEC = 300


def _to_float(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        result = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(result):
        return None
    return result


def _to_celsius(value: Any, unit: Any) -> Optional[float]:
    number = _to_float(value)
    if number is None:
        return None
    text = str(unit or "c").strip().lower()
    if text.startswith("f"):
        return (number - 32.0) * 5.0 / 9.0
    return number


def evaluate_observation(
    *,
    source: Any,
    station: Any = "",
    observed_at: Any = "",
    fetched_at: Any = "",
    temp: Any = None,
    value_unit: Any = "c",
    fallback_in_use: bool = False,
    source_error: Optional[str] = None,
    now_utc: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Derive source/station/times/age/freshness/status/quality_flags."""
    now = now_utc or datetime.now(timezone.utc)
    obs_dt = parse_utc_datetime(observed_at)
    fetch_dt = parse_utc_datetime(fetched_at)
    age_seconds: Optional[int] = None
    if obs_dt is not None:
        age_seconds = max(0, int((now - obs_dt).total_seconds()))
    freshness = build_observation_freshness(
        source_code=source,
        observed_at=observed_at,
        ingested_at=fetched_at,
        now_utc=now,
    )
    freshness_status = str(freshness.get("freshness_status") or "unknown")
    quality_flags: List[str] = []
    temp_c = _to_celsius(temp, value_unit)
    if temp is None or temp_c is None:
        quality_flags.append("missing_temp")
    elif temp_c < ABS_MIN_C or temp_c > ABS_MAX_C:
        quality_flags.append("out_of_range")
    if obs_dt is None:
        quality_flags.append("missing_observed_at")
    elif (obs_dt - now).total_seconds() > FUTURE_TOLERANCE_SEC:
        quality_flags.append("future_timestamp")
    station_text = str(station or "").strip()
    if not station_text:
        quality_flags.append("missing_station")

    if source_error:
        status = SOURCE_ERROR
    elif "missing_temp" in quality_flags or "out_of_range" in quality_flags:
        status = INVALID
    elif "future_timestamp" in quality_flags:
        status = INVALID
    elif fallback_in_use:
        status = FALLBACK
    elif freshness_status == "fresh":
        status = FRESH
    elif freshness_status in {"expected_wait", "unknown"}:
        status = DELAYED if freshness_status == "expected_wait" else STALE
        if freshness_status == "unknown":
            quality_flags.append("unknown_freshness")
    elif freshness_status == "delayed":
        status = DELAYED
    else:
        status = STALE
    return {
        "source": str(source or "").strip().lower(),
        "station": station_text.upper() or None,
        "observed_at": obs_dt.isoformat() if obs_dt is not None else None,
        "fetched_at": fetch_dt.isoformat() if fetch_dt is not None else None,
        "age_seconds": age_seconds,
        "freshness": freshness,
        "freshness_status": freshness_status,
        "status": status,
        "quality_flags": quality_flags,
        "temp_c": temp_c,
    }


def guard_observation(
    *,
    city: Any,
    source: Any,
    observed_at: Any,
    fetched_at: Any,
    temp: Any,
    value_unit: Any = "c",
    prev_observed_at: Any = None,
    prev_temp: Any = None,
    prev_temp_unit: Any = "c",
    now_utc: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Decide whether a new observation may replace canonical latest.

    Returns {"accept": bool, "reason": str}. Never raises.
    """
    now = now_utc or datetime.now(timezone.utc)
    obs_dt = parse_utc_datetime(observed_at)
    if obs_dt is None:
        return {"accept": False, "reason": "missing_observed_at"}
    if (obs_dt - now).total_seconds() > FUTURE_TOLERANCE_SEC:
        return {"accept": False, "reason": "future_timestamp"}
    temp_c = _to_celsius(temp, value_unit)
    if temp_c is None:
        return {"accept": False, "reason": "missing_or_nan_temp"}
    if temp_c < ABS_MIN_C or temp_c > ABS_MAX_C:
        return {"accept": False, "reason": "out_of_range"}
    prev_dt = parse_utc_datetime(prev_observed_at) if prev_observed_at else None
    if prev_dt is not None and obs_dt < prev_dt:
        return {"accept": False, "reason": "timestamp_regression"}
    if prev_dt is not None and obs_dt == prev_dt:
        prev_c = _to_celsius(prev_temp, prev_temp_unit)
        if prev_c is not None and abs(temp_c - prev_c) < 1e-9:
            return {"accept": False, "reason": "duplicate_observation"}
    if prev_dt is not None and prev_temp is not None:
        prev_c = _to_celsius(prev_temp, prev_temp_unit)
        if prev_c is not None:
            gap_sec = abs((obs_dt - prev_dt).total_seconds())
            if 0 < gap_sec <= 1800 and abs(temp_c - prev_c) > MAX_JUMP_C_30MIN:
                return {"accept": False, "reason": "extreme_jump"}
    return {"accept": True, "reason": "ok"}
