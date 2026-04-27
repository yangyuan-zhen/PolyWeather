from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

CITY_AI_REQUIRED_FIELDS = [
    "metar_read_zh",
    "metar_read_en",
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


def _format_ai_temperature(value: Any, unit: str) -> Optional[str]:
    numeric = _safe_float(value)
    if numeric is None:
        return None
    return f"{numeric:.1f}{unit or ''}"


def _city_ai_model_cluster_note(ai_input: Dict[str, Any], *, locale: str) -> str:
    observation_anchor = ai_input.get("observation_anchor") if isinstance(ai_input.get("observation_anchor"), dict) else {}
    is_hko_observation = observation_anchor.get("is_airport_metar") is False
    observation_label = (
        "HKO observations"
        if locale == "en-US" and is_hko_observation
        else "香港天文台观测"
        if is_hko_observation
        else "METAR"
    )
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
            return f"No usable model cluster was returned; rely on DEB and {observation_label} only."
        if count <= 2:
            return f"Only {count} model source(s) are available, so model support is thin and should be treated as context."
        range_text = f"{min(values):.1f}{unit} to {max(values):.1f}{unit}"
        if deb_value is None:
            return f"{count} model sources cluster between {range_text}; DEB support cannot be cross-checked."
        supporting = sum(1 for value in values if abs(value - deb_value) <= 2.0)
        return f"{supporting}/{count} model sources sit within 2{unit} of DEB; model range is {range_text}."
    if count <= 0:
        return f"没有可用的多模型集合，只能把 DEB 与{observation_label}作为主要依据。"
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
    observation_anchor = ai_input.get("observation_anchor") if isinstance(ai_input.get("observation_anchor"), dict) else {}
    is_airport_metar = observation_anchor.get("is_airport_metar") is not False
    airport_current = ai_input.get("airport_current") if isinstance(ai_input.get("airport_current"), dict) else {}
    current_obs = ai_input.get("current") if isinstance(ai_input.get("current"), dict) else {}
    metar_context = ai_input.get("metar_context") if isinstance(ai_input.get("metar_context"), dict) else {}
    observation_stale = bool(
        metar_context.get("stale_for_today")
        or airport_current.get("stale_for_today")
        or current_obs.get("stale_for_today")
    )
    current_temp = _safe_float(
        airport_current.get("temp") if is_airport_metar else current_obs.get("temp")
    )
    current_max_so_far = _safe_float(
        ai_input.get("current_max_so_far")
        or current_obs.get("max_so_far")
        or airport_current.get("max_so_far")
    )
    observed_high_so_far = max(
        [value for value in (current_temp, current_max_so_far) if value is not None],
        default=None,
    )
    observed_high_for_revision = None if observation_stale else observed_high_so_far
    predicted = deb_value
    if predicted is None and values:
        predicted = sum(values) / len(values)
    if predicted is None:
        predicted = observed_high_so_far
    range_low = min(values) if values else predicted
    range_high = max(values) if values else predicted
    peak = ai_input.get("peak") if isinstance(ai_input.get("peak"), dict) else {}
    window_phase = str(
        ai_input.get("window_phase")
        or peak.get("window_phase")
        or peak.get("phase")
        or ""
    ).strip().lower()
    remaining_window_minutes = _safe_float(
        ai_input.get("remaining_window_minutes")
        if ai_input.get("remaining_window_minutes") is not None
        else peak.get("remaining_window_minutes")
        if peak.get("remaining_window_minutes") is not None
        else peak.get("remaining_minutes")
    )
    minutes_until_peak_start = _safe_float(
        ai_input.get("minutes_until_peak_start")
        if ai_input.get("minutes_until_peak_start") is not None
        else peak.get("minutes_until_peak_start")
    )
    minutes_until_peak_end = _safe_float(
        ai_input.get("minutes_until_peak_end")
        if ai_input.get("minutes_until_peak_end") is not None
        else peak.get("minutes_until_peak_end")
    )
    peak_window_label = str(
        ai_input.get("peak_window_label")
        or peak.get("peak_window_label")
        or peak.get("label")
        or ""
    ).strip()
    peak_has_passed = (
        window_phase in {"post_peak", "past"}
        or (minutes_until_peak_end is not None and minutes_until_peak_end < 0)
    )
    peak_is_closing = (
        window_phase == "active_peak"
        and remaining_window_minutes is not None
        and remaining_window_minutes <= 90
    )
    peak_not_started = (
        window_phase in {"early_today", "setup_today", "tomorrow", "week_ahead"}
        or (minutes_until_peak_start is not None and minutes_until_peak_start > 0)
    )
    model_range_high = range_high
    model_range_low = range_low
    current_above_predicted = (
        observed_high_for_revision is not None
        and predicted is not None
        and observed_high_for_revision > predicted + 0.2
    )
    current_above_model_range = (
        observed_high_for_revision is not None
        and model_range_high is not None
        and observed_high_for_revision > model_range_high + 0.2
    )
    observed_high_break = bool(current_above_predicted or current_above_model_range)
    current_below_predicted = (
        observed_high_for_revision is not None
        and predicted is not None
        and observed_high_for_revision < predicted - 1.5
    )
    current_below_model_range = (
        observed_high_for_revision is not None
        and model_range_low is not None
        and observed_high_for_revision < model_range_low - 0.2
    )
    observed_low_break = bool(current_below_predicted and (peak_has_passed or peak_is_closing))
    observed_low_lag = bool(current_below_predicted and not observed_low_break)
    original_predicted = predicted
    if observed_high_break:
        predicted = max(
            value
            for value in (predicted, observed_high_for_revision)
            if value is not None
        )
        if range_high is not None and observed_high_for_revision is not None:
            range_high = max(range_high, observed_high_for_revision)
    elif observed_low_break:
        predicted = min(
            value
            for value in (predicted, observed_high_for_revision)
            if value is not None
        )
        if range_low is not None and observed_high_for_revision is not None:
            range_low = min(range_low, observed_high_for_revision)
    city = str(ai_input.get("city_display_name") or ai_input.get("city") or "this city")
    station = str((airport_current.get("station_code") if is_airport_metar else None) or observation_anchor.get("station_code") or current_obs.get("station_code") or "")
    raw_metar = str(airport_current.get("raw_metar") or "").strip() if is_airport_metar else ""
    metar_temp = _format_ai_temperature((airport_current.get("temp") if is_airport_metar else current_obs.get("temp")), unit)
    obs_time = str((airport_current.get("report_time") or airport_current.get("obs_time")) if is_airport_metar else (current_obs.get("obs_time") or current_obs.get("report_time") or "")).strip()
    source_name_zh = "METAR" if is_airport_metar else "香港天文台观测"
    source_name_en = "METAR" if is_airport_metar else "Hong Kong Observatory observation"
    bulletin_zh = "机场报文" if is_airport_metar else "官方观测"
    bulletin_en = "airport-bulletin" if is_airport_metar else "official-station observation"
    model_note_zh = _city_ai_model_cluster_note(ai_input, locale="zh-CN")
    model_note_en = _city_ai_model_cluster_note(ai_input, locale="en-US")
    content_preview = _truncate_ai_text(raw_content, 1000)
    partial_ai = _extract_city_ai_partial_fields(raw_content)
    looks_like_truncated_json = bool(content_preview.startswith("{") and not content_preview.rstrip().endswith("}"))
    reason_preview = _truncate_ai_text(reason, 260)
    reason_lower = str(reason or "").lower()
    timed_out = "timeout" in reason_lower or "timed out" in reason_lower or "超时" in str(reason or "")
    if partial_ai.get("metar_read_zh") or partial_ai.get("metar_read_en"):
        metar_zh = str(partial_ai.get("metar_read_zh") or partial_ai.get("metar_read_en") or "").strip()
        metar_en = str(partial_ai.get("metar_read_en") or partial_ai.get("metar_read_zh") or "").strip()
    elif content_preview and not looks_like_truncated_json:
        metar_zh = f"{bulletin_zh}快速解读已先完成；AI 补充摘要：{content_preview}"
        metar_en = f"The fast {bulletin_en} read is available; AI supplemental summary: {content_preview}"
    elif content_preview:
        metar_zh = f"{bulletin_zh}快速解读已先完成；本轮 AI 增强未完整返回，当前以 DEB、多模型与{source_name_zh}为准。"
        metar_en = f"The fast {bulletin_en} read is available; this AI enhancement was incomplete, so DEB, model cluster and {source_name_en} carry the read."
    elif raw_metar and observation_stale:
        metar_zh = f"{station} 可用 METAR 显示 {metar_temp or '温度未知'}，报文时间 {obs_time or '未知'}；但该观测已标记为过旧，当前只能作为背景参考，不能作为强实况锚点。"
        metar_en = f"{station} available METAR shows {metar_temp or 'unknown temperature'} at {obs_time or 'unknown time'}, but the observation is flagged as stale, so treat it as background context rather than a strong live anchor."
    elif raw_metar:
        metar_zh = f"{station} 最新 METAR 显示 {metar_temp or '温度未知'}，报文时间 {obs_time or '未知'}；当前先把它作为实况锚点，并结合后续报文确认温度路径。"
        metar_en = f"{station} latest METAR shows {metar_temp or 'unknown temperature'} at {obs_time or 'unknown time'}; use it as the live anchor while later reports confirm the path."
    else:
        metar_zh = f"当前没有可用的{source_name_zh}正文，暂以 DEB、多模型路径与最新实测为主。"
        metar_en = f"No raw {source_name_en} text is available, so DEB, latest observations and the model cluster carry the read."
    predicted_text = _format_ai_temperature(predicted, unit) or "--"
    current_text = _format_ai_temperature(observed_high_so_far, unit) or "--"
    original_predicted_text = _format_ai_temperature(original_predicted, unit) or "--"
    model_range_high_text = _format_ai_temperature(model_range_high, unit) or "--"
    model_range_low_text = _format_ai_temperature(model_range_low, unit) or "--"
    peak_label_text_zh = f"（{peak_window_label}）" if peak_window_label else ""
    peak_label_text_en = f" ({peak_window_label})" if peak_window_label else ""
    if partial_ai.get("final_judgment_zh") or partial_ai.get("final_judgment_en"):
        final_zh = str(partial_ai.get("final_judgment_zh") or partial_ai.get("final_judgment_en") or "").strip()
        final_en = str(partial_ai.get("final_judgment_en") or partial_ai.get("final_judgment_zh") or "").strip()
    elif partial_ai:
        final_zh = f"{city} 预计最高温暂以 {predicted_text} 附近为中枢；AI 已先完成{bulletin_zh}解读，最高温结论结合 DEB、多模型与最新实测校准。"
        final_en = f"{city} daily high is centered near {predicted_text}; AI has already read the {bulletin_en}, with the high calibrated against DEB, the model cluster and latest observations."
    elif observed_high_break:
        final_zh = f"{city} 最新实测已达 {current_text}，高于原先 {original_predicted_text} 中枢；最高温中枢需先上修到至少 {predicted_text} 附近。"
        final_en = f"{city} latest observation has reached {current_text}, above the prior {original_predicted_text} center; the daily-high center should be revised up to at least near {predicted_text}."
    elif observed_low_break:
        final_zh = f"{city} 峰值窗口{peak_label_text_zh}已过或接近结束，实测最高仍约 {current_text}，低于原先 {original_predicted_text} 中枢；最高温中枢需先下修到 {predicted_text} 附近。"
        final_en = f"{city} peak window{peak_label_text_en} has passed or is nearly over, and observed high is still near {current_text}, below the prior {original_predicted_text} center; revise the daily-high center down toward {predicted_text}."
    elif peak_has_passed:
        final_zh = f"{city} 峰值窗口{peak_label_text_zh}已过；最高温暂以 {predicted_text} 附近为中枢，并以已观测到的高点为主要校准。"
        final_en = f"{city} peak window{peak_label_text_en} has passed; the daily high stays centered near {predicted_text}, calibrated mainly against the observed high so far."
    elif observation_stale:
        final_zh = f"{city} 最高温暂以 {predicted_text} 附近为中枢；当前可用{source_name_zh}已过旧，先以 DEB 和多模型路径为主。"
        final_en = f"{city} daily high is centered near {predicted_text}; the available {source_name_en} is stale, so DEB and the model path carry the read for now."
    elif timed_out:
        final_zh = f"{city} 预计最高温暂以 {predicted_text} 附近为中枢；当前已先用 DEB、多模型和{source_name_zh}快速证据模式判断。"
        final_en = f"{city} daily high is centered near {predicted_text}; the current read uses the fast DEB/model/{source_name_en} evidence mode."
    else:
        final_zh = f"{city} 预计最高温暂以 {predicted_text} 附近为中枢；当前已先用 DEB、多模型和{source_name_zh}快速证据模式判断。"
        final_en = f"{city} daily high is centered near {predicted_text}; the current read uses the fast DEB/model/{source_name_en} evidence mode."
    if partial_ai:
        fallback_reasoning_zh = f"AI {bulletin_zh}解读已用于校准日内节奏；DEB 与多模型集合继续约束最高温中枢，后续{source_name_zh}用于确认是否需要上调或下修。"
        fallback_reasoning_en = f"The AI {bulletin_en} read is already used to calibrate the intraday pace; DEB and the model cluster still constrain the high-temperature center, while later {source_name_en} updates confirm whether to revise it."
    elif observed_high_break:
        fallback_reasoning_zh = f"当前为快速证据模式；最新{source_name_zh}已高于原先 {original_predicted_text} 中枢{('，并超过模型上沿 ' + model_range_high_text) if current_above_model_range else ''}，本轮最高温判断应优先承认实测突破并等待完整 AI {bulletin_zh}解读合并。"
        fallback_reasoning_en = f"This is the fast evidence mode; latest {source_name_en} is above the prior {original_predicted_text} center{(' and above the model upper edge ' + model_range_high_text) if current_above_model_range else ''}, so the high-temperature read should first acknowledge the observed break and merge the full AI {bulletin_en} read when available."
    elif observed_low_break:
        fallback_reasoning_zh = f"当前为快速证据模式；峰值窗口已过或接近结束，最新实测高点仍低于原先 {original_predicted_text} 中枢{('，并低于模型下沿 ' + model_range_low_text) if current_below_model_range else ''}，本轮最高温判断应优先承认下修压力并等待完整 AI {bulletin_zh}解读合并。"
        fallback_reasoning_en = f"This is the fast evidence mode; the peak window has passed or is nearly over, and the observed high remains below the prior {original_predicted_text} center{(' and below the model lower edge ' + model_range_low_text) if current_below_model_range else ''}, so the high-temperature read should first acknowledge downward revision pressure and merge the full AI {bulletin_en} read when available."
    elif observed_low_lag and peak_not_started:
        fallback_reasoning_zh = f"当前为快速证据模式；最新{source_name_zh}仍低于原先 {original_predicted_text} 中枢，但峰值窗口尚未到来，暂不直接下修，只把后续升温是否追上模型路径作为关键确认。"
        fallback_reasoning_en = f"This is the fast evidence mode; latest {source_name_en} remains below the prior {original_predicted_text} center, but the peak window has not arrived, so do not revise down yet and use later warming as the key confirmation."
    elif peak_has_passed:
        fallback_reasoning_zh = f"当前为快速证据模式；峰值窗口已过，后续{source_name_zh}主要用于确认是否已形成日内高点，而不是继续按待升温路径解读。"
        fallback_reasoning_en = f"This is the fast evidence mode; the peak window has passed, so later {source_name_en} updates mainly confirm whether the daily high is already set rather than assuming further warming."
    elif observation_stale:
        fallback_reasoning_zh = f"当前为快速证据模式；可用{source_name_zh}已过旧，不能作为强实况锚点，暂由 DEB 和多模型集合支撑本轮最高温中枢，等待新的{source_name_zh}确认。"
        fallback_reasoning_en = f"This is the fast evidence mode; the available {source_name_en} is stale and should not be used as a strong live anchor, so DEB and the model cluster carry the current daily-high center until a newer {source_name_en} confirms it."
    else:
        fallback_reasoning_zh = f"当前为快速证据模式；DEB、多模型集合和最新{source_name_zh}共同支撑本轮最高温中枢，完整 AI {bulletin_zh}解读返回后再合并。"
        fallback_reasoning_en = f"This is the fast evidence mode; DEB, the model cluster and latest {source_name_en} jointly support the current daily-high center, and the full AI {bulletin_en} read will be merged when available."
    reasoning_zh = str(partial_ai.get("reasoning_zh") or "").strip() or fallback_reasoning_zh
    reasoning_en = str(partial_ai.get("reasoning_en") or "").strip() or fallback_reasoning_en
    if observed_high_break:
        risks_zh = [f"最新{source_name_zh}已突破原模型路径，若后续报文继续持平或升温，需要继续上修最高温中枢。"]
        risks_en = [f"Latest {source_name_en} has already broken above the prior model path; if later reports hold steady or warm further, keep revising the daily-high center upward."]
    elif observed_low_break:
        risks_zh = [f"峰值窗口已过或接近结束且实测仍偏低，若后续{source_name_zh}没有反弹，需要继续下修最高温中枢。"]
        risks_en = [f"The peak window has passed or is nearly over while observations remain low; if later {source_name_en} does not rebound, keep revising the daily-high center lower."]
    elif observed_low_lag:
        risks_zh = [f"最新{source_name_zh}仍未追上原模型路径；若峰值窗口前继续偏低，需要下修最高温中枢。"]
        risks_en = [f"Latest {source_name_en} has not caught up with the prior model path; if it stays low before the peak window, revise the daily-high center lower."]
    elif peak_has_passed:
        risks_zh = [f"峰值窗口已过，后续{source_name_zh}若未再创新高，应避免继续上调最高温中枢。"]
        risks_en = [f"The peak window has passed; avoid raising the daily-high center unless later {source_name_en} sets a new high."]
    elif observation_stale:
        risks_zh = [f"当前{source_name_zh}过旧；新报文若明显偏离 DEB 和模型路径，需要重新校准最高温中枢。"]
        risks_en = [f"The current {source_name_en} is stale; if a newer report diverges from DEB and the model path, recalibrate the daily-high center."]
    else:
        risks_zh = [f"后续{source_name_zh}若明显偏离模型路径，需及时修正最高温中枢。"]
        risks_en = [f"If later {source_name_en} updates diverge from the model path, revise the daily-high center promptly."]
    evidence_guard = {
        "observation_stale": observation_stale,
        "observed_high_break": observed_high_break,
        "observed_low_break": observed_low_break,
        "observed_low_lag": observed_low_lag,
        "peak_has_passed": peak_has_passed,
        "peak_is_closing": peak_is_closing,
        "peak_not_started": peak_not_started,
        "observed_high_so_far": observed_high_so_far,
        "observed_high_for_revision": observed_high_for_revision,
        "original_predicted": original_predicted,
        "model_range_low": model_range_low,
        "model_range_high": model_range_high,
        "predicted_max": predicted,
        "range_low": range_low,
        "range_high": range_high,
    }
    return {
        "predicted_max": partial_ai.get("predicted_max", predicted),
        "range_low": partial_ai.get("range_low", range_low),
        "range_high": partial_ai.get("range_high", range_high),
        "unit": partial_ai.get("unit") or unit,
        "confidence": partial_ai.get("confidence") or ("medium" if partial_ai else "low"),
        "final_judgment_zh": final_zh,
        "final_judgment_en": final_en,
        "metar_read_zh": metar_zh,
        "metar_read_en": metar_en,
        "reasoning_zh": reasoning_zh,
        "reasoning_en": reasoning_en,
        "risks_zh": risks_zh,
        "risks_en": risks_en,
        "model_cluster_note_zh": partial_ai.get("model_cluster_note_zh") or model_note_zh,
        "model_cluster_note_en": partial_ai.get("model_cluster_note_en") or model_note_en,
        "_polyweather_meta": {
            **_provider_response_meta(provider_data),
            "fallback": True,
            "fallback_kind": "partial_ai_json" if partial_ai else "timeout" if timed_out else "non_json",
            "looks_like_truncated_json": looks_like_truncated_json,
            "fallback_reason": reason_preview,
            "raw_content_preview": content_preview,
            "partial_ai_fields": sorted(partial_ai.keys()),
            "raw_metar": _truncate_ai_text(raw_metar, 1000),
            "evidence_guard": evidence_guard,
        },
    }


def _city_ai_response_example(unit: str) -> Dict[str, Any]:
    return {
        "metar_read_zh": f"最新观测显示 37.0{unit or '°C'}，观测时间 04:30Z；风和云量暂未显示强降温信号，后续观测用于确认升温路径。",
        "metar_read_en": f"The latest observation shows 37.0{unit or '°C'} at 04:30Z; wind and cloud signals do not yet show a strong cooling break, so later observations should confirm the warming path.",
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
        "reasoning_zh": "当前观测仍贴近上午升温路径，若后续风向转为海风或云雨增强，再下修最高温中枢。",
        "reasoning_en": "The latest observation still fits the morning warming path; revise the daily-high center lower if later wind turns onshore or cloud/rain strengthens.",
    }


def _complete_city_ai_payload(
    ai_raw: Dict[str, Any],
    ai_input: Dict[str, Any],
    *,
    locale: str,
) -> Dict[str, Any]:
    """Fill missing structured fields without marking a provider success as fallback."""
    if not isinstance(ai_raw, dict):
        return _build_city_ai_fallback(
            ai_input,
            locale=locale,
            reason="provider output was not a JSON object",
        )
    fallback = _build_city_ai_fallback(
        ai_input,
        locale=locale,
        reason="schema completion",
    )
    completed: List[str] = []
    out = dict(ai_raw)
    trimmed: List[str] = []
    for field in CITY_AI_REQUIRED_FIELDS:
        value = out.get(field)
        if isinstance(value, str) and field in _CITY_AI_TEXT_FIELDS:
            clean_value = _strip_incomplete_ai_sentence(value)
            if clean_value != value:
                trimmed.append(field)
                value = clean_value
                out[field] = clean_value
        if value is None or value == "" or value == []:
            out[field] = fallback.get(field)
            completed.append(field)
    for field in ("risks_zh", "risks_en"):
        value = out.get(field)
        if isinstance(value, list):
            cleaned_risks = []
            for item in value:
                clean_item = _strip_incomplete_ai_sentence(item)
                if clean_item:
                    cleaned_risks.append(clean_item)
            if cleaned_risks != value:
                trimmed.append(field)
                out[field] = cleaned_risks or fallback.get(field)
    meta = out.get("_polyweather_meta")
    if not isinstance(meta, dict):
        meta = {}
    if completed:
        meta["schema_completed_fields"] = completed
    if trimmed:
        meta["trimmed_incomplete_fields"] = sorted(set(trimmed))
    guard_meta = (fallback.get("_polyweather_meta") or {}).get("evidence_guard")
    if isinstance(guard_meta, dict):
        deterministic_fields: List[str] = []
        numeric_guard_active = bool(
            guard_meta.get("observed_high_break")
            or guard_meta.get("observed_low_break")
            or guard_meta.get("observation_stale")
        )
        text_guard_active = bool(
            numeric_guard_active
            or guard_meta.get("peak_has_passed")
            or (guard_meta.get("observed_low_lag") and guard_meta.get("peak_not_started"))
        )
        if numeric_guard_active:
            for field in ("predicted_max", "range_low", "range_high"):
                guarded_value = fallback.get(field)
                if guarded_value is not None and out.get(field) != guarded_value:
                    out[field] = guarded_value
                    deterministic_fields.append(field)
        if guard_meta.get("observation_stale"):
            guarded_text_fields = (
                "metar_read_zh",
                "metar_read_en",
                "final_judgment_zh",
                "final_judgment_en",
                "reasoning_zh",
                "reasoning_en",
                "risks_zh",
                "risks_en",
            )
        elif text_guard_active:
            guarded_text_fields = (
                "final_judgment_zh",
                "final_judgment_en",
                "reasoning_zh",
                "reasoning_en",
                "risks_zh",
                "risks_en",
            )
        else:
            guarded_text_fields = ()
        for field in guarded_text_fields:
            guarded_value = fallback.get(field)
            if guarded_value not in (None, "", []) and out.get(field) != guarded_value:
                out[field] = guarded_value
                deterministic_fields.append(field)
        if deterministic_fields:
            meta["deterministic_guard_fields"] = sorted(set(deterministic_fields))
            meta["deterministic_guard_reason"] = {
                key: guard_meta.get(key)
                for key in (
                    "observation_stale",
                    "observed_high_break",
                    "observed_low_break",
                    "observed_low_lag",
                    "peak_has_passed",
                )
                if guard_meta.get(key)
            }
    out["_polyweather_meta"] = meta
    return out

