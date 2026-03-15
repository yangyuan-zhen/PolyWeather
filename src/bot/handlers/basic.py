from __future__ import annotations

from typing import Any
from typing import Callable

from src.bot.command_parser import extract_command_name
from src.bot.io_layer import BotIOLayer
from src.bot.observability import CommandTrace
from src.bot.runtime_coordinator import RuntimeStatus, render_runtime_status_html

_BASIC_COMMANDS = {"start", "help", "id", "top", "diag", "bind", "unbind"}


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

        @self.bot.message_handler(commands=["bind"])
        def _bind(message):
            self._dispatch(message)

        @self.bot.message_handler(commands=["unbind"])
        def _unbind(message):
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
        if command == "bind":
            self.handle_bind(message)
            return
        if command == "unbind":
            self.handle_unbind(message)
            return

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
            result = self.io_layer.db.bind_supabase_identity(
                telegram_id=user.id,
                supabase_user_id=supabase_user_id,
                supabase_email=supabase_email,
            )
            if not bool(result.get("ok")):
                reason = str(result.get("reason") or "bind_failed")
                if reason == "telegram_already_bound_other":
                    current_uid = str(result.get("current_supabase_user_id") or "")
                    self.bot.reply_to(
                        message,
                        (
                            "❌ 当前 Telegram 已绑定其他网页账号。\n"
                            f"当前绑定: <code>{current_uid}</code>\n\n"
                            "请先执行 <code>/unbind</code> 再绑定新账号。"
                        ),
                        parse_mode="HTML",
                    )
                    trace.set_status("conflict", "telegram_already_bound_other")
                    return
                if reason == "supabase_already_bound_other":
                    owner = str(result.get("owner_telegram_id") or "")
                    self.bot.reply_to(
                        message,
                        (
                            "❌ 该网页账号已绑定到其他 Telegram。\n"
                            f"绑定中的 Telegram ID: <code>{owner}</code>\n\n"
                            "如需迁移，请先在原 Telegram 账号执行 <code>/unbind</code>。"
                        ),
                        parse_mode="HTML",
                    )
                    trace.set_status("conflict", "supabase_already_bound_other")
                    return
                self.bot.reply_to(message, "❌ 绑定失败，请稍后重试。")
                trace.set_status("error", reason)
                return

            if str(result.get("reason") or "") == "already_bound_same":
                self.bot.reply_to(
                    message,
                    (
                        "✅ 已是当前绑定账号，无需重复绑定。\n"
                        f"supabase_user_id: <code>{supabase_user_id}</code>"
                    ),
                    parse_mode="HTML",
                )
                trace.set_status("ok", "already_bound_same")
                return

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

    def handle_unbind(self, message: Any) -> None:
        trace = CommandTrace("/unbind", message)
        try:
            user = message.from_user
            self.io_layer.db.upsert_user(user.id, self.io_layer.display_name(user))
            result = self.io_layer.db.unbind_supabase_identity(user.id)
            if str(result.get("reason") or "") == "not_bound":
                self.bot.reply_to(
                    message,
                    "ℹ️ 当前 Telegram 尚未绑定网页账号。",
                )
                trace.set_status("ok", "not_bound")
                return
            self.bot.reply_to(
                message,
                "✅ 已解除当前 Telegram 与网页账号的绑定。",
            )
            trace.set_status("ok", "unbound")
        finally:
            trace.emit()
