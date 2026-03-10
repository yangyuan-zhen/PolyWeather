import hashlib
import json
import os
import threading
import time
from datetime import datetime
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


def _market_price_cap_ok(alert_payload: Dict[str, Any], max_yes_buy: float) -> bool:
    if max_yes_buy >= 1.0:
        return True

    market = alert_payload.get("market_snapshot") or {}
    if not isinstance(market, dict) or not market.get("available"):
        return True

    # Prefer the market bucket that maps to Open-Meteo forecast settlement.
    forecast_bucket = market.get("forecast_bucket") or {}
    yes_buy = None
    bucket_label = None
    if isinstance(forecast_bucket, dict):
        yes_buy = _norm_prob(forecast_bucket.get("yes_buy"))
        bucket_label = str(forecast_bucket.get("label") or "").strip() or None

    # Backward-compatible fallback.
    if yes_buy is None:
        yes_buy = _norm_prob(market.get("yes_buy"))
        if not bucket_label:
            bucket_label = str(market.get("selected_bucket") or "").strip() or None

    if yes_buy is None:
        # Fallback to first bucket with valid yes_buy if aggregate field is missing.
        top_rows = market.get("top_bucket_rows") or []
        if isinstance(top_rows, list):
            for row in top_rows:
                if not isinstance(row, dict):
                    continue
                yes_buy = _norm_prob(row.get("yes_buy"))
                if yes_buy is not None:
                    if not bucket_label:
                        bucket_label = str(row.get("label") or "").strip() or None
                    break

    if yes_buy is None:
        return True

    if yes_buy >= max_yes_buy:
        logger.info(
            "trade alert skipped by mispricing cap city={} bucket={} om_settle={} yes_buy={} cap={}".format(
                alert_payload.get("city"),
                bucket_label or "--",
                market.get("open_meteo_settlement"),
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
        aggregate_detail = _build_city_detail_payload(city_weather)
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
) -> bool:
    now_ts = int(time.time())
    last_by_city = state.setdefault("last_by_city", {})
    last_city = last_by_city.get(city) or {}
    is_active = _severity_ok(alert_payload, min_severity, min_trigger_count)
    max_yes_buy = max(
        0.0,
        min(1.0, _env_float("TELEGRAM_ALERT_MISPRICING_MAX_YES_BUY", 0.10)),
    )
    if not _market_price_cap_ok(alert_payload, max_yes_buy):
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
    }
    state.setdefault("by_signature", {})[signature] = now_ts
    logger.info(
        f"trade alert pushed city={city} severity={alert_payload.get('severity')} "
        f"trigger_count={alert_payload.get('trigger_count')} trigger_key={trigger_key}"
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
            f"telegram alert push loop started cities={len(cities)} interval={interval_sec}s "
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
