from __future__ import annotations

import os
import time
from datetime import datetime, timedelta
from typing import Optional

from fastapi.concurrency import run_in_threadpool
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse
from loguru import logger

from src.analysis.deb_algorithm import load_history
from src.analysis.probability_snapshot_archive import load_snapshot_rows_for_day
from src.database.runtime_state import TrainingFeatureRecordRepository, TruthRecordRepository
from src.analysis.settlement_rounding import apply_city_settlement
from src.data_collection.country_networks import get_country_network_provider
from src.data_collection.city_registry import ALIASES
from src.utils.metrics import export_prometheus_metrics
from web.analysis_service import (
    _analyze,
    _analyze_summary,
    _build_city_detail_payload,
    _build_city_summary_payload,
)
from web.core import (
    AnalyticsEventRequest,
    CITIES,
    CITY_REGISTRY,
    CITY_RISK_PROFILES,
    PAYMENT_CHECKOUT,
    PaymentCheckoutError,
    SETTLEMENT_SOURCE_LABELS,
    SUPABASE_ENTITLEMENT,
    ConfirmPaymentTxRequest,
    CreatePaymentIntentRequest,
    GrantPointsRequest,
    SubmitPaymentTxRequest,
    WalletChallengeRequest,
    WalletUnbindRequest,
    WalletVerifyRequest,
    _ENTITLEMENT_GUARD_ENABLED,
    _SUPABASE_AUTH_REQUIRED,
    _assert_entitlement,
    _bind_optional_supabase_identity,
    _require_ops_admin,
    build_health_payload,
    build_system_status_payload,
    _require_supabase_identity,
    _resolve_auth_points,
    _resolve_weekly_profile,
    _sf,
    _is_excluded_model_name,
)

router = APIRouter()

_DEB_RECENT_LOOKBACK = 7
_DEB_RECENT_MIN_SAMPLES = 3
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

DEFAULT_PREWARM_CITIES = [
    "ankara",
    "istanbul",
    "shanghai",
    "beijing",
    "shenzhen",
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
        return list(DEFAULT_PREWARM_CITIES)
    out: list[str] = []
    for part in str(raw).split(","):
        city = str(part or "").strip().lower().replace("-", " ")
        if not city:
            continue
        city = ALIASES.get(city, city)
        if city in CITIES and city not in out:
            out.append(city)
    return out


def _history_file_path() -> str:
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(project_root, "data", "daily_records.json")


def _build_recent_deb_performance_index(
    history_data: Optional[dict] = None,
    *,
    lookback: int = _DEB_RECENT_LOOKBACK,
    min_samples: int = _DEB_RECENT_MIN_SAMPLES,
) -> dict[str, dict[str, object]]:
    data = history_data if isinstance(history_data, dict) else load_history(_history_file_path())
    index: dict[str, dict[str, object]] = {}
    if not isinstance(data, dict):
        return index

    today = datetime.utcnow().strftime("%Y-%m-%d")
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


@router.get("/healthz")
async def healthz():
    payload = build_health_payload()
    if payload.get("status") != "ok":
        raise HTTPException(status_code=503, detail=payload)
    return payload


@router.get("/api/system/status")
async def system_status():
    return await run_in_threadpool(build_system_status_payload)


@router.post("/api/system/prewarm")
async def system_prewarm(
    request: Request,
    cities: Optional[str] = None,
    force_refresh: bool = False,
    include_detail: bool = False,
    include_market: bool = False,
):
    _assert_entitlement(request)
    selected = _normalize_city_list(cities)
    if not selected:
        raise HTTPException(status_code=400, detail="No valid cities to prewarm")

    started = time.perf_counter()
    warmed: list[dict[str, object]] = []
    failed: list[dict[str, object]] = []
    summary_ok = 0
    detail_ok = 0
    market_ok = 0

    for city in selected:
        city_started = time.perf_counter()
        try:
            data = _analyze(city, force_refresh=force_refresh)
            entry: dict[str, object] = {
                "city": city,
                "summary": True,
                "duration_ms": round((time.perf_counter() - city_started) * 1000.0, 1),
            }
            summary_ok += 1
            if include_detail:
                _build_city_summary_payload(data)
                _build_city_detail_payload(
                    data,
                    target_date=str(data.get("local_date") or "").strip() or None,
                )
                entry["detail"] = True
                detail_ok += 1
            if include_market:
                _build_city_detail_payload(
                    data,
                    target_date=str(data.get("local_date") or "").strip() or None,
                )
                entry["market"] = True
                market_ok += 1
            warmed.append(entry)
        except Exception as exc:
            failed.append(
                {
                    "city": city,
                    "error": str(exc),
                    "duration_ms": round((time.perf_counter() - city_started) * 1000.0, 1),
                }
            )

    total_ms = round((time.perf_counter() - started) * 1000.0, 1)
    logger.info(
        "system prewarm finished count={} failed={} force_refresh={} include_detail={} include_market={} duration_ms={}",
        len(warmed),
        len(failed),
        force_refresh,
        include_detail,
        include_market,
        total_ms,
    )
    return {
        "ok": len(failed) == 0,
        "cities": selected,
        "warmed": warmed,
        "failed": failed,
        "summary_ok": summary_ok,
        "detail_ok": detail_ok,
        "market_ok": market_ok,
        "failed_count": len(failed),
        "duration_ms": total_ms,
    }


@router.get("/metrics", response_class=PlainTextResponse)
async def metrics():
    return PlainTextResponse(
        export_prometheus_metrics(),
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )


@router.get("/api/cities")
async def list_cities(request: Request):
    def _build_payload():
        out = []
        deb_recent_index = _build_recent_deb_performance_index()
        for name, info in CITIES.items():
            risk = CITY_RISK_PROFILES.get(name, {})
            city_meta = CITY_REGISTRY.get(name, {}) or {}
            deb_recent = deb_recent_index.get(name, {})
            settlement_source = str(info.get("settlement_source") or "metar").strip().lower() or "metar"
            provider = get_country_network_provider(name)
            out.append(
                {
                    "name": name,
                    "display_name": str(city_meta.get("display_name") or city_meta.get("name") or name.title()),
                    "lat": info["lat"],
                    "lon": info["lon"],
                    "risk_level": risk.get("risk_level", "low"),
                    "risk_emoji": risk.get("risk_emoji", "🟢"),
                    "airport": risk.get("airport_name", ""),
                    "icao": risk.get("icao", ""),
                    "temp_unit": "fahrenheit" if info["f"] else "celsius",
                    "is_major": city_meta.get("is_major", True),
                    "settlement_source": settlement_source,
                    "settlement_source_label": SETTLEMENT_SOURCE_LABELS.get(
                        settlement_source,
                        settlement_source.upper(),
                    ),
                    "settlement_station_code": city_meta.get("settlement_station_code") or city_meta.get("icao"),
                    "settlement_station_label": city_meta.get("settlement_station_label") or city_meta.get("airport_name"),
                    "network_provider": provider.provider_code,
                    "network_provider_label": provider.provider_label,
                    "deb_recent_tier": deb_recent.get("tier", "other"),
                    "deb_recent_hit_rate": deb_recent.get("hit_rate"),
                    "deb_recent_sample_count": deb_recent.get("sample_count", 0),
                    "deb_recent_mae": deb_recent.get("mae"),
                    "deb_recent_last_date": deb_recent.get("last_date"),
                }
            )
        return {"cities": out}

    try:
        return await run_in_threadpool(_build_payload)
    except Exception as exc:
        logger.error(f"Error in list_cities: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/api/city/{name}")
async def city_detail(
    request: Request,
    name: str,
    force_refresh: bool = False,
    depth: str = "panel",
):
    _assert_entitlement(request)
    city = _normalize_city_or_404(name)
    normalized_depth = str(depth or "panel").strip().lower()
    if normalized_depth == "full":
        detail_mode = "full"
    elif normalized_depth == "nearby":
        detail_mode = "nearby"
    else:
        detail_mode = "panel"
    return await run_in_threadpool(_analyze, city, force_refresh, False, detail_mode)


@router.get("/api/history/{name}")
async def city_history(request: Request, name: str):
    _assert_entitlement(request)
    city = _normalize_city_or_404(name)

    def _build_history_payload():
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
                "settlement_source": source,
                "settlement_source_label": SETTLEMENT_SOURCE_LABELS.get(source, source.upper()),
            }

        out = []
        for day, rec in sorted(city_data.items()):
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
            mgm = forecasts.get("MGM")
            out.append(
                {
                    "date": day,
                    "actual": float(act) if act is not None else None,
                    "deb": float(deb) if deb is not None else None,
                    "mu": float(mu) if mu is not None else None,
                    "mgm": float(mgm) if mgm is not None else None,
                    "forecasts": forecasts,
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
            "settlement_source": source,
            "settlement_source_label": SETTLEMENT_SOURCE_LABELS.get(source, source.upper()),
        }

    return await run_in_threadpool(_build_history_payload)


@router.get("/api/auth/me")
async def auth_me(request: Request):
    _assert_entitlement(request)
    _bind_optional_supabase_identity(request)

    user_id = getattr(request.state, "auth_user_id", None)
    subscription_required = bool(
        SUPABASE_ENTITLEMENT.enabled
        and _SUPABASE_AUTH_REQUIRED
        and SUPABASE_ENTITLEMENT.require_subscription
    )
    subscription_active = None
    subscription_plan_code = None
    subscription_starts_at = None
    subscription_expires_at = None
    subscription_total_expires_at = None
    subscription_queued_days = 0
    subscription_queued_count = 0

    if SUPABASE_ENTITLEMENT.enabled and user_id:
        try:
            latest_subscription = SUPABASE_ENTITLEMENT.ensure_signup_trial(
                user_id,
                created_at=getattr(request.state, "auth_created_at", None),
            )
            if not latest_subscription:
                latest_subscription = SUPABASE_ENTITLEMENT.get_latest_active_subscription(
                    user_id,
                    respect_requirement=False,
                )
            if (
                not latest_subscription
                and getattr(PAYMENT_CHECKOUT, "enabled", False)
            ):
                try:
                    PAYMENT_CHECKOUT.reconcile_latest_intent(user_id)
                    latest_subscription = SUPABASE_ENTITLEMENT.get_latest_active_subscription(
                        user_id,
                        respect_requirement=False,
                    )
                except Exception:
                    latest_subscription = SUPABASE_ENTITLEMENT.get_latest_active_subscription(
                        user_id,
                        respect_requirement=False,
                    )
            latest_known_subscription = latest_subscription
            if not latest_known_subscription:
                latest_known_subscription = (
                    SUPABASE_ENTITLEMENT.get_latest_subscription_any_status(user_id)
                )
            subscription_window = SUPABASE_ENTITLEMENT.get_subscription_window(
                user_id,
                respect_requirement=False,
            )
            subscription_active = bool(latest_subscription)
            if isinstance(latest_subscription, dict):
                subscription_plan_code = latest_subscription.get("plan_code")
                subscription_starts_at = latest_subscription.get("starts_at")
                subscription_expires_at = latest_subscription.get("expires_at")
            elif isinstance(latest_known_subscription, dict):
                subscription_plan_code = latest_known_subscription.get("plan_code")
                subscription_starts_at = latest_known_subscription.get("starts_at")
                subscription_expires_at = latest_known_subscription.get("expires_at")
            if isinstance(subscription_window, dict):
                subscription_total_expires_at = subscription_window.get("total_expires_at")
                subscription_queued_days = int(subscription_window.get("queued_days") or 0)
                subscription_queued_count = int(subscription_window.get("queued_count") or 0)
        except Exception:
            subscription_active = None
            subscription_plan_code = None
            subscription_starts_at = None
            subscription_expires_at = None
            subscription_total_expires_at = None
            subscription_queued_days = 0
            subscription_queued_count = 0

    points = _resolve_auth_points(request)
    weekly_profile = _resolve_weekly_profile(request)

    return {
        "authenticated": bool(user_id),
        "user_id": user_id,
        "email": getattr(request.state, "auth_email", None),
        "points": points,
        "weekly_points": weekly_profile["weekly_points"],
        "weekly_rank": weekly_profile["weekly_rank"],
        "entitlement_mode": (
            "supabase_required"
            if SUPABASE_ENTITLEMENT.enabled and _SUPABASE_AUTH_REQUIRED
            else "supabase_optional"
            if SUPABASE_ENTITLEMENT.enabled
            else "legacy_token"
            if _ENTITLEMENT_GUARD_ENABLED
            else "disabled"
        ),
        "auth_required": bool(SUPABASE_ENTITLEMENT.enabled and _SUPABASE_AUTH_REQUIRED),
        "subscription_required": subscription_required,
        "subscription_active": subscription_active,
        "subscription_plan_code": subscription_plan_code,
        "subscription_starts_at": subscription_starts_at,
        "subscription_expires_at": subscription_expires_at,
        "subscription_total_expires_at": subscription_total_expires_at,
        "subscription_queued_days": subscription_queued_days,
        "subscription_queued_count": subscription_queued_count,
    }


@router.post("/api/analytics/events")
async def analytics_track(request: Request, body: AnalyticsEventRequest):
    _bind_optional_supabase_identity(request)
    event_type = str(body.event_type or "").strip().lower()
    if event_type not in TRACKABLE_ANALYTICS_EVENTS:
        raise HTTPException(status_code=400, detail="unsupported_event_type")

    payload = body.payload if isinstance(body.payload, dict) else {}
    normalized_payload = {
        key: value
        for key, value in payload.items()
        if isinstance(key, str) and len(key) <= 64
    }
    from src.database.db_manager import DBManager

    db = DBManager()
    db.append_app_analytics_event(
        event_type,
        normalized_payload,
        user_id=getattr(request.state, "auth_user_id", None),
        client_id=body.client_id,
        session_id=body.session_id,
    )
    return {"ok": True}


@router.get("/api/ops/users")
async def ops_search_users(request: Request, q: str = "", limit: int = 20):
    _assert_entitlement(request)
    _require_ops_admin(request)
    from src.database.db_manager import DBManager

    db = DBManager()
    users = db.search_users(q, limit=limit)
    return {"users": users}


@router.get("/api/ops/leaderboard/weekly")
async def ops_weekly_leaderboard(request: Request, limit: int = 20):
    _assert_entitlement(request)
    _require_ops_admin(request)
    from src.database.db_manager import DBManager

    db = DBManager()
    return {"leaderboard": db.get_weekly_leaderboard(limit=limit)}


@router.get("/api/ops/memberships")
async def ops_memberships(request: Request, limit: int = 200):
    _assert_entitlement(request)
    _require_ops_admin(request)
    from src.database.db_manager import DBManager

    db = DBManager()
    if getattr(PAYMENT_CHECKOUT, "enabled", False):
        try:
            PAYMENT_CHECKOUT.reconcile_recent_intents(limit=min(max(int(limit or 200), 20), 200))
        except Exception:
            pass
    subscriptions = SUPABASE_ENTITLEMENT.list_active_subscriptions(limit=limit)
    subscription_user_ids = [str(item.get("user_id") or "") for item in subscriptions]
    user_map = db.get_users_by_supabase_user_ids(subscription_user_ids)
    unresolved_user_ids = [
        user_id
        for user_id in subscription_user_ids
        if str(user_id or "").strip().lower()
        and not str(
            (user_map.get(str(user_id).strip().lower(), {}) or {}).get("supabase_email") or ""
        ).strip()
    ]
    auth_user_map = SUPABASE_ENTITLEMENT.get_auth_users(unresolved_user_ids)
    deduped: dict[str, dict] = {}
    for item in subscriptions:
        user_id = str(item.get("user_id") or "").strip().lower()
        local_user = user_map.get(user_id, {})
        auth_user = auth_user_map.get(user_id, {})
        row = {
            "user_id": user_id,
            "email": str(auth_user.get("email") or local_user.get("supabase_email") or ""),
            "telegram_id": local_user.get("telegram_id"),
            "username": local_user.get("username"),
            "registered_at": local_user.get("created_at") or auth_user.get("created_at"),
            "plan_code": item.get("plan_code"),
            "starts_at": item.get("starts_at"),
            "expires_at": item.get("expires_at"),
        }
        existing = deduped.get(user_id)
        existing_expires = str(existing.get("expires_at") or "") if existing else ""
        current_expires = str(row.get("expires_at") or "")
        if existing is None or current_expires > existing_expires:
            deduped[user_id] = row
    rows = sorted(
        deduped.values(),
        key=lambda item: str(item.get("expires_at") or ""),
    )
    return {"memberships": rows}


@router.get("/api/ops/payments/incidents")
async def ops_payment_incidents(
    request: Request,
    limit: int = 50,
    reason: str = "",
    include_resolved: bool = False,
):
    _assert_entitlement(request)
    _require_ops_admin(request)
    from src.database.db_manager import DBManager

    db = DBManager()
    incidents = db.list_payment_audit_events(
        limit=max(1, min(int(limit or 50), 200)),
        event_type="payment_intent_failed",
    )
    normalized_reason = str(reason or "").strip().lower()
    filtered = []
    for item in incidents:
        payload = item.get("payload") if isinstance(item, dict) else {}
        payload = payload if isinstance(payload, dict) else {}
        item_reason = str(payload.get("reason") or "").strip().lower()
        resolved_at = str(payload.get("resolved_at") or "").strip()
        if normalized_reason and item_reason != normalized_reason:
            continue
        if not include_resolved and resolved_at:
            continue
        filtered.append(item)
    return {"incidents": filtered}


@router.post("/api/ops/payments/incidents/{event_id}/resolve")
async def ops_resolve_payment_incident(request: Request, event_id: int):
    _assert_entitlement(request)
    admin = _require_ops_admin(request)
    from src.database.db_manager import DBManager

    db = DBManager()
    resolved = db.mark_payment_audit_event_resolved(event_id, str(admin.get("email") or ""))
    if not resolved:
        raise HTTPException(status_code=404, detail="payment_incident_not_found")
    return {"ok": True, "incident": resolved}


@router.post("/api/ops/users/grant-points")
async def ops_grant_points(request: Request, body: GrantPointsRequest):
    _assert_entitlement(request)
    admin = _require_ops_admin(request)
    from src.database.db_manager import DBManager

    db = DBManager()
    result = db.grant_points_by_supabase_email(body.email, body.points)
    result["operator_email"] = admin.get("email")
    if not result.get("ok"):
        reason = str(result.get("reason") or "grant_points_failed")
        status_code = 404 if reason == "user_not_found" else 400
        raise HTTPException(status_code=status_code, detail=result)
    return result


@router.get("/api/ops/analytics/funnel")
async def ops_analytics_funnel(request: Request, days: int = 30):
    _assert_entitlement(request)
    _require_ops_admin(request)
    from src.database.db_manager import DBManager

    db = DBManager()
    return db.get_app_analytics_funnel_summary(days=days)


@router.get("/api/ops/truth-history")
async def ops_truth_history(
    request: Request,
    city: str = "",
    date_from: str = "",
    date_to: str = "",
    limit: int = 200,
):
    _assert_entitlement(request)
    _require_ops_admin(request)

    truth_history = TruthRecordRepository().load_all()
    normalized_city = str(city or "").strip().lower()
    normalized_from = str(date_from or "").strip()
    normalized_to = str(date_to or "").strip()
    max_limit = max(1, min(int(limit or 200), 1000))

    rows = []
    for row_city, by_date in truth_history.items():
        if normalized_city and row_city != normalized_city:
            continue
        if not isinstance(by_date, dict):
            continue
        for target_date, payload in by_date.items():
            if normalized_from and str(target_date) < normalized_from:
                continue
            if normalized_to and str(target_date) > normalized_to:
                continue
            if not isinstance(payload, dict):
                continue
            rows.append(
                {
                    "city": row_city,
                    "display_name": str((CITY_REGISTRY.get(row_city) or {}).get("name") or row_city),
                    "target_date": str(target_date),
                    "actual_high": payload.get("actual_high"),
                    "settlement_source": payload.get("settlement_source"),
                    "settlement_station_code": payload.get("settlement_station_code"),
                    "settlement_station_label": payload.get("settlement_station_label"),
                    "truth_version": payload.get("truth_version"),
                    "updated_by": payload.get("updated_by"),
                    "truth_updated_at": payload.get("truth_updated_at"),
                    "is_final": payload.get("is_final"),
                }
            )

    rows.sort(key=lambda item: (str(item["target_date"]), str(item["city"])), reverse=True)
    filtered_count = len(rows)
    rows = rows[:max_limit]
    available_cities = [
        {
            "city": city_id,
            "name": str(info.get("name") or city_id),
        }
        for city_id, info in sorted(CITY_REGISTRY.items(), key=lambda item: str(item[1].get("name") or item[0]))
    ]
    return {
        "items": rows,
        "available_cities": available_cities,
        "filters": {
            "city": normalized_city or None,
            "date_from": normalized_from or None,
            "date_to": normalized_to or None,
            "limit": max_limit,
        },
        "filtered_count": filtered_count,
    }


@router.get("/api/payments/config")
async def payment_config(request: Request):
    _assert_entitlement(request)
    try:
        return PAYMENT_CHECKOUT.get_config_payload()
    except PaymentCheckoutError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/api/payments/runtime")
async def payment_runtime(request: Request):
    _assert_entitlement(request)
    try:
        from src.database.db_manager import DBManager

        db = DBManager()
        return {
            "checkout": PAYMENT_CHECKOUT.get_config_payload(),
            "rpc": PAYMENT_CHECKOUT.get_rpc_runtime_status(),
            "event_loop_state": db.get_payment_runtime_state("payment_event_loop") or {},
            "recent_audit_events": db.list_payment_audit_events(limit=20),
        }
    except PaymentCheckoutError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/api/payments/wallets")
async def payment_wallets(request: Request):
    _assert_entitlement(request)
    identity = _require_supabase_identity(request)
    try:
        wallets = PAYMENT_CHECKOUT.list_wallets(identity["user_id"])
        return {
            "wallets": [wallet.__dict__ for wallet in wallets],
            "chain_id": PAYMENT_CHECKOUT.chain_id,
        }
    except PaymentCheckoutError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.delete("/api/payments/wallets")
async def payment_wallet_unbind(request: Request, body: WalletUnbindRequest):
    _assert_entitlement(request)
    identity = _require_supabase_identity(request)
    try:
        return PAYMENT_CHECKOUT.unbind_wallet(
            user_id=identity["user_id"],
            address=body.address,
        )
    except PaymentCheckoutError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/api/payments/wallets/challenge")
async def payment_wallet_challenge(request: Request, body: WalletChallengeRequest):
    _assert_entitlement(request)
    identity = _require_supabase_identity(request)
    try:
        return PAYMENT_CHECKOUT.create_wallet_challenge(
            user_id=identity["user_id"],
            address=body.address,
        )
    except PaymentCheckoutError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/api/payments/wallets/verify")
async def payment_wallet_verify(request: Request, body: WalletVerifyRequest):
    _assert_entitlement(request)
    identity = _require_supabase_identity(request)
    try:
        bound = PAYMENT_CHECKOUT.verify_wallet_binding(
            user_id=identity["user_id"],
            address=body.address,
            nonce=body.nonce,
            signature=body.signature,
        )
        return {"wallet": bound.__dict__}
    except PaymentCheckoutError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/api/payments/intents")
async def payment_create_intent(request: Request, body: CreatePaymentIntentRequest):
    _assert_entitlement(request)
    identity = _require_supabase_identity(request)
    try:
        return PAYMENT_CHECKOUT.create_intent(
            user_id=identity["user_id"],
            plan_code=body.plan_code,
            payment_mode=body.payment_mode,
            allowed_wallet=body.allowed_wallet,
            token_address=body.token_address,
            use_points=body.use_points,
            points_to_consume=body.points_to_consume,
            metadata=body.metadata,
        )
    except PaymentCheckoutError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/api/payments/intents/{intent_id}")
async def payment_get_intent(request: Request, intent_id: str):
    _assert_entitlement(request)
    identity = _require_supabase_identity(request)
    try:
        intent = PAYMENT_CHECKOUT.get_intent(
            user_id=identity["user_id"],
            intent_id=intent_id,
        )
        return {"intent": intent.__dict__}
    except PaymentCheckoutError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/api/payments/intents/{intent_id}/submit")
async def payment_submit_tx(
    request: Request,
    intent_id: str,
    body: SubmitPaymentTxRequest,
):
    _assert_entitlement(request)
    identity = _require_supabase_identity(request)
    try:
        return PAYMENT_CHECKOUT.submit_intent_tx(
            user_id=identity["user_id"],
            intent_id=intent_id,
            tx_hash=body.tx_hash,
            from_address=body.from_address,
        )
    except PaymentCheckoutError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/api/payments/intents/{intent_id}/confirm")
async def payment_confirm_tx(
    request: Request,
    intent_id: str,
    body: ConfirmPaymentTxRequest,
):
    _assert_entitlement(request)
    identity = _require_supabase_identity(request)
    try:
        return PAYMENT_CHECKOUT.confirm_intent_tx(
            user_id=identity["user_id"],
            intent_id=intent_id,
            tx_hash=body.tx_hash,
        )
    except PaymentCheckoutError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/api/payments/reconcile-latest")
async def payment_reconcile_latest(request: Request):
    _assert_entitlement(request)
    identity = _require_supabase_identity(request)
    try:
        return PAYMENT_CHECKOUT.reconcile_latest_intent(identity["user_id"])
    except PaymentCheckoutError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/api/city/{name}/summary")
async def city_summary(request: Request, name: str, force_refresh: bool = False):
    city = _normalize_city_or_404(name)
    data = await run_in_threadpool(_analyze_summary, city, force_refresh)
    return await run_in_threadpool(_build_city_summary_payload, data)


@router.get("/api/city/{name}/detail")
async def city_detail_aggregate(
    request: Request,
    name: str,
    force_refresh: bool = False,
    market_slug: Optional[str] = None,
    target_date: Optional[str] = None,
):
    _assert_entitlement(request)
    city = _normalize_city_or_404(name)
    data = await run_in_threadpool(_analyze, city, force_refresh, True)
    return await run_in_threadpool(
        _build_city_detail_payload,
        data,
        market_slug,
        target_date,
    )
