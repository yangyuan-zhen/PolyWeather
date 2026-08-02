"""Airport push logic for Telegram."""

import json
import os
import threading
import time
from concurrent.futures import as_completed
from typing import Any, Dict, List, Optional, Set, Tuple

from loguru import logger

from src.database import db_manager as _db_manager
from src.database.runtime_state import (
    STATE_STORAGE_SQLITE,
    TelegramAlertStateRepository,
    get_state_storage_mode,
)
from src.utils.telegram_chat_ids import get_telegram_chat_ids_from_env
from src.utils.telegram_i18n import (
    copy_text as _copy,
    is_zh as _is_zh,
    normalize_push_language as _normalize_push_language,
)
from web.services.canonical_temperature import build_city_weather_from_canonical

from ._config import (
    CHINA_HIGH_FREQ_AIRPORT_CITIES,
    HIGH_FREQ_AIRPORT_CITIES,
    HIGH_FREQ_AIRPORT_ICAO,
    _AIRPORT_PEAK_FALLBACK,
    _AIRPORT_PUSH_INTERVAL,
)
from ._helpers import (
    _build_telegram_hashtag_line,
    _env_bool,
    _env_int,
    _get_airport_executor,
    _get_http_session,
    _is_forum_chat_id,
    _load_city_thread_ids,
    _parse_observation_time_epoch,
    _rate_limited_send,
    _resolve_thread_id,
    _telegram_push_language,
)

_AIRPORT_PUSH_STATE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "data", "airport_push_state.json",
)

_AROME_CACHE: Dict[str, Any] = {}
_AROME_CACHE_TTL_SEC = 600  # AROME HD updates every 15 min; cache 10 min

_LAST_AEROWEB: Dict[str, Any] = {}  # {"temp": 31.0, "max_so_far": 31.0, "max_time": "14:00", "ts": epoch}

_telegram_state_repo = TelegramAlertStateRepository()


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
    source_label: str = "",
    arome_temp: Optional[float] = None,
    aeroweb_available: bool = False,
    language: Optional[str] = None,
) -> str:
    language = _normalize_push_language(language or _telegram_push_language())
    _AIRPORT_EN = {"seoul": "Incheon", "singapore": "Changi", "busan": "Gimhae", "tokyo": "Haneda",
                   "ankara": "Esenboğa", "helsinki": "Vantaa", "amsterdam": "Schiphol",
                   "istanbul": "Airport", "paris": "Le Bourget",
                   "hong kong": "Observatory",
                   "taipei": "Songshan", "beijing": "Capital", "shanghai": "Pudong",
                   "guangzhou": "Baiyun", "qingdao": "Jiaodong",
                   "chengdu": "Shuangliu", "chongqing": "Jiangbei", "wuhan": "Tianhe",
                   "shenzhen": "Lau Fau Shan",
                   "new york": "LaGuardia", "los angeles": "LAX", "chicago": "O'Hare",
                   "denver": "Buckley", "atlanta": "Hartsfield", "miami": "Intl",
                   "san francisco": "SFO", "houston": "Hobby", "dallas": "Love Field",
                   "austin": "Bergstrom", "seattle": "Sea-Tac",
                   "tel aviv": "Ben Gurion"}
    en_name = city.title()
    ap_name = _AIRPORT_EN.get(city, "")
    time_suffix = f" · {local_time}" if local_time else ""

    # ── Display temp: airport station observation ──
    display_temp: Optional[float] = None
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

    max_so_far, max_temp_time = _get_airport_daily_high(city_weather)
    # ── Build message ──
    lines: List[str] = []

    # Header
    hashtag_line = _build_telegram_hashtag_line(
        "airport",
        city=city,
        language=language,
    )
    icao_display = f"{airport_icao} · " if airport_icao else ""
    header = f"{icao_display}{en_name} / {ap_name}{time_suffix}" if ap_name else f"{icao_display}{en_name}{time_suffix}"
    lines.append(hashtag_line)
    lines.append("")
    lines.append(header)

    # Summary stats
    lines.append("")
    temp_symbol = str(city_weather.get("temp_symbol") or "°C").strip()
    cur_str = f"{display_temp:.1f}{temp_symbol}" if display_temp is not None else "--"

    if city == "paris":
        if aeroweb_available and display_temp is not None:
            lines.append(f"{_copy(language, 'Current observation', '当前实况')}: {cur_str}")
        else:
            lines.append(_copy(language, "Current observation: unavailable", "当前实况：暂无"))
    else:
        lines.append(f"{_copy(language, 'Current', '当前')}: {cur_str}")

    if city == "paris":
        if aeroweb_available and max_so_far is not None:
            time_str = f" ({max_temp_time})" if max_temp_time and not _is_zh(language) else (f"（{max_temp_time}）" if max_temp_time else "")
            lines.append(f"{_copy(language, 'Observed high', '日高实况')}: {max_so_far:.1f}{temp_symbol}{time_str}")
        elif not aeroweb_available:
            last_temp = _LAST_AEROWEB.get("temp")
            if last_temp is not None:
                last_time = _LAST_AEROWEB.get("max_time", "")
                time_str = f" ({last_time})" if last_time and not _is_zh(language) else (f"（{last_time}）" if last_time else "")
                lines.append(f"{_copy(language, 'Latest observation', '最近实况')}: {last_temp:.1f}{temp_symbol}{time_str}")
    elif max_so_far is not None:
        time_str = f" ({max_temp_time})" if max_temp_time and not _is_zh(language) else (f"（{max_temp_time}）" if max_temp_time else "")
        high_label = _copy(language, "Today's high", "日高")
        lines.append(f"{high_label}: {max_so_far:.1f}{temp_symbol}{time_str}")
    if deb_pred is not None:
        if city == "paris":
            if aeroweb_available and display_temp is not None:
                diff = display_temp - deb_pred
                sign = "+" if diff >= 0 else ""
                suffix = _copy(language, f" (vs obs {sign}{diff:.1f}°)", f"（距实况 {sign}{diff:.1f}°）")
                lines.append(f"DEB: {deb_pred:.1f}{temp_symbol}{suffix}" if not _is_zh(language) else f"DEB：{deb_pred:.1f}{temp_symbol}{suffix}")
            elif not aeroweb_available:
                last_temp = _LAST_AEROWEB.get("temp")
                if last_temp is not None:
                    diff = last_temp - deb_pred
                    sign = "+" if diff >= 0 else ""
                    suffix = _copy(language, f" (vs latest obs {sign}{diff:.1f}°)", f"（距最近实况 {sign}{diff:.1f}°）")
                    lines.append(f"DEB: {deb_pred:.1f}{temp_symbol}{suffix}" if not _is_zh(language) else f"DEB：{deb_pred:.1f}{temp_symbol}{suffix}")
                else:
                    lines.append(f"DEB: {deb_pred:.1f}{temp_symbol}" if not _is_zh(language) else f"DEB：{deb_pred:.1f}{temp_symbol}")
            else:
                lines.append(f"DEB: {deb_pred:.1f}{temp_symbol}" if not _is_zh(language) else f"DEB：{deb_pred:.1f}{temp_symbol}")
        elif display_temp is not None and display_temp > deb_pred:
            suffix = _copy(language, f" (already above +{display_temp - deb_pred:.1f}°)", f"（已突破 +{display_temp - deb_pred:.1f}°）")
            lines.append(f"DEB: {deb_pred:.1f}{temp_symbol}{suffix}" if not _is_zh(language) else f"DEB：{deb_pred:.1f}{temp_symbol}{suffix}")
        else:
            lines.append(f"DEB: {deb_pred:.1f}{temp_symbol}" if not _is_zh(language) else f"DEB：{deb_pred:.1f}{temp_symbol}")

    if city == "paris":
        lines.append("")
        if aeroweb_available and display_temp is not None:
            label = _copy(language, "AEROWEB airport obs", "AEROWEB 机场实况")
            lines.append(f"📡 {label}: {display_temp:.1f}{temp_symbol} · Météo-France")
        else:
            lines.append(_copy(language, "📡 AEROWEB airport obs: unavailable", "📡 AEROWEB 机场实况：暂不可用"))
        if arome_temp is not None:
            if aeroweb_available and display_temp is not None:
                d = arome_temp - display_temp
                sign = "+" if d >= 0 else ""
                label = _copy(language, "AROME HD 15m nowcast", "AROME HD 15分钟临近预报")
                suffix = _copy(language, f" (vs obs {sign}{d:.1f}°)", f"（较实况 {sign}{d:.1f}°）")
                lines.append(f"🕐 {label}: {arome_temp:.1f}{temp_symbol}{suffix}")
            else:
                label = _copy(language, "AROME HD 15m nowcast", "AROME HD 15分钟临近预报")
                lines.append(f"🕐 {label}: {arome_temp:.1f}{temp_symbol}")
        else:
            label = _copy(language, "AROME HD 15m nowcast", "AROME HD 15分钟临近预报")
            lines.append(f"🕐 {label}: --")
        if not aeroweb_available:
            lines.append("")
            lines.append(_copy(language, "Note: showing model reference only; observed high is not updating.", "提示：当前仅显示模型参考，不更新实况日高。"))
    elif source_label:
        lines.append("")
        lines.append(f"📡 {source_label}")

    # Model summary (compact)
    models = city_weather.get("multi_model") or {}
    if isinstance(models, dict) and len(models) >= 2:
        vals = sorted([(v, k) for k, v in models.items() if isinstance(v, (int, float))])
        if len(vals) >= 2:
            lo, hi = vals[0][0], vals[-1][0]
            spread = hi - lo
            if spread <= 2.0:
                spread_label = _copy(language, "low dispersion", "低分歧")
            elif spread <= 4.0:
                spread_label = _copy(language, "moderate dispersion", "中等分歧")
            else:
                spread_label = _copy(language, "high dispersion", "高分歧")
            range_label = _copy(language, "Model range", "模型区间")
            lines.append(f"{range_label}: {lo:.1f}~{hi:.1f}{temp_symbol}  {spread_label}")

    return "\n".join(lines)


def _get_airport_daily_high(city_weather: Dict[str, Any]):
    """Get today's observed high from the airport observation history."""
    airport = city_weather.get("airport_current") or {}
    max_so_far = airport.get("max_so_far")
    max_time = airport.get("max_temp_time")
    if max_so_far is not None:
        try:
            max_so_far = round(float(max_so_far), 1)
        except Exception:
            max_so_far = None
    return max_so_far, max_time


def _airport_push_cache_max_age_sec(city: str) -> int:
    interval = int(_AIRPORT_PUSH_INTERVAL.get((city or "").strip().lower(), 600) or 600)
    return max(90, interval * 2)


def _cached_payload_observation_epoch(payload: Dict[str, Any]) -> Optional[int]:
    airport_primary = payload.get("airport_primary") or {}
    airport_current = payload.get("airport_current") or {}
    current = payload.get("current") or {}
    candidates = [
        (payload.get("canonical_temperature") or {}).get("observed_at"),
        airport_primary.get("obs_time"),
        airport_current.get("obs_time"),
        current.get("observed_at"),
        current.get("obs_time"),
    ]
    parsed = [
        timestamp
        for timestamp in (_parse_observation_time_epoch(value) for value in candidates)
        if timestamp is not None
    ]
    return max(parsed) if parsed else None


def _read_cached_airport_city_weather(city: str, max_age_sec: Optional[int] = None) -> Optional[Dict[str, Any]]:
    """Read web city cache for Telegram without triggering collection."""
    normalized_city = (city or "").strip().lower()
    if not normalized_city:
        return None
    max_age = int(max_age_sec if max_age_sec is not None else _airport_push_cache_max_age_sec(normalized_city))
    now_ts = time.time()
    candidates: List[Tuple[int, int, float, str, Dict[str, Any]]] = []
    try:
        db = _db_manager.DBManager()
        for kind in ("full", "panel"):
            entry = db.get_city_cache(kind, normalized_city)
            if not isinstance(entry, dict):
                continue
            updated_at_ts = float(entry.get("updated_at_ts") or 0.0)
            payload = entry.get("payload")
            if updated_at_ts <= 0 or not isinstance(payload, dict):
                continue
            age_sec = now_ts - updated_at_ts
            is_fresh = age_sec <= max_age
            if age_sec > max_age:
                logger.debug(
                    "airport push cache stale city={} kind={} age_sec={} max_age_sec={}",
                    normalized_city,
                    kind,
                    round(age_sec, 1),
                    max_age,
                )
            observation_ts = _cached_payload_observation_epoch(payload)
            candidates.append(
                (
                    int(observation_ts or 0),
                    1 if is_fresh else 0,
                    updated_at_ts,
                    kind,
                    dict(payload),
                )
            )
    except Exception as exc:
        logger.debug("airport push city cache read failed city={}: {}", normalized_city, exc)
    if candidates:
        observation_ts, is_fresh, updated_at_ts, kind, payload = max(
            candidates,
            key=lambda item: (item[0], item[1], item[2]),
        )
        logger.debug(
            "airport push cache selected city={} kind={} age_sec={} observation_ts={} fresh={}",
            normalized_city,
            kind,
            round(max(0.0, now_ts - updated_at_ts), 1),
            observation_ts or None,
            bool(is_fresh),
        )
        return payload
    return None


def _attach_latest_raw_observation_payload(
    db: Any,
    city: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    return payload


def _read_canonical_airport_city_weather(city: str, db: Optional[Any] = None) -> Optional[Dict[str, Any]]:
    normalized_city = (city or "").strip().lower()
    if not normalized_city:
        return None
    try:
        db = db or _db_manager.DBManager()
        getter = getattr(db, "get_canonical_temperature", None)
        if not callable(getter):
            return None
        row = getter(normalized_city)
    except Exception as exc:
        logger.debug("airport push canonical latest read failed city={}: {}", normalized_city, exc)
        return None
    if not isinstance(row, dict):
        return None
    canonical = row.get("payload") or row
    if not isinstance(canonical, dict):
        return None
    payload = build_city_weather_from_canonical(normalized_city, canonical)
    if not isinstance(payload, dict):
        return None
    return _attach_latest_raw_observation_payload(db, normalized_city, payload)


def _merge_airport_push_context(
    latest_payload: Dict[str, Any],
    cached_payload: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    if not isinstance(cached_payload, dict) or not cached_payload:
        return latest_payload
    merged = dict(latest_payload)

    def has_useful_context(value: Any) -> bool:
        if isinstance(value, dict):
            return any(item not in (None, "", [], {}) for item in value.values())
        if isinstance(value, list):
            return bool(value)
        return value is not None

    for key in (
        "deb",
        "multi_model",
        "multi_model_daily",
        "forecast",
        "probabilities",
        "peak",
        "local_time",
        "local_date",
        "temp_symbol",
        "risk",
    ):
        value = cached_payload.get(key)
        if not has_useful_context(value):
            continue
        if key not in merged or not has_useful_context(merged.get(key)):
            merged[key] = value
    return merged


def _load_airport_city_weather_for_push(city: str) -> Dict[str, Any]:
    normalized_city = (city or "").strip().lower()
    cached = _read_cached_airport_city_weather(normalized_city)
    if cached is not None:
        cached = _attach_latest_raw_observation_payload(_db_manager.DBManager(), normalized_city, cached)
    canonical = _read_canonical_airport_city_weather(normalized_city)
    if canonical is not None:
        cached_ts = _cached_payload_observation_epoch(cached or {})
        canonical_ts = _cached_payload_observation_epoch(canonical)
        if cached is None or (canonical_ts or 0) > (cached_ts or 0):
            return _merge_airport_push_context(canonical, cached)

    if cached is not None:
        return cached

    raise RuntimeError(f"no cached city weather for airport push city={city}")


def _in_peak_time_window(city: str, city_weather: Dict[str, Any]) -> bool:
    """Check if current local time is within the expected peak temperature window."""
    peak = city_weather.get("peak") or {}
    first_h = peak.get("first_h")
    last_h = peak.get("last_h")
    fallback = _AIRPORT_PEAK_FALLBACK.get(city)
    if fallback and ((first_h is None) or (last_h is not None and last_h - first_h < 3)):
        first_h, last_h = fallback
    local_time = city_weather.get("local_time") or ""
    if first_h is None or last_h is None or not local_time:
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
        db = _db_manager.DBManager()
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
    last_obs_ts = (
        _parse_observation_time_epoch(last_city.get("obs_ts"))
        or _parse_observation_time_epoch(last_obs_time)
    )
    city_interval = _AIRPORT_PUSH_INTERVAL.get(city, 600)
    if now_ts - last_city_ts < city_interval:
        return None

    city_weather: Dict[str, Any] = {}
    deb_pred: Optional[float] = None
    try:
        city_weather = _load_airport_city_weather_for_push(city)
        deb_raw = (city_weather.get("deb") or {}).get("prediction")
        if deb_raw is not None:
            deb_pred = float(deb_raw)
    except Exception:
        logger.exception("airport analyze failed for city={}", city)
        return None

    # Extract airport-level temperature
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

    current_temp = station_temp
    if current_temp is None:
        airport_primary = city_weather.get("airport_primary") or {}
        current_temp = airport_primary.get("temp") or (city_weather.get("current") or {}).get("temp")
        if not current_obs_time:
            current_obs_time = str(airport_primary.get("obs_time") or "")
    current_obs_ts = _parse_observation_time_epoch(current_obs_time)
    source_label = ""  # human-readable data source for Paris messages
    arome_temp_val = None  # AROME HD temperature for display (always fetched for comparison)
    aeroweb_available = False
    if city == "paris":
        arome_temp_val = _fetch_arome_temp()
        airport_primary = city_weather.get("airport_primary") or {}
        # Detect AEROWEB availability
        if airport_primary.get("source_code") == "aeroweb" and airport_primary.get("temp") is not None:
            aeroweb_available = True
            source_label = "AEROWEB 机场实况 · Météo-France"
            # Update last known AEROWEB cache
            _LAST_AEROWEB["temp"] = float(airport_primary["temp"])
            _LAST_AEROWEB["ts"] = time.time()
            # Get daily high from airport data
            aero_max = (city_weather.get("airport_current") or {}).get("max_so_far")
            aero_max_time = (city_weather.get("airport_current") or {}).get("max_temp_time")
            if aero_max is not None:
                _LAST_AEROWEB["max_so_far"] = float(aero_max)
                _LAST_AEROWEB["max_time"] = str(aero_max_time or "")[11:16] if aero_max_time else ""
    # Allow Paris pushes even when AEROWEB is down (show cached/last-known data)
    if city == "paris" and not aeroweb_available and deb_pred is not None:
        pass
    elif current_temp is None or deb_pred is None:
        return None

    # Dedup: same observation → skip (with delayed retry for HKO)
    _CITIES_WITH_DELAYED_API = {"hong kong"}
    if (current_obs_time and last_obs_time and current_obs_time == last_obs_time
            and city in _CITIES_WITH_DELAYED_API
            and now_ts - last_city_ts > 540):
        time.sleep(4)
        try:
            city_weather = _load_airport_city_weather_for_push(city)
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
    current_obs_ts = _parse_observation_time_epoch(current_obs_time)
    if (
        current_obs_ts is not None
        and last_obs_ts is not None
        and current_obs_ts <= last_obs_ts
    ):
        logger.debug(
            "airport push skipped stale observation city={} current_obs_time={} last_obs_time={}",
            city,
            current_obs_time,
            last_obs_time,
        )
        return None
    if current_obs_time and last_obs_time and current_obs_time == last_obs_time:
        return None

    obs_local = (
        (city_weather.get("airport_current") or {}).get("obs_time")
        or city_weather.get("local_time")
        or ""
    )
    message = _build_airport_status_message(city, city_weather, deb_pred, obs_local, state="", source_label=source_label, arome_temp=arome_temp_val, aeroweb_available=aeroweb_available)

    # Send to all target chats
    sent = False
    for chat_id in chat_ids:
        thread_id = 0
        try:
            kwargs = {}
            thread_id = _resolve_thread_id(chat_id, city)
            if thread_id:
                kwargs["message_thread_id"] = thread_id
            elif _is_forum_chat_id(chat_id):
                logger.warning(
                    "airport push skipped missing forum thread mapping city={} chat_id={} mapping_cities={}",
                    city,
                    chat_id,
                    len(_load_city_thread_ids()),
                )
                continue
            _rate_limited_send(bot, chat_id, message, **kwargs)
            sent = True
        except Exception as exc:
            if thread_id and "message thread not found" in str(exc).lower():
                logger.warning(
                    "airport push skipped missing forum thread city={} chat_id={} thread_id={}",
                    city,
                    chat_id,
                    thread_id,
                )
                continue
            logger.warning("airport push failed city={} chat_id={}: {}", city, chat_id, exc)

    if sent:
        logger.info("airport status pushed city={} temp={} deb={} obs_time={}",
                     city, current_temp, deb_pred, current_obs_time)
        return (
            city,
            {
                "ts": now_ts,
                "active": True,
                "obs_time": current_obs_time,
                "obs_ts": current_obs_ts,
            },
        )

    return None


def _due_airport_cities(
    cities: Set[str],
    now_ts: int,
    last_by_city: Dict[str, Any],
) -> List[str]:
    due: List[str] = []
    for city in sorted(
        cities,
        key=lambda item: (0 if item in CHINA_HIGH_FREQ_AIRPORT_CITIES else 1, item),
    ):
        last_city = last_by_city.get(city) or {}
        last_city_ts = int(last_city.get("ts") or 0)
        city_interval = _AIRPORT_PUSH_INTERVAL.get(city, 600)
        if now_ts - last_city_ts >= city_interval:
            due.append(city)
    return due


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
    cities = _due_airport_cities(HIGH_FREQ_AIRPORT_CITIES, now_ts, last_by_city)
    logger.info(
        "airport cycle tick cities={} due={} max_workers={}",
        len(HIGH_FREQ_AIRPORT_CITIES),
        len(cities),
        max_workers,
    )
    if not cities:
        return False

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
