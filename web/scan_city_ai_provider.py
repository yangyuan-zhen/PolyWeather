from __future__ import annotations

import json
from typing import Any, Dict

import httpx
from loguru import logger

from web.scan_city_ai_fallback import (
    _build_city_ai_fallback,
    _complete_city_ai_payload,
)
from web.scan_city_ai_helpers import (
    _extract_ai_json_object,
    _extract_provider_content,
    _provider_response_meta,
    _truncate_ai_text,
)
from web.scan_city_ai_prompt import (
    _normalize_locale,
    build_city_ai_empty_retry_request,
    build_city_ai_repair_request_json,
    build_city_ai_request_json,
)


def _call_deepseek_city_ai(
    ai_input: Dict[str, Any],
    *,
    locale: str = "zh-CN",
    api_key: str,
    base_url: str,
    model: str,
    max_tokens: int,
    timeout_sec: int,
) -> Dict[str, Any]:
    if not api_key:
        raise RuntimeError("scan AI API key is not configured")
    normalized_locale = _normalize_locale(locale)
    timeout = httpx.Timeout(
        timeout=float(timeout_sec),
        connect=min(8.0, float(timeout_sec)),
        read=float(timeout_sec),
        write=10.0,
        pool=5.0,
    )
    request_json = build_city_ai_request_json(
        ai_input,
        locale=normalized_locale,
        model=model,
        max_tokens=max_tokens,
    )
    provider_request = {
        key: value
        for key, value in request_json.items()
        if not key.startswith("_polyweather_")
    }
    logger.info(
        "scan city AI provider request city={} locale={} input_bytes={} max_tokens={} timeout_sec={}",
        ai_input.get("city"),
        normalized_locale,
        len(json.dumps(provider_request, ensure_ascii=False, default=str).encode("utf-8")),
        request_json.get("max_tokens"),
        timeout_sec,
    )
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=timeout) as client:
        response = client.post(
            f"{base_url}/chat/completions",
            headers=headers,
            json=provider_request,
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
            retry_payload = build_city_ai_empty_retry_request(request_json)
            response = client.post(
                f"{base_url}/chat/completions",
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
            repair_payload = build_city_ai_repair_request_json(
                ai_input=ai_input,
                locale=normalized_locale,
                model=model,
                max_tokens=max_tokens,
                previous_error=str(exc),
                previous_content=_truncate_ai_text(content, 5000),
            )
            try:
                repair_response = client.post(
                    f"{base_url}/chat/completions",
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
                    return _complete_city_ai_payload(
                        parsed,
                        ai_input,
                        locale=normalized_locale,
                    )
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
    return _complete_city_ai_payload(
        parsed,
        ai_input,
        locale=normalized_locale,
    )
