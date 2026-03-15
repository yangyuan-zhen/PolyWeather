from __future__ import annotations

from typing import Any

from loguru import logger

from src.bot.command_parser import extract_command_name
from src.bot.command_parser import split_command_and_args
from src.bot.command_guard import CommandGuard
from src.bot.io_layer import BotIOLayer
from src.bot.observability import CommandTrace
from src.bot.services.city_command_service import CityCommandService
from src.bot.settings import CITY_QUERY_COST

def _is_city_command(message: Any) -> bool:
    command = extract_command_name(
        getattr(message, "text", None),
        getattr(message, "entities", None),
    )
    return command in {"city", "pwcity"}


class CityCommandHandler:
    def __init__(
        self,
        bot: Any,
        guard: CommandGuard,
        city_service: CityCommandService,
        io_layer: BotIOLayer,
    ):
        self.bot = bot
        self.guard = guard
        self.city_service = city_service
        self.io_layer = io_layer

    def register(self) -> None:
        @self.bot.message_handler(commands=["city", "pwcity"])
        def _city_command(message):
            self.handle(message)

        @self.bot.message_handler(
            func=lambda message: _is_city_command(message),
            content_types=["text"],
        )
        def _city_text(message):
            self.handle(message)

    def handle(self, message: Any) -> None:
        if getattr(message, "_pw_city_handled", False):
            return
        if not _is_city_command(message):
            return
        setattr(message, "_pw_city_handled", True)
        setattr(message, "_pw_command_handled", True)
        trace = CommandTrace("/city", message)
        try:
            _, args = split_command_and_args(getattr(message, "text", None))
            if not args:
                trace.set_status("bad_request", "missing_city")
                self.io_layer.send_query_message(
                    message,
                    "❌ 请输入城市名称\n\n用法: <code>/city chicago</code>",
                    parse_mode="HTML",
                )
                return

            city_input = args.strip().lower()
            resolved = self.city_service.resolve_city(city_input)
            if not resolved.ok:
                city_list = ", ".join(resolved.supported_cities or [])
                trace.set_status("bad_request", "city_not_supported")
                self.io_layer.send_query_message(
                    message,
                    f"❌ 未找到城市: <b>{city_input}</b>\n\n支持的城市: {city_list}",
                    parse_mode="HTML",
                )
                return

            city_name = str(resolved.city_name)
            if not self.guard.ensure_access_and_points(message, CITY_QUERY_COST, "/city"):
                trace.set_status("blocked", "guard_rejected")
                return

            self.io_layer.send_query_message(
                message,
                f"🔍 正在查询 {city_name.title()} 的天气数据...",
            )
            report_result = self.city_service.build_report(city_name, CITY_QUERY_COST)
            if not report_result.ok:
                trace.set_status("failed", report_result.error or "city_report_failed")
                self.io_layer.send_query_message(
                    message,
                    f"❌ 查询失败: {report_result.error}",
                )
                return

            self.io_layer.send_query_message(
                message,
                str(report_result.report),
                parse_mode="HTML",
            )
            trace.set_status("ok", city_name)
        except Exception as exc:
            trace.set_status("failed", "unexpected_error")
            logger.exception("查询 /city 失败")
            self.io_layer.send_query_message(message, f"❌ 查询失败: {exc}")
        finally:
            trace.emit()
