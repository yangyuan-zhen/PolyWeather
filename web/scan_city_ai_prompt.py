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
        "read_label_zh": str(observation_anchor.get("read_label_zh") or ("\u673a\u573a\u62a5\u6587\u89e3\u8bfb" if is_airport_metar else "\u5b98\u65b9\u89c2\u6d4b\u89e3\u8bfb")),
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
        "\u4f60\u662f PolyWeather \u7684\u57ce\u5e02\u6700\u9ad8\u6e29 AI \u9884\u6d4b\u5458\u3002\u4f60\u5fc5\u987b\u76f4\u63a5\u9605\u8bfb\u7528\u6237\u7ed9\u51fa\u7684\u57ce\u5e02 JSON\uff0c"
        "\u72ec\u7acb\u5224\u65ad\u8be5\u57ce\u5e02\u4eca\u65e5\u6700\u9ad8\u6e29\u8def\u5f84\u3002\u4e0d\u8981\u5199\u5957\u5229\u3001\u4ea4\u6613\u3001BUY YES/NO\u3001\u4ef7\u683c\u3001edge \u6216 Kelly\u3002"
        f"\u4f60\u7684\u6838\u5fc3\u8f93\u51fa\u662f\uff1a\u6700\u7ec8\u6700\u9ad8\u6e29\u70b9\u4f30\u8ba1\u3001\u7f6e\u4fe1\u533a\u95f4\u3001\u7f6e\u4fe1\u5ea6\u3001\u6700\u7ec8\u5224\u65ad\u3001{observation_label_zh}\u3001\u5224\u65ad\u4f9d\u636e\u548c\u98ce\u9669\u3002"
        "\u9884\u6d4b\u65b9\u6cd5\uff1a\u9996\u5148\u67e5\u770b model_cluster.sources \u4e2d\u7684\u5168\u90e8\u6a21\u578b\uff08\u542b DEB\uff09\u7684\u96c6\u4e2d\u533a\u95f4\u548c\u4e2d\u4f4d\u6570\u4f5c\u4e3a\u57fa\u7ebf\uff1b"
        "\u7136\u540e\u91cd\u70b9\u9605\u8bfb metar_context \u4e2d\u7684\u6700\u65b0\u89c2\u6d4b/\u62a5\u6587\uff08\u6e29\u5ea6\u8d8b\u52bf\u3001\u98ce\u5411\u98ce\u901f\u3001\u4e91\u91cf\u3001\u80fd\u89c1\u5ea6\u3001\u9732\u70b9\uff09\uff0c"
        "\u6839\u636e\u5b9e\u6d4b\u4fe1\u53f7\u72ec\u7acb\u5224\u65ad\u57fa\u7ebf\u5e94\u8be5\u662f\u4e0a\u4fee\u3001\u4e0b\u4fee\u8fd8\u662f\u7ef4\u6301\uff0c\u5e76\u5728 predicted_max \u4e2d\u7ed9\u51fa\u4f60\u7684\u72ec\u7acb\u5224\u65ad\u3002"
        "DEB \u53ea\u662f\u6a21\u578b\u96c6\u7fa4\u4e2d\u7684\u4e00\u4e2a\u878d\u5408\u53c2\u8003\uff0c\u4e0d\u5e94\u8be5\u76f4\u63a5\u7167\u642c\u4e3a predicted_max\uff1b"
        "\u4f60\u5fc5\u987b\u7efc\u5408\u6240\u6709\u6a21\u578b + \u89c2\u6d4b\u4fe1\u53f7\u540e\u7ed9\u51fa\u81ea\u5df1\u7684\u6570\u5b57\uff0c\u4e0e DEB \u6709\u5dee\u5f02\u662f\u6b63\u5e38\u7684\u3002"
        f"{observation_instruction}"
        "\u5982\u679c\u5b9e\u6d4b\u6e29\u5ea6\u4e0e\u6a21\u578b\u96c6\u7fa4\u8d70\u52bf\u51fa\u73b0\u504f\u5dee\uff0c\u8981\u660e\u786e\u8bf4\u660e\u504f\u5dee\u65b9\u5411\u548c\u53ef\u80fd\u4fee\u6b63\u3002"
        "\u4f60\u53ef\u4ee5\u57fa\u4e8e\u57ce\u5e02\u3001\u65f6\u95f4\u3001\u5b63\u8282\u3001\u7ad9\u70b9\u4f4d\u7f6e\u3001\u98ce\u5411/\u98ce\u901f\u3001\u4e91\u3001\u80fd\u89c1\u5ea6\u3001\u9732\u70b9\u7b49\u5224\u65ad\u98ce\u6216\u5929\u6c14\u662f\u5426\u53ef\u80fd\u5f71\u54cd\u6e29\u5ea6\u8def\u5f84\uff0c"
        "\u4f46\u5fc5\u987b\u4f7f\u7528\u201c\u53ef\u80fd\u201d\u201c\u503e\u5411\u201d\u201c\u9700\u8981\u786e\u8ba4\u201d\u7b49\u975e\u7edd\u5bf9\u8868\u8fbe\u3002"
        "\u89c2\u6d4b\u89e3\u8bfb\u5fc5\u987b\u5177\u4f53\uff1a\u5199\u6e05\u695a\u6700\u65b0\u89c2\u6d4b/\u62a5\u6587\u65f6\u95f4\u3001\u6e29\u5ea6\u3001\u98ce\u5411\u98ce\u901f\u3001\u4e91\u91cf/\u5929\u6c14\u3001\u80fd\u89c1\u5ea6\u6216\u9732\u70b9\u4e2d\u4e0e\u6e29\u5ea6\u8def\u5f84\u76f8\u5173\u7684\u56e0\u7d20\u3002"
        "\u6d89\u53ca\u98ce\u65f6\u5fc5\u987b\u8bf4\u660e\u8be5\u98ce\u5411\u5bf9\u672c\u57ce\u5e02/\u673a\u573a\u6700\u9ad8\u6e29\u8def\u5f84\u503e\u5411\u589e\u6e29\u3001\u964d\u6e29\u8fd8\u662f\u4e2d\u6027\uff0c\u5e76\u7ed9\u51fa\u7406\u7531\uff1b"
        "\u4e0d\u5f97\u53ea\u5199\u201c\u98ce\u5411\u5207\u6362\u53ef\u80fd\u51b7\u5e73\u6d41\u201d\uff0c\u5fc5\u987b\u8bf4\u660e\u662f\u54ea\u4e00\u7c7b\u98ce\u5411\u6216\u54ea\u6bb5\u98ce\u5411\u5207\u6362\u53ef\u80fd\u5e26\u6765\u51b7/\u6696\u5e73\u6d41\u3002"
        "\u6d89\u53ca TAF \u6216\u4e91\u96e8\u6270\u52a8\u65f6\u5fc5\u987b\u7ed9\u51fa\u62a5\u6587\u4e2d\u7684\u6709\u6548\u65f6\u95f4\u3001BECMG/TEMPO/FM \u65f6\u95f4\u7a97\u6216\u8bf4\u660e\u201c\u672a\u7ed9\u51fa\u660e\u786e\u65f6\u95f4\u201d\uff1b"
        "\u5982\u679c\u6ca1\u6709 TAF \u65f6\u95f4\u4f9d\u636e\uff0c\u4e0d\u8981\u7b3c\u7edf\u5199\u201c\u5cf0\u503c\u7a97\u53e3\u4e91\u96e8\u6270\u52a8\u98ce\u9669\u201d\u3002"
        "\u5982\u679c\u5cf0\u503c\u7a97\u53e3\u5c1a\u672a\u5230\u6765\uff0c\u4e0d\u80fd\u8fc7\u65e9\u4e0b\u6700\u7ec8\u7ed3\u8bba\uff1b\u5982\u679c\u5cf0\u503c\u7a97\u53e3\u5df2\u8fc7\u6216\u5b9e\u6d4b\u5df2\u521b\u9ad8\uff0c\u9700\u8981\u66f4\u91cd\u89c6\u6700\u65b0\u5b9e\u6d4b\u3002"
        "\u6240\u6709\u9762\u5411\u7528\u6237\u7684\u81ea\u7136\u8bed\u8a00\u5b57\u6bb5\u5fc5\u987b\u540c\u65f6\u586b\u5199\u7b80\u4f53\u4e2d\u6587\u548c\u82f1\u6587\u4e24\u5957\u5185\u5bb9\uff1a"
        "_zh \u5b57\u6bb5\u5199\u7b80\u4f53\u4e2d\u6587\uff0c_en \u5b57\u6bb5\u5199\u82f1\u6587\u3002\u524d\u7aef\u4f1a\u6309\u7528\u6237\u754c\u9762\u8bed\u8a00\u76f4\u63a5\u5207\u6362\u5b57\u6bb5\uff0c\u4e0d\u80fd\u7559\u7a7a\u3002"
        "risks \u6700\u591a 2 \u6761\uff0c\u6bcf\u6761\u5fc5\u987b\u5305\u542b\u89e6\u53d1\u6761\u4ef6\u6216\u65b9\u5411\u6765\u6e90\uff1breasoning\u3001model_cluster_note \u5404 1 \u53e5\uff0cmetar_read \u7528 1-2 \u53e5\u3002"
        "\u53ea\u8fd4\u56de JSON object\uff0c\u4e0d\u8981 Markdown\u3002"
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
            "how many model sources are available, the cluster range and median, whether the spread is tight or wide, "
            "and whether you adjusted above or below the cluster median based on observation signals. "
            "Keep the whole JSON compact."
        ),
        "required_json_keys": CITY_AI_REQUIRED_FIELDS,
        "json_example": _city_ai_response_example(str(ai_input.get("temp_symbol") or "\u00b0C")),
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
        f"必须基于最新观测/报文独立判断该城市今日最高温，输出 metar_read_zh、metar_read_en、predicted_max、range_low、range_high、unit、confidence、final_judgment_zh、final_judgment_en、reasoning_zh、reasoning_en 字段，便于前端快速显示{read_label}和最高温预测；"
        "模型一致性和风险清单由后端规则补齐，不要生成这些字段。"
        f"预测方法：先看 model_cluster.sources 中各模型（含 DEB）的集中区间作为基线；"
        "然后重点阅读 metar_context 中的报文/观测信号——温度趋势、风向风速、云量、能见度——"
        "独立判断 predicted_max 应该落在基线区间的哪个位置（偏上/偏下/中枢），不要直接照搬 DEB 的值。"
        f"{source_instruction}"
        "观测解读必须具体说明观测/报文时间、温度、风向风速、云量/天气/能见度/露点中与温度路径相关的因素；每个字段最多 1-2 句。"
        "涉及风时要说明当前风向对站点最高温路径倾向增温、降温还是中性，并给出理由。"
        "如果 observation_anchor.is_airport_metar 为 false，不得使用 METAR、TAF、机场报文等称谓。"
        "predicted_max 是你的独立预测值（float），range_low/range_high 是预测区间，unit 为温度单位，confidence 为 low/medium/high。"
        "final_judgment 用一句话给出今日最高温结论。reasoning 必须解释你相对于模型集群基线做了哪种修正及原因。"
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
                            "predicted_max must be your independent float prediction, based on model cluster baseline adjusted by the latest METAR/observation signals. "
                            "Do not copy DEB directly — use the full model spread + your own reading of wind, cloud, temperature trend from the bulletin. "
                            "reasoning must explain what adjustment you made relative to the model cluster and why. "
                            "Do not return risks or model_cluster_note. Keep it compact. "
                            "Return exactly one JSON object and no markdown."
                        ),
                        "required_json_keys": CITY_AI_STREAM_PROVIDER_FIELDS,
                        "json_example": _city_ai_stream_response_example(
                            str(ai_input.get("temp_symbol") or "\u00b0C")
                        ),
                        "city_snapshot": ai_input,
                    },
                    ensure_ascii=False,
                ),
            },
        ],
    }
