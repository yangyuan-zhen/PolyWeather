from __future__ import annotations

import re
import time as _time
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional

from fastapi import HTTPException
from loguru import logger

from web.core import (
    LRUDict,
    _cache,
    _CACHE_LOCK,
    CACHE_TTL,
    CACHE_TTL_ANKARA,
    CACHE_TTL_KOREAN_AMOS,
    CITIES,
    CITY_RISK_PROFILES,
    SETTLEMENT_SOURCE_LABELS,
    _is_excluded_model_name,
    _sf,
    _weather,
)
from src.analysis.deb_algorithm import calculate_deb_prediction
from src.analysis.deb_hourly_consensus import build_deb_hourly_consensus_path
from src.analysis.deb_hourly_correction import (
    build_deb_hourly_path,
    get_cached_hourly_peak_corrector,
)
from src.analysis.settlement_rounding import apply_city_settlement
from src.analysis.trend_engine import _resolve_peak_hours
from src.data_collection.country_networks import build_country_network_snapshot
from src.data_collection.city_registry import ALIASES, CITY_REGISTRY
from src.data_collection.city_time import get_city_utc_offset_seconds
from src.database.runtime_state import IntradayPathSnapshotRepository
from web.services.city_payloads import (
    build_city_detail_payload as _city_payload_detail,
    build_city_summary_payload as _city_payload_summary
)
from web.services.observation_freshness import (
    build_observation_freshness as _build_observation_freshness,
    observation_age_min as _observation_age_min,
)
from web.services.analysis_utils import (
    add_signal as _add_signal,
    bucket_label as _bucket_label,
    bucket_label_from_value as _bucket_label_from_value,
    format_clock_minutes as _format_clock_minutes,
    next_observation_clock as _next_observation_clock,
    top_probability_bucket as _top_probability_bucket,
)
from web.services.analysis_signals import (
    _build_deviation_monitor,
    _build_taf_signal,
    _build_vertical_profile_signal,
    _interpolate_hourly_value,  # noqa: F401 - compatibility re-export
    _wind_components,  # noqa: F401 - compatibility re-export
)

TURKISH_MGM_CITIES = {"ankara", "istanbul"}
HIGH_FREQ_AIRPORT_ANALYSIS_CITIES = {
    "seoul",
    "singapore",
    "busan",
    "tokyo",
    "ankara",
    "helsinki",
    "amsterdam",
    "istanbul",
    "paris",
    "hong kong",
    "shenzhen",
    "taipei",
    "beijing",
    "shanghai",
    "guangzhou",
    "shenzhen",
    "qingdao",
    "chengdu",
    "chongqing",
    "wuhan",
}

AMSC_SETTLEMENT_RUNWAY_PAIRS: Dict[str, tuple[str, str]] = {
    "shanghai": ("17L", "35R"),
    "chengdu": ("02L", "20R"),
    "chongqing": ("20R", "02L"),
    "guangzhou": ("02L", "20R"),
    "wuhan": ("04", "22"),
    "beijing": ("19", "01"),
    "qingdao": ("16", "34"),
}

AMSC_SETTLEMENT_RUNWAY_TARGETS: Dict[str, str] = {
    "shanghai": "35R",
    "chengdu": "02L",
    "chongqing": "02L",
    "guangzhou": "02L",
    "wuhan": "04",
    "beijing": "01",
    "qingdao": "34",
}


def _should_build_country_network_snapshot(
    city: str,
    raw: Dict[str, Any],
    *,
    is_panel_mode: bool,
    is_market_mode: bool,
) -> bool:
    if is_market_mode:
        return False
    if not is_panel_mode:
        return True

    city_lower = (city or "").strip().lower()
    if city_lower not in TURKISH_MGM_CITIES:
        return False

    return bool(
        (raw or {}).get("mgm")
        or (raw or {}).get("mgm_today_obs")
        or (raw or {}).get("mgm_nearby")
    )


def _mgm_hourly_high(mgm: Dict[str, Any]) -> Optional[float]:
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


def _normalize_runway_label(value: Any) -> str:
    return re.sub(r"[^0-9A-Z]+", "", str(value or "").strip().upper())


def _split_runway_pair_label(value: Any) -> tuple[str, str]:
    parts = [_normalize_runway_label(part) for part in str(value or "").split("/") if part.strip()]
    if len(parts) >= 2:
        return parts[0], parts[1]
    runway = _normalize_runway_label(value)
    return runway, runway


def _runway_pair_matches(left: tuple[str, str], right: tuple[str, str]) -> bool:
    return tuple(sorted(left)) == tuple(sorted(right))


def _settlement_runway_endpoint_temp(city: str, row: Dict[str, Any]) -> Optional[float]:
    city_key = (city or "").strip().lower()
    configured_pair = AMSC_SETTLEMENT_RUNWAY_PAIRS.get(city_key)
    target = _normalize_runway_label(AMSC_SETTLEMENT_RUNWAY_TARGETS.get(city_key))
    if not configured_pair or not target:
        return None

    pair = _split_runway_pair_label(row.get("runway"))
    configured = (
        _normalize_runway_label(configured_pair[0]),
        _normalize_runway_label(configured_pair[1]),
    )
    if not _runway_pair_matches(pair, configured):
        return None

    tdz_temp = _sf(row.get("tdz_temp"))
    end_temp = _sf(row.get("end_temp"))
    if target == pair[0]:
        return tdz_temp if tdz_temp is not None else end_temp
    if target == pair[1]:
        return end_temp if end_temp is not None else tdz_temp
    return None


def _runway_history_temp_for_city(city: str, row: Dict[str, Any]) -> Optional[float]:
    endpoint_temp = _settlement_runway_endpoint_temp(city, row)
    if endpoint_temp is not None:
        return endpoint_temp
    target_runway_max = _sf(row.get("target_runway_max"))
    if target_runway_max is not None:
        return target_runway_max
    return _sf(row.get("tdz_temp"))


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
_SUMMARY_CACHE_MAXSIZE = 128
_SUMMARY_CACHE = LRUDict(maxsize=_SUMMARY_CACHE_MAXSIZE)
def _dedupe_forecast_daily(rows: Any) -> list[Dict[str, Any]]:
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
    return {}


def _is_plausible_city_temp(city: str, value: Any, unit: str = "°C") -> bool:
    temp = _sf(value)
    if temp is None:
        return False
    meta = CITY_REGISTRY.get((city or "").strip().lower(), {}) or {}
    min_c = _sf(meta.get("min_plausible_metar_temp_c"))
    if min_c is None:
        return True
    min_value = min_c * 9 / 5 + 32 if (unit or "").upper().endswith("F") else min_c
    return temp >= min_value


def _parse_local_hour(local_time_str: Optional[str]) -> Optional[int]:
    if not local_time_str:
        return None
    try:
        parts = local_time_str.strip().split(":")
        hour = int(parts[0])
        if 0 <= hour <= 23:
            return hour
    except Exception:
        pass
    return None


def _parse_utc_datetime(value: Any) -> Optional[datetime]:
    raw = str(value or "").strip()
    if not raw or "T" not in raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _metar_is_current_local_day(
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
    obs_dt = _parse_utc_datetime(metar.get("observation_time"))
    if obs_dt is None:
        return True
    local_dt = obs_dt.astimezone(timezone(timedelta(seconds=utc_offset)))
    return local_dt.strftime("%Y-%m-%d") == local_date


def _record_analysis_cache_event(*, city: str, hit: bool, force_refresh: bool) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _ANALYSIS_CACHE_STATS_LOCK:
        _ANALYSIS_CACHE_STATS["total_requests"] = int(_ANALYSIS_CACHE_STATS.get("total_requests") or 0) + 1
        _ANALYSIS_CACHE_STATS["last_city"] = city or ""
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


KOREAN_AMOS_CITIES = {"seoul", "busan"}


def _analysis_ttl_for_city(city: str) -> int:
    city_lower = city.lower()
    if city_lower in TURKISH_MGM_CITIES:
        return CACHE_TTL_ANKARA
    if city_lower in KOREAN_AMOS_CITIES:
        return CACHE_TTL_KOREAN_AMOS
    if city_lower in HIGH_FREQ_AIRPORT_ANALYSIS_CITIES:
        return 60
    return CACHE_TTL


def _analysis_cache_key(city: str, detail_mode: str = "full") -> str:
    normalized_raw = (detail_mode or "").strip().lower()
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
    with _CACHE_LOCK:
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
    taf_has_cloud_rain_cap = taf_suppression in {"medium", "high"} or taf_disruption in {
        "medium",
        "high",
    }

    structural_cap = False
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
        sync_status = str(lead_signal.get("leader_sync_status") or "").strip().lower()
        sync_delta = _sf(lead_signal.get("leader_time_delta_vs_anchor_minutes"))
        sync_suffix_zh = ""
        sync_suffix_en = ""
        if sync_status in {"near_realtime", "lagged"} and sync_delta is not None:
            sync_suffix_zh = f"；但与机场锚点约差 {sync_delta:.0f} 分钟，作为降权信号处理"
            sync_suffix_en = f"; timing differs from the airport anchor by about {sync_delta:.0f} minutes, so this signal is down-weighted"
        elif sync_status == "unknown":
            sync_suffix_zh = "；周边站观测时间不可完全校验，作为弱参考"
            sync_suffix_en = "; station timing is not fully verified, so this is treated as a weak reference"
        if airport_delta <= -0.4:
            support_score += 1
            _add_signal(
                signals,
                label="站网对比",
                label_en="Station-network comparison",
                direction="support",
                strength="weak" if sync_suffix_zh else "medium",
                summary=f"周边站网较机场锚点偏热 {abs(airport_delta):.1f}{unit}{f'，领先点位 {leader}' if leader else ''}{sync_suffix_zh}。",
                summary_en=f"Nearby stations are {abs(airport_delta):.1f}{unit} warmer than the airport anchor{f'; leading site: {leader}' if leader else ''}{sync_suffix_en}.",
            )
        elif airport_delta >= 0.4:
            suppress_score += 1
            _add_signal(
                signals,
                label="站网对比",
                label_en="Station-network comparison",
                direction="suppress",
                strength="weak" if sync_suffix_zh else "medium",
                summary=f"机场锚点较周边站网偏热 {abs(airport_delta):.1f}{unit}，继续上修需要机场自身后续报文确认{sync_suffix_zh}。",
                summary_en=f"The airport anchor is {abs(airport_delta):.1f}{unit} warmer than nearby stations; further upside needs confirmation from later airport reports{sync_suffix_en}.",
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
        structural_cap = any(
            signal.get("direction") == "suppress"
            and signal.get("label") in {"边界层结构", "站网对比", "日内节奏"}
            for signal in signals
        )
        if taf_has_cloud_rain_cap and structural_cap:
            headline = "峰值同时存在 TAF 云雨扰动和结构压制，当前更偏防守高温上修。"
            headline_en = "Both TAF cloud/rain disruption and structural signals are capping the peak; defend against aggressive high-temperature upside for now."
        elif taf_has_cloud_rain_cap:
            headline = "TAF 提示峰值窗口有云雨扰动，当前更偏防守高温上修。"
            headline_en = "TAF flags cloud/rain disruption near the peak window; defend against aggressive high-temperature upside for now."
        else:
            headline = "峰值主要受结构信号压制，TAF 云雨层暂未构成主压温理由。"
            headline_en = "The peak is mainly capped by structural signals; TAF cloud/rain is not the primary suppression reason for now."
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


def _archive_intraday_path_snapshot(city: str, result: Dict[str, Any]) -> None:
    """Persist replayable intraday path inputs visible at analysis time."""
    hourly = result.get("hourly") or {}
    times = hourly.get("times") if isinstance(hourly, dict) else []
    temps = hourly.get("temps") if isinstance(hourly, dict) else []
    if not isinstance(times, list) or not isinstance(temps, list) or not times:
        return

    forecast = result.get("forecast") or {}
    deb = result.get("deb") or {}
    current = result.get("current") or {}
    forecast_today_high = _sf(forecast.get("today_high"))
    deb_prediction = _sf(deb.get("prediction"))
    offset = (
        deb_prediction - forecast_today_high
        if deb_prediction is not None and forecast_today_high is not None
        else 0.0
    )
    deb_base_temps = [
        round(float(value) + offset, 1) if _sf(value) is not None else None
        for value in temps
    ]
    utc_offset = int(result.get("utc_offset_seconds") or 0)
    snapshot_time = datetime.now(timezone.utc).astimezone(
        timezone(timedelta(seconds=utc_offset))
    ).isoformat(timespec="seconds")
    payload = {
        "schema_version": 1,
        "city": city,
        "target_date": str(result.get("local_date") or "").strip(),
        "snapshot_time": snapshot_time,
        "local_time": str(result.get("local_time") or "").strip(),
        "utc_offset_seconds": utc_offset,
        "temp_symbol": result.get("temp_symbol"),
        "deb_prediction": deb_prediction,
        "forecast_today_high": forecast_today_high,
        "deb_base_path": {
            "times": [str(item) for item in times],
            "temps": deb_base_temps,
            "source": "hourly_plus_deb_offset",
            "offset": round(offset, 3),
        },
        "hourly": {
            "times": [str(item) for item in times],
            "temps": temps,
        },
        "metar_today_obs": result.get("metar_today_obs") or [],
        "settlement_today_obs": result.get("settlement_today_obs") or [],
        "current": {
            "temp": _sf(current.get("temp")),
            "max_so_far": _sf(current.get("max_so_far")),
            "obs_time": current.get("obs_time"),
            "settlement_source": current.get("settlement_source"),
            "settlement_source_label": current.get("settlement_source_label"),
        },
        "forecast": {
            "today_high": forecast_today_high,
            "sunrise": forecast.get("sunrise"),
            "sunset": forecast.get("sunset"),
        },
        "peak": result.get("peak") or {},
        "metar_status": result.get("metar_status") or {},
    }
    try:
        IntradayPathSnapshotRepository().append_snapshot(payload)
    except Exception as exc:
        logger.debug(f"intraday path snapshot archive skipped for {city}: {exc}")


def _analyze(
    city: str,
    force_refresh: bool = False,
    force_refresh_observations_only: bool = False,
    detail_mode: str = "full",
) -> Dict[str, Any]:
    """Fetch, analyse, and return structured weather data for one city.

    Set *force_refresh_observations_only* to True for high-frequency
    observation loops that need fresh METAR/AMOS/runway data but should
    keep the longer-lived multi-model forecast caches intact so the DEB
    blending does not fall back to the current observed temperature.
    """
    # Check cache – skip when explicitly refreshing observations
    ttl = _analysis_ttl_for_city(city)
    normalized_detail_mode_raw = (detail_mode or "full").strip().lower()
    if normalized_detail_mode_raw == "panel":
        normalized_detail_mode = "panel"
    elif normalized_detail_mode_raw == "market":
        normalized_detail_mode = "market"
    elif normalized_detail_mode_raw == "nearby":
        normalized_detail_mode = "nearby"
    else:
        normalized_detail_mode = "full"
    cache_key = _analysis_cache_key(city, normalized_detail_mode)

    if not force_refresh and not force_refresh_observations_only:
        cached = _cache.get(cache_key)
        if cached and _time.time() - cached["t"] < ttl:
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
        force_refresh_observations_only=force_refresh_observations_only,
        include_taf=not is_panel_mode and not is_nearby_mode and not is_market_mode,
        include_nearby=not is_panel_mode and not is_market_mode,
        include_ensemble=not is_panel_mode and not is_nearby_mode and not is_market_mode,
        include_multi_model=not is_nearby_mode,
        include_mgm=not is_market_mode,
    )
    om = raw.get("open-meteo", {})
    metar = raw.get("metar", {})
    taf = raw.get("taf", {})
    mgm = raw.get("mgm") or {}
    settlement_current = raw.get("settlement_current") or {}
    wunderground_current = raw.get("wunderground_current") or {}
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
    if not isinstance(wunderground_current, dict):
        wunderground_current = {}
    if not isinstance(ens_raw, dict):
        ens_raw = {}
    if not isinstance(mm, dict):
        mm = {}
    if not mm.get("hourly_times"):
        mm_hourly = _weather.fetch_multi_model(lat, lon, city=city, use_fahrenheit=is_f)
        if mm_hourly and mm_hourly.get("hourly_times"):
            mm = {**mm, **mm_hourly}
    raw["multi_model"] = mm
    risk = CITY_RISK_PROFILES.get(city, {})
    network_snapshot = (
        build_country_network_snapshot(city, raw)
        if _should_build_country_network_snapshot(
            city,
            raw,
            is_panel_mode=is_panel_mode,
            is_market_mode=is_market_mode,
        )
        else {}
    )

    # 优先从 API 获取偏移；若缺失则尝试 NWS 动态偏移；最后回退静态配置。
    # 当前日期/时间必须来自运行时钟，不能使用 Open-Meteo 缓存里的 local_time。
    utc_offset = om.get("utc_offset")
    if utc_offset is None:
        try:
            nws_periods = (raw.get("nws", {}) or {}).get("forecast_periods", []) or []
            if nws_periods:
                first_start = nws_periods[0].get("start_time")
                if first_start:
                    maybe_dt = datetime.fromisoformat(str(first_start))
                    offset_td = maybe_dt.utcoffset()
                    if offset_td is not None:
                        utc_offset = int(offset_td.total_seconds())
        except Exception:
            utc_offset = None
    if utc_offset is None:
        utc_offset = get_city_utc_offset_seconds(city)
    try:
        utc_offset = int(utc_offset or 0)
    except Exception:
        utc_offset = get_city_utc_offset_seconds(city)
    now_utc = datetime.now(timezone.utc)
    local_now = now_utc + timedelta(seconds=utc_offset)
    local_date_str = local_now.strftime("%Y-%m-%d")
    local_hour = local_now.hour
    local_minute = local_now.minute
    local_time_str = f"{local_hour:02d}:{local_minute:02d}"
    local_hour_frac = local_hour + local_minute / 60
    metar_current_is_today = _metar_is_current_local_day(
        metar,
        local_date=local_date_str,
        utc_offset=utc_offset,
    )

    # ── 2. Current conditions (settlement > AMOS runway sensors > METAR > MGM > NMC fallback) ──
    mc = metar.get("current", {}) if metar else {}
    mg_cur = mgm.get("current", {}) if mgm else {}
    sc_cur = settlement_current.get("current", {}) if settlement_current else {}
    amos_data = raw.get("amos") or {}
    if amos_data:
        logger.info("AMOS _analyze: found amos data for city={} temp_c={} source={}",
                    city, amos_data.get("temp_c"), amos_data.get("source"))
    use_settlement_current = settlement_source in {"hko", "cwa", "noaa", "wunderground"} and bool(sc_cur)
    live_mc = mc if metar_current_is_today else {}
    primary_current = sc_cur if use_settlement_current else live_mc
    current_source = settlement_source
    current_source_label = settlement_source_label
    current_station_code = settlement_current.get("station_code")
    current_station_name = settlement_current.get("station_name")
    cur_temp = _sf(primary_current.get("temp"))
    if cur_temp is not None and not _is_plausible_city_temp(city, cur_temp, sym):
        cur_temp = None
    # AMOS runway sensor: authoritative for Korean airports (RKSI/RKPK)
    if cur_temp is None:
        amos_temp = _sf(amos_data.get("temp_c"))
        if amos_temp is not None and _is_plausible_city_temp(city, amos_temp, sym):
            cur_temp = amos_temp
            current_source = "amos"
            current_source_label = amos_data.get("source_label") or "AMOS"
            current_station_code = amos_data.get("icao")
            current_station_name = amos_data.get("station_label")
    if cur_temp is None:
        cur_temp = _sf(live_mc.get("temp"))
        if cur_temp is not None and not _is_plausible_city_temp(city, cur_temp, sym):
            cur_temp = None
    # Official settlement station: e.g. CWA for Taipei, HKO for Hong Kong
    if cur_temp is None:
        cur_temp = _sf((settlement_current.get("current") or {}).get("temp"))
        if cur_temp is not None:
            current_source = settlement_source or "settlement"
            current_source_label = settlement_source_label or "Settlement Station"
            current_station_code = settlement_current.get("station_code") or current_station_code
            current_station_name = settlement_current.get("station_name") or current_station_name
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
        max_so_far = _sf(live_mc.get("max_temp_so_far"))
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
        max_temp_time = live_mc.get("max_temp_time")
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
    if not obs_t and metar_current_is_today:
        obs_t = metar.get("observation_time", "") if metar else ""
    if obs_t and "T" in obs_t:
        try:
            dt = _parse_utc_datetime(obs_t)
            if dt is None:
                raise ValueError("invalid observation time")
            local_dt = dt.astimezone(timezone(timedelta(seconds=utc_offset)))
            obs_time_str = local_dt.strftime("%H:%M")
            metar_age_min = int(
                (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds() / 60
            )
        except Exception:
            obs_time_str = str(obs_t)[:16]
    if not obs_time_str and current_source == "amos":
        amos_obs_time = amos_data.get("observation_time")
        if amos_obs_time:
            obs_time_str = _format_observation_time_local(amos_obs_time, utc_offset)
    nmc_fallback = None
    if not obs_time_str and current_source == "nmc":
        nmc_fallback = _fetch_nmc_current_fallback(city, use_fahrenheit=is_f)
        obs_time_str = _format_observation_time_local(
            nmc_fallback.get("publish_time") or nmc_fallback.get("timestamp"),
            utc_offset,
        )

    current_obs_raw = obs_t
    if current_source == "amos":
        current_obs_raw = amos_data.get("observation_time")
    elif current_source == "nmc":
        current_obs_raw = (
            nmc_fallback.get("publish_time")
            or nmc_fallback.get("timestamp")
            if isinstance(nmc_fallback, dict)
            else None
        )
    current_age_min = metar_age_min
    if current_obs_raw:
        current_age_min = _observation_age_min(current_obs_raw, now_utc) or current_age_min
    current_freshness = _build_observation_freshness(
        source_code=current_source,
        source_label=current_source_label,
        observed_at=current_obs_raw,
        observed_at_local=obs_time_str,
        ingested_at=primary_current.get("receipt_time") or primary_current.get("report_time"),
        age_min=current_age_min,
        now_utc=now_utc,
    )

    airport_source_code = amos_data.get("source") if current_source == "amos" else "metar"
    airport_source_code = airport_source_code or ("amos" if current_source == "amos" else "metar")
    airport_source_label = amos_data.get("source_label") if current_source == "amos" else "METAR"
    airport_source_label = airport_source_label or ("AMOS" if current_source == "amos" else "METAR")
    airport_obs_raw = amos_data.get("observation_time") if current_source == "amos" else (metar.get("observation_time") if metar else None)
    airport_age_min = _observation_age_min(airport_obs_raw, now_utc) if airport_obs_raw else metar_age_min
    if airport_age_min is None:
        airport_age_min = metar_age_min
    airport_temp = _sf(amos_data.get("temp_c")) if current_source == "amos" else _sf(live_mc.get("temp"))
    if airport_temp is not None and not _is_plausible_city_temp(city, airport_temp, sym):
        airport_temp = None
    airport_freshness = _build_observation_freshness(
        source_code=airport_source_code,
        source_label=airport_source_label,
        observed_at=airport_obs_raw,
        observed_at_local=obs_time_str,
        ingested_at=metar.get("receipt_time") if metar else None,
        age_min=airport_age_min,
        now_utc=now_utc,
    )

    airport_primary_current = dict(network_snapshot.get("airport_primary_current") or {})
    if (
        airport_primary_current.get("source_code") == "metar"
        and metar
        and not metar_current_is_today
    ):
        airport_primary_current["temp"] = None
        airport_primary_current["stale_for_today"] = True
        airport_primary_current["last_observation_local_date"] = metar.get("observation_local_date")
        airport_primary_current["current_local_date"] = local_date_str
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
                and max_temp_time != obs_time_str
            ):
                settlement_today_obs.append({"time": max_temp_time, "temp": max_so_far})

    metar_today_obs_payload = [
        {"time": t, "temp": v}
        for t, v in (
            metar.get("today_obs", []) if metar and metar_current_is_today else []
        )
        if _is_plausible_city_temp(city, v, sym)
    ]
    metar_recent_obs_payload = [
        point
        for point in (
            metar.get("recent_obs", []) if metar and metar_current_is_today else []
        )
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

    # ── 3. Daily forecast ──
    daily = om.get("daily", {})
    all_dates = daily.get("time", [])
    all_maxtemps = daily.get("temperature_2m_max", [])
    all_sunrises = daily.get("sunrise", [])
    all_sunsets = daily.get("sunset", [])
    all_sunshine = daily.get("sunshine_duration", [])

    start_idx = 0
    if local_date_str in all_dates:
        start_idx = all_dates.index(local_date_str)
    else:
        for idx, d in enumerate(all_dates):
            if d >= local_date_str:
                start_idx = idx
                break

    dates = all_dates[start_idx : start_idx + 5]
    maxtemps = all_maxtemps[start_idx : start_idx + 5]
    sunrises = all_sunrises[start_idx : start_idx + 5]
    sunsets = all_sunsets[start_idx : start_idx + 5]
    sunshine = all_sunshine[start_idx : start_idx + 5]
    om_today = _sf(maxtemps[0]) if maxtemps else None

    forecast_daily = _dedupe_forecast_daily(
        [{"date": d, "max_temp": t} for d, t in zip(dates, maxtemps)]
    )
    if om_today is None:
        nws_high = _sf(raw.get("nws", {}).get("today_high"))
        mgm_high = _sf(mgm.get("today_high")) if mgm else None
        mgm_hourly_high = _mgm_hourly_high(mgm)
        fallback_high = (
            nws_high
            if nws_high is not None
            else mgm_high
            if mgm_high is not None
            else mgm_hourly_high
            if mgm_hourly_high is not None
            else max_so_far
            if max_so_far is not None
            else cur_temp
        )
        if fallback_high is not None:
            om_today = fallback_high
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
            temp_val = _sf(v)
            if temp_val is not None:
                current_forecasts[m] = temp_val
    nws_high = _sf(raw.get("nws", {}).get("today_high"))
    if nws_high is not None:
        current_forecasts["NWS"] = nws_high
    mgm_high = _sf(mgm.get("today_high")) if mgm else None
    mgm_hourly_high = _mgm_hourly_high(mgm)
    if mgm_high is not None:
        current_forecasts["MGM"] = mgm_high
    elif mgm_hourly_high is not None:
        current_forecasts["MGM Hourly"] = mgm_hourly_high

    # ── 6. DEB fusion ──
    deb_val, deb_weights = None, ""
    deb_raw_val, deb_version = None, None
    deb_bias_adjustment, deb_bias_samples = 0.0, 0
    deb_intraday_adjustment = 0.0
    deb_hourly_consensus = None
    if current_forecasts:
        deb_result = calculate_deb_prediction(city, current_forecasts)
        if deb_result.get("prediction") is not None:
            deb_val = deb_result.get("prediction")
            deb_raw_val = deb_result.get("raw_prediction")
            deb_version = deb_result.get("version")
            deb_bias_adjustment = deb_result.get("bias_adjustment") or 0.0
            deb_bias_samples = deb_result.get("bias_samples") or 0
            deb_weights = deb_result.get("weights_info") or ""
            deb_hourly_consensus = build_deb_hourly_consensus_path(
                city=city,
                hourly_times=mm.get("hourly_times") or [],
                hourly_forecasts=mm.get("hourly_forecasts") or {},
                daily_forecasts=current_forecasts,
                deb_prediction=deb_val,
                local_date=local_date_str,
            )

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

    peak_source = raw
    if deb_hourly_consensus:
        peak_source = {
            **raw,
            "deb": {
                **(raw.get("deb") or {}),
                "hourly_consensus": deb_hourly_consensus,
            },
        }
    peak_hours = _resolve_peak_hours(peak_source, local_date_str, h_times, h_temps, om_today)

    first_peak_h = int(peak_hours[0].split(":")[0]) if peak_hours else 13
    last_peak_h = int(peak_hours[-1].split(":")[0]) if peak_hours else 15

    if local_hour_frac > last_peak_h:
        peak_status = "past"
    elif first_peak_h <= local_hour_frac <= last_peak_h:
        peak_status = "in_window"
    else:
        peak_status = "before"

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
    probabilities_all = []
    mu = None
    dynamic_commentary = {"summary": "", "notes": []}
    try:
        _, _ai_context, sd = _trend_analyze(raw, sym, city)

        mu = sd.get("mu")
        probabilities = sd.get("probabilities", [])
        probabilities_all = sd.get("probabilities_all", probabilities)
        dynamic_commentary = sd.get("dynamic_commentary") or dynamic_commentary
        trend_info["is_dead_market"] = sd.get("trend_info", {}).get("is_dead_market", False)
        trend_info["direction"] = sd.get("trend_info", {}).get("direction", trend_info.get("direction", "unknown"))
        trend_info["is_cooling"] = sd.get("trend_info", {}).get("is_cooling", False)
        peak_status = sd.get("peak_status", peak_status)

        # Use shared DEB if not already set
        if deb_val is None and sd.get("deb_prediction") is not None:
            deb_val = sd["deb_prediction"]
            deb_raw_val = sd.get("deb_raw_prediction") or deb_val
            deb_version = sd.get("deb_version")
            deb_bias_adjustment = sd.get("deb_bias_adjustment") or 0.0
            deb_bias_samples = sd.get("deb_bias_samples") or 0
            deb_weights = sd.get("deb_weights", "")
        if deb_hourly_consensus is None and sd.get("deb_hourly_consensus"):
            deb_hourly_consensus = sd.get("deb_hourly_consensus")

    except Exception as e:
        logger.warning(f"Structured analysis skipped for {city}: {e}")

    # ── 12. Hourly data (today only, for chart) ──
    today_hourly: Dict[str, list] = {"times": [], "temps": [], "radiation": []}
    for i, ts in enumerate(h_times):
        if ts.startswith(local_date_str):
            today_hourly["times"].append(ts.split("T")[1][:5])
            today_hourly["temps"].append(h_temps[i] if i < len(h_temps) else None)
            today_hourly["radiation"].append(h_rad[i] if i < len(h_rad) else None)

    # ── 12a-b. Intraday bias correction ──────────────────────────────────
    # Nudge the DEB high-temp forecast and probability mu using the gap
    # between the current observed temperature and the model's hourly path.
    # Uses cur_temp / max_so_far already resolved at lines 1052-1095 above.
    _local_hour = _parse_local_hour(local_time_str)
    peak_first = first_peak_h or 14
    peak_last_h = last_peak_h or 17

    if (
        deb_val is not None
        and cur_temp is not None
        and _local_hour is not None
        and 6 <= _local_hour <= 22
    ):
        hourly_times_list = today_hourly.get("times") or []
        hourly_temps_list = today_hourly.get("temps") or []
        model_hourly_temp = None
        current_hour_str = f"{_local_hour:02d}:00"
        for idx, t_str in enumerate(hourly_times_list):
            if str(t_str or "").startswith(current_hour_str) and idx < len(hourly_temps_list):
                candidate = _sf(hourly_temps_list[idx])
                if candidate is not None:
                    model_hourly_temp = candidate
                    break
        reference_temp = model_hourly_temp if model_hourly_temp is not None else cur_temp
        if reference_temp is not None:
            hourly_bias = cur_temp - reference_temp

            if _local_hour < peak_first:
                progress = max(0.0, (_local_hour - 6) / max(1, peak_first - 6))
                weight = 0.15 + 0.20 * progress
            elif peak_first <= _local_hour <= peak_last_h:
                progress = (_local_hour - peak_first) / max(1, peak_last_h - peak_first)
                weight = 0.40 + 0.35 * progress
            else:
                weight = 0.80

            max_correction = 5.0 if str(sym or "").upper() == "F" else 3.0
            hourly_correction = max(-max_correction, min(max_correction, hourly_bias * weight))

            _msf = max_so_far if max_so_far is not None else cur_temp
            max_so_far_excess = _msf - deb_val
            max_correction_clamped = max(-max_correction, min(max_correction, max_so_far_excess * max(0.3, weight)))

            blended_correction = hourly_correction * 0.6 + max_correction_clamped * 0.4
            deb_intraday_adjustment = round(blended_correction, 1)
            deb_val = round(deb_val + blended_correction, 1)
            if mu is not None:
                mu = round(mu + blended_correction, 1)
            deb_weights = f"{deb_weights or 'DEB'} + intraday_bias({deb_intraday_adjustment:+.1f})"

    deb_hourly_path = None
    deb_base_source = "hourly_plus_deb_offset"
    deb_base_times = [str(item) for item in today_hourly.get("times") or []]
    deb_base_temps = today_hourly.get("temps") or []
    if isinstance(deb_hourly_consensus, dict):
        consensus_times = deb_hourly_consensus.get("times") or []
        consensus_temps = deb_hourly_consensus.get("temps") or []
        if consensus_times and consensus_temps:
            deb_base_source = "deb_hourly_consensus"
            deb_base_times = [str(item) for item in consensus_times]
            deb_base_temps = consensus_temps
    if deb_val is not None and deb_base_times and deb_base_temps:
        try:
            deb_hourly_path = build_deb_hourly_path(
                city=city,
                hourly_times=deb_base_times,
                hourly_temps=deb_base_temps,
                deb_prediction=deb_val,
                peak_first_h=first_peak_h,
                peak_last_h=last_peak_h,
                corrector=get_cached_hourly_peak_corrector(),
                base_source=deb_base_source,
            )
        except Exception as exc:
            logger.debug(f"DEB hourly path correction skipped for {city}: {exc}")

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
            utc_offset,
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
        d_probs = []
        d_probs_all = []
        if i == 0:
            day_m = current_forecasts.copy()
            d_val, d_winfo = deb_val, deb_weights
            d_raw_val = deb_raw_val
            d_version = deb_version
            d_bias_adjustment = deb_bias_adjustment
            d_bias_samples = deb_bias_samples
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
            d_raw_val, d_version = None, None
            d_bias_adjustment, d_bias_samples = 0.0, 0
            d_probs = []
            d_probs_all = []
            if day_m:
                try:
                    deb_result = calculate_deb_prediction(city, day_m)
                    d_prediction = _sf(deb_result.get("prediction"))
                    if d_prediction is not None:
                        d_val = d_prediction
                        d_raw_val = deb_result.get("raw_prediction")
                        d_version = deb_result.get("version")
                        d_bias_adjustment = deb_result.get("bias_adjustment") or 0.0
                        d_bias_samples = deb_result.get("bias_samples") or 0
                        d_winfo = deb_result.get("weights_info") or ""
                        
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
                        d_probs_all = prob_obj.get("probabilities_all", d_probs)
                except Exception:
                    pass
        
        if day_m:
            multi_model_daily[d_str] = {
                "models": day_m,
                "deb": {
                    "prediction": d_val,
                    "raw_prediction": d_raw_val,
                    "version": d_version,
                    "weights_info": d_winfo,
                    "bias_adjustment": d_bias_adjustment,
                    "bias_samples": d_bias_samples,
                },
                "probabilities": d_probs if i > 0 else probabilities, # Use today's real prob for today
                "probabilities_all": d_probs_all if i > 0 else probabilities_all,
            }

    # ── Assemble result ──
    runway_plate_history = {}
    icao = risk.get("icao", "")
    if isinstance(icao, str) and icao:
        try:
            from src.database.db_manager import DBManager
            raw_runway_obs = DBManager().get_runway_obs_recent(icao, minutes=36 * 60)
            for r in raw_runway_obs:
                rw = r.get("runway")
                if not rw:
                    continue
                temp_val = _runway_history_temp_for_city(city, r)
                if temp_val is not None:
                    if is_f:
                        temp_val = round(temp_val * 9.0 / 5.0 + 32.0, 1)
                    else:
                        temp_val = round(temp_val, 1)
                
                time_val = r.get("otime_utc") or r.get("created_at")
                if not time_val:
                    continue
                
                if rw not in runway_plate_history:
                    runway_plate_history[rw] = []
                runway_plate_history[rw].append({
                    "time": time_val,
                    "temp": temp_val
                })
        except Exception:
            logger.exception("Failed to fetch runway plate history for icao={}", icao)

    city_meta = CITIES.get(city, {}) or {}
    result = {
        "runway_plate_history": runway_plate_history,
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
        "utc_offset_seconds": utc_offset,
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
            "source_code": current_source,
            "settlement_source": current_source,
            "settlement_source_label": current_source_label,
            "station_code": current_station_code,
            "station_name": current_station_name,
            "obs_time": obs_time_str,
            "obs_age_min": None if use_settlement_current else metar_age_min,
            "freshness": current_freshness,
            "observation_status": "live" if cur_temp is not None else "missing",
            "report_time": primary_current.get("report_time"),
            "receipt_time": primary_current.get("receipt_time"),
            "obs_time_epoch": primary_current.get("obs_time_epoch"),
            "wind_speed_kt": _sf(amos_data.get("wind_kt")) if current_source == "amos" else _sf(primary_current.get("wind_speed_kt")),
            "wind_dir": _sf(primary_current.get("wind_dir")),
            "humidity": _sf(primary_current.get("humidity")),
            "pressure_hpa": _sf(amos_data.get("pressure_hpa")) if current_source == "amos" else _sf(primary_current.get("pressure_hpa")),
            "cloud_desc": cloud_desc,
            "clouds_raw": [
                {"cover": c.get("cover"), "base": c.get("base")} for c in clouds
            ],
            "visibility_mi": _sf(primary_current.get("visibility_mi")),
            "wx_desc": primary_current.get("wx_desc"),
            "raw_metar": amos_data.get("raw_metar") if current_source == "amos" else primary_current.get("raw_metar"),
        },
        "airport_current": {
            "temp": airport_temp,
            "obs_time": obs_time_str,
            "max_so_far": airport_max_so_far,
            "max_temp_time": airport_max_temp_time,
            "obs_age_min": airport_age_min,
            "report_time": metar.get("report_time") if metar else None,
            "receipt_time": metar.get("receipt_time") if metar else None,
            "obs_time_epoch": metar.get("obs_time_epoch") if metar else None,
            "wind_speed_kt": _sf(amos_data.get("wind_kt")) if current_source == "amos" else _sf(live_mc.get("wind_speed_kt")),
            "wind_dir": _sf(live_mc.get("wind_dir")),
            "humidity": _sf(live_mc.get("humidity")),
            "cloud_desc": metar.get("cloud_desc") if metar else None,
            "visibility_mi": _sf(live_mc.get("visibility_mi")),
            "wx_desc": live_mc.get("wx_desc"),
            "raw_metar": amos_data.get("raw_metar") if current_source == "amos" else live_mc.get("raw_metar"),
            "source_code": airport_source_code,
            "source_label": airport_source_label,
            "freshness": airport_freshness,
            "stale_for_today": False if current_source == "amos" else (bool(metar) and not metar_current_is_today),
            "last_observation_local_date": metar.get("observation_local_date") if metar else None,
            "current_local_date": local_date_str,
        },
        "wunderground_current": wunderground_current,
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
        "amos": amos_data if amos_data and amos_data.get("source") else None,
        "forecast": {
            "today_high": om_today,
            "daily": forecast_daily,
            "sunrise": sunrise,
            "sunset": sunset,
            "sunshine_hours": sunshine_h,
        },
        "source_forecasts": {
            "weather_gov": raw.get("nws") or {},
            "open_meteo_multi_model": {
                "source": mm.get("source"),
                "provider": mm.get("provider"),
                "dates": mm.get("dates") or [],
                "model_metadata": mm.get("model_metadata") or {},
                "model_keys": mm.get("model_keys") or {},
                "attribution": mm.get("attribution"),
            } if isinstance(mm, dict) and mm else {},
        },
        "multi_model": {
            **mm,
            "forecasts": {k: v for k, v in current_forecasts.items() if v is not None},
        },
        "multi_model_daily": multi_model_daily,
        "deb": {
            "prediction": deb_val,
            "raw_prediction": deb_raw_val,
            "version": deb_version,
            "weights_info": deb_weights,
            "bias_adjustment": deb_bias_adjustment,
            "bias_samples": deb_bias_samples,
            "intraday_adjustment": deb_intraday_adjustment,
            "hourly_consensus": deb_hourly_consensus,
            "hourly_path": deb_hourly_path,
            "hourly_correction": (deb_hourly_path or {}).get("correction") if isinstance(deb_hourly_path, dict) else None,
        },
        "deviation_monitor": deviation_monitor,
        "ensemble": ens_data,
        "probabilities": {
            "mu": round(mu, 1) if mu is not None else None,
            "distribution": probabilities,
            "distribution_all": probabilities_all or probabilities,
            "engine": "legacy",
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
        "metar_status": {
            "available_for_today": metar_current_is_today,
            "stale_for_today": bool(metar) and not metar_current_is_today,
            "last_observation_time": metar.get("observation_time") if metar else None,
            "last_observation_local_date": metar.get("observation_local_date") if metar else None,
            "current_local_date": local_date_str,
            "last_temp": _sf(mc.get("temp")) if mc else None,
        },
        "settlement_today_obs": settlement_today_obs,
        "ai_analysis": "",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    result["intraday_meteorology"] = _build_intraday_meteorology(result)
    if normalized_detail_mode == "full":
        _archive_intraday_path_snapshot(city, result)

    with _CACHE_LOCK:
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

    default_utc_offset = get_city_utc_offset_seconds(city)

    def _safe_call(fn):
        try:
            return fn()
        except Exception:
            return None

    jobs: Dict[str, Any] = {
        "settlement_current": lambda: _weather.fetch_settlement_current(city) or {},
        "wunderground_current": lambda: _weather.fetch_wunderground_historical(
            city,
            use_fahrenheit=is_f,
            utc_offset=default_utc_offset,
        ) or {},
        "open_meteo": lambda: _weather.fetch_from_open_meteo(lat, lon, use_fahrenheit=is_f) or {},
        "multi_model": lambda: _weather.fetch_multi_model(lat, lon, city=city, use_fahrenheit=is_f) or {},
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
    wunderground_current = fetched.get("wunderground_current") or {}
    open_meteo = fetched.get("open_meteo") or {}
    mm = fetched.get("multi_model") or {}
    if not isinstance(wunderground_current, dict):
        wunderground_current = {}
    utc_offset = open_meteo.get("utc_offset")
    if utc_offset is None:
        utc_offset = default_utc_offset
    try:
        utc_offset = int(utc_offset or 0)
    except Exception:
        utc_offset = default_utc_offset
    now_utc = datetime.now(timezone.utc)
    local_now = now_utc + timedelta(seconds=utc_offset)
    local_date_str = local_now.strftime("%Y-%m-%d")
    local_hour = local_now.hour
    local_minute = local_now.minute
    local_time_str = f"{local_hour:02d}:{local_minute:02d}"
    local_hour_frac = local_hour + local_minute / 60.0
    metar = fetched.get("metar") or {}
    mgm = fetched.get("mgm") or {}
    nws = fetched.get("nws") or {}
    hko_forecast = fetched.get("hko_forecast")
    metar_current_is_today = _metar_is_current_local_day(
        metar,
        local_date=local_date_str,
        utc_offset=utc_offset,
    )

    sc_cur = settlement_current.get("current") or {}
    mc = metar.get("current") or {}
    live_mc = mc if metar_current_is_today else {}
    mg_cur = mgm.get("current") or {}
    use_settlement_current = settlement_source in {"hko", "cwa", "noaa", "wunderground"} and bool(sc_cur)
    primary_current = sc_cur if use_settlement_current else live_mc

    current_source = settlement_source
    current_source_label = settlement_source_label
    nmc_fallback: Dict[str, Any] = {}
    cur_temp = _sf(primary_current.get("temp"))
    if cur_temp is not None and not _is_plausible_city_temp(city, cur_temp, sym):
        cur_temp = None
    if cur_temp is None:
        cur_temp = _sf(live_mc.get("temp"))
        if cur_temp is not None and not _is_plausible_city_temp(city, cur_temp, sym):
            cur_temp = None
    if cur_temp is None:
        cur_temp = _sf((settlement_current.get("current") or {}).get("temp"))
        if cur_temp is not None:
            current_source = settlement_source or "settlement"
            current_source_label = settlement_source_label or "Settlement Station"
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
        max_so_far = _sf(live_mc.get("max_temp_so_far"))
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
        max_temp_time = live_mc.get("max_temp_time")
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
    if not obs_t and metar_current_is_today:
        obs_t = str(metar.get("observation_time") or "").strip()
    if obs_t and "T" in obs_t:
        try:
            dt = _parse_utc_datetime(obs_t)
            if dt is None:
                raise ValueError("invalid observation time")
            local_dt = dt.astimezone(timezone(timedelta(seconds=utc_offset)))
            obs_time_str = local_dt.strftime("%H:%M")
            obs_age_min = int(
                (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds() / 60
            )
        except Exception:
            obs_time_str = obs_t[:16]
    if not obs_time_str and current_source == "nmc":
        if not nmc_fallback:
            nmc_fallback = _fetch_nmc_current_fallback(city, use_fahrenheit=is_f)
        obs_time_str = _format_observation_time_local(
            nmc_fallback.get("publish_time") or nmc_fallback.get("timestamp"),
            utc_offset,
        )

    om_daily = (open_meteo.get("daily") or {}) if isinstance(open_meteo, dict) else {}
    om_hourly = (open_meteo.get("hourly") or {}) if isinstance(open_meteo, dict) else {}

    all_dates = om_daily.get("time", [])
    all_maxtemps = om_daily.get("temperature_2m_max", [])

    start_idx = 0
    if local_date_str in all_dates:
        start_idx = all_dates.index(local_date_str)
    else:
        for idx, d in enumerate(all_dates):
            if d >= local_date_str:
                start_idx = idx
                break

    maxtemps = all_maxtemps[start_idx : start_idx + 5]
    om_today = _sf(maxtemps[0]) if maxtemps else None
    nws_high = _sf((nws or {}).get("today_high")) if isinstance(nws, dict) else None
    mgm_high = _sf((mgm or {}).get("today_high")) if isinstance(mgm, dict) else None
    mgm_hourly_high = _mgm_hourly_high(mgm)

    if om_today is None:
        fallback_high = (
            nws_high
            if nws_high is not None
            else mgm_high
            if mgm_high is not None
            else mgm_hourly_high
            if mgm_hourly_high is not None
            else max_so_far
            if max_so_far is not None
            else cur_temp
        )
        if fallback_high is not None:
            om_today = fallback_high

    current_forecasts: Dict[str, float] = {}
    if om_today is not None:
        current_forecasts["Open-Meteo"] = om_today
    for m, v in mm.get("forecasts", {}).items():
        if v is not None and not _is_excluded_model_name(m):
            temp_val = _sf(v)
            if temp_val is not None:
                current_forecasts[m] = temp_val
    if nws_high is not None:
        current_forecasts["NWS"] = nws_high
    if mgm_high is not None:
        current_forecasts["MGM"] = mgm_high
    elif mgm_hourly_high is not None:
        current_forecasts["MGM Hourly"] = mgm_hourly_high
    if hko_forecast is not None:
        temp_hko = _sf(hko_forecast)
        if temp_hko is not None:
            current_forecasts["HKO"] = temp_hko
    current_forecasts = {
        model_name: value
        for model_name, value in current_forecasts.items()
        if value is not None and not _is_excluded_model_name(model_name)
    }

    deb_val = None
    deb_raw_val = None
    deb_version = None
    deb_bias_adjustment = 0.0
    deb_bias_samples = 0
    if current_forecasts:
        deb_result = calculate_deb_prediction(city, current_forecasts)
        if deb_result.get("prediction") is not None:
            deb_val = deb_result.get("prediction")
            deb_raw_val = deb_result.get("raw_prediction")
            deb_version = deb_result.get("version")
            deb_bias_adjustment = deb_result.get("bias_adjustment") or 0.0
            deb_bias_samples = deb_result.get("bias_samples") or 0
    if deb_val is None:
        deb_val = om_today

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
        if max_temp_time and max_so_far is not None and max_temp_time != obs_time_str:
            settlement_today_obs.append({"time": max_temp_time, "temp": max_so_far})

    metar_today_obs_payload = [
        {"time": obs_time, "temp": obs_temp}
        for obs_time, obs_temp in (
            (metar.get("today_obs") or [])
            if isinstance(metar, dict) and metar_current_is_today
            else []
        )
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
        "utc_offset_seconds": utc_offset,
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
            "observation_status": "live" if cur_temp is not None else "missing",
        },
        "wunderground_current": wunderground_current,
        "deb": {
            "prediction": _sf(deb_val),
            "raw_prediction": _sf(deb_raw_val),
            "version": deb_version,
            "bias_adjustment": deb_bias_adjustment,
            "bias_samples": deb_bias_samples,
        },
        "deviation_monitor": deviation_monitor or {},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    _set_cached_summary(city, result)
    return result


def _build_city_summary_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    return _city_payload_summary(data)




def _build_city_detail_payload(
    data: Dict[str, Any],
    market_slug: Optional[str] = None,
    target_date: Optional[str] = None,
    resolution: Optional[str] = "10m",
) -> Dict[str, Any]:
    return _city_payload_detail(
        data,
        market_slug=market_slug,
        target_date=target_date,
        resolution=resolution,
    )



# ──────────────────────────────────────────────────────────
#  Routes
# ──────────────────────────────────────────────────────────

def _build_city_market_scan_payload(
    data,
    market_slug=None,
    target_date=None,
    lite=False,
    scan_filters=None,
):
    local_date = str(data.get("local_date") or "").strip()
    return {
        "market_scan": {"available": False},
        "selected_date": target_date or local_date,
        "fetched_at": data.get("updated_at"),
    }
