"""Payment API service functions used by the payments router."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import HTTPException, Request

from src.database.db_manager import DBManager
from web.core import (
    ConfirmPaymentTxRequest,
    CreatePaymentIntentRequest,
    SubmitPaymentTxRequest,
    ValidatePaymentTxRequest,
    WalletChallengeRequest,
    WalletUnbindRequest,
    WalletVerifyRequest,
)
import web.routes as legacy_routes


def _raise_payment_error(exc: Exception) -> None:
    raise HTTPException(
        status_code=getattr(exc, "status_code", 400),
        detail=getattr(exc, "detail", str(exc)),
    ) from exc


def _require_payment_identity(request: Request) -> Dict[str, Any]:
    request.state.skip_subscription_gate = True
    legacy_routes._assert_entitlement(request)
    identity = legacy_routes._require_supabase_identity(request)
    user_id = str(identity.get("user_id") or "").strip()
    if not user_id or user_id == "entitlement" or user_id.startswith("admin:"):
        raise HTTPException(status_code=401, detail="Supabase user required")
    return identity


def get_payment_config(request: Request) -> Dict[str, Any]:
    try:
        return legacy_routes.PAYMENT_CHECKOUT.get_config_payload()
    except legacy_routes.PaymentCheckoutError as exc:
        _raise_payment_error(exc)


def get_payment_runtime(request: Request) -> Dict[str, Any]:
    legacy_routes._assert_entitlement(request)
    try:
        db = DBManager()
        return {
            "checkout": legacy_routes.PAYMENT_CHECKOUT.get_config_payload(),
            "rpc": legacy_routes.PAYMENT_CHECKOUT.get_rpc_runtime_status(),
            "event_loop_state": db.get_payment_runtime_state("payment_event_loop") or {},
            "recent_audit_events": db.list_payment_audit_events(limit=20),
        }
    except legacy_routes.PaymentCheckoutError as exc:
        _raise_payment_error(exc)


def list_payment_wallets(request: Request) -> Dict[str, Any]:
    identity = _require_payment_identity(request)
    try:
        wallets = legacy_routes.PAYMENT_CHECKOUT.list_wallets(identity["user_id"])
        return {
            "wallets": [wallet.__dict__ for wallet in wallets],
            "chain_id": legacy_routes.PAYMENT_CHECKOUT.chain_id,
        }
    except legacy_routes.PaymentCheckoutError as exc:
        _raise_payment_error(exc)


def unbind_payment_wallet(request: Request, body: WalletUnbindRequest) -> Dict[str, Any]:
    identity = _require_payment_identity(request)
    try:
        return legacy_routes.PAYMENT_CHECKOUT.unbind_wallet(
            user_id=identity["user_id"],
            address=body.address,
        )
    except legacy_routes.PaymentCheckoutError as exc:
        _raise_payment_error(exc)


def create_payment_wallet_challenge(
    request: Request,
    body: WalletChallengeRequest,
) -> Dict[str, Any]:
    identity = _require_payment_identity(request)
    try:
        return legacy_routes.PAYMENT_CHECKOUT.create_wallet_challenge(
            user_id=identity["user_id"],
            address=body.address,
        )
    except legacy_routes.PaymentCheckoutError as exc:
        _raise_payment_error(exc)


def verify_payment_wallet(
    request: Request,
    body: WalletVerifyRequest,
) -> Dict[str, Any]:
    identity = _require_payment_identity(request)
    try:
        bound = legacy_routes.PAYMENT_CHECKOUT.verify_wallet_binding(
            user_id=identity["user_id"],
            address=body.address,
            nonce=body.nonce,
            signature=body.signature,
        )
        return {"wallet": bound.__dict__}
    except legacy_routes.PaymentCheckoutError as exc:
        _raise_payment_error(exc)


def create_payment_intent(
    request: Request,
    body: CreatePaymentIntentRequest,
) -> Dict[str, Any]:
    identity = _require_payment_identity(request)
    try:
        return legacy_routes.PAYMENT_CHECKOUT.create_intent(
            user_id=identity["user_id"],
            plan_code=body.plan_code,
            payment_mode=body.payment_mode,
            allowed_wallet=body.allowed_wallet,
            token_address=body.token_address,
            chain_id=body.chain_id,
            use_points=body.use_points,
            points_to_consume=body.points_to_consume,
            metadata=body.metadata,
        )
    except legacy_routes.PaymentCheckoutError as exc:
        _raise_payment_error(exc)


def get_payment_intent(request: Request, intent_id: str) -> Dict[str, Any]:
    identity = _require_payment_identity(request)
    try:
        intent = legacy_routes.PAYMENT_CHECKOUT.get_intent(
            user_id=identity["user_id"],
            intent_id=intent_id,
        )
        return {"intent": intent.__dict__}
    except legacy_routes.PaymentCheckoutError as exc:
        _raise_payment_error(exc)


def submit_payment_tx(
    request: Request,
    intent_id: str,
    body: SubmitPaymentTxRequest,
) -> Dict[str, Any]:
    identity = _require_payment_identity(request)
    try:
        return legacy_routes.PAYMENT_CHECKOUT.submit_intent_tx(
            user_id=identity["user_id"],
            intent_id=intent_id,
            tx_hash=body.tx_hash,
            from_address=body.from_address,
        )
    except legacy_routes.PaymentCheckoutError as exc:
        _raise_payment_error(exc)


def validate_payment_tx(
    request: Request,
    intent_id: str,
    body: ValidatePaymentTxRequest,
) -> Dict[str, Any]:
    identity = _require_payment_identity(request)
    try:
        return legacy_routes.PAYMENT_CHECKOUT.validate_intent_tx(
            user_id=identity["user_id"],
            intent_id=intent_id,
            tx_hash=body.tx_hash,
        )
    except legacy_routes.PaymentCheckoutError as exc:
        _raise_payment_error(exc)


def confirm_payment_tx(
    request: Request,
    intent_id: str,
    body: ConfirmPaymentTxRequest,
) -> Dict[str, Any]:
    identity = _require_payment_identity(request)
    try:
        return legacy_routes.PAYMENT_CHECKOUT.confirm_intent_tx(
            user_id=identity["user_id"],
            intent_id=intent_id,
            tx_hash=body.tx_hash,
        )
    except legacy_routes.PaymentCheckoutError as exc:
        _raise_payment_error(exc)


def reconcile_latest_payment(request: Request) -> Dict[str, Any]:
    identity = _require_payment_identity(request)
    try:
        return legacy_routes.PAYMENT_CHECKOUT.reconcile_latest_intent(identity["user_id"])
    except legacy_routes.PaymentCheckoutError as exc:
        _raise_payment_error(exc)
