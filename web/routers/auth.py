"""Authentication API routes."""

from fastapi import APIRouter, Request

from web.core import TelegramBindTokenRequest, TelegramLoginRequest
from web.services.auth_api import (
    bind_telegram_by_token,
    get_auth_me_payload,
    login_with_telegram,
)

router = APIRouter(tags=["auth"])


@router.get("/api/auth/me")
async def auth_me(request: Request):
    return get_auth_me_payload(request)


@router.post("/api/auth/telegram/login")
async def auth_telegram_login(request: Request, body: TelegramLoginRequest):
    return login_with_telegram(request, body)


@router.post("/api/auth/telegram/bind-by-token")
async def auth_telegram_bind_by_token(request: Request, body: TelegramBindTokenRequest):
    return bind_telegram_by_token(request, body)
