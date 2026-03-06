import hashlib
import json
import os
import threading
import time
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
    trigger_count = int(alert_payload.get("trigger_count") or 0)
    if trigger_count < min_trigger_count:
        return False
    severity = str(alert_payload.get("severity") or "none").lower()
    return SEVERITY_RANK.get(severity, 0) >= SEVERITY_RANK.get(min_severity, 0)


def _alert_signature(alert_payload: Dict[str, Any]) -> str:
    rules = alert_payload.get("rules") or {}
    momentum = rules.get("momentum_spike") or {}
    breakthrough = rules.get("forecast_breakthrough") or {}
    kill_zone = rules.get("kill_zone") or {}
    advection = rules.get("advection") or {}

    signature_payload = {
        "city": alert_payload.get("city"),
        "target_date": alert_payload.get("target_date"),
        "severity": alert_payload.get("severity"),
        "trigger_types": sorted(
            alert.get("type")
            for alert in (alert_payload.get("triggered_alerts") or [])
            if alert.get("type")
        ),
        "momentum_direction": momentum.get("direction"),
        "momentum_slope_30m": round(float(momentum.get("slope_30m") or 0.0), 1),
        "breakthrough_margin": round(float(breakthrough.get("margin") or 0.0), 1),
        "kill_zone_strike": round(float(kill_zone.get("strike_price") or 0.0), 1),
        "kill_zone_distance": round(float(kill_zone.get("distance") or 0.0), 1),
        "lead_station": (advection.get("lead_station") or {}).get("name"),
        "lead_delta": round(float(advection.get("lead_delta") or 0.0), 1),
    }
    raw = json.dumps(signature_payload, sort_keys=True, ensure_ascii=True)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def build_trade_alert_for_city(
    city: str,
    config: Dict[str, Any],
    force_refresh: bool = False,
) -> Dict[str, Any]:
    from web.app import _analyze
    from src.analysis.market_alert_engine import build_trading_alerts
    from src.data_collection.polymarket_client import build_city_market_snapshot

    city_weather = _analyze(city, force_refresh=force_refresh)
    target_date = city_weather.get("local_date")

    proxy = (
        (config.get("polymarket", {}) or {}).get("proxy")
        or (config.get("app", {}) or {}).get("proxy")
    )
    market_snapshot = build_city_market_snapshot(
        city=city,
        target_date=target_date,
        proxy=proxy,
        force_refresh=force_refresh,
    )
    map_url = os.getenv("POLYWEATHER_MAP_URL") or "https://polyweather-pro.vercel.app/"
    alert_payload = build_trading_alerts(
        city_weather=city_weather,
        market_snapshot=market_snapshot,
        map_url=map_url,
    )
    alert_payload["target_date"] = target_date
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
    if not _severity_ok(alert_payload, min_severity, min_trigger_count):
        return False

    message = ((alert_payload.get("telegram") or {}).get("zh") or "").strip()
    if not message:
        return False

    now_ts = int(time.time())
    signature = _alert_signature(alert_payload)
    last_city = (state.get("last_by_city") or {}).get(city) or {}
    last_city_sig = last_city.get("signature")
    last_city_ts = int(last_city.get("ts") or 0)
    last_sig_ts = int((state.get("by_signature") or {}).get(signature) or 0)

    if last_city_sig == signature and now_ts - last_city_ts < cooldown_sec:
        return False
    if last_sig_ts and now_ts - last_sig_ts < cooldown_sec:
        return False

    bot.send_message(chat_id, message)
    state.setdefault("last_by_city", {})[city] = {"signature": signature, "ts": now_ts}
    state.setdefault("by_signature", {})[signature] = now_ts
    logger.info(
        f"trade alert pushed city={city} severity={alert_payload.get('severity')} "
        f"trigger_count={alert_payload.get('trigger_count')}"
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
        logger.info(
            f"telegram alert push loop started cities={len(cities)} interval={interval_sec}s "
            f"cooldown={cooldown_sec}s min_triggers={min_trigger_count} min_severity={min_severity}"
        )
        while True:
            cycle_started = time.time()
            state = _load_state(state_path)
            _cleanup_state(state, int(cycle_started))

            changed = False
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
                        changed = True
                except Exception:
                    logger.exception(f"telegram alert push loop failed for city={city}")
                time.sleep(1)

            if changed:
                try:
                    _save_state(state_path, state)
                except Exception:
                    logger.exception("failed to save telegram push state")

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
