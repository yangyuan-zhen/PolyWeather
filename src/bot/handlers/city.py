from __future__ import annotations

from typing import Any

from loguru import logger

from src.bot.command_guard import CommandGuard
from src.bot.observability import CommandTrace
from src.bot.services.city_command_service import CityCommandService
from src.bot.settings import CITY_QUERY_COST


class CityCommandHandler:
    def __init__(
        self,
        bot: Any,
        guard: CommandGuard,
        city_service: CityCommandService,
    ):
        self.bot = bot
        self.guard = guard
        self.city_service = city_service

    def register(self) -> None:
        @self.bot.message_handler(commands=["city"])
        def _city(message):
            self.handle(message)

    def handle(self, message: Any) -> None:
        trace = CommandTrace("/city", message)
        try:
            parts = (message.text or "").split(maxsplit=1)
            if len(parts) < 2:
                trace.set_status("bad_request", "missing_city")
                self.bot.reply_to(
                    message,
                    "❌ 请输入城市名称\n\n用法: <code>/city chicago</code>",
                    parse_mode="HTML",
                )
                return

            city_input = parts[1].strip().lower()
            resolved = self.city_service.resolve_city(city_input)
            if not resolved.ok:
                city_list = ", ".join(resolved.supported_cities or [])
                trace.set_status("bad_request", "city_not_supported")
                self.bot.reply_to(
                    message,
                    f"❌ 未找到城市: <b>{city_input}</b>\n\n支持的城市: {city_list}",
                    parse_mode="HTML",
                )
                return

            city_name = str(resolved.city_name)
            if not self.guard.ensure_access_and_points(message, CITY_QUERY_COST, "/city"):
                trace.set_status("blocked", "guard_rejected")
                return

            self.bot.send_message(
                message.chat.id, f"🔍 正在查询 {city_name.title()} 的天气数据..."
            )
            report_result = self.city_service.build_report(city_name, CITY_QUERY_COST)
            if not report_result.ok:
                trace.set_status("failed", report_result.error or "city_report_failed")
                self.bot.reply_to(message, f"❌ 查询失败: {report_result.error}")
                return

            self.bot.send_message(message.chat.id, str(report_result.report), parse_mode="HTML")
            trace.set_status("ok", city_name)
        except Exception as exc:
            trace.set_status("failed", "unexpected_error")
            logger.exception("查询 /city 失败")
            self.bot.reply_to(message, f"❌ 查询失败: {exc}")
        finally:
            trace.emit()

