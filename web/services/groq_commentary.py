"""Groq-backed bilingual commentary enrichment."""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
from typing import Any, Dict, Optional

import httpx
from loguru import logger

_GROQ_COMMENTARY_CACHE_LOCK = threading.Lock()
_GROQ_COMMENTARY_CACHE: Dict[str, Dict[str, Any]] = {}
_GROQ_COMMENTARY_CACHE_TTL_SEC = int(
    os.getenv("POLYWEATHER_GROQ_COMMENTARY_CACHE_TTL_SEC", "1800")
)


def groq_commentary_enabled() -> bool:
    enabled = str(
        os.getenv("POLYWEATHER_GROQ_COMMENTARY_ENABLED", "false")
    ).strip().lower()
    api_key = str(os.getenv("GROQ_API_KEY") or "").strip()
    return enabled in {"1", "true", "yes", "on"} and bool(api_key)


def clean_commentary_text(value: Any, *, limit: int = 240) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text)
    return text[:limit].strip()


def build_groq_commentary_context(result: Dict[str, Any]) -> Dict[str, Any]:
    dynamic = result.get("dynamic_commentary") or {}
    vertical = result.get("vertical_profile_signal") or {}
    taf_signal = ((result.get("taf") or {}).get("signal") or {}) if isinstance(result.get("taf"), dict) else {}
    network = result.get("network_lead_signal") or {}
    peak = result.get("peak") or {}
    current = result.get("current") or {}
    airport_primary = result.get("airport_primary") or {}
    notes = dynamic.get("notes") if isinstance(dynamic.get("notes"), list) else []
    compact_notes = [clean_commentary_text(item, limit=180) for item in notes]
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
        "network_lead_note": clean_commentary_text(network.get("note"), limit=180),
        "rules_summary": clean_commentary_text(dynamic.get("summary"), limit=260),
        "rules_notes": compact_notes,
        "upper_air_summary_zh": clean_commentary_text(vertical.get("summary_zh"), limit=260),
        "upper_air_summary_en": clean_commentary_text(vertical.get("summary_en"), limit=260),
        "taf_summary_zh": clean_commentary_text(taf_signal.get("summary_zh"), limit=220),
        "taf_summary_en": clean_commentary_text(taf_signal.get("summary_en"), limit=220),
        "taf_peak_window": clean_commentary_text(taf_signal.get("peak_window"), limit=80),
    }


def normalize_groq_commentary_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    def _headline(value: Any, fallback: str) -> str:
        text = clean_commentary_text(value, limit=90)
        return text or fallback

    def _bullets(value: Any) -> list[str]:
        items = value if isinstance(value, list) else []
        cleaned = [clean_commentary_text(item, limit=120) for item in items]
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


def request_groq_commentary(context: Dict[str, Any]) -> Optional[Dict[str, Any]]:
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
        return normalize_groq_commentary_payload(json.loads(str(content)))
    except Exception:
        logger.warning("Groq commentary returned non-JSON payload")
        return None


def maybe_enrich_dynamic_commentary_with_groq(
    city: str,
    result: Dict[str, Any],
) -> Dict[str, Any]:
    dynamic = result.get("dynamic_commentary") or {}
    if not groq_commentary_enabled():
        return dynamic
    if dynamic.get("headline_zh") and dynamic.get("bullets_zh"):
        return dynamic

    context = build_groq_commentary_context(result)
    if not context.get("rules_summary") and not context.get("rules_notes"):
        return dynamic

    cache_key = hashlib.sha256(
        json.dumps({"city": city, "context": context}, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    now = time.time()
    with _GROQ_COMMENTARY_CACHE_LOCK:
        cached = _GROQ_COMMENTARY_CACHE.get(cache_key)
        if cached and now - float(cached.get("t") or 0) < _GROQ_COMMENTARY_CACHE_TTL_SEC:
            merged = dict(dynamic)
            merged.update(cached.get("payload") or {})
            return merged

    try:
        enriched = request_groq_commentary(context)
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
