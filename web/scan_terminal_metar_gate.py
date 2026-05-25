from __future__ import annotations

import re
from typing import Any, Dict, Optional

from web.core import _sf as _safe_float
from web.scan_terminal_filters import safe_int as _safe_int


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
