"""Intraday meteorology — paid-product signal layer.

Reads existing analysis layers (current, probabilities, DEB, peak, deviation,
TAF, vertical profile, station network) and produces a structured meteorology
read with headline, confidence, signals, and invalidation/confirmation rules.
"""

from __future__ import annotations

from typing import Any, Dict

from web.services.analysis_utils import (
    add_signal as _add_signal,
    bucket_label as _bucket_label,
    bucket_label_from_value as _bucket_label_from_value,
    format_clock_minutes as _format_clock_minutes,
    next_observation_clock as _next_observation_clock,
    top_probability_bucket as _top_probability_bucket,
)


def _sf(v: Any) -> Any:
    if v is None:
        return None
    try:
        return float(v)
    except Exception:
        return None


def build_intraday_meteorology(data: Dict[str, Any]) -> Dict[str, Any]:
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
