from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse
from loguru import logger

from src.analysis.deb_algorithm import load_history
from src.data_collection.city_registry import ALIASES
from src.utils.metrics import export_prometheus_metrics
from web.analysis_service import (
    _analyze,
    _build_city_detail_payload,
    _build_city_summary_payload,
)
from web.core import (
    CITIES,
    CITY_REGISTRY,
    CITY_RISK_PROFILES,
    PAYMENT_CHECKOUT,
    PaymentCheckoutError,
    SETTLEMENT_SOURCE_LABELS,
    SUPABASE_ENTITLEMENT,
    ConfirmPaymentTxRequest,
    CreatePaymentIntentRequest,
    SubmitPaymentTxRequest,
    WalletChallengeRequest,
    WalletUnbindRequest,
    WalletVerifyRequest,
    _ENTITLEMENT_GUARD_ENABLED,
    _SUPABASE_AUTH_REQUIRED,
    _assert_entitlement,
    _bind_optional_supabase_identity,
    build_health_payload,
    build_system_status_payload,
    _require_supabase_identity,
    _resolve_auth_points,
    _resolve_weekly_profile,
    _sf,
    _is_excluded_model_name,
)

router = APIRouter()


def _normalize_city_or_404(name: str) -> str:
    city = name.lower().strip().replace("-", " ")
    city = ALIASES.get(city, city)
    if city not in CITIES:
        raise HTTPException(404, detail=f"Unknown city: {city}")
    return city


@router.get("/healthz")
async def healthz():
    payload = build_health_payload()
    if payload.get("status") != "ok":
        raise HTTPException(status_code=503, detail=payload)
    return payload


@router.get("/api/system/status")
async def system_status():
    return build_system_status_payload()


@router.get("/metrics", response_class=PlainTextResponse)
async def metrics():
    return PlainTextResponse(
        export_prometheus_metrics(),
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )


@router.get("/api/cities")
async def list_cities(request: Request):
    _assert_entitlement(request)
    try:
        out = []
        for name, info in CITIES.items():
            risk = CITY_RISK_PROFILES.get(name, {})
            settlement_source = str(info.get("settlement_source") or "metar").strip().lower() or "metar"
            out.append(
                {
                    "name": name,
                    "display_name": name.title(),
                    "lat": info["lat"],
                    "lon": info["lon"],
                    "risk_level": risk.get("risk_level", "low"),
                    "risk_emoji": risk.get("risk_emoji", "🟢"),
                    "airport": risk.get("airport_name", ""),
                    "icao": risk.get("icao", ""),
                    "temp_unit": "fahrenheit" if info["f"] else "celsius",
                    "is_major": CITY_REGISTRY.get(name, {}).get("is_major", True),
                    "settlement_source": settlement_source,
                    "settlement_source_label": SETTLEMENT_SOURCE_LABELS.get(
                        settlement_source,
                        settlement_source.upper(),
                    ),
                }
            )
        return {"cities": out}
    except Exception as exc:
        logger.error(f"Error in list_cities: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/api/city/{name}")
async def city_detail(request: Request, name: str, force_refresh: bool = False):
    _assert_entitlement(request)
    return _analyze(_normalize_city_or_404(name), force_refresh=force_refresh)


@router.get("/api/history/{name}")
async def city_history(request: Request, name: str):
    _assert_entitlement(request)
    city = _normalize_city_or_404(name)

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    history_file = os.path.join(project_root, "data", "daily_records.json")
    data = load_history(history_file)

    if city not in data:
        source = str(CITIES.get(city, {}).get("settlement_source") or "metar").strip().lower()
        return {
            "history": [],
            "settlement_source": source,
            "settlement_source_label": SETTLEMENT_SOURCE_LABELS.get(source, source.upper()),
        }

    city_data = data[city]
    out = []
    for day, rec in sorted(city_data.items()):
        act = rec.get("actual_high")
        deb = rec.get("deb_prediction")
        mu = rec.get("mu")
        forecasts_raw = rec.get("forecasts", {}) or {}
        forecasts = {}
        if isinstance(forecasts_raw, dict):
            for model_name, model_value in forecasts_raw.items():
                if _is_excluded_model_name(str(model_name)):
                    continue
                fv = _sf(model_value)
                forecasts[str(model_name)] = fv if fv is not None else None
        mgm = forecasts.get("MGM")
        out.append(
            {
                "date": day,
                "actual": float(act) if act is not None else None,
                "deb": float(deb) if deb is not None else None,
                "mu": float(mu) if mu is not None else None,
                "mgm": float(mgm) if mgm is not None else None,
                "forecasts": forecasts,
            }
        )

    source = str(CITIES.get(city, {}).get("settlement_source") or "metar").strip().lower()
    return {
        "history": out,
        "settlement_source": source,
        "settlement_source_label": SETTLEMENT_SOURCE_LABELS.get(source, source.upper()),
    }


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

    if SUPABASE_ENTITLEMENT.enabled and user_id:
        try:
            latest_subscription = SUPABASE_ENTITLEMENT.get_latest_active_subscription(
                user_id,
                respect_requirement=False,
            )
            subscription_active = bool(latest_subscription)
            if isinstance(latest_subscription, dict):
                subscription_plan_code = latest_subscription.get("plan_code")
                subscription_starts_at = latest_subscription.get("starts_at")
                subscription_expires_at = latest_subscription.get("expires_at")
        except Exception:
            subscription_active = None
            subscription_plan_code = None
            subscription_starts_at = None
            subscription_expires_at = None

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
    }


@router.get("/api/payments/config")
async def payment_config(request: Request):
    _assert_entitlement(request)
    try:
        return PAYMENT_CHECKOUT.get_config_payload()
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


@router.get("/api/city/{name}/summary")
async def city_summary(request: Request, name: str, force_refresh: bool = False):
    _assert_entitlement(request)
    data = _analyze(_normalize_city_or_404(name), force_refresh=force_refresh)
    return _build_city_summary_payload(data)


@router.get("/api/city/{name}/detail")
async def city_detail_aggregate(
    request: Request,
    name: str,
    force_refresh: bool = False,
    market_slug: Optional[str] = None,
    target_date: Optional[str] = None,
):
    _assert_entitlement(request)
    data = _analyze(_normalize_city_or_404(name), force_refresh=force_refresh)
    return _build_city_detail_payload(
        data,
        market_slug=market_slug,
        target_date=target_date,
    )
