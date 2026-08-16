from __future__ import annotations

from typing import Any
from typing import Callable

from src.bot.command_parser import extract_command_name
from src.bot.command_parser import looks_like_slash_command
from src.bot.io_layer import BotIOLayer
from src.bot.observability import CommandTrace
from src.bot.runtime_coordinator import RuntimeStatus, render_runtime_status_html
from src.auth.supabase_entitlement import SUPABASE_ENTITLEMENT

_BASIC_COMMANDS = {"start", "help", "id", "top", "diag"}


class BasicCommandHandler:
    def __init__(
        self,
        bot: Any,
        io_layer: BotIOLayer,
        runtime_status_provider: Callable[[], RuntimeStatus],
        config: dict | None = None,
        entitlement_service: Any | None = None,
    ):
        self.bot = bot
        self.io_layer = io_layer
        self.runtime_status_provider = runtime_status_provider
        self.config = config or {}
        self.entitlement_service = entitlement_service or SUPABASE_ENTITLEMENT

    def register(self) -> None:
        @self.bot.message_handler(commands=["start", "help"])
        def _start_help(message):
            self._dispatch(message)

        @self.bot.message_handler(commands=["id"])
        def _id(message):
            self._dispatch(message)

        @self.bot.message_handler(commands=["top"])
        def _top(message):
            self._dispatch(message)

        @self.bot.message_handler(commands=["diag"])
        def _diag(message):
            self._dispatch(message)

        @self.bot.message_handler(
            content_types=["text"],
            func=lambda message: extract_command_name(
                getattr(message, "text", None),
                getattr(message, "entities", None),
            )
            in _BASIC_COMMANDS,
        )
        def _basic_text(message):
            self._dispatch(message)

        @self.bot.message_handler(
            content_types=["text"],
            func=self._is_private_text_fallback,
        )
        def _private_text_fallback(message):
            self.handle_private_text_fallback(message)

    def _dispatch(self, message: Any) -> None:
        command = extract_command_name(
            getattr(message, "text", None),
            getattr(message, "entities", None),
        )
        if command not in _BASIC_COMMANDS:
            return
        if getattr(message, "_pw_basic_handled", False):
            return
        setattr(message, "_pw_basic_handled", True)
        setattr(message, "_pw_command_handled", True)
        if command in {"start", "help"}:
            self.handle_start_help(message)
            return
        if command == "id":
            self.handle_id(message)
            return
        if command == "top":
            self.handle_top(message)
            return
        if command == "diag":
            self.handle_diag(message)
            return

    def handle_start_help(self, message: Any) -> None:
        trace = CommandTrace("/start", message)
        try:
            self.bot.reply_to(message, self.io_layer.build_welcome_text(), parse_mode="HTML")
            trace.set_status("ok")
        finally:
            trace.emit()

    @staticmethod
    def _is_private_text_fallback(message: Any) -> bool:
        text = str(getattr(message, "text", "") or "").strip()
        chat_type = str(getattr(getattr(message, "chat", None), "type", "") or "").strip().lower()
        return bool(text and chat_type == "private" and not looks_like_slash_command(text))

    def handle_private_text_fallback(self, message: Any) -> str:
        text = str(getattr(message, "text", "") or "").strip()
        if looks_like_slash_command(text):
            return "ignored:slash_command"
        chat_type = str(getattr(getattr(message, "chat", None), "type", "") or "").strip().lower()
        if chat_type != "private":
            return "ignored:not_private"
        self.bot.reply_to(
            message,
            "我收到了，但这不是可执行命令。\n\n可以发送 <code>/help</code> 查看可用命令。",
            parse_mode="HTML",
        )
        return "replied"

    def handle_id(self, message: Any) -> None:
        trace = CommandTrace("/id", message)
        try:
            self.bot.reply_to(
                message,
                f"🎯 当前聊天的 Chat ID 是: <code>{message.chat.id}</code>",
                parse_mode="HTML",
            )
            trace.set_status("ok")
        finally:
            trace.emit()

    def handle_top(self, message: Any) -> None:
        trace = CommandTrace("/top", message)
        try:
            rank_text = self.io_layer.build_points_rank_text(message.from_user)
            self.bot.send_message(message.chat.id, rank_text, parse_mode="HTML")
            trace.set_status("ok")
        finally:
            trace.emit()

    def handle_diag(self, message: Any) -> None:
        trace = CommandTrace("/diag", message)
        try:
            status = self.runtime_status_provider()
            self.bot.reply_to(message, render_runtime_status_html(status), parse_mode="HTML")
            trace.set_status("ok")
        finally:
            trace.emit()
