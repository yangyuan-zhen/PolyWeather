"""Analysis utility functions extracted from analysis_service.py.

Pure helpers: clock arithmetic, bucket labelling, signal packaging.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

from web.core import _sf


# ── Clock / time-slot helpers ──────────────────────────────────────────

def clock_minutes(value: Any) -> Optional[int]:
    text = str(value or "").strip()
    match = re.search(r"\b(\d{1,2}):(\d{2})\b", text)
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2))
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        return None
    return hour * 60 + minute


def format_clock_minutes(value: int) -> str:
    value = max(0, min(23 * 60 + 59, int(value)))
    return f"{value // 60:02d}:{value % 60:02d}"


def next_observation_clock(local_time: Any) -> str:
    minutes = clock_minutes(local_time)
    if minutes is None:
        return "--"
    next_slot = ((minutes // 30) + 1) * 30
    if next_slot > 23 * 60 + 59:
        return "23:59"
    return format_clock_minutes(next_slot)


# ── Probability bucket helpers ─────────────────────────────────────────

def bucket_label_from_value(value: Optional[float], unit: str) -> Optional[str]:
    if value is None:
        return None
    try:
        return f"{int(round(float(value)))}{unit or '°C'}"
    except Exception:
        return None


def top_probability_bucket(distribution: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(distribution, list):
        return None
    candidates = [row for row in distribution if isinstance(row, dict)]
    if not candidates:
        return None
    return max(candidates, key=lambda row: _sf(row.get("probability")) or -1.0)


def bucket_label(row: Optional[Dict[str, Any]], unit: str) -> Optional[str]:
    if not isinstance(row, dict):
        return None
    for key in ("label", "bucket", "range"):
        raw = str(row.get(key) or "").strip()
        if raw:
            return raw
    return bucket_label_from_value(_sf(row.get("value")), unit)


# ── Signal packaging ───────────────────────────────────────────────────

def add_signal(
    signals: list,
    *,
    label: str,
    direction: str,
    strength: str,
    summary: str,
    label_en: Optional[str] = None,
    summary_en: Optional[str] = None,
) -> None:
    signals.append(
        {
            "label": label,
            "label_en": label_en or label,
            "direction": direction,
            "strength": strength,
            "summary": summary,
            "summary_en": summary_en or summary,
        }
    )


# ── Time / date helpers ────────────────────────────────────────────────

def parse_utc_datetime(value: Any) -> Optional[datetime]:
    raw = str(value or "").strip()
    if not raw:
        return None
    if "T" not in raw:
        try:
            epoch = float(raw)
        except Exception:
            return None
        if epoch <= 1_000_000_000:
            return None
        if epoch > 10_000_000_000:
            epoch = epoch / 1000.0
        try:
            return datetime.fromtimestamp(epoch, tz=timezone.utc)
        except Exception:
            return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def format_observation_time_local(value: Any, utc_offset: int) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if "T" in raw:
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone(timedelta(seconds=utc_offset))).strftime("%H:%M")
        except Exception:
            pass
    import re
    match = re.search(r"(\d{1,2}):(\d{2})", raw)
    if match:
        return f"{int(match.group(1)):02d}:{match.group(2)}"
    return raw[:16]


def parse_local_hour(local_time_str: Optional[str]) -> Optional[int]:
    if not local_time_str:
        return None
    try:
        parts = str(local_time_str).strip().split(":")
        hour = int(parts[0])
        if 0 <= hour <= 23:
            return hour
    except Exception:
        pass
    return None


def metar_is_current_local_day(
    metar: Dict[str, Any],
    *,
    local_date: str,
    utc_offset: int,
) -> bool:
    if not isinstance(metar, dict) or not metar:
        return False
    if metar.get("stale_for_today") is True:
        return False
    observation_local_date = str(metar.get("observation_local_date") or "").strip()
    if observation_local_date:
        return observation_local_date == local_date
    obs_dt = parse_utc_datetime(metar.get("observation_time"))
    if obs_dt is None:
        return True
    local_dt = obs_dt.astimezone(timezone(timedelta(seconds=utc_offset)))
    return local_dt.strftime("%Y-%m-%d") == local_date


def is_plausible_city_temp(city: str, value: Any, unit: str = "°C") -> bool:
    from src.data_collection.city_registry import CITY_REGISTRY

    temp = _sf(value)
    if temp is None:
        return False
    meta = CITY_REGISTRY.get(str(city or "").strip().lower(), {}) or {}
    min_c = _sf(meta.get("min_plausible_metar_temp_c"))
    if min_c is None:
        return True
    min_value = min_c * 9 / 5 + 32 if str(unit or "").upper().endswith("F") else min_c
    return temp >= min_value


def dedupe_forecast_daily(rows: Any) -> list:
    if not isinstance(rows, list):
        return []
    seen = set()
    out = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        date = str(row.get("date") or "").strip()
        if not date or date in seen:
            continue
        seen.add(date)
        out.append(row)
    return out


def mgm_hourly_high(mgm: Dict[str, Any]) -> Optional[float]:
    hourly = mgm.get("hourly") if isinstance(mgm, dict) else []
    if not isinstance(hourly, list):
        return None
    values = []
    for row in hourly:
        if not isinstance(row, dict):
            continue
        value = _sf(row.get("temp"))
        if value is not None:
            values.append(value)
    return max(values) if values else None
