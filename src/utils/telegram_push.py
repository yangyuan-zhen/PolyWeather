import hashlib
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger

from src.database.runtime_state import (
    STATE_STORAGE_SQLITE,
    TelegramAlertStateRepository,
    get_state_storage_mode,
)
from src.data_collection.city_registry import CITY_REGISTRY
from src.utils.telegram_chat_ids import (
    get_market_monitor_chat_ids_from_env,
    get_telegram_chat_ids_from_env,
)


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

HIGH_FREQ_AIRPORT_CITIES = {"seoul", "busan", "tokyo", "ankara", "helsinki", "amsterdam", "istanbul", "paris", "hong kong", "lau fau shan", "taipei", "beijing", "shanghai", "guangzhou", "shenzhen", "qingdao", "chengdu", "chongqing", "wuhan"}
HIGH_FREQ_AIRPORT_ICAO = {"seoul": "RKSI", "busan": "RKPK", "tokyo": "44166", "ankara": "17128", "helsinki": "EFHK", "amsterdam": "EHAM", "istanbul": "17058", "paris": "LFPB", "hong kong": "HKO", "lau fau shan": "LFS", "taipei": "466920", "beijing": "ZBAA", "shanghai": "ZSPD", "guangzhou": "ZGGG", "shenzhen": "ZGSZ", "qingdao": "ZSQD", "chengdu": "ZUUU", "chongqing": "ZUCK", "wuhan": "ZHHH"}
MARKET_MONITOR_INTERVAL_SEC = 300
MARKET_MONITOR_CITIES = [
    "seoul", "busan", "tokyo", "helsinki", "amsterdam",
    "istanbul", "paris", "hong kong", "lau fau shan", "taipei",
    "new york", "los angeles", "chicago", "denver", "atlanta",
    "miami", "san francisco", "houston", "dallas", "austin", "seattle",
    "beijing", "shanghai", "guangzhou", "shenzhen", "qingdao",
    "chengdu", "chongqing", "wuhan",
]

_FUNCTION_HASHTAGS = {
    "runway": "#跑道观测",
    "airport": "#机场观测",
    "market": "#市场监控",
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


def _format_percent(value: Any) -> str:
    try:
        numeric = float(value)
    except Exception:
        return "--"
    sign = "+" if numeric > 0 else ""
    return f"{sign}{numeric:.1f}%"


def _format_prob(value: Any) -> str:
    try:
        numeric = float(value)
    except Exception:
        return "--"
    if numeric <= 1:
        numeric *= 100
    return f"{numeric:.1f}%"


def _build_market_monitor_message(city: str, city_weather: Dict[str, Any]) -> str:
    current = city_weather.get("current") or {}
    airport_cur = city_weather.get("airport_current") or {}
    deb = city_weather.get("deb") or {}
    local_time = str(city_weather.get("local_time") or "").strip() or "--"
    city_label = str(city or "").strip().title()
    current_temp = airport_cur.get("temp") if airport_cur.get("temp") is not None else current.get("temp")
    deb_pred = deb.get("prediction")
    temp_symbol = str(city_weather.get("temp_symbol") or "°C").strip()

    lines = [
        _build_telegram_hashtag_line("market", city=city),
        f"{city_label} {local_time}",
    ]
    if current_temp is not None or deb_pred is not None:
        current_text = f"{float(current_temp):.1f}{temp_symbol}" if current_temp is not None else "--"
        deb_text = f"{float(deb_pred):.1f}{temp_symbol}" if deb_pred is not None else "--"
        lines.append(f"当前：{current_text} · DEB：{deb_text}")
    return "\n".join(lines)

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
        result = float(temps[-1]) if temps else None
        _AROME_CACHE["value"] = result
        _AROME_CACHE["ts"] = now
        return result
    except Exception:
        return _AROME_CACHE.get("value")


def _build_airport_status_message(
    city: str,
    city_weather: Dict[str, Any],
    deb_pred: Optional[float],
    local_time: str = "",
    state: str = "",
) -> str:
    _AIRPORT_EN = {"seoul": "Incheon", "busan": "Gimhae", "tokyo": "Haneda",
                   "ankara": "Esenboğa", "helsinki": "Vantaa", "amsterdam": "Schiphol",
                   "istanbul": "Airport", "paris": "Le Bourget",
                   "hong kong": "Observatory", "lau fau shan": "Lau Fau Shan",
                   "taipei": "Songshan", "beijing": "Capital", "shanghai": "Pudong",
                   "guangzhou": "Baiyun", "shenzhen": "Bao'an", "qingdao": "Jiaodong",
                   "chengdu": "Shuangliu", "chongqing": "Jiangbei", "wuhan": "Tianhe"}
    en_name = city.title()
    ap_name = _AIRPORT_EN.get(city, "")
    time_suffix = f" {local_time}" if local_time else ""
    header = f"{en_name} / {ap_name}{time_suffix}" if ap_name else f"{en_name}{time_suffix}"
    state_line = f"  {state}" if state else ""

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
    is_amsc = amos.get("source") == "amsc_awos"
    has_runway = bool(runway_pairs and runway_temps and len(runway_pairs) == len(runway_temps))
    hashtag_line = _build_telegram_hashtag_line(
        "runway" if has_runway else "airport",
        city=city,
    )
    lines = [hashtag_line, header + flag]
    if state_line:
        lines.append(state_line.strip())
    lines.append("")
    runway_shown = False
    if is_amsc and runway_pairs and runway_temps and len(runway_pairs) == len(runway_temps):
        point_temps = runway_data.get("point_temperatures") or []
        for i, ((r1, r2), (t, _d)) in enumerate(zip(runway_pairs, runway_temps)):
            if t is not None:
                pts = point_temps[i] if i < len(point_temps) else {}
                tdz = pts.get("tdz_temp")
                mid = pts.get("mid_temp")
                end = pts.get("end_temp")
                if tdz is not None or mid is not None or end is not None:
                    lines.append(
                        f"{r1}/{r2}  TDZ:{_fmt(tdz)}  MID:{_fmt(mid)}  END:{_fmt(end)}"
                    )
                else:
                    lines.append(f"{r1}/{r2} {t:.1f}°C")
                runway_shown = True
    elif has_runway:
        for (r1, r2), (t, _d) in zip(runway_pairs, runway_temps):
            if t is not None:
                lines.append(f"{r1}/{r2} {t:.1f}°C")
                runway_shown = True
    if not runway_shown and station_temp is not None:
        label = "AROME预报" if city == "paris" else "当前实测"
        lines.append(f"{label}：{station_temp:.1f}°C")
        # Show settlement (rounded-down) temp for HKO floor-rounding cities
        if city == "hong kong" and station_temp is not None:
            from src.analysis.settlement_rounding import apply_city_settlement
            settled = apply_city_settlement(city, station_temp)
            if settled is not None:
                lines.append(f"结算温度：{settled}°C")
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


# Per-city push interval — unified to 60s, obs_time dedup prevents spam
_AIRPORT_PUSH_INTERVAL = {
    "seoul": 60,
    "busan": 60,
    "tokyo": 60,
    "ankara": 60,
    "helsinki": 60,
    "amsterdam": 60,
    "istanbul": 60,
    "paris": 60,
    "hong kong": 60,
    "lau fau shan": 60,
    "taipei": 60,
    "beijing": 60,
    "shanghai": 60,
    "guangzhou": 60,
    "shenzhen": 60,
    "qingdao": 60,
    "chengdu": 60,
    "chongqing": 60,
    "wuhan": 60,
}
# Per-city temperature window threshold (°C below DEB predicted high)
# Continental airports: wider window (temp rises steadily over land)
# Maritime airports: narrower (sea breeze moderates temp)
# Strong sea breeze: tightest (marine air suppresses peak)
_AIRPORT_HEAT_THRESHOLD = {
    "seoul": 3.0, "ankara": 3.0, "istanbul": 3.0, "paris": 3.0,
    "busan": 2.0, "tokyo": 2.0, "amsterdam": 2.0, "helsinki": 2.0,
    "hong kong": 1.5, "lau fau shan": 1.5, "taipei": 1.5,
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
            last_obs_time = str(last_city.get("obs_time") or "")
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
                airport_row = mgm_nearby[0] if mgm_nearby else {}
            station_temp = airport_row.get("temp") if airport_row else None
            current_obs_time = str(airport_row.get("obs_time") or "")

            runway_temps = (amos.get("runway_obs") or {}).get("temperatures") or []
            if runway_temps:
                valid_temps = [t for (t, _d) in runway_temps if t is not None]
                if valid_temps:
                    station_temp = max(valid_temps)
                amos_obs_time = amos.get("observation_time") or ""
                if amos_obs_time:
                    current_obs_time = amos_obs_time

            current_temp = station_temp
            if current_temp is None:
                current_temp = (city_weather.get("current") or {}).get("temp")
            if city == "paris":
                arome_temp = _fetch_arome_temp()
                if arome_temp is not None:
                    current_temp = arome_temp
                    city_weather.setdefault("current", {})["temp"] = arome_temp
                    if not current_obs_time:
                        current_obs_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
            if current_temp is None or deb_pred is None:
                continue

            # 基于原始观测数据时间的去重：同一条观测不重复推送
            # HK/LFS 数据在 x7 分发布，API 可能有 3-5s 延迟，
            # obs_time 未变但距上次推送已超 9min → 等 4s 重拉一次
            _CITIES_WITH_DELAYED_API = {"hong kong", "lau fau shan"}
            if (current_obs_time and last_obs_time and current_obs_time == last_obs_time
                    and city in _CITIES_WITH_DELAYED_API
                    and now_ts - last_city_ts > 540):
                time.sleep(4)
                try:
                    city_weather = _analyze(city)
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
                            continue
                    else:
                        continue
                except Exception:
                    continue
            elif current_obs_time and last_obs_time and current_obs_time == last_obs_time:
                continue

            # ── 热度状态机 ──
            daily_high, max_time = _get_airport_daily_high(city_weather)
            gap = (daily_high - current_temp) if daily_high is not None and current_temp is not None else None
            try:
                h = int(str(city_weather.get("local_time") or "00")[:2])
            except ValueError:
                h = 0
            rising = _check_rising_trend(airport_icao) if city != "paris" else True

            # 夜间 (20:00–06:00)：🌙 无有效升温窗口，跳过
            if h >= 20 or h <= 5:
                continue

            # 早晨 (06:00–09:00)："今日最高"可能只是凌晨刚形成的首个观测值
            # 只有日高已稳定存在一段时间，或当前已明显高于凌晨基线，才有意义
            high_formed = (
                max_time is not None
                and daily_high is not None
                and current_temp is not None
                and (h >= 9 or current_temp > daily_high + 0.5)
            )

            # 判定状态
            if current_temp is not None and daily_high is not None and current_temp > daily_high + 0.3:
                if deb_pred is not None and current_temp > deb_pred:
                    state = "\U0001f680 超预期"
                else:
                    state = "\U0001f525 冲高中"
            elif high_formed and gap is not None and gap <= 1.0:
                state = "⚠️ 冲顶观察"
            elif high_formed and gap is not None and gap <= 2.0 and rising:
                state = "\U0001f525 升温中"
            elif gap is not None and gap <= 3.0:
                state = "❄️ 降温中"
            else:
                continue

            # 用观测数据时间而非当前本地时间
            airport_cur = city_weather.get("airport_current") or {}
            amos_obs = (city_weather.get("amos") or {}).get("observation_time_local") or ""
            if amos_obs and len(str(amos_obs)) >= 16:
                amos_obs = str(amos_obs)[11:16]  # "2026-05-15 17:32:00" → "17:32"
            obs_local = amos_obs or airport_cur.get("obs_time") or city_weather.get("local_time") or ""
            message = _build_airport_status_message(city, city_weather, deb_pred, obs_local, state=state)

            sent = False
            for chat_id in chat_ids:
                try:
                    bot.send_message(chat_id, message)
                    sent = True
                except Exception as exc:
                    logger.warning("airport push failed city={} chat_id={}: {}", city, chat_id, exc)

            if sent:
                last_by_city[city] = {"ts": now_ts, "active": True, "obs_time": current_obs_time}
                state_dirty = True
                logger.info("airport status pushed city={} temp={} deb={} obs_time={}", city, current_temp, deb_pred, current_obs_time)

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


def _run_market_monitor_cycle(bot: Any, chat_ids: List[str]) -> bool:
    sent_any = False
    try:
        from web.app import _analyze
        from web.services.city_payloads import build_city_market_scan_payload
    except Exception as exc:
        logger.warning("market monitor push skipped: analyze import failed: {}", exc)
        return False

    def _process_one(city: str) -> Optional[str]:
        try:
            city_weather = _analyze(city)
            scan_payload = build_city_market_scan_payload(city_weather)
            market = scan_payload.get("market_scan") or {}
            if not market.get("available"):
                return None
            city_weather["market_scan"] = market
            ac = city_weather.get("airport_current") or {}
            current_temp = ac.get("temp") if ac.get("temp") is not None else (city_weather.get("current") or {}).get("temp")
            deb_pred = (city_weather.get("deb") or {}).get("prediction")
            if current_temp is not None and deb_pred is not None:
                delta = float(current_temp) - float(deb_pred)
                is_f = "F" in str(city_weather.get("temp_symbol") or "").upper()
                if delta > (5.0 if is_f else 3.0) or delta < -(9.0 if is_f else 5.0):
                    return None
            return _build_market_monitor_message(city, city_weather)
        except Exception:
            logger.exception("market monitor cycle failed for city={}", city)
            return None

    cities = list(MARKET_MONITOR_CITIES)
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(_process_one, city): city for city in cities}
        for future in as_completed(futures):
            try:
                message = future.result()
            except Exception:
                continue
            if message is None:
                continue
            for chat_id in chat_ids:
                try:
                    bot.send_message(chat_id, message)
                    sent_any = True
                except Exception as exc:
                    logger.warning("market monitor push failed city={} chat_id={}: {}", futures[future], chat_id, exc)
    return sent_any


def start_market_monitor_push_loop(bot: Any) -> Optional[threading.Thread]:
    enabled = _env_bool("TELEGRAM_MARKET_MONITOR_PUSH_ENABLED", True)
    chat_ids = get_market_monitor_chat_ids_from_env()
    if not enabled:
        logger.info("market monitor push loop disabled")
        return None
    if not chat_ids:
        logger.warning("market monitor push loop skipped: TELEGRAM_MARKET_MONITOR_CHAT_IDS/TELEGRAM_CHAT_IDS is not set")
        return None

    interval_sec = MARKET_MONITOR_INTERVAL_SEC

    def _runner() -> None:
        logger.info(
            "market monitor push loop started cities={} interval={}s chat_targets={}",
            len(MARKET_MONITOR_CITIES), interval_sec, len(chat_ids),
        )
        while True:
            cycle_started = time.time()
            _run_market_monitor_cycle(bot=bot, chat_ids=chat_ids)
            elapsed = time.time() - cycle_started
            sleep_sec = max(5, interval_sec - int(elapsed))
            time.sleep(sleep_sec)

    thread = threading.Thread(
        target=_runner,
        name="market-monitor-pusher",
        daemon=True,
    )
    thread.start()
    logger.info("market monitor push loop thread started")
    return thread
