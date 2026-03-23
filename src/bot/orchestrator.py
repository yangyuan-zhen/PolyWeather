from __future__ import annotations

import os
from typing import Any

from loguru import logger  # type: ignore

from src.bot.analysis.city_analysis_service import CityAnalysisService
from src.bot.analysis.deb_analysis_service import DebAnalysisService
from src.bot.command_guard import CommandGuard
from src.bot.handlers.activity import ActivityHandler
from src.bot.handlers.basic import BasicCommandHandler
from src.bot.handlers.city import CityCommandHandler
from src.bot.handlers.deb import DebCommandHandler
from src.bot.io_layer import BotIOLayer
from src.bot.runtime_coordinator import StartupCoordinator
from src.bot.services.city_command_service import CityCommandService
from src.bot.services.deb_command_service import DebCommandService
from src.utils.config_validation import validate_or_raise
from src.utils.telegram_chat_ids import get_telegram_chat_ids_from_env


def _project_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _register_handlers(
    bot: Any,
    io_layer: BotIOLayer,
    guard: CommandGuard,
    city_service: CityCommandService,
    deb_service: DebCommandService,
    startup_coordinator: StartupCoordinator,
) -> None:
    BasicCommandHandler(
        bot=bot,
        io_layer=io_layer,
        runtime_status_provider=startup_coordinator.get_runtime_status,
    ).register()
    CityCommandHandler(
        bot=bot,
        guard=guard,
        city_service=city_service,
        io_layer=io_layer,
    ).register()
    DebCommandHandler(
        bot=bot,
        guard=guard,
        deb_service=deb_service,
        io_layer=io_layer,
    ).register()
    ActivityHandler(bot=bot, io_layer=io_layer).register()


def start_bot() -> None:
    import telebot  # type: ignore

    from src.data_collection.weather_sources import WeatherDataCollector
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
    weather = WeatherDataCollector(config)

    io_layer = BotIOLayer(bot=bot, db=db)
    city_analysis = CityAnalysisService(weather=weather)
    deb_analysis = DebAnalysisService(project_root=_project_root())
    guard = CommandGuard(io_layer=io_layer)
    city_service = CityCommandService(analysis=city_analysis)
    deb_service = DebCommandService(analysis=deb_analysis)
    startup_coordinator = StartupCoordinator(
        bot=bot,
        config=config,
        command_access_mode="group_member_only",
        protected_commands=["/city", "/deb"],
        required_group_chat_id=",".join(get_telegram_chat_ids_from_env()),
    )

    _register_handlers(
        bot=bot,
        io_layer=io_layer,
        guard=guard,
        city_service=city_service,
        deb_service=deb_service,
        startup_coordinator=startup_coordinator,
    )
    runtime_status = startup_coordinator.start_all()
    started_count = sum(1 for loop in runtime_status.loops if loop.started)

    logger.info(
        "🤖 Bot 启动中... access=group-member-only protected_commands=/city,/deb loops_started={}/{}",
        started_count,
        len(runtime_status.loops),
    )
    bot.infinity_polling()
