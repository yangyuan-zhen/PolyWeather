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
    if mode == STATE_STORAGE_SQLITE:
        _telegram_state_repo.save_state(state)
    if mode == STATE_STORAGE_SQLITE:
        return
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
) -> bool:
    market = alert_payload.get("market_snapshot") or {}
    if not isinstance(market, dict) or not market.get("available"):
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
) -> bool:
    now_ts = int(time.time())
    last_by_city = state.setdefault("last_by_city", {})
    last_city = last_by_city.get(city) or {}
    is_active = _severity_ok(alert_payload, min_severity, min_trigger_count)
    if not _market_price_cap_ok(alert_payload):
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


def _run_market_monitor_cycle(
    bot: Any,
    config: Dict[str, Any],
    *,
    chat_ids: List[str],
    cities: List[str],
    state: Dict[str, Any],
    alert_cooldown_sec: int,
    min_severity: str,
    min_trigger_count: int,
    sleep_between_cities_sec: float = 1.0,
) -> bool:
    state_dirty = False

    for city in cities:
        try:
            alert_payload = build_trade_alert_for_city(city, config)
            if _maybe_send_alert(
                bot=bot,
                chat_ids=chat_ids,
                city=city,
                alert_payload=alert_payload,
                state=state,
                cooldown_sec=alert_cooldown_sec,
                min_severity=min_severity,
                min_trigger_count=min_trigger_count,
            ):
                state_dirty = True
        except Exception:
            logger.exception(f"telegram market monitor loop failed for city={city}")
        if sleep_between_cities_sec > 0:
            time.sleep(sleep_between_cities_sec)

    return state_dirty


def start_trade_alert_push_loop(bot: Any, config: Dict[str, Any]) -> Optional[threading.Thread]:
    enabled = _env_bool("TELEGRAM_ALERT_PUSH_ENABLED", True)
    chat_ids = get_telegram_chat_ids_from_env()
    if not enabled:
        logger.info("telegram market monitor loop disabled")
        return None
    if not chat_ids:
        logger.warning("telegram market monitor loop skipped: TELEGRAM_CHAT_IDS is not set")
        return None

    interval_sec = max(60, _env_int("TELEGRAM_ALERT_PUSH_INTERVAL_SEC", 1800))
    cities = _parse_city_list(os.getenv("TELEGRAM_ALERT_CITIES"))
    state_path = _state_file()
    alert_cooldown_sec = max(60, _env_int("TELEGRAM_ALERT_PUSH_COOLDOWN_SEC", 21600))
    min_trigger_count = max(1, _env_int("TELEGRAM_ALERT_MIN_TRIGGER_COUNT", 3))
    min_severity = str(os.getenv("TELEGRAM_ALERT_MIN_SEVERITY") or "high").strip().lower()
    if min_severity not in SEVERITY_RANK:
        min_severity = "high"
    def _runner() -> None:
        try:
            _save_state(state_path, _load_state(state_path))
        except Exception:
            logger.exception(f"failed to initialize market monitor state path={state_path}")
        logger.info(
            f"telegram market monitor loop started mode=critical-alerts "
            f"cities={len(cities)} interval={interval_sec}s chat_targets={len(chat_ids)} "
            f"alert_cooldown={alert_cooldown_sec}s "
            f"min_severity={min_severity} min_trigger_count={min_trigger_count} "
            f"state_path={state_path}"
        )
        while True:
            cycle_started = time.time()
            state = _load_state(state_path)
            _cleanup_state(state, int(cycle_started))
            if _run_market_monitor_cycle(
                bot=bot,
                config=config,
                chat_ids=chat_ids,
                cities=cities,
                state=state,
                alert_cooldown_sec=alert_cooldown_sec,
                min_severity=min_severity,
                min_trigger_count=min_trigger_count,
            ):
                _save_state(state_path, state)

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


# ── high-freq airport push loop ──

HIGH_FREQ_AIRPORT_CITIES = {"seoul", "busan", "tokyo", "ankara", "helsinki", "amsterdam", "istanbul", "paris", "hong kong", "lau fau shan"}
HIGH_FREQ_AIRPORT_ICAO = {"seoul": "RKSI", "busan": "RKPK", "tokyo": "RJTT", "ankara": "17128", "helsinki": "EFHK", "amsterdam": "EHAM", "istanbul": "17058", "paris": "LFPB", "hong kong": "HKO", "lau fau shan": "LFS"}

_AIRPORT_PUSH_STATE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "data", "airport_push_state.json",
)


def _load_airport_state() -> Dict[str, Any]:
    path = _AIRPORT_PUSH_STATE_PATH
    if not os.path.exists(path):
        return {"last_by_city": {}}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            data.setdefault("last_by_city", {})
            return data
    except Exception:
        pass
    return {"last_by_city": {}}


def _save_airport_state(state: Dict[str, Any]) -> None:
    path = _AIRPORT_PUSH_STATE_PATH
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _fetch_arome_temp() -> Optional[float]:
    """Fetch latest AROME France HD 15-min temperature for LFPB from Open-Meteo."""
    try:
        import requests
        url = (
            "https://api.open-meteo.com/v1/forecast?"
            "latitude=48.9673&longitude=2.4277"
            "&models=meteofrance_arome_france_hd"
            "&minutely_15=temperature_2m"
            "&timezone=Europe/Paris"
            "&forecast_minutely_15=2"
        )
        resp = requests.get(url, timeout=8)
        data = resp.json()
        temps = (data.get("minutely_15") or {}).get("temperature_2m") or []
        return float(temps[-1]) if temps else None
    except Exception:
        return None


def _build_airport_status_message(
    city: str,
    city_weather: Dict[str, Any],
    deb_pred: Optional[float],
    local_time: str = "",
) -> str:
    _AIRPORT_EN = {"seoul": "Incheon", "busan": "Gimhae", "tokyo": "Haneda",
                   "ankara": "Esenboğa", "helsinki": "Vantaa", "amsterdam": "Schiphol",
                   "istanbul": "Airport", "paris": "Le Bourget",
                   "hong kong": "Observatory", "lau fau shan": "Lau Fau Shan"}
    en_name = city.title()
    ap_name = _AIRPORT_EN.get(city, "")
    time_suffix = f" {local_time}" if local_time else ""
    header = f"{en_name} / {ap_name}{time_suffix}" if ap_name else f"{en_name}{time_suffix}"

    amos = city_weather.get("amos") or {}
    runway_data = (amos.get("runway_obs") or {}) if amos else {}
    runway_pairs = runway_data.get("runway_pairs") or []
    runway_temps = runway_data.get("temperatures") or []
    mgm_nearby = city_weather.get("mgm_nearby") or []
    airport_icao = HIGH_FREQ_AIRPORT_ICAO.get(city, "")
    airport_row = None
    for row in mgm_nearby:
        if str(row.get("istNo") or "") == airport_icao or str(row.get("icao") or "") == airport_icao:
            airport_row = row
            break
    if not airport_row:
        airport_row = mgm_nearby[0] if mgm_nearby else {}
    station_temp = airport_row.get("temp") if airport_row else None
    current = city_weather.get("current") or {}
    if station_temp is None:
        station_temp = current.get("temp")

    # Determine current max temp for new-high check
    latest_temp = station_temp
    if runway_temps:
        valid = [t for (t, _d) in runway_temps if t is not None]
        if valid:
            latest_temp = max(valid)

    # Check if breaking today's high
    max_so_far, max_temp_time = _get_airport_daily_high(city_weather)
    new_high = (latest_temp is not None and max_so_far is not None
                and latest_temp - max_so_far >= 0.3)

    flag = " \U0001f536新" if new_high else ""
    lines = [header + flag, ""]
    runway_shown = False
    if runway_pairs and runway_temps and len(runway_pairs) == len(runway_temps):
        for (r1, r2), (t, _d) in zip(runway_pairs, runway_temps):
            if t is not None:
                lines.append(f"{r1}/{r2} {t:.1f}°C")
                runway_shown = True
    if not runway_shown and station_temp is not None:
        label = "AROME预报" if city == "paris" else "当前实测"
        lines.append(f"{label}：{station_temp:.1f}°C")
    if deb_pred is not None:
        lines.append(f"今日DEB预报最高：{deb_pred:.1f}°C")
    if max_so_far is not None:
        time_str = f"（{max_temp_time}）" if max_temp_time else ""
        lines.append(f"今日实测最高：{max_so_far:.1f}°C{time_str}")
    return "\n".join(lines)


def _get_airport_daily_high(city_weather: Dict[str, Any]):
    """Get today's observed high from METAR/AMOS airport history."""
    airport = city_weather.get("airport_current") or {}
    max_so_far = airport.get("max_so_far")
    max_time = airport.get("max_temp_time")
    if max_so_far is not None:
        try:
            max_so_far = round(float(max_so_far), 1)
        except Exception:
            max_so_far = None
    return max_so_far, max_time


# Per-city push interval matching native data refresh rate (seconds)
_AIRPORT_PUSH_INTERVAL = {
    "seoul": 600,      # AMOS 1-min → 10min push
    "busan": 600,      # AMOS 1-min → 10min push
    "tokyo": 600,      # JMA 10-min
    "ankara": 600,     # MGM ~10-min
    "helsinki": 600,   # FMI 10-min
    "amsterdam": 600,  # KNMI 10-min
    "istanbul": 600,   # MGM ~10-min
    "paris": 900,        # AROME HD 15-min model
    "hong kong": 60,     # HKO 1-min
    "lau fau shan": 60,  # HKO 1-min
}
_DEB_PROXIMITY_THRESHOLD_C = 3.0


def _run_high_freq_airport_cycle(
    bot: Any,
    config: Dict[str, Any],
    chat_ids: List[str],
    state: Dict[str, Any],
) -> bool:
    state_dirty = False
    now_ts = int(time.time())
    last_by_city = state.setdefault("last_by_city", {})

    for city in sorted(HIGH_FREQ_AIRPORT_CITIES):
        try:
            last_city = last_by_city.get(city) or {}
            last_city_ts = int(last_city.get("ts") or 0)
            city_interval = _AIRPORT_PUSH_INTERVAL.get(city, 600)
            if now_ts - last_city_ts < city_interval:
                continue

            city_weather: Dict[str, Any] = {}
            deb_pred: Optional[float] = None
            try:
                from web.app import _analyze
                city_weather = _analyze(city)
                deb_raw = (city_weather.get("deb") or {}).get("prediction")
                if deb_raw is not None:
                    deb_pred = float(deb_raw)
            except Exception:
                pass

            current = city_weather.get("current") or {}
            current_temp = current.get("temp")
            # Paris: use AROME 15-min model temp instead of METAR
            if city == "paris":
                arome_temp = _fetch_arome_temp()
                if arome_temp is not None:
                    current_temp = arome_temp
                    city_weather.setdefault("current", {})["temp"] = arome_temp
            if current_temp is None or deb_pred is None:
                continue

            # Push only when approaching DEB predicted high
            proximity = deb_pred - current_temp
            in_window = proximity <= _DEB_PROXIMITY_THRESHOLD_C

            # Stop if past peak (skip for Paris: no obs_log for AROME model data)
            if in_window and city != "paris":
                try:
                    from src.database.db_manager import DBManager
                    icao = HIGH_FREQ_AIRPORT_ICAO.get(city, "")
                    db = DBManager()
                    obs = db.get_airport_obs_recent(icao, minutes=60)
                    if obs:
                        temps = [r.get("temp_c") for r in obs if r.get("temp_c") is not None]
                        if len(temps) >= 6:
                            peak = max(temps)
                            peak_idx = temps.index(peak)
                            if peak_idx < len(temps) - 2:
                                post = temps[peak_idx:]
                                if all(post[i] <= post[i - 1] + 0.1 for i in range(1, len(post))):
                                    if current_temp < peak - 0.5:
                                        in_window = False
                except Exception:
                    pass

            if not in_window:
                if last_city.get("active"):
                    last_by_city[city] = {"ts": now_ts, "active": False}
                    state_dirty = True
                continue

            local_time = city_weather.get("local_time") or ""
            message = _build_airport_status_message(city, city_weather, deb_pred, local_time)

            sent = False
            for chat_id in chat_ids:
                try:
                    bot.send_message(chat_id, message)
                    sent = True
                except Exception as exc:
                    logger.warning("airport push failed city={} chat_id={}: {}", city, chat_id, exc)

            if sent:
                last_by_city[city] = {"ts": now_ts, "active": True}
                state_dirty = True
                logger.info("airport status pushed city={} temp={} proximity={:.1f}", city, current_temp, proximity)

        except Exception:
            logger.exception("airport cycle failed for city={}", city)

    return state_dirty


def start_high_freq_airport_push_loop(bot: Any, config: Dict[str, Any]) -> Optional[threading.Thread]:
    enabled = _env_bool("TELEGRAM_AIRPORT_PUSH_ENABLED", True)
    chat_ids = get_telegram_chat_ids_from_env()
    if not enabled:
        logger.info("airport high-freq push loop disabled")
        return None
    if not chat_ids:
        logger.warning("airport high-freq push loop skipped: TELEGRAM_CHAT_IDS is not set")
        return None

    interval_sec = max(30, _env_int("TELEGRAM_AIRPORT_PUSH_INTERVAL_SEC", 60))

    def _runner() -> None:
        state = _load_airport_state()
        logger.info(
            "airport high-freq push loop started cities={} interval={}s chat_targets={}",
            len(HIGH_FREQ_AIRPORT_CITIES), interval_sec, len(chat_ids),
        )
        while True:
            cycle_started = time.time()
            state = _load_airport_state()
            if _run_high_freq_airport_cycle(
                bot=bot,
                config=config,
                chat_ids=chat_ids,
                state=state,
            ):
                _save_airport_state(state)

            elapsed = time.time() - cycle_started
            sleep_sec = max(5, interval_sec - int(elapsed))
            time.sleep(sleep_sec)

    thread = threading.Thread(
        target=_runner,
        name="airport-high-freq-pusher",
        daemon=True,
    )
    thread.start()
    logger.info("airport high-freq push loop thread started")
    return thread
