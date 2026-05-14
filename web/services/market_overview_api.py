"""Market overview — AI summary of all scan terminal rows, cached 10 min."""

from __future__ import annotations

import hashlib
import json
import threading
import time
from datetime import datetime
from typing import Any, Dict, List

from loguru import logger

from web.scan_city_ai_helpers import _safe_float
from web.scan_terminal_service import (
    SCAN_AI_BASE_URL,
    SCAN_CITY_AI_MODEL,
    SCAN_CITY_AI_TIMEOUT_SEC,
    _scan_ai_api_key,
)

_OVERVIEW_CACHE: Dict[str, Dict[str, Any]] = {}
_OVERVIEW_CACHE_LOCK = threading.Lock()
_OVERVIEW_MAX_TOKENS = 600
_OVERVIEW_CACHE_TTL_SEC = 600


def _build_overview_ai_request(
    rows: List[Dict[str, Any]],
    locale: str,
) -> Dict[str, Any]:
    cities = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        city = row.get("city") or row.get("name") or ""
        if not city:
            continue
        model_cluster = row.get("model_cluster") if isinstance(row.get("model_cluster"), dict) else {}
        sources = model_cluster.get("sources") if isinstance(model_cluster.get("sources"), list) else []
        values = [
            _safe_float(s.get("value"))
            for s in sources
            if isinstance(s, dict) and _safe_float(s.get("value")) is not None
        ]
        deb_val = _safe_float(row.get("deb_prediction") or (row.get("deb") or {}).get("prediction"))
        cities.append(
            {
                "city": str(city),
                "display_name": row.get("display_name") or str(city),
                "local_date": row.get("local_date", ""),
                "deb": deb_val,
                "model_min": min(values) if values else None,
                "model_max": max(values) if values else None,
                "model_count": len(values),
                "current_temp": _safe_float(row.get("current_temp") or (row.get("current") or {}).get("temp")),
                "max_so_far": _safe_float(row.get("current_max_so_far") or row.get("max_so_far") or (row.get("current") or {}).get("max_so_far")),
                "risk_level": row.get("risk_level", ""),
                "temp_unit": row.get("temp_unit") or row.get("temp_symbol") or "°C",
            }
        )

    system_prompt = (
        "你是 PolyWeather 的天气市场概览员。基于全部城市的扫描数据，写一段今日市场概览。"
        "用 3-5 句概括：整体模型一致性、最值得关注的城市（模型分歧大或实测偏离集群）、异常信号。"
        "highlights 最多 5 个城市，每个城市一句话点出关键信号。"
        "只返回 JSON object，不要 Markdown。所有 *_zh 字段写简体中文，*_en 字段写英文。"
    )
    task = (
        "Return JSON: overview_zh, overview_en, highlights (array of {city, note_zh, note_en}, max 5). "
        "overview: 3-5 sentences covering model consensus, top divergence cities, anomalies. "
        "highlights: per-city one-sentence signal. Keep compact."
    )

    return {
        "model": SCAN_CITY_AI_MODEL,
        "temperature": 0.3,
        "max_tokens": _OVERVIEW_MAX_TOKENS,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "locale": locale,
                        "task": task,
                        "city_count": len(cities),
                        "cities": cities,
                    },
                    ensure_ascii=False,
                    default=str,
                ),
            },
        ],
    }


def _cache_key(rows: List[Dict[str, Any]], locale: str) -> str:
    finger = {
        "city_ids": sorted(
            row.get("city") or row.get("name") or ""
            for row in rows
            if isinstance(row, dict)
        ),
        "locale": locale,
    }
    raw = json.dumps(finger, sort_keys=True, ensure_ascii=False, default=str)
    return "overview:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build_market_overview_payload(
    rows: List[Dict[str, Any]],
    *,
    locale: str = "zh-CN",
    force_refresh: bool = False,
) -> Dict[str, Any]:
    if not rows:
        return {"overview_zh": "", "overview_en": "", "highlights": [], "generated_at": None}

    key = _cache_key(rows, locale)
    if not force_refresh:
        with _OVERVIEW_CACHE_LOCK:
            cached = _OVERVIEW_CACHE.get(key)
            if cached and cached.get("expires_at", 0) >= time.time():
                return cached["payload"]

    api_key = _scan_ai_api_key()
    if not api_key:
        return {
            "overview_zh": "AI 概览不可用（未配置 API Key）",
            "overview_en": "AI overview unavailable (API key not configured)",
            "highlights": [],
            "generated_at": datetime.utcnow().isoformat() + "Z",
        }

    import httpx

    request_json = _build_overview_ai_request(rows, locale)
    generated_at = datetime.utcnow().isoformat() + "Z"
    started = time.perf_counter()

    try:
        response = httpx.post(
            f"{SCAN_AI_BASE_URL}/chat/completions",
            json=request_json,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=min(SCAN_CITY_AI_TIMEOUT_SEC, 15),
        )
        response.raise_for_status()
        result = response.json()
        content = ((result.get("choices") or [{}])[0].get("message") or {}).get("content") or "{}"
        parsed = json.loads(content) if isinstance(content, str) else content
        if not isinstance(parsed, dict):
            raise ValueError("AI returned non-dict overview")

        payload: Dict[str, Any] = {
            "overview_zh": str(parsed.get("overview_zh") or parsed.get("overview_en") or ""),
            "overview_en": str(parsed.get("overview_en") or parsed.get("overview_zh") or ""),
            "highlights": [
                {
                    "city": str(h.get("city", "")),
                    "note_zh": str(h.get("note_zh", "")),
                    "note_en": str(h.get("note_en", "")),
                }
                for h in (parsed.get("highlights") if isinstance(parsed.get("highlights"), list) else [])
                if isinstance(h, dict)
            ][:5],
            "generated_at": generated_at,
        }
    except Exception as exc:
        logger.warning("Market overview AI failed: {}", exc)
        payload = {
            "overview_zh": "市场概览暂时无法生成，请稍后刷新。",
            "overview_en": "Market overview temporarily unavailable, please refresh later.",
            "highlights": [],
            "generated_at": generated_at,
        }

    duration_ms = int((time.perf_counter() - started) * 1000)
    logger.info(
        "market_overview cities={} locale={} duration_ms={} cached={}",
        len(rows),
        locale,
        duration_ms,
        False,
    )

    entry = {"expires_at": time.time() + _OVERVIEW_CACHE_TTL_SEC, "payload": payload}
    with _OVERVIEW_CACHE_LOCK:
        _OVERVIEW_CACHE[key] = entry

    return payload
