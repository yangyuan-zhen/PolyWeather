"""Authentication API routes."""

from fastapi import APIRouter, Request

from web.core import TelegramLoginRequest
from web.services.auth_api import get_auth_me_payload, login_with_telegram

router = APIRouter(tags=["auth"])


@router.get("/api/auth/me")
async def auth_me(request: Request):
    return get_auth_me_payload(request)


@router.post("/api/auth/telegram/login")
async def auth_telegram_login(request: Request, body: TelegramLoginRequest):
    return login_with_telegram(request, body)
