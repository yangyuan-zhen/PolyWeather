"""Authentication API routes."""

from fastapi import APIRouter, Request, Response

from web.core import ReferralApplyRequest, TelegramBindTokenRequest, TelegramLoginRequest
from web.services.auth_api import (
    apply_referral_code,
    bind_telegram_by_token,
    create_telegram_bot_bind_link,
    get_auth_me_payload,
    login_with_telegram,
)

router = APIRouter(tags=["auth"])


@router.get("/api/auth/me")
async def auth_me(request: Request, response: Response):
    payload = get_auth_me_payload(request)
    server_timing = str(
        getattr(request.state, "auth_me_server_timing", "") or ""
    ).strip()
    if server_timing:
        response.headers["Server-Timing"] = server_timing
    return payload


@router.post("/api/auth/telegram/login")
async def auth_telegram_login(request: Request, body: TelegramLoginRequest):
    return login_with_telegram(request, body)


@router.post("/api/auth/telegram/bind-by-token")
async def auth_telegram_bind_by_token(request: Request, body: TelegramBindTokenRequest):
    return bind_telegram_by_token(request, body)


@router.post("/api/auth/telegram/bot-bind-link")
async def auth_telegram_bot_bind_link(request: Request):
    return create_telegram_bot_bind_link(request)


@router.post("/api/auth/referral/apply")
async def auth_referral_apply(request: Request, body: ReferralApplyRequest):
    return apply_referral_code(request, body)
