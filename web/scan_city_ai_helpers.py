from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

CITY_AI_REQUIRED_FIELDS = [
    "metar_read_zh",
    "metar_read_en",
    "taf_read_zh",
    "taf_read_en",
    "probability_read_zh",
    "probability_read_en",
    "final_judgment_zh",
    "final_judgment_en",
    "predicted_max",
    "range_low",
    "range_high",
    "unit",
    "confidence",
    "reasoning_zh",
    "reasoning_en",
    "risks_zh",
    "risks_en",
    "model_cluster_note_zh",
    "model_cluster_note_en",
]

CITY_AI_STREAM_PROVIDER_FIELDS = [
    "metar_read_zh",
    "metar_read_en",
    "taf_read_zh",
    "taf_read_en",
    "probability_read_zh",
    "probability_read_en",
    "predicted_max",
    "range_low",
    "range_high",
    "unit",
    "confidence",
    "final_judgment_zh",
    "final_judgment_en",
    "reasoning_zh",
    "reasoning_en",
]



def _safe_float(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except Exception:
        return None



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


def _decode_json_string_fragment(fragment: str) -> str:
    safe = str(fragment or "")
    while safe.endswith("\\"):
        safe = safe[:-1]
    try:
        return str(json.loads(f'"{safe}"'))
    except Exception:
        return (
            safe.replace('\\"', '"')
            .replace("\\n", "\n")
            .replace("\\r", "\r")
            .replace("\\t", "\t")
            .replace("\\\\", "\\")
        )


def _extract_json_string_field_fragment(raw_text: str, field: str) -> tuple[str, bool]:
    """Best-effort extraction from a streamed/incomplete JSON object.

    DeepSeek may stream useful fields first but still end with truncated JSON.
    In that case the UI should keep the AI text already received instead of
    replacing it with the deterministic DEB/METAR fallback.
    """

    text = str(raw_text or "")
    match = re.search(rf'"{re.escape(field)}"\s*:\s*"', text)
    if not match:
        return "", False
    idx = match.end()
    chars: List[str] = []
    escaped = False
    closed = False
    while idx < len(text):
        char = text[idx]
        idx += 1
        if escaped:
            chars.append("\\" + char)
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == '"':
            closed = True
            break
        chars.append(char)
    if escaped:
        chars.append("\\")
    return _decode_json_string_fragment("".join(chars)).strip(), closed


_CITY_AI_TEXT_FIELDS = {
    "metar_read_zh",
    "metar_read_en",
    "taf_read_zh",
    "taf_read_en",
    "probability_read_zh",
    "probability_read_en",
    "final_judgment_zh",
    "final_judgment_en",
    "reasoning_zh",
    "reasoning_en",
    "model_cluster_note_zh",
    "model_cluster_note_en",
}


_INCOMPLETE_TAIL_RE = re.compile(
    r"(?:(?:[，,；;]\s*)?(?:但|但是|不过|然而|而且|并且|因为|由于|若|如果|but|however|although|because|if|while|and)\s*)?"
    r"(?:TAF|METAR|报文|机场预报|机场报文)?\s*(?:显示|提示|预示|表明|show(?:s)?|indicate(?:s)?|suggest(?:s)?)?\s*$",
    re.IGNORECASE,
)


def _strip_incomplete_ai_sentence(value: Any) -> str:
    """Remove dangling provider fragments such as "但TAF显示".

    The city AI endpoint can fall back to partially streamed JSON. If the stream
    stops in the middle of a string, keeping the whole fragment produces broken
    UI text. Prefer the last complete sentence/clause; if the whole field is too
    incomplete, let schema completion use the deterministic fallback.
    """

    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if not text:
        return ""
    if re.search(r"[。！？.!?]$", text):
        return text

    stripped = _INCOMPLETE_TAIL_RE.sub("", text).rstrip(" ，,；;：:")
    if stripped != text:
        text = stripped.strip()
        if not text:
            return ""
        if re.search(r"[。！？.!?]$", text):
            return text
        return text.rstrip(" ，,；;：:") + ("." if re.search(r"[A-Za-z]$", text) else "。")

    # If the provider stopped after a semicolon/comma-delimited clause, keep the
    # complete preceding clause instead of showing a dangling tail.
    for punct in ("；", ";", "。", "！", "？", ".", "!", "?"):
        idx = text.rfind(punct)
        if idx >= 0:
            candidate = text[: idx + 1].strip()
            if len(candidate) >= 8:
                return candidate.rstrip("；;") + ("." if punct == ";" else "。" if punct == "；" else "")

    # If no dangling connector is visible, keep the provider text and add only
    # terminal punctuation. This avoids replacing otherwise useful long reads
    # just because the JSON string missed its closing quote.
    return text.rstrip(" ，,；;：:") + ("." if re.search(r"[A-Za-z]$", text) else "。")


def _extract_json_number_field_from_fragment(raw_text: str, field: str) -> Optional[float]:
    text = str(raw_text or "")
    match = re.search(rf'"{re.escape(field)}"\s*:\s*(-?\d+(?:\.\d+)?)', text)
    if not match:
        return None
    return _safe_float(match.group(1))


def _extract_city_ai_partial_fields(raw_text: str) -> Dict[str, Any]:
    text = str(raw_text or "")
    if not text.strip():
        return {}
    out: Dict[str, Any] = {}
    for field in (
        "metar_read_zh",
        "metar_read_en",
        "final_judgment_zh",
        "final_judgment_en",
        "reasoning_zh",
        "reasoning_en",
        "model_cluster_note_zh",
        "model_cluster_note_en",
        "confidence",
        "unit",
    ):
        value, closed = _extract_json_string_field_fragment(text, field)
        if value and field in _CITY_AI_TEXT_FIELDS and not closed:
            value = _strip_incomplete_ai_sentence(value)
        if value:
            out[field] = value
    for field in ("predicted_max", "range_low", "range_high"):
        value = _extract_json_number_field_from_fragment(text, field)
        if value is not None:
            out[field] = value
    return out


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




def _city_ai_response_example(unit: str) -> Dict[str, Any]:
    return {
        "metar_read_zh": f"最新观测显示 37.0{unit or '°C'}，观测时间 04:30Z；风和云量暂未显示强降温信号，后续观测用于确认升温路径。",
        "metar_read_en": f"The latest observation shows 37.0{unit or '°C'} at 04:30Z; wind and cloud signals do not yet show a strong cooling break, so later observations should confirm the warming path.",
        "taf_read_zh": "TAF 预报 14-16Z BECMG 18012KT，午后风向切换为海风可能抑制升温。",
        "taf_read_en": "TAF shows BECMG 18012KT during 14-16Z; afternoon onshore wind shift may cap warming.",
        "probability_read_zh": f"概率分布偏右，最高概率桶 42-43{unit or '°C'}（~35%），上方尾部延至 45{unit or '°C'}。",
        "probability_read_en": f"Distribution skews right; peak bucket 42-43{unit or '°C'} (~35%), upper tail to 45{unit or '°C'}.",
        "final_judgment_zh": f"预计最高温暂以 43.0{unit or '°C'} 附近为中枢。",
        "final_judgment_en": f"The expected daily high is centered near 43.0{unit or '°C'}.",
        "predicted_max": 43.0,
        "range_low": 42.0,
        "range_high": 44.0,
        "unit": unit or "°C",
        "confidence": "medium",
        "reasoning_zh": "DEB 与多数模型集中在同一温区，最新观测仍处于上午升温路径。",
        "reasoning_en": "DEB and most models cluster in the same temperature band, while the latest observation remains on a morning warming path.",
        "risks_zh": ["若后续观测升温放缓或云雨增强，需要下调中枢。"],
        "risks_en": ["If later observations show slower warming or stronger cloud/rain, revise the center lower."],
        "model_cluster_note_zh": "7/8 个模型落在 DEB ±2°C 内，模型支撑较集中。",
        "model_cluster_note_en": "7/8 models are within DEB ±2°C, so model support is clustered.",
    }


def _city_ai_stream_response_example(unit: str) -> Dict[str, Any]:
    return {
        "metar_read_zh": f"最新 METAR 显示 37.0{unit or '°C'}，报文时间 04:30Z；风和云量暂未显示强降温信号，后续报文用于确认升温路径。",
        "metar_read_en": f"The latest METAR shows 37.0{unit or '°C'} at 04:30Z; wind and cloud signals do not yet show a strong cooling break, so later reports should confirm the warming path.",
        "taf_read_zh": "TAF 预报 14-16Z BECMG 18012KT，午后风向转为海风可能抑制升温，需关注。",
        "taf_read_en": "TAF shows BECMG 18012KT during 14-16Z; afternoon onshore wind shift may cap further warming.",
        "probability_read_zh": f"概率分布偏右，最高概率桶 42-43{unit or '°C'}（~35%），上方尾部延至 45{unit or '°C'}。",
        "probability_read_en": f"Distribution skews right; peak bucket 42-43{unit or '°C'} (~35%), upper tail extends to 45{unit or '°C'}.",
        "predicted_max": 43.0,
        "range_low": 42.0,
        "range_high": 44.0,
        "unit": unit or "°C",
        "confidence": "medium",
        "final_judgment_zh": f"预计最高温暂以 43.0{unit or '°C'} 附近为中枢。",
        "final_judgment_en": f"The expected daily high is centered near 43.0{unit or '°C'}.",
        "reasoning_zh": "当前观测仍贴近上午升温路径，若后续风向转为海风或云雨增强，再下修最高温中枢。",
        "reasoning_en": "The latest observation still fits the morning warming path; revise the daily-high center lower if later wind turns onshore or cloud/rain strengthens.",
    }
