from __future__ import annotations

import json
from typing import Any, Dict

from web.scan_city_ai_helpers import (
    CITY_AI_REQUIRED_FIELDS,
    CITY_AI_STREAM_PROVIDER_FIELDS,
    _city_ai_response_example,
    _city_ai_stream_response_example,
)

SCAN_CITY_AI_PROMPT_VERSION = "city-observation-read-v6"


def _normalize_locale(value: Any) -> str:
    text = str(value or "").strip().lower()
    return "en-US" if text.startswith("en") else "zh-CN"


def _observation_prompt_context(ai_input: Dict[str, Any]) -> Dict[str, Any]:
    observation_anchor = ai_input.get("observation_anchor") if isinstance(ai_input.get("observation_anchor"), dict) else {}
    is_airport_metar = observation_anchor.get("is_airport_metar") is not False
    return {
        "anchor": observation_anchor,
        "is_airport_metar": is_airport_metar,
        "read_label_zh": str(observation_anchor.get("read_label_zh") or ("机场报文解读" if is_airport_metar else "官方观测解读")),
        "instruction_zh": str(observation_anchor.get("instruction_zh") or ""),
    }


def build_city_ai_request_json(
    ai_input: Dict[str, Any],
    *,
    locale: str,
    model: str,
    max_tokens: int,
) -> Dict[str, Any]:
    normalized_locale = _normalize_locale(locale)
    context = _observation_prompt_context(ai_input)
    observation_label_zh = context["read_label_zh"]
    observation_instruction = context["instruction_zh"]
    system_prompt = (
        "你是 PolyWeather 的城市最高温 AI 预测员。你必须直接阅读用户给出的城市 JSON，"
        "判断该城市今日最高温路径。不要写套利、交易、BUY YES/NO、价格、edge 或 Kelly。"
        f"你的核心输出是：最终最高温点估计、置信区间、置信度、最终判断、{observation_label_zh}、判断依据和风险。"
        "必须综合 DEB 最终融合值、全部天气模型预测、实测序列、最新观测、峰值窗口、当地时间、季节背景。"
        f"{observation_instruction}"
        "如果实测温度与 DEB 预测走势出现偏差，要明确说明偏差方向和可能修正。"
        "你可以基于城市、时间、季节、站点位置、风向/风速、云、能见度、露点等判断风或天气是否可能影响温度路径，"
        "但必须使用“可能”“倾向”“需要确认”等非绝对表达。"
        "观测解读必须具体：写清楚最新观测/报文时间、温度、风向风速、云量/天气、能见度或露点中与温度路径相关的因素。"
        "涉及风时必须说明该风向对本城市/机场最高温路径倾向增温、降温还是中性，并给出理由；"
        "不得只写“风向切换可能冷平流”，必须说明是哪一类风向或哪段风向切换可能带来冷/暖平流。"
        "涉及 TAF 或云雨扰动时必须给出报文中的有效时间、BECMG/TEMPO/FM 时间窗或说明“未给出明确时间”；"
        "如果没有 TAF 时间依据，不要笼统写“峰值窗口云雨扰动风险”。"
        "如果峰值窗口尚未到来，不能过早下最终结论；如果峰值窗口已过或实测已创高，需要更重视最新实测。"
        "所有面向用户的自然语言字段必须同时填写简体中文和英文两套内容："
        "_zh 字段写简体中文，_en 字段写英文。前端会按用户界面语言直接切换字段，不能留空。"
        "risks 最多 2 条，每条必须包含触发条件或方向来源；reasoning、model_cluster_note 各 1 句，metar_read 用 1-2 句。"
        "只返回 JSON object，不要 Markdown。"
    )
    user_payload = {
        "locale": normalized_locale,
        "task": (
            "Return strict JSON with: predicted_max, range_low, range_high, unit, confidence, "
            "final_judgment_zh, final_judgment_en, metar_read_zh, metar_read_en, "
            "reasoning_zh, reasoning_en, risks_zh, risks_en, model_cluster_note_zh, model_cluster_note_en. "
            "Fill every *_zh field in Simplified Chinese and every *_en field in English in the same response. "
            "Use this exact JSON object shape; do not return an array, markdown, or prose outside JSON. "
            "Keep final_judgment one short decision sentence. metar_read must explain the latest observation source "
            "with report/observation time, temperature, wind direction/speed, cloud/weather/visibility/dewpoint if available. "
            "For wind, explicitly say whether the current wind tends to warm, cool, or be neutral for today's high, "
            "and why in local city/station context. If mentioning cold/warm advection, name the wind direction or "
            "direction shift responsible. If mentioning TAF risk, include the concrete TAF time window or say no "
            "explicit timing is available. model_cluster_note must state "
            "how many model sources are available, whether they support DEB, and whether the sample is too sparse. "
            "Keep the whole JSON compact."
        ),
        "required_json_keys": CITY_AI_REQUIRED_FIELDS,
        "json_example": _city_ai_response_example(str(ai_input.get("temp_symbol") or "°C")),
        "city_snapshot": ai_input,
    }
    return {
        "model": model,
        "temperature": 0.2,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": json.dumps(user_payload, ensure_ascii=False),
            },
        ],
        "_polyweather_user_payload": user_payload,
        "_polyweather_system_prompt": system_prompt,
    }


def build_city_ai_empty_retry_request(request_json: Dict[str, Any]) -> Dict[str, Any]:
    system_prompt = str(request_json.get("_polyweather_system_prompt") or "")
    user_payload = request_json.get("_polyweather_user_payload") if isinstance(request_json.get("_polyweather_user_payload"), dict) else {}
    retry_payload = {
        key: value
        for key, value in request_json.items()
        if not key.startswith("_polyweather_")
    }
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
                        str(user_payload.get("task") or "")
                        + " The previous response had empty content. Return only one compact JSON object now."
                    ),
                },
                ensure_ascii=False,
            ),
        },
    ]
    return retry_payload


def build_city_ai_repair_request_json(
    *,
    ai_input: Dict[str, Any],
    locale: str,
    model: str,
    max_tokens: int,
    previous_error: str,
    previous_content: str,
) -> Dict[str, Any]:
    normalized_locale = _normalize_locale(locale)
    return {
        "model": model,
        "temperature": 0.0,
        "max_tokens": min(max(max_tokens, 1200), 64000),
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
                        "required_schema": CITY_AI_REQUIRED_FIELDS,
                        "previous_error": previous_error,
                        "previous_assistant_content": previous_content,
                        "city_snapshot": ai_input,
                        "instruction": (
                            "Fill *_zh fields in Simplified Chinese and *_en fields in English; do not leave either language empty. "
                            "Make final_judgment one direct sentence about today's high temperature. "
                            "metar_read must interpret the latest observation source with report/observation time, temperature, "
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


def build_city_ai_stream_request(
    ai_input: Dict[str, Any],
    *,
    locale: str,
    model: str,
    max_tokens: int,
) -> Dict[str, Any]:
    normalized_locale = _normalize_locale(locale)
    context = _observation_prompt_context(ai_input)
    is_airport_metar = context["is_airport_metar"]
    role_label = "机场 METAR 解读与最高温预测员" if is_airport_metar else "官方观测站解读与最高温预测员"
    read_label = context["read_label_zh"]
    source_instruction = context["instruction_zh"]
    system_prompt = (
        f"你是 PolyWeather 的{role_label}。"
        "只返回一个紧凑 JSON object，不要 Markdown。"
        f"必须基于最新观测/报文判断该城市今日最高温，输出 metar_read_zh、metar_read_en、predicted_max、range_low、range_high、unit、confidence、final_judgment_zh、final_judgment_en、reasoning_zh、reasoning_en 字段，便于前端快速显示{read_label}和最高温预测；"
        "模型一致性和风险清单由后端规则补齐，不要生成这些字段。"
        f"{source_instruction}"
        "观测解读必须具体说明观测/报文时间、温度、风向风速、云量/天气/能见度/露点中与温度路径相关的因素；每个字段最多 1-2 句。"
        "涉及风时要说明当前风向对站点最高温路径倾向增温、降温还是中性，并给出理由。"
        "如果 observation_anchor.is_airport_metar 为 false，不得使用 METAR、TAF、机场报文等称谓。"
        "predicted_max 是根据最新观测和模型趋势给出的今日最高温数值预测（float），range_low/range_high 是预测区间，unit 为温度单位，confidence 为 low/medium/high。"
        "final_judgment 用一句话给出今日最高温结论。"
        "所有 *_zh 字段写简体中文，所有 *_en 字段写英文，不得留空。"
        "不要写交易建议、BUY/SELL、Kelly 或套利。"
    )
    return {
        "model": model,
        "temperature": 0.2,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
        "stream": True,
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "locale": normalized_locale,
                        "task": (
                            "Return JSON keys in this exact order: metar_read_zh, metar_read_en, predicted_max, range_low, range_high, unit, confidence, final_judgment_zh, final_judgment_en, reasoning_zh, reasoning_en. "
                            "predicted_max must be a float number representing today's predicted daily high temperature based on the latest observation and model trends. "
                            "Do not return risks or model_cluster_note. Keep it compact. "
                            "Return exactly one JSON object and no markdown."
                        ),
                        "required_json_keys": CITY_AI_STREAM_PROVIDER_FIELDS,
                        "json_example": _city_ai_stream_response_example(
                            str(ai_input.get("temp_symbol") or "°C")
                        ),
                        "city_snapshot": ai_input,
                    },
                    ensure_ascii=False,
                ),
            },
        ],
    }
