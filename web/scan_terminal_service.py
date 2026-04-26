from __future__ import annotations

import json
import os
import re
import threading
import time
import hashlib
from concurrent.futures import TimeoutError as FutureTimeoutError
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from typing import Any, Dict, Iterator, List, Optional

import httpx
from loguru import logger

from web.analysis_service import _analyze, _build_city_market_scan_payload
from web.core import CITIES
from src.data_collection.city_registry import ALIASES

_SCAN_TERMINAL_CACHE_LOCK = threading.Lock()
_SCAN_TERMINAL_CACHE: Dict[str, Dict[str, Any]] = {}
_SCAN_TERMINAL_REFRESHING: set[str] = set()
_SCAN_TERMINAL_AI_CACHE_LOCK = threading.Lock()
_SCAN_TERMINAL_AI_CACHE: Dict[str, Dict[str, Any]] = {}
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
SCAN_AI_MODEL = str(
    os.getenv("POLYWEATHER_SCAN_AI_MODEL") or "deepseek-v4-pro"
).strip()
SCAN_AI_BASE_URL = str(
    os.getenv("POLYWEATHER_DEEPSEEK_BASE_URL") or "https://api.deepseek.com"
).strip().rstrip("/")
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
    45,
    min_value=10,
    max_value=120,
)
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
    1200,
    min_value=800,
    max_value=64000,
)
SCAN_CITY_AI_PROMPT_VERSION = "city-airport-read-v3"


def _safe_float(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except Exception:
        return None


def _safe_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return int(default)


def _normalize_locale(value: Any) -> str:
    text = str(value or "").strip().lower()
    return "en-US" if text.startswith("en") else "zh-CN"


def _normalize_city_key(value: Any) -> str:
    text = str(value or "").strip().lower().replace("-", " ")
    text = re.sub(r"\s+", " ", text)
    return ALIASES.get(text, text)


def _normalize_scan_terminal_filters(
    raw_filters: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    raw = raw_filters if isinstance(raw_filters, dict) else {}
    min_price = _safe_float(raw.get("min_price"))
    max_price = _safe_float(raw.get("max_price"))
    if min_price is None:
        min_price = 0.05
    if max_price is None:
        max_price = 0.95
    min_price = max(0.0, min(1.0, min_price))
    max_price = max(0.0, min(1.0, max_price))
    if min_price > max_price:
        min_price, max_price = max_price, min_price

    high_liquidity_only = bool(raw.get("high_liquidity_only"))
    min_liquidity = _safe_float(raw.get("min_liquidity"))
    if min_liquidity is None:
        min_liquidity = 5000.0 if high_liquidity_only else 500.0
    if high_liquidity_only:
        min_liquidity = max(min_liquidity, 5000.0)

    return {
        "scan_mode": str(raw.get("scan_mode") or "tradable").strip().lower()
        or "tradable",
        "min_price": float(min_price),
        "max_price": float(max_price),
        "min_edge_pct": max(0.0, _safe_float(raw.get("min_edge_pct")) or 2.0),
        "min_liquidity": max(0.0, float(min_liquidity)),
        "high_liquidity_only": high_liquidity_only,
        "market_type": str(raw.get("market_type") or "maxtemp").strip().lower()
        or "maxtemp",
        "time_range": str(raw.get("time_range") or "today").strip().lower()
        or "today",
        "limit": max(1, min(_safe_int(raw.get("limit"), 25), 100)),
        "max_spread": max(0.0, _safe_float(raw.get("max_spread")) or 0.03),
    }


def _market_region_from_tz_offset(tz_offset_seconds: Any) -> Dict[str, str]:
    tz_offset = _safe_int(tz_offset_seconds, 0)
    if tz_offset <= -7200:
        return {
            "key": "americas",
            "label_en": "Americas",
            "label_zh": "美洲",
        }
    if tz_offset >= 14400:
        return {
            "key": "asia_pacific",
            "label_en": "Asia-Pacific",
            "label_zh": "亚太",
        }
    return {
        "key": "europe_africa",
        "label_en": "Europe / Africa",
        "label_zh": "欧洲 / 非洲",
    }


def _scan_terminal_cache_key(filters: Dict[str, Any]) -> str:
    normalized = _normalize_scan_terminal_filters(filters)
    return json.dumps(normalized, ensure_ascii=True, sort_keys=True)


def _get_cached_scan_terminal_payload(
    filters: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    cache_key = _scan_terminal_cache_key(filters)
    now = time.time()
    with _SCAN_TERMINAL_CACHE_LOCK:
        cached = _SCAN_TERMINAL_CACHE.get(cache_key)
        if not cached:
            return None
        cached_at = float(cached.get("t") or 0.0)
        if now - cached_at >= float(SCAN_TERMINAL_PAYLOAD_TTL_SEC):
            return None
        payload = cached.get("payload")
        if not isinstance(payload, dict):
            return None
        return dict(payload)


def _get_scan_terminal_cache_entry(filters: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    cache_key = _scan_terminal_cache_key(filters)
    with _SCAN_TERMINAL_CACHE_LOCK:
        cached = _SCAN_TERMINAL_CACHE.get(cache_key)
        if not isinstance(cached, dict):
            return None
        return dict(cached)


def _build_scan_terminal_snapshot_id(
    filters: Dict[str, Any],
    rows: List[Dict[str, Any]],
    summary: Dict[str, Any],
    top_signal: Optional[Dict[str, Any]],
) -> str:
    seed_payload = {
        "filters": filters,
        "summary": {
            "candidate_total": summary.get("candidate_total"),
            "tradable_market_count": summary.get("tradable_market_count"),
            "avg_edge_percent": summary.get("avg_edge_percent"),
        },
        "top_signal": {
            "id": (top_signal or {}).get("id"),
            "edge_percent": (top_signal or {}).get("edge_percent"),
            "final_score": (top_signal or {}).get("final_score"),
        },
        "rows": [
            {
                "id": row.get("id"),
                "edge_percent": row.get("edge_percent"),
                "final_score": row.get("final_score"),
            }
            for row in rows[:10]
        ],
    }
    digest = hashlib.md5(
        json.dumps(seed_payload, ensure_ascii=True, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return f"scan-{digest[:10]}"


def _set_cached_scan_terminal_payload(
    filters: Dict[str, Any],
    payload: Dict[str, Any],
) -> None:
    cache_key = _scan_terminal_cache_key(filters)
    existing = _get_scan_terminal_cache_entry(filters) or {}
    with _SCAN_TERMINAL_CACHE_LOCK:
        _SCAN_TERMINAL_CACHE[cache_key] = {
            "t": time.time(),
            "payload": dict(payload),
            "success_t": time.time(),
            "success_payload": dict(payload),
            "last_error": existing.get("last_error"),
            "last_failed_at": existing.get("last_failed_at"),
        }


def _set_scan_terminal_failure_state(
    filters: Dict[str, Any],
    *,
    error_message: str,
) -> None:
    cache_key = _scan_terminal_cache_key(filters)
    with _SCAN_TERMINAL_CACHE_LOCK:
        existing = _SCAN_TERMINAL_CACHE.get(cache_key) or {}
        existing["last_error"] = error_message
        existing["last_failed_at"] = datetime.utcnow().isoformat() + "Z"
        _SCAN_TERMINAL_CACHE[cache_key] = existing


def _start_scan_terminal_background_refresh(filters: Dict[str, Any]) -> bool:
    cache_key = _scan_terminal_cache_key(filters)
    with _SCAN_TERMINAL_CACHE_LOCK:
        if cache_key in _SCAN_TERMINAL_REFRESHING:
            return False
        _SCAN_TERMINAL_REFRESHING.add(cache_key)

    def _runner() -> None:
        try:
            _build_scan_terminal_payload_uncached(filters, force_refresh=True)
        except Exception as exc:  # pragma: no cover - defensive background guard
            logger.warning("scan terminal background refresh failed: {}", exc)
        finally:
            with _SCAN_TERMINAL_CACHE_LOCK:
                _SCAN_TERMINAL_REFRESHING.discard(cache_key)

    thread = threading.Thread(
        target=_runner,
        name="polyweather-scan-terminal-refresh",
        daemon=True,
    )
    thread.start()
    return True


def _build_stale_scan_terminal_payload(
    *,
    filters: Dict[str, Any],
    success_payload: Dict[str, Any],
    error_message: str,
    failed_at: Optional[str],
) -> Dict[str, Any]:
    payload = dict(success_payload)
    payload["status"] = "stale"
    payload["stale"] = True
    payload["stale_reason"] = error_message
    payload["last_success_at"] = success_payload.get("generated_at")
    payload["last_failed_at"] = failed_at
    payload["filters"] = filters
    return payload


def _build_failed_scan_terminal_payload(
    *,
    filters: Dict[str, Any],
    error_message: str,
    failed_at: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "snapshot_id": None,
        "status": "failed",
        "stale": False,
        "stale_reason": error_message,
        "last_success_at": None,
        "last_failed_at": failed_at or (datetime.utcnow().isoformat() + "Z"),
        "filters": filters,
        "summary": {
            "recommended_count": 0,
            "visible_count": 0,
            "candidate_total": 0,
            "avg_edge_percent": None,
            "avg_primary_confidence": None,
            "tradable_market_count": 0,
            "total_volume": 0.0,
            "resolved_market_type": "maxtemp",
        },
        "top_signal": None,
        "rows": [],
    }


def _extract_ai_json_object(raw_text: str) -> Dict[str, Any]:
    text = str(raw_text or "").strip()
    if not text:
        raise ValueError("empty AI content")
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        parsed = json.loads(text[start : end + 1])
        if isinstance(parsed, dict):
            return parsed
    raise ValueError("AI content is not a JSON object")


def _truncate_ai_text(value: Any, limit: int = 800) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def _extract_provider_content(data: Any) -> str:
    if not isinstance(data, dict):
        return ""
    choices = data.get("choices") or []
    if not choices or not isinstance(choices[0], dict):
        return ""
    message = choices[0].get("message") or {}
    if not isinstance(message, dict):
        return ""
    return str(message.get("content") or "")


def _extract_provider_stream_delta(data: Any) -> str:
    if not isinstance(data, dict):
        return ""
    choices = data.get("choices") or []
    if not choices or not isinstance(choices[0], dict):
        text = data.get("text") or data.get("content")
        return str(text or "")
    delta = choices[0].get("delta") or {}
    if isinstance(delta, dict):
        content = delta.get("content")
        if content:
            return str(content)
    message = choices[0].get("message") or {}
    if isinstance(message, dict):
        content = message.get("content")
        if content:
            return str(content)
    text = choices[0].get("text") or data.get("text") or data.get("content")
    return str(text or "")


def _provider_response_meta(data: Any) -> Dict[str, Any]:
    if not isinstance(data, dict):
        return {}
    choices = data.get("choices") or []
    first = choices[0] if choices and isinstance(choices[0], dict) else {}
    return {
        "usage": data.get("usage"),
        "finish_reason": first.get("finish_reason"),
    }


def _format_ai_temperature(value: Any, unit: str) -> Optional[str]:
    numeric = _safe_float(value)
    if numeric is None:
        return None
    return f"{numeric:.1f}{unit or ''}"


def _city_ai_model_cluster_note(ai_input: Dict[str, Any], *, locale: str) -> str:
    cluster = ai_input.get("model_cluster") if isinstance(ai_input.get("model_cluster"), dict) else {}
    sources = cluster.get("sources") if isinstance(cluster.get("sources"), list) else []
    unit = str(ai_input.get("temp_symbol") or "")
    values = [
        _safe_float(item.get("value"))
        for item in sources
        if isinstance(item, dict) and _safe_float(item.get("value")) is not None
    ]
    count = len(values)
    deb_value = _safe_float((ai_input.get("deb") or {}).get("prediction") if isinstance(ai_input.get("deb"), dict) else None)
    if locale == "en-US":
        if count <= 0:
            return "No usable model cluster was returned; rely on DEB and METAR only."
        if count <= 2:
            return f"Only {count} model source(s) are available, so model support is thin and should be treated as context."
        range_text = f"{min(values):.1f}{unit} to {max(values):.1f}{unit}"
        if deb_value is None:
            return f"{count} model sources cluster between {range_text}; DEB support cannot be cross-checked."
        supporting = sum(1 for value in values if abs(value - deb_value) <= 2.0)
        return f"{supporting}/{count} model sources sit within 2{unit} of DEB; model range is {range_text}."
    if count <= 0:
        return "没有可用的多模型集合，只能把 DEB 与 METAR 作为主要依据。"
    if count <= 2:
        return f"当前只有 {count} 个模型来源，模型支撑偏薄，只能作为辅助上下文。"
    range_text = f"{min(values):.1f}{unit} ~ {max(values):.1f}{unit}"
    if deb_value is None:
        return f"{count} 个模型集中在 {range_text}，但无法与 DEB 做一致性校验。"
    supporting = sum(1 for value in values if abs(value - deb_value) <= 2.0)
    return f"{supporting}/{count} 个模型落在 DEB ±2{unit} 内；模型区间为 {range_text}。"


def _build_city_ai_fallback(
    ai_input: Dict[str, Any],
    *,
    locale: str,
    reason: str,
    raw_content: str = "",
    provider_data: Any = None,
) -> Dict[str, Any]:
    unit = str(ai_input.get("temp_symbol") or "")
    cluster = ai_input.get("model_cluster") if isinstance(ai_input.get("model_cluster"), dict) else {}
    values = [
        _safe_float(item.get("value"))
        for item in (cluster.get("sources") if isinstance(cluster.get("sources"), list) else [])
        if isinstance(item, dict) and _safe_float(item.get("value")) is not None
    ]
    deb_value = _safe_float((ai_input.get("deb") or {}).get("prediction") if isinstance(ai_input.get("deb"), dict) else None)
    current_temp = _safe_float(
        (ai_input.get("airport_current") or {}).get("temp")
        if isinstance(ai_input.get("airport_current"), dict)
        else None
    )
    predicted = deb_value
    if predicted is None and values:
        predicted = sum(values) / len(values)
    if predicted is None:
        predicted = current_temp
    range_low = min(values) if values else predicted
    range_high = max(values) if values else predicted
    city = str(ai_input.get("city_display_name") or ai_input.get("city") or "this city")
    airport_current = ai_input.get("airport_current") if isinstance(ai_input.get("airport_current"), dict) else {}
    station = str(airport_current.get("station_code") or "")
    raw_metar = str(airport_current.get("raw_metar") or "").strip()
    metar_temp = _format_ai_temperature(airport_current.get("temp"), unit)
    obs_time = str(airport_current.get("report_time") or airport_current.get("obs_time") or "").strip()
    model_note_zh = _city_ai_model_cluster_note(ai_input, locale="zh-CN")
    model_note_en = _city_ai_model_cluster_note(ai_input, locale="en-US")
    content_preview = _truncate_ai_text(raw_content, 1000)
    looks_like_truncated_json = bool(content_preview.startswith("{") and not content_preview.rstrip().endswith("}"))
    reason_preview = _truncate_ai_text(reason, 260)
    reason_lower = str(reason or "").lower()
    if reason_lower.strip() == "empty ai content":
        reason_preview_zh = "模型没有返回可解析正文"
        reason_preview_en = "model returned no parseable content"
    else:
        reason_preview_zh = reason_preview
        reason_preview_en = reason_preview
    timed_out = "timeout" in reason_lower or "timed out" in reason_lower or "超时" in str(reason or "")
    if content_preview and not looks_like_truncated_json:
        metar_zh = f"DeepSeek V4-Pro 返回了非结构化解读，系统已保留摘要：{content_preview}"
        metar_en = f"DeepSeek V4-Pro returned non-JSON analysis; preserved summary: {content_preview}"
    elif content_preview:
        metar_zh = "DeepSeek V4-Pro 本次输出在 JSON 中途被截断，系统已改用 DEB、多模型与原始 METAR 兜底。"
        metar_en = "DeepSeek V4-Pro output was truncated mid-JSON, so DEB, model cluster and raw METAR are used as fallback."
    elif raw_metar:
        metar_zh = f"{station} 最新 METAR 显示 {metar_temp or '温度未知'}，报文时间 {obs_time or '未知'}；需结合后续报文确认温度路径。"
        metar_en = f"{station} latest METAR shows {metar_temp or 'unknown temperature'} at {obs_time or 'unknown time'}; later reports are needed to confirm the path."
    else:
        metar_zh = "当前没有可用的原始 METAR 正文，暂以 DEB 与多模型路径为主。"
        metar_en = "No raw METAR text is available, so DEB and the model cluster carry the read."
    predicted_text = _format_ai_temperature(predicted, unit) or "--"
    if timed_out:
        final_zh = f"{city} 预计最高温暂以 {predicted_text} 附近为中枢；DeepSeek V4-Pro 超时，已降级为模型/METAR 兜底判断。"
        final_en = f"{city} daily high is centered near {predicted_text}; DeepSeek V4-Pro timed out, so this is a model/METAR fallback."
    else:
        final_zh = f"{city} 预计最高温暂以 {predicted_text} 附近为中枢；AI 输出格式异常，已降级为模型/METAR 兜底判断。"
        final_en = f"{city} daily high is centered near {predicted_text}; AI output was not strict JSON, so this is a model/METAR fallback."
    reasoning_zh = f"DEB、多模型集合和最新 METAR 仍可用于判断方向；原始失败原因：{reason_preview_zh or 'AI 输出不是 JSON object'}。"
    reasoning_en = f"DEB, the model cluster and latest METAR still support a directional read; raw failure: {reason_preview_en or 'AI output was not a JSON object'}."
    risks_zh = (
        ["DeepSeek V4-Pro 本次超时，需刷新重试确认 AI 细节。"]
        if timed_out
        else ["DeepSeek V4-Pro 本次没有返回严格 JSON，需刷新重试确认。"]
    )
    risks_en = (
        ["DeepSeek V4-Pro timed out; refresh to confirm the AI details."]
        if timed_out
        else ["DeepSeek V4-Pro did not return strict JSON; refresh to confirm."]
    )
    return {
        "predicted_max": predicted,
        "range_low": range_low,
        "range_high": range_high,
        "unit": unit,
        "confidence": "low",
        "final_judgment_zh": final_zh,
        "final_judgment_en": final_en,
        "metar_read_zh": metar_zh,
        "metar_read_en": metar_en,
        "reasoning_zh": reasoning_zh,
        "reasoning_en": reasoning_en,
        "risks_zh": risks_zh,
        "risks_en": risks_en,
        "model_cluster_note_zh": model_note_zh,
        "model_cluster_note_en": model_note_en,
        "_polyweather_meta": {
            **_provider_response_meta(provider_data),
            "fallback": True,
            "fallback_kind": "timeout" if timed_out else "non_json",
            "looks_like_truncated_json": looks_like_truncated_json,
            "fallback_reason": reason_preview,
            "raw_content_preview": content_preview,
            "raw_metar": _truncate_ai_text(raw_metar, 1000),
        },
    }


def _scan_ai_cache_key(snapshot_id: str, filters: Dict[str, Any]) -> str:
    raw = json.dumps(
        {
            "schema_version": "city_forecast_v1",
            "snapshot_id": snapshot_id,
            "filters": _normalize_scan_terminal_filters(filters),
            "model": SCAN_AI_MODEL,
            "max_rows": SCAN_AI_MAX_ROWS,
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _get_cached_scan_ai_result(snapshot_id: str, filters: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    cache_key = _scan_ai_cache_key(snapshot_id, filters)
    now = time.time()
    with _SCAN_TERMINAL_AI_CACHE_LOCK:
        cached = _SCAN_TERMINAL_AI_CACHE.get(cache_key)
        if not cached:
            return None
        cached_at = float(cached.get("cached_at") or 0.0)
        if now - cached_at >= float(SCAN_AI_CACHE_TTL_SEC):
            return None
        result = cached.get("result")
        if isinstance(result, dict):
            return dict(result)
    return None


def _set_cached_scan_ai_result(snapshot_id: str, filters: Dict[str, Any], result: Dict[str, Any]) -> None:
    cache_key = _scan_ai_cache_key(snapshot_id, filters)
    with _SCAN_TERMINAL_AI_CACHE_LOCK:
        _SCAN_TERMINAL_AI_CACHE[cache_key] = {
            "cached_at": time.time(),
            "result": result,
        }


def _compact_ai_candidate(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row.get("id"),
        "action": row.get("action"),
        "side": row.get("side"),
        "target_label": row.get("target_label"),
        "target_value": row.get("target_value"),
        "target_threshold": row.get("target_threshold"),
        "target_unit": row.get("target_unit"),
        "market_probability": row.get("market_probability"),
        "market_event_probability": row.get("market_event_probability"),
        "yes_ask": row.get("yes_ask"),
        "no_ask": row.get("no_ask"),
        "ask": row.get("ask"),
        "spread": row.get("spread"),
        "quote_age_ms": row.get("quote_age_ms"),
        "cluster_role": row.get("cluster_role"),
        "model_cluster_sources": _compact_ai_model_sources(row),
        "metar_context": row.get("metar_context") or {},
        "window_phase": row.get("window_phase"),
        "peak_window_label": row.get("peak_window_label"),
        "minutes_until_peak_start": row.get("minutes_until_peak_start"),
        "minutes_until_peak_end": row.get("minutes_until_peak_end"),
        "trend_alignment": row.get("trend_alignment"),
        "tradable": row.get("tradable"),
        "accepting_orders": row.get("accepting_orders"),
    }


def _normalize_ai_city_key(value: Any) -> str:
    return str(value or "").strip().lower().replace(" ", "").replace("-", "").replace("_", "")


def _compact_ai_distribution(row: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw_items = row.get("distribution_full") or row.get("distribution_preview") or []
    if not isinstance(raw_items, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        out.append(
            {
                "label": item.get("label"),
                "value": item.get("value"),
                "unit": item.get("unit") or row.get("target_unit") or row.get("temp_symbol"),
                "model_probability": item.get("model_probability"),
                "market_probability": item.get("market_probability"),
                "highlighted": item.get("highlighted"),
            }
        )
    return out


def _compact_ai_model_sources(row: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw_sources = row.get("model_cluster_sources")
    if not isinstance(raw_sources, dict):
        return []
    sources: List[Dict[str, Any]] = []
    for name, value in raw_sources.items():
        if _safe_float(value) is None:
            continue
        sources.append({"model": str(name), "value": value})
    return sources[:12]


def _observation_sort_key(point: Dict[str, Any]) -> tuple[int, str]:
    raw_time = str(point.get("time") or "").strip()
    try:
        parsed = datetime.fromisoformat(raw_time.replace("Z", "+00:00"))
        return parsed.hour * 60 + parsed.minute, raw_time
    except Exception:
        pass
    match = re.search(r"(\d{1,2}):(\d{2})", raw_time)
    if match:
        hour = max(0, min(23, int(match.group(1))))
        minute = max(0, min(59, int(match.group(2))))
        return hour * 60 + minute, raw_time
    return 9999, raw_time


def _compact_observation_points(raw_points: Any, limit: int = 24) -> List[Dict[str, Any]]:
    if not isinstance(raw_points, list):
        return []
    points: List[Dict[str, Any]] = []
    for item in raw_points:
        if isinstance(item, dict):
            temp = _safe_float(item.get("temp"))
            time_value = str(item.get("time") or item.get("obs_time") or item.get("time_label") or "").strip()
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            time_value = str(item[0] or "").strip()
            temp = _safe_float(item[1])
        else:
            continue
        if temp is None or not time_value:
            continue
        points.append({"time": time_value, "temp": temp})
    sorted_points = sorted(points, key=_observation_sort_key)
    return sorted_points[-max(1, int(limit)) :]


def _compact_ai_text(value: Any, limit: int = 700) -> Optional[str]:
    text = _truncate_ai_text(value, limit).strip()
    return text or None


def _compact_hourly_context(raw_hourly: Any) -> Dict[str, Any]:
    if not isinstance(raw_hourly, dict):
        return {}
    times = raw_hourly.get("times") or raw_hourly.get("time") or []
    temps = raw_hourly.get("temps") or raw_hourly.get("temperature_2m") or []
    radiation = raw_hourly.get("radiation") or raw_hourly.get("shortwave_radiation") or []
    if not isinstance(times, list) or not isinstance(temps, list):
        return {}

    points: List[Dict[str, Any]] = []
    for idx, raw_time in enumerate(times):
        temp = _safe_float(temps[idx] if idx < len(temps) else None)
        if temp is None:
            continue
        time_text = str(raw_time or "").strip()
        if "T" in time_text:
            time_text = time_text.split("T", 1)[1][:5]
        elif len(time_text) > 5:
            time_text = time_text[:5]
        point: Dict[str, Any] = {"time": time_text, "temp": temp}
        rad = _safe_float(radiation[idx] if isinstance(radiation, list) and idx < len(radiation) else None)
        if rad is not None:
            point["radiation"] = rad
        points.append(point)

    if not points:
        return {}
    max_point = max(points, key=lambda item: _safe_float(item.get("temp")) or -999.0)
    sample_indexes = {
        idx
        for idx in range(len(points))
        if idx % 2 == 0 or idx >= len(points) - 4 or points[idx] is max_point
    }
    samples = [points[idx] for idx in sorted(sample_indexes)][-14:]
    return {
        "sample_count": len(points),
        "forecast_hourly_max": max_point,
        "samples": samples,
    }


def _compact_taf_context(raw_taf_data: Any) -> Dict[str, Any]:
    if not isinstance(raw_taf_data, dict):
        return {}
    signal = raw_taf_data.get("signal") if isinstance(raw_taf_data.get("signal"), dict) else {}
    source = signal or raw_taf_data
    raw_taf = raw_taf_data.get("raw_taf") or source.get("raw_taf")
    compact: Dict[str, Any] = {
        "available": bool(source.get("available") or raw_taf),
        "raw_taf": _compact_ai_text(raw_taf, 900),
        "issue_time": raw_taf_data.get("issue_time") or source.get("issue_time"),
        "valid_time_from": raw_taf_data.get("valid_time_from") or source.get("valid_time_from"),
        "valid_time_to": raw_taf_data.get("valid_time_to") or source.get("valid_time_to"),
        "peak_window": source.get("peak_window"),
        "suppression_level": source.get("suppression_level"),
        "disruption_level": source.get("disruption_level"),
        "wind_shift": source.get("wind_shift"),
        "wind_regimes": source.get("wind_regimes"),
        "summary_zh": _compact_ai_text(source.get("summary_zh"), 260),
        "summary_en": _compact_ai_text(source.get("summary_en"), 260),
    }
    segments = source.get("segments") if isinstance(source.get("segments"), list) else []
    markers = source.get("markers") if isinstance(source.get("markers"), list) else []
    if segments:
        compact["segments"] = segments[:3]
    if markers:
        compact["markers"] = markers[:4]
    return {key: value for key, value in compact.items() if value not in (None, "", [])}


def _compact_vertical_context(raw_vertical: Any) -> Dict[str, Any]:
    if not isinstance(raw_vertical, dict):
        return {}
    keys = [
        "source",
        "window_start",
        "window_end",
        "suppression_risk",
        "trigger_risk",
        "mixing_strength",
        "shear_risk",
        "heating_setup",
        "heating_score",
        "summary_zh",
        "summary_en",
    ]
    compact: Dict[str, Any] = {}
    for key in keys:
        value = raw_vertical.get(key)
        if isinstance(value, str):
            value = _compact_ai_text(value, 280)
        if value not in (None, "", []):
            compact[key] = value
    return compact


def _compact_intraday_context(raw_intraday: Any) -> Dict[str, Any]:
    if not isinstance(raw_intraday, dict):
        return {}
    compact: Dict[str, Any] = {}
    for key in [
        "headline",
        "headline_en",
        "confidence",
        "base_case_bucket",
        "upside_bucket",
        "downside_bucket",
        "next_observation_time",
        "peak_window",
    ]:
        value = raw_intraday.get(key)
        if isinstance(value, str):
            value = _compact_ai_text(value, 220)
        if value not in (None, "", []):
            compact[key] = value
    signals = raw_intraday.get("signal_contributions")
    if isinstance(signals, list):
        compact["signal_contributions"] = [
            {
                "label": item.get("label"),
                "label_en": item.get("label_en"),
                "direction": item.get("direction"),
                "strength": item.get("strength"),
                "summary": _compact_ai_text(item.get("summary"), 180),
                "summary_en": _compact_ai_text(item.get("summary_en"), 180),
            }
            for item in signals[:4]
            if isinstance(item, dict)
        ]
    return compact


def _build_metar_decision_context(data: Dict[str, Any]) -> Dict[str, Any]:
    today_obs = _compact_observation_points(data.get("metar_today_obs"), 36)
    recent_obs = _compact_observation_points(data.get("metar_recent_obs"), 12)
    settlement_obs = _compact_observation_points(data.get("settlement_today_obs"), 36)
    airport_current = data.get("airport_current") if isinstance(data.get("airport_current"), dict) else {}
    metar_status = data.get("metar_status") if isinstance(data.get("metar_status"), dict) else {}

    source_obs = today_obs or recent_obs or settlement_obs
    trend_source = recent_obs or source_obs[-4:]
    last_point = source_obs[-1] if source_obs else {}
    first_trend = trend_source[0] if trend_source else {}
    last_trend = trend_source[-1] if trend_source else {}
    max_point = None
    for point in source_obs:
        if max_point is None or float(point["temp"]) >= float(max_point["temp"]):
            max_point = point

    last_temp = _safe_float(last_point.get("temp"))
    first_temp = _safe_float(first_trend.get("temp"))
    trend_last_temp = _safe_float(last_trend.get("temp"))
    trend_delta = (
        trend_last_temp - first_temp
        if trend_last_temp is not None and first_temp is not None and len(trend_source) >= 2
        else None
    )
    station = data.get("risk") if isinstance(data.get("risk"), dict) else {}
    return {
        "source": "METAR",
        "station": station.get("icao") or airport_current.get("station_code"),
        "station_label": station.get("airport") or airport_current.get("station_label"),
        "today_obs": today_obs[-12:],
        "recent_obs": recent_obs[-8:],
        "settlement_today_obs": settlement_obs[-12:],
        "obs_count": len(source_obs),
        "last_time": last_point.get("time"),
        "last_temp": last_temp,
        "max_temp": _safe_float((max_point or {}).get("temp")),
        "max_time": (max_point or {}).get("time"),
        "trend_delta": trend_delta,
        "stale_for_today": bool(metar_status.get("stale_for_today")),
        "available_for_today": bool(metar_status.get("available_for_today")),
        "last_observation_time": metar_status.get("last_observation_time"),
        "airport_current_temp": _safe_float(airport_current.get("temp")),
        "airport_max_so_far": _safe_float(airport_current.get("max_so_far")),
        "airport_obs_time": airport_current.get("obs_time"),
        "airport_report_time": airport_current.get("report_time"),
        "airport_raw_metar": airport_current.get("raw_metar"),
        "airport_wx_desc": airport_current.get("wx_desc"),
        "airport_cloud_desc": airport_current.get("cloud_desc"),
        "airport_visibility_mi": _safe_float(airport_current.get("visibility_mi")),
        "airport_wind_speed_kt": _safe_float(airport_current.get("wind_speed_kt")),
        "airport_wind_dir": _safe_float(airport_current.get("wind_dir")),
        "airport_humidity": _safe_float(airport_current.get("humidity")),
    }


def _target_range_from_row(row: Dict[str, Any]) -> tuple[Optional[float], Optional[float]]:
    lower = _safe_float(row.get("target_lower"))
    upper = _safe_float(row.get("target_upper"))
    if lower is not None or upper is not None:
        return lower, upper
    threshold = _safe_float(row.get("target_threshold"))
    target_value = _safe_float(row.get("target_value"))
    raw_label = str(row.get("target_label") or row.get("action") or "")
    numbers = [float(match.group(0)) for match in re.finditer(r"-?\d+(?:\.\d+)?", raw_label)]
    if len(numbers) >= 2:
        return min(numbers[0], numbers[1]), max(numbers[0], numbers[1])
    value = threshold if threshold is not None else target_value if target_value is not None else (numbers[0] if numbers else None)
    if value is None:
        return None, None
    if re.search(r"(\+|above|higher|or\s+higher|>=|≥|以上)", raw_label, re.I):
        return value, None
    if re.search(r"(below|or\s+below|<=|≤|以下)", raw_label, re.I):
        return None, value
    return value, value


def _metar_gate_for_row(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    context = row.get("metar_context") if isinstance(row.get("metar_context"), dict) else {}
    side = str(row.get("side") or "").strip().lower()
    if side not in {"yes", "no"}:
        return None
    obs_count = _safe_int(context.get("obs_count"), 0)
    if obs_count <= 0 or context.get("stale_for_today"):
        return {
            "decision": "downgrade",
            "reason_zh": "V4 未拿到同日 METAR 实测，不能只凭 edge/Kelly 给出交易。",
            "reason_en": "V4 has no same-day METAR observations, so edge/Kelly alone cannot drive a trade.",
        }

    lower, upper = _target_range_from_row(row)
    max_temp = _safe_float(context.get("max_temp"))
    last_temp = _safe_float(context.get("last_temp"))
    trend_delta = _safe_float(context.get("trend_delta"))
    if max_temp is None or (lower is None and upper is None):
        return None

    unit = str(row.get("target_unit") or row.get("temp_symbol") or "")
    epsilon = 0.7 if "F" in unit.upper() else 0.4
    phase = str(row.get("window_phase") or "").lower()
    remaining = _safe_float(row.get("remaining_window_minutes"))
    minutes_until_peak_start = _safe_float(row.get("minutes_until_peak_start"))
    is_late = phase in {"active_peak", "post_peak"} or (remaining is not None and remaining <= 180)
    is_before_peak = phase in {"early_today", "setup_today", "tomorrow", "week_ahead"} or (
        minutes_until_peak_start is not None and minutes_until_peak_start > 0
    )
    is_falling = trend_delta is not None and trend_delta <= -epsilon
    is_not_rising = trend_delta is not None and trend_delta <= epsilon

    above_upper = upper is not None and max_temp > upper + epsilon
    below_lower = lower is not None and max_temp < lower - epsilon
    inside_bucket = (
        (lower is None or max_temp >= lower - epsilon)
        and (upper is None or max_temp <= upper + epsilon)
    )

    if side == "no":
        if above_upper:
            return {
                "decision": "approve",
                "reason_zh": "METAR 实测最高已越过目标桶上沿，V4 确认 BUY NO 有实测支撑。",
                "reason_en": "METAR max has already moved above the bucket, so V4 confirms BUY NO has observation support.",
            }
        if below_lower and (is_late or is_falling or is_not_rising):
            if is_before_peak and not is_late:
                return {
                    "decision": "watchlist",
                    "reason_zh": "峰值窗口尚未到来，METAR 暂未触达不能直接确认 BUY NO，V4 先列观察。",
                    "reason_en": "The peak window has not arrived, so a still-low METAR path cannot confirm BUY NO yet; V4 keeps it on watch.",
                }
            return {
                "decision": "approve",
                "reason_zh": "METAR 最高仍低于目标桶且近期走势不强，V4 确认 BUY NO 优先。",
                "reason_en": "METAR max remains below the bucket and recent observations are not strengthening, so V4 favors BUY NO.",
            }
        if inside_bucket and is_late and is_not_rising:
            return {
                "decision": "downgrade",
                "reason_zh": "METAR 最高仍贴近目标桶，V4 不允许只因 edge 高就直接交易 NO。",
                "reason_en": "METAR max is still close to the target bucket, so V4 will not trade NO on edge alone.",
            }
    else:
        if above_upper:
            return {
                "decision": "veto",
                "reason_zh": "METAR 实测最高已越过目标桶上沿，V4 排除该 BUY YES。",
                "reason_en": "METAR max has already exceeded the bucket, so V4 vetoes this BUY YES.",
            }
        if below_lower and (is_late or is_falling or is_not_rising):
            if is_before_peak and not is_late:
                return {
                    "decision": "watchlist",
                    "reason_zh": "峰值窗口尚未到来，METAR 未触达目标桶只能说明仍需等待峰值验证，V4 暂列观察。",
                    "reason_en": "The peak window has not arrived, so METAR not reaching the bucket only means the setup still needs peak-window confirmation; V4 keeps it on watch.",
                }
            return {
                "decision": "downgrade",
                "reason_zh": "METAR 最高仍未触达目标桶且走势不强，V4 将 BUY YES 降级观察。",
                "reason_en": "METAR max has not reached the bucket and recent observations are weak, so V4 downgrades BUY YES.",
            }
        if inside_bucket:
            return {
                "decision": "approve",
                "reason_zh": "METAR 实测最高已落入目标桶，V4 认为 BUY YES 有实测依据，但仍需防止继续升穿上沿。",
                "reason_en": "METAR max is inside the target bucket, so V4 sees observation support for BUY YES while monitoring an overshoot.",
            }
    if last_temp is not None and trend_delta is not None:
        direction = "走弱" if trend_delta < -epsilon else "走强" if trend_delta > epsilon else "横盘"
        return {
            "decision": "watchlist",
            "reason_zh": f"METAR 最新 {last_temp:.1f}，近期{direction}，V4 暂不把该合约升级为最终交易。",
            "reason_en": f"Latest METAR is {last_temp:.1f} with a recent {'downtrend' if trend_delta < -epsilon else 'uptrend' if trend_delta > epsilon else 'flat trend'}, so V4 keeps this as watchlist.",
        }
    return None


def _apply_metar_gate_to_row(row: Dict[str, Any]) -> None:
    gate = _metar_gate_for_row(row)
    if not gate:
        return
    decision = str(gate.get("decision") or "").lower()
    row["v4_metar_decision"] = decision
    row["v4_metar_reason_zh"] = gate.get("reason_zh")
    row["v4_metar_reason_en"] = gate.get("reason_en")

    current_decision = str(row.get("ai_decision") or "").lower()
    hard_decisions = {"veto", "downgrade"}
    if decision == "veto":
        row["ai_decision"] = "veto"
        row.pop("ai_rank", None)
    elif decision == "downgrade" and current_decision != "veto":
        row["ai_decision"] = "downgrade"
        row.pop("ai_rank", None)
    elif decision == "approve" and current_decision not in hard_decisions:
        row["ai_decision"] = "approve"
    elif decision == "watchlist" and current_decision not in {"approve", "veto", "downgrade"}:
        row["ai_decision"] = "watchlist"

    if decision in {"approve", "veto", "downgrade"}:
        row["ai_reason_zh"] = gate.get("reason_zh") or row.get("ai_reason_zh")
        row["ai_reason_en"] = gate.get("reason_en") or row.get("ai_reason_en")


def _compact_ai_city_group(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    first = rows[0]
    return {
        "city": first.get("city"),
        "city_display_name": first.get("city_display_name") or first.get("display_name") or first.get("city"),
        "selected_date": first.get("selected_date") or first.get("local_date"),
        "local_time": first.get("local_time"),
        "temp_symbol": first.get("temp_symbol") or first.get("target_unit"),
        "current_temp": first.get("current_temp"),
        "current_max_so_far": first.get("current_max_so_far"),
        "deb_prediction": first.get("deb_prediction"),
        "window_phase": first.get("window_phase"),
        "remaining_window_minutes": first.get("remaining_window_minutes"),
        "peak_window_label": first.get("peak_window_label"),
        "minutes_until_peak_start": first.get("minutes_until_peak_start"),
        "minutes_until_peak_end": first.get("minutes_until_peak_end"),
        "metar_context": first.get("metar_context") or {},
        "model_cluster": {
            "core_low": first.get("cluster_core_low"),
            "core_high": first.get("cluster_core_high"),
            "median": first.get("cluster_median"),
            "deb_reference": first.get("cluster_deb_reference"),
            "model_count": first.get("cluster_model_count"),
            "sources": _compact_ai_model_sources(first),
        },
        "contracts": [_compact_ai_candidate(row) for row in rows],
    }


def _build_scan_ai_prompt(payload: Dict[str, Any]) -> Dict[str, Any]:
    raw_rows = [
        row
        for row in (payload.get("rows") or [])[:SCAN_AI_MAX_ROWS]
        if isinstance(row, dict) and row.get("id")
    ]
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for row in raw_rows:
        key = "|".join(
            [
                _normalize_ai_city_key(row.get("city") or row.get("city_display_name")),
                str(row.get("selected_date") or row.get("local_date") or ""),
            ]
        )
        grouped.setdefault(key, []).append(row)
    cities = [_compact_ai_city_group(rows) for rows in grouped.values() if rows]
    sent_contracts = sum(len(city.get("contracts") or []) for city in cities)
    return {
        "schema_version": "city_forecast_v1",
        "snapshot_id": payload.get("snapshot_id"),
        "generated_at": payload.get("generated_at"),
        "summary": payload.get("summary") or {},
        "filters": payload.get("filters") or {},
        "city_count": len(cities),
        "candidate_row_count": len(raw_rows),
        "cities": cities,
        "_polyweather_input_meta": {
            "sent_cities": len(cities),
            "sent_contracts": sent_contracts,
        },
    }


def _call_deepseek_scan_ai(ai_input: Dict[str, Any]) -> Dict[str, Any]:
    api_key = str(os.getenv("POLYWEATHER_DEEPSEEK_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("POLYWEATHER_DEEPSEEK_API_KEY is not configured")

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
                "model": SCAN_AI_MODEL,
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
    current = data.get("current") if isinstance(data.get("current"), dict) else {}
    airport_current = data.get("airport_current") if isinstance(data.get("airport_current"), dict) else {}
    airport_primary = data.get("airport_primary") if isinstance(data.get("airport_primary"), dict) else {}
    risk = data.get("risk") if isinstance(data.get("risk"), dict) else {}

    return {
        "schema_version": "single_city_forecast_v2",
        "prompt_version": SCAN_CITY_AI_PROMPT_VERSION,
        "task": "predict_city_daily_high_and_read_metar",
        "city": data.get("name"),
        "city_display_name": data.get("display_name") or data.get("name"),
        "local_date": local_date,
        "local_time": data.get("local_time"),
        "temp_symbol": data.get("temp_symbol"),
        "timezone_offset_seconds": data.get("utc_offset_seconds"),
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
        "deb": {
            "prediction": ((daily_entry.get("deb") or {}).get("prediction") if isinstance(daily_entry.get("deb"), dict) else None)
            or ((data.get("deb") or {}).get("prediction") if isinstance(data.get("deb"), dict) else None),
            "weights_info": ((data.get("deb") or {}).get("weights_info") if isinstance(data.get("deb"), dict) else None),
        },
        "model_cluster": {
            "sources": [
                {"model": str(name), "value": value}
                for name, value in (models or {}).items()
                if _safe_float(value) is not None
            ],
            "model_count": len(model_values),
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
    api_key = str(os.getenv("POLYWEATHER_DEEPSEEK_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("POLYWEATHER_DEEPSEEK_API_KEY is not configured")
    normalized_locale = _normalize_locale(locale)

    system_prompt = (
        "你是 PolyWeather 的 Deepseek V4-Pro 城市最高温预测员。你必须直接阅读用户给出的城市 JSON，"
        "判断该城市今日最高温路径。不要写套利、交易、BUY YES/NO、价格、edge 或 Kelly。"
        "你的核心输出是：最终最高温点估计、置信区间、置信度、最终判断、机场报文/METAR 解读、判断依据和风险。"
        "必须综合 DEB 最终融合值、全部天气模型预测、METAR 实测序列、最新机场报文、峰值窗口、当地时间、季节背景。"
        "如果实测温度与 DEB 预测走势出现偏差，要明确说明偏差方向和可能修正。"
        "你可以基于城市、时间、季节、机场位置、风向/风速、云、能见度、露点等判断风或天气是否可能影响温度路径，"
        "但必须使用“可能”“倾向”“需要确认”等非绝对表达。"
        "METAR 解读必须具体：写清楚最新报文时间、温度、风向风速、云量/天气、能见度或露点中与温度路径相关的因素。"
        "涉及风时必须说明该风向对本城市/机场最高温路径倾向增温、降温还是中性，并给出理由；"
        "不得只写“风向切换可能冷平流”，必须说明是哪一类风向或哪段风向切换可能带来冷/暖平流。"
        "涉及 TAF 或云雨扰动时必须给出报文中的有效时间、BECMG/TEMPO/FM 时间窗或说明“未给出明确时间”；"
        "如果没有 TAF 时间依据，不要笼统写“峰值窗口云雨扰动风险”。"
        "如果峰值窗口尚未到来，不能过早下最终结论；如果峰值窗口已过或实测已创高，需要更重视 METAR 实测。"
        "所有面向用户的自然语言字段必须同时填写简体中文和英文两套内容："
        "_zh 字段写简体中文，_en 字段写英文。前端会按用户界面语言直接切换字段，不能留空。"
        "risks 最多 2 条，每条必须包含触发条件或方向来源；reasoning、model_cluster_note 各 1 句，metar_read 可用 2-4 句。"
        "只返回 JSON object，不要 Markdown。"
    )
    user_payload = {
        "locale": normalized_locale,
        "task": (
            "Return strict JSON with: predicted_max, range_low, range_high, unit, confidence, "
            "final_judgment_zh, final_judgment_en, metar_read_zh, metar_read_en, "
            "reasoning_zh, reasoning_en, risks_zh, risks_en, model_cluster_note_zh, model_cluster_note_en. "
            "Fill every *_zh field in Simplified Chinese and every *_en field in English in the same response. "
            "Keep final_judgment one short decision sentence. metar_read must explain the latest airport bulletin "
            "with report time, temperature, wind direction/speed, cloud/weather/visibility/dewpoint if available. "
            "For wind, explicitly say whether the current wind tends to warm, cool, or be neutral for today's high, "
            "and why in local city/airport context. If mentioning cold/warm advection, name the wind direction or "
            "direction shift responsible. If mentioning TAF risk, include the concrete TAF time window or say no "
            "explicit timing is available. model_cluster_note must state "
            "how many model sources are available, whether they support DEB, and whether the sample is too sparse. "
            "Keep the whole JSON compact."
        ),
        "city_snapshot": ai_input,
    }
    timeout = httpx.Timeout(
        timeout=float(SCAN_CITY_AI_TIMEOUT_SEC),
        connect=min(8.0, float(SCAN_CITY_AI_TIMEOUT_SEC)),
        read=float(SCAN_CITY_AI_TIMEOUT_SEC),
        write=10.0,
        pool=5.0,
    )
    request_json = {
        "model": SCAN_AI_MODEL,
        "temperature": 0.2,
        "max_tokens": SCAN_CITY_AI_MAX_TOKENS,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": json.dumps(user_payload, ensure_ascii=False),
            },
        ],
    }
    logger.info(
        "scan city AI provider request city={} locale={} input_bytes={} max_tokens={} timeout_sec={}",
        ai_input.get("city"),
        normalized_locale,
        len(json.dumps(request_json, ensure_ascii=False, default=str).encode("utf-8")),
        request_json.get("max_tokens"),
        SCAN_CITY_AI_TIMEOUT_SEC,
    )
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=timeout) as client:
        response = client.post(
            f"{SCAN_AI_BASE_URL}/chat/completions",
            headers=headers,
            json=request_json,
        )
        response.raise_for_status()
        data = response.json()
        content = _extract_provider_content(data)
        if not str(content or "").strip():
            logger.warning(
                "scan city AI provider returned empty content city={} locale={} finish_reason={} retrying_without_json_mode=true",
                ai_input.get("city"),
                normalized_locale,
                _provider_response_meta(data).get("finish_reason"),
            )
            retry_payload = dict(request_json)
            retry_payload.pop("response_format", None)
            retry_payload["temperature"] = 0.1
            retry_payload["messages"] = [
                {
                    "role": "system",
                    "content": (
                        system_prompt
                        + " 这次重试必须返回一个紧凑 JSON object，不要解释，不要空回复。"
                        + " If you cannot infer a field, still return the field with a cautious sentence."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            **user_payload,
                            "retry_reason": "previous provider response had empty message.content",
                            "task": (
                                user_payload["task"]
                                + " The previous response had empty content. Return only one compact JSON object now."
                            ),
                        },
                        ensure_ascii=False,
                    ),
                },
            ]
            response = client.post(
                f"{SCAN_AI_BASE_URL}/chat/completions",
                headers=headers,
                json=retry_payload,
            )
            response.raise_for_status()
            data = response.json()
            content = _extract_provider_content(data)
        try:
            parsed = _extract_ai_json_object(str(content or ""))
        except ValueError as exc:
            preview = _truncate_ai_text(content, 700)
            logger.warning(
                "scan city AI provider returned non-json city={} locale={} finish_reason={} content_preview={}",
                ai_input.get("city"),
                normalized_locale,
                _provider_response_meta(data).get("finish_reason"),
                preview,
            )
            repair_payload = {
                "model": SCAN_AI_MODEL,
                "temperature": 0.0,
                "max_tokens": min(max(SCAN_CITY_AI_MAX_TOKENS, 1200), 64000),
                "response_format": {"type": "json_object"},
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You repair PolyWeather AI output into one strict JSON object. "
                            "Do not add facts that are not present in the original city snapshot or previous assistant content. "
                            "Return only JSON, no markdown."
                        ),
                    },
                    {
                        "role": "user",
                        "content": json.dumps(
                            {
                                "locale": normalized_locale,
                                "required_schema": [
                                    "predicted_max",
                                    "range_low",
                                    "range_high",
                                    "unit",
                                    "confidence",
                                    "final_judgment_zh",
                                    "final_judgment_en",
                                    "metar_read_zh",
                                    "metar_read_en",
                                    "reasoning_zh",
                                    "reasoning_en",
                                    "risks_zh",
                                    "risks_en",
                                    "model_cluster_note_zh",
                                    "model_cluster_note_en",
                                ],
                                "previous_error": str(exc),
                                "previous_assistant_content": _truncate_ai_text(content, 5000),
                                "city_snapshot": ai_input,
                                "instruction": (
                                    "Fill *_zh fields in Simplified Chinese and *_en fields in English; do not leave either language empty. "
                                    "Make final_judgment one direct sentence about today's high temperature. "
                                    "metar_read must interpret the latest airport bulletin with report time, temperature, "
                                    "wind direction/speed, cloud/weather/visibility/dewpoint if available. State whether "
                                    "the current wind tends to warm, cool, or stay neutral for the temperature path, and why. "
                                    "If mentioning cold/warm advection or TAF risk, include the responsible wind direction "
                                    "or the concrete TAF time window; otherwise say timing is not explicit. "
                                    "model_cluster_note must mention available model count/range and whether it supports DEB. "
                                    "Keep the JSON compact."
                                ),
                            },
                            ensure_ascii=False,
                        ),
                    },
                ],
            }
            try:
                repair_response = client.post(
                    f"{SCAN_AI_BASE_URL}/chat/completions",
                    headers=headers,
                    json=repair_payload,
                )
                repair_response.raise_for_status()
                repair_data = repair_response.json()
                repair_content = _extract_provider_content(repair_data)
                parsed = _extract_ai_json_object(str(repair_content or ""))
                if isinstance(parsed, dict):
                    parsed["_polyweather_meta"] = {
                        **_provider_response_meta(repair_data),
                        "repaired_from_non_json": True,
                        "original_finish_reason": _provider_response_meta(data).get("finish_reason"),
                        "original_content_preview": preview,
                    }
                    return parsed
            except Exception as repair_exc:
                logger.warning(
                    "scan city AI provider json repair failed city={} locale={} error={}",
                    ai_input.get("city"),
                    normalized_locale,
                    repair_exc,
                )
            return _build_city_ai_fallback(
                ai_input,
                locale=normalized_locale,
                reason=str(exc),
                raw_content=str(content or ""),
                provider_data=data,
            )
    if isinstance(data, dict):
        parsed["_polyweather_meta"] = _provider_response_meta(data)
    return parsed


def _scan_city_ai_cache_key(ai_input: Dict[str, Any]) -> str:
    key_payload = {
        "prompt_version": SCAN_CITY_AI_PROMPT_VERSION,
        "schema_version": ai_input.get("schema_version"),
        "city": ai_input.get("city"),
        "local_date": ai_input.get("local_date"),
        "local_time": ai_input.get("local_time"),
        "deb": (ai_input.get("deb") or {}).get("prediction") if isinstance(ai_input.get("deb"), dict) else None,
        "metar": (ai_input.get("airport_current") or {}).get("raw_metar") if isinstance(ai_input.get("airport_current"), dict) else None,
        "obs": ai_input.get("metar_today_obs") or ai_input.get("metar_recent_obs") or [],
    }
    raw = json.dumps(key_payload, sort_keys=True, ensure_ascii=False, default=str)
    return "city-ai:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _city_forecast_cache_key(city_name: str) -> str:
    return f"city_forecast:{SCAN_CITY_AI_PROMPT_VERSION}:{city_name.lower()}"


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
    normalized_locale = _normalize_locale(locale)
    system_prompt = (
        "你是 PolyWeather 的城市最高温与机场 METAR 解读员。"
        "只返回一个紧凑 JSON object，不要 Markdown。"
        "必须先写 metar_read_zh 和 metar_read_en 字段，便于前端流式显示机场报文解读；"
        "然后写 final_judgment_zh/final_judgment_en、predicted_max、range_low、range_high、unit、confidence、"
        "reasoning_zh/reasoning_en、risks_zh/risks_en、model_cluster_note_zh/model_cluster_note_en。"
        "METAR 解读必须具体说明报文时间、温度、风向风速、云量/天气/能见度/露点中与温度路径相关的因素；"
        "涉及风时要说明当前风向对机场最高温路径倾向增温、降温还是中性，并给出理由。"
        "所有 *_zh 字段写简体中文，所有 *_en 字段写英文，不得留空。"
        "不要写交易建议、BUY/SELL、Kelly 或套利。"
    )
    return {
        "model": SCAN_AI_MODEL,
        "temperature": 0.2,
        "max_tokens": SCAN_CITY_AI_MAX_TOKENS,
        "stream": True,
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "locale": normalized_locale,
                        "task": (
                            "Return JSON keys in this exact order: metar_read_zh, metar_read_en, "
                            "final_judgment_zh, final_judgment_en, predicted_max, range_low, range_high, "
                            "unit, confidence, reasoning_zh, reasoning_en, risks_zh, risks_en, "
                            "model_cluster_note_zh, model_cluster_note_en. Keep it compact."
                        ),
                        "city_snapshot": ai_input,
                    },
                    ensure_ascii=False,
                ),
            },
        ],
    }


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
        "model": SCAN_AI_MODEL,
        "provider": "deepseek",
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
                "model": SCAN_AI_MODEL,
                "provider": "deepseek",
                "city": city_name,
                "city_display_name": str(city or "").strip() or city_name,
                "reason": reason_en if normalized_locale == "en-US" else reason_zh,
                "reason_en": reason_en,
                "reason_zh": reason_zh,
            },
        )
        return

    cache_key = _city_forecast_cache_key(city_name)
    if not force_refresh:
        with _SCAN_CITY_AI_CACHE_LOCK:
            cached = _SCAN_CITY_AI_CACHE.get(cache_key)
            if cached and cached.get("expires_at", 0) >= time.time():
                yield _sse_event(
                    "final",
                    {
                        "status": "ready",
                        "cached": True,
                        "model": SCAN_AI_MODEL,
                        "provider": "deepseek",
                        "city": cached.get("city") or city_name,
                        "city_display_name": cached.get("city_display_name") or city_name,
                        "generated_at": cached.get("generated_at"),
                        "duration_ms": 0,
                        "city_forecast": cached.get("payload"),
                    },
                )
                return

    yield _sse_event(
        "progress",
        {
            "stage": "loading_city",
            "message_zh": "正在读取城市实况、模型和最新机场报文…",
            "message_en": "Loading city observations, model cluster and latest airport bulletin…",
        },
    )
    data = _analyze(
        city_name,
        force_refresh=False,
        include_llm_commentary=False,
        detail_mode="full",
    )
    ai_input = _build_city_ai_prompt(data)
    preview_raw = _build_city_ai_fallback(
        ai_input,
        locale=normalized_locale,
        reason="stream preview",
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
            "message_zh": "DeepSeek V4-Pro 开始流式解读机场报文…",
            "message_en": "DeepSeek V4-Pro is streaming the airport bulletin read…",
        },
    )

    if not SCAN_AI_ENABLED:
        yield _sse_event(
            "final",
            {
                "status": "disabled",
                "model": SCAN_AI_MODEL,
                "provider": "deepseek",
                "city": data.get("name") or city_name,
                "city_display_name": data.get("display_name") or city_name,
                "reason": "POLYWEATHER_SCAN_AI_ENABLED is not enabled",
            },
        )
        return
    if not str(os.getenv("POLYWEATHER_DEEPSEEK_API_KEY") or "").strip():
        yield _sse_event(
            "final",
            {
                "status": "missing_key",
                "model": SCAN_AI_MODEL,
                "provider": "deepseek",
                "city": data.get("name") or city_name,
                "city_display_name": data.get("display_name") or city_name,
                "reason": "POLYWEATHER_DEEPSEEK_API_KEY is not configured",
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
        "Authorization": f"Bearer {os.getenv('POLYWEATHER_DEEPSEEK_API_KEY')}",
        "Content-Type": "application/json",
    }
    accumulated = ""
    last_meta: Dict[str, Any] = {}
    try:
        logger.info(
            "scan city AI stream request city={} locale={} input_bytes={} timeout_sec={}",
            ai_input.get("city"),
            normalized_locale,
            len(json.dumps(request_json, ensure_ascii=False, default=str).encode("utf-8")),
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
        except Exception as exc:
            retry_reason = str(exc)
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
        reason_en = f"DeepSeek V4-Pro timed out after {SCAN_CITY_AI_TIMEOUT_SEC}s"
        reason_zh = f"DeepSeek V4-Pro 在 {SCAN_CITY_AI_TIMEOUT_SEC} 秒内未返回"
        logger.warning(
            "scan city AI stream timeout fallback city={} duration_ms={} model={} error={}",
            data.get("name") or city_name,
            duration_ms,
            SCAN_AI_MODEL,
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
            SCAN_AI_MODEL,
            reason,
        )
        yield _sse_event(
            "final",
            {
                "status": "failed",
                "model": SCAN_AI_MODEL,
                "provider": "deepseek",
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
            "model": SCAN_AI_MODEL,
            "provider": "deepseek",
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
        SCAN_AI_MODEL,
    )
    cache_key = _city_forecast_cache_key(city_name)
    if not force_refresh:
        with _SCAN_CITY_AI_CACHE_LOCK:
            cached = _SCAN_CITY_AI_CACHE.get(cache_key)
            if cached and cached.get("expires_at", 0) >= time.time():
                logger.info(
                    "scan city AI forecast cache hit city={} model={}",
                    cached.get("city") or city_name,
                    SCAN_AI_MODEL,
                )
                return {
                    "status": "ready",
                    "cached": True,
                    "model": SCAN_AI_MODEL,
                    "provider": "deepseek",
                    "city": cached.get("city") or city_name,
                    "city_display_name": cached.get("city_display_name") or city_name,
                    "generated_at": cached.get("generated_at"),
                    "duration_ms": 0,
                    "city_forecast": cached.get("payload"),
                }
    data = _analyze(
        city_name,
        force_refresh=False,
        include_llm_commentary=False,
        detail_mode="full",
    )
    ai_input = _build_city_ai_prompt(data)

    if not SCAN_AI_ENABLED:
        logger.warning(
            "scan city AI forecast disabled city={} model={}",
            data.get("name") or city_name,
            SCAN_AI_MODEL,
        )
        return {
            "status": "disabled",
            "model": SCAN_AI_MODEL,
            "provider": "deepseek",
            "city": data.get("name") or city_name,
            "city_display_name": data.get("display_name") or city_name,
            "reason": "POLYWEATHER_SCAN_AI_ENABLED is not enabled",
        }
    if not str(os.getenv("POLYWEATHER_DEEPSEEK_API_KEY") or "").strip():
        logger.warning(
            "scan city AI forecast missing DeepSeek key city={} model={}",
            data.get("name") or city_name,
            SCAN_AI_MODEL,
        )
        return {
            "status": "missing_key",
            "model": SCAN_AI_MODEL,
            "provider": "deepseek",
            "city": data.get("name") or city_name,
            "city_display_name": data.get("display_name") or city_name,
            "reason": "POLYWEATHER_DEEPSEEK_API_KEY is not configured",
        }

    try:
        logger.info(
            "scan city AI forecast calling provider city={} station={} model={} raw_metar_present={}",
            data.get("name") or city_name,
            ((ai_input.get("airport") or {}).get("icao") if isinstance(ai_input.get("airport"), dict) else None),
            SCAN_AI_MODEL,
            bool(
                (ai_input.get("airport_current") or {}).get("raw_metar")
                if isinstance(ai_input.get("airport_current"), dict)
                else False
            ),
        )
        ai_raw = _call_deepseek_city_ai(ai_input, locale=normalized_locale)
    except httpx.TimeoutException as exc:
        duration_ms = int((time.time() - started_at) * 1000)
        reason_en = f"DeepSeek V4-Pro timed out after {SCAN_CITY_AI_TIMEOUT_SEC}s"
        reason_zh = f"DeepSeek V4-Pro 在 {SCAN_CITY_AI_TIMEOUT_SEC} 秒内未返回"
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
            SCAN_AI_MODEL,
            exc,
        )
        return {
            "status": "ready",
            "degraded": True,
            "cached": False,
            "model": SCAN_AI_MODEL,
            "provider": "deepseek",
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
            "DeepSeek V4-Pro returned no usable text. Retry the city analysis."
            if empty_ai_content
            else raw_reason
        )
        reason_zh = (
            "DeepSeek V4-Pro 没有返回有效正文，请刷新重试。"
            if empty_ai_content
            else raw_reason
        )
        logger.warning(
            "scan city AI forecast failed city={} duration_ms={} model={} error={}",
            data.get("name") or city_name,
            duration_ms,
            SCAN_AI_MODEL,
            raw_reason,
        )
        return {
            "status": "failed",
            "model": SCAN_AI_MODEL,
            "provider": "deepseek",
            "city": data.get("name") or city_name,
            "city_display_name": data.get("display_name") or city_name,
            "duration_ms": duration_ms,
            "reason": reason_en if normalized_locale == "en-US" else reason_zh,
            "reason_en": reason_en,
            "reason_zh": reason_zh,
            "raw_reason": raw_reason,
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
        SCAN_AI_MODEL,
        ai_raw.get("confidence") if isinstance(ai_raw, dict) else None,
    )
    return {
        "status": "ready",
        "cached": False,
        "model": SCAN_AI_MODEL,
        "provider": "deepseek",
        "city": data.get("name") or city_name,
        "city_display_name": data.get("display_name") or city_name,
        "generated_at": generated_at,
        "duration_ms": int((time.time() - started_at) * 1000),
        "city_forecast": ai_raw,
    }


def _normalize_ai_items(raw_items: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw_items, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in raw_items:
        if isinstance(item, str):
            out.append({"row_id": item})
        elif isinstance(item, dict):
            row_id = str(item.get("row_id") or item.get("id") or "").strip()
            if row_id:
                out.append({**item, "row_id": row_id})
    return out


def _normalize_ai_city_theses(raw_items: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw_items, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        city = str(item.get("city") or item.get("city_name") or "").strip()
        if not city:
            continue
        out.append({**item, "city": city})
    return out


def _normalize_ai_city_forecasts(ai_raw: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw_items = (
        ai_raw.get("city_forecasts")
        or ai_raw.get("city_predictions")
        or ai_raw.get("city_max_forecasts")
        or ai_raw.get("city_theses")
    )
    if not isinstance(raw_items, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        city = str(item.get("city") or item.get("city_name") or "").strip()
        if not city:
            continue
        predicted = (
            item.get("predicted_max")
            if item.get("predicted_max") is not None
            else item.get("max_temp")
            if item.get("max_temp") is not None
            else item.get("prediction")
        )
        out.append(
            {
                **item,
                "city": city,
                "predicted_max": predicted,
                "range_low": item.get("range_low") if item.get("range_low") is not None else item.get("low"),
                "range_high": item.get("range_high") if item.get("range_high") is not None else item.get("high"),
                "reasoning_zh": item.get("reasoning_zh") or item.get("thesis_zh") or item.get("summary_zh"),
                "reasoning_en": item.get("reasoning_en") or item.get("thesis_en") or item.get("summary_en"),
            }
        )
    return out


def _merge_scan_ai_result(
    payload: Dict[str, Any],
    ai_raw: Dict[str, Any],
    *,
    cached: bool = False,
    duration_ms: Optional[int] = None,
    input_rows: Optional[int] = None,
) -> Dict[str, Any]:
    rows = [dict(row) for row in (payload.get("rows") or []) if isinstance(row, dict)]
    by_id = {str(row.get("id")): row for row in rows if row.get("id")}
    recommendations = _normalize_ai_items(ai_raw.get("recommendations"))
    vetoed = _normalize_ai_items(ai_raw.get("vetoed"))
    downgraded = _normalize_ai_items(ai_raw.get("downgraded"))
    watchlist = _normalize_ai_items(ai_raw.get("watchlist"))
    city_theses = _normalize_ai_city_theses(ai_raw.get("city_theses"))
    city_forecasts = _normalize_ai_city_forecasts(ai_raw)
    contract_notes = _normalize_ai_items(ai_raw.get("contract_notes"))

    veto_ids = {str(item.get("row_id")) for item in vetoed}
    downgrade_ids = {str(item.get("row_id")) for item in downgraded}
    recommended_ids: set[str] = set()
    watchlist_ids = {str(item.get("row_id")) for item in watchlist}

    thesis_by_city: Dict[str, Dict[str, Any]] = {}
    for item in city_theses:
        key = _normalize_ai_city_key(item.get("city"))
        if key:
            thesis_by_city[key] = item
    forecast_by_city: Dict[str, Dict[str, Any]] = {}
    for item in city_forecasts:
        key = _normalize_ai_city_key(item.get("city"))
        if key:
            forecast_by_city[key] = item

    for row in rows:
        city_key = _normalize_ai_city_key(row.get("city"))
        display_key = _normalize_ai_city_key(row.get("city_display_name"))
        thesis = thesis_by_city.get(city_key) or thesis_by_city.get(display_key)
        forecast = forecast_by_city.get(city_key) or forecast_by_city.get(display_key)
        if thesis:
            row["ai_city_thesis_zh"] = thesis.get("thesis_zh") or thesis.get("summary_zh")
            row["ai_city_thesis_en"] = thesis.get("thesis_en") or thesis.get("summary_en")
            row["ai_city_confidence"] = thesis.get("confidence")
            row["ai_city_model_cluster_note"] = thesis.get("model_cluster_note")
        if forecast:
            row["ai_predicted_max"] = _safe_float(forecast.get("predicted_max"))
            row["ai_predicted_low"] = _safe_float(forecast.get("range_low"))
            row["ai_predicted_high"] = _safe_float(forecast.get("range_high"))
            row["ai_forecast_unit"] = forecast.get("unit") or row.get("temp_symbol")
            row["ai_forecast_confidence"] = forecast.get("confidence")
            row["ai_peak_window_zh"] = forecast.get("peak_window_zh")
            row["ai_peak_window_en"] = forecast.get("peak_window_en")
            row["ai_airport_metar_read_zh"] = forecast.get("metar_read_zh")
            row["ai_airport_metar_read_en"] = forecast.get("metar_read_en")
            row["ai_forecast_reason_zh"] = forecast.get("reasoning_zh")
            row["ai_forecast_reason_en"] = forecast.get("reasoning_en")
            row["ai_city_model_cluster_note"] = forecast.get("model_cluster_note") or row.get("ai_city_model_cluster_note")
            row["ai_city_thesis_zh"] = row.get("ai_city_thesis_zh") or forecast.get("reasoning_zh")
            row["ai_city_thesis_en"] = row.get("ai_city_thesis_en") or forecast.get("reasoning_en")

    for item in contract_notes:
        row = by_id.get(str(item.get("row_id")))
        if not row:
            continue
        row["ai_forecast_match"] = item.get("forecast_match") or item.get("match")
        row["ai_forecast_match_reason_zh"] = item.get("reason_zh") or item.get("reason")
        row["ai_forecast_match_reason_en"] = item.get("reason_en")

    for item in vetoed:
        row = by_id.get(str(item.get("row_id")))
        if not row:
            continue
        row["ai_decision"] = "veto"
        row["ai_reason_zh"] = item.get("reason_zh") or item.get("reason")
        row["ai_reason_en"] = item.get("reason_en")
    for item in downgraded:
        row = by_id.get(str(item.get("row_id")))
        if not row:
            continue
        row["ai_decision"] = "downgrade"
        row["ai_reason_zh"] = item.get("reason_zh") or item.get("reason")
        row["ai_reason_en"] = item.get("reason_en")
    for item in watchlist:
        row = by_id.get(str(item.get("row_id")))
        if not row:
            continue
        row["ai_watchlist_reason_zh"] = item.get("reason_zh") or item.get("reason")
        row["ai_watchlist_reason_en"] = item.get("reason_en")
    for fallback_rank, item in enumerate(recommendations, start=1):
        row_id = str(item.get("row_id"))
        row = by_id.get(row_id)
        if not row:
            continue
        if row_id in veto_ids:
            continue
        recommended_ids.add(row_id)
        row["ai_decision"] = str(item.get("decision") or "approve").strip().lower() or "approve"
        row["ai_rank"] = _safe_int(item.get("rank"), fallback_rank)
        row["ai_confidence"] = item.get("confidence")
        row["ai_reason_zh"] = item.get("reason_zh") or item.get("reason")
        row["ai_reason_en"] = item.get("reason_en")
        row["ai_model_cluster_note"] = item.get("model_cluster_note")

    for row in rows:
        row_id = str(row.get("id"))
        if row_id not in recommended_ids and row_id not in veto_ids and row_id not in downgrade_ids:
            row["ai_decision"] = row.get("ai_decision") or "neutral"
        if row_id in watchlist_ids and row.get("ai_decision") == "neutral":
            row["ai_decision"] = "watchlist"
        _apply_metar_gate_to_row(row)

    def _ai_sort_key(row: Dict[str, Any]) -> tuple:
        decision = str(row.get("ai_decision") or "").lower()
        if decision == "veto":
            tier = 3
        elif decision == "downgrade":
            tier = 2
        elif row.get("ai_rank") is not None:
            tier = 0
        else:
            tier = 1
        return (
            tier,
            _safe_int(row.get("ai_rank"), 999),
            -float(row.get("final_score") or 0.0),
            -float(row.get("edge_percent") or 0.0),
        )

    rows.sort(key=_ai_sort_key)
    top_signal = next(
        (row for row in rows if str(row.get("ai_decision") or "").lower() != "veto"),
        rows[0] if rows else None,
    )
    input_meta = ai_raw.get("_polyweather_input_meta")
    sent_cities = input_meta.get("sent_cities") if isinstance(input_meta, dict) else None
    sent_contracts = input_meta.get("sent_contracts") if isinstance(input_meta, dict) else None
    ai_scan = {
        "status": "ready",
        "stage": "completed",
        "model": SCAN_AI_MODEL,
        "cached": cached,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "snapshot_id": payload.get("snapshot_id"),
        "input_rows": input_rows if input_rows is not None else len(payload.get("rows") or []),
        "sent_rows": sent_contracts if sent_contracts is not None else min(len(payload.get("rows") or []), SCAN_AI_MAX_ROWS),
        "sent_cities": sent_cities,
        "sent_contracts": sent_contracts,
        "duration_ms": duration_ms,
        "timeout_sec": SCAN_AI_TIMEOUT_SEC,
        "cache_ttl_sec": SCAN_AI_CACHE_TTL_SEC,
        "provider": "deepseek",
        "base_url": SCAN_AI_BASE_URL,
        "summary_zh": ai_raw.get("summary_zh"),
        "summary_en": ai_raw.get("summary_en"),
        "city_forecasts": city_forecasts,
        "contract_notes": contract_notes,
        "city_theses": city_theses,
        "watchlist": watchlist,
        "recommended_count": sum(1 for row in rows if row.get("ai_rank") is not None),
        "vetoed_count": sum(1 for row in rows if row.get("ai_decision") == "veto"),
        "downgraded_count": sum(1 for row in rows if row.get("ai_decision") == "downgrade"),
        "watchlist_count": sum(1 for row in rows if row.get("ai_decision") == "watchlist"),
    }
    meta = ai_raw.get("_polyweather_meta")
    if isinstance(meta, dict):
        ai_scan["usage"] = meta.get("usage")
        ai_scan["finish_reason"] = meta.get("finish_reason")
    merged = {
        **payload,
        "rows": rows,
        "top_signal": top_signal,
        "ai_scan": ai_scan,
    }
    return merged


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
            "provider": "deepseek",
            "base_url": SCAN_AI_BASE_URL,
            "reason": reason,
        },
    }


def _resolve_time_range_dates(data: Dict[str, Any], time_range: str) -> List[str]:
    local_date = str(data.get("local_date") or "").strip()
    multi_model_daily = data.get("multi_model_daily") or {}
    available_dates = sorted(
        str(date_key).strip()
        for date_key in (multi_model_daily.keys() if isinstance(multi_model_daily, dict) else [])
        if str(date_key).strip()
    )

    if not local_date:
        return available_dates[:1]
    if time_range == "today":
        return [local_date]

    try:
        local_dt = datetime.fromisoformat(local_date)
    except Exception:
        return available_dates[:7] if time_range == "week" else available_dates[:1]

    if time_range == "tomorrow":
        target = (local_dt + timedelta(days=1)).strftime("%Y-%m-%d")
        if target in available_dates:
            return [target]
        future_dates = [date_key for date_key in available_dates if date_key > local_date]
        return future_dates[:1]

    if time_range == "week":
        target_dates = [date_key for date_key in available_dates if date_key >= local_date]
        if local_date not in target_dates:
            target_dates.insert(0, local_date)
        deduped: List[str] = []
        for date_key in target_dates:
            if date_key not in deduped:
                deduped.append(date_key)
            if len(deduped) >= 7:
                break
        return deduped

    return [local_date]


def _build_terminal_row(
    *,
    city: str,
    data: Dict[str, Any],
    scan: Dict[str, Any],
    row: Dict[str, Any],
) -> Dict[str, Any]:
    current = data.get("current") or {}
    multi_model_daily = data.get("multi_model_daily") or {}
    selected_date = str(row.get("selected_date") or scan.get("selected_date") or data.get("local_date") or "").strip()
    daily_entry = multi_model_daily.get(selected_date) if isinstance(multi_model_daily, dict) else {}
    if not isinstance(daily_entry, dict):
        daily_entry = {}

    display_name = str(data.get("display_name") or city).strip() or city
    market_slug = str(row.get("market_slug") or "").strip()
    side = str(row.get("side") or "").strip().lower()
    edge_percent = _safe_float(row.get("edge_percent"))
    final_score = _safe_float(row.get("final_score"))
    volume = _safe_float(row.get("volume")) or 0.0
    primary_signal = scan.get("primary_signal") or {}
    city_meta = CITIES.get(city) or {}
    tz_offset = _safe_int(city_meta.get("tz"), 0)
    market_region = _market_region_from_tz_offset(tz_offset)
    metar_context = _build_metar_decision_context(data)

    return {
        **row,
        "id": str(row.get("id") or f"{city}|{selected_date}|{market_slug}|{side}"),
        "city": city,
        "city_display_name": display_name,
        "trading_region": market_region["key"],
        "trading_region_label": market_region["label_en"],
        "trading_region_label_zh": market_region["label_zh"],
        "tz_offset_seconds": tz_offset,
        "selected_date": selected_date or None,
        "local_date": data.get("local_date"),
        "local_time": data.get("local_time"),
        "temp_symbol": data.get("temp_symbol"),
        "current_temp": current.get("temp"),
        "current_max_so_far": current.get("max_so_far"),
        "metar_context": metar_context,
        "metar_today_obs": metar_context.get("today_obs") or [],
        "metar_recent_obs": metar_context.get("recent_obs") or [],
        "settlement_today_obs": metar_context.get("settlement_today_obs") or [],
        "metar_status": {
            "available_for_today": metar_context.get("available_for_today"),
            "stale_for_today": metar_context.get("stale_for_today"),
            "last_observation_time": metar_context.get("last_observation_time"),
            "last_temp": metar_context.get("last_temp"),
        },
        "deb_prediction": ((daily_entry.get("deb") or {}).get("prediction") if isinstance(daily_entry.get("deb"), dict) else None)
        or ((data.get("deb") or {}).get("prediction") if isinstance(data.get("deb"), dict) else None),
        "display_name": display_name,
        "airport": ((data.get("risk") or {}).get("airport") if isinstance(data.get("risk"), dict) else None),
        "risk_level": ((data.get("risk") or {}).get("level") if isinstance(data.get("risk"), dict) else None),
        "distribution_bias": scan.get("distribution_bias"),
        "distribution_preview": scan.get("distribution_preview") or row.get("distribution_preview") or [],
        "distribution_full": scan.get("distribution_full") or scan.get("distribution_preview") or row.get("distribution_preview") or [],
        "model_cluster_sources": daily_entry.get("models") if isinstance(daily_entry.get("models"), dict) else data.get("multi_model"),
        "window_phase": row.get("window_phase") or scan.get("window_phase"),
        "window_score": row.get("window_score") if row.get("window_score") is not None else scan.get("window_score"),
        "signal_status": scan.get("signal_status"),
        "candidate_count": scan.get("candidate_count"),
        "resolved_market_type": scan.get("resolved_market_type") or "maxtemp",
        "market_key": f"{city}|{selected_date}|{market_slug}",
        "is_primary_signal": bool(primary_signal and primary_signal.get("id") == row.get("id")),
        "signal_confidence": final_score,
        "edge_percent": edge_percent,
        "final_score": final_score,
        "volume": volume,
    }


def _scan_city_terminal_rows(
    city: str,
    filters: Dict[str, Any],
    *,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    data = _analyze(
        city,
        force_refresh=force_refresh,
        include_llm_commentary=False,
        detail_mode="market",
    )
    target_dates = _resolve_time_range_dates(data, filters["time_range"])
    rows: List[Dict[str, Any]] = []
    primary_scores: List[float] = []
    candidate_total = 0

    for target_date in target_dates:
        payload = _build_city_market_scan_payload(
            data,
            market_slug=None,
            target_date=target_date,
            lite=True,
            scan_filters=filters,
        )
        scan = payload.get("market_scan") or {}
        candidate_total += int(scan.get("candidate_count") or 0)
        raw_rows = scan.get("scan_rows")
        if not isinstance(raw_rows, list) or not raw_rows:
            raw_rows = [scan.get("primary_signal")] if isinstance(scan.get("primary_signal"), dict) else []
        if not raw_rows:
            continue
        for raw_row in raw_rows:
            if not isinstance(raw_row, dict) or not raw_row:
                continue
            row = _build_terminal_row(
                city=city,
                data=data,
                scan=scan,
                row=raw_row,
            )
            rows.append(row)
            score = _safe_float(row.get("final_score"))
            if score is not None and row.get("is_primary_signal"):
                primary_scores.append(score)

    return {
        "city": city,
        "rows": rows,
        "candidate_total": candidate_total,
        "primary_scores": primary_scores,
    }


def _build_scan_terminal_payload_uncached(
    filters: Dict[str, Any],
    *,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    cached_entry = _get_scan_terminal_cache_entry(filters) or {}

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
            _set_scan_terminal_failure_state(filters, error_message=error_message)
            failed_entry = _get_scan_terminal_cache_entry(filters) or {}
            success_payload = failed_entry.get("success_payload")
            failed_at = failed_entry.get("last_failed_at")
            if isinstance(success_payload, dict) and success_payload:
                return _build_stale_scan_terminal_payload(
                    filters=filters,
                    success_payload=success_payload,
                    error_message=error_message,
                    failed_at=failed_at,
                )
            return _build_failed_scan_terminal_payload(
                filters=filters,
                error_message=error_message,
                failed_at=failed_at,
            )

        primary_rows: List[Dict[str, Any]] = []
        primary_scores: List[float] = []
        candidate_total = 0

        for result in city_results:
            candidate_total += int(result.get("candidate_total") or 0)
            primary_rows.extend(result.get("rows") or [])
            primary_scores.extend(result.get("primary_scores") or [])

        primary_rows.sort(
            key=lambda row: (
                float(row.get("final_score") or 0.0),
                float(row.get("edge_percent") or 0.0),
            ),
            reverse=True,
        )

        ranked_rows: List[Dict[str, Any]] = []
        for index, row in enumerate(primary_rows[: filters["limit"]], start=1):
            ranked_rows.append(
                {
                    **row,
                    "rank": index,
                }
            )

        if timed_out and not ranked_rows:
            success_payload = cached_entry.get("success_payload")
            if isinstance(success_payload, dict) and success_payload.get("rows"):
                return _build_stale_scan_terminal_payload(
                    filters=filters,
                    success_payload=success_payload,
                    error_message=timeout_message or "市场扫描快照正在刷新中",
                    failed_at=cached_entry.get("last_failed_at"),
                )

        unique_market_volume: Dict[str, float] = {}
        for row in primary_rows:
            market_key = str(row.get("market_key") or row.get("id") or "").strip()
            if not market_key:
                continue
            unique_market_volume[market_key] = max(
                unique_market_volume.get(market_key, 0.0),
                float(row.get("volume") or 0.0),
            )

        avg_edge = None
        if primary_rows:
            edge_values = [
                float(row.get("edge_percent") or 0.0)
                for row in primary_rows
                if _safe_float(row.get("edge_percent")) is not None
            ]
            if edge_values:
                avg_edge = sum(edge_values) / len(edge_values)

        avg_confidence = None
        if primary_scores:
            avg_confidence = sum(primary_scores) / len(primary_scores)

        top_signal = ranked_rows[0] if ranked_rows else None
        summary = {
            "recommended_count": len(primary_rows),
            "visible_count": len(ranked_rows),
            "candidate_total": candidate_total,
            "avg_edge_percent": avg_edge,
            "avg_primary_confidence": avg_confidence,
            "tradable_market_count": len(unique_market_volume),
            "total_volume": sum(unique_market_volume.values()),
            "resolved_market_type": "maxtemp",
            "total_city_count": len(city_names),
            "scanned_city_count": len(city_results),
            "failed_city_count": len(failed_cities),
        }
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
        payload["snapshot_id"] = _build_scan_terminal_snapshot_id(
            filters,
            ranked_rows,
            summary,
            top_signal,
        )

        _set_cached_scan_terminal_payload(filters, payload)
        return payload
    except Exception as exc:
        error_message = str(exc)
        logger.exception("scan terminal payload build failed: {}", error_message)
        _set_scan_terminal_failure_state(filters, error_message=error_message)
        success_payload = cached_entry.get("success_payload")
        failed_at = _get_scan_terminal_cache_entry(filters).get("last_failed_at") if _get_scan_terminal_cache_entry(filters) else None
        if isinstance(success_payload, dict) and success_payload:
            return _build_stale_scan_terminal_payload(
                filters=filters,
                success_payload=success_payload,
                error_message=error_message,
                failed_at=failed_at,
            )
        return _build_failed_scan_terminal_payload(
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
        cached = _get_cached_scan_terminal_payload(filters)
        if cached is not None:
            return cached

        cached_entry = _get_scan_terminal_cache_entry(filters) or {}
        success_payload = cached_entry.get("success_payload")
        if isinstance(success_payload, dict) and success_payload:
            started = _start_scan_terminal_background_refresh(filters)
            return _build_stale_scan_terminal_payload(
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
    if not str(os.getenv("POLYWEATHER_DEEPSEEK_API_KEY") or "").strip():
        return _build_scan_ai_unavailable_payload(
            payload,
            status="missing_key",
            reason="POLYWEATHER_DEEPSEEK_API_KEY is not configured",
        )

    cached = _get_cached_scan_ai_result(current_snapshot_id, filters)
    if cached is not None:
        logger.info(
            "scan terminal AI cache hit snapshot={} rows={}",
            current_snapshot_id,
            len(payload.get("rows") or []),
        )
        return _merge_scan_ai_result(
            payload,
            cached,
            cached=True,
            duration_ms=0,
            input_rows=len(payload.get("rows") or []),
        )

    try:
        ai_input = _build_scan_ai_prompt(payload)
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
        _set_cached_scan_ai_result(current_snapshot_id, filters, ai_raw)
        duration_ms = int((time.time() - ai_started_at) * 1000)
        logger.info(
            "scan terminal AI review complete snapshot={} duration_ms={} recommendations={} vetoed={} downgraded={}",
            current_snapshot_id,
            duration_ms,
            len(_normalize_ai_items(ai_raw.get("recommendations"))),
            len(_normalize_ai_items(ai_raw.get("vetoed"))),
            len(_normalize_ai_items(ai_raw.get("downgraded"))),
        )
        return _merge_scan_ai_result(
            payload,
            ai_raw,
            cached=False,
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
