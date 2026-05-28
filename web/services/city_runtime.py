from __future__ import annotations

import os
import time
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from loguru import logger

from src.analysis.deb_algorithm import load_history
from src.database.db_manager import DBManager
from src.database.runtime_state import (
    DailyRecordRepository,
    STATE_STORAGE_SQLITE,
    TruthRecordRepository,  # noqa: F401 - compatibility export for ops/truth-history
    get_state_storage_mode,
)
from src.analysis.settlement_rounding import apply_city_settlement
from src.data_collection.country_networks import get_country_network_provider  # noqa: F401 - compatibility export for transitional routers
from src.data_collection.city_registry import ALIASES
from src.data_collection.city_time import get_city_utc_offset_seconds  # noqa: F401 - compatibility export for transitional routers
from src.utils.refresh_policy import OBSERVATION_REFRESH_SEC, SCAN_ROWS_REFRESH_SEC
from web.analysis_service import (
    _analyze,
    _analyze_summary,
    _build_city_detail_payload,  # noqa: F401 - compatibility export for tests and transitional routers
    _build_city_market_scan_payload,
    _build_city_summary_payload,
)
from web.scan_terminal_service import build_scan_terminal_payload  # noqa: F401 - compatibility export for tests and transitional routers
from web.core import (
    CITIES,
    CITY_REGISTRY,  # noqa: F401 - compatibility export for tests and transitional routers
    CITY_RISK_PROFILES,  # noqa: F401 - compatibility export for tests and transitional routers
    PAYMENT_CHECKOUT,  # noqa: F401 - compatibility export for tests and transitional routers
    PaymentCheckoutError,  # noqa: F401 - compatibility export for tests and transitional routers
    SETTLEMENT_SOURCE_LABELS,  # noqa: F401 - compatibility export for city list payloads
    SUPABASE_ENTITLEMENT,  # noqa: F401 - compatibility export for tests and transitional routers
    ConfirmPaymentTxRequest,  # noqa: F401 - compatibility export for tests and transitional routers
    CreatePaymentIntentRequest,  # noqa: F401 - compatibility export for tests and transitional routers
    GrantPointsRequest,  # noqa: F401 - compatibility export for tests and transitional routers
    SubmitPaymentTxRequest,  # noqa: F401 - compatibility export for tests and transitional routers
    WalletChallengeRequest,  # noqa: F401 - compatibility export for tests and transitional routers
    WalletUnbindRequest,  # noqa: F401 - compatibility export for tests and transitional routers
    WalletVerifyRequest,  # noqa: F401 - compatibility export for tests and transitional routers
    _ENTITLEMENT_GUARD_ENABLED,  # noqa: F401 - compatibility export for tests and transitional routers
    _SUPABASE_AUTH_REQUIRED,  # noqa: F401 - compatibility export for tests and transitional routers
    _assert_entitlement,  # noqa: F401 - compatibility export for tests and transitional routers
    _bind_optional_supabase_identity,  # noqa: F401 - compatibility export for tests and transitional routers
    _require_ops_admin,  # noqa: F401 - compatibility export for tests and transitional routers
    _require_supabase_identity,  # noqa: F401 - compatibility export for tests and transitional routers
    _resolve_auth_points,  # noqa: F401 - compatibility export for tests and transitional routers
    _resolve_weekly_profile,  # noqa: F401 - compatibility export for tests and transitional routers
    _sf,
)

router = APIRouter()
_CACHE_DB = DBManager()


_DEB_RECENT_LOOKBACK = 7
_DEB_RECENT_MIN_SAMPLES = 3
_daily_record_repo = DailyRecordRepository()

TRACKABLE_ANALYTICS_EVENTS = {
    "signup_completed",
    "dashboard_active",
    "paywall_feature_clicked",
    "paywall_viewed",
    "checkout_started",
    "checkout_succeeded",
}

DEFAULT_STATUS_CITIES = [
    "ankara",
    "istanbul",
    "shanghai",
    "beijing",
    "shenzhen",
    "guangzhou",
    "qingdao",
    "wuhan",
    "chengdu",
    "chongqing",
    "hong kong",
    "taipei",
    "singapore",
    "tokyo",
    "seoul",
    "busan",
    "london",
    "paris",
    "madrid",
]
ASIA_CORE_CITIES = [
    "hong kong",
    "taipei",
    "tokyo",
    "seoul",
    "busan",
    "shanghai",
    "beijing",
    "guangzhou",
    "qingdao",
    "shenzhen",
    "chongqing",
    "chengdu",
    "singapore",
    "kuala lumpur",
    "jakarta",
]
EUROPE_CORE_CITIES = [
    "istanbul",
    "ankara",
    "moscow",
    "tel aviv",
    "london",
    "paris",
    "madrid",
    "milan",
    "warsaw",
    "amsterdam",
    "helsinki",
]
US_CORE_CITIES = [
    "new york",
    "los angeles",
    "san francisco",
    "austin",
    "houston",
    "chicago",
    "dallas",
    "miami",
    "atlanta",
    "seattle",
]
CITY_SUMMARY_CACHE_TTL_SEC = min(SCAN_ROWS_REFRESH_SEC, max(30, int(os.getenv("POLYWEATHER_CITY_SUMMARY_CACHE_TTL_SEC", str(SCAN_ROWS_REFRESH_SEC)))))
CITY_PANEL_CACHE_TTL_SEC = min(SCAN_ROWS_REFRESH_SEC, max(30, int(os.getenv("POLYWEATHER_CITY_PANEL_CACHE_TTL_SEC", str(SCAN_ROWS_REFRESH_SEC)))))
CITY_NEARBY_CACHE_TTL_SEC = min(SCAN_ROWS_REFRESH_SEC, max(30, int(os.getenv("POLYWEATHER_CITY_NEARBY_CACHE_TTL_SEC", str(SCAN_ROWS_REFRESH_SEC)))))
CITY_MARKET_CACHE_TTL_SEC = min(SCAN_ROWS_REFRESH_SEC, max(30, int(os.getenv("POLYWEATHER_CITY_MARKET_CACHE_TTL_SEC", str(SCAN_ROWS_REFRESH_SEC)))))
CITY_FULL_CACHE_TTL_SEC = min(OBSERVATION_REFRESH_SEC, max(30, int(os.getenv("POLYWEATHER_CITY_FULL_CACHE_TTL_SEC", str(OBSERVATION_REFRESH_SEC)))))
MARKET_SCAN_PAYLOAD_TTL_SEC = max(
    5,
    int(os.getenv("POLYWEATHER_MARKET_SCAN_PAYLOAD_TTL_SEC", "30")),
)
CACHE_REFRESH_LOCK_TTL_SEC = max(30, int(os.getenv("POLYWEATHER_CACHE_REFRESH_LOCK_TTL_SEC", "120")))


def _city_cache_is_fresh(entry: Optional[dict], ttl_sec: int) -> bool:
    if not isinstance(entry, dict):
        return False
    updated_at_ts = float(entry.get("updated_at_ts") or 0.0)
    if updated_at_ts <= 0:
        return False
    return (time.time() - updated_at_ts) < float(ttl_sec)


def _market_analysis_cache_is_fresh(entry: Optional[dict]) -> bool:
    if not isinstance(entry, dict):
        return False
    payload = entry.get("payload") or {}
    if isinstance(payload, dict):
        cached_at_ts = float(payload.get("market_analysis_cached_at_ts") or 0.0)
        if cached_at_ts > 0:
            return (time.time() - cached_at_ts) < float(CITY_MARKET_CACHE_TTL_SEC)
    return _city_cache_is_fresh(entry, CITY_MARKET_CACHE_TTL_SEC)


def _market_scan_cache_key(
    data: dict,
    market_slug: Optional[str] = None,
    target_date: Optional[str] = None,
    lite: bool = False,
) -> str:
    local_date = str(data.get("local_date") or "").strip()
    requested_date = str(target_date or "").strip()
    selected_date = requested_date or local_date
    multi_model_daily = data.get("multi_model_daily") or {}
    if requested_date and isinstance(multi_model_daily, dict) and requested_date not in multi_model_daily:
        selected_date = local_date
    normalized_slug = str(market_slug or "").strip().lower()
    return f"{selected_date}|{normalized_slug}|lite={1 if lite else 0}"


def _attach_market_scan_payload(
    payload: dict,
    *,
    market_slug: Optional[str] = None,
    target_date: Optional[str] = None,
    lite: bool = False,
) -> dict:
    if not isinstance(payload, dict):
        return payload
    scan_payload = _build_city_market_scan_payload(
        payload,
        market_slug=market_slug,
        target_date=target_date,
        lite=lite,
    )
    now_ts = time.time()
    payload["market_scan_payload"] = scan_payload
    payload["market_scan_updated_at"] = datetime.now().isoformat()
    payload["market_scan_updated_at_ts"] = now_ts
    payload["market_scan_cache_key"] = _market_scan_cache_key(
        payload,
        market_slug=market_slug,
        target_date=target_date,
        lite=lite,
    )
    return payload


def _get_cached_market_scan_payload(
    payload: dict,
    *,
    market_slug: Optional[str] = None,
    target_date: Optional[str] = None,
    lite: bool = False,
) -> Optional[dict]:
    if not isinstance(payload, dict):
        return None
    scan_payload = payload.get("market_scan_payload")
    if not isinstance(scan_payload, dict):
        return None
    expected_key = _market_scan_cache_key(
        payload,
        market_slug=market_slug,
        target_date=target_date,
        lite=lite,
    )
    cached_key = str(payload.get("market_scan_cache_key") or "")
    if cached_key != expected_key:
        return None
    updated_at_ts = float(payload.get("market_scan_updated_at_ts") or 0.0)
    if updated_at_ts <= 0:
        return None
    if (time.time() - updated_at_ts) >= float(MARKET_SCAN_PAYLOAD_TTL_SEC):
        return None
    return scan_payload


def _refresh_market_scan_payload_from_cached_analysis(
    city: str,
    payload: dict,
    *,
    market_slug: Optional[str] = None,
    target_date: Optional[str] = None,
    lite: bool = False,
) -> dict:
    _attach_market_scan_payload(
        payload,
        market_slug=market_slug,
        target_date=target_date,
        lite=lite,
    )
    _CACHE_DB.set_city_cache(
        "market",
        city,
        payload,
        version="v1",
        source_fingerprint=f"{city}:market",
    )
    return payload.get("market_scan_payload") or {}


def _refresh_city_summary_cache(city: str, force_refresh: bool = False) -> dict:
    data = _analyze_summary(city, force_refresh=force_refresh)
    payload = _build_city_summary_payload(data)
    _CACHE_DB.set_city_cache(
        "summary",
        city,
        payload,
        version="v1",
        source_fingerprint=f"{city}:summary",
    )
    return payload


def _refresh_city_panel_cache(city: str, force_refresh: bool = False) -> dict:
    payload = _analyze(city, force_refresh=force_refresh, detail_mode="panel")
    _CACHE_DB.set_city_cache(
        "panel",
        city,
        payload,
        version="v1",
        source_fingerprint=f"{city}:panel",
    )
    return payload


def _refresh_city_nearby_cache(city: str, force_refresh: bool = False) -> dict:
    payload = _analyze(city, force_refresh=force_refresh, detail_mode="nearby")
    _CACHE_DB.set_city_cache(
        "nearby",
        city,
        payload,
        version="v1",
        source_fingerprint=f"{city}:nearby",
    )
    return payload


def _refresh_city_market_cache(city: str, force_refresh: bool = False) -> dict:
    payload = _analyze(city, force_refresh=force_refresh, detail_mode="market")
    now_ts = time.time()
    payload["market_analysis_cached_at"] = datetime.now().isoformat()
    payload["market_analysis_cached_at_ts"] = now_ts
    _attach_market_scan_payload(payload)
    _CACHE_DB.set_city_cache(
        "market",
        city,
        payload,
        version="v1",
        source_fingerprint=f"{city}:market",
    )
    return payload


def _refresh_city_full_cache(city: str, force_refresh: bool = False) -> dict:
    payload = _analyze(city, force_refresh=force_refresh, detail_mode="full")
    _CACHE_DB.set_city_cache(
        "full",
        city,
        payload,
        version="v1",
        source_fingerprint=f"{city}:full",
    )
    return payload



def _schedule_cache_refresh(
    background_tasks: BackgroundTasks,
    *,
    kind: str,
    city: str,
    force_refresh: bool = False,
) -> bool:
    normalized_kind = str(kind or "").strip().lower()
    normalized_city = str(city or "").strip().lower()
    if normalized_kind not in {"summary", "panel", "nearby", "market", "full"} or not normalized_city:
        return False
    cache_key = f"city:{normalized_kind}:{normalized_city}"
    owner = _CACHE_DB.acquire_cache_refresh_lock(
        cache_key,
        ttl_sec=CACHE_REFRESH_LOCK_TTL_SEC,
    )
    if not owner:
        return False

    def _runner() -> None:
        try:
            if normalized_kind == "summary":
                _refresh_city_summary_cache(normalized_city, force_refresh=force_refresh)
            elif normalized_kind == "panel":
                _refresh_city_panel_cache(normalized_city, force_refresh=force_refresh)
            elif normalized_kind == "nearby":
                _refresh_city_nearby_cache(normalized_city, force_refresh=force_refresh)
            elif normalized_kind == "market":
                _refresh_city_market_cache(normalized_city, force_refresh=force_refresh)
            else:
                _refresh_city_full_cache(normalized_city, force_refresh=force_refresh)
        except Exception as exc:
            logger.warning(
                "cache refresh failed kind={} city={} force_refresh={}: {}",
                normalized_kind,
                normalized_city,
                force_refresh,
                exc,
            )
        finally:
            _CACHE_DB.release_cache_refresh_lock(cache_key, owner)

    background_tasks.add_task(_runner)
    return True



def _normalize_city_or_404(name: str) -> str:
    city = name.lower().strip().replace("-", " ")
    city = ALIASES.get(city, city)
    if city not in CITIES:
        raise HTTPException(404, detail=f"Unknown city: {city}")
    return city


def _normalize_city_list(raw: Optional[str]) -> list[str]:
    if not raw:
        return list(DEFAULT_STATUS_CITIES)
    out: list[str] = []
    for part in str(raw).split(","):
        city = str(part or "").strip().lower().replace("-", " ")
        if not city:
            continue
        city = ALIASES.get(city, city)
        if city in CITIES and city not in out:
            out.append(city)
    return out


def _select_priority_city_batches(client_timezone: Optional[str]) -> dict[str, object]:
    tz = str(client_timezone or "").strip()
    normalized = tz.lower()
    if normalized.startswith("america/"):
        primary = list(US_CORE_CITIES)
        secondary = []
        region = "america"
    elif normalized.startswith("europe/"):
        primary = list(EUROPE_CORE_CITIES)
        secondary = list(ASIA_CORE_CITIES)
        region = "europe"
    elif normalized.startswith("asia/") or normalized.startswith("australia/") or normalized.startswith("pacific/"):
        primary = list(ASIA_CORE_CITIES)
        secondary = list(EUROPE_CORE_CITIES)
        region = "asia"
    else:
        primary = list(ASIA_CORE_CITIES)
        secondary = list(EUROPE_CORE_CITIES)
        region = "default"
    return {
        "region": region,
        "timezone": tz or None,
        "primary": primary,
        "secondary": secondary,
    }


def _history_file_path() -> str:
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(project_root, "data", "daily_records.json")


def _build_recent_deb_performance_index(
    history_data: Optional[dict] = None,
    *,
    lookback: int = _DEB_RECENT_LOOKBACK,
    min_samples: int = _DEB_RECENT_MIN_SAMPLES,
) -> dict[str, dict[str, object]]:
    index: dict[str, dict[str, object]] = {}
    today = datetime.utcnow().strftime("%Y-%m-%d")
    settled_by_city: dict[str, list[tuple[str, float, float]]] = {}

    if isinstance(history_data, dict):
        for city_name, rows in history_data.items():
            if not isinstance(rows, dict):
                continue
            settled: list[tuple[str, float, float]] = []
            for date_key in sorted(rows.keys(), reverse=True):
                if date_key >= today:
                    continue
                record = rows.get(date_key) or {}
                if not isinstance(record, dict):
                    continue
                actual = _sf(record.get("actual_high"))
                deb_prediction = _sf(record.get("deb_prediction"))
                if actual is None or deb_prediction is None:
                    continue
                settled.append((date_key, actual, deb_prediction))
                if len(settled) >= max(lookback, 1):
                    break
            settled_by_city[str(city_name).strip().lower()] = settled
    elif get_state_storage_mode() == STATE_STORAGE_SQLITE:
        recent_rows = _daily_record_repo.load_recent_settled_rows(
            before_date=today,
            per_city_limit=max(lookback, 1),
        )
        for city_name, rows in recent_rows.items():
            settled: list[tuple[str, float, float]] = []
            for row in rows:
                actual = _sf(row.get("actual_high"))
                deb_prediction = _sf(row.get("deb_prediction"))
                date_key = str(row.get("target_date") or "").strip()
                if not date_key or actual is None or deb_prediction is None:
                    continue
                settled.append((date_key, actual, deb_prediction))
            settled_by_city[str(city_name).strip().lower()] = settled
    else:
        data = load_history(_history_file_path())
        if not isinstance(data, dict):
            return index
        for city_name, rows in data.items():
            if not isinstance(rows, dict):
                continue
            settled: list[tuple[str, float, float]] = []
            for date_key in sorted(rows.keys(), reverse=True):
                if date_key >= today:
                    continue
                record = rows.get(date_key) or {}
                if not isinstance(record, dict):
                    continue
                actual = _sf(record.get("actual_high"))
                deb_prediction = _sf(record.get("deb_prediction"))
                if actual is None or deb_prediction is None:
                    continue
                settled.append((date_key, actual, deb_prediction))
                if len(settled) >= max(lookback, 1):
                    break
            settled_by_city[str(city_name).strip().lower()] = settled

    for city_name, settled in settled_by_city.items():
        if not settled:
            continue

        hit_count = 0
        abs_errors: list[float] = []
        for _, actual, deb_prediction in settled:
            abs_errors.append(abs(deb_prediction - actual))
            if apply_city_settlement(city_name, actual) == apply_city_settlement(city_name, deb_prediction):
                hit_count += 1

        sample_count = len(settled)
        hit_rate = (hit_count / sample_count) if sample_count > 0 else None
        if sample_count < min_samples:
            tier = "other"
        elif hit_rate is not None and hit_rate >= 0.67:
            tier = "high"
        elif hit_rate is not None and hit_rate >= 0.34:
            tier = "medium"
        else:
            tier = "low"

        index[str(city_name).strip().lower()] = {
            "tier": tier,
            "sample_count": sample_count,
            "hit_rate": round(hit_rate, 4) if hit_rate is not None else None,
            "mae": round(sum(abs_errors) / sample_count, 3) if sample_count > 0 else None,
            "last_date": settled[0][0] if settled else None,
        }
    return index

__all__ = [name for name in globals() if not (name.startswith('__') and name.endswith('__'))]

