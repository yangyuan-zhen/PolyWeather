import hashlib
import json
import os
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger

from src.database.runtime_state import (
    STATE_STORAGE_DUAL,
    STATE_STORAGE_SQLITE,
    TelegramAlertStateRepository,
    get_state_storage_mode,
)
from src.data_collection.city_registry import CITY_REGISTRY
from src.utils.telegram_chat_ids import get_telegram_chat_ids_from_env


SEVERITY_RANK = {
    "none": 0,
    "low": 1,
    "medium": 2,
    "high": 3,
}
_telegram_state_repo = TelegramAlertStateRepository()


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except Exception:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except Exception:
        return default


def _norm_prob(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        n = float(v)
    except Exception:
        return None
    if n > 1.0:
        n = n / 100.0
    return max(0.0, min(1.0, n))


def _fmt_cents(value: Any) -> Optional[str]:
    numeric = _norm_prob(value)
    if numeric is None:
        return None
    cents = numeric * 100.0
    rounded = round(cents, 1)
    text = f"{rounded:.1f}".rstrip("0").rstrip(".")
    return f"{text}c"


def _safe_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except Exception:
        return None


def _bucket_value(row: Dict[str, Any]) -> Optional[float]:
    if not isinstance(row, dict):
        return None
    for key in ("value", "temp"):
        n = _safe_float(row.get(key))
        if n is not None:
            return n
    label = str(row.get("label") or "").strip()
    m = re.search(r"(-?\d+(?:\.\d+)?)", label)
    if not m:
        return None
    return _safe_float(m.group(1))


def _bucket_bounds(row: Dict[str, Any]) -> Optional[Tuple[Optional[float], Optional[float]]]:
    value = _bucket_value(row)
    if value is None:
        return None
    label = str(row.get("label") or "").strip().lower()
    is_upper_tail = any(key in label for key in ("+", "or higher", "or above", "and above"))
    is_lower_tail = any(key in label for key in ("<=", "or lower", "or below", "and below"))
    if is_upper_tail and not is_lower_tail:
        return value, None
    if is_lower_tail and not is_upper_tail:
        return None, value
    return value, value


def _observed_settlement_floor(alert_payload: Dict[str, Any]) -> Optional[float]:
    evidence = alert_payload.get("evidence") or {}
    if not isinstance(evidence, dict):
        evidence = {}
    inputs = evidence.get("inputs") or {}
    if not isinstance(inputs, dict):
        inputs = {}

    suppression = alert_payload.get("suppression") or {}
    if not isinstance(suppression, dict):
        suppression = {}

    rules = alert_payload.get("rules") or {}
    if not isinstance(rules, dict):
        rules = {}
    breakthrough = rules.get("forecast_breakthrough") or {}
    if not isinstance(breakthrough, dict):
        breakthrough = {}

    floor_candidates: List[float] = []
    for raw in (
        inputs.get("wu_settle"),
        suppression.get("max_so_far"),
        inputs.get("current_temp"),
        suppression.get("current_temp"),
        breakthrough.get("current_temp"),
    ):
        n = _safe_float(raw)
        if n is not None:
            floor_candidates.append(n)

    if not floor_candidates:
        return None
    return max(floor_candidates)


def _optional_bool(value: Any) -> Optional[bool]:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    return bool(value)


def _parse_iso_datetime_utc(value: Any) -> Optional[datetime]:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    if "T" not in text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except Exception:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _parse_city_list(raw: Optional[str]) -> List[str]:
    if not raw:
        return list(CITY_REGISTRY.keys())

    out: List[str] = []
    for part in raw.split(","):
        city = part.strip().lower()
        if city and city in CITY_REGISTRY:
            out.append(city)
    return out or list(CITY_REGISTRY.keys())


def _state_file() -> str:
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(root, "data", "telegram_alert_state.json")


def _load_state(path: str) -> Dict[str, Any]:
    mode = get_state_storage_mode()
    if mode == STATE_STORAGE_SQLITE:
        try:
            return _telegram_state_repo.load_state()
        except Exception as exc:
            logger.error(f"failed to load telegram push state from sqlite: {exc}")
    if not os.path.exists(path):
        if mode == STATE_STORAGE_DUAL:
            try:
                return _telegram_state_repo.load_state()
            except Exception:
                return {"last_by_city": {}, "by_signature": {}}
        return {"last_by_city": {}, "by_signature": {}}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            data.setdefault("last_by_city", {})
            data.setdefault("by_signature", {})
            return data
    except Exception as exc:
        logger.warning(f"failed to load telegram push state: {exc}")
    return {"last_by_city": {}, "by_signature": {}}


def _save_state(path: str, state: Dict[str, Any]) -> None:
    mode = get_state_storage_mode()
    if mode in {STATE_STORAGE_DUAL, STATE_STORAGE_SQLITE}:
        _telegram_state_repo.save_state(state)
    if mode == STATE_STORAGE_SQLITE:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def _cleanup_state(state: Dict[str, Any], now_ts: int, keep_sec: int = 7 * 86400) -> None:
    for bucket_name in ("by_signature", "focus_digest_slots"):
        bucket = state.get(bucket_name, {})
        if not isinstance(bucket, dict):
            state[bucket_name] = {}
            continue
        stale = [key for key, value in bucket.items() if now_ts - int(value or 0) > keep_sec]
        for key in stale:
            bucket.pop(key, None)

    last_by_city = state.get("last_by_city", {})
    if not isinstance(last_by_city, dict):
        state["last_by_city"] = {}
        return
    stale_city = []
    for city, row in last_by_city.items():
        ts = int((row or {}).get("ts") or 0)
        if now_ts - ts > keep_sec:
            stale_city.append(city)
    for city in stale_city:
        last_by_city.pop(city, None)


def _cache_market_monitor_digest(
    state: Dict[str, Any],
    *,
    message: str,
    slot_label: str,
    generated_at_ts: Optional[int] = None,
) -> None:
    state["last_market_monitor_digest"] = {
        "message": str(message or "").strip(),
        "slot_label": str(slot_label or "").strip(),
        "generated_at_ts": int(generated_at_ts or time.time()),
    }


def load_cached_market_monitor_digest() -> str:
    state = _load_state(_state_file())
    cached = state.get("last_market_monitor_digest") or {}
    if not isinstance(cached, dict):
        return ""
    return str(cached.get("message") or "").strip()


def _minute_of_day(text: Optional[str]) -> Optional[int]:
    raw = str(text or "").strip()
    if not raw or ":" not in raw:
        return None
    try:
        hour_s, minute_s = raw.split(":", 1)
        hour = int(hour_s)
        minute = int(minute_s[:2])
    except Exception:
        return None
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return hour * 60 + minute


def _format_minutes_window(delta_minutes: int) -> str:
    total = abs(int(delta_minutes))
    hours = total // 60
    minutes = total % 60
    if hours > 0 and minutes > 0:
        text = f"{hours}h{minutes:02d}m"
    elif hours > 0:
        text = f"{hours}h"
    else:
        text = f"{minutes}m"
    return text


def _format_interval_brief(seconds: int) -> str:
    total = max(1, int(seconds))
    if total % 3600 == 0:
        hours = total // 3600
        return f"{hours}小时"
    if total % 60 == 0:
        minutes = total // 60
        return f"{minutes}分钟"
    return f"{total}秒"


def _local_peak_context(alert_payload: Dict[str, Any]) -> Dict[str, Any]:
    evidence = alert_payload.get("evidence") or {}
    generated_local_time = str(evidence.get("generated_local_time") or "").strip()
    trigger_summary = evidence.get("trigger_summary") or {}
    suppression_snapshot = trigger_summary.get("suppression_snapshot") or {}
    peak_time = str(suppression_snapshot.get("max_temp_time") or "").strip()

    local_min = _minute_of_day(generated_local_time)
    peak_min = _minute_of_day(peak_time)
    if local_min is None or peak_min is None:
        return {
            "local_time": generated_local_time,
            "peak_time": peak_time,
            "minutes_to_peak": None,
            "score_adjustment": 0.0,
            "window_label": "",
        }

    delta = peak_min - local_min
    score = 0.0
    window_label = ""
    if 0 <= delta <= 120:
        score = 18.0
        window_label = f"峰值前 {_format_minutes_window(delta)}"
    elif 120 < delta <= 360:
        score = 10.0
        window_label = f"距峰值 {_format_minutes_window(delta)}"
    elif -90 <= delta < 0:
        score = 6.0
        window_label = f"峰值后 {_format_minutes_window(delta)}"
    elif delta < -90:
        score = -8.0
        window_label = "峰值已过较久"

    return {
        "local_time": generated_local_time,
        "peak_time": peak_time,
        "minutes_to_peak": delta,
        "score_adjustment": score,
        "window_label": window_label,
    }


def _market_monitor_score(alert_payload: Dict[str, Any]) -> float:
    severity = str(alert_payload.get("severity") or "none").lower()
    severity_score = {"high": 36.0, "medium": 24.0, "none": 0.0}.get(severity, 0.0)
    trigger_count = int(alert_payload.get("trigger_count") or 0)
    trigger_score = min(18.0, float(trigger_count) * 9.0)

    snapshot = alert_payload.get("market_snapshot") or {}
    if not isinstance(snapshot, dict):
        snapshot = {}
    if not snapshot.get("available"):
        return 0.0

    edge_percent = abs(_safe_float(snapshot.get("edge_percent")) or 0.0)
    edge_score = min(22.0, edge_percent * 2.5)

    yes_buy = _norm_prob(snapshot.get("yes_buy"))
    if yes_buy is None:
        forecast_bucket = snapshot.get("forecast_bucket") or {}
        if isinstance(forecast_bucket, dict):
            yes_buy = _norm_prob(forecast_bucket.get("yes_buy"))
    pricing_score = 0.0
    if yes_buy is not None:
        if yes_buy < 0.10:
            pricing_score = 14.0
        elif yes_buy < 0.20:
            pricing_score = 9.0
        elif yes_buy < 0.35:
            pricing_score = 5.0

    confidence = str(snapshot.get("confidence") or "").strip().lower()
    confidence_score = {"high": 10.0, "medium": 6.0, "low": 2.0}.get(confidence, 0.0)

    suppression = alert_payload.get("suppression") or {}
    suppressed_penalty = -20.0 if bool(suppression.get("suppressed")) else 0.0
    peak_context = _local_peak_context(alert_payload)

    return max(
        0.0,
        severity_score
        + trigger_score
        + edge_score
        + pricing_score
        + confidence_score
        + suppressed_penalty
        + float(peak_context.get("score_adjustment") or 0.0),
    )


def _priority_label(score: float) -> str:
    if score >= 72:
        return "高优先级"
    if score >= 48:
        return "重点观察"
    return "继续观察"


def _join_trigger_types_cn_local(rules: Dict[str, Dict[str, Any]]) -> str:
    label_map = {
        "ankara_center_deb_hit": "中心站触及 DEB",
        "momentum_spike": "短时动量异动",
        "forecast_breakthrough": "实测击穿模型",
        "advection": "暖平流信号",
    }
    parts: List[str] = []
    for key, label in label_map.items():
        row = rules.get(key) or {}
        if row.get("triggered"):
            parts.append(label)
    return " + ".join(parts)


def _focus_trigger_summary(alert_payload: Dict[str, Any]) -> str:
    rules = alert_payload.get("rules") or {}
    if not isinstance(rules, dict):
        return "市场与天气分歧待观察"
    return _join_trigger_types_cn_local(rules) or "市场与天气分歧待观察"


def _shortlist_focus_payloads(
    payloads: List[Dict[str, Any]],
    *,
    top_n: int,
) -> List[Dict[str, Any]]:
    ranked = sorted(
        payloads,
        key=lambda item: _market_monitor_score(item),
        reverse=True,
    )
    return [
        item for item in ranked
        if _market_monitor_score(item) > 0
        and bool((item.get("market_snapshot") or {}).get("available"))
        and _market_price_cap_ok(item, require_actionable_quote=True)
    ][:top_n]


def _build_focus_digest_message(
    payloads: List[Dict[str, Any]],
    *,
    slot_label: str,
    top_n: int,
) -> str:
    scan_interval = _format_interval_brief(_env_int("TELEGRAM_ALERT_PUSH_INTERVAL_SEC", 300))
    digest_interval = _format_interval_brief(
        _env_int("TELEGRAM_MARKET_FOCUS_DIGEST_INTERVAL_SEC", 1800),
    )
    shortlisted = _shortlist_focus_payloads(payloads, top_n=top_n)
    if not shortlisted:
        return ""

    lines = [
        f"🌐 PolyWeather 市场监控 · {slot_label}",
        "",
    ]

    for idx, payload in enumerate(shortlisted, start=1):
        city = str(payload.get("city") or "").strip().lower()
        city_name = (CITY_REGISTRY.get(city) or {}).get("display_name") or city.title() or "--"
        snapshot = payload.get("market_snapshot") or {}
        evidence = payload.get("evidence") or {}
        inputs = evidence.get("inputs") or {}

        bucket = str(
            (snapshot.get("forecast_bucket") or {}).get("label")
            or snapshot.get("top_bucket")
            or "--"
        ).strip()
        current_temp = _safe_float(inputs.get("current_temp"))
        deb_prediction = _safe_float(inputs.get("deb_prediction"))
        market_url = str(snapshot.get("market_url") or snapshot.get("primary_market_url") or "").strip()
        peak_context = _local_peak_context(payload)

        score = _market_monitor_score(payload)
        lines.append(f"{idx}. {city_name} | {_priority_label(score)}")
        lines.append("   " + f"关注桶 {bucket}")
        local_time = str(peak_context.get("local_time") or "").strip()
        peak_time = str(peak_context.get("peak_time") or "").strip()
        window_label = str(peak_context.get("window_label") or "").strip()
        if local_time or peak_time or window_label:
            context_parts: List[str] = []
            if local_time:
                context_parts.append(f"当地 {local_time}")
            if peak_time:
                context_parts.append(f"峰值参考 {peak_time}")
            if window_label:
                context_parts.append(window_label)
            lines.append("   " + " | ".join(context_parts))
        if current_temp is not None or deb_prediction is not None:
            lines.append(
                "   "
                + (f"实测 {current_temp:.1f}°C" if current_temp is not None else "实测 --")
                + " | "
                + (
                    f"DEB 预报 {deb_prediction:.1f}°C"
                    if deb_prediction is not None
                    else "DEB 预报 --"
                )
            )
        lines.append(f"   触发：{_focus_trigger_summary(payload)}")
        if market_url:
            lines.append(f"   链接：{market_url}")
        lines.append("")

    frequency_parts = [
        f"后台扫描：约每{scan_interval}一次",
        f"主动推送：约每{digest_interval}一次",
    ]
    lines.append("更新频率：" + "；".join(frequency_parts))
    return "\n".join(lines).strip()


def _maybe_send_focus_digest(
    bot: Any,
    chat_ids: List[str],
    payloads: List[Dict[str, Any]],
    state: Dict[str, Any],
    *,
    digest_interval_sec: int,
    top_n: int,
) -> bool:
    if not chat_ids or not payloads or digest_interval_sec <= 0:
        logger.info(
            "market focus digest skipped reason=invalid_runtime chat_targets={} payloads={} interval_sec={}",
            len(chat_ids),
            len(payloads),
            digest_interval_sec,
        )
        return False

    now_ts = int(time.time())
    last_digest_ts = int(state.get("last_focus_digest_ts") or 0)
    shortlisted = _shortlist_focus_payloads(payloads, top_n=top_n)
    high_priority_count = sum(1 for item in shortlisted if _market_monitor_score(item) >= 72)
    logger.info(
        "market focus digest evaluate payloads={} shortlisted={} high_priority={} interval_sec={} top_n={}",
        len(payloads),
        len(shortlisted),
        high_priority_count,
        digest_interval_sec,
        top_n,
    )
    if last_digest_ts and now_ts - last_digest_ts < digest_interval_sec:
        logger.info(
            "market focus digest skipped reason=cooldown elapsed_sec={} required_sec={} shortlisted={} high_priority={}",
            now_ts - last_digest_ts,
            digest_interval_sec,
            len(shortlisted),
            high_priority_count,
        )
        return False

    if not shortlisted:
        logger.info(
            "market focus digest skipped reason=no_candidates payloads={} top_n={}",
            len(payloads),
            top_n,
        )
        return False
    # Tighten channel pushes: require either multiple candidates or one truly high-priority market.
    if len(shortlisted) < 2 and high_priority_count < 1:
        first_city = str(shortlisted[0].get("city") or "--") if shortlisted else "--"
        first_score = _market_monitor_score(shortlisted[0]) if shortlisted else 0
        logger.info(
            "market focus digest skipped reason=too_few_candidates shortlisted={} high_priority={} first_city={} first_score={}",
            len(shortlisted),
            high_priority_count,
            first_city,
            first_score,
        )
        return False

    local_now = datetime.now().astimezone()
    hour = local_now.hour
    if 6 <= hour < 15:
        slot_label = "白天关注"
    elif 15 <= hour < 23:
        slot_label = "今晚关注"
    else:
        slot_label = "夜间关注"
    message = _build_focus_digest_message(
        shortlisted,
        slot_label=slot_label,
        top_n=top_n,
    )
    if not message:
        logger.info(
            "market focus digest skipped reason=empty_message shortlisted={} slot_label={}",
            len(shortlisted),
            slot_label,
        )
        return False

    _cache_market_monitor_digest(
        state,
        message=message,
        slot_label=slot_label,
    )

    sent_count = 0
    for chat_id in chat_ids:
        try:
            bot.send_message(chat_id, message, disable_web_page_preview=True)
            sent_count += 1
        except Exception as exc:
            logger.warning(
                "market focus digest push failed interval_sec={} chat_id={} error={}",
                digest_interval_sec,
                chat_id,
                exc,
            )
    if sent_count <= 0:
        return False

    state["last_focus_digest_ts"] = now_ts
    logger.info(
        "market focus digest pushed interval_sec={} shortlisted={} payloads={} chat_targets={} slot_label={}",
        digest_interval_sec,
        len(shortlisted),
        len(payloads),
        sent_count,
        slot_label,
    )
    return True


def build_market_monitor_digest(
    config: Dict[str, Any],
    *,
    slot_label: str = "当前概览",
    top_n: Optional[int] = None,
    force_refresh: bool = False,
) -> str:
    cities = _parse_city_list(os.getenv("TELEGRAM_ALERT_CITIES"))

    digest_top_n = top_n if top_n is not None else max(
        3,
        min(8, _env_int("TELEGRAM_MARKET_FOCUS_DIGEST_TOP_N", 5)),
    )
    payloads: List[Dict[str, Any]] = []
    for city in cities:
        try:
            payloads.append(build_trade_alert_for_city(city, config, force_refresh=force_refresh))
        except Exception as exc:
            logger.warning("market monitor digest build skipped city={} error={}", city, exc)
    message = _build_focus_digest_message(
        payloads,
        slot_label=slot_label,
        top_n=digest_top_n,
    )
    if message:
        state = _load_state(_state_file())
        _cache_market_monitor_digest(
            state,
            message=message,
            slot_label=slot_label,
        )
        _save_state(_state_file(), state)
        return message
    return "ℹ️ 当前没有可用的市场监控摘要。"


def _severity_ok(alert_payload: Dict[str, Any], min_severity: str, min_trigger_count: int) -> bool:
    triggered_alerts = alert_payload.get("triggered_alerts") or []
    if any(alert.get("force_push") for alert in triggered_alerts):
        return True

    trigger_count = int(alert_payload.get("trigger_count") or 0)
    if trigger_count < min_trigger_count:
        return False
    severity = str(alert_payload.get("severity") or "none").lower()
    return SEVERITY_RANK.get(severity, 0) >= SEVERITY_RANK.get(min_severity, 0)


def _market_price_cap_ok(
    alert_payload: Dict[str, Any],
    require_actionable_quote: bool = False,
) -> bool:
    market = alert_payload.get("market_snapshot") or {}
    if not isinstance(market, dict) or not market.get("available"):
        if require_actionable_quote:
            logger.info(
                "trade alert skipped: market snapshot unavailable city={}".format(
                    alert_payload.get("city"),
                )
            )
            return False
        return True

    primary_market = market.get("primary_market") or {}
    if not isinstance(primary_market, dict):
        primary_market = {}
    market_slug = (
        str(market.get("selected_slug") or "").strip()
        or str(primary_market.get("slug") or "").strip()
        or "--"
    )
    active = market.get("market_active")
    if active is None:
        active = primary_market.get("active")
    active = _optional_bool(active)
    closed = market.get("market_closed")
    if closed is None:
        closed = primary_market.get("closed")
    closed = _optional_bool(closed)
    accepting_orders = market.get("market_accepting_orders")
    if accepting_orders is None:
        accepting_orders = primary_market.get(
            "accepting_orders",
            primary_market.get("acceptingOrders"),
        )
    accepting_orders = _optional_bool(accepting_orders)
    market_tradable = _optional_bool(market.get("market_tradable"))
    tradable_reason = str(
        market.get("market_tradable_reason")
        or primary_market.get("tradable_reason")
        or ""
    ).strip()
    ended_at = str(
        market.get("market_ended_at_utc")
        or primary_market.get("ended_at_utc")
        or ""
    ).strip()
    ended_dt = _parse_iso_datetime_utc(ended_at)
    is_past_end = ended_dt is not None and ended_dt <= datetime.now(timezone.utc)
    if (
        market_tradable is False
        or closed is True
        or active is False
        or accepting_orders is False
        or is_past_end
    ):
        reason = tradable_reason or ("past_end_time" if is_past_end else "market_not_tradable")
        logger.info(
            "trade alert skipped: market not tradable city={} slug={} reason={} active={} closed={} accepting_orders={} ended_at={}".format(
                alert_payload.get("city"),
                market_slug,
                reason,
                active,
                closed,
                accepting_orders,
                ended_at or "--",
            )
        )
        return False

    # Strict rule: use the bucket mapped from multi-model anchor settlement.
    forecast_bucket = market.get("forecast_bucket") or {}
    settle_ref = market.get("anchor_settlement")
    if settle_ref is None:
        settle_ref = market.get("open_meteo_settlement")
    anchor_model = str(market.get("anchor_model") or "").strip() or "--"
    yes_buy = None
    bucket_label = None
    if isinstance(forecast_bucket, dict):
        yes_buy = _norm_prob(forecast_bucket.get("yes_buy"))
        bucket_label = str(forecast_bucket.get("label") or "").strip() or None

    observed_floor = _observed_settlement_floor(alert_payload)
    bucket_bounds = _bucket_bounds(forecast_bucket) if isinstance(forecast_bucket, dict) else None
    if observed_floor is not None and bucket_bounds is not None:
        _lower, upper = bucket_bounds
        if upper is not None and observed_floor > upper + 1e-9:
            logger.info(
                "trade alert skipped: mapped bucket invalidated by observed high city={} bucket={} observed_floor={} upper_bound={} anchor_model={} anchor_settle={}".format(
                    alert_payload.get("city"),
                    bucket_label or "--",
                    round(observed_floor, 2),
                    round(upper, 2),
                    anchor_model,
                    settle_ref,
                )
            )
            return False

    if yes_buy is None or yes_buy <= 0.0:
        logger.info(
            "trade alert skipped: no actionable mapped bucket quote city={} bucket={} anchor_model={} anchor_settle={}".format(
                alert_payload.get("city"),
                bucket_label or "--",
                anchor_model,
                settle_ref,
            )
        )
        return False

    return True


def _trigger_type_key(alert_payload: Dict[str, Any]) -> str:
    trigger_types = sorted(
        str(alert.get("type") or "").strip()
        for alert in (alert_payload.get("triggered_alerts") or [])
        if alert.get("type")
    )
    market = alert_payload.get("market_snapshot") or {}
    if isinstance(market, dict) and market.get("available"):
        signal = str(market.get("signal_label") or "").strip()
        bucket = str(market.get("selected_bucket") or "").strip()
        if signal:
            trigger_types.append(f"mkt:{signal}:{bucket}")
    return "|".join(trigger_types)


def _evidence_brief(alert_payload: Dict[str, Any]) -> str:
    evidence = alert_payload.get("evidence") or {}
    if not isinstance(evidence, dict):
        return "--"

    trigger_summary = evidence.get("trigger_summary") or {}
    rules = evidence.get("rules") or {}
    market = evidence.get("market") or {}
    momentum = rules.get("momentum_spike") or {}
    advection = rules.get("advection") or {}
    breakthrough = rules.get("forecast_breakthrough") or {}

    parts: List[str] = []
    trigger_types = trigger_summary.get("trigger_types")
    if isinstance(trigger_types, list) and trigger_types:
        parts.append(f"triggers={','.join(str(t) for t in trigger_types)}")

    slope = momentum.get("slope_30m")
    if slope is not None:
        parts.append(f"slope_30m={slope}")

    lead_delta = advection.get("lead_delta")
    if lead_delta is not None:
        parts.append(f"lead_delta={lead_delta}")

    margin = breakthrough.get("margin")
    if margin is not None:
        parts.append(f"break_margin={margin}")

    edge = market.get("edge_percent")
    if edge is not None:
        parts.append(f"edge_pct={edge}")

    forecast_bucket = market.get("forecast_bucket") or {}
    if isinstance(forecast_bucket, dict):
        label = str(forecast_bucket.get("label") or "").strip()
        yes_buy = forecast_bucket.get("yes_buy")
        if label:
            parts.append(f"bucket={label}")
        if yes_buy is not None:
            parts.append(f"yes_buy={yes_buy}")

    if not parts:
        return "--"
    return "; ".join(parts)


def _alert_signature(alert_payload: Dict[str, Any]) -> str:
    rules = alert_payload.get("rules") or {}
    center_deb = rules.get("ankara_center_deb_hit") or {}
    momentum = rules.get("momentum_spike") or {}
    breakthrough = rules.get("forecast_breakthrough") or {}
    advection = rules.get("advection") or {}
    suppression = alert_payload.get("suppression") or {}
    market = alert_payload.get("market_snapshot") or {}

    signature_payload = {
        "city": alert_payload.get("city"),
        "target_date": alert_payload.get("target_date"),
        "severity": alert_payload.get("severity"),
        "trigger_types": sorted(
            alert.get("type")
            for alert in (alert_payload.get("triggered_alerts") or [])
            if alert.get("type")
        ),
        "center_temp": round(float(((center_deb.get("center_station") or {}).get("temp")) or 0.0), 1),
        "center_deb_prediction": round(float(center_deb.get("deb_prediction") or 0.0), 1),
        "center_airport_gap": round(float(center_deb.get("center_lead_vs_airport") or 0.0), 1),
        "momentum_direction": momentum.get("direction"),
        "momentum_slope_30m": round(float(momentum.get("slope_30m") or 0.0), 1),
        "breakthrough_margin": round(float(breakthrough.get("margin") or 0.0), 1),
        "lead_station": (advection.get("lead_station") or {}).get("name"),
        "lead_delta": round(float(advection.get("lead_delta") or 0.0), 1),
        "suppressed": bool(suppression.get("suppressed")),
        "suppression_reason": suppression.get("reason"),
        "suppression_peak_time": suppression.get("max_temp_time"),
        "suppression_rollback": round(float(suppression.get("rollback") or 0.0), 1),
        "market_available": bool(market.get("available")),
        "market_bucket": market.get("selected_bucket"),
        "market_top_bucket": market.get("top_bucket"),
        "market_top_bucket_prob": round(float(market.get("top_bucket_prob") or 0.0), 3),
        "market_prob": round(float(market.get("market_prob") or 0.0), 3),
        "model_prob": round(float(market.get("model_prob") or 0.0), 3),
        "market_yes_buy": round(float(market.get("yes_buy") or 0.0), 3),
        "market_yes_sell": round(float(market.get("yes_sell") or 0.0), 3),
        "market_spread": round(float(market.get("spread") or 0.0), 3),
        "market_edge_percent": round(float(market.get("edge_percent") or 0.0), 2),
        "market_signal": market.get("signal_label"),
        "market_confidence": market.get("confidence"),
    }
    raw = json.dumps(signature_payload, sort_keys=True, ensure_ascii=True)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def build_trade_alert_for_city(
    city: str,
    config: Dict[str, Any],
    force_refresh: bool = False,
    target_date: Optional[str] = None,
) -> Dict[str, Any]:
    from web.app import _analyze, _build_city_detail_payload
    from src.analysis.market_alert_engine import build_trading_alerts

    city_weather = _analyze(city, force_refresh=force_refresh)
    try:
        aggregate_detail = _build_city_detail_payload(
            city_weather,
            target_date=target_date,
        )
        market_scan = aggregate_detail.get("market_scan")
        if isinstance(market_scan, dict):
            city_weather = {**city_weather, "market_scan": market_scan}
    except Exception as exc:
        logger.debug(f"market scan attach skipped city={city}: {exc}")

    resolved_target_date = target_date or city_weather.get("local_date")
    if resolved_target_date:
        datetime.strptime(resolved_target_date, "%Y-%m-%d")

    map_url = os.getenv("POLYWEATHER_MAP_URL") or "https://polyweather-pro.vercel.app/"
    alert_payload = build_trading_alerts(
        city_weather=city_weather,
        map_url=map_url,
    )
    alert_payload["target_date"] = resolved_target_date
    return alert_payload


def _maybe_send_alert(
    bot: Any,
    chat_ids: List[str],
    city: str,
    alert_payload: Dict[str, Any],
    state: Dict[str, Any],
    cooldown_sec: int,
    min_severity: str,
    min_trigger_count: int,
    mispricing_only: bool,
) -> bool:
    now_ts = int(time.time())
    last_by_city = state.setdefault("last_by_city", {})
    last_city = last_by_city.get(city) or {}
    is_active = _severity_ok(alert_payload, min_severity, min_trigger_count)
    if not _market_price_cap_ok(
        alert_payload,
        require_actionable_quote=mispricing_only,
    ):
        is_active = False
    message = ((alert_payload.get("telegram") or {}).get("zh") or "").strip()

    if not is_active or not message:
        if last_city.get("active"):
            last_by_city[city] = {
                **last_city,
                "active": False,
                "cleared_ts": now_ts,
            }
            logger.info(f"market monitor disarmed city={city}")
            return True
        return False

    if not chat_ids:
        return False

    signature = _alert_signature(alert_payload)
    trigger_key = _trigger_type_key(alert_payload)
    last_city_sig = last_city.get("signature")
    last_city_key = str(last_city.get("trigger_key") or "")
    last_city_ts = int(last_city.get("ts") or 0)
    last_sig_ts = int((state.get("by_signature") or {}).get(signature) or 0)
    last_city_active = bool(last_city.get("active"))

    if last_city_active and last_city_key == trigger_key and last_city_sig == signature:
        return False

    if last_city_ts and now_ts - last_city_ts < cooldown_sec:
        return False
    if last_sig_ts and now_ts - last_sig_ts < cooldown_sec:
        return False

    sent_count = 0
    for chat_id in chat_ids:
        try:
            bot.send_message(chat_id, message)
            sent_count += 1
        except Exception as exc:
            logger.warning("market monitor push failed city={} chat_id={} error={}", city, chat_id, exc)
    if sent_count <= 0:
        return False

    last_by_city[city] = {
        "signature": signature,
        "trigger_key": trigger_key,
        "severity": alert_payload.get("severity"),
        "ts": now_ts,
        "active": True,
        "evidence": alert_payload.get("evidence"),
    }
    state.setdefault("by_signature", {})[signature] = now_ts
    logger.info(
        f"market monitor pushed city={city} severity={alert_payload.get('severity')} "
        f"trigger_count={alert_payload.get('trigger_count')} trigger_key={trigger_key} "
        f"evidence={_evidence_brief(alert_payload)} chat_targets={sent_count}"
    )
    return True


def start_trade_alert_push_loop(bot: Any, config: Dict[str, Any]) -> Optional[threading.Thread]:
    enabled = _env_bool("TELEGRAM_ALERT_PUSH_ENABLED", True)
    chat_ids = get_telegram_chat_ids_from_env()
    if not enabled:
        logger.info("telegram market monitor loop disabled")
        return None
    if not chat_ids:
        logger.warning("telegram market monitor loop skipped: TELEGRAM_CHAT_IDS is not set")
        return None

    interval_sec = max(60, _env_int("TELEGRAM_ALERT_PUSH_INTERVAL_SEC", 300))
    cities = _parse_city_list(os.getenv("TELEGRAM_ALERT_CITIES"))
    state_path = _state_file()
    focus_digest_enabled = _env_bool("TELEGRAM_MARKET_FOCUS_DIGEST_ENABLED", True)
    focus_digest_top_n = max(3, min(8, _env_int("TELEGRAM_MARKET_FOCUS_DIGEST_TOP_N", 5)))
    focus_digest_interval_sec = max(
        300,
        _env_int("TELEGRAM_MARKET_FOCUS_DIGEST_INTERVAL_SEC", 1800),
    )
    focus_digest_batch_size = max(4, min(12, _env_int("TELEGRAM_MARKET_FOCUS_DIGEST_BATCH_SIZE", 8)))
    def _runner() -> None:
        try:
            _save_state(state_path, _load_state(state_path))
        except Exception:
            logger.exception(f"failed to initialize market monitor state path={state_path}")
        logger.info(
            f"telegram market monitor loop started mode=focus-digest-only "
            f"cities={len(cities)} interval={interval_sec}s chat_targets={len(chat_ids)} "
            f"focus_digest_enabled={focus_digest_enabled} focus_interval={focus_digest_interval_sec}s "
            f"focus_batch_size={focus_digest_batch_size} "
            f"state_path={state_path}"
        )
        while True:
            cycle_started = time.time()
            state = _load_state(state_path)
            _cleanup_state(state, int(cycle_started))
            cycle_payloads: List[Dict[str, Any]] = []

            for city in cities:
                try:
                    alert_payload = build_trade_alert_for_city(city, config)
                    cycle_payloads.append(alert_payload)
                except Exception:
                    logger.exception(f"telegram market monitor loop failed for city={city}")
                if focus_digest_enabled and cycle_payloads and len(cycle_payloads) % focus_digest_batch_size == 0:
                    try:
                        if _maybe_send_focus_digest(
                            bot=bot,
                            chat_ids=chat_ids,
                            payloads=cycle_payloads,
                            state=state,
                            digest_interval_sec=focus_digest_interval_sec,
                            top_n=focus_digest_top_n,
                        ):
                            _save_state(state_path, state)
                    except Exception:
                        logger.exception("failed to push market focus digest mid-cycle")
                time.sleep(1)

            if focus_digest_enabled:
                try:
                    if _maybe_send_focus_digest(
                        bot=bot,
                        chat_ids=chat_ids,
                        payloads=cycle_payloads,
                        state=state,
                        digest_interval_sec=focus_digest_interval_sec,
                        top_n=focus_digest_top_n,
                    ):
                        _save_state(state_path, state)
                except Exception:
                    logger.exception("failed to push market focus digest")

            elapsed = time.time() - cycle_started
            sleep_sec = max(5, interval_sec - int(elapsed))
            time.sleep(sleep_sec)

    thread = threading.Thread(
        target=_runner,
        name="telegram-market-monitor-pusher",
        daemon=True,
    )
    thread.start()
    return thread
