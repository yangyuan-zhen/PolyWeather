from __future__ import annotations

from typing import Any

from loguru import logger

from src.bot.command_guard import CommandGuard
from src.bot.io_layer import BotIOLayer
from src.bot.observability import CommandTrace
from src.bot.services.city_command_service import CityCommandService
from src.bot.settings import CITY_QUERY_COST


def _is_city_command_text(text: str | None) -> bool:
    head = str(text or "").strip().split(maxsplit=1)[0].lower()
    return head == "/city" or head.startswith("/city@")


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
        @self.bot.message_handler(
            func=lambda message: _is_city_command_text(getattr(message, "text", None)),
            content_types=["text"],
        )
        def _city(message):
            self.handle(message)

    def handle(self, message: Any) -> None:
        trace = CommandTrace("/city", message)
        try:
            parts = (message.text or "").split(maxsplit=1)
            if len(parts) < 2:
                trace.set_status("bad_request", "missing_city")
                self.io_layer.send_query_message(
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
