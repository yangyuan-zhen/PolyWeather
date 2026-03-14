from __future__ import annotations

from typing import Any

from loguru import logger

from src.bot.command_guard import CommandGuard
from src.bot.io_layer import BotIOLayer
from src.bot.observability import CommandTrace
from src.bot.services.deb_command_service import DebCommandService
from src.bot.settings import DEB_QUERY_COST


def _is_deb_command_text(text: str | None) -> bool:
    head = str(text or "").strip().split(maxsplit=1)[0].lower()
    return head == "/deb" or head.startswith("/deb@")


class DebCommandHandler:
    def __init__(
        self,
        bot: Any,
        guard: CommandGuard,
        deb_service: DebCommandService,
        io_layer: BotIOLayer,
    ):
        self.bot = bot
        self.guard = guard
        self.deb_service = deb_service
        self.io_layer = io_layer

    def register(self) -> None:
        @self.bot.message_handler(
            func=lambda message: _is_deb_command_text(getattr(message, "text", None)),
            content_types=["text"],
        )
        def _deb(message):
            self.handle(message)

    def handle(self, message: Any) -> None:
        trace = CommandTrace("/deb", message)
        try:
            parts = (message.text or "").split(maxsplit=1)
            if len(parts) < 2:
                trace.set_status("bad_request", "missing_city")
                self.io_layer.send_query_message(
                    message,
                    "❌ 用法: <code>/deb ankara</code>",
                    parse_mode="HTML",
                )
                return

            city_input = parts[1].strip().lower()
            city_name = self.deb_service.resolve_city(city_input)
            if not self.deb_service.has_history(city_name):
                trace.set_status("bad_request", "history_missing")
                self.io_layer.send_query_message(
                    message,
                    f"❌ 暂无 {city_name} 的历史数据。",
                    parse_mode="HTML",
                )
                return

            if not self.guard.ensure_access_and_points(message, DEB_QUERY_COST, "/deb"):
                trace.set_status("blocked", "guard_rejected")
                return

            report_result = self.deb_service.build_report(city_name, DEB_QUERY_COST)
            if not report_result.ok:
                trace.set_status("failed", report_result.error or "deb_report_failed")
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
            logger.exception("查询 /deb 失败")
            self.io_layer.send_query_message(message, f"❌ 查询失败: {exc}")
        finally:
            trace.emit()
