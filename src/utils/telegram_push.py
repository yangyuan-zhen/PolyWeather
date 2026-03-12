import hashlib
import json
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from loguru import logger

from src.data_collection.city_registry import CITY_REGISTRY


SEVERITY_RANK = {
    "none": 0,
    "low": 1,
    "medium": 2,
    "high": 3,
}


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
    if not os.path.exists(path):
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
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def _cleanup_state(state: Dict[str, Any], now_ts: int, keep_sec: int = 7 * 86400) -> None:
    for bucket_name in ("by_signature",):
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
    max_yes_buy: float,
    require_actionable_quote: bool = False,
) -> bool:
    if max_yes_buy >= 1.0:
        return True

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

    if yes_buy >= max_yes_buy:
        logger.info(
            "trade alert skipped by mispricing cap city={} bucket={} anchor_model={} anchor_settle={} yes_buy={} cap={}".format(
                alert_payload.get("city"),
                bucket_label or "--",
                anchor_model,
                settle_ref,
                round(yes_buy, 4),
                round(max_yes_buy, 4),
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
    chat_id: str,
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
    max_yes_buy = max(
        0.0,
        min(1.0, _env_float("TELEGRAM_ALERT_MISPRICING_MAX_YES_BUY", 0.10)),
    )
    if not _market_price_cap_ok(
        alert_payload,
        max_yes_buy,
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
            logger.info(f"trade alert disarmed city={city}")
            return True
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

    bot.send_message(chat_id, message)
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
        f"trade alert pushed city={city} severity={alert_payload.get('severity')} "
        f"trigger_count={alert_payload.get('trigger_count')} trigger_key={trigger_key} "
        f"evidence={_evidence_brief(alert_payload)}"
    )
    return True


def start_trade_alert_push_loop(bot: Any, config: Dict[str, Any]) -> Optional[threading.Thread]:
    enabled = _env_bool("TELEGRAM_ALERT_PUSH_ENABLED", True)
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not enabled:
        logger.info("telegram alert push loop disabled")
        return None
    if not chat_id:
        logger.warning("telegram alert push loop skipped: TELEGRAM_CHAT_ID is not set")
        return None

    mispricing_only = _env_bool("TELEGRAM_ALERT_MISPRICING_ONLY", True)
    if mispricing_only:
        interval_sec = max(
            300, _env_int("TELEGRAM_ALERT_MISPRICING_INTERVAL_SEC", 7200)
        )
    else:
        interval_sec = max(60, _env_int("TELEGRAM_ALERT_PUSH_INTERVAL_SEC", 300))
    cooldown_sec = max(interval_sec, _env_int("TELEGRAM_ALERT_PUSH_COOLDOWN_SEC", 1800))
    min_trigger_count = max(1, _env_int("TELEGRAM_ALERT_MIN_TRIGGER_COUNT", 2))
    min_severity = os.getenv("TELEGRAM_ALERT_MIN_SEVERITY", "medium").strip().lower()
    cities = _parse_city_list(os.getenv("TELEGRAM_ALERT_CITIES"))
    state_path = _state_file()

    def _runner() -> None:
        try:
            _save_state(state_path, _load_state(state_path))
        except Exception:
            logger.exception(f"failed to initialize telegram push state path={state_path}")
        logger.info(
            f"telegram alert push loop started mode={'mispricing-only' if mispricing_only else 'full'} "
            f"cities={len(cities)} interval={interval_sec}s "
            f"cooldown={cooldown_sec}s min_triggers={min_trigger_count} min_severity={min_severity} "
            f"state_path={state_path}"
        )
        while True:
            cycle_started = time.time()
            state = _load_state(state_path)
            _cleanup_state(state, int(cycle_started))

            for city in cities:
                try:
                    alert_payload = build_trade_alert_for_city(city, config)
                    if _maybe_send_alert(
                        bot=bot,
                        chat_id=chat_id,
                        city=city,
                        alert_payload=alert_payload,
                        state=state,
                        cooldown_sec=cooldown_sec,
                        min_severity=min_severity,
                        min_trigger_count=min_trigger_count,
                        mispricing_only=mispricing_only,
                    ):
                        try:
                            _save_state(state_path, state)
                        except Exception:
                            logger.exception(f"failed to save telegram push state city={city}")
                except Exception:
                    logger.exception(f"telegram alert push loop failed for city={city}")
                time.sleep(1)

            elapsed = time.time() - cycle_started
            sleep_sec = max(5, interval_sec - int(elapsed))
            time.sleep(sleep_sec)

    thread = threading.Thread(
        target=_runner,
        name="telegram-trade-alert-pusher",
        daemon=True,
    )
    thread.start()
    return thread
