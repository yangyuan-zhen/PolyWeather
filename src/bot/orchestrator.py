from __future__ import annotations

import os
from typing import Any

from loguru import logger  # type: ignore

from src.bot.handlers.activity import ActivityHandler
from src.bot.handlers.basic import BasicCommandHandler
from src.bot.io_layer import BotIOLayer
from src.bot.runtime_coordinator import StartupCoordinator
from src.utils.config_validation import validate_or_raise
from src.utils.telegram_chat_ids import get_telegram_chat_ids_from_env


def _register_handlers(
    bot: Any,
    config: dict[str, Any],
    io_layer: BotIOLayer,
    guard: Any | None,
    city_service: Any | None,
    deb_service: Any | None,
    startup_coordinator: StartupCoordinator,
) -> None:
    BasicCommandHandler(
        bot=bot,
        io_layer=io_layer,
        runtime_status_provider=startup_coordinator.get_runtime_status,
        config=config,
    ).register()
    ActivityHandler(bot=bot, io_layer=io_layer).register()


def start_bot() -> None:
    import telebot  # type: ignore

    from src.database.db_manager import DBManager
    from src.utils.config_loader import load_config

    validate_or_raise("bot")
    config = load_config()
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        logger.error("未找到 TELEGRAM_BOT_TOKEN 环境变量")
        return

    bot = telebot.TeleBot(token)
    db = DBManager()

    io_layer = BotIOLayer(bot=bot, db=db)
    startup_coordinator = StartupCoordinator(
        bot=bot,
        config=config,
        command_access_mode="public",
        protected_commands=[],
        required_group_chat_id=",".join(get_telegram_chat_ids_from_env()),
    )

    _register_handlers(
        bot=bot,
        config=config,
        io_layer=io_layer,
        guard=None,
        city_service=None,
        deb_service=None,
        startup_coordinator=startup_coordinator,
    )
    runtime_status = startup_coordinator.start_all()
    started_count = sum(1 for loop in runtime_status.loops if loop.started)

    logger.info(
        "🤖 Bot 启动中... access=public protected_commands=none loops_started={}/{}",
        started_count,
        len(runtime_status.loops),
    )
    bot.infinity_polling(allowed_updates=["message", "callback_query", "chat_join_request"])
