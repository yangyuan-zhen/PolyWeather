"""Payment API routes."""

from fastapi import APIRouter, Request

from web.core import (
    ConfirmPaymentTxRequest,
    CreatePaymentIntentRequest,
    SubmitPaymentTxRequest,
    WalletChallengeRequest,
    WalletUnbindRequest,
    WalletVerifyRequest,
)
from web.services.payment_api import (
    confirm_payment_tx as confirm_payment_tx_service,
    create_payment_intent as create_payment_intent_service,
    create_payment_wallet_challenge,
    get_payment_config,
    get_payment_intent,
    get_payment_runtime,
    list_payment_wallets,
    reconcile_latest_payment,
    submit_payment_tx as submit_payment_tx_service,
    unbind_payment_wallet,
    verify_payment_wallet,
)

router = APIRouter(tags=["payments"])


@router.get("/api/payments/config")
async def payment_config(request: Request):
    return get_payment_config(request)


@router.get("/api/payments/runtime")
async def payment_runtime(request: Request):
    return get_payment_runtime(request)


@router.get("/api/payments/wallets")
async def payment_wallets(request: Request):
    return list_payment_wallets(request)


@router.delete("/api/payments/wallets")
async def payment_wallet_unbind(request: Request, body: WalletUnbindRequest):
    return unbind_payment_wallet(request, body)


@router.post("/api/payments/wallets/challenge")
async def payment_wallet_challenge(request: Request, body: WalletChallengeRequest):
    return create_payment_wallet_challenge(request, body)


@router.post("/api/payments/wallets/verify")
async def payment_wallet_verify(request: Request, body: WalletVerifyRequest):
    return verify_payment_wallet(request, body)


@router.post("/api/payments/intents")
async def payment_create_intent(request: Request, body: CreatePaymentIntentRequest):
    return create_payment_intent_service(request, body)


@router.get("/api/payments/intents/{intent_id}")
async def payment_get_intent(request: Request, intent_id: str):
    return get_payment_intent(request, intent_id)


@router.post("/api/payments/intents/{intent_id}/submit")
async def payment_submit_tx(
    request: Request,
    intent_id: str,
    body: SubmitPaymentTxRequest,
):
    return submit_payment_tx_service(request, intent_id, body)


@router.post("/api/payments/intents/{intent_id}/confirm")
async def payment_confirm_tx(
    request: Request,
    intent_id: str,
    body: ConfirmPaymentTxRequest,
):
    return confirm_payment_tx_service(request, intent_id, body)


@router.post("/api/payments/reconcile-latest")
async def payment_reconcile_latest(request: Request):
    return reconcile_latest_payment(request)
