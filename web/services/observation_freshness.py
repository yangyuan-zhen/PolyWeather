"""Observation source freshness profiles and helpers.

Extracted from analysis_service.py to keep the god module leaner.
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

from web.services.analysis_utils import parse_utc_datetime

_OBSERVATION_SOURCE_PROFILES: Dict[str, Dict[str, Any]] = {
    "amos": {
        "label": "AMOS",
        "native_update_interval_sec": 60,
        "fresh_window_sec": 180,
        "expected_grace_sec": 180,
        "stale_after_sec": 900,
    },
    "amsc_awos": {
        "label": "AMSC AWOS",
        "native_update_interval_sec": 60,
        "fresh_window_sec": 180,
        "expected_grace_sec": 180,
        "stale_after_sec": 900,
    },
    "jma": {
        "label": "JMA",
        "native_update_interval_sec": 600,
        "fresh_window_sec": 900,
        "expected_grace_sec": 600,
        "stale_after_sec": 2700,
    },
    "fmi": {
        "label": "FMI",
        "native_update_interval_sec": 600,
        "fresh_window_sec": 900,
        "expected_grace_sec": 600,
        "stale_after_sec": 2700,
    },
    "knmi": {
        "label": "KNMI",
        "native_update_interval_sec": 600,
        "fresh_window_sec": 900,
        "expected_grace_sec": 600,
        "stale_after_sec": 2700,
    },
    "hko": {
        "label": "HKO",
        "native_update_interval_sec": 600,
        "fresh_window_sec": 900,
        "expected_grace_sec": 600,
        "stale_after_sec": 2700,
    },
    "cwa": {
        "label": "CWA",
        "native_update_interval_sec": 600,
        "fresh_window_sec": 900,
        "expected_grace_sec": 600,
        "stale_after_sec": 2700,
    },
    "mgm": {
        "label": "MGM",
        "native_update_interval_sec": 900,
        "fresh_window_sec": 900,
        "expected_grace_sec": 900,
        "stale_after_sec": 3600,
    },
    "ims": {
        "label": "IMS",
        "native_update_interval_sec": 600,
        "fresh_window_sec": 900,
        "expected_grace_sec": 600,
        "stale_after_sec": 2700,
    },
    "madis": {
        "label": "NOAA MADIS",
        "native_update_interval_sec": 900,
        "fresh_window_sec": 600,
        "expected_grace_sec": 900,
        "stale_after_sec": 3600,
    },
    "aeroweb": {
        "label": "AEROWEB",
        "native_update_interval_sec": 900,
        "fresh_window_sec": 900,
        "expected_grace_sec": 900,
        "stale_after_sec": 3600,
    },
    "ncm": {
        "label": "NCM",
        "native_update_interval_sec": 900,
        "fresh_window_sec": 900,
        "expected_grace_sec": 900,
        "stale_after_sec": 3600,
    },
    "singapore_mss": {
        "label": "Singapore MSS",
        "native_update_interval_sec": 600,
        "fresh_window_sec": 900,
        "expected_grace_sec": 600,
        "stale_after_sec": 2700,
    },
    "metar": {
        "label": "METAR",
        "native_update_interval_sec": 900,
        "fresh_window_sec": 600,
        "expected_grace_sec": 900,
        "stale_after_sec": 3600,
    },
    "noaa": {
        "label": "NOAA",
        "native_update_interval_sec": 900,
        "fresh_window_sec": 600,
        "expected_grace_sec": 900,
        "stale_after_sec": 3600,
    },
    "wunderground": {
        "label": "METAR",
        "native_update_interval_sec": 900,
        "fresh_window_sec": 600,
        "expected_grace_sec": 900,
        "stale_after_sec": 3600,
    },
}


def observation_age_min(value: Any, now_utc: Optional[datetime] = None) -> Optional[int]:
    obs_dt = parse_utc_datetime(value)
    if obs_dt is None:
        return None
    now = now_utc or datetime.now(timezone.utc)
    return max(0, int((now - obs_dt).total_seconds() / 60))


def canonical_observation_source_code(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return "metar"
    if "amos" in raw:
        return "amos"
    if "jma" in raw:
        return "jma"
    if "fmi" in raw:
        return "fmi"
    if "knmi" in raw:
        return "knmi"
    if "hko" in raw:
        return "hko"
    if "cwa" in raw:
        return "cwa"
    if "mgm" in raw:
        return "mgm"
    if "ims" in raw:
        return "ims"
    if "madis" in raw:
        return "madis"
    if "aeroweb" in raw:
        return "aeroweb"
    if "ncm" in raw:
        return "ncm"
    if "singapore_mss" in raw or raw == "mss":
        return "singapore_mss"
    if "noaa" in raw:
        return "noaa"
    if "wunderground" in raw or raw == "wu":
        return "wunderground"
    return raw


def optional_str(value: Any) -> Optional[str]:
    raw = str(value or "").strip()
    return raw or None


def build_observation_freshness(
    *,
    source_code: Any,
    source_label: Any = None,
    observed_at: Any = None,
    observed_at_local: Any = None,
    ingested_at: Any = None,
    age_min: Optional[int] = None,
    now_utc: Optional[datetime] = None,
) -> Dict[str, Any]:
    code = canonical_observation_source_code(source_code or source_label)
    profile = _OBSERVATION_SOURCE_PROFILES.get(code) or _OBSERVATION_SOURCE_PROFILES["metar"]
    now = now_utc or datetime.now(timezone.utc)
    obs_dt = parse_utc_datetime(observed_at)
    age_sec = None
    if age_min is not None:
        try:
            age_sec = max(0, int(age_min) * 60)
        except Exception:
            age_sec = None
    if age_sec is None and obs_dt is not None:
        age_sec = max(0, int((now - obs_dt).total_seconds()))

    if age_sec is None:
        status = "unknown"
        reason = "observation_time_missing"
    elif age_sec <= int(profile["fresh_window_sec"]):
        status = "fresh"
        reason = "within_native_fresh_window"
    elif age_sec <= int(profile["native_update_interval_sec"]) + int(profile["expected_grace_sec"]):
        status = "expected_wait"
        reason = "within_source_expected_cadence"
    elif age_sec <= int(profile["stale_after_sec"]):
        status = "delayed"
        reason = "past_expected_cadence"
    else:
        status = "stale"
        reason = "past_stale_threshold"

    expected_next = (
        obs_dt + timedelta(seconds=int(profile["native_update_interval_sec"]))
        if obs_dt is not None
        else None
    )
    return {
        "source_code": code,
        "source_label": str(source_label or profile["label"]),
        "observed_at": obs_dt.isoformat() if obs_dt is not None else optional_str(observed_at),
        "observed_at_local": optional_str(observed_at_local),
        "ingested_at": optional_str(ingested_at),
        "native_update_interval_sec": int(profile["native_update_interval_sec"]),
        "expected_next_update_at": expected_next.isoformat() if expected_next is not None else None,
        "freshness_status": status,
        "freshness_reason": reason,
        "age_sec": age_sec,
    }
