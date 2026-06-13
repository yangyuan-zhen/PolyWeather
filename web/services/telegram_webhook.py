from __future__ import annotations

import hmac
import json
import os
import threading
from typing import Any

from fastapi import HTTPException, Request
from loguru import logger

_WEBHOOK_BOT: Any | None = None
_WEBHOOK_BOT_LOCK = threading.Lock()


def _configured_secret() -> str:
    return str(os.getenv("TELEGRAM_WEBHOOK_SECRET") or "").strip()


def _configured_header_secret() -> str:
    return str(os.getenv("TELEGRAM_WEBHOOK_HEADER_SECRET") or "").strip()


def _parse_update(payload: dict[str, Any]) -> Any:
    from telebot import types  # type: ignore

    return types.Update.de_json(json.dumps(payload))


def _build_webhook_bot() -> Any:
    import telebot  # type: ignore

    from src.bot.handlers.activity import ActivityHandler
    from src.bot.handlers.basic import BasicCommandHandler
    from src.bot.io_layer import BotIOLayer
    from src.bot.runtime_coordinator import StartupCoordinator
    from src.database.db_manager import DBManager
    from src.utils.config_loader import load_config
    from src.utils.telegram_chat_ids import get_telegram_chat_ids_from_env

    token = str(os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not configured")

    config = load_config()
    bot = telebot.TeleBot(token)
    io_layer = BotIOLayer(bot=bot, db=DBManager())
    startup_coordinator = StartupCoordinator(
        bot=bot,
        config=config,
        command_access_mode="public",
        protected_commands=[],
        required_group_chat_id=",".join(get_telegram_chat_ids_from_env()),
    )
    BasicCommandHandler(
        bot=bot,
        io_layer=io_layer,
        runtime_status_provider=startup_coordinator.get_runtime_status,
        config=config,
    ).register()
    ActivityHandler(bot=bot, io_layer=io_layer).register()
    return bot


def _get_webhook_bot() -> Any:
    global _WEBHOOK_BOT
    if _WEBHOOK_BOT is not None:
        return _WEBHOOK_BOT
    with _WEBHOOK_BOT_LOCK:
        if _WEBHOOK_BOT is None:
            _WEBHOOK_BOT = _build_webhook_bot()
        return _WEBHOOK_BOT


def _verify_webhook_secret(path_secret: str, request: Request) -> None:
    expected = _configured_secret()
    if not expected:
        raise HTTPException(status_code=503, detail="telegram webhook is not configured")
    if not hmac.compare_digest(str(path_secret or ""), expected):
        raise HTTPException(status_code=403, detail="invalid telegram webhook secret")

    expected_header = _configured_header_secret()
    if expected_header:
        actual_header = request.headers.get("x-telegram-bot-api-secret-token", "")
        if not hmac.compare_digest(actual_header, expected_header):
            raise HTTPException(status_code=403, detail="invalid telegram webhook header")


async def handle_telegram_webhook(path_secret: str, request: Request) -> dict[str, bool]:
    _verify_webhook_secret(path_secret, request)
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid telegram webhook payload") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid telegram webhook payload")

    update = _parse_update(payload)
    if update is None:
        logger.warning("telegram webhook ignored unparsable update payload")
        return {"ok": True}

    try:
        _get_webhook_bot().process_new_updates([update])
    except Exception:
        logger.exception("telegram webhook dispatch failed")
        raise
    return {"ok": True}
