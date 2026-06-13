"""Telegram webhook routes."""

from fastapi import APIRouter, Request

from web.services.telegram_webhook import handle_telegram_webhook

router = APIRouter(tags=["telegram"])


@router.post("/api/telegram/webhook/{path_secret}")
async def telegram_webhook(path_secret: str, request: Request):
    return await handle_telegram_webhook(path_secret, request)
