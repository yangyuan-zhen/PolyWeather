"""Analysis utility functions extracted from analysis_service.py.

Pure helpers: clock arithmetic, bucket labelling, signal packaging.
"""

from __future__ import annotations

import re
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
