from __future__ import annotations

import json
import os
import re
import threading
import time
import hashlib
from concurrent.futures import TimeoutError as FutureTimeoutError
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any, Dict, Iterator, List, Optional

import httpx
from loguru import logger

from web.analysis_service import _analyze
from web.core import CITIES
from src.data_collection.city_registry import ALIASES
from web.scan_city_ai_fallback import (
    _build_city_ai_fallback,
    _complete_city_ai_payload,
)
from web.scan_city_ai_helpers import (
    _extract_ai_json_object,
    _extract_provider_stream_delta,
    _provider_response_meta,
    _safe_float,
)
from web.scan_city_ai_prompt import (
    SCAN_CITY_AI_PROMPT_VERSION,
    build_city_ai_stream_request,
)
from web.scan_city_ai_provider import (
    _call_deepseek_city_ai as _call_deepseek_city_ai_provider,
)
from web.scan_terminal_cache import (
    clear_scan_terminal_refreshing,
    get_cached_scan_ai_result,
    get_cached_scan_terminal_payload,
    get_scan_terminal_cache_entry,
    mark_scan_terminal_refreshing,
    set_cached_scan_ai_result,
    set_cached_scan_terminal_payload,
    set_scan_terminal_failure_state,
)
from web.scan_terminal_city_row import _scan_city_terminal_rows
from web.scan_terminal_ai_compact import (
    _build_metar_decision_context,
    _city_observation_anchor,
    _compact_hourly_context,
    _compact_intraday_context,
    _compact_observation_points,
    _compact_taf_context,
    _compact_vertical_context,
    build_scan_ai_prompt,
)
from web.scan_terminal_ai_merge import _normalize_ai_items, merge_scan_ai_result
from web.scan_terminal_filters import (
    normalize_scan_terminal_filters as _normalize_scan_terminal_filters,
)
from web.scan_terminal_payloads import (
    build_failed_scan_terminal_payload,
    build_scan_terminal_snapshot_id,
    build_stale_scan_terminal_payload,
)
from web.scan_terminal_ranker import build_ranked_scan_terminal_result

_SCAN_CITY_AI_CACHE_LOCK = threading.Lock()
_SCAN_CITY_AI_CACHE: Dict[str, Dict[str, Any]] = {}


def _env_int(
    name: str,
    default: int,
    *,
    min_value: int,
    max_value: Optional[int] = None,
) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except Exception:
        value = int(default)
    value = max(int(min_value), value)
    if max_value is not None:
        value = min(int(max_value), value)
    return value


SCAN_TERMINAL_PAYLOAD_TTL_SEC = max(
    5,
    int(os.getenv("POLYWEATHER_SCAN_TERMINAL_PAYLOAD_TTL_SEC", "30")),
)
SCAN_TERMINAL_BUILD_TIMEOUT_SEC = max(
    8,
    int(os.getenv("POLYWEATHER_SCAN_TERMINAL_BUILD_TIMEOUT_SEC", "22")),
)
DEFAULT_SCAN_AI_MODEL = "mimo-v2.5-pro"
DEFAULT_SCAN_AI_BASE_URL = "https://token-plan-cn.xiaomimimo.com/v1"
SCAN_AI_API_KEY_ENV_HINT = (
    "POLYWEATHER_SCAN_AI_API_KEY "
    "(or POLYWEATHER_MIMO_API_KEY / POLYWEATHER_DEEPSEEK_API_KEY)"
)


def _env_str(*names: str, default: str = "") -> str:
    for name in names:
        value = str(os.getenv(name) or "").strip()
        if value:
            return value
    return str(default).strip()


def _scan_ai_api_key() -> str:
    return _env_str(
        "POLYWEATHER_SCAN_AI_API_KEY",
        "POLYWEATHER_MIMO_API_KEY",
        "POLYWEATHER_DEEPSEEK_API_KEY",
    )


def _infer_scan_ai_provider(base_url: str, model: str) -> str:
    text = f"{base_url} {model}".lower()
    if "xiaomimimo" in text or "mimo" in text:
        return "mimo"
    if "deepseek" in text:
        return "deepseek"
    return "openai-compatible"


def _scan_ai_provider_label(provider: str) -> str:
    normalized = provider.strip().lower()
    if normalized == "mimo":
        return "MiMo"
    if normalized == "deepseek":
        return "DeepSeek"
    return "AI provider"


SCAN_AI_MODEL = _env_str("POLYWEATHER_SCAN_AI_MODEL", default=DEFAULT_SCAN_AI_MODEL)
SCAN_CITY_AI_MODEL = _env_str(
    "POLYWEATHER_SCAN_CITY_AI_MODEL",
    "POLYWEATHER_SCAN_AI_MODEL",
    default=SCAN_AI_MODEL or DEFAULT_SCAN_AI_MODEL,
)
SCAN_AI_BASE_URL = _env_str(
    "POLYWEATHER_SCAN_AI_BASE_URL",
    "POLYWEATHER_MIMO_BASE_URL",
    "POLYWEATHER_DEEPSEEK_BASE_URL",
    default=DEFAULT_SCAN_AI_BASE_URL,
).rstrip("/")
SCAN_AI_PROVIDER = _env_str(
    "POLYWEATHER_SCAN_AI_PROVIDER",
    default=_infer_scan_ai_provider(SCAN_AI_BASE_URL, SCAN_CITY_AI_MODEL),
)
SCAN_AI_PROVIDER_LABEL = _env_str(
    "POLYWEATHER_SCAN_AI_PROVIDER_LABEL",
    default=_scan_ai_provider_label(SCAN_AI_PROVIDER),
)
SCAN_AI_ENABLED = str(
    os.getenv("POLYWEATHER_SCAN_AI_ENABLED") or "false"
).strip().lower() in {"1", "true", "yes", "on"}
SCAN_AI_TIMEOUT_SEC = _env_int(
    "POLYWEATHER_SCAN_AI_TIMEOUT_SEC",
    40,
    min_value=10,
    max_value=120,
)
SCAN_CITY_AI_TIMEOUT_SEC = _env_int(
    "POLYWEATHER_SCAN_CITY_AI_TIMEOUT_SEC",
    30,
    min_value=10,
    max_value=120,
)
SCAN_CITY_AI_RETRY_ON_STREAM_PARSE_ERROR = str(
    os.getenv("POLYWEATHER_SCAN_CITY_AI_RETRY_ON_STREAM_PARSE_ERROR") or "false"
).strip().lower() in {"1", "true", "yes", "on"}
SCAN_AI_CACHE_TTL_SEC = max(
    30,
    int(os.getenv("POLYWEATHER_SCAN_AI_CACHE_TTL_SEC", "1800")),
)
SCAN_AI_MAX_ROWS = _env_int("POLYWEATHER_SCAN_AI_MAX_ROWS", 40, min_value=1)
SCAN_AI_MAX_TOKENS = _env_int(
    "POLYWEATHER_SCAN_AI_MAX_TOKENS",
    3200,
    min_value=600,
    max_value=64000,
)
SCAN_CITY_AI_MAX_TOKENS = _env_int(
    "POLYWEATHER_SCAN_CITY_AI_MAX_TOKENS",
    650,
    min_value=300,
    max_value=64000,
)
SCAN_CITY_AI_STREAM_MAX_TOKENS = _env_int(
    "POLYWEATHER_SCAN_CITY_AI_STREAM_MAX_TOKENS",
    min(SCAN_CITY_AI_MAX_TOKENS, 650),
    min_value=300,
    max_value=64000,
)


def _normalize_locale(value: Any) -> str:
    text = str(value or "").strip().lower()
    return "en-US" if text.startswith("en") else "zh-CN"


def _normalize_city_key(value: Any) -> str:
    text = str(value or "").strip().lower().replace("-", " ")
    text = re.sub(r"\s+", " ", text)
    return ALIASES.get(text, text)


def _start_scan_terminal_background_refresh(filters: Dict[str, Any]) -> bool:
    if not mark_scan_terminal_refreshing(filters):
        return False

    def _runner() -> None:
        try:
            _build_scan_terminal_payload_uncached(filters, force_refresh=True)
        except Exception as exc:  # pragma: no cover - defensive background guard
            logger.warning("scan terminal background refresh failed: {}", exc)
        finally:
            clear_scan_terminal_refreshing(filters)

    thread = threading.Thread(
        target=_runner,
        name="polyweather-scan-terminal-refresh",
        daemon=True,
    )
    thread.start()
    return True


def _call_deepseek_scan_ai(ai_input: Dict[str, Any]) -> Dict[str, Any]:
    api_key = _scan_ai_api_key()
    if not api_key:
        raise RuntimeError(f"{SCAN_AI_API_KEY_ENV_HINT} is not configured")

    system_prompt = (
        "你是 PolyWeather 的付费 V4-Pro 城市最高温预测员。你只能基于用户提供的 JSON 快照做判断，"
        "不得编造城市、价格、概率、盘口或天气数据。输入已经按城市分组，每城包含 DEB、"
        "多个天气模型预测值 model_cluster.sources、METAR 实测序列、机场原始报文和候选合约。"
        "你的首要任务不是分析套利，也不是推荐 BUY YES/NO，而是预测该城市今日最终最高温是多少。"
        "必须输出城市级最高温点估计、置信区间、置信度、峰值窗口状态、机场报文解读和一句预测理由。"
        "V4 禁止使用 EMOS、EMOS peak、EMOS probability、edge 或 Kelly 作为交易依据；"
        "最高温预测必须直接参考该城市全部 model_cluster.sources、DEB、峰值窗口和 METAR/机场报文。"
        "如果天气模型之间分歧大，必须放宽置信区间并降低 confidence；如果 METAR 与模型路径冲突，必须解释修正方向。"
        "必须先判断 peak_window_label、minutes_until_peak_start/end 和 window_phase：峰值窗口尚未到来时，"
        "不能因为 METAR 暂未触达目标温度就下最终结论，只能说明仍需峰值窗口验证；"
        "必须检查 metar_context 的 today_obs/recent_obs、max_temp、last_temp、trend_delta、"
        "airport_raw_metar、airport_wx_desc、airport_cloud_desc、airport_wind_* 和 stale 状态；"
        "合约只作为下游映射：可以为每个候选 row_id 给出 forecast_match（core/edge/outside/watch）和一句原因，"
        "但不要输出交易建议，不要使用套利、仓位、edge 或 Kelly 语言。必须输出 JSON object。"
    )
    model_snapshot = dict(ai_input)
    model_snapshot.pop("_polyweather_input_meta", None)
    user_payload = {
        "task": (
            "Return strict JSON only with: summary_zh, summary_en, city_forecasts, contract_notes. "
            "city_forecasts items require city, predicted_max, range_low, range_high, unit, confidence, "
            "peak_window_zh, peak_window_en, metar_read_zh, metar_read_en, reasoning_zh, reasoning_en, model_cluster_note. "
            "contract_notes items are optional and require row_id, forecast_match, reason_zh, reason_en; "
            "forecast_match must be one of core, edge, outside, watch. "
            "Focus on final max temperature prediction; do not output recommendations/vetoed/downgraded unless needed for backward compatibility. "
            "Do not mention EMOS, edge, Kelly, arbitrage, position size, or trading recommendation. "
            "Keep every city forecast concise: one sentence for METAR read and one sentence for reasoning."
        ),
        "snapshot": model_snapshot,
    }
    timeout = httpx.Timeout(
        timeout=float(SCAN_AI_TIMEOUT_SEC),
        connect=min(8.0, float(SCAN_AI_TIMEOUT_SEC)),
        read=float(SCAN_AI_TIMEOUT_SEC),
        write=10.0,
        pool=5.0,
    )
    with httpx.Client(timeout=timeout) as client:
        response = client.post(
            f"{SCAN_AI_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": SCAN_CITY_AI_MODEL,
                "temperature": 0.1,
                "max_tokens": SCAN_AI_MAX_TOKENS,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": json.dumps(user_payload, ensure_ascii=False),
                    },
                ],
            },
        )
        response.raise_for_status()
        data = response.json()
    content = (
        ((data.get("choices") or [{}])[0].get("message") or {}).get("content")
        if isinstance(data, dict)
        else None
    )
    parsed = _extract_ai_json_object(str(content or ""))
    if isinstance(data, dict):
        parsed["_polyweather_meta"] = {
            "usage": data.get("usage"),
            "finish_reason": ((data.get("choices") or [{}])[0] or {}).get("finish_reason"),
        }
    return parsed


def _build_city_ai_prompt(data: Dict[str, Any]) -> Dict[str, Any]:
    local_date = str(data.get("local_date") or "").strip()
    multi_model_daily = data.get("multi_model_daily") if isinstance(data.get("multi_model_daily"), dict) else {}
    daily_entry = multi_model_daily.get(local_date) if isinstance(multi_model_daily, dict) else {}
    if not isinstance(daily_entry, dict):
        daily_entry = {}
    daily_models = daily_entry.get("models") if isinstance(daily_entry.get("models"), dict) else None
    models = daily_models or (data.get("multi_model") if isinstance(data.get("multi_model"), dict) else {})
    model_values = [_safe_float(value) for value in (models or {}).values()]
    model_values = [value for value in model_values if value is not None]
    metar_context = _build_metar_decision_context(data)
    observation_anchor = _city_observation_anchor(data)
    current = data.get("current") if isinstance(data.get("current"), dict) else {}
    airport_current = data.get("airport_current") if isinstance(data.get("airport_current"), dict) else {}
    airport_primary = data.get("airport_primary") if isinstance(data.get("airport_primary"), dict) else {}
    risk = data.get("risk") if isinstance(data.get("risk"), dict) else {}

    return {
        "schema_version": "single_city_forecast_v2",
        "prompt_version": SCAN_CITY_AI_PROMPT_VERSION,
        "task": "predict_city_daily_high_and_read_observation",
        "city": data.get("name"),
        "city_display_name": data.get("display_name") or data.get("name"),
        "local_date": local_date,
        "local_time": data.get("local_time"),
        "temp_symbol": data.get("temp_symbol"),
        "timezone_offset_seconds": data.get("utc_offset_seconds"),
        "observation_anchor": observation_anchor,
        "settlement_station": data.get("settlement_station") or {},
        "current": {
            "temp": current.get("temp"),
            "max_so_far": current.get("max_so_far"),
            "max_temp_time": current.get("max_temp_time"),
            "obs_time": current.get("obs_time"),
            "station_code": current.get("station_code"),
            "station_name": current.get("station_name"),
        },
        "airport": {
            "name": risk.get("airport") or airport_current.get("station_label") or airport_primary.get("station_label"),
            "icao": risk.get("icao") or airport_current.get("station_code") or airport_primary.get("station_code"),
            "distance_km": risk.get("distance_km"),
        },
        "model_cluster": {
            "sources": [
                *([
                    {"model": "DEB (fusion)", "value": ((daily_entry.get("deb") or {}).get("prediction") if isinstance(daily_entry.get("deb"), dict) else None) or ((data.get("deb") or {}).get("prediction") if isinstance(data.get("deb"), dict) else None)}
                ] if (((daily_entry.get("deb") or {}).get("prediction") if isinstance(daily_entry.get("deb"), dict) else None) or ((data.get("deb") or {}).get("prediction") if isinstance(data.get("deb"), dict) else None)) is not None else []),
                *[
                    {"model": str(name), "value": value}
                    for name, value in (models or {}).items()
                    if _safe_float(value) is not None
                ],
            ],
            "model_count": len(model_values) + (1 if (((daily_entry.get("deb") or {}).get("prediction") if isinstance(daily_entry.get("deb"), dict) else None) or ((data.get("deb") or {}).get("prediction") if isinstance(data.get("deb"), dict) else None)) is not None else 0),
            "min": min(model_values) if model_values else None,
            "max": max(model_values) if model_values else None,
            "spread": (max(model_values) - min(model_values)) if len(model_values) >= 2 else None,
        },
        "peak": data.get("peak") or {},
        "metar_context": metar_context,
        "airport_current": {
            "temp": airport_current.get("temp"),
            "obs_time": airport_current.get("obs_time"),
            "report_time": airport_current.get("report_time"),
            "receipt_time": airport_current.get("receipt_time"),
            "wind_speed_kt": airport_current.get("wind_speed_kt"),
            "wind_dir": airport_current.get("wind_dir"),
            "humidity": airport_current.get("humidity"),
            "cloud_desc": airport_current.get("cloud_desc"),
            "visibility_mi": airport_current.get("visibility_mi"),
            "wx_desc": airport_current.get("wx_desc"),
            "raw_metar": airport_current.get("raw_metar"),
            "station_code": airport_current.get("station_code"),
            "station_label": airport_current.get("station_label"),
        },
        "taf": _compact_taf_context(data.get("taf")),
        "vertical_profile_signal": _compact_vertical_context(
            data.get("vertical_profile_signal")
        ),
        "intraday_meteorology": _compact_intraday_context(
            data.get("intraday_meteorology")
        ),
        "hourly": _compact_hourly_context(data.get("hourly")),
        "metar_today_obs": _compact_observation_points(data.get("metar_today_obs"), 18),
        "metar_recent_obs": _compact_observation_points(data.get("metar_recent_obs"), 8),
        "settlement_today_obs": _compact_observation_points(
            data.get("settlement_today_obs"),
            18,
        ),
    }


def _call_deepseek_city_ai(ai_input: Dict[str, Any], *, locale: str = "zh-CN") -> Dict[str, Any]:
    return _call_deepseek_city_ai_provider(
        ai_input,
        locale=locale,
        api_key=_scan_ai_api_key(),
        base_url=SCAN_AI_BASE_URL,
        model=SCAN_CITY_AI_MODEL,
        max_tokens=SCAN_CITY_AI_MAX_TOKENS,
        timeout_sec=SCAN_CITY_AI_TIMEOUT_SEC,
    )


def _scan_city_ai_cache_key(ai_input: Dict[str, Any]) -> str:
    observation_anchor = ai_input.get("observation_anchor") if isinstance(ai_input.get("observation_anchor"), dict) else {}
    is_airport_metar = observation_anchor.get("is_airport_metar") is not False
    airport_current = ai_input.get("airport_current") if isinstance(ai_input.get("airport_current"), dict) else {}
    current_obs = ai_input.get("current") if isinstance(ai_input.get("current"), dict) else {}
    metar_context = ai_input.get("metar_context") if isinstance(ai_input.get("metar_context"), dict) else {}
    observation_obs = (
        ai_input.get("metar_today_obs") or ai_input.get("metar_recent_obs") or []
        if is_airport_metar
        else ai_input.get("settlement_today_obs") or ai_input.get("settlement_recent_obs") or []
    )
    observation_fingerprint = {
        "stale_for_today": metar_context.get("stale_for_today"),
        "last_observation_time": metar_context.get("last_observation_time"),
        "last_time": metar_context.get("last_time"),
        "last_temp": metar_context.get("last_temp"),
        "max_time": metar_context.get("max_time"),
        "max_temp": metar_context.get("max_temp"),
        "airport_obs_time": airport_current.get("obs_time"),
        "airport_report_time": airport_current.get("report_time"),
        "airport_receipt_time": airport_current.get("receipt_time"),
        "airport_temp": airport_current.get("temp"),
        "airport_max_so_far": airport_current.get("max_so_far"),
        "current_obs_time": current_obs.get("obs_time"),
        "current_report_time": current_obs.get("report_time"),
        "current_temp": current_obs.get("temp"),
        "current_max_so_far": current_obs.get("max_so_far"),
    }
    key_payload = {
        "prompt_version": SCAN_CITY_AI_PROMPT_VERSION,
        "schema_version": ai_input.get("schema_version"),
        "model": SCAN_CITY_AI_MODEL,
        "city": ai_input.get("city"),
        "local_date": ai_input.get("local_date"),
        "deb": (ai_input.get("deb") or {}).get("prediction") if isinstance(ai_input.get("deb"), dict) else None,
        "observation_source": observation_anchor.get("source") or ("metar" if is_airport_metar else "official"),
        "station": observation_anchor.get("station_code"),
        "metar": airport_current.get("raw_metar") if is_airport_metar else None,
        "observation_fingerprint": observation_fingerprint,
        "obs": observation_obs,
    }
    raw = json.dumps(key_payload, sort_keys=True, ensure_ascii=False, default=str)
    return "city-ai:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _sse_event(event: str, payload: Dict[str, Any]) -> str:
    return (
        f"event: {event}\n"
        f"data: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"
    )


def _build_city_ai_stream_request(
    ai_input: Dict[str, Any],
    *,
    locale: str,
) -> Dict[str, Any]:
    return build_city_ai_stream_request(
        ai_input,
        locale=locale,
        model=SCAN_CITY_AI_MODEL,
        max_tokens=SCAN_CITY_AI_STREAM_MAX_TOKENS,
    )


def _cache_city_ai_payload(
    cache_key: str,
    *,
    data: Dict[str, Any],
    generated_at: str,
    ai_raw: Dict[str, Any],
) -> None:
    with _SCAN_CITY_AI_CACHE_LOCK:
        _SCAN_CITY_AI_CACHE[cache_key] = {
            "expires_at": time.time() + SCAN_AI_CACHE_TTL_SEC,
            "generated_at": generated_at,
            "city": data.get("name"),
            "city_display_name": data.get("display_name"),
            "payload": ai_raw,
        }


def _is_city_ai_fallback(ai_raw: Any) -> bool:
    if not isinstance(ai_raw, dict):
        return True
    meta = ai_raw.get("_polyweather_meta")
    return bool(isinstance(meta, dict) and meta.get("fallback"))


def _build_city_ai_result_payload(
    *,
    data: Dict[str, Any],
    generated_at: str,
    started_at: float,
    ai_raw: Dict[str, Any],
    cached: bool = False,
    degraded: bool = False,
    reason: Optional[str] = None,
    reason_zh: Optional[str] = None,
    reason_en: Optional[str] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "status": "ready",
        "cached": cached,
        "model": SCAN_CITY_AI_MODEL,
        "provider": SCAN_AI_PROVIDER,
        "city": data.get("name"),
        "city_display_name": data.get("display_name"),
        "generated_at": generated_at,
        "duration_ms": int((time.time() - started_at) * 1000),
        "city_forecast": ai_raw,
    }
    if degraded:
        payload["degraded"] = True
    if reason:
        payload["reason"] = reason
    if reason_zh:
        payload["reason_zh"] = reason_zh
    if reason_en:
        payload["reason_en"] = reason_en
    return payload


def stream_scan_city_ai_forecast_payload(
    city: str,
    *,
    force_refresh: bool = False,
    locale: str = "zh-CN",
) -> Iterator[str]:
    started_at = time.time()
    city_name = _normalize_city_key(city)
    normalized_locale = _normalize_locale(locale)
    if not city_name:
        yield _sse_event("final", {"status": "failed", "reason": "city is required"})
        return
    if city_name not in CITIES:
        reason_en = f"Unknown city: {city_name}"
        reason_zh = f"未知城市：{city_name}"
        yield _sse_event(
            "final",
            {
                "status": "failed",
                "model": SCAN_CITY_AI_MODEL,
                "provider": SCAN_AI_PROVIDER,
                "city": city_name,
                "city_display_name": str(city or "").strip() or city_name,
                "reason": reason_en if normalized_locale == "en-US" else reason_zh,
                "reason_en": reason_en,
                "reason_zh": reason_zh,
            },
        )
        return

    yield _sse_event(
        "progress",
        {
            "stage": "loading_city",
            "message_zh": "正在读取城市实况、模型和最新观测…",
            "message_en": "Loading city observations, model cluster and latest observation…",
        },
    )
    data = _analyze(
        city_name,
        force_refresh=False,
        include_llm_commentary=False,
        detail_mode="full",
    )
    ai_input = _build_city_ai_prompt(data)
    cache_key = _scan_city_ai_cache_key(ai_input)
    if not force_refresh:
        with _SCAN_CITY_AI_CACHE_LOCK:
            cached = _SCAN_CITY_AI_CACHE.get(cache_key)
            if cached and cached.get("expires_at", 0) >= time.time():
                yield _sse_event(
                    "final",
                    {
                        "status": "ready",
                        "cached": True,
                        "model": SCAN_CITY_AI_MODEL,
                        "provider": SCAN_AI_PROVIDER,
                        "city": cached.get("city") or city_name,
                        "city_display_name": cached.get("city_display_name") or city_name,
                        "generated_at": cached.get("generated_at"),
                        "duration_ms": 0,
                        "city_forecast": cached.get("payload"),
                    },
                )
                return
    preview_raw = _build_city_ai_fallback(
        ai_input,
        locale=normalized_locale,
        reason="stream preview",
    )
    observation_anchor = ai_input.get("observation_anchor") if isinstance(ai_input.get("observation_anchor"), dict) else {}
    is_airport_metar = observation_anchor.get("is_airport_metar") is not False
    calling_message_zh = (
        f"{SCAN_AI_PROVIDER_LABEL} 正在快速增强机场报文解读…"
        if is_airport_metar
        else f"{SCAN_AI_PROVIDER_LABEL} 正在快速增强香港天文台观测解读…"
    )
    calling_message_en = (
        f"{SCAN_AI_PROVIDER_LABEL} is adding a fast airport-bulletin enhancement…"
        if is_airport_metar
        else f"{SCAN_AI_PROVIDER_LABEL} is adding a fast HKO observation enhancement…"
    )
    yield _sse_event(
        "preview",
        {
            "city": data.get("name") or city_name,
            "city_display_name": data.get("display_name") or city_name,
            "metar_read_zh": preview_raw.get("metar_read_zh"),
            "metar_read_en": preview_raw.get("metar_read_en"),
            "final_judgment_zh": preview_raw.get("final_judgment_zh"),
            "final_judgment_en": preview_raw.get("final_judgment_en"),
            "model_cluster_note_zh": preview_raw.get("model_cluster_note_zh"),
            "model_cluster_note_en": preview_raw.get("model_cluster_note_en"),
        },
    )
    yield _sse_event(
        "progress",
        {
            "stage": "calling_ai",
            "city": data.get("name") or city_name,
            "city_display_name": data.get("display_name") or city_name,
            "message_zh": calling_message_zh,
            "message_en": calling_message_en,
        },
    )

    if not SCAN_AI_ENABLED:
        yield _sse_event(
            "final",
            {
                "status": "disabled",
                "model": SCAN_CITY_AI_MODEL,
                "provider": SCAN_AI_PROVIDER,
                "city": data.get("name") or city_name,
                "city_display_name": data.get("display_name") or city_name,
                "reason": "POLYWEATHER_SCAN_AI_ENABLED is not enabled",
            },
        )
        return
    if not _scan_ai_api_key():
        yield _sse_event(
            "final",
            {
                "status": "missing_key",
                "model": SCAN_CITY_AI_MODEL,
                "provider": SCAN_AI_PROVIDER,
                "city": data.get("name") or city_name,
                "city_display_name": data.get("display_name") or city_name,
                "reason": f"{SCAN_AI_API_KEY_ENV_HINT} is not configured",
            },
        )
        return

    request_json = _build_city_ai_stream_request(ai_input, locale=normalized_locale)
    timeout = httpx.Timeout(
        timeout=float(SCAN_CITY_AI_TIMEOUT_SEC),
        connect=min(8.0, float(SCAN_CITY_AI_TIMEOUT_SEC)),
        read=float(SCAN_CITY_AI_TIMEOUT_SEC),
        write=10.0,
        pool=5.0,
    )
    headers = {
        "Authorization": f"Bearer {_scan_ai_api_key()}",
        "Content-Type": "application/json",
    }
    accumulated = ""
    last_meta: Dict[str, Any] = {}
    try:
        logger.info(
            "scan city AI stream request city={} locale={} input_bytes={} max_tokens={} timeout_sec={}",
            ai_input.get("city"),
            normalized_locale,
            len(json.dumps(request_json, ensure_ascii=False, default=str).encode("utf-8")),
            request_json.get("max_tokens"),
            SCAN_CITY_AI_TIMEOUT_SEC,
        )
        with httpx.Client(timeout=timeout) as client:
            with client.stream(
                "POST",
                f"{SCAN_AI_BASE_URL}/chat/completions",
                headers=headers,
                json=request_json,
            ) as response:
                response.raise_for_status()
                for line in response.iter_lines():
                    text = str(line or "").strip()
                    if not text or not text.startswith("data:"):
                        continue
                    payload_text = text[5:].strip()
                    if payload_text == "[DONE]":
                        break
                    try:
                        chunk = json.loads(payload_text)
                    except Exception:
                        continue
                    last_meta = _provider_response_meta(chunk) or last_meta
                    delta = _extract_provider_stream_delta(chunk)
                    if delta:
                        accumulated += delta
                        yield _sse_event(
                            "delta",
                            {
                                "content": delta,
                                "raw_length": len(accumulated),
                            },
                        )
        degraded = False
        degraded_reason: Optional[str] = None
        try:
            ai_raw = _extract_ai_json_object(accumulated)
            if isinstance(ai_raw, dict):
                ai_raw["_polyweather_meta"] = {
                    **last_meta,
                    "streamed": True,
                }
                ai_raw = _complete_city_ai_payload(
                    ai_raw,
                    ai_input,
                    locale=normalized_locale,
                )
        except Exception as exc:
            retry_reason = str(exc)
            if SCAN_CITY_AI_RETRY_ON_STREAM_PARSE_ERROR:
                yield _sse_event(
                    "progress",
                    {
                        "stage": "retry_non_stream",
                        "message_zh": "流式内容为空或 JSON 不完整，正在改用非流式严格 JSON 重试…",
                        "message_en": "Stream content was empty or incomplete JSON; retrying with a strict non-stream request…",
                        "raw_length": len(accumulated),
                        "reason": retry_reason,
                    },
                )
                try:
                    ai_raw = _call_deepseek_city_ai(ai_input, locale=normalized_locale)
                    if isinstance(ai_raw, dict):
                        meta = ai_raw.get("_polyweather_meta")
                        if not isinstance(meta, dict):
                            meta = {}
                        ai_raw["_polyweather_meta"] = {
                            **meta,
                            "streamed": False,
                            "stream_retry_non_stream": True,
                            "stream_retry_reason": retry_reason,
                            "stream_raw_length": len(accumulated),
                        }
                    if _is_city_ai_fallback(ai_raw):
                        degraded = True
                        degraded_reason = retry_reason
                except Exception as retry_exc:
                    degraded = True
                    degraded_reason = str(retry_exc)
                    ai_raw = _build_city_ai_fallback(
                        ai_input,
                        locale=normalized_locale,
                        reason=degraded_reason or retry_reason,
                        raw_content=accumulated,
                    )
            else:
                degraded = True
                degraded_reason = retry_reason
                ai_raw = _build_city_ai_fallback(
                    ai_input,
                    locale=normalized_locale,
                    reason=retry_reason,
                    raw_content=accumulated,
                )
        generated_at = datetime.utcnow().isoformat() + "Z"
        if not _is_city_ai_fallback(ai_raw):
            _cache_city_ai_payload(
                cache_key,
                data=data,
                generated_at=generated_at,
                ai_raw=ai_raw,
            )
        yield _sse_event(
            "final",
            _build_city_ai_result_payload(
                data=data,
                generated_at=generated_at,
                started_at=started_at,
                ai_raw=ai_raw,
                degraded=degraded,
                reason=degraded_reason,
                reason_en=degraded_reason,
                reason_zh=degraded_reason,
            ),
        )
    except httpx.TimeoutException as exc:
        duration_ms = int((time.time() - started_at) * 1000)
        reason_en = f"{SCAN_AI_PROVIDER_LABEL} city AI timed out after {SCAN_CITY_AI_TIMEOUT_SEC}s"
        reason_zh = f"{SCAN_AI_PROVIDER_LABEL} 城市 AI 在 {SCAN_CITY_AI_TIMEOUT_SEC} 秒内未返回"
        logger.warning(
            "scan city AI stream timeout fallback city={} duration_ms={} model={} error={}",
            data.get("name") or city_name,
            duration_ms,
            SCAN_CITY_AI_MODEL,
            exc,
        )
        ai_raw = _build_city_ai_fallback(
            ai_input,
            locale=normalized_locale,
            reason=reason_en if normalized_locale == "en-US" else reason_zh,
            raw_content=accumulated,
        )
        generated_at = datetime.utcnow().isoformat() + "Z"
        yield _sse_event(
            "final",
            _build_city_ai_result_payload(
                data=data,
                generated_at=generated_at,
                started_at=started_at,
                ai_raw=ai_raw,
                degraded=True,
                reason=reason_en if normalized_locale == "en-US" else reason_zh,
                reason_en=reason_en,
                reason_zh=reason_zh,
            ),
        )
    except Exception as exc:
        reason = str(exc)
        logger.warning(
            "scan city AI stream failed city={} model={} error={}",
            data.get("name") or city_name,
            SCAN_CITY_AI_MODEL,
            reason,
        )
        yield _sse_event(
            "final",
            {
                "status": "failed",
                "model": SCAN_CITY_AI_MODEL,
                "provider": SCAN_AI_PROVIDER,
                "city": data.get("name") or city_name,
                "city_display_name": data.get("display_name") or city_name,
                "duration_ms": int((time.time() - started_at) * 1000),
                "reason": reason,
                "reason_en": reason,
                "reason_zh": reason,
                "raw_reason": reason,
            },
        )


def build_scan_city_ai_forecast_payload(
    city: str,
    *,
    force_refresh: bool = False,
    locale: str = "zh-CN",
) -> Dict[str, Any]:
    started_at = time.time()
    city_name = _normalize_city_key(city)
    normalized_locale = _normalize_locale(locale)
    if not city_name:
        return {"status": "failed", "reason": "city is required"}
    if city_name not in CITIES:
        return {
            "status": "failed",
            "model": SCAN_CITY_AI_MODEL,
            "provider": SCAN_AI_PROVIDER,
            "city": city_name,
            "city_display_name": str(city or "").strip() or city_name,
            "reason": (
                f"Unknown city: {city_name}"
                if normalized_locale == "en-US"
                else f"未知城市：{city_name}"
            ),
            "reason_en": f"Unknown city: {city_name}",
            "reason_zh": f"未知城市：{city_name}",
        }
    logger.info(
        "scan city AI forecast requested city={} force_refresh={} locale={} model={}",
        city_name,
        force_refresh,
        normalized_locale,
        SCAN_CITY_AI_MODEL,
    )
    data = _analyze(
        city_name,
        force_refresh=False,
        include_llm_commentary=False,
        detail_mode="full",
    )
    ai_input = _build_city_ai_prompt(data)
    cache_key = _scan_city_ai_cache_key(ai_input)
    if not force_refresh:
        with _SCAN_CITY_AI_CACHE_LOCK:
            cached = _SCAN_CITY_AI_CACHE.get(cache_key)
            if cached and cached.get("expires_at", 0) >= time.time():
                logger.info(
                    "scan city AI forecast cache hit city={} model={}",
                    cached.get("city") or city_name,
                    SCAN_CITY_AI_MODEL,
                )
                return {
                    "status": "ready",
                    "cached": True,
                    "model": SCAN_CITY_AI_MODEL,
                    "provider": SCAN_AI_PROVIDER,
                    "city": cached.get("city") or city_name,
                    "city_display_name": cached.get("city_display_name") or city_name,
                    "generated_at": cached.get("generated_at"),
                    "duration_ms": 0,
                    "city_forecast": cached.get("payload"),
                }

    if not SCAN_AI_ENABLED:
        logger.warning(
            "scan city AI forecast disabled city={} model={}",
            data.get("name") or city_name,
            SCAN_CITY_AI_MODEL,
        )
        return {
            "status": "disabled",
            "model": SCAN_CITY_AI_MODEL,
            "provider": SCAN_AI_PROVIDER,
            "city": data.get("name") or city_name,
            "city_display_name": data.get("display_name") or city_name,
            "reason": "POLYWEATHER_SCAN_AI_ENABLED is not enabled",
        }
    if not _scan_ai_api_key():
        logger.warning(
            "scan city AI forecast missing provider key city={} model={}",
            data.get("name") or city_name,
            SCAN_CITY_AI_MODEL,
        )
        return {
            "status": "missing_key",
            "model": SCAN_CITY_AI_MODEL,
            "provider": SCAN_AI_PROVIDER,
            "city": data.get("name") or city_name,
            "city_display_name": data.get("display_name") or city_name,
            "reason": f"{SCAN_AI_API_KEY_ENV_HINT} is not configured",
        }

    try:
        logger.info(
            "scan city AI forecast calling provider city={} station={} model={} raw_metar_present={}",
            data.get("name") or city_name,
            ((ai_input.get("airport") or {}).get("icao") if isinstance(ai_input.get("airport"), dict) else None),
            SCAN_CITY_AI_MODEL,
            bool(
                (ai_input.get("airport_current") or {}).get("raw_metar")
                if isinstance(ai_input.get("airport_current"), dict)
                else False
            ),
        )
        ai_raw = _call_deepseek_city_ai(ai_input, locale=normalized_locale)
    except httpx.TimeoutException as exc:
        duration_ms = int((time.time() - started_at) * 1000)
        reason_en = f"{SCAN_AI_PROVIDER_LABEL} city AI timed out after {SCAN_CITY_AI_TIMEOUT_SEC}s"
        reason_zh = f"{SCAN_AI_PROVIDER_LABEL} 城市 AI 在 {SCAN_CITY_AI_TIMEOUT_SEC} 秒内未返回"
        ai_raw = _build_city_ai_fallback(
            ai_input,
            locale=normalized_locale,
            reason=reason_en if normalized_locale == "en-US" else reason_zh,
        )
        generated_at = datetime.utcnow().isoformat() + "Z"
        logger.warning(
            "scan city AI forecast timeout fallback city={} duration_ms={} model={} error={}",
            data.get("name") or city_name,
            duration_ms,
            SCAN_CITY_AI_MODEL,
            exc,
        )
        return {
            "status": "ready",
            "degraded": True,
            "cached": False,
            "model": SCAN_CITY_AI_MODEL,
            "provider": SCAN_AI_PROVIDER,
            "city": data.get("name") or city_name,
            "city_display_name": data.get("display_name") or city_name,
            "generated_at": generated_at,
            "duration_ms": duration_ms,
            "reason": reason_en if normalized_locale == "en-US" else reason_zh,
            "reason_en": reason_en,
            "reason_zh": reason_zh,
            "city_forecast": ai_raw,
        }
    except Exception as exc:
        duration_ms = int((time.time() - started_at) * 1000)
        raw_reason = str(exc)
        empty_ai_content = raw_reason.strip().lower() == "empty ai content"
        reason_en = (
            f"{SCAN_AI_PROVIDER_LABEL} city AI returned no usable text. Retry the city analysis."
            if empty_ai_content
            else raw_reason
        )
        reason_zh = (
            f"{SCAN_AI_PROVIDER_LABEL} 城市 AI 没有返回有效正文，请刷新重试。"
            if empty_ai_content
            else raw_reason
        )
        logger.warning(
            "scan city AI forecast failed city={} duration_ms={} model={} error={}",
            data.get("name") or city_name,
            duration_ms,
            SCAN_CITY_AI_MODEL,
            raw_reason,
        )
        ai_raw = _build_city_ai_fallback(
            ai_input,
            locale=normalized_locale,
            reason=reason_en if normalized_locale == "en-US" else reason_zh,
        )
        generated_at = datetime.utcnow().isoformat() + "Z"
        return {
            "status": "ready",
            "degraded": True,
            "cached": False,
            "model": SCAN_CITY_AI_MODEL,
            "provider": SCAN_AI_PROVIDER,
            "city": data.get("name") or city_name,
            "city_display_name": data.get("display_name") or city_name,
            "generated_at": generated_at,
            "duration_ms": duration_ms,
            "reason": reason_en if normalized_locale == "en-US" else reason_zh,
            "reason_en": reason_en,
            "reason_zh": reason_zh,
            "raw_reason": raw_reason,
            "city_forecast": ai_raw,
        }
    generated_at = datetime.utcnow().isoformat() + "Z"
    _cache_city_ai_payload(
        cache_key,
        data=data,
        generated_at=generated_at,
        ai_raw=ai_raw,
    )
    logger.info(
        "scan city AI forecast complete city={} duration_ms={} model={} confidence={}",
        data.get("name") or city_name,
        int((time.time() - started_at) * 1000),
        SCAN_CITY_AI_MODEL,
        ai_raw.get("confidence") if isinstance(ai_raw, dict) else None,
    )
    return {
        "status": "ready",
        "cached": False,
        "model": SCAN_CITY_AI_MODEL,
        "provider": SCAN_AI_PROVIDER,
        "city": data.get("name") or city_name,
        "city_display_name": data.get("display_name") or city_name,
        "generated_at": generated_at,
        "duration_ms": int((time.time() - started_at) * 1000),
        "city_forecast": ai_raw,
    }


def _build_scan_ai_unavailable_payload(
    payload: Dict[str, Any],
    *,
    status: str,
    reason: str,
    duration_ms: Optional[int] = None,
) -> Dict[str, Any]:
    return {
        **payload,
        "ai_scan": {
            "status": status,
            "stage": "fallback",
            "model": SCAN_AI_MODEL,
            "cached": False,
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "snapshot_id": payload.get("snapshot_id"),
            "input_rows": len(payload.get("rows") or []),
            "sent_rows": min(len(payload.get("rows") or []), SCAN_AI_MAX_ROWS),
            "duration_ms": duration_ms,
            "timeout_sec": SCAN_AI_TIMEOUT_SEC,
            "cache_ttl_sec": SCAN_AI_CACHE_TTL_SEC,
            "provider": SCAN_AI_PROVIDER,
            "base_url": SCAN_AI_BASE_URL,
            "reason": reason,
        },
    }


def _build_scan_terminal_payload_uncached(
    filters: Dict[str, Any],
    *,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    cached_entry = get_scan_terminal_cache_entry(filters) or {}

    try:
        city_names = list(CITIES.keys())
        max_workers = max(1, min(4, len(city_names)))
        city_results: List[Dict[str, Any]] = []
        failed_cities: List[str] = []
        failed_reasons: List[str] = []

        timed_out = False
        timeout_message: Optional[str] = None
        executor = ThreadPoolExecutor(max_workers=max_workers)
        future_map = {
            executor.submit(
                _scan_city_terminal_rows,
                city_name,
                filters,
                force_refresh=force_refresh,
            ): city_name
            for city_name in city_names
        }
        try:
            try:
                completed = as_completed(
                    future_map,
                    timeout=float(SCAN_TERMINAL_BUILD_TIMEOUT_SEC),
                )
                for future in completed:
                    city_name = future_map[future]
                    try:
                        city_results.append(future.result())
                    except Exception as exc:
                        failed_cities.append(city_name)
                        failed_reasons.append(str(exc))
                        logger.warning("scan terminal city failed city={}: {}", city_name, exc)
            except FutureTimeoutError:
                timed_out = True
                timeout_message = (
                    f"scan terminal build timed out after "
                    f"{SCAN_TERMINAL_BUILD_TIMEOUT_SEC}s"
                )
                failed_reasons.append(timeout_message)
                for future, city_name in future_map.items():
                    if not future.done():
                        future.cancel()
                        failed_cities.append(city_name)
                logger.warning(
                    "{}; completed={}/{}",
                    timeout_message,
                    len(city_results),
                    len(city_names),
                )
        finally:
            executor.shutdown(wait=False)

        if city_names and len(failed_cities) >= len(city_names):
            error_message = failed_reasons[0] if failed_reasons else "all city market scans failed"
            set_scan_terminal_failure_state(filters, error_message=error_message)
            failed_entry = get_scan_terminal_cache_entry(filters) or {}
            success_payload = failed_entry.get("success_payload")
            failed_at = failed_entry.get("last_failed_at")
            if isinstance(success_payload, dict) and success_payload:
                return build_stale_scan_terminal_payload(
                    filters=filters,
                    success_payload=success_payload,
                    error_message=error_message,
                    failed_at=failed_at,
                )
            return build_failed_scan_terminal_payload(
                filters=filters,
                error_message=error_message,
                failed_at=failed_at,
            )

        ranked_result = build_ranked_scan_terminal_result(
            city_results=city_results,
            filters=filters,
            total_city_count=len(city_names),
            failed_city_count=len(failed_cities),
        )
        ranked_rows = ranked_result["ranked_rows"]

        if timed_out and not ranked_rows:
            success_payload = cached_entry.get("success_payload")
            if isinstance(success_payload, dict) and success_payload.get("rows"):
                return build_stale_scan_terminal_payload(
                    filters=filters,
                    success_payload=success_payload,
                    error_message=timeout_message or "市场扫描快照正在刷新中",
                    failed_at=cached_entry.get("last_failed_at"),
                )

        summary = ranked_result["summary"]
        top_signal = ranked_result["top_signal"]
        payload = {
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "filters": filters,
            "summary": summary,
            "top_signal": top_signal,
            "rows": ranked_rows,
            "status": "partial" if timed_out else "ready",
            "stale": False,
            "stale_reason": timeout_message,
            "last_success_at": None,
            "last_failed_at": None,
        }
        payload["snapshot_id"] = build_scan_terminal_snapshot_id(
            filters,
            ranked_rows,
            summary,
            top_signal,
        )

        set_cached_scan_terminal_payload(filters, payload)
        return payload
    except Exception as exc:
        error_message = str(exc)
        logger.exception("scan terminal payload build failed: {}", error_message)
        set_scan_terminal_failure_state(filters, error_message=error_message)
        success_payload = cached_entry.get("success_payload")
        failed_entry = get_scan_terminal_cache_entry(filters) or {}
        failed_at = failed_entry.get("last_failed_at")
        if isinstance(success_payload, dict) and success_payload:
            return build_stale_scan_terminal_payload(
                filters=filters,
                success_payload=success_payload,
                error_message=error_message,
                failed_at=failed_at,
            )
        return build_failed_scan_terminal_payload(
            filters=filters,
            error_message=error_message,
            failed_at=failed_at,
        )


def build_scan_terminal_payload(
    raw_filters: Optional[Dict[str, Any]] = None,
    *,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    filters = _normalize_scan_terminal_filters(raw_filters)
    if not force_refresh:
        cached = get_cached_scan_terminal_payload(filters, ttl_sec=SCAN_TERMINAL_PAYLOAD_TTL_SEC)
        if cached is not None:
            return cached

        cached_entry = get_scan_terminal_cache_entry(filters) or {}
        success_payload = cached_entry.get("success_payload")
        if isinstance(success_payload, dict) and success_payload:
            started = _start_scan_terminal_background_refresh(filters)
            return build_stale_scan_terminal_payload(
                filters=filters,
                success_payload=success_payload,
                error_message=(
                    "正在后台刷新市场扫描快照"
                    if started
                    else "市场扫描快照正在刷新中"
                ),
                failed_at=cached_entry.get("last_failed_at"),
            )

    return _build_scan_terminal_payload_uncached(filters, force_refresh=force_refresh)


def build_scan_terminal_ai_payload(
    raw_filters: Optional[Dict[str, Any]] = None,
    *,
    snapshot_id: Optional[str] = None,
) -> Dict[str, Any]:
    ai_started_at = time.time()
    filters = _normalize_scan_terminal_filters(raw_filters)
    payload = build_scan_terminal_payload(filters, force_refresh=False)
    current_snapshot_id = str(payload.get("snapshot_id") or "").strip()
    requested_snapshot_id = str(snapshot_id or "").strip()
    if requested_snapshot_id and current_snapshot_id and requested_snapshot_id != current_snapshot_id:
        return _build_scan_ai_unavailable_payload(
            payload,
            status="snapshot_mismatch",
            reason="scan snapshot changed; refresh the scan before running AI review",
        )
    if not current_snapshot_id:
        return _build_scan_ai_unavailable_payload(
            payload,
            status="no_snapshot",
            reason="no scan snapshot is available for AI review",
        )
    if not payload.get("rows"):
        return _build_scan_ai_unavailable_payload(
            payload,
            status="no_rows",
            reason="no candidate rows are available for AI review",
        )
    if not SCAN_AI_ENABLED:
        return _build_scan_ai_unavailable_payload(
            payload,
            status="disabled",
            reason="POLYWEATHER_SCAN_AI_ENABLED is not enabled",
        )
    if not _scan_ai_api_key():
        return _build_scan_ai_unavailable_payload(
            payload,
            status="missing_key",
            reason=f"{SCAN_AI_API_KEY_ENV_HINT} is not configured",
        )

    cached = get_cached_scan_ai_result(
        current_snapshot_id,
        filters,
        max_rows=SCAN_AI_MAX_ROWS,
        model=SCAN_AI_MODEL,
        ttl_sec=SCAN_AI_CACHE_TTL_SEC,
    )
    if cached is not None:
        logger.info(
            "scan terminal AI cache hit snapshot={} rows={}",
            current_snapshot_id,
            len(payload.get("rows") or []),
        )
        return merge_scan_ai_result(
            payload,
            cached,
            model=SCAN_AI_MODEL,
            max_rows=SCAN_AI_MAX_ROWS,
            timeout_sec=SCAN_AI_TIMEOUT_SEC,
            cache_ttl_sec=SCAN_AI_CACHE_TTL_SEC,
            base_url=SCAN_AI_BASE_URL,
            cached=True,
            provider=SCAN_AI_PROVIDER,
            duration_ms=0,
            input_rows=len(payload.get("rows") or []),
        )

    try:
        ai_input = build_scan_ai_prompt(payload, max_rows=SCAN_AI_MAX_ROWS)
        input_meta = ai_input.get("_polyweather_input_meta") if isinstance(ai_input, dict) else {}
        sent_rows = int((input_meta or {}).get("sent_contracts") or 0)
        sent_cities = int((input_meta or {}).get("sent_cities") or 0)
        logger.info(
            "scan terminal AI review start snapshot={} rows={} sent_cities={} sent_contracts={} model={}",
            current_snapshot_id,
            len(payload.get("rows") or []),
            sent_cities,
            sent_rows,
            SCAN_AI_MODEL,
        )
        ai_raw = _call_deepseek_scan_ai(ai_input)
        ai_raw["_polyweather_input_meta"] = input_meta
        set_cached_scan_ai_result(
            current_snapshot_id,
            filters,
            ai_raw,
            max_rows=SCAN_AI_MAX_ROWS,
            model=SCAN_AI_MODEL,
        )
        duration_ms = int((time.time() - ai_started_at) * 1000)
        logger.info(
            "scan terminal AI review complete snapshot={} duration_ms={} recommendations={} vetoed={} downgraded={}",
            current_snapshot_id,
            duration_ms,
            len(_normalize_ai_items(ai_raw.get("recommendations"))),
            len(_normalize_ai_items(ai_raw.get("vetoed"))),
            len(_normalize_ai_items(ai_raw.get("downgraded"))),
        )
        return merge_scan_ai_result(
            payload,
            ai_raw,
            model=SCAN_AI_MODEL,
            max_rows=SCAN_AI_MAX_ROWS,
            timeout_sec=SCAN_AI_TIMEOUT_SEC,
            cache_ttl_sec=SCAN_AI_CACHE_TTL_SEC,
            base_url=SCAN_AI_BASE_URL,
            cached=False,
            provider=SCAN_AI_PROVIDER,
            duration_ms=duration_ms,
            input_rows=len(payload.get("rows") or []),
        )
    except httpx.TimeoutException as exc:
        duration_ms = int((time.time() - ai_started_at) * 1000)
        reason = f"V4 provider timed out after {SCAN_AI_TIMEOUT_SEC}s"
        logger.warning(
            "scan terminal AI review timeout snapshot={} duration_ms={} error={}",
            current_snapshot_id,
            duration_ms,
            exc,
        )
        return _build_scan_ai_unavailable_payload(
            payload,
            status="timeout",
            reason=reason,
            duration_ms=duration_ms,
        )
    except Exception as exc:
        duration_ms = int((time.time() - ai_started_at) * 1000)
        logger.warning(
            "scan terminal AI review failed snapshot={} duration_ms={} error={}",
            current_snapshot_id,
            duration_ms,
            exc,
        )
        return _build_scan_ai_unavailable_payload(
            payload,
            status="failed",
            reason=str(exc),
            duration_ms=duration_ms,
        )
