from __future__ import annotations

import hashlib
import json
import os
import re
import time as _time
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional

import httpx
from fastapi import HTTPException
from loguru import logger

from web.core import (
    _cache,
    CACHE_TTL,
    CACHE_TTL_ANKARA,
    CITIES,
    CITY_RISK_PROFILES,
    SETTLEMENT_SOURCE_LABELS,
    _is_excluded_model_name,
    _market_layer,
    _sf,
    _weather,
)
from src.analysis.deb_algorithm import calculate_dynamic_weights
from src.analysis.settlement_rounding import apply_city_settlement
from src.data_collection.country_networks import build_country_network_snapshot
from src.data_collection.city_registry import ALIASES, CITY_REGISTRY
from src.data_collection.nmc_sources import NMC_CITY_REFERENCES
from src.models.lgbm_daily_high import predict_lgbm_daily_high

TURKISH_MGM_CITIES = {"ankara", "istanbul"}
_ANALYSIS_CACHE_STATS_LOCK = threading.Lock()
_ANALYSIS_CACHE_STATS: Dict[str, Any] = {
    "total_requests": 0,
    "cache_hits": 0,
    "cache_misses": 0,
    "force_refresh_requests": 0,
    "last_cache_hit_at": None,
    "last_cache_miss_at": None,
    "last_city": None,
}
_SUMMARY_CACHE_LOCK = threading.Lock()
_SUMMARY_CACHE: Dict[str, Dict[str, Any]] = {}
_GROQ_COMMENTARY_CACHE_LOCK = threading.Lock()
_GROQ_COMMENTARY_CACHE: Dict[str, Dict[str, Any]] = {}
_GROQ_COMMENTARY_CACHE_TTL_SEC = int(
    os.getenv("POLYWEATHER_GROQ_COMMENTARY_CACHE_TTL_SEC", "1800")
)


def _format_observation_time_local(value: Any, utc_offset: int) -> str:
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
    match = re.search(r"(\d{1,2}):(\d{2})", raw)
    if match:
        return f"{int(match.group(1)):02d}:{match.group(2)}"
    return raw[:16]


def _fetch_nmc_current_fallback(city: str, *, use_fahrenheit: bool) -> Dict[str, Any]:
    city_key = str(city or "").strip().lower()
    if city_key not in NMC_CITY_REFERENCES:
        return {}
    try:
        payload = _weather.fetch_nmc_region_current(
            city_key,
            use_fahrenheit=use_fahrenheit,
        )
        return payload if isinstance(payload, dict) else {}
    except Exception as exc:
        logger.debug("NMC current fallback failed city={}: {}", city_key, exc)
        return {}


def _is_plausible_city_temp(city: str, value: Any, unit: str = "°C") -> bool:
    temp = _sf(value)
    if temp is None:
        return False
    meta = CITY_REGISTRY.get(str(city or "").strip().lower(), {}) or {}
    min_c = _sf(meta.get("min_plausible_metar_temp_c"))
    if min_c is None:
        return True
    min_value = min_c * 9 / 5 + 32 if str(unit or "").upper().endswith("F") else min_c
    return temp >= min_value


def _record_analysis_cache_event(*, city: str, hit: bool, force_refresh: bool) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _ANALYSIS_CACHE_STATS_LOCK:
        _ANALYSIS_CACHE_STATS["total_requests"] = int(_ANALYSIS_CACHE_STATS.get("total_requests") or 0) + 1
        _ANALYSIS_CACHE_STATS["last_city"] = str(city or "")
        if force_refresh:
            _ANALYSIS_CACHE_STATS["force_refresh_requests"] = int(_ANALYSIS_CACHE_STATS.get("force_refresh_requests") or 0) + 1
        if hit:
            _ANALYSIS_CACHE_STATS["cache_hits"] = int(_ANALYSIS_CACHE_STATS.get("cache_hits") or 0) + 1
            _ANALYSIS_CACHE_STATS["last_cache_hit_at"] = now
        else:
            _ANALYSIS_CACHE_STATS["cache_misses"] = int(_ANALYSIS_CACHE_STATS.get("cache_misses") or 0) + 1
            _ANALYSIS_CACHE_STATS["last_cache_miss_at"] = now


def get_analysis_cache_stats() -> Dict[str, Any]:
    with _ANALYSIS_CACHE_STATS_LOCK:
        stats = dict(_ANALYSIS_CACHE_STATS)
    hits = int(stats.get("cache_hits") or 0)
    misses = int(stats.get("cache_misses") or 0)
    eligible = hits + misses
    hit_rate = (hits / eligible) if eligible > 0 else None
    miss_rate = (misses / eligible) if eligible > 0 else None
    stats["hit_rate"] = round(hit_rate, 4) if hit_rate is not None else None
    stats["miss_rate"] = round(miss_rate, 4) if miss_rate is not None else None
    return stats


def _analysis_ttl_for_city(city: str) -> int:
    return CACHE_TTL_ANKARA if city.lower() in TURKISH_MGM_CITIES else CACHE_TTL


def _analysis_cache_key(city: str, detail_mode: str = "full") -> str:
    normalized_raw = str(detail_mode or "").strip().lower()
    if normalized_raw == "panel":
        normalized_mode = "panel"
    elif normalized_raw == "market":
        normalized_mode = "market"
    elif normalized_raw == "nearby":
        normalized_mode = "nearby"
    else:
        normalized_mode = "full"
    return f"{city}::{normalized_mode}"


def _get_cached_analysis(
    city: str,
    ttl: int,
    detail_modes: tuple[str, ...] = ("panel", "market", "nearby", "full"),
) -> Optional[Dict[str, Any]]:
    now_ts = _time.time()
    freshest_payload: Optional[Dict[str, Any]] = None
    freshest_ts = 0.0
    for detail_mode in detail_modes:
        cached = _cache.get(_analysis_cache_key(city, detail_mode))
        if not cached:
            continue
        cached_ts = float(cached.get("t", 0))
        payload = cached.get("d")
        if (
            cached_ts
            and now_ts - cached_ts < ttl
            and isinstance(payload, dict)
            and cached_ts >= freshest_ts
        ):
            freshest_payload = payload
            freshest_ts = cached_ts
    return freshest_payload


def _get_cached_summary(city: str, ttl: int) -> Optional[Dict[str, Any]]:
    now_ts = _time.time()
    with _SUMMARY_CACHE_LOCK:
        cached = _SUMMARY_CACHE.get(city)
        if cached and now_ts - float(cached.get("t", 0)) < ttl:
            payload = cached.get("d")
            if isinstance(payload, dict):
                return dict(payload)
    return None


def _set_cached_summary(city: str, payload: Dict[str, Any]) -> None:
    with _SUMMARY_CACHE_LOCK:
        _SUMMARY_CACHE[city] = {"t": _time.time(), "d": dict(payload)}


def _groq_commentary_enabled() -> bool:
    enabled = str(
        os.getenv("POLYWEATHER_GROQ_COMMENTARY_ENABLED", "false")
    ).strip().lower()
    api_key = str(os.getenv("GROQ_API_KEY") or "").strip()
    return enabled in {"1", "true", "yes", "on"} and bool(api_key)


def _clean_commentary_text(value: Any, *, limit: int = 240) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text)
    return text[:limit].strip()


def _build_groq_commentary_context(result: Dict[str, Any]) -> Dict[str, Any]:
    dynamic = result.get("dynamic_commentary") or {}
    vertical = result.get("vertical_profile_signal") or {}
    taf_signal = ((result.get("taf") or {}).get("signal") or {}) if isinstance(result.get("taf"), dict) else {}
    network = result.get("network_lead_signal") or {}
    peak = result.get("peak") or {}
    current = result.get("current") or {}
    airport_primary = result.get("airport_primary") or {}
    notes = dynamic.get("notes") if isinstance(dynamic.get("notes"), list) else []
    compact_notes = [_clean_commentary_text(item, limit=180) for item in notes]
    compact_notes = [item for item in compact_notes if item][:4]
    return {
        "city": result.get("display_name") or result.get("name"),
        "local_date": result.get("local_date"),
        "local_time": result.get("local_time"),
        "temp_symbol": result.get("temp_symbol"),
        "current_temp": current.get("temp"),
        "day_high_so_far": current.get("max_so_far"),
        "airport_anchor_temp": airport_primary.get("temp"),
        "airport_vs_network_delta": result.get("airport_vs_network_delta"),
        "peak_hours": peak.get("hours") or [],
        "peak_status": peak.get("status"),
        "network_lead_status": network.get("status"),
        "network_lead_note": _clean_commentary_text(network.get("note"), limit=180),
        "rules_summary": _clean_commentary_text(dynamic.get("summary"), limit=260),
        "rules_notes": compact_notes,
        "upper_air_summary_zh": _clean_commentary_text(vertical.get("summary_zh"), limit=260),
        "upper_air_summary_en": _clean_commentary_text(vertical.get("summary_en"), limit=260),
        "taf_summary_zh": _clean_commentary_text(taf_signal.get("summary_zh"), limit=220),
        "taf_summary_en": _clean_commentary_text(taf_signal.get("summary_en"), limit=220),
        "taf_peak_window": _clean_commentary_text(taf_signal.get("peak_window"), limit=80),
    }


def _normalize_groq_commentary_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    def _headline(value: Any, fallback: str) -> str:
        text = _clean_commentary_text(value, limit=90)
        return text or fallback

    def _bullets(value: Any) -> list[str]:
        items = value if isinstance(value, list) else []
        cleaned = [_clean_commentary_text(item, limit=120) for item in items]
        cleaned = [item for item in cleaned if item]
        return cleaned[:3]

    zh_headline = _headline(payload.get("headline_zh"), "结构信号以现有规则结论为主。")
    en_headline = _headline(payload.get("headline_en"), "Structural read stays anchored to the existing rule-based signal.")
    zh_bullets = _bullets(payload.get("bullets_zh"))
    en_bullets = _bullets(payload.get("bullets_en"))
    while len(zh_bullets) < 3:
        zh_bullets.append("继续结合当前节奏、边界风险和峰值窗口判断。")
    while len(en_bullets) < 3:
        en_bullets.append("Keep the read anchored to pace, boundary risk, and the peak window.")
    return {
        "headline_zh": zh_headline,
        "headline_en": en_headline,
        "bullets_zh": zh_bullets[:3],
        "bullets_en": en_bullets[:3],
        "source": "groq",
    }


def _request_groq_commentary(context: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    api_key = str(os.getenv("GROQ_API_KEY") or "").strip()
    if not api_key:
        return None
    model = str(os.getenv("POLYWEATHER_GROQ_COMMENTARY_MODEL") or "openai/gpt-oss-20b").strip()
    timeout_sec = float(os.getenv("POLYWEATHER_GROQ_COMMENTARY_TIMEOUT_SEC", "8"))
    payload = {
        "model": model,
        "temperature": 0.2,
        "max_tokens": 400,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You rewrite weather-market structure commentary. "
                    "Never invent facts. Use only the provided context. "
                    "Return concise bilingual output for a dashboard: "
                    "one headline and exactly three bullets in Chinese, and the same in English. "
                    "Keep every bullet actionable and short."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(context, ensure_ascii=False),
            },
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "polyweather_structure_commentary",
                "strict": True,
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "headline_zh": {"type": "string"},
                        "bullets_zh": {
                            "type": "array",
                            "items": {"type": "string"},
                            "minItems": 3,
                            "maxItems": 3,
                        },
                        "headline_en": {"type": "string"},
                        "bullets_en": {
                            "type": "array",
                            "items": {"type": "string"},
                            "minItems": 3,
                            "maxItems": 3,
                        },
                    },
                    "required": [
                        "headline_zh",
                        "bullets_zh",
                        "headline_en",
                        "bullets_en",
                    ],
                },
            },
        },
    }
    with httpx.Client(timeout=timeout_sec) as client:
        response = client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        response.raise_for_status()
        body = response.json()
    content = (
        (((body.get("choices") or [{}])[0]).get("message") or {}).get("content")
        if isinstance(body, dict)
        else None
    )
    if not content:
        return None
    try:
        return _normalize_groq_commentary_payload(json.loads(str(content)))
    except Exception:
        logger.warning("Groq commentary returned non-JSON payload")
        return None


def _maybe_enrich_dynamic_commentary_with_groq(
    city: str,
    result: Dict[str, Any],
) -> Dict[str, Any]:
    dynamic = result.get("dynamic_commentary") or {}
    if not _groq_commentary_enabled():
        return dynamic
    if dynamic.get("headline_zh") and dynamic.get("bullets_zh"):
        return dynamic

    context = _build_groq_commentary_context(result)
    if not context.get("rules_summary") and not context.get("rules_notes"):
        return dynamic

    cache_key = hashlib.sha256(
        json.dumps({"city": city, "context": context}, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    now = _time.time()
    with _GROQ_COMMENTARY_CACHE_LOCK:
        cached = _GROQ_COMMENTARY_CACHE.get(cache_key)
        if cached and now - float(cached.get("t") or 0) < _GROQ_COMMENTARY_CACHE_TTL_SEC:
            merged = dict(dynamic)
            merged.update(cached.get("payload") or {})
            return merged

    try:
        enriched = _request_groq_commentary(context)
    except Exception as exc:
        logger.warning("Groq commentary skipped for {}: {}", city, exc)
        return dynamic
    if not enriched:
        return dynamic

    with _GROQ_COMMENTARY_CACHE_LOCK:
        _GROQ_COMMENTARY_CACHE[cache_key] = {"t": now, "payload": enriched}
    merged = dict(dynamic)
    merged.update(enriched)
    return merged


def _interpolate_hourly_value(
    times: list,
    values: list,
    local_date: str,
    target_hour_frac: float,
) -> Optional[float]:
    points = []
    for ts, raw_value in zip(times or [], values or []):
        if not str(ts).startswith(local_date):
            continue
        value = _sf(raw_value)
        if value is None:
            continue
        try:
            hh_mm = str(ts).split("T")[1]
            hour = int(hh_mm[:2])
            minute = int(hh_mm[3:5]) if len(hh_mm) >= 5 else 0
        except Exception:
            continue
        points.append((hour + minute / 60.0, value))

    if not points:
        return None
    points.sort(key=lambda item: item[0])

    if target_hour_frac <= points[0][0]:
        return float(points[0][1])
    if target_hour_frac >= points[-1][0]:
        return float(points[-1][1])

    for idx in range(1, len(points)):
        left_hour, left_value = points[idx - 1]
        right_hour, right_value = points[idx]
        if target_hour_frac > right_hour:
            continue
        if right_hour == left_hour:
            return float(right_value)
        ratio = (target_hour_frac - left_hour) / (right_hour - left_hour)
        return float(left_value + (right_value - left_value) * ratio)

    return float(points[-1][1])


def _build_deviation_monitor(
    *,
    current_temp: Optional[float],
    deb_prediction: Optional[float],
    om_today: Optional[float],
    hourly_times: list,
    hourly_temps: list,
    local_date: str,
    local_hour_frac: float,
    observation_points: list,
) -> Dict[str, Any]:
    if current_temp is None or deb_prediction is None or om_today is None:
        return {}

    offset = _sf(deb_prediction) - _sf(om_today)
    if offset is None:
        return {}

    expected_now = _interpolate_hourly_value(
        hourly_times,
        [(_sf(value) + offset) if _sf(value) is not None else None for value in hourly_temps],
        local_date,
        local_hour_frac,
    )
    if expected_now is None:
        return {}

    delta = float(current_temp) - expected_now
    abs_delta = abs(delta)
    if abs_delta < 0.8:
        direction = "normal"
        severity = "normal"
    elif delta <= -1.8:
        direction = "cold"
        severity = "strong"
    elif delta >= 1.8:
        direction = "hot"
        severity = "strong"
    elif delta < 0:
        direction = "cold"
        severity = "light"
    else:
        direction = "hot"
        severity = "light"

    deviation_series = []
    for item in observation_points or []:
        if not isinstance(item, dict):
            continue
        obs_temp = _sf(item.get("temp"))
        raw_time = str(item.get("time") or "").strip()
        if obs_temp is None:
            continue
        match = re.search(r"(\d{1,2}):(\d{2})", raw_time)
        if not match:
            continue
        obs_hour_frac = int(match.group(1)) + int(match.group(2)) / 60.0
        ref_temp = _interpolate_hourly_value(
            hourly_times,
            [(_sf(value) + offset) if _sf(value) is not None else None for value in hourly_temps],
            local_date,
            obs_hour_frac,
        )
        if ref_temp is None:
            continue
        deviation_series.append(float(obs_temp) - ref_temp)

    trend = "stable"
    if len(deviation_series) >= 2:
        latest = deviation_series[-1]
        previous = deviation_series[-2]
        if latest * previous > 0:
            if abs(latest) - abs(previous) >= 0.3:
                trend = "expanding"
            elif abs(previous) - abs(latest) >= 0.3:
                trend = "contracting"

    if direction == "normal":
        label_zh = f"正常 ±{abs_delta:.1f}°C"
        label_en = f"Normal ±{abs_delta:.1f}°C"
    elif direction == "cold":
        label_zh = f"偏冷 {delta:.1f}°C"
        label_en = f"Cool bias {delta:.1f}°C"
    else:
        label_zh = f"偏热 +{abs_delta:.1f}°C"
        label_en = f"Warm bias +{abs_delta:.1f}°C"

    trend_zh = {
        "contracting": "收敛中",
        "expanding": "扩大中",
        "stable": "稳定",
    }.get(trend, "稳定")
    trend_en = {
        "contracting": "contracting",
        "expanding": "expanding",
        "stable": "stable",
    }.get(trend, "stable")

    return {
        "available": True,
        "current_delta": round(delta, 1),
        "reference_temp": round(expected_now, 1),
        "direction": direction,
        "severity": severity,
        "trend": trend,
        "label_zh": label_zh,
        "label_en": label_en,
        "trend_label_zh": trend_zh,
        "trend_label_en": trend_en,
    }

def _wind_components(speed: Optional[float], direction: Optional[float]) -> tuple[Optional[float], Optional[float]]:
    if speed is None or direction is None:
        return None, None
    try:
        import math

        rad = math.radians(float(direction))
        spd = float(speed)
        u = -spd * math.sin(rad)
        v = -spd * math.cos(rad)
        return u, v
    except Exception:
        return None, None


def _build_vertical_profile_signal(
    hourly_next_48h: Dict[str, list],
    local_date: str,
    local_hour: int,
    first_peak_h: int,
    last_peak_h: int,
) -> Dict[str, Any]:
    times = hourly_next_48h.get("times") or []
    if not times:
        return {}

    preferred_start = max(local_hour, max(0, first_peak_h - 2))
    preferred_end = min(23, last_peak_h + 1)
    candidate_indexes = [
        index
        for index, ts in enumerate(times)
        if str(ts).startswith(local_date)
        and preferred_start <= int(str(ts).split("T")[1][:2]) <= preferred_end
    ]
    if not candidate_indexes:
        candidate_indexes = [
            index
            for index, ts in enumerate(times)
            if str(ts).startswith(local_date)
        ]
    if not candidate_indexes:
        return {}

    def _series(name: str) -> list:
        values = hourly_next_48h.get(name) or []
        return [values[idx] if idx < len(values) else None for idx in candidate_indexes]

    def _max_numeric(values: list) -> Optional[float]:
        valid = [_sf(value) for value in values if _sf(value) is not None]
        return max(valid) if valid else None

    def _min_numeric(values: list) -> Optional[float]:
        valid = [_sf(value) for value in values if _sf(value) is not None]
        return min(valid) if valid else None

    def _level_label(level: str, locale: str) -> str:
        mapping = {
            "high": {"zh": "高", "en": "high"},
            "medium": {"zh": "中", "en": "medium"},
            "low": {"zh": "低", "en": "low"},
            "strong": {"zh": "强", "en": "strong"},
            "weak": {"zh": "弱", "en": "weak"},
        }
        return mapping.get(level, {}).get(locale, level)

    cape_max = _max_numeric(_series("cape"))
    cin_min = _min_numeric(_series("convective_inhibition"))
    lifted_index_min = _min_numeric(_series("lifted_index"))
    boundary_layer_height_max = _max_numeric(_series("boundary_layer_height"))

    shear_values: list[float] = []
    speed_10m = hourly_next_48h.get("wind_speed_10m") or []
    direction_10m = hourly_next_48h.get("wind_direction_10m") or []
    speed_180m = hourly_next_48h.get("wind_speed_180m") or []
    direction_180m = hourly_next_48h.get("wind_direction_180m") or []
    for idx in candidate_indexes:
        s10 = _sf(speed_10m[idx]) if idx < len(speed_10m) else None
        d10 = _sf(direction_10m[idx]) if idx < len(direction_10m) else None
        s180 = _sf(speed_180m[idx]) if idx < len(speed_180m) else None
        d180 = _sf(direction_180m[idx]) if idx < len(direction_180m) else None
        u10, v10 = _wind_components(s10, d10)
        u180, v180 = _wind_components(s180, d180)
        if None in (u10, v10, u180, v180):
            continue
        import math

        shear_values.append(math.sqrt((u180 - u10) ** 2 + (v180 - v10) ** 2))
    shear_10m_180m_max = max(shear_values) if shear_values else None

    suppression_risk = "low"
    if (cape_max is not None and cape_max >= 700) or (
        cin_min is not None and cin_min <= -50
    ):
        suppression_risk = "high"
    elif (cape_max is not None and cape_max >= 150) or (
        cin_min is not None and cin_min <= -15
    ):
        suppression_risk = "medium"

    trigger_risk = "low"
    if (
        cape_max is not None
        and cape_max >= 550
        and lifted_index_min is not None
        and lifted_index_min <= -1.5
    ):
        trigger_risk = "high"
    elif (
        cape_max is not None
        and cape_max >= 120
        and lifted_index_min is not None
        and lifted_index_min <= 0.5
    ):
        trigger_risk = "medium"

    mixing_strength = "weak"
    if boundary_layer_height_max is not None and boundary_layer_height_max >= 1400:
        mixing_strength = "strong"
    elif boundary_layer_height_max is not None and boundary_layer_height_max >= 700:
        mixing_strength = "medium"

    shear_risk = "low"
    if shear_10m_180m_max is not None and shear_10m_180m_max >= 8:
        shear_risk = "high"
    elif shear_10m_180m_max is not None and shear_10m_180m_max >= 4:
        shear_risk = "medium"

    heating_setup = "neutral"
    heating_score = 0
    if suppression_risk == "high":
        heating_score -= 2
    elif suppression_risk == "medium":
        heating_score -= 1
    if trigger_risk == "high":
        heating_score -= 2
    elif trigger_risk == "medium":
        heating_score -= 1
    if mixing_strength == "strong":
        heating_score += 2
    elif mixing_strength == "medium":
        heating_score += 1
    else:
        heating_score -= 1
    if shear_risk == "high":
        heating_score -= 1

    if heating_score >= 2:
        heating_setup = "supportive"
    elif heating_score <= -2:
        heating_setup = "suppressed"

    has_profile_data = any(
        value is not None
        for value in (
            cape_max,
            cin_min,
            lifted_index_min,
            boundary_layer_height_max,
            shear_10m_180m_max,
        )
    )

    zh_parts = []
    en_parts = []
    if suppression_risk == "high":
        zh_parts.append("午后对流压温风险偏高。")
        en_parts.append("Afternoon convective suppression risk is elevated.")
    elif suppression_risk == "medium":
        zh_parts.append("存在一定云雨压温风险。")
        en_parts.append("There is some cloud and shower suppression risk.")
    elif has_profile_data:
        zh_parts.append("高空对流压温风险暂时不高。")
        en_parts.append("Upper-air suppression risk remains limited for now.")
    if mixing_strength == "strong":
        zh_parts.append("边界层混合较深，若无云雨打断仍有冲高空间。")
        en_parts.append("Deep boundary-layer mixing still supports additional warming if convection stays limited.")
    elif mixing_strength == "medium":
        zh_parts.append("白天混合条件中等。")
        en_parts.append("Daytime mixing potential is moderate.")
    elif has_profile_data:
        zh_parts.append("边界层混合偏浅。")
        en_parts.append("Boundary-layer mixing remains shallow.")
    if shear_risk == "high":
        zh_parts.append("高空风切变较强，午后结构波动可能加大。")
        en_parts.append("Upper-level shear is relatively strong and may increase afternoon volatility.")
    elif shear_risk == "medium":
        zh_parts.append("高空风切变有一定存在感。")
        en_parts.append("Upper-level shear is noticeable.")
    elif has_profile_data:
        zh_parts.append("高空风切变扰动有限。")
        en_parts.append("Upper-level shear disruption remains limited.")
    if trigger_risk == "high":
        zh_parts.append("抬升触发条件较好，需警惕午后云团发展。")
        en_parts.append("Trigger conditions are favorable enough to watch for afternoon convective development.")
    elif trigger_risk == "medium":
        zh_parts.append("午后具备一定触发条件。")
        en_parts.append("There is some afternoon trigger potential.")
    elif has_profile_data:
        zh_parts.append("午后触发条件偏弱。")
        en_parts.append("Afternoon trigger potential remains weak.")
    if not has_profile_data:
        zh_parts.append("高空剖面字段暂缺，当前仅保留基础默认信号。")
        en_parts.append("Upper-air profile fields are currently unavailable, so only a fallback signal is shown.")
    elif not zh_parts:
        zh_parts.append("高空结构整体平稳，暂未看到明显压温信号。")
    if not en_parts:
        en_parts.append("The upper-air structure looks fairly stable, without a strong suppression signal yet.")

    if has_profile_data:
        summary_tokens_zh = []
        summary_tokens_en = []
        window_start = str(times[candidate_indexes[0]]).split("T")[1][:5]
        window_end = str(times[candidate_indexes[-1]]).split("T")[1][:5]
        zh_parts.append(f"判断窗口：{window_start}-{window_end}。")
        en_parts.append(f"Signal window: {window_start}-{window_end}.")
        if cape_max is not None:
            summary_tokens_zh.append(f"CAPE≈{round(cape_max)}")
            summary_tokens_en.append(f"CAPE≈{round(cape_max)}")
        if cin_min is not None:
            summary_tokens_zh.append(f"CIN≈{round(cin_min)}")
            summary_tokens_en.append(f"CIN≈{round(cin_min)}")
        if boundary_layer_height_max is not None:
            summary_tokens_zh.append(f"混合层≈{round(boundary_layer_height_max)}m")
            summary_tokens_en.append(f"mixing≈{round(boundary_layer_height_max)}m")
        if shear_10m_180m_max is not None:
            summary_tokens_zh.append(f"切变≈{shear_10m_180m_max:.1f}")
            summary_tokens_en.append(f"shear≈{shear_10m_180m_max:.1f}")
        zh_parts.append(
            f"压温{_level_label(suppression_risk, 'zh')}、触发{_level_label(trigger_risk, 'zh')}、混合{_level_label(mixing_strength, 'zh')}、切变{_level_label(shear_risk, 'zh')}。"
        )
        en_parts.append(
            f"Suppression { _level_label(suppression_risk, 'en') }, trigger { _level_label(trigger_risk, 'en') }, mixing { _level_label(mixing_strength, 'en') }, shear { _level_label(shear_risk, 'en') }."
        )
        if heating_setup == "supportive":
            zh_parts.append("整体更偏向支持白天冲高。")
            en_parts.append("Overall, the profile is more supportive of daytime heating.")
        elif heating_setup == "suppressed":
            zh_parts.append("整体更偏向抑制午后冲高。")
            en_parts.append("Overall, the profile leans more toward suppressing the afternoon peak.")
        else:
            zh_parts.append("整体更像中性环境，仍需结合地面信号。")
            en_parts.append("Overall, the profile looks fairly neutral and still needs surface confirmation.")
        if summary_tokens_zh:
            zh_parts.append(" / ".join(summary_tokens_zh) + "。")
        if summary_tokens_en:
            en_parts.append(" / ".join(summary_tokens_en) + ".")

    return {
        "source": "open-meteo-gfs",
        "window_start": times[candidate_indexes[0]] if candidate_indexes else None,
        "window_end": times[candidate_indexes[-1]] if candidate_indexes else None,
        "cape_max": cape_max,
        "cin_min": cin_min,
        "lifted_index_min": lifted_index_min,
        "boundary_layer_height_max": boundary_layer_height_max,
        "shear_10m_180m_max": shear_10m_180m_max,
        "suppression_risk": suppression_risk,
        "trigger_risk": trigger_risk,
        "mixing_strength": mixing_strength,
        "shear_risk": shear_risk,
        "heating_setup": heating_setup,
        "heating_score": heating_score,
        "summary_zh": "".join(zh_parts),
        "summary_en": " ".join(en_parts),
    }


def _build_taf_signal(
    taf_data: Dict[str, Any],
    city: str,
    local_date: str,
    utc_offset: int,
    first_peak_h: int,
    last_peak_h: int,
) -> Dict[str, Any]:
    if str(city or "").strip().lower() == "hong kong":
        return {}
    raw_taf = re.sub(r"\s+", " ", str((taf_data or {}).get("raw_taf") or "").upper().strip())
    if not raw_taf:
        return {}

    issue_raw = str((taf_data or {}).get("issue_time") or "").strip()
    issue_dt = None
    if issue_raw:
        try:
            issue_dt = datetime.fromisoformat(issue_raw.replace("Z", "+00:00"))
        except Exception:
            issue_dt = None
    if issue_dt is None:
        issue_dt = datetime.now(timezone.utc)

    local_tz = timezone(timedelta(seconds=int(utc_offset or 0)))
    valid_match = re.search(r"\b(\d{2})(\d{2})/(\d{2})(\d{2})\b", raw_taf)
    tokens = raw_taf.split()
    if not valid_match:
        return {}

    def _infer_utc(day: int, hour: int, minute: int = 0) -> datetime:
        base = issue_dt
        year = base.year
        month = base.month
        day_offset = 0
        normalized_hour = hour
        if normalized_hour >= 24:
            day_offset += normalized_hour // 24
            normalized_hour = normalized_hour % 24
        candidate = datetime(
            year,
            month,
            day,
            normalized_hour,
            minute,
            tzinfo=timezone.utc,
        )
        if day_offset:
            candidate += timedelta(days=day_offset)
        if candidate < base - timedelta(days=20):
            if month == 12:
                candidate = datetime(
                    year + 1,
                    1,
                    day,
                    normalized_hour,
                    minute,
                    tzinfo=timezone.utc,
                ) + timedelta(days=day_offset)
            else:
                candidate = datetime(
                    year,
                    month + 1,
                    day,
                    normalized_hour,
                    minute,
                    tzinfo=timezone.utc,
                ) + timedelta(days=day_offset)
        elif candidate > base + timedelta(days=20):
            if month == 1:
                candidate = datetime(
                    year - 1,
                    12,
                    day,
                    normalized_hour,
                    minute,
                    tzinfo=timezone.utc,
                ) + timedelta(days=day_offset)
            else:
                candidate = datetime(
                    year,
                    month - 1,
                    day,
                    normalized_hour,
                    minute,
                    tzinfo=timezone.utc,
                ) + timedelta(days=day_offset)
        return candidate

    def _parse_period(token: str) -> tuple[Optional[datetime], Optional[datetime]]:
        match = re.match(r"^(\d{2})(\d{2})/(\d{2})(\d{2})$", token)
        if not match:
            return None, None
        start = _infer_utc(int(match.group(1)), int(match.group(2)))
        end = _infer_utc(int(match.group(3)), int(match.group(4)))
        if end <= start:
            end += timedelta(days=1)
        return start, end

    valid_start_utc, valid_end_utc = _parse_period(valid_match.group(0))
    if valid_start_utc is None or valid_end_utc is None:
        return {}

    segment_indexes: list[int] = []
    for idx, token in enumerate(tokens):
        if re.match(r"^FM\d{6}$", token) or token in {"TEMPO", "BECMG", "PROB30", "PROB40"}:
            segment_indexes.append(idx)

    base_start_idx = 0
    for idx, token in enumerate(tokens):
        if token == valid_match.group(0):
            base_start_idx = idx + 1
            break

    segments: list[Dict[str, Any]] = []
    first_segment_idx = segment_indexes[0] if segment_indexes else len(tokens)
    if base_start_idx < first_segment_idx:
        segments.append(
            {
                "type": "BASE",
                "start_utc": valid_start_utc,
                "end_utc": valid_end_utc,
                "tokens": tokens[base_start_idx:first_segment_idx],
            }
        )

    idx_pos = 0
    while idx_pos < len(segment_indexes):
        start_idx = segment_indexes[idx_pos]
        end_idx = segment_indexes[idx_pos + 1] if idx_pos + 1 < len(segment_indexes) else len(tokens)
        token = tokens[start_idx]
        seg_type = token
        seg_start = valid_start_utc
        seg_end = valid_end_utc
        payload_start = start_idx + 1

        if re.match(r"^FM(\d{2})(\d{2})(\d{2})$", token):
            match = re.match(r"^FM(\d{2})(\d{2})(\d{2})$", token)
            seg_type = "FM"
            seg_start = _infer_utc(int(match.group(1)), int(match.group(2)), int(match.group(3)))
            if idx_pos + 1 < len(segment_indexes):
                next_token = tokens[segment_indexes[idx_pos + 1]]
                next_match = re.match(r"^FM(\d{2})(\d{2})(\d{2})$", next_token)
                if next_match:
                    seg_end = _infer_utc(int(next_match.group(1)), int(next_match.group(2)), int(next_match.group(3)))
                else:
                    seg_end = valid_end_utc
            else:
                seg_end = valid_end_utc
        elif token in {"TEMPO", "BECMG"}:
            seg_type = token
            if payload_start < len(tokens):
                seg_start, seg_end = _parse_period(tokens[payload_start])
                payload_start += 1
        elif token in {"PROB30", "PROB40"}:
            seg_type = token
            if payload_start < len(tokens) and tokens[payload_start] == "TEMPO":
                seg_type = f"{token} TEMPO"
                payload_start += 1
            if payload_start < len(tokens):
                seg_start, seg_end = _parse_period(tokens[payload_start])
                payload_start += 1

        if seg_start is None or seg_end is None:
            idx_pos += 1
            continue
        if seg_end <= seg_start:
            seg_end = seg_start + timedelta(hours=1)

        segments.append(
            {
                "type": seg_type,
                "start_utc": seg_start,
                "end_utc": seg_end,
                "tokens": tokens[payload_start:end_idx],
            }
        )
        idx_pos += 1

    peak_window_start = datetime.strptime(f"{local_date} {max(0, first_peak_h - 2):02d}:00", "%Y-%m-%d %H:%M").replace(tzinfo=local_tz)
    peak_window_end = datetime.strptime(f"{local_date} {min(23, last_peak_h + 1):02d}:00", "%Y-%m-%d %H:%M").replace(tzinfo=local_tz)

    precip_rank = {"low": 0, "medium": 1, "high": 2}
    suppression_level = "low"
    disruption_level = "low"
    low_ceiling_ft = None
    ceiling_cover = None
    wind_regimes: list[str] = []
    markers: list[Dict[str, Any]] = []
    active_segments: list[Dict[str, Any]] = []

    def _segment_precip_level(tokens_block: list[str]) -> str:
        joined = " ".join(tokens_block)
        if re.search(r"\b(?:-|\+)?(?:TSRA|TS|VCTS|SHRA|SHSN|SHGS)\b", joined):
            return "high"
        if re.search(r"\b(?:-|\+)?(?:RA|DZ|SN)\b", joined):
            return "medium"
        return "low"

    for segment in segments:
        start_local = segment["start_utc"].astimezone(local_tz)
        end_local = segment["end_utc"].astimezone(local_tz)
        overlap_start = max(start_local, peak_window_start)
        overlap_end = min(end_local, peak_window_end)
        if overlap_end <= overlap_start:
            continue
        active_segments.append(segment)
        joined = " ".join(segment["tokens"])
        level = _segment_precip_level(segment["tokens"])
        if precip_rank[level] > precip_rank[suppression_level]:
            suppression_level = level

        cloud_matches = re.findall(r"\b(FEW|SCT|BKN|OVC)(\d{3})\b", joined)
        for cover, base in cloud_matches:
            if cover not in {"BKN", "OVC"}:
                continue
            try:
                base_ft = int(base) * 100
            except Exception:
                continue
            if low_ceiling_ft is None or base_ft < low_ceiling_ft:
                low_ceiling_ft = base_ft
                ceiling_cover = cover
        if low_ceiling_ft is not None and low_ceiling_ft <= 4000 and suppression_level == "low":
            suppression_level = "medium"

        wind_matches = re.findall(r"\b(\d{3}|VRB)(\d{2,3})(?:G\d{2,3})?KT\b", joined)
        segment_regimes = []
        for direction, _speed in wind_matches:
            if direction == "VRB":
                segment_regimes.append("variable")
                continue
            deg = int(direction)
            if 135 <= deg <= 225:
                segment_regimes.append("southerly")
            elif deg >= 315 or deg <= 45:
                segment_regimes.append("northerly")
            else:
                segment_regimes.append("cross")
        for item in segment_regimes:
            if item not in wind_regimes:
                wind_regimes.append(item)

        if segment["type"] in {"TEMPO", "BECMG", "PROB30", "PROB40", "PROB30 TEMPO", "PROB40 TEMPO"}:
            disruption_level = "medium" if disruption_level == "low" else disruption_level
        if segment["type"] in {"PROB30 TEMPO", "PROB40 TEMPO"} or level == "high":
            disruption_level = "high"

        marker_time_local = overlap_start
        marker_hour = marker_time_local.strftime("%H:00")
        hazards = []
        if level != "low":
            hazards.append(level)
        if low_ceiling_ft is not None and segment_regimes is not None:
            hazards.append("cloud")
        if segment_regimes:
            hazards.append("wind")
        summary_zh = (
            f"{segment['type']} {overlap_start.strftime('%H:%M')}-{overlap_end.strftime('%H:%M')} "
            f"{'有阵雨/雷暴扰动' if level == 'high' else '有云雨扰动' if level == 'medium' else '以稳定为主'}"
        )
        summary_en = (
            f"{segment['type']} {overlap_start.strftime('%H:%M')}-{overlap_end.strftime('%H:%M')} "
            f"{'shows shower/thunder disruption' if level == 'high' else 'shows cloud/rain disruption' if level == 'medium' else 'stays relatively stable'}"
        )
        markers.append(
            {
                "label_time": marker_hour,
                "marker_type": segment["type"],
                "start_local": overlap_start.strftime("%H:%M"),
                "end_local": overlap_end.strftime("%H:%M"),
                "suppression_level": level,
                "summary_zh": summary_zh,
                "summary_en": summary_en,
            }
        )

    wind_shift = len(wind_regimes) >= 2 or "variable" in wind_regimes
    peak_window = f"{peak_window_start.strftime('%H:%M')}-{peak_window_end.strftime('%H:%M')}"

    if suppression_level == "high":
        summary_zh = f"TAF 在峰值窗口（{peak_window}）提示阵雨或雷暴扰动，机场最高温可能被云雨压低。"
        summary_en = f"TAF flags shower or thunderstorm disruption around the peak window ({peak_window}), airport high may get capped by showers/storms."
    elif suppression_level == "medium":
        summary_zh = f"TAF 在峰值窗口（{peak_window}）提示云量或弱降水扰动，需要防峰值被压低。"
        summary_en = f"TAF points to cloud or light-precip disruption around the peak window ({peak_window}); the airport high may be capped."
    else:
        summary_zh = f"TAF 在峰值窗口（{peak_window}）暂未提示明显云雨压温。"
        summary_en = f"TAF does not flag a strong cloud/rain suppression signal around the peak window ({peak_window})."
    if wind_shift:
        summary_zh += " 同时机场预报风向存在阶段性切换。"
        summary_en += " Airport wind direction also shifts by regime during the window."

    return {
        "available": True,
        "source": "aviationweather-taf",
        "raw_taf": raw_taf,
        "issue_time": (taf_data or {}).get("issue_time"),
        "valid_time_from": (taf_data or {}).get("valid_time_from"),
        "valid_time_to": (taf_data or {}).get("valid_time_to"),
        "peak_window": peak_window,
        "segments": [
            {
                "type": seg["type"],
                "start_local": seg["start_utc"].astimezone(local_tz).strftime("%H:%M"),
                "end_local": seg["end_utc"].astimezone(local_tz).strftime("%H:%M"),
                "tokens": seg["tokens"],
            }
            for seg in active_segments
        ],
        "markers": markers,
        "low_ceiling_ft": low_ceiling_ft,
        "ceiling_cover": ceiling_cover,
        "wind_regimes": wind_regimes,
        "wind_shift": wind_shift,
        "suppression_level": suppression_level,
        "disruption_level": disruption_level,
        "summary_zh": summary_zh,
        "summary_en": summary_en,
    }


def _clock_minutes(value: Any) -> Optional[int]:
    text = str(value or "").strip()
    match = re.search(r"\b(\d{1,2}):(\d{2})\b", text)
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2))
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        return None
    return hour * 60 + minute


def _format_clock_minutes(value: int) -> str:
    value = max(0, min(23 * 60 + 59, int(value)))
    return f"{value // 60:02d}:{value % 60:02d}"


def _next_observation_clock(local_time: Any) -> str:
    minutes = _clock_minutes(local_time)
    if minutes is None:
        return "--"
    next_slot = ((minutes // 30) + 1) * 30
    if next_slot > 23 * 60 + 59:
        return "23:59"
    return _format_clock_minutes(next_slot)


def _bucket_label_from_value(value: Optional[float], unit: str) -> Optional[str]:
    if value is None:
        return None
    try:
        return f"{int(round(float(value)))}{unit or '°C'}"
    except Exception:
        return None


def _top_probability_bucket(distribution: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(distribution, list):
        return None
    candidates = [row for row in distribution if isinstance(row, dict)]
    if not candidates:
        return None
    return max(candidates, key=lambda row: _sf(row.get("probability")) or -1.0)


def _bucket_label(row: Optional[Dict[str, Any]], unit: str) -> Optional[str]:
    if not isinstance(row, dict):
        return None
    for key in ("label", "bucket", "range"):
        raw = str(row.get(key) or "").strip()
        if raw:
            return raw
    return _bucket_label_from_value(_sf(row.get("value")), unit)


def _add_signal(
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


def _build_intraday_meteorology(data: Dict[str, Any]) -> Dict[str, Any]:
    """Build a paid-product intraday meteorology read from existing layers."""
    current = data.get("current") or {}
    probabilities = data.get("probabilities") or {}
    distribution = probabilities.get("distribution") or []
    top_bucket = _top_probability_bucket(distribution)
    unit = str(data.get("temp_symbol") or "°C")
    deb = data.get("deb") or {}
    peak = data.get("peak") or {}
    deviation = data.get("deviation_monitor") or {}
    taf_signal = (
        ((data.get("taf") or {}).get("signal") or {})
        if isinstance(data.get("taf"), dict)
        else {}
    )
    vertical = data.get("vertical_profile_signal") or {}

    current_temp = _sf(current.get("temp"))
    max_so_far = _sf(current.get("max_so_far"))
    deb_prediction = _sf(deb.get("prediction"))
    base_value = _sf(top_bucket.get("value")) if isinstance(top_bucket, dict) else None
    if base_value is None:
        base_value = deb_prediction
    if base_value is None:
        base_value = max_so_far if max_so_far is not None else current_temp

    base_case_bucket = _bucket_label(top_bucket, unit) or _bucket_label_from_value(base_value, unit)
    upside_bucket = _bucket_label_from_value(base_value + 1.0, unit) if base_value is not None else None
    downside_bucket = _bucket_label_from_value(base_value - 1.0, unit) if base_value is not None else None

    signals: list = []
    support_score = 0
    suppress_score = 0
    available_layers = 0

    direction = str(deviation.get("direction") or "").lower()
    severity = str(deviation.get("severity") or "normal").lower()
    delta = _sf(deviation.get("current_delta"))
    if direction:
        available_layers += 1
        strength = "strong" if severity == "strong" else ("medium" if severity == "light" else "weak")
        if direction == "hot":
            support_score += 2 if strength == "strong" else 1
            _add_signal(
                signals,
                label="日内节奏",
                label_en="Intraday pace",
                direction="support",
                strength=strength,
                summary=f"实测较预期路径偏高 {abs(delta or 0):.1f}{unit}，峰值仍有上修空间。",
                summary_en=f"Observed temperature is running {abs(delta or 0):.1f}{unit} above the expected path; the peak still has upside room.",
            )
        elif direction == "cold":
            suppress_score += 2 if strength == "strong" else 1
            _add_signal(
                signals,
                label="日内节奏",
                label_en="Intraday pace",
                direction="suppress",
                strength=strength,
                summary=f"实测较预期路径偏低 {abs(delta or 0):.1f}{unit}，追更高温档需要等待后续观测确认。",
                summary_en=f"Observed temperature is running {abs(delta or 0):.1f}{unit} below the expected path; higher buckets need confirmation from later observations.",
            )
        else:
            _add_signal(
                signals,
                label="日内节奏",
                label_en="Intraday pace",
                direction="neutral",
                strength="weak",
                summary="实测大体贴近当前预期路径，下一步主要看峰值窗口内是否继续抬升。",
                summary_en="Observed temperature is broadly tracking the expected path; the next question is whether it keeps lifting through the peak window.",
            )

    heating_setup = str(vertical.get("heating_setup") or "").lower()
    suppression_risk = str(vertical.get("suppression_risk") or "").lower()
    if heating_setup or suppression_risk:
        available_layers += 1
        if heating_setup == "supportive":
            support_score += 2
            _add_signal(
                signals,
                label="边界层结构",
                label_en="Boundary-layer setup",
                direction="support",
                strength="strong",
                summary=str(vertical.get("summary_zh") or "边界层结构支持白天继续混合升温。"),
                summary_en=str(vertical.get("summary_en") or "The boundary-layer setup supports continued daytime mixing and warming."),
            )
        elif heating_setup == "suppressed" or suppression_risk == "high":
            suppress_score += 2
            _add_signal(
                signals,
                label="边界层结构",
                label_en="Boundary-layer setup",
                direction="suppress",
                strength="strong",
                summary=str(vertical.get("summary_zh") or "边界层或云雨结构对午后峰值形成压制。"),
                summary_en=str(vertical.get("summary_en") or "Boundary-layer or cloud/rain structure is capping the afternoon peak."),
            )
        else:
            _add_signal(
                signals,
                label="边界层结构",
                label_en="Boundary-layer setup",
                direction="neutral",
                strength="medium",
                summary=str(vertical.get("summary_zh") or "边界层结构暂未给出单边信号。"),
                summary_en=str(vertical.get("summary_en") or "The boundary-layer setup does not yet provide a one-sided signal."),
            )

    taf_suppression = str(taf_signal.get("suppression_level") or "").lower()
    taf_disruption = str(taf_signal.get("disruption_level") or "").lower()
    if taf_signal.get("available") or taf_suppression:
        available_layers += 1
        if taf_suppression == "high" or taf_disruption == "high":
            suppress_score += 2
            direction_value = "suppress"
            strength = "strong"
        elif taf_suppression == "medium" or taf_disruption == "medium":
            suppress_score += 1
            direction_value = "suppress"
            strength = "medium"
        else:
            support_score += 1
            direction_value = "support"
            strength = "weak"
        _add_signal(
            signals,
            label="TAF 云雨扰动",
            label_en="TAF cloud/rain disruption",
            direction=direction_value,
            strength=strength,
            summary=str(taf_signal.get("summary_zh") or "TAF 暂未提示强云雨压温信号。"),
            summary_en=str(taf_signal.get("summary_en") or "TAF does not yet flag a strong cloud/rain temperature cap."),
        )

    airport_delta = _sf(data.get("airport_vs_network_delta"))
    lead_signal = data.get("network_lead_signal") or {}
    if airport_delta is not None:
        available_layers += 1
        leader = str(lead_signal.get("leader_station_label") or lead_signal.get("leader_station_code") or "").strip()
        if airport_delta <= -0.4:
            support_score += 1
            _add_signal(
                signals,
                label="站网对比",
                label_en="Station-network comparison",
                direction="support",
                strength="medium",
                summary=f"周边站网较机场锚点偏热 {abs(airport_delta):.1f}{unit}{f'，领先点位 {leader}' if leader else ''}。",
                summary_en=f"Nearby stations are {abs(airport_delta):.1f}{unit} warmer than the airport anchor{f'; leading site: {leader}' if leader else ''}.",
            )
        elif airport_delta >= 0.4:
            suppress_score += 1
            _add_signal(
                signals,
                label="站网对比",
                label_en="Station-network comparison",
                direction="suppress",
                strength="medium",
                summary=f"机场锚点较周边站网偏热 {abs(airport_delta):.1f}{unit}，继续上修需要机场自身后续报文确认。",
                summary_en=f"The airport anchor is {abs(airport_delta):.1f}{unit} warmer than nearby stations; further upside needs confirmation from later airport reports.",
            )
        else:
            _add_signal(
                signals,
                label="站网对比",
                label_en="Station-network comparison",
                direction="neutral",
                strength="weak",
                summary="机场锚点与周边站网基本同步，暂不构成单独上修或下修理由。",
                summary_en="The airport anchor and nearby station network are broadly aligned, so this layer does not independently argue for upside or downside.",
            )

    peak_status = str(peak.get("status") or "").lower()
    first_h = _sf(peak.get("first_h"))
    last_h = _sf(peak.get("last_h"))
    peak_window = (
        f"{int(first_h):02d}:00-{int(last_h):02d}:59"
        if first_h is not None and last_h is not None
        else "--"
    )
    if peak_status == "past":
        headline = "峰值窗口已过，后续更偏向确认最终高点而非继续上修。"
        headline_en = "The peak window has passed; the read now shifts toward confirming the final high rather than chasing further upside."
        confidence = "high" if available_layers >= 2 else "medium"
    elif suppress_score >= support_score + 2:
        headline = "峰值存在云雨或结构压制，当前更偏防守高温上修。"
        headline_en = "Cloud/rain or structural suppression is capping the peak; defend against aggressive high-temperature upside for now."
        confidence = "high" if available_layers >= 3 else "medium"
    elif support_score >= suppress_score + 2:
        headline = "峰值仍有上修空间，后续重点看峰值窗口内报文能否继续抬升。"
        headline_en = "The peak still has upside room; the next check is whether reports keep lifting through the peak window."
        confidence = "high" if available_layers >= 3 else "medium"
    elif available_layers == 0:
        headline = "关键日内层仍在补齐，先以观测锚点和下一次报文为主。"
        headline_en = "Key intraday layers are still filling in; anchor the read on observations and the next report."
        confidence = "low"
    else:
        headline = "当前处于分歧判断区，峰值窗口内的下一组观测将决定方向。"
        headline_en = "The setup is in a split-decision zone; the next observations inside the peak window should decide direction."
        confidence = "medium" if available_layers >= 2 else "low"

    next_observation = _next_observation_clock(data.get("local_time") or current.get("obs_time"))
    threshold = base_value
    invalidation_rules = []
    invalidation_rules_en = []
    confirmation_rules = []
    confirmation_rules_en = []
    if peak_status == "past":
        invalidation_rules.append("若后续官方结算源补录更高值，以结算源最终高点为准。")
        invalidation_rules_en.append("If the official settlement source later backfills a higher reading, defer to the final settlement-source high.")
        confirmation_rules.append("若峰值窗口后连续两次观测不再创新高，当前高点基本确认。")
        confirmation_rules_en.append("If two consecutive post-peak observations fail to make a new high, the current high is broadly confirmed.")
    else:
        watch_clock = _format_clock_minutes(int(first_h or 13) * 60 + 30)
        if threshold is not None:
            invalidation_rules.append(f"{watch_clock} 前若仍未接近 {threshold:.0f}{unit}，上修路径降级。")
            invalidation_rules_en.append(f"If observations are still not near {threshold:.0f}{unit} before {watch_clock}, downgrade the upside path.")
            confirmation_rules.append(f"峰值窗口内任一结算源观测触达或超过 {threshold:.0f}{unit}，基准路径确认度上升。")
            confirmation_rules_en.append(f"If any settlement-source observation reaches or exceeds {threshold:.0f}{unit} inside the peak window, confidence in the base path rises.")
        invalidation_rules.append("若 TAF 或实况报文出现阵雨、雷暴或低云/云雨压制，高温上沿需要下调。")
        invalidation_rules_en.append("If TAF or live reports show showers, thunderstorms, or low-cloud/cloud-rain suppression, lower the upper temperature bound.")
        confirmation_rules.append("若实测继续贴近 DEB 曲线且云雨信号不增强，维持当前主路径。")
        confirmation_rules_en.append("If observations keep tracking the DEB curve and cloud/rain signals do not strengthen, maintain the current main path.")

    if not signals:
        _add_signal(
            signals,
            label="数据完整性",
            label_en="Data completeness",
            direction="neutral",
            strength="weak",
            summary="当前缺少足够的日内结构层，等待下一次观测刷新后再提高判断权重。",
            summary_en="There are not enough intraday structure layers yet; wait for the next observation refresh before raising confidence.",
        )

    return {
        "headline": headline,
        "headline_en": headline_en,
        "confidence": confidence,
        "base_case_bucket": base_case_bucket,
        "upside_bucket": upside_bucket,
        "downside_bucket": downside_bucket,
        "next_observation_time": next_observation,
        "peak_window": peak_window,
        "invalidation_rules": invalidation_rules[:4],
        "invalidation_rules_en": invalidation_rules_en[:4],
        "confirmation_rules": confirmation_rules[:3],
        "confirmation_rules_en": confirmation_rules_en[:3],
        "signal_contributions": signals[:5],
    }


def _analyze(
    city: str,
    force_refresh: bool = False,
    include_llm_commentary: bool = False,
    detail_mode: str = "full",
) -> Dict[str, Any]:
    """Fetch, analyse, and return structured weather data for one city."""
    # Check cache
    ttl = CACHE_TTL_ANKARA if city.lower() in TURKISH_MGM_CITIES else CACHE_TTL
    normalized_detail_mode_raw = str(detail_mode or "full").strip().lower()
    if normalized_detail_mode_raw == "panel":
        normalized_detail_mode = "panel"
    elif normalized_detail_mode_raw == "market":
        normalized_detail_mode = "market"
    elif normalized_detail_mode_raw == "nearby":
        normalized_detail_mode = "nearby"
    else:
        normalized_detail_mode = "full"
    cache_key = _analysis_cache_key(city, normalized_detail_mode)
    
    if not force_refresh:
        cached = _cache.get(cache_key)
        if cached and _time.time() - cached["t"] < ttl:
            if include_llm_commentary:
                cached_payload = cached["d"]
                dynamic = cached_payload.get("dynamic_commentary") or {}
                if not dynamic.get("headline_zh"):
                    cached_payload["dynamic_commentary"] = _maybe_enrich_dynamic_commentary_with_groq(
                        city,
                        cached_payload,
                    )
            _record_analysis_cache_event(city=city, hit=True, force_refresh=False)
            return cached["d"]
    _record_analysis_cache_event(city=city, hit=False, force_refresh=force_refresh)

    info = CITIES[city]
    lat, lon, is_f = info["lat"], info["lon"], info["f"]
    sym = "°F" if is_f else "°C"
    settlement_source = str(info.get("settlement_source") or "metar").strip().lower() or "metar"
    settlement_source_label = SETTLEMENT_SOURCE_LABELS.get(
        settlement_source,
        settlement_source.upper(),
    )

    # ── 1. Fetch raw data ──
    is_panel_mode = normalized_detail_mode == "panel"
    is_market_mode = normalized_detail_mode == "market"
    is_nearby_mode = normalized_detail_mode == "nearby"

    raw = _weather.fetch_all_sources(
        city,
        lat=lat,
        lon=lon,
        force_refresh=force_refresh,
        include_taf=not is_panel_mode and not is_nearby_mode and not is_market_mode,
        include_nearby=not is_panel_mode and not is_market_mode,
        include_ensemble=not is_panel_mode and not is_nearby_mode and not is_market_mode,
        include_multi_model=not is_panel_mode and not is_nearby_mode,
        include_mgm=not is_market_mode,
    )
    om = raw.get("open-meteo", {})
    metar = raw.get("metar", {})
    taf = raw.get("taf", {})
    mgm = raw.get("mgm") or {}
    settlement_current = raw.get("settlement_current") or {}
    ens_raw = raw.get("ensemble", {})
    mm = raw.get("multi_model", {})
    if not isinstance(om, dict):
        om = {}
    if not isinstance(metar, dict):
        metar = {}
    if not isinstance(mgm, dict):
        mgm = {}
    if not isinstance(settlement_current, dict):
        settlement_current = {}
    if not isinstance(ens_raw, dict):
        ens_raw = {}
    if not isinstance(mm, dict):
        mm = {}
    risk = CITY_RISK_PROFILES.get(city, {})
    network_snapshot = (
        build_country_network_snapshot(city, raw)
        if not is_panel_mode and not is_market_mode
        else {}
    )

    # ── 2. Current conditions (city-specific settlement source first, then METAR/MGM fallback) ──
    mc = metar.get("current", {}) if metar else {}
    mg_cur = mgm.get("current", {}) if mgm else {}
    sc_cur = settlement_current.get("current", {}) if settlement_current else {}
    use_settlement_current = settlement_source in {"hko", "cwa", "noaa", "wunderground"} and bool(sc_cur)
    primary_current = sc_cur if use_settlement_current else mc
    current_source = settlement_source
    current_source_label = settlement_source_label
    current_station_code = settlement_current.get("station_code")
    current_station_name = settlement_current.get("station_name")
    cur_temp = _sf(primary_current.get("temp"))
    if cur_temp is not None and not _is_plausible_city_temp(city, cur_temp, sym):
        cur_temp = None
    if cur_temp is None:
        cur_temp = _sf(mc.get("temp"))
        if cur_temp is not None and not _is_plausible_city_temp(city, cur_temp, sym):
            cur_temp = None
    if cur_temp is None:
        cur_temp = _sf(mg_cur.get("temp"))
        if cur_temp is not None and not _is_plausible_city_temp(city, cur_temp, sym):
            cur_temp = None
    if cur_temp is None:
        nmc_fallback = _fetch_nmc_current_fallback(city, use_fahrenheit=is_f)
        nmc_cur = nmc_fallback.get("current") or {}
        nmc_temp = _sf(nmc_cur.get("temp"))
        if nmc_temp is not None:
            cur_temp = nmc_temp
            current_source = "nmc"
            current_source_label = "NMC"
            current_station_code = nmc_fallback.get("station_code")
            current_station_name = nmc_fallback.get("station_name")

    max_so_far = _sf(primary_current.get("max_temp_so_far"))
    if max_so_far is not None and not _is_plausible_city_temp(city, max_so_far, sym):
        max_so_far = None
    if max_so_far is None:
        max_so_far = _sf(mc.get("max_temp_so_far"))
        if max_so_far is not None and not _is_plausible_city_temp(city, max_so_far, sym):
            max_so_far = None
    if max_so_far is None:
        max_so_far = _sf(mg_cur.get("mgm_max_temp"))
        if max_so_far is not None and not _is_plausible_city_temp(city, max_so_far, sym):
            max_so_far = None
    if max_so_far is None:
        max_so_far = cur_temp

    max_temp_time = primary_current.get("max_temp_time")
    if not max_temp_time and not use_settlement_current:
        max_temp_time = mc.get("max_temp_time")
    if not max_temp_time:
        max_temp_time = mg_cur.get("time", "")
        if " " in max_temp_time:
            max_temp_time = max_temp_time.split(" ")[1][:5]
    if max_temp_time == "":
        max_temp_time = None

    raw_settlement_max = max_so_far
    wu_settle = apply_city_settlement(city.lower(), raw_settlement_max) if raw_settlement_max is not None else None
    display_settlement_max = wu_settle if settlement_source == "wunderground" and wu_settle is not None else raw_settlement_max

    # Observation time → local
    obs_time_str = ""
    metar_age_min = None
    obs_t = ""
    if use_settlement_current:
        obs_t = str(settlement_current.get("observation_time") or "").strip()
    if not obs_t:
        obs_t = metar.get("observation_time", "") if metar else ""
    # 优先从 API 获取偏移；若缺失则尝试 NWS 动态偏移；最后回退静态配置
    utc_offset = om.get("utc_offset")
    if utc_offset is None:
        try:
            nws_periods = (raw.get("nws", {}) or {}).get("forecast_periods", []) or []
            if nws_periods:
                first_start = nws_periods[0].get("start_time")
                if first_start:
                    maybe_dt = datetime.fromisoformat(str(first_start))
                    if maybe_dt.utcoffset() is not None:
                        utc_offset = int(maybe_dt.utcoffset().total_seconds())
        except Exception:
            utc_offset = None
    if utc_offset is None:
        utc_offset = info.get("tz", 0)
    if obs_t and "T" in obs_t:
        try:
            dt = datetime.fromisoformat(str(obs_t).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            local_dt = dt.astimezone(timezone(timedelta(seconds=utc_offset)))
            obs_time_str = local_dt.strftime("%H:%M")
            metar_age_min = int(
                (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds() / 60
            )
        except Exception:
            obs_time_str = str(obs_t)[:16]
    if not obs_time_str and current_source == "nmc":
        nmc_fallback = _fetch_nmc_current_fallback(city, use_fahrenheit=is_f)
        obs_time_str = _format_observation_time_local(
            nmc_fallback.get("publish_time") or nmc_fallback.get("timestamp"),
            int(utc_offset or 0),
        )

    airport_primary_current = dict(network_snapshot.get("airport_primary_current") or {})
    if (
        airport_primary_current.get("source_code") == "metar"
        and obs_time_str
        and not use_settlement_current
    ):
        airport_primary_current["obs_time"] = obs_time_str
        airport_primary_current["obs_age_min"] = metar_age_min

    settlement_today_obs = []
    if use_settlement_current:
        explicit_settlement_obs = settlement_current.get("today_obs") or []
        normalized_obs = []
        for item in explicit_settlement_obs:
            if isinstance(item, dict):
                raw_time = str(item.get("time") or "").strip()
                raw_temp = _sf(item.get("temp"))
            elif isinstance(item, (list, tuple)) and len(item) >= 2:
                raw_time = str(item[0] or "").strip()
                raw_temp = _sf(item[1])
            else:
                continue
            if not raw_time or raw_temp is None:
                continue
            normalized_obs.append({"time": raw_time, "temp": raw_temp})
        if normalized_obs:
            settlement_today_obs = normalized_obs
        else:
            if obs_time_str and cur_temp is not None:
                settlement_today_obs.append({"time": obs_time_str, "temp": cur_temp})
            if (
                max_temp_time
                and max_so_far is not None
                and str(max_temp_time) != str(obs_time_str)
            ):
                settlement_today_obs.append({"time": str(max_temp_time), "temp": max_so_far})

    metar_today_obs_payload = [
        {"time": t, "temp": v}
        for t, v in (metar.get("today_obs", []) if metar else [])
        if _is_plausible_city_temp(city, v, sym)
    ]
    metar_recent_obs_payload = [
        point
        for point in (metar.get("recent_obs", []) if metar else [])
        if isinstance(point, dict)
        and _is_plausible_city_temp(city, point.get("temp"), sym)
    ]
    airport_max_so_far = None
    airport_max_temp_time = None
    for point in metar_today_obs_payload:
        value = _sf(point.get("temp")) if isinstance(point, dict) else None
        if value is None:
            continue
        if airport_max_so_far is None or value >= airport_max_so_far:
            airport_max_so_far = value
            airport_max_temp_time = str(point.get("time") or "") or None

    # ── 3. Local time parsing ──
    local_time_full = om.get("current", {}).get("local_time", "")
    local_hour, local_minute = 12, 0
    now_utc = datetime.now(timezone.utc)
    local_now = now_utc + timedelta(seconds=utc_offset)
    local_date_str = local_now.strftime("%Y-%m-%d")
    
    try:
        if local_time_full:
            local_date_str = local_time_full.split(" ")[0]
            tp = local_time_full.split(" ")[1].split(":")
            local_hour = int(tp[0])
            local_minute = int(tp[1]) if len(tp) > 1 else 0
        else:
            local_hour = local_now.hour
            local_minute = local_now.minute
    except Exception:
        local_hour = local_now.hour
        local_minute = local_now.minute
    local_time_str = f"{local_hour:02d}:{local_minute:02d}"
    local_hour_frac = local_hour + local_minute / 60

    # ── 4. Daily forecast ──
    daily = om.get("daily", {})
    dates = daily.get("time", [])[:5]
    maxtemps = daily.get("temperature_2m_max", [])[:5]
    sunrises = daily.get("sunrise", [])
    sunsets = daily.get("sunset", [])
    sunshine = daily.get("sunshine_duration", [])
    om_today = _sf(maxtemps[0]) if maxtemps else None

    forecast_daily = [{"date": d, "max_temp": t} for d, t in zip(dates, maxtemps)]
    if om_today is None:
        nws_high = _sf(raw.get("nws", {}).get("today_high"))
        mgm_high = _sf(mgm.get("today_high")) if mgm else None
        fallback_high = (
            nws_high
            if nws_high is not None
            else mgm_high
            if mgm_high is not None
            else max_so_far
            if max_so_far is not None
            else cur_temp
        )
        if fallback_high is not None:
            om_today = float(fallback_high)
            if not forecast_daily:
                forecast_daily = [{"date": local_date_str, "max_temp": om_today}]
    sunrise = (
        sunrises[0].split("T")[1][:5]
        if sunrises and "T" in str(sunrises[0])
        else ""
    )
    sunset = (
        sunsets[0].split("T")[1][:5]
        if sunsets and "T" in str(sunsets[0])
        else ""
    )
    sunshine_h = round(sunshine[0] / 3600, 1) if sunshine else 0

    # ── 5. Multi-model forecasts ──
    current_forecasts: Dict[str, float] = {}
    if om_today is not None:
        current_forecasts["Open-Meteo"] = om_today
    for m, v in mm.get("forecasts", {}).items():
        if v is not None and not _is_excluded_model_name(m):
            current_forecasts[m] = _sf(v)
    nws_high = _sf(raw.get("nws", {}).get("today_high"))
    if nws_high is not None:
        current_forecasts["NWS"] = nws_high
    mgm_high = _sf(mgm.get("today_high")) if mgm else None
    if mgm_high is not None:
        current_forecasts["MGM"] = mgm_high

    # ── 6. DEB fusion ──
    deb_val, deb_weights = None, ""
    if current_forecasts:
        blended, winfo = calculate_dynamic_weights(city, current_forecasts)
        if blended is not None:
            deb_val = blended
            deb_weights = winfo

    # ── 7. Ensemble stats ──
    ens_data = {
        "median": _sf(ens_raw.get("median")),
        "p10": _sf(ens_raw.get("p10")),
        "p90": _sf(ens_raw.get("p90")),
    }

    # ── 8. METAR trend ──
    recent_temps = metar.get("recent_temps", []) if metar else []
    trend_info = {
        "direction": "unknown",
        "recent": [{"time": t, "temp": v} for t, v in recent_temps[:6]],
        "is_cooling": False,
        "is_dead_market": False,
    }
    if len(recent_temps) >= 2:
        t_only = [t for _, t in recent_temps]
        latest, prev = t_only[0], t_only[1]
        diff = latest - prev
        if len(t_only) >= 3:
            n = min(3, len(t_only))
            all_same = all(t == latest for t in t_only[:n])
            all_rising = all(t_only[i] >= t_only[i + 1] for i in range(n - 1))
            all_falling = all(t_only[i] <= t_only[i + 1] for i in range(n - 1))
            if all_same:
                trend_info["direction"] = "stagnant"
            elif all_rising and diff > 0:
                trend_info["direction"] = "rising"
            elif all_falling and diff < 0:
                trend_info["direction"] = "falling"
            else:
                trend_info["direction"] = "mixed"
        elif diff > 0:
            trend_info["direction"] = "rising"
        elif diff < 0:
            trend_info["direction"] = "falling"
        else:
            trend_info["direction"] = "stagnant"
    trend_info["is_cooling"] = trend_info["direction"] in ("falling", "stagnant")

    # ── 9. Peak hour detection ──
    hourly = om.get("hourly", {})
    h_times = hourly.get("time", [])
    h_temps = hourly.get("temperature_2m", [])
    h_rad = hourly.get("shortwave_radiation", [])
    h_dew = hourly.get("dew_point_2m", [])
    h_pressure = hourly.get("pressure_msl", [])
    h_wspd = hourly.get("wind_speed_10m", [])
    h_wdir = hourly.get("wind_direction_10m", [])
    h_wspd_180m = hourly.get("wind_speed_180m", [])
    h_wdir_180m = hourly.get("wind_direction_180m", [])
    h_precip_prob = hourly.get("precipitation_probability", [])
    h_cloud_cover = hourly.get("cloud_cover", [])
    h_cape = hourly.get("cape", [])
    h_cin = hourly.get("convective_inhibition", [])
    h_lifted_index = hourly.get("lifted_index", [])
    h_boundary_layer_height = hourly.get("boundary_layer_height", [])
    if (not h_times or not h_temps) and metar:
        metar_today_obs = metar.get("today_obs", []) or []
        parsed_obs = []
        for item in metar_today_obs:
            try:
                t_str, t_val = item
                if t_str is None or t_val is None:
                    continue
                hh, minute_part = str(t_str).split(":")
                parsed_obs.append((int(hh), int(minute_part), float(t_val)))
            except Exception:
                continue
        if parsed_obs:
            parsed_obs.sort(key=lambda x: (x[0], x[1]))
            h_times = [f"{local_date_str}T{hh:02d}:{mm:02d}" for hh, mm, _ in parsed_obs]
            h_temps = [v for _, _, v in parsed_obs]
            h_rad = [0 for _ in parsed_obs]
            h_dew = [None for _ in parsed_obs]
            h_pressure = [None for _ in parsed_obs]
            h_wspd = [None for _ in parsed_obs]
            h_wdir = [None for _ in parsed_obs]
            h_wspd_180m = [None for _ in parsed_obs]
            h_wdir_180m = [None for _ in parsed_obs]
            h_precip_prob = [None for _ in parsed_obs]
            h_cloud_cover = [None for _ in parsed_obs]
            h_cape = [None for _ in parsed_obs]
            h_cin = [None for _ in parsed_obs]
            h_lifted_index = [None for _ in parsed_obs]
            h_boundary_layer_height = [None for _ in parsed_obs]

    peak_hours = []
    if h_times and h_temps and om_today is not None:
        for ts, tmp in zip(h_times, h_temps):
            if ts.startswith(local_date_str) and abs(tmp - om_today) <= 0.2:
                hr = int(ts.split("T")[1][:2])
                if 8 <= hr <= 19:
                    peak_hours.append(ts.split("T")[1][:5])

    first_peak_h = int(peak_hours[0].split(":")[0]) if peak_hours else 13
    last_peak_h = int(peak_hours[-1].split(":")[0]) if peak_hours else 15

    if local_hour_frac > last_peak_h:
        peak_status = "past"
    elif first_peak_h <= local_hour_frac <= last_peak_h:
        peak_status = "in_window"
    else:
        peak_status = "before"

    if current_forecasts and deb_val is not None:
        lgbm_val, _ = predict_lgbm_daily_high(
            city_name=city,
            current_forecasts=current_forecasts,
            deb_prediction=deb_val,
            current_temp=cur_temp,
            max_so_far=max_so_far,
            humidity=_sf(primary_current.get("humidity")),
            wind_speed_kt=_sf(primary_current.get("wind_speed_kt")),
            visibility_mi=_sf(primary_current.get("visibility_mi")),
            local_hour=local_hour,
            local_date=local_date_str,
            peak_status=peak_status,
        )
        if lgbm_val is not None:
            current_forecasts["LGBM"] = lgbm_val
            blended, winfo = calculate_dynamic_weights(city, current_forecasts)
            if blended is not None:
                deb_val = blended
                deb_weights = winfo

    deviation_monitor = _build_deviation_monitor(
        current_temp=cur_temp,
        deb_prediction=deb_val,
        om_today=om_today,
        hourly_times=h_times,
        hourly_temps=h_temps,
        local_date=local_date_str,
        local_hour_frac=local_hour_frac,
        observation_points=(
            settlement_today_obs if settlement_today_obs else metar_today_obs_payload
        ),
    )

    # ── 10. Shared analysis (probability, trend, AI) via trend_engine ──
    # This single call replaces the duplicate probability engine, dead market
    # detection, forecast bust grading, and AI context building.
    from src.analysis.trend_engine import analyze_weather_trend as _trend_analyze, calculate_prob_distribution

    probabilities = []
    shadow_probabilities = []
    mu = None
    probability_engine = "legacy"
    probability_calibration_mode = "legacy"
    probability_calibration_version = None
    probability_raw_mu = None
    probability_raw_sigma = None
    probability_calibrated_mu = None
    probability_calibrated_sigma = None
    dynamic_commentary = {"summary": "", "notes": []}
    try:
        _, _ai_context, sd = _trend_analyze(raw, sym, city)

        # Use structured data from shared engine
        mu = sd.get("mu")
        probabilities = sd.get("probabilities", [])
        shadow_probabilities = sd.get("shadow_probabilities", [])
        probability_engine = sd.get("probability_engine", "legacy")
        probability_calibration_mode = sd.get("probability_calibration_mode", "legacy")
        probability_calibration_version = sd.get("probability_calibration_version")
        probability_raw_mu = sd.get("probability_raw_mu")
        probability_raw_sigma = sd.get("probability_raw_sigma")
        probability_calibrated_mu = sd.get("probability_calibrated_mu")
        probability_calibrated_sigma = sd.get("probability_calibrated_sigma")
        dynamic_commentary = sd.get("dynamic_commentary") or dynamic_commentary
        trend_info["is_dead_market"] = sd.get("trend_info", {}).get("is_dead_market", False)
        trend_info["direction"] = sd.get("trend_info", {}).get("direction", trend_info.get("direction", "unknown"))
        trend_info["is_cooling"] = sd.get("trend_info", {}).get("is_cooling", False)
        peak_status = sd.get("peak_status", peak_status)

        # Use shared DEB if not already set
        if deb_val is None and sd.get("deb_prediction") is not None:
            deb_val = sd["deb_prediction"]
            deb_weights = sd.get("deb_weights", "")

    except Exception as e:
        logger.warning(f"Structured analysis skipped for {city}: {e}")

    # ── 12. Hourly data (today only, for chart) ──
    today_hourly: Dict[str, list] = {"times": [], "temps": [], "radiation": []}
    for i, ts in enumerate(h_times):
        if ts.startswith(local_date_str):
            today_hourly["times"].append(ts.split("T")[1][:5])
            today_hourly["temps"].append(h_temps[i] if i < len(h_temps) else None)
            today_hourly["radiation"].append(h_rad[i] if i < len(h_rad) else None)

    # ── 12b. Next 48h hourly block for future-date analysis modal ──
    next_48h_hourly = {
        "times": [],
        "temps": [],
        "radiation": [],
        "dew_point": [],
        "pressure_msl": [],
        "wind_speed_10m": [],
        "wind_direction_10m": [],
        "wind_speed_180m": [],
        "wind_direction_180m": [],
        "precipitation_probability": [],
        "cloud_cover": [],
        "cape": [],
        "convective_inhibition": [],
        "lifted_index": [],
        "boundary_layer_height": [],
    }
    try:
        local_anchor = datetime.strptime(
            f"{local_date_str} {local_time_str}", "%Y-%m-%d %H:%M"
        )
    except Exception:
        local_anchor = None

    if local_anchor is not None:
        horizon = local_anchor + timedelta(hours=48)
        for i, ts in enumerate(h_times):
            try:
                ts_dt = datetime.fromisoformat(ts)
            except Exception:
                continue
            if ts_dt < local_anchor or ts_dt > horizon:
                continue
            next_48h_hourly["times"].append(ts)
            next_48h_hourly["temps"].append(h_temps[i] if i < len(h_temps) else None)
            next_48h_hourly["radiation"].append(h_rad[i] if i < len(h_rad) else None)
            next_48h_hourly["dew_point"].append(h_dew[i] if i < len(h_dew) else None)
            next_48h_hourly["pressure_msl"].append(
                h_pressure[i] if i < len(h_pressure) else None
            )
            next_48h_hourly["wind_speed_10m"].append(
                h_wspd[i] if i < len(h_wspd) else None
            )
            next_48h_hourly["wind_direction_10m"].append(
                h_wdir[i] if i < len(h_wdir) else None
            )
            next_48h_hourly["wind_speed_180m"].append(
                h_wspd_180m[i] if i < len(h_wspd_180m) else None
            )
            next_48h_hourly["wind_direction_180m"].append(
                h_wdir_180m[i] if i < len(h_wdir_180m) else None
            )
            next_48h_hourly["precipitation_probability"].append(
                h_precip_prob[i] if i < len(h_precip_prob) else None
            )
            next_48h_hourly["cloud_cover"].append(
                h_cloud_cover[i] if i < len(h_cloud_cover) else None
            )
            next_48h_hourly["cape"].append(
                h_cape[i] if i < len(h_cape) else None
            )
            next_48h_hourly["convective_inhibition"].append(
                h_cin[i] if i < len(h_cin) else None
            )
            next_48h_hourly["lifted_index"].append(
                h_lifted_index[i] if i < len(h_lifted_index) else None
            )
            next_48h_hourly["boundary_layer_height"].append(
                h_boundary_layer_height[i] if i < len(h_boundary_layer_height) else None
            )

    vertical_profile_signal = (
        _build_vertical_profile_signal(
            next_48h_hourly,
            local_date_str,
            local_hour,
            first_peak_h,
            last_peak_h,
        )
        if not is_panel_mode and not is_nearby_mode and not is_market_mode
        else {}
    )
    taf_signal = (
        _build_taf_signal(
            taf if isinstance(taf, dict) else {},
            city,
            local_date_str,
            int(utc_offset or 0),
            first_peak_h,
            last_peak_h,
        )
        if not is_panel_mode and not is_nearby_mode and not is_market_mode
        else {"available": False}
    )

    # ── 13. Cloud description (METAR primary, MGM fallback) ──
    clouds = mc.get("clouds", [])
    cloud_desc = ""
    if clouds:
        c_map = {
            "BKN": "多云",
            "OVC": "阴天",
            "FEW": "少云",
            "SCT": "散云",
            "SKC": "晴",
            "CLR": "晴",
        }
        main = clouds[-1]
        cloud_desc = c_map.get(main.get("cover"), main.get("cover", ""))

    if not cloud_desc and mgm:
        mgc_cover = mgm.get("current", {}).get("cloud_cover")
        if mgc_cover is not None:
            cloud_desc_map = {
                0: "晴朗",
                1: "少云",
                2: "少云",
                3: "散云",
                4: "散云",
                5: "多云",
                6: "多云",
                7: "阴天",
                8: "阴天",
            }
            cloud_desc = cloud_desc_map.get(mgc_cover, "")

    # Final fallback: If we have ANY actual observation but no cloud info, it's usually clear.
    if not cloud_desc:
        if mc.get("temp") is not None or (mgm and mgm.get("current", {}).get("temp") is not None):
            # If weather phenomenon exists (e.g. rain), we'll let app.js handle wx_desc priority.
            # Otherwise, clear skies.
            if not mc.get("wx_desc"):
                cloud_desc = "晴朗"

    # ── 14. MGM data (Turkish MGM-supported cities) ──
    mgm_data = {}
    if mgm:
        mgc = mgm.get("current", {})
        mgm_time_str = mgc.get("time", "")
        # MGM time is usually "2026-03-04T10:40:00.000Z" (UTC)
        if mgm_time_str and "T" in mgm_time_str:
            try:
                # Handle ISO format with Z or +00:00
                ts = mgm_time_str.replace("Z", "+00:00")
                if "+" in ts:
                    base, offset_part = ts.split("+", 1)
                    if "." in base:
                        base = base.split(".")[0]
                    ts = base + "+" + offset_part
                dt = datetime.fromisoformat(ts)
                local_dt = dt.astimezone(timezone(timedelta(seconds=utc_offset or 0)))
                mgm_time_str = local_dt.strftime("%H:%M")
            except Exception as e:
                logger.debug(f"MGM time conversion failed: {e}")
                pass
                
        mgm_data = {
            "temp": _sf(mgc.get("temp")),
            "time": mgm_time_str,
            "feels_like": _sf(mgc.get("feels_like")),
            "humidity": _sf(mgc.get("humidity")),
            "wind_dir": _sf(mgc.get("wind_dir")),
            "wind_speed_ms": _sf(mgc.get("wind_speed_ms")),
            "pressure": _sf(mgc.get("pressure")),
            "cloud_cover": mgc.get("cloud_cover"),
            "rain_24h": _sf(mgc.get("rain_24h")),
            "today_high": _sf(mgm.get("today_high")),
            "today_low": _sf(mgm.get("today_low")),
            "hourly": [],
        }

        mgm_hourly = mgm.get("hourly", [])
        for h in mgm_hourly:
            dt_str = h.get("time")
            val = _sf(h.get("temp"))
            if dt_str and "T" in dt_str and val is not None:
                try:
                    dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
                    local_dt = dt.astimezone(timezone(timedelta(seconds=utc_offset)))
                    mgm_data["hourly"].append({
                        "time": local_dt.strftime("%Y-%m-%dT%H:%M"),
                        "temp": val
                    })
                except Exception:
                    pass


    # ── 15. Extended Multi-Model Daily ──
    multi_model_daily = {}
    mm_daily_raw = mm.get("daily_forecasts", {})
    for i, d_str in enumerate(dates):
        if i == 0:
            day_m = current_forecasts.copy()
            d_val, d_winfo = deb_val, deb_weights
        else:
            day_m = mm_daily_raw.get(d_str, {}).copy()
            if i < len(maxtemps) and maxtemps[i] is not None:
                day_m["Open-Meteo"] = _sf(maxtemps[i])
            
            # Add MGM per-day forecast
            mgm_daily = mgm.get("daily_forecasts", {})
            if d_str in mgm_daily:
                day_m["MGM"] = _sf(mgm_daily[d_str])

            day_m = {
                m: v for m, v in day_m.items() if not _is_excluded_model_name(m)
            }
            
            d_val, d_winfo = None, ""
            d_probs = []
            if day_m:
                try:
                    blended, winfo = calculate_dynamic_weights(city, day_m)
                    if blended is not None:
                        d_val = blended
                        d_winfo = winfo
                        
                        # Calculate future probability based on model divergence
                        m_vals = [v for v in day_m.values() if v is not None]
                        if len(m_vals) > 1:
                            # Use spread as a proxy for sigma. 
                            # sigma = (max-min)/2 with a floor of 0.6
                            d_sigma = max(0.6, (max(m_vals) - min(m_vals)) / 2.0)
                        else:
                            d_sigma = 1.0
                        
                        prob_obj = calculate_prob_distribution(d_val, d_sigma, None, sym)
                        d_probs = prob_obj.get("probabilities", [])
                except Exception:
                    pass
        
        if day_m:
            multi_model_daily[d_str] = {
                "models": day_m,
                "deb": {"prediction": d_val, "weights_info": d_winfo},
                "probabilities": d_probs if i > 0 else probabilities # Use today's real prob for today
            }

    # ── Assemble result ──
    city_meta = CITIES.get(city, {}) or {}
    result = {
        "detail_depth": (
            "panel"
            if is_panel_mode
            else "market"
            if is_market_mode
            else "nearby"
            if is_nearby_mode
            else "full"
        ),
        "name": city,
        "display_name": str(city_meta.get("display_name") or city_meta.get("name") or city.title()),
        "lat": lat,
        "lon": lon,
        "temp_symbol": sym,
        "local_time": local_time_str,
        "local_date": local_date_str,
        "risk": {
            "level": risk.get("risk_level", "low"),
            "emoji": risk.get("risk_emoji", "🟢"),
            "airport": risk.get("airport_name", ""),
            "icao": risk.get("icao", ""),
            "distance_km": risk.get("distance_km", 0),
            "warning": risk.get("warning", ""),
        },
        "current": {
            "temp": cur_temp,
            "max_so_far": display_settlement_max,
            "max_temp_time": max_temp_time,
            "raw_max_so_far": raw_settlement_max,
            "wu_settlement": wu_settle,
            "settlement_source": current_source,
            "settlement_source_label": current_source_label,
            "station_code": current_station_code,
            "station_name": current_station_name,
            "obs_time": obs_time_str,
            "obs_age_min": None if use_settlement_current else metar_age_min,
            "report_time": primary_current.get("report_time"),
            "receipt_time": primary_current.get("receipt_time"),
            "obs_time_epoch": primary_current.get("obs_time_epoch"),
            "wind_speed_kt": _sf(primary_current.get("wind_speed_kt")),
            "wind_dir": _sf(primary_current.get("wind_dir")),
            "humidity": _sf(primary_current.get("humidity")),
            "cloud_desc": cloud_desc,
            "clouds_raw": [
                {"cover": c.get("cover"), "base": c.get("base")} for c in clouds
            ],
            "visibility_mi": _sf(primary_current.get("visibility_mi")),
            "wx_desc": primary_current.get("wx_desc"),
            "raw_metar": primary_current.get("raw_metar"),
        },
        "airport_current": {
            "temp": _sf(mc.get("temp")),
            "obs_time": obs_time_str,
            "max_so_far": airport_max_so_far,
            "max_temp_time": airport_max_temp_time,
            "obs_age_min": metar_age_min,
            "report_time": metar.get("report_time") if metar else None,
            "receipt_time": metar.get("receipt_time") if metar else None,
            "obs_time_epoch": metar.get("obs_time_epoch") if metar else None,
            "wind_speed_kt": _sf(mc.get("wind_speed_kt")),
            "wind_dir": _sf(mc.get("wind_dir")),
            "humidity": _sf(mc.get("humidity")),
            "cloud_desc": metar.get("cloud_desc") if metar else None,
            "visibility_mi": _sf(mc.get("visibility_mi")),
            "wx_desc": mc.get("wx_desc"),
            "raw_metar": mc.get("raw_metar"),
            "source_label": "METAR",
        },
        "settlement_station": network_snapshot.get("settlement_station") or {},
        "airport_primary": airport_primary_current,
        "airport_primary_today_obs": network_snapshot.get("airport_primary_today_obs") or [],
        "official_nearby": network_snapshot.get("official_nearby") or [],
        "official_network_source": network_snapshot.get("official_network_source"),
        "official_network_status": network_snapshot.get("official_network_status") or {},
        "network_lead_signal": network_snapshot.get("network_lead_signal") or {},
        "network_spread_signal": network_snapshot.get("network_spread_signal") or {},
        "center_station_candidate": network_snapshot.get("center_station_candidate"),
        "airport_vs_network_delta": network_snapshot.get("airport_vs_network_delta"),
        "mgm": mgm_data,
        "mgm_nearby": raw.get("mgm_nearby", []),
        "nearby_source": raw.get("nearby_source") or ("mgm" if city.lower() in TURKISH_MGM_CITIES else "metar_cluster"),
        "forecast": {
            "today_high": om_today,
            "daily": forecast_daily,
            "sunrise": sunrise,
            "sunset": sunset,
            "sunshine_hours": sunshine_h,
        },
        "source_forecasts": {
            "weather_gov": raw.get("nws") or {},
        },
        "multi_model": {k: v for k, v in current_forecasts.items() if v is not None},
        "multi_model_daily": multi_model_daily,
        "deb": {"prediction": deb_val, "weights_info": deb_weights},
        "deviation_monitor": deviation_monitor,
        "ensemble": ens_data,
        "probabilities": {
            "mu": round(mu, 1) if mu is not None else None,
            "distribution": probabilities,
            "engine": probability_engine,
            "calibration_mode": probability_calibration_mode,
            "calibration_version": probability_calibration_version,
            "raw_mu": probability_raw_mu,
            "raw_sigma": probability_raw_sigma,
            "calibrated_mu": probability_calibrated_mu,
            "calibrated_sigma": probability_calibrated_sigma,
            "shadow_distribution": shadow_probabilities,
        },
        "trend": trend_info,
        "peak": {
            "hours": peak_hours,
            "first_h": first_peak_h,
            "last_h": last_peak_h,
            "status": peak_status,
        },
        "dynamic_commentary": dynamic_commentary,
        "hourly": today_hourly,
        "hourly_next_48h": next_48h_hourly,
        "vertical_profile_signal": vertical_profile_signal,
        "taf": {
            **(taf if isinstance(taf, dict) else {}),
            "signal": taf_signal,
        }
        if taf_signal or taf
        else {},
        "metar_today_obs": metar_today_obs_payload,
        "metar_recent_obs": metar_recent_obs_payload,
        "settlement_today_obs": settlement_today_obs,
        "ai_analysis": "",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    result["intraday_meteorology"] = _build_intraday_meteorology(result)

    if include_llm_commentary:
        result["dynamic_commentary"] = _maybe_enrich_dynamic_commentary_with_groq(
            city,
            result,
        )

    _cache[cache_key] = {"t": _time.time(), "d": result}
    return result


def _normalize_city_or_404(name: str) -> str:
    city = name.lower().strip().replace("-", " ")
    city = ALIASES.get(city, city)
    if city not in CITIES:
        raise HTTPException(404, detail=f"Unknown city: {city}")
    return city


def _analyze_summary(city: str, force_refresh: bool = False) -> Dict[str, Any]:
    ttl = _analysis_ttl_for_city(city)

    if not force_refresh:
        cached_detail = _get_cached_analysis(city, ttl)
        if cached_detail:
            return cached_detail
        cached_summary = _get_cached_summary(city, ttl)
        if cached_summary:
            return cached_summary

    info = CITIES[city]
    lat, lon, is_f = info["lat"], info["lon"], info["f"]
    sym = "°F" if is_f else "°C"
    settlement_source = str(info.get("settlement_source") or "metar").strip().lower() or "metar"
    settlement_source_label = SETTLEMENT_SOURCE_LABELS.get(
        settlement_source,
        settlement_source.upper(),
    )

    if force_refresh:
        try:
            _weather._evict_city_caches(  # type: ignore[attr-defined]
                city=city,
                lat=lat,
                lon=lon,
                use_fahrenheit=is_f,
            )
        except Exception:
            pass

    default_utc_offset = int(info.get("tz", 0) or 0)

    def _safe_call(fn):
        try:
            return fn()
        except Exception:
            return None

    jobs = {
        "settlement_current": lambda: _weather.fetch_settlement_current(city) or {},
        "open_meteo": lambda: _weather.fetch_from_open_meteo(lat, lon, use_fahrenheit=is_f) or {},
    }
    if _weather._supports_aviationweather(city):  # type: ignore[attr-defined]
        jobs["metar"] = lambda: _weather.fetch_metar(
            city,
            use_fahrenheit=is_f,
            utc_offset=default_utc_offset,
        ) or {}
    if city in TURKISH_MGM_CITIES:
        istno, _province = _weather.TURKISH_PROVINCES.get(city, (None, None))  # type: ignore[attr-defined]
        if istno:
            jobs["mgm"] = lambda istno=istno: _weather.fetch_from_mgm(str(istno)) or {}
    if is_f:
        jobs["nws"] = lambda: _weather.fetch_nws(lat, lon) or {}
    if settlement_source == "hko":
        jobs["hko_forecast"] = lambda: _weather.fetch_hko_forecast()

    fetched: Dict[str, Any] = {}
    with ThreadPoolExecutor(max_workers=min(6, len(jobs))) as executor:
        future_map = {
            executor.submit(_safe_call, fn): key
            for key, fn in jobs.items()
        }
        for future, key in [(future, key) for future, key in future_map.items()]:
            fetched[key] = future.result()

    settlement_current = fetched.get("settlement_current") or {}
    open_meteo = fetched.get("open_meteo") or {}
    utc_offset = open_meteo.get("utc_offset")
    if utc_offset is None:
        utc_offset = default_utc_offset
    try:
        utc_offset = int(utc_offset or 0)
    except Exception:
        utc_offset = default_utc_offset
    metar = fetched.get("metar") or {}
    mgm = fetched.get("mgm") or {}
    nws = fetched.get("nws") or {}
    hko_forecast = fetched.get("hko_forecast")

    sc_cur = settlement_current.get("current") or {}
    mc = metar.get("current") or {}
    mg_cur = mgm.get("current") or {}
    use_settlement_current = settlement_source in {"hko", "cwa", "noaa", "wunderground"} and bool(sc_cur)
    primary_current = sc_cur if use_settlement_current else mc

    current_source = settlement_source
    current_source_label = settlement_source_label
    nmc_fallback: Dict[str, Any] = {}
    cur_temp = _sf(primary_current.get("temp"))
    if cur_temp is not None and not _is_plausible_city_temp(city, cur_temp, sym):
        cur_temp = None
    if cur_temp is None:
        cur_temp = _sf(mc.get("temp"))
        if cur_temp is not None and not _is_plausible_city_temp(city, cur_temp, sym):
            cur_temp = None
    if cur_temp is None:
        cur_temp = _sf(mg_cur.get("temp"))
        if cur_temp is not None and not _is_plausible_city_temp(city, cur_temp, sym):
            cur_temp = None
    if cur_temp is None:
        nmc_fallback = _fetch_nmc_current_fallback(city, use_fahrenheit=is_f)
        nmc_cur = nmc_fallback.get("current") or {}
        nmc_temp = _sf(nmc_cur.get("temp"))
        if nmc_temp is not None:
            cur_temp = nmc_temp
            current_source = "nmc"
            current_source_label = "NMC"

    max_so_far = _sf(primary_current.get("max_temp_so_far"))
    if max_so_far is not None and not _is_plausible_city_temp(city, max_so_far, sym):
        max_so_far = None
    if max_so_far is None:
        max_so_far = _sf(mc.get("max_temp_so_far"))
        if max_so_far is not None and not _is_plausible_city_temp(city, max_so_far, sym):
            max_so_far = None
    if max_so_far is None:
        max_so_far = _sf(mg_cur.get("mgm_max_temp"))
        if max_so_far is not None and not _is_plausible_city_temp(city, max_so_far, sym):
            max_so_far = None
    if max_so_far is None:
        max_so_far = cur_temp

    max_temp_time = primary_current.get("max_temp_time")
    if not max_temp_time and not use_settlement_current:
        max_temp_time = mc.get("max_temp_time")
    if not max_temp_time:
        mgm_time = str(mg_cur.get("time") or "")
        if " " in mgm_time:
            max_temp_time = mgm_time.split(" ")[1][:5]

    raw_settlement_max = max_so_far
    wu_settle = (
        apply_city_settlement(city.lower(), raw_settlement_max)
        if raw_settlement_max is not None
        else None
    )
    display_settlement_max = (
        wu_settle
        if settlement_source == "wunderground" and wu_settle is not None
        else raw_settlement_max
    )

    obs_time_str = ""
    obs_age_min = None
    obs_t = ""
    if use_settlement_current:
        obs_t = str(settlement_current.get("observation_time") or "").strip()
    if not obs_t:
        obs_t = str(metar.get("observation_time") or "").strip()
    if obs_t and "T" in obs_t:
        try:
            dt = datetime.fromisoformat(obs_t.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            local_dt = dt.astimezone(timezone(timedelta(seconds=utc_offset)))
            obs_time_str = local_dt.strftime("%H:%M")
            obs_age_min = int(
                (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds() / 60
            )
        except Exception:
            obs_time_str = str(obs_t)[:16]
    if not obs_time_str and current_source == "nmc":
        if not nmc_fallback:
            nmc_fallback = _fetch_nmc_current_fallback(city, use_fahrenheit=is_f)
        obs_time_str = _format_observation_time_local(
            nmc_fallback.get("publish_time") or nmc_fallback.get("timestamp"),
            int(utc_offset or 0),
        )

    om_daily = (open_meteo.get("daily") or {}) if isinstance(open_meteo, dict) else {}
    om_hourly = (open_meteo.get("hourly") or {}) if isinstance(open_meteo, dict) else {}
    maxtemps = om_daily.get("temperature_2m_max", [])[:5]
    om_today = _sf(maxtemps[0]) if maxtemps else None
    nws_high = _sf((nws or {}).get("today_high")) if isinstance(nws, dict) else None
    mgm_high = _sf((mgm or {}).get("today_high")) if isinstance(mgm, dict) else None

    if om_today is None:
        fallback_high = (
            nws_high
            if nws_high is not None
            else mgm_high
            if mgm_high is not None
            else max_so_far
            if max_so_far is not None
            else cur_temp
        )
        if fallback_high is not None:
            om_today = float(fallback_high)

    current_forecasts: Dict[str, float] = {}
    if om_today is not None:
        current_forecasts["Open-Meteo"] = om_today
    if nws_high is not None:
        current_forecasts["NWS"] = nws_high
    if mgm_high is not None:
        current_forecasts["MGM"] = mgm_high
    if hko_forecast is not None:
        current_forecasts["HKO"] = _sf(hko_forecast)
    current_forecasts = {
        model_name: value
        for model_name, value in current_forecasts.items()
        if value is not None and not _is_excluded_model_name(model_name)
    }

    deb_val = None
    if current_forecasts:
        blended, _weights_info = calculate_dynamic_weights(city, current_forecasts)
        if blended is not None:
            deb_val = blended
    if deb_val is None:
        deb_val = om_today

    local_time_full = (open_meteo.get("current") or {}).get("local_time", "")
    now_utc = datetime.now(timezone.utc)
    local_now = now_utc + timedelta(seconds=utc_offset)
    local_date_str = local_now.strftime("%Y-%m-%d")
    local_hour = local_now.hour
    local_minute = local_now.minute
    try:
        if local_time_full:
            local_date_str = str(local_time_full).split(" ")[0]
            tp = str(local_time_full).split(" ")[1].split(":")
            local_hour = int(tp[0])
            local_minute = int(tp[1]) if len(tp) > 1 else 0
    except Exception:
        pass
    local_time_str = f"{local_hour:02d}:{local_minute:02d}"
    local_hour_frac = local_hour + local_minute / 60.0

    settlement_today_obs = []
    if use_settlement_current:
        explicit_obs = settlement_current.get("today_obs") or []
        for item in explicit_obs:
            if isinstance(item, dict):
                raw_time = str(item.get("time") or "").strip()
                raw_temp = _sf(item.get("temp"))
            elif isinstance(item, (list, tuple)) and len(item) >= 2:
                raw_time = str(item[0] or "").strip()
                raw_temp = _sf(item[1])
            else:
                continue
            if raw_time and raw_temp is not None:
                settlement_today_obs.append({"time": raw_time, "temp": raw_temp})
        if not settlement_today_obs and obs_time_str and cur_temp is not None:
            settlement_today_obs.append({"time": obs_time_str, "temp": cur_temp})
        if max_temp_time and max_so_far is not None and str(max_temp_time) != str(obs_time_str):
            settlement_today_obs.append({"time": str(max_temp_time), "temp": max_so_far})

    metar_today_obs_payload = [
        {"time": obs_time, "temp": obs_temp}
        for obs_time, obs_temp in ((metar.get("today_obs") or []) if isinstance(metar, dict) else [])
    ]

    deviation_monitor = _build_deviation_monitor(
        current_temp=cur_temp,
        deb_prediction=deb_val,
        om_today=om_today,
        hourly_times=om_hourly.get("time", []) if isinstance(om_hourly, dict) else [],
        hourly_temps=om_hourly.get("temperature_2m", []) if isinstance(om_hourly, dict) else [],
        local_date=local_date_str,
        local_hour_frac=local_hour_frac,
        observation_points=(
            settlement_today_obs if settlement_today_obs else metar_today_obs_payload
        ),
    )

    risk = CITY_RISK_PROFILES.get(city, {})
    city_meta = CITY_REGISTRY.get(city, {}) or {}
    result = {
        "name": city,
        "display_name": str(city_meta.get("display_name") or city_meta.get("name") or city.title()),
        "temp_symbol": sym,
        "local_time": local_time_str,
        "local_date": local_date_str,
        "risk": {
            "level": risk.get("risk_level", "low"),
            "warning": risk.get("warning", ""),
            "icao": risk.get("icao", ""),
        },
        "current": {
            "temp": _sf(cur_temp),
            "max_so_far": _sf(display_settlement_max),
            "max_temp_time": max_temp_time,
            "wu_settlement": _sf(wu_settle),
            "settlement_source": current_source,
            "settlement_source_label": current_source_label,
            "obs_time": obs_time_str or None,
            "obs_age_min": obs_age_min,
        },
        "deb": {"prediction": _sf(deb_val)},
        "deviation_monitor": deviation_monitor or {},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    _set_cached_summary(city, result)
    return result


def _build_city_summary_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "name": data.get("name"),
        "display_name": data.get("display_name"),
        "icao": data.get("risk", {}).get("icao"),
        "local_time": data.get("local_time"),
        "temp_symbol": data.get("temp_symbol"),
        "current": {
            "temp": data.get("current", {}).get("temp"),
            "obs_time": data.get("current", {}).get("obs_time"),
            "settlement_source": data.get("current", {}).get("settlement_source"),
            "settlement_source_label": data.get("current", {}).get("settlement_source_label"),
        },
        "deb": {"prediction": data.get("deb", {}).get("prediction")},
        "deviation_monitor": data.get("deviation_monitor") or {},
        "risk": {
            "level": data.get("risk", {}).get("level"),
            "warning": data.get("risk", {}).get("warning"),
        },
        "updated_at": data.get("updated_at"),
    }


def _build_city_market_scan_payload(
    data: Dict[str, Any],
    market_slug: Optional[str] = None,
    target_date: Optional[str] = None,
) -> Dict[str, Any]:
    city = str(data.get("name") or "").strip().lower()
    local_date = str(data.get("local_date") or "").strip()
    requested_date = str(target_date or "").strip()
    selected_date = requested_date or local_date

    multi_model_daily = data.get("multi_model_daily") or {}
    selected_daily = (
        multi_model_daily.get(selected_date)
        if isinstance(multi_model_daily, dict)
        else None
    )
    if not isinstance(selected_daily, dict):
        selected_daily = {}
        selected_date = local_date

    distribution = selected_daily.get("probabilities")
    if not isinstance(distribution, list) or not distribution:
        distribution = data.get("probabilities", {}).get("distribution", []) or []

    model_map = selected_daily.get("models") or data.get("multi_model") or {}
    if not isinstance(model_map, dict):
        model_map = {}

    anchor_temp = None
    anchor_model = None
    for model_name, raw_value in model_map.items():
        value = _sf(raw_value)
        if value is None:
            continue
        if anchor_temp is None or value > anchor_temp:
            anchor_temp = value
            anchor_model = str(model_name or "").strip() or None

    anchor_temp_c = anchor_temp
    temp_symbol = str(data.get("temp_symbol") or "")
    if anchor_temp_c is not None and "F" in temp_symbol.upper():
        anchor_temp_c = (anchor_temp_c - 32.0) * 5.0 / 9.0
    anchor_settlement = apply_city_settlement(city, anchor_temp_c) if anchor_temp_c is not None else None

    primary_bucket = None
    if isinstance(distribution, list) and distribution:
        if anchor_temp is None:
            primary_bucket = distribution[0]
        else:
            ranked_buckets = []
            for idx, row in enumerate(distribution):
                if not isinstance(row, dict):
                    continue
                bucket_temp = _sf(row.get("value"))
                bucket_prob = _sf(row.get("probability"))
                if bucket_temp is None:
                    continue
                prob_rank = bucket_prob if bucket_prob is not None else -1.0
                ranked_buckets.append((abs(bucket_temp - anchor_temp), -prob_rank, idx, row))
            if ranked_buckets:
                ranked_buckets.sort(key=lambda x: (x[0], x[1], x[2]))
                primary_bucket = ranked_buckets[0][3]
            else:
                primary_bucket = distribution[0]

    model_probability = None
    if isinstance(primary_bucket, dict) and primary_bucket.get("probability") is not None:
        try:
            raw_probability = float(primary_bucket.get("probability"))
            model_probability = raw_probability / 100.0 if raw_probability > 1.0 else raw_probability
        except Exception:
            model_probability = None

    fallback_sparkline = [
        p.get("probability", 0)
        for p in distribution[:8]
        if isinstance(p, dict)
    ]
    market_scan = _market_layer.build_market_scan(
        city=data.get("name"),
        target_date=selected_date or data.get("local_date"),
        temperature_bucket=primary_bucket if isinstance(primary_bucket, dict) else None,
        model_probability=model_probability,
        fallback_sparkline=fallback_sparkline,
        forced_market_slug=market_slug,
    )
    if isinstance(market_scan, dict):
        market_scan["anchor_model"] = anchor_model
        market_scan["anchor_high"] = anchor_temp
        market_scan["anchor_settlement"] = anchor_settlement
        market_scan["open_meteo_settlement"] = anchor_settlement
    return {
        "market_scan": market_scan,
        "selected_date": selected_date or data.get("local_date"),
        "fetched_at": data.get("updated_at"),
    }


def _build_city_detail_payload(
    data: Dict[str, Any],
    market_slug: Optional[str] = None,
    target_date: Optional[str] = None,
) -> Dict[str, Any]:
    market_payload = _build_city_market_scan_payload(
        data,
        market_slug=market_slug,
        target_date=target_date,
    )
    market_scan = market_payload.get("market_scan")
    return {
        "city": data.get("name"),
        "fetched_at": data.get("updated_at"),
        "overview": {
            "name": data.get("name"),
            "display_name": data.get("display_name"),
            "icao": data.get("risk", {}).get("icao"),
            "airport": data.get("risk", {}).get("airport"),
            "lat": data.get("lat"),
            "lon": data.get("lon"),
            "local_time": data.get("local_time"),
            "local_date": data.get("local_date"),
            "temp_symbol": data.get("temp_symbol"),
            "current_temp": data.get("current", {}).get("temp"),
            "settlement_source": data.get("current", {}).get("settlement_source"),
            "settlement_source_label": data.get("current", {}).get("settlement_source_label"),
            "settlement_station": data.get("settlement_station") or {},
            "deb_prediction": data.get("deb", {}).get("prediction"),
            "risk_level": data.get("risk", {}).get("level"),
            "risk_warning": data.get("risk", {}).get("warning"),
            "updated_at": data.get("updated_at"),
        },
        "official": {
            "available": bool(data.get("current", {}).get("temp") is not None),
            "metar": {
                "observation_time": data.get("airport_current", {}).get("obs_time"),
                "obs_age_min": data.get("airport_current", {}).get("obs_age_min"),
                "report_time": data.get("airport_current", {}).get("report_time"),
                "receipt_time": data.get("airport_current", {}).get("receipt_time"),
                "raw_metar": data.get("airport_current", {}).get("raw_metar"),
                "current": data.get("airport_current") or {},
            },
            "taf": data.get("taf") or {},
            "weather_gov": {},
            "mgm": data.get("mgm") or {},
            "mgm_nearby": data.get("mgm_nearby") or [],
            "nearby_source": data.get("nearby_source") or ("mgm" if str(data.get("name") or "").lower() in TURKISH_MGM_CITIES else "metar_cluster"),
            "airport_primary": data.get("airport_primary") or {},
            "airport_primary_today_obs": data.get("airport_primary_today_obs") or [],
            "official_nearby": data.get("official_nearby") or [],
            "official_network_source": data.get("official_network_source"),
            "official_network_status": data.get("official_network_status") or {},
            "network_lead_signal": data.get("network_lead_signal") or {},
            "network_spread_signal": data.get("network_spread_signal") or {},
            "center_station_candidate": data.get("center_station_candidate"),
            "airport_vs_network_delta": data.get("airport_vs_network_delta"),
        },
        "timeseries": {
            "metar_recent_obs": data.get("metar_recent_obs") or [],
            "metar_today_obs": data.get("metar_today_obs") or [],
            "settlement_today_obs": data.get("settlement_today_obs") or [],
            "hourly": data.get("hourly") or {},
            "mgm_hourly": (data.get("mgm") or {}).get("hourly", []),
            "forecast_daily": (data.get("forecast") or {}).get("daily", []),
        },
        "models": {
            k: v
            for k, v in (data.get("multi_model") or {}).items()
            if not _is_excluded_model_name(k)
        },
        "probabilities": data.get("probabilities") or {"mu": None, "distribution": []},
        "dynamic_commentary": data.get("dynamic_commentary") or {"summary": "", "notes": []},
        "intraday_meteorology": data.get("intraday_meteorology")
        or _build_intraday_meteorology(data),
        "vertical_profile_signal": data.get("vertical_profile_signal") or {},
        "taf": data.get("taf") or {},
        "market_scan": market_scan,
        "risk": data.get("risk"),
        "settlement_station": data.get("settlement_station") or {},
        "airport_primary": data.get("airport_primary") or {},
        "official_nearby": data.get("official_nearby") or [],
        "official_network_source": data.get("official_network_source"),
        "official_network_status": data.get("official_network_status") or {},
        "network_lead_signal": data.get("network_lead_signal") or {},
        "network_spread_signal": data.get("network_spread_signal") or {},
        "center_station_candidate": data.get("center_station_candidate"),
        "airport_vs_network_delta": data.get("airport_vs_network_delta"),
        "airport_current": data.get("airport_current") or {},
        "nearby_source": data.get("nearby_source") or ("mgm" if str(data.get("name") or "").lower() in TURKISH_MGM_CITIES else "metar_cluster"),
        "ai_analysis": data.get("ai_analysis") or "",
        "errors": {},
    }


# ──────────────────────────────────────────────────────────
#  Routes
# ──────────────────────────────────────────────────────────
