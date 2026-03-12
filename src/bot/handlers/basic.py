from __future__ import annotations

from typing import Any
from typing import Callable

from src.bot.io_layer import BotIOLayer
from src.bot.observability import CommandTrace
from src.bot.runtime_coordinator import RuntimeStatus, render_runtime_status_html


class BasicCommandHandler:
    def __init__(
        self,
        bot: Any,
        io_layer: BotIOLayer,
        runtime_status_provider: Callable[[], RuntimeStatus],
    ):
        self.bot = bot
        self.io_layer = io_layer
        self.runtime_status_provider = runtime_status_provider

    def register(self) -> None:
        @self.bot.message_handler(commands=["start", "help"])
        def _start_help(message):
            self.handle_start_help(message)

        @self.bot.message_handler(commands=["id"])
        def _id(message):
            self.handle_id(message)

        @self.bot.message_handler(commands=["top"])
        def _top(message):
            self.handle_top(message)

        @self.bot.message_handler(commands=["diag"])
        def _diag(message):
            self.handle_diag(message)

        @self.bot.message_handler(commands=["bind"])
        def _bind(message):
            self.handle_bind(message)

    def handle_start_help(self, message: Any) -> None:
        trace = CommandTrace("/start", message)
        try:
            self.bot.reply_to(message, self.io_layer.build_welcome_text(), parse_mode="HTML")
            trace.set_status("ok")
        finally:
            trace.emit()

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

    def handle_bind(self, message: Any) -> None:
        trace = CommandTrace("/bind", message)
        try:
            parts = (message.text or "").split(maxsplit=2)
            if len(parts) < 2:
                self.bot.reply_to(
                    message,
                    (
                        "❌ 用法:\n"
                        "<code>/bind &lt;supabase_user_id&gt; [email]</code>\n\n"
                        "示例:\n"
                        "<code>/bind 11111111-2222-3333-4444-555555555555 user@example.com</code>"
                    ),
                    parse_mode="HTML",
                )
                trace.set_status("bad_request", "missing_supabase_user_id")
                return

            supabase_user_id = str(parts[1] or "").strip()
            if len(supabase_user_id) < 8:
                self.bot.reply_to(message, "❌ supabase_user_id 格式不正确。")
                trace.set_status("bad_request", "invalid_supabase_user_id")
                return
            supabase_email = str(parts[2] or "").strip() if len(parts) >= 3 else ""
            user = message.from_user
            self.io_layer.db.upsert_user(user.id, self.io_layer.display_name(user))
            self.io_layer.db.bind_supabase_identity(
                telegram_id=user.id,
                supabase_user_id=supabase_user_id,
                supabase_email=supabase_email,
            )
            self.bot.reply_to(
                message,
                (
                    "✅ 账号绑定完成。\n"
                    f"supabase_user_id: <code>{supabase_user_id}</code>"
                ),
                parse_mode="HTML",
            )
            trace.set_status("ok")
        finally:
            trace.emit()
