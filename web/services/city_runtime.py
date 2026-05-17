from __future__ import annotations

import os
import time
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from loguru import logger

from src.analysis.deb_algorithm import load_history
from src.analysis.probability_snapshot_archive import load_snapshot_rows_for_day
from src.database.db_manager import DBManager
from src.database.runtime_state import (
    DailyRecordRepository,
    STATE_STORAGE_SQLITE,
    TrainingFeatureRecordRepository,
    TruthRecordRepository,
    get_state_storage_mode,
)
from src.analysis.settlement_rounding import apply_city_settlement
from src.data_collection.country_networks import get_country_network_provider  # noqa: F401 - compatibility export for transitional routers
from src.data_collection.city_registry import ALIASES
from src.data_collection.city_time import get_city_utc_offset_seconds  # noqa: F401 - compatibility export for transitional routers
from web.analysis_service import (
    _analyze,
    _analyze_summary,
    _build_city_detail_payload,  # noqa: F401 - compatibility export for tests and transitional routers
    _build_city_market_scan_payload,
    _build_city_summary_payload,
)
from web.scan_terminal_service import (
    build_scan_city_ai_forecast_payload,  # noqa: F401 - compatibility export for tests and transitional routers
    build_scan_terminal_ai_payload,  # noqa: F401 - compatibility export for tests and transitional routers
    build_scan_terminal_payload,  # noqa: F401 - compatibility export for tests and transitional routers
    stream_scan_city_ai_forecast_payload,  # noqa: F401 - compatibility export for tests and transitional routers
)
from web.core import (
    CITIES,
    CITY_REGISTRY,  # noqa: F401 - compatibility export for tests and transitional routers
    CITY_RISK_PROFILES,  # noqa: F401 - compatibility export for tests and transitional routers
    PAYMENT_CHECKOUT,  # noqa: F401 - compatibility export for tests and transitional routers
    PaymentCheckoutError,  # noqa: F401 - compatibility export for tests and transitional routers
    SETTLEMENT_SOURCE_LABELS,
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
    _is_excluded_model_name,
)

router = APIRouter()
_CACHE_DB = DBManager()

_DEB_RECENT_LOOKBACK = 7
_DEB_RECENT_MIN_SAMPLES = 3
_daily_record_repo = DailyRecordRepository()
_truth_record_repo = TruthRecordRepository()
_training_feature_repo = TrainingFeatureRecordRepository()

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
HISTORY_PREVIEW_DAY_LIMIT = 21
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
CITY_SUMMARY_CACHE_TTL_SEC = max(30, int(os.getenv("POLYWEATHER_CITY_SUMMARY_CACHE_TTL_SEC", "1800")))
CITY_PANEL_CACHE_TTL_SEC = max(30, int(os.getenv("POLYWEATHER_CITY_PANEL_CACHE_TTL_SEC", "1800")))
CITY_NEARBY_CACHE_TTL_SEC = max(30, int(os.getenv("POLYWEATHER_CITY_NEARBY_CACHE_TTL_SEC", "1800")))
CITY_MARKET_CACHE_TTL_SEC = max(30, int(os.getenv("POLYWEATHER_CITY_MARKET_CACHE_TTL_SEC", "1800")))
MARKET_SCAN_PAYLOAD_TTL_SEC = max(
    5,
    int(os.getenv("POLYWEATHER_MARKET_SCAN_PAYLOAD_TTL_SEC", "30")),
)
CITY_HISTORY_PREVIEW_CACHE_TTL_SEC = max(
    60,
    int(os.getenv("POLYWEATHER_CITY_HISTORY_PREVIEW_CACHE_TTL_SEC", "1800")),
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
    payload = _analyze(city, force_refresh=force_refresh, include_llm_commentary=False, detail_mode="panel")
    _CACHE_DB.set_city_cache(
        "panel",
        city,
        payload,
        version="v1",
        source_fingerprint=f"{city}:panel",
    )
    return payload


def _refresh_city_nearby_cache(city: str, force_refresh: bool = False) -> dict:
    payload = _analyze(city, force_refresh=force_refresh, include_llm_commentary=False, detail_mode="nearby")
    _CACHE_DB.set_city_cache(
        "nearby",
        city,
        payload,
        version="v1",
        source_fingerprint=f"{city}:nearby",
    )
    return payload


def _refresh_city_market_cache(city: str, force_refresh: bool = False) -> dict:
    payload = _analyze(city, force_refresh=force_refresh, include_llm_commentary=False, detail_mode="market")
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


def _build_history_model_reference(
    *,
    forecasts: dict,
    actual: object,
    deb: object,
) -> dict:
    """Expose the archived model snapshot as reference evidence, not truth."""
    actual_value = _sf(actual)
    deb_value = _sf(deb)
    entries = []
    for model_name, model_value in (forecasts or {}).items():
        if _is_excluded_model_name(str(model_name)):
            continue
        value = _sf(model_value)
        if value is None:
            continue
        error = abs(value - actual_value) if actual_value is not None else None
        entries.append(
            {
                "model": str(model_name),
                "value": round(value, 1),
                "error": round(error, 1) if error is not None else None,
                "participates_in_deb": True,
            }
        )
    entries.sort(
        key=lambda row: (
            row["error"] is None,
            row["error"] if row["error"] is not None else 999,
            row["model"],
        )
    )
    deb_error = abs(deb_value - actual_value) if deb_value is not None and actual_value is not None else None
    return {
        "available": bool(entries),
        "truth_layer": "settlement_actual",
        "reference_layer": "archived_model_snapshot",
        "deb": {
            "value": round(deb_value, 1) if deb_value is not None else None,
            "error": round(deb_error, 1) if deb_error is not None else None,
        },
        "models": entries,
        "model_count": len(entries),
    }


def _build_city_history_payload(city: str, include_records: bool = False) -> dict:
    source = str(CITIES.get(city, {}).get("settlement_source") or "metar").strip().lower()
    truth_rows = _truth_record_repo.load_city(city)
    feature_rows = _training_feature_repo.load_city(city)

    if not truth_rows and not feature_rows:
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        history_file = os.path.join(project_root, "data", "daily_records.json")
        data = load_history(history_file)
        city_data = data.get(city, {}) if isinstance(data.get(city, {}), dict) else {}
    else:
        all_dates = sorted(set(truth_rows.keys()) | set(feature_rows.keys()))
        city_data = {}
        for day in all_dates:
            record: dict[str, object] = {}
            truth = truth_rows.get(day) or {}
            features = feature_rows.get(day) or {}
            if truth.get("actual_high") is not None:
                record["actual_high"] = truth.get("actual_high")
                record["settlement_source"] = truth.get("settlement_source")
                record["settlement_station_code"] = truth.get("settlement_station_code")
                record["settlement_station_label"] = truth.get("settlement_station_label")
                record["truth_version"] = truth.get("truth_version")
                record["updated_by"] = truth.get("updated_by")
                record["truth_updated_at"] = truth.get("truth_updated_at")
            if isinstance(features, dict):
                if features.get("deb_prediction") is not None:
                    record["deb_prediction"] = features.get("deb_prediction")
                if features.get("mu") is not None:
                    record["mu"] = features.get("mu")
                if isinstance(features.get("forecasts"), dict):
                    record["forecasts"] = features.get("forecasts")
            city_data[day] = record

    if not city_data:
        return {
            "history": [],
            "mode": "full" if include_records else "preview",
            "has_more": False,
            "full_count": 0,
            "preview_count": 0,
            "settlement_source": source,
            "settlement_source_label": SETTLEMENT_SOURCE_LABELS.get(source, source.upper()),
        }

    all_days = sorted(city_data.keys())
    selected_days = all_days if include_records else all_days[-HISTORY_PREVIEW_DAY_LIMIT:]
    out = []
    for day in selected_days:
        rec = city_data.get(day, {})
        if not isinstance(rec, dict):
            rec = {}

        act = rec.get("actual_high")
        deb = rec.get("deb_prediction")
        mu = rec.get("mu")
        snapshots = load_snapshot_rows_for_day(city, day)
        peak_ref = _build_peak_minus_12h_reference(
            actual_high=act,
            snapshots=snapshots,
        )
        forecasts_raw = rec.get("forecasts", {}) or {}
        forecasts = {}
        if isinstance(forecasts_raw, dict):
            for model_name, model_value in forecasts_raw.items():
                if _is_excluded_model_name(str(model_name)):
                    continue
                fv = _sf(model_value)
                forecasts[str(model_name)] = fv if fv is not None else None
        forecasts = _merge_missing_history_forecasts_from_snapshots(
            forecasts,
            snapshots,
        )
        model_reference = _build_history_model_reference(
            forecasts=forecasts,
            actual=act,
            deb=deb,
        )
        mgm = forecasts.get("MGM")
        out.append(
            {
                "date": day,
                "actual": float(act) if act is not None else None,
                "deb": float(deb) if deb is not None else None,
                "mu": float(mu) if mu is not None else None,
                "mgm": float(mgm) if mgm is not None else None,
                "forecasts": forecasts,
                "model_reference": model_reference,
                "settlement_source": rec.get("settlement_source"),
                "settlement_station_code": rec.get("settlement_station_code"),
                "settlement_station_label": rec.get("settlement_station_label"),
                "truth_version": rec.get("truth_version"),
                "updated_by": rec.get("updated_by"),
                "truth_updated_at": rec.get("truth_updated_at"),
                "actual_peak_time": peak_ref.get("actual_peak_time"),
                "deb_at_peak_minus_12h": peak_ref.get("deb_at_peak_minus_12h"),
                "deb_at_peak_minus_12h_time": peak_ref.get("deb_at_peak_minus_12h_time"),
                "deb_at_peak_minus_12h_error": peak_ref.get("deb_at_peak_minus_12h_error"),
            }
        )

    return {
        "history": out,
        "mode": "full" if include_records else "preview",
        "has_more": len(all_days) > len(selected_days),
        "full_count": len(all_days),
        "preview_count": len(out),
        "settlement_source": source,
        "settlement_source_label": SETTLEMENT_SOURCE_LABELS.get(source, source.upper()),
    }


def _refresh_city_history_preview_cache(city: str) -> dict:
    payload = _build_city_history_payload(city, include_records=False)
    _CACHE_DB.set_city_cache(
        "history_preview",
        city,
        payload,
        version="v1",
        source_fingerprint=f"{city}:history_preview",
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
    if normalized_kind not in {"summary", "panel", "nearby", "market", "history_preview"} or not normalized_city:
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
            elif normalized_kind == "history_preview":
                _refresh_city_history_preview_cache(normalized_city)
            else:
                _refresh_city_market_cache(normalized_city, force_refresh=force_refresh)
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


def _parse_snapshot_dt(value: object) -> Optional[datetime]:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None


def _build_peak_minus_12h_reference(
    *,
    actual_high: object,
    snapshots: list[dict],
) -> dict:
    actual = _sf(actual_high)
    if actual is None or not snapshots:
        return {}

    tolerance = 0.11
    normalized = []
    for row in snapshots:
        if not isinstance(row, dict):
            continue
        dt = _parse_snapshot_dt(row.get("timestamp"))
        if dt is None:
            continue
        normalized.append(
            {
                "dt": dt,
                "max_so_far": _sf(row.get("max_so_far")),
                "deb_prediction": _sf(row.get("deb_prediction")),
            }
        )
    if not normalized:
        return {}

    peak_row = next(
        (
            row
            for row in normalized
            if row["max_so_far"] is not None and row["max_so_far"] >= actual - tolerance
        ),
        None,
    )
    if peak_row is None:
        return {}

    peak_dt = peak_row["dt"]
    anchor_dt = peak_dt - timedelta(hours=12)
    anchor_row = None
    for row in normalized:
        if row["dt"] <= anchor_dt and row["deb_prediction"] is not None:
            anchor_row = row
        elif row["dt"] > anchor_dt:
            break

    peak_time = peak_dt.strftime("%H:%M")
    result = {
        "actual_peak_time": peak_time,
    }
    if anchor_row and anchor_row["deb_prediction"] is not None:
        deb_value = float(anchor_row["deb_prediction"])
        result.update(
            {
                "deb_at_peak_minus_12h": deb_value,
                "deb_at_peak_minus_12h_time": anchor_row["dt"].strftime("%H:%M"),
                "deb_at_peak_minus_12h_error": round(deb_value - actual, 1),
            }
        )
    return result


def _merge_missing_history_forecasts_from_snapshots(
    forecasts: dict,
    snapshots: list[dict],
) -> dict:
    merged = dict(forecasts or {})
    if not snapshots:
        return merged

    fallback_values: dict[str, Optional[float]] = {}
    for row in snapshots:
        if not isinstance(row, dict):
            continue
        multi_model = row.get("multi_model") or {}
        if not isinstance(multi_model, dict):
            continue
        for model_name, model_value in multi_model.items():
            model_key = str(model_name or "").strip()
            if not model_key or _is_excluded_model_name(model_key):
                continue
            parsed = _sf(model_value)
            if parsed is not None:
                fallback_values[model_key] = parsed

    for model_name, model_value in fallback_values.items():
        existing = _sf(merged.get(model_name))
        if existing is None:
            merged[model_name] = model_value
    return merged


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

