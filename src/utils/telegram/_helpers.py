"""Pure utility/formatting functions and shared state for Telegram push."""

import hashlib
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

import requests as requests_lib
from loguru import logger

from src.data_collection.city_registry import ALIASES, CITY_REGISTRY
from src.utils.telegram_chat_ids import parse_telegram_chat_ids
from src.utils.telegram_i18n import (
    is_bilingual as _is_bilingual,
    is_zh as _is_zh,
    telegram_push_language as _resolve_telegram_push_language,
)

from ._config import (
    HIGH_FREQ_AIRPORT_CITIES,
    SEVERITY_RANK,
    _FUNCTION_HASHTAGS_EN,
    _FUNCTION_HASHTAGS_ZH,
)

# Forum topic routing: maps city_key -> message_thread_id for the push forum group.
# Created by scripts/create_forum_topics.py, stored in the runtime data dir.
_CITY_THREAD_IDS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "data", "city_thread_ids.json",
)
_DEFAULT_FORUM_CHAT_ID = "-1003927451869"
_city_thread_ids: dict = {}
_CITY_THREAD_IDS_LOCK = threading.Lock()

# Shared HTTP session for AROME and auxiliary queries (connection reuse)
_HTTP_SESSION: Optional[requests_lib.Session] = None
_HTTP_SESSION_LOCK = threading.Lock()

# Bot send_message rate limiter: max N messages per second across all threads
_SEND_MSG_LOCK = threading.Lock()
_SEND_MSG_LAST_TS: float = 0.0
_SEND_MSG_MIN_INTERVAL_SEC = float(os.getenv("TELEGRAM_SEND_RATE_LIMIT_SEC", "1.1"))

# Reusable executor for airport push cycles (avoids thread pool churn)
_AIRPORT_EXECUTOR: Optional[ThreadPoolExecutor] = None
_AIRPORT_EXECUTOR_LOCK = threading.Lock()
_AIRPORT_EXECUTOR_MAX_WORKERS: int = 0


def _get_http_session() -> requests_lib.Session:
    global _HTTP_SESSION
    if _HTTP_SESSION is None:
        with _HTTP_SESSION_LOCK:
            if _HTTP_SESSION is None:
                _HTTP_SESSION = requests_lib.Session()
    return _HTTP_SESSION


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


def normalize_airport_push_city(raw: str) -> str:
    city = str(raw or "").strip().lower().replace("-", " ")
    city = re.sub(r"\s+", " ", city)
    compact = city.replace(" ", "")
    city = ALIASES.get(city, ALIASES.get(compact, city))
    if city not in HIGH_FREQ_AIRPORT_CITIES:
        city = {
            candidate.replace(" ", ""): candidate
            for candidate in HIGH_FREQ_AIRPORT_CITIES
        }.get(compact, city)
    if city in HIGH_FREQ_AIRPORT_CITIES:
        return city
    return ""


def _city_thread_ids_write_path() -> str:
    env_path = str(os.getenv("POLYWEATHER_CITY_THREAD_IDS_PATH") or "").strip()
    if env_path:
        return env_path
    for path in (
        "/var/lib/polyweather/city_thread_ids.json",
        "/app/data/city_thread_ids.json",
        _CITY_THREAD_IDS_PATH,
    ):
        if os.path.isfile(path):
            return path
    return "/var/lib/polyweather/city_thread_ids.json"


def record_city_thread_id(city: str, thread_id: int) -> dict:
    """Persist a forum topic mapping and update the in-process cache."""

    global _city_thread_ids
    normalized_city = normalize_airport_push_city(city)
    if not normalized_city:
        raise ValueError(f"unsupported airport push city: {city}")
    try:
        normalized_thread_id = int(thread_id)
    except Exception as exc:
        raise ValueError(f"invalid message_thread_id: {thread_id}") from exc
    if normalized_thread_id <= 0:
        raise ValueError(f"invalid message_thread_id: {thread_id}")

    with _CITY_THREAD_IDS_LOCK:
        path = _city_thread_ids_write_path()
        mapping = dict(_load_city_thread_ids())
        mapping[normalized_city] = normalized_thread_id
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp_path = f"{path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(mapping, f, ensure_ascii=False, indent=2, sort_keys=True)
            f.write("\n")
        os.replace(tmp_path, path)
        _city_thread_ids = mapping
        logger.info(
            "recorded forum topic mapping city={} thread_id={} path={} total={}",
            normalized_city,
            normalized_thread_id,
            path,
            len(mapping),
        )
        return {
            "city": normalized_city,
            "thread_id": normalized_thread_id,
            "path": path,
            "total": len(mapping),
        }


def _forum_chat_ids() -> Set[str]:
    return set(
        parse_telegram_chat_ids(
            os.getenv("TELEGRAM_FORUM_CHAT_ID"),
            os.getenv("POLYWEATHER_TELEGRAM_TOPICS_GROUP_ID"),
            os.getenv("POLYWEATHER_TELEGRAM_GROUP_ID"),
            _DEFAULT_FORUM_CHAT_ID,
        )
    )


def _is_forum_chat_id(chat_id: Any) -> bool:
    chat_key = str(chat_id or "").strip()
    return bool(chat_key and chat_key in _forum_chat_ids())


def _resolve_thread_id(chat_id: str, city: str) -> int:
    """Return message_thread_id for a given chat and city, or 0 if not a forum topic."""
    if not _is_forum_chat_id(chat_id):
        return 0
    mapping = _load_city_thread_ids()
    city_key = (city or "").strip().lower()
    return int(mapping.get(city_key) or 0)


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


def _telegram_push_language() -> str:
    return _resolve_telegram_push_language(
        "TELEGRAM_AIRPORT_PUSH_LANGUAGE",
        "TELEGRAM_PUSH_LANGUAGE",
        "POLYWEATHER_TELEGRAM_PUSH_LANGUAGE",
    )


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


def _parse_observation_time_epoch(value: Any) -> Optional[int]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        numeric = float(text)
        if numeric >= 1_000_000_000:
            return int(numeric)
    except (TypeError, ValueError):
        pass
    parsed = _parse_iso_datetime_utc(text)
    return int(parsed.timestamp()) if parsed is not None else None


def _parse_city_list(raw: Optional[str]) -> List[str]:
    if not raw:
        return list(CITY_REGISTRY.keys())

    out: List[str] = []
    for part in raw.split(","):
        city = part.strip().lower()
        if city and city in CITY_REGISTRY:
            out.append(city)
    return out or list(CITY_REGISTRY.keys())


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


def _city_hashtag(city: Optional[str]) -> Optional[str]:
    text = (city or "").strip()
    if not text:
        return None
    parts = [part for part in re.split(r"[^A-Za-z0-9]+", text.title()) if part]
    if not parts:
        return None
    return "#" + "".join(parts)


def _station_hashtag(station: Optional[str]) -> Optional[str]:
    text = re.sub(r"[^A-Za-z0-9]+", "", (station or "").upper())
    return f"#{text}" if text else None


def _build_telegram_hashtag_line(
    kind: str,
    *,
    city: Optional[str] = None,
    station: Optional[str] = None,
    extra: Optional[List[str]] = None,
    language: Optional[str] = None,
) -> str:
    tags: List[str] = []
    tag_maps = (
        (_FUNCTION_HASHTAGS_EN, _FUNCTION_HASHTAGS_ZH)
        if _is_bilingual(language)
        else ((_FUNCTION_HASHTAGS_ZH,) if _is_zh(language) else (_FUNCTION_HASHTAGS_EN,))
    )
    for tag_map in tag_maps:
        primary = tag_map.get(kind)
        if primary and primary not in tags:
            tags.append(primary)
    for item in extra or []:
        added = False
        for tag_map in tag_maps:
            tag = tag_map.get(item)
            if tag and tag not in tags:
                tags.append(tag)
                added = True
        if not added and item and item not in tags:
            tags.append(item)
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
