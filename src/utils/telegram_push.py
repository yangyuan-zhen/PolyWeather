import hashlib
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

import requests as requests_lib
from loguru import logger

from src.database.db_manager import DBManager
from src.database.runtime_state import (
    STATE_STORAGE_SQLITE,
    TelegramAlertStateRepository,
    get_state_storage_mode,
)
from src.data_collection.city_registry import CITY_REGISTRY
from src.utils.telegram_chat_ids import get_telegram_chat_ids_from_env

# Forum topic routing: maps city_key -> message_thread_id for the push forum group.
# Created by scripts/create_forum_topics.py, stored in the runtime data dir.
_CITY_THREAD_IDS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "data", "city_thread_ids.json",
)
_FORUM_CHAT_ID = "-1003927451869"
_city_thread_ids: dict = {}

# Shared HTTP session for AROME and auxiliary queries (connection reuse)
_HTTP_SESSION: Optional[requests_lib.Session] = None
_HTTP_SESSION_LOCK = threading.Lock()

# Bot send_message rate limiter: max N messages per second across all threads
_SEND_MSG_LOCK = threading.Lock()
_SEND_MSG_LAST_TS: float = 0.0
_SEND_MSG_MIN_INTERVAL_SEC = float(os.getenv("TELEGRAM_SEND_RATE_LIMIT_SEC", "0.05"))


def _get_http_session() -> requests_lib.Session:
    global _HTTP_SESSION
    if _HTTP_SESSION is None:
        with _HTTP_SESSION_LOCK:
            if _HTTP_SESSION is None:
                _HTTP_SESSION = requests_lib.Session()
    return _HTTP_SESSION


# Reusable executor for airport push cycles (avoids thread pool churn)
_AIRPORT_EXECUTOR: Optional[ThreadPoolExecutor] = None
_AIRPORT_EXECUTOR_LOCK = threading.Lock()
_AIRPORT_EXECUTOR_MAX_WORKERS: int = 0


def _get_airport_executor(max_workers: int) -> ThreadPoolExecutor:
    global _AIRPORT_EXECUTOR, _AIRPORT_EXECUTOR_MAX_WORKERS
    if _AIRPORT_EXECUTOR is None or _AIRPORT_EXECUTOR_MAX_WORKERS != max_workers:
        with _AIRPORT_EXECUTOR_LOCK:
            if _AIRPORT_EXECUTOR is None or _AIRPORT_EXECUTOR_MAX_WORKERS != max_workers:
                if _AIRPORT_EXECUTOR is not None:
                    _AIRPORT_EXECUTOR.shutdown(wait=False)
                _AIRPORT_EXECUTOR = ThreadPoolExecutor(max_workers=max_workers)
                _AIRPORT_EXECUTOR_MAX_WORKERS = max_workers
    return _AIRPORT_EXECUTOR


def _rate_limited_send(bot: Any, chat_id: str, message: str, **kwargs: Any) -> None:
    """Throttle bot.send_message calls to avoid hitting Telegram rate limits."""
    global _SEND_MSG_LAST_TS
    with _SEND_MSG_LOCK:
        now = time.time()
        wait = _SEND_MSG_MIN_INTERVAL_SEC - (now - _SEND_MSG_LAST_TS)
        if wait > 0:
            time.sleep(wait)
        _SEND_MSG_LAST_TS = time.time()
    bot.send_message(chat_id, message, **kwargs)


def _load_city_thread_ids() -> dict:
    global _city_thread_ids
    if _city_thread_ids:
        return _city_thread_ids
    paths = [
        _CITY_THREAD_IDS_PATH,
        "/var/lib/polyweather/city_thread_ids.json",
        "/app/data/city_thread_ids.json",
    ]
    for path in paths:
        if os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    _city_thread_ids = json.load(f)
                logger.info("loaded city_thread_ids from {}: {} cities", path, len(_city_thread_ids))
                return _city_thread_ids
            except Exception as exc:
                logger.warning("failed to load city_thread_ids from {}: {}", path, exc)
    return {}


def _resolve_thread_id(chat_id: str, city: str) -> int:
    """Return message_thread_id for a given chat and city, or 0 if not a forum topic."""
    if str(chat_id) != _FORUM_CHAT_ID:
        return 0
    mapping = _load_city_thread_ids()
    city_key = str(city or "").strip().lower()
    return int(mapping.get(city_key) or 0)


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

# ── high-freq airport push loop ──

HIGH_FREQ_AIRPORT_CITIES = {
    "seoul", "singapore", "busan", "tokyo", "ankara", "helsinki", "amsterdam",
    "istanbul", "paris", "hong kong", "shenzhen", "taipei",
    "beijing", "shanghai", "guangzhou", "qingdao", "chengdu", "chongqing", "wuhan",
    "new york", "los angeles", "chicago", "denver", "atlanta",
    "miami", "san francisco", "houston", "dallas", "austin", "seattle",
    "tel aviv",
}
HIGH_FREQ_AIRPORT_ICAO = {
    "seoul": "RKSI", "singapore": "WSSS", "busan": "RKPK", "tokyo": "44166",
    "ankara": "17128", "helsinki": "EFHK", "amsterdam": "EHAM", "istanbul": "17058",
    "paris": "LFPB", "hong kong": "HKO", "shenzhen": "LFS", "taipei": "466920",
    "beijing": "ZBAA", "shanghai": "ZSPD", "guangzhou": "ZGGG", "qingdao": "ZSQD",
    "chengdu": "ZUUU", "chongqing": "ZUCK", "wuhan": "ZHHH",
    "new york": "KLGA", "los angeles": "KLAX", "chicago": "KORD",
    "denver": "KBKF", "atlanta": "KATL", "miami": "KMIA",
    "tel aviv": "LLBG",
    "san francisco": "KSFO", "houston": "KHOU", "dallas": "KDAL",
    "austin": "KAUS", "seattle": "KSEA",
}
# Settlement runway mapping — matches settlement anchor stations.
# Format: (low_number, high_number) order-independent; stored sorted for lookup.
SETTLEMENT_RUNWAY_PAIRS: Dict[str, Set[Tuple[str, str]]] = {
    "shanghai": {("17L", "35R")},
    "beijing": {("01", "19")},
    "guangzhou": {("02L", "20R")},
    "chengdu": {("02L", "20R")},
    "chongqing": {("02L", "20R")},
    "wuhan": {("04", "22")},
    "seoul": {("15R", "33L")},
}

# All cities with active runway observation data (AMSC AWOS / AMOS).
RUNWAY_OBSERVATION_CITIES = {
    "shanghai", "beijing", "guangzhou",
    "chengdu", "chongqing", "wuhan", "qingdao",
    "seoul", "busan",
}

# Wind regime sectors per airport (approximate, based on runway orientation + coastline).
# Values: {sea_breeze: (from_deg, to_deg), warm_advection: (from_deg, to_deg)}
WIND_REGIME: Dict[str, Dict[str, Tuple[int, int]]] = {
    "shanghai": {"sea_breeze": (45, 140), "warm_advection": (180, 260)},
    "seoul": {"sea_breeze": (270, 350), "warm_advection": (150, 230)},
    "busan": {"sea_breeze": (120, 200), "warm_advection": (250, 340)},
    "qingdao": {"sea_breeze": (90, 180), "warm_advection": (200, 300)},
    "beijing": {"sea_breeze": (120, 200), "warm_advection": (220, 320)},
    "guangzhou": {"sea_breeze": (120, 200), "warm_advection": (200, 300)},
    "chengdu": {"sea_breeze": (0, 0), "warm_advection": (0, 0)},
    "chongqing": {"sea_breeze": (0, 0), "warm_advection": (0, 0)},
    "wuhan": {"sea_breeze": (0, 0), "warm_advection": (0, 0)},
}

# Legacy alias for backward compat with existing _select_focus_runway_obs / _focus_runway_pairs_for_city
FOCUS_RUNWAY_PAIRS = SETTLEMENT_RUNWAY_PAIRS

_FUNCTION_HASHTAGS = {
    "runway": "#跑道观测",
    "airport": "#机场观测",
    "trade": "#交易机会",
}


def _city_hashtag(city: Optional[str]) -> Optional[str]:
    text = str(city or "").strip()
    if not text:
        return None
    parts = [part for part in re.split(r"[^A-Za-z0-9]+", text.title()) if part]
    if not parts:
        return None
    return "#" + "".join(parts)


def _station_hashtag(station: Optional[str]) -> Optional[str]:
    text = re.sub(r"[^A-Za-z0-9]+", "", str(station or "").upper())
    return f"#{text}" if text else None


def _build_telegram_hashtag_line(
    kind: str,
    *,
    city: Optional[str] = None,
    station: Optional[str] = None,
    extra: Optional[List[str]] = None,
) -> str:
    tags: List[str] = []
    primary = _FUNCTION_HASHTAGS.get(kind)
    if primary:
        tags.append(primary)
    for item in extra or []:
        tag = _FUNCTION_HASHTAGS.get(item, item)
        if tag and tag not in tags:
            tags.append(tag)
    city_tag = _city_hashtag(city)
    if city_tag and city_tag not in tags:
        tags.append(city_tag)
    station_tag = _station_hashtag(station)
    if station_tag and station_tag not in tags:
        tags.append(station_tag)
    return " ".join(tags)


def _fmt(value: Any) -> str:
    """Format a single temperature reading; returns '--' for missing values."""
    if value is None:
        return "--"
    try:
        f = float(value)
        if not -80.0 < f < 80.0:
            return "--"
        return f"{f:.1f}"
    except (TypeError, ValueError):
        return "--"


def _normalize_runway_label(value: Any) -> str:
    return re.sub(r"[^0-9A-Z]+", "", str(value or "").strip().upper())


def _runway_pair_key(r1: Any, r2: Any) -> Tuple[str, str]:
    a = _normalize_runway_label(r1)
    b = _normalize_runway_label(r2)
    return tuple(sorted((a, b)))  # type: ignore[return-value]


def _focus_runway_pairs_for_city(city: str) -> Set[Tuple[str, str]]:
    return {_runway_pair_key(a, b) for a, b in FOCUS_RUNWAY_PAIRS.get(city, set())}


def _select_focus_runway_obs(
    city: str,
    runway_pairs: List[Any],
    runway_temps: List[Any],
    point_temps: Optional[List[Any]] = None,
) -> Tuple[List[Any], List[Any], List[Any]]:
    """Return only market-relevant runway pairs when configured for the city.

    If a configured focus pair is not present in the upstream payload, fall back
    to the original lists so the push still carries useful airport evidence.
    """
    focus_pairs = _focus_runway_pairs_for_city(city)
    if not focus_pairs or not runway_pairs or not runway_temps:
        return runway_pairs, runway_temps, point_temps or []

    selected_pairs: List[Any] = []
    selected_temps: List[Any] = []
    selected_points: List[Any] = []
    points = point_temps or []
    for i, (pair, temp) in enumerate(zip(runway_pairs, runway_temps)):
        try:
            r1, r2 = pair
        except Exception:
            continue
        if _runway_pair_key(r1, r2) not in focus_pairs:
            continue
        selected_pairs.append(pair)
        selected_temps.append(temp)
        if i < len(points):
            selected_points.append(points[i])

    if selected_pairs:
        return selected_pairs, selected_temps, selected_points
    return runway_pairs, runway_temps, points


def _settlement_runway_for_city(city: str) -> Optional[Tuple[str, str]]:
    """Return the settlement runway pair for a city, if configured."""
    pairs = SETTLEMENT_RUNWAY_PAIRS.get(str(city or "").strip().lower(), set())
    return next(iter(pairs)) if pairs else None


def _is_settlement_runway(city: str, r1: str, r2: str) -> bool:
    """Check if a runway pair is the settlement anchor for this city."""
    pair_set = SETTLEMENT_RUNWAY_PAIRS.get(str(city or "").strip().lower(), set())
    return _runway_pair_key(r1, r2) in pair_set


def _wind_regime_label(city: str, wind_dir: Optional[int]) -> Optional[str]:
    """Classify wind direction into a thermal regime label."""
    if wind_dir is None:
        return None
    regimes = WIND_REGIME.get(str(city or "").strip().lower(), {})
    sea = regimes.get("sea_breeze")
    warm = regimes.get("warm_advection")
    if sea and sea[0] != sea[1] and sea[0] <= wind_dir <= sea[1]:
        return "海风降温"
    if warm and warm[0] != warm[1] and warm[0] <= wind_dir <= warm[1]:
        return "暖平流增强"
    return None


def _compute_slope_15m(icao: str, current_temp: float) -> Optional[float]:
    """Estimate 15-minute temperature trend from runway_obs_log."""
    try:
        db = DBManager()
        rows = db.get_runway_obs_recent(icao, minutes=20)
        temps = []
        for r in rows:
            t = r.get("target_runway_max") or r.get("tdz_temp")
            if t is not None:
                temps.append(float(t))
        if len(temps) >= 2:
            # Compare latest vs earliest in ~15 min window
            return round(current_temp - temps[0], 1)
    except Exception:
        pass
    return None


def _runway_heat_signal(
    current_temp: float,
    slope_15m: Optional[float],
    wind_dir: Optional[int],
    city: str,
) -> str:
    """Compute a simple runway heat signal label."""
    if slope_15m is None:
        return ""
    regime = _wind_regime_label(city, wind_dir)
    if slope_15m >= 1.0:
        return "🚀 冲顶增强" if regime == "暖平流增强" else "🔥 升温中"
    if slope_15m >= 0.5:
        return "🔥 升温中"
    if slope_15m >= -0.2:
        return "⚠️ 高位观察" if regime == "海风降温" else "⏸️ 高位横盘"
    return "🧊 过峰风险"


def _focused_runway_max(city: str, city_weather: Dict[str, Any]) -> Optional[float]:
    amos = city_weather.get("amos") or {}
    runway_obs = (amos.get("runway_obs") or {}) if isinstance(amos, dict) else {}
    runway_pairs = runway_obs.get("runway_pairs") or []
    runway_temps = runway_obs.get("temperatures") or []
    runway_pairs, runway_temps, _points = _select_focus_runway_obs(
        city,
        runway_pairs,
        runway_temps,
        runway_obs.get("point_temperatures") or [],
    )
    del runway_pairs
    valid = [float(t) for (t, _d) in runway_temps if t is not None]
    return max(valid) if valid else None


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


_AROME_CACHE: Dict[str, Any] = {}
_AROME_CACHE_TTL_SEC = 600  # AROME HD updates every 15 min; cache 10 min

def _fetch_arome_temp() -> Optional[float]:
    """Fetch latest AROME France HD 15-min temperature for LFPB from Open-Meteo.

    Cached for 10 minutes since the model only updates every 15 minutes.
    """
    now = time.time()
    cached = _AROME_CACHE.get("value")
    cached_at = _AROME_CACHE.get("ts", 0)
    if cached is not None and (now - cached_at) < _AROME_CACHE_TTL_SEC:
        return cached
    try:
        url = (
            "https://api.open-meteo.com/v1/forecast?"
            "latitude=48.9673&longitude=2.4277"
            "&models=meteofrance_arome_france_hd"
            "&minutely_15=temperature_2m"
            "&timezone=Europe/Paris"
            "&forecast_minutely_15=2"
        )
        resp = _get_http_session().get(url, timeout=8)
        data = resp.json()
        temps = (data.get("minutely_15") or {}).get("temperature_2m") or []
        result = float(temps[-1]) if temps else None
        _AROME_CACHE["value"] = result
        _AROME_CACHE["ts"] = now
        return result
    except Exception:
        return _AROME_CACHE.get("value")


def _build_narrative(
    current_temp: Optional[float],
    max_so_far: Optional[float],
    deb_pred: Optional[float],
    models: Dict[str, Any],
    city_weather: Dict[str, Any],
) -> str:
    """Generate a market-structure interpretation based on current state."""
    if current_temp is None:
        return ""
    vals = sorted([v for v in models.values() if isinstance(v, (int, float))])
    model_lo = vals[0] if vals else None
    model_hi = vals[-1] if vals else None
    h = 12
    try:
        h = int(str(city_weather.get("local_time") or "12")[:2])
    except ValueError:
        pass

    lines = []
    # Delta vs daily high
    if max_so_far is not None:
        d = current_temp - max_so_far
        if d >= 0.3:
            lines.append(f"🔺 当前已创今日新高（+{d:.1f}°），持续冲高")
        elif d >= -1.0:
            lines.append(f"紧贴日高，距峰值仅 {abs(d):.1f}°")
        else:
            lines.append(f"低于日高 {abs(d):.1f}°")

    # DEB relation
    if deb_pred is not None:
        if current_temp > deb_pred:
            lines.append("DEB 已被突破，模型偏保守")
        elif max_so_far is not None and max_so_far >= deb_pred:
            pass  # already covered by 日高已触及
        elif current_temp > deb_pred - 2.0:
            lines.append("DEB 仍在可达范围")

    # Model position + time context
    if model_lo is not None and model_hi is not None:
        if current_temp < model_lo:
            if h >= 17:
                lines.append("低于所有模型，晚间升温窗口有限")
            else:
                lines.append("低于主流模型，日间仍有升温空间")
        elif current_temp <= model_hi:
            lines.append("位于模型区间内，市场在预期路径上")
        else:
            lines.append("已超出最热模型，市场进入超预期定价")
    elif max_so_far is not None and current_temp < max_so_far - 2.0:
        if h < 14:
            lines.append("日间仍可能二次冲高")
        else:
            lines.append("已脱离日内峰值")

    return "\n".join(lines)


def _build_airport_status_message(
    city: str,
    city_weather: Dict[str, Any],
    deb_pred: Optional[float],
    local_time: str = "",
    state: str = "",
) -> str:
    _AIRPORT_EN = {"seoul": "Incheon", "singapore": "Changi", "busan": "Gimhae", "tokyo": "Haneda",
                   "ankara": "Esenboğa", "helsinki": "Vantaa", "amsterdam": "Schiphol",
                   "istanbul": "Airport", "paris": "Le Bourget",
                   "hong kong": "Observatory", "shenzhen": "LFS Observatory",
                   "taipei": "Songshan", "beijing": "Capital", "shanghai": "Pudong",
                   "guangzhou": "Baiyun", "qingdao": "Jiaodong",
                   "chengdu": "Shuangliu", "chongqing": "Jiangbei", "wuhan": "Tianhe",
                   "new york": "LaGuardia", "los angeles": "LAX", "chicago": "O'Hare",
                   "denver": "Buckley", "atlanta": "Hartsfield", "miami": "Intl",
                   "san francisco": "SFO", "houston": "Hobby", "dallas": "Love Field",
                   "austin": "Bergstrom", "seattle": "Sea-Tac",
                   "tel aviv": "Ben Gurion"}
    en_name = city.title()
    ap_name = _AIRPORT_EN.get(city, "")
    time_suffix = f" · {local_time}" if local_time else ""

    amos = city_weather.get("amos") or {}
    runway_data = amos.get("runway_obs") or {}
    runway_pairs = runway_data.get("runway_pairs") or []
    runway_temps = runway_data.get("temperatures") or []
    point_temps = runway_data.get("point_temperatures") or []
    is_amsc = amos.get("source") in ("amsc_awos", "amos")
    has_runway = bool(runway_pairs and (runway_temps or point_temps))
    amos_icao = amos.get("icao") or HIGH_FREQ_AIRPORT_ICAO.get(city, "")
    settlement_pair = _settlement_runway_for_city(city)

    # ── Display temp: settlement runway max first, then airport temp ──
    settlement_temp: Optional[float] = None
    display_temp: Optional[float] = None
    if point_temps:
        for pt in point_temps:
            rw = str(pt.get("runway") or "")
            rw_parts = [p.strip() for p in str(rw).split("/") if p.strip()]
            if settlement_pair and len(rw_parts) >= 2 and _runway_pair_key(rw_parts[0], rw_parts[1]) == _runway_pair_key(*settlement_pair):
                tmax = pt.get("target_runway_max")
                if tmax is not None:
                    settlement_temp = float(tmax)
                break
        if settlement_temp is not None:
            display_temp = settlement_temp
    if display_temp is None:
        if point_temps:
            valid_tmax = [float(p.get("target_runway_max")) for p in point_temps if p.get("target_runway_max") is not None]
            display_temp = max(valid_tmax) if valid_tmax else None
    if display_temp is None:
        station_temp = None
        mgm_nearby = city_weather.get("mgm_nearby") or []
        airport_icao = HIGH_FREQ_AIRPORT_ICAO.get(city, "")
        for row in mgm_nearby:
            if str(row.get("istNo") or "") == airport_icao or str(row.get("icao") or "") == airport_icao:
                station_temp = row.get("temp")
                break
        if station_temp is None and mgm_nearby:
            logger.warning(
                "airport message fallback city={}: station {} not found in mgm_nearby, falling back to current.temp",
                city, airport_icao,
            )
        if station_temp is None:
            station_temp = (city_weather.get("current") or {}).get("temp")
        display_temp = station_temp

    # ── Heat model ──
    wind_dir = amos.get("wind_dir") if is_amsc else None
    slope_15m = _compute_slope_15m(amos_icao, display_temp) if is_amsc and display_temp is not None else None
    heat_signal = _runway_heat_signal(display_temp or 0, slope_15m, wind_dir, city) if is_amsc else ""
    wind_label = _wind_regime_label(city, wind_dir) if is_amsc and wind_dir is not None else None

    max_so_far, max_temp_time = _get_airport_daily_high(city_weather)
    # ── Build message ──
    lines: List[str] = []

    # Header
    hashtag_line = _build_telegram_hashtag_line(
        "runway" if has_runway else "airport",
        city=city,
    )
    icao_display = f"{amos_icao} · " if amos_icao else ""
    settlement_str = f" · ★{settlement_pair[0]}/{settlement_pair[1]}" if settlement_pair else ""
    header = f"{icao_display}{en_name} / {ap_name}{settlement_str}{time_suffix}" if ap_name else f"{icao_display}{en_name}{settlement_str}{time_suffix}"
    lines.append(hashtag_line)
    lines.append("")
    lines.append(header)

    # Heat signal
    if heat_signal:
        lines.append("")
        lines.append(heat_signal)
        if state:
            lines.append(state)

    # All runway detail block
    if has_runway:
        lines.append("")
        for i, ((r1, r2), (t, _d)) in enumerate(zip(runway_pairs, runway_temps)):
            if t is None:
                continue
            pts = point_temps[i] if i < len(point_temps) else {}
            tdz = pts.get("tdz_temp")
            mid = pts.get("mid_temp")
            end = pts.get("end_temp")
            is_settlement = _is_settlement_runway(city, r1, r2)
            marker = " ★结算" if is_settlement else ""
            tmax = pts.get("target_runway_max")
            if tdz is not None or mid is not None or end is not None:
                line = f"{r1}/{r2}{marker}  TDZ:{_fmt(tdz)}  MID:{_fmt(mid)}  END:{_fmt(end)}"
                if tmax is not None:
                    line += f"  max:{tmax:.1f}"
                lines.append(line)
            else:
                lines.append(f"{r1}/{r2}{marker} {t:.1f}°C")

    # Summary stats
    lines.append("")
    temp_symbol = str(city_weather.get("temp_symbol") or "°C").strip()
    cur_str = f"{display_temp:.1f}{temp_symbol}" if display_temp is not None else "--"
    if has_runway:
        lines.append(f"结算跑道当前：{cur_str}")
    else:
        lines.append(f"当前：{cur_str}")
    if max_so_far is not None:
        time_str = f"（{max_temp_time}）" if max_temp_time else ""
        if has_runway:
            lines.append(f"今日跑道高点：{max_so_far:.1f}{temp_symbol}{time_str}")
        else:
            lines.append(f"日高：{max_so_far:.1f}{temp_symbol}{time_str}")
    if slope_15m is not None:
        sign = "+" if slope_15m >= 0 else ""
        lines.append(f"15分钟趋势：{sign}{slope_15m:.1f}°C")
    if wind_dir is not None:
        wind_str = f"风向：{wind_dir}°"
        if wind_label:
            wind_str += f"  {wind_label}"
        lines.append(wind_str)
    # --- AMSC METAR temp + time for Chinese cities (Beijing time) ---
    if is_amsc:
        raw_metar = amos.get("raw_metar") or ""
        if raw_metar:
            parts = raw_metar.split()
            # Extract temp/dew: "20/17" → 20
            metar_temp = None
            for p in parts:
                m = re.match(r"^(M?\d{2})/(M?\d{2})$", p)
                if m:
                    t = m.group(1)
                    metar_temp = str(int(t.replace("M", "-")))
                    break
            # Extract time: "211930Z" → Beijing time (UTC+8)
            metar_time = None
            for p in parts:
                m = re.match(r"^(\d{2})(\d{2})(\d{2})Z$", p)
                if m:
                    _day, hh, mm = int(m.group(1)), int(m.group(2)), m.group(3)
                    bj_h = hh + 8
                    if bj_h >= 24:
                        bj_h -= 24
                    metar_time = f"北京时 {bj_h:02d}:{mm}"
                    break
            if metar_temp or metar_time:
                bits = []
                if metar_temp:
                    bits.append(f"{metar_temp}{temp_symbol}")
                if metar_time:
                    bits.append(metar_time)
                lines.append(f"报文: {'  '.join(bits)}")
    if deb_pred is not None:
        if display_temp is not None and display_temp > deb_pred:
            lines.append(f"DEB：{deb_pred:.1f}{temp_symbol}（已突破 +{display_temp - deb_pred:.1f}°）")
        else:
            lines.append(f"DEB：{deb_pred:.1f}{temp_symbol}")

    # Model summary (compact)
    models = city_weather.get("multi_model") or {}
    if isinstance(models, dict) and len(models) >= 2:
        vals = sorted([(v, k) for k, v in models.items() if isinstance(v, (int, float))])
        if len(vals) >= 2:
            lo, hi = vals[0][0], vals[-1][0]
            spread = hi - lo
            spread_label = "低分歧" if spread <= 2.0 else ("中等分歧" if spread <= 4.0 else "高分歧")
            lines.append(f"模型区间：{lo:.1f}~{hi:.1f}{temp_symbol}  {spread_label}")

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


# Per-city push interval — unified to 60s, obs_time dedup prevents spam
_AIRPORT_PUSH_INTERVAL = {
    "seoul": 60, "busan": 60, "tokyo": 60, "ankara": 60,
    "helsinki": 60, "amsterdam": 60, "istanbul": 60, "paris": 60,
    "hong kong": 60, "shenzhen": 60, "singapore": 60, "taipei": 60,
    "beijing": 60, "shanghai": 60, "guangzhou": 60, "qingdao": 60,
    "chengdu": 60, "chongqing": 60, "wuhan": 60,
    "new york": 60, "los angeles": 60, "chicago": 60, "denver": 60,
    "atlanta": 60, "miami": 60, "san francisco": 60, "houston": 60,
    "dallas": 60, "austin": 60, "seattle": 60,
    "tel aviv": 60,
}
# Per-city temperature window threshold (°C below DEB predicted high)
# Continental airports: wider window (temp rises steadily over land)
# Maritime airports: narrower (sea breeze moderates temp)
# Strong sea breeze: tightest (marine air suppresses peak)
_AIRPORT_HEAT_THRESHOLD = {
    "seoul": 3.0, "ankara": 3.0, "istanbul": 3.0, "paris": 3.0,
    "busan": 2.0, "tokyo": 2.0, "amsterdam": 2.0, "helsinki": 2.0,
    "hong kong": 1.5, "shenzhen": 1.5, "taipei": 1.5,
}


# 部分城市 Open-Meteo 算出的 peak 窗口偏窄，用 fallback 拓宽
# （例如沿海城市受海风影响，高温窗口被压缩）
_AIRPORT_PEAK_FALLBACK = {
    "busan": (12, 16),
}

def _in_peak_time_window(city: str, city_weather: Dict[str, Any]) -> bool:
    """Check if current local time is within the expected peak temperature window."""
    peak = city_weather.get("peak") or {}
    first_h = peak.get("first_h")
    last_h = peak.get("last_h")
    fallback = _AIRPORT_PEAK_FALLBACK.get(city)
    if fallback and ((first_h is None) or (last_h is not None and last_h - first_h < 3)):
        first_h, last_h = fallback
    local_time = city_weather.get("local_time") or ""
    if first_h is None or not local_time:
        return False
    try:
        current_h, current_m = int(local_time[:2]), int(local_time[3:5])
        current_minutes = current_h * 60 + current_m
        # Window: first_h - 4h to last_h + 2h
        start_min = max(0, (first_h - 4) * 60)
        end_min = min(24 * 60 - 1, (last_h + 2) * 60)
        return start_min <= current_minutes <= end_min
    except Exception:
        return False


def _check_rising_trend(icao: str) -> bool:
    """Check if temperature has been rising over the last 30-60 minutes."""
    try:
        from src.database.db_manager import DBManager
        db = DBManager()
        obs = db.get_airport_obs_recent(icao, minutes=60)
        if not obs:
            return False
        temps = [r.get("temp_c") for r in obs if r.get("temp_c") is not None]
        if len(temps) < 4:
            return False
        # Check: last 3 readings are increasing
        recent = temps[-3:]
        if recent[2] > recent[1] > recent[0]:
            return True
        # Or: current > 30 min ago
        if len(temps) >= 4:
            mid = len(temps) // 2
            if temps[-1] > temps[mid]:
                return True
        return False
    except Exception:
        return False


def _process_airport_city(
    city: str,
    now_ts: int,
    last_city: dict,
    chat_ids: List[str],
    bot: Any,
) -> Optional[Tuple[str, dict]]:
    """Process one airport city and return (city, new_state_entry) or None.

    This is the per-city unit used by the concurrent thread pool in
    ``_run_high_freq_airport_cycle``.
    """
    last_city_ts = int(last_city.get("ts") or 0)
    last_obs_time = str(last_city.get("obs_time") or "")
    city_interval = _AIRPORT_PUSH_INTERVAL.get(city, 600)
    if now_ts - last_city_ts < city_interval:
        return None

    from web.app import _analyze  # lazy import — only the bot process needs it

    city_weather: Dict[str, Any] = {}
    deb_pred: Optional[float] = None
    try:
        city_weather = _analyze(city, force_refresh_observations_only=True)
        deb_raw = (city_weather.get("deb") or {}).get("prediction")
        if deb_raw is not None:
            deb_pred = float(deb_raw)
    except Exception:
        logger.exception("airport analyze failed for city={}", city)
        return None

    # Extract airport-level temperature
    amos = city_weather.get("amos") or {}
    mgm_nearby = city_weather.get("mgm_nearby") or []
    airport_icao = HIGH_FREQ_AIRPORT_ICAO.get(city, "")
    airport_row = None
    for row in mgm_nearby:
        if str(row.get("istNo") or "") == airport_icao or str(row.get("icao") or "") == airport_icao:
            airport_row = row
            break
    if not airport_row:
        airport_primary = city_weather.get("airport_primary") or {}
        if airport_primary.get("temp") is not None:
            airport_row = airport_primary
        else:
            current_fallback = city_weather.get("current") or {}
            if current_fallback.get("temp") is not None:
                airport_row = current_fallback
            else:
                logger.warning(
                    "airport push skipped city={}: station {} not found in mgm_nearby, "
                    "airport_primary, or current (mgm={} rows)",
                    city, airport_icao, len(mgm_nearby),
                )
                return None
    station_temp = airport_row.get("temp") if airport_row else None
    current_obs_time = str(airport_row.get("obs_time") or "")

    runway_obs = (amos.get("runway_obs") or {})
    runway_pairs = runway_obs.get("runway_pairs") or []
    runway_temps = runway_obs.get("temperatures") or []
    runway_pairs, runway_temps, _point_temps = _select_focus_runway_obs(
        city, runway_pairs, runway_temps,
        runway_obs.get("point_temperatures") or [],
    )
    if runway_temps:
        valid_temps = [t for (t, _d) in runway_temps if t is not None]
        if valid_temps:
            station_temp = max(valid_temps)
        amos_obs_time = amos.get("observation_time") or ""
        if amos_obs_time:
            current_obs_time = amos_obs_time

    current_temp = station_temp
    if current_temp is None:
        airport_primary = city_weather.get("airport_primary") or {}
        current_temp = airport_primary.get("temp") or (city_weather.get("current") or {}).get("temp")
        if not current_obs_time:
            current_obs_time = str(airport_primary.get("obs_time") or "")
    if city == "paris":
        # AEROWEB provides real observations; prefer over AROME model nowcast
        airport_primary = city_weather.get("airport_primary") or {}
        if airport_primary.get("source_code") != "aeroweb":
            arome_temp = _fetch_arome_temp()
            if arome_temp is not None:
                current_temp = arome_temp
                city_weather.setdefault("current", {})["temp"] = arome_temp
                if not current_obs_time:
                    current_obs_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    if current_temp is None or deb_pred is None:
        return None

    # Dedup: same observation → skip (with delayed retry for HK / LFS)
    _CITIES_WITH_DELAYED_API = {"hong kong", "shenzhen"}
    if (current_obs_time and last_obs_time and current_obs_time == last_obs_time
            and city in _CITIES_WITH_DELAYED_API
            and now_ts - last_city_ts > 540):
        time.sleep(4)
        try:
            city_weather = _analyze(city, force_refresh_observations_only=True)
            deb_raw2 = (city_weather.get("deb") or {}).get("prediction")
            if deb_raw2 is not None:
                deb_pred = float(deb_raw2)
            mgm_nearby2 = city_weather.get("mgm_nearby") or []
            row2 = None
            for r in mgm_nearby2:
                if str(r.get("istNo") or "") == airport_icao or str(r.get("icao") or "") == airport_icao:
                    row2 = r
                    break
            if not row2 and mgm_nearby2:
                row2 = mgm_nearby2[0]
            retry_obs = str(row2.get("obs_time") or "") if row2 else ""
            if retry_obs and retry_obs != last_obs_time:
                current_obs_time = retry_obs
                station_temp = row2.get("temp") if row2 else None
                current_temp = station_temp or (city_weather.get("current") or {}).get("temp")
                if current_temp is None or deb_pred is None:
                    return None
            else:
                return None
        except Exception:
            return None
    elif current_obs_time and last_obs_time and current_obs_time == last_obs_time:
        return None

    obs_local = (
        ((city_weather.get("amos") or {}).get("observation_time_local") or "")[11:16]
        if len(str((city_weather.get("amos") or {}).get("observation_time_local") or "")) >= 16
        else (city_weather.get("airport_current") or {}).get("obs_time")
        or city_weather.get("local_time")
        or ""
    )
    message = _build_airport_status_message(city, city_weather, deb_pred, obs_local, state="")

    # Send to all target chats
    sent = False
    for chat_id in chat_ids:
        try:
            kwargs = {}
            thread_id = _resolve_thread_id(chat_id, city)
            if thread_id:
                kwargs["message_thread_id"] = thread_id
            _rate_limited_send(bot, chat_id, message, **kwargs)
            sent = True
        except Exception as exc:
            logger.warning("airport push failed city={} chat_id={}: {}", city, chat_id, exc)

    if sent:
        logger.info("airport status pushed city={} temp={} deb={} obs_time={}",
                     city, current_temp, deb_pred, current_obs_time)
        return (city, {"ts": now_ts, "active": True, "obs_time": current_obs_time})

    return None


def _run_high_freq_airport_cycle(
    bot: Any,
    config: Dict[str, Any],
    chat_ids: List[str],
    state: Dict[str, Any],
) -> bool:
    state_dirty = False
    now_ts = int(time.time())
    last_by_city = state.setdefault("last_by_city", {})
    max_workers = max(1, min(4, _env_int("TELEGRAM_AIRPORT_PUSH_MAX_WORKERS", 1)))
    logger.info("airport cycle tick cities={} max_workers={}", len(HIGH_FREQ_AIRPORT_CITIES), max_workers)

    cities = sorted(HIGH_FREQ_AIRPORT_CITIES)
    pool = _get_airport_executor(max_workers)
    futures = {
        pool.submit(
            _process_airport_city,
            city,
            now_ts,
            last_by_city.get(city) or {},
            chat_ids,
            bot,
        ): city
        for city in cities
    }
    for future in as_completed(futures):
        try:
            result = future.result()
        except Exception:
            logger.exception("airport city task crashed city={}", futures[future])
            continue
        if result is None:
            continue
        city, entry = result
        last_by_city[city] = entry
        state_dirty = True

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
            try:
                state = _load_airport_state()
                if _run_high_freq_airport_cycle(
                    bot=bot,
                    config=config,
                    chat_ids=chat_ids,
                    state=state,
                ):
                    _save_airport_state(state)
            except Exception:
                logger.exception("airport push cycle crashed")

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
