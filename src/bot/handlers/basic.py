from __future__ import annotations

import os
from typing import Any
from typing import Callable

from loguru import logger  # type: ignore

from src.bot.command_parser import extract_command_name
from src.bot.io_layer import BotIOLayer
from src.bot.observability import CommandTrace
from src.bot.runtime_coordinator import RuntimeStatus, render_runtime_status_html
from src.auth.supabase_entitlement import SUPABASE_ENTITLEMENT
from src.auth.telegram_group_pricing import TelegramGroupPricing, TELEGRAM_MEMBER_STATUSES
from src.utils.telegram_chat_ids import get_telegram_chat_ids_from_env

_BASIC_COMMANDS = {"start", "help", "id", "top", "diag", "bind", "unbind"}
_BASIC_COMMANDS = {"start", "help", "id", "top", "diag", "bind", "unbind", "markets"}


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

        @self.bot.message_handler(commands=["bind"])
        def _bind(message):
            self._dispatch(message)

        @self.bot.message_handler(commands=["unbind"])
        def _unbind(message):
            self._dispatch(message)

        @self.bot.message_handler(commands=["markets"])
        def _markets(message):
            self._dispatch(message)

        if hasattr(self.bot, "chat_join_request_handler"):
            @self.bot.chat_join_request_handler(func=lambda request: True)
            def _chat_join_request(request):
                self.handle_chat_join_request(request)

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
        if command == "markets":
            self.handle_markets(message)
            return

    def handle_start_help(self, message: Any) -> None:
        trace = CommandTrace("/start", message)
        try:
            parts = (getattr(message, "text", None) or "").split(maxsplit=1)
            payload = str(parts[1] if len(parts) > 1 else "").strip()
            if payload.startswith("bind_"):
                token = payload[len("bind_") :].strip()
                result = self._bind_from_web_token(message, token)
                trace.set_status("ok" if result == "bound" else "error", result)
                return
            self.bot.reply_to(message, self.io_layer.build_welcome_text(), parse_mode="HTML")
            trace.set_status("ok")
        finally:
            trace.emit()

    def _bind_from_web_token(self, message: Any, token: str) -> str:
        if not token:
            self.bot.reply_to(message, "❌ 绑定链接无效，请回到网页重新点击一键绑定。")
            return "invalid_token"
        user = message.from_user
        try:
            payload = self.io_layer.db.consume_web_bind_token(token)
        except Exception as exc:
            logger.warning("web bind token consume failed user_id={}: {}", getattr(user, "id", ""), exc)
            payload = None
        if not isinstance(payload, dict):
            self.bot.reply_to(message, "❌ 绑定链接已过期或无效，请回到网页重新点击一键绑定。")
            return "invalid_or_expired_token"

        supabase_user_id = str(payload.get("supabase_user_id") or "").strip()
        supabase_email = str(payload.get("supabase_email") or "").strip()
        if not supabase_user_id:
            self.bot.reply_to(message, "❌ 绑定链接缺少网页账号信息，请重新登录后再试。")
            return "missing_supabase_user_id"

        self.io_layer.db.upsert_user(user.id, self.io_layer.display_name(user))
        bind_result = self.io_layer.db.bind_supabase_identity(
            telegram_id=user.id,
            supabase_user_id=supabase_user_id,
            supabase_email=supabase_email,
        )
        if not bool(bind_result.get("ok")):
            reason = str(bind_result.get("reason") or "bind_failed")
            self.bot.reply_to(message, f"❌ 绑定失败：{reason}")
            return reason
        self.bot.reply_to(
            message,
            (
                "✅ 账号绑定完成。\n"
                "现在可以回到网页点击“加入 Telegram 群组”，入群申请会自动审核。"
            ),
        )
        return "bound"

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
            user = message.from_user

            # No-args mode: generate a one-time bind token for group members
            if len(parts) < 2:
                pricing = TelegramGroupPricing()
                if not pricing.configured:
                    self.bot.reply_to(
                        message,
                        "⚠️ 机器人未配置群组定价，请联系管理员。",
                    )
                    trace.set_status("error", "pricing_not_configured")
                    return
                member_status = pricing.get_member_status(user.id)
                if not member_status or member_status not in TELEGRAM_MEMBER_STATUSES:
                    self.bot.reply_to(
                        message,
                        "🔒 此功能仅限内部群成员使用。",
                    )
                    trace.set_status("blocked", f"not_group_member:{member_status or 'none'}")
                    return
                token = self.io_layer.db.create_bind_token(user.id, ttl_minutes=10)
                app_url = str(os.getenv("POLYWEATHER_APP_URL") or "https://polyweather-pro.vercel.app").rstrip("/")
                bind_url = f"{app_url}/account?bind_token={token}"
                self.bot.reply_to(
                    message,
                    (
                        "🔗 点击以下链接绑定网页账户（10 分钟内有效）：\n"
                        f"{bind_url}\n\n"
                        "打开链接后系统将自动验证群成员身份并绑定 Telegram。"
                    ),
                    disable_web_page_preview=False,
                )
                trace.set_status("ok", "token_generated")
                return

            # Args mode: manual bind with supabase_user_id
            supabase_user_id = str(parts[1] or "").strip()
            if len(supabase_user_id) < 8:
                self.bot.reply_to(message, "❌ supabase_user_id 格式不正确。")
                trace.set_status("bad_request", "invalid_supabase_user_id")
                return
            supabase_email = str(parts[2] or "").strip() if len(parts) >= 3 else ""
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

    def handle_chat_join_request(self, request: Any) -> str:
        chat = getattr(request, "chat", None)
        user = getattr(request, "from_user", None)
        chat_id = getattr(chat, "id", None)
        user_id = getattr(user, "id", None)
        if chat_id is None or user_id is None:
            logger.warning("telegram join request missing chat_id/user_id")
            return "ignored:invalid_request"

        configured_chat_ids = {str(value).strip() for value in get_telegram_chat_ids_from_env() if str(value).strip()}
        configured_chat_ids.update(
            str(value).strip()
            for value in [
                os.getenv("POLYWEATHER_TELEGRAM_GROUP_ID"),
                os.getenv("POLYWEATHER_TELEGRAM_TOPICS_GROUP_ID"),
            ]
            if str(value or "").strip()
        )
        if configured_chat_ids and str(chat_id) not in configured_chat_ids:
            logger.info(
                "telegram join request ignored for non-configured chat chat_id={} user_id={}",
                chat_id,
                user_id,
            )
            return "ignored:chat_not_configured"

        try:
            supabase_user_ids = self.io_layer.db.list_supabase_user_ids_for_telegram(int(user_id))
        except Exception as exc:
            logger.warning("telegram join request binding lookup failed user_id={}: {}", user_id, exc)
            return "pending:lookup_error"

        if not supabase_user_ids:
            return self._handle_ineligible_join_request(
                chat_id=int(chat_id),
                user_id=int(user_id),
                reason="unbound",
            )

        for supabase_user_id in supabase_user_ids:
            try:
                if self.entitlement_service.has_active_subscription(
                    supabase_user_id,
                    respect_requirement=False,
                ):
                    self.bot.approve_chat_join_request(int(chat_id), int(user_id))
                    logger.info(
                        "telegram join request approved chat_id={} user_id={} supabase_user_id={}",
                        chat_id,
                        user_id,
                        supabase_user_id,
                    )
                    return "approved"
            except Exception as exc:
                logger.warning(
                    "telegram join request entitlement lookup failed user_id={} supabase_user_id={}: {}",
                    user_id,
                    supabase_user_id,
                    exc,
                )
                return "pending:entitlement_error"

        return self._handle_ineligible_join_request(
            chat_id=int(chat_id),
            user_id=int(user_id),
            reason="no_active_subscription",
        )

    def _handle_ineligible_join_request(self, chat_id: int, user_id: int, reason: str) -> str:
        action = str(os.getenv("POLYWEATHER_TELEGRAM_JOIN_INELIGIBLE_ACTION") or "pending").strip().lower()
        if action in {"decline", "reject", "deny"}:
            self.bot.decline_chat_join_request(chat_id, user_id)
            logger.info(
                "telegram join request declined chat_id={} user_id={} reason={}",
                chat_id,
                user_id,
                reason,
            )
            return f"declined:{reason}"
        logger.info(
            "telegram join request left pending chat_id={} user_id={} reason={}",
            chat_id,
            user_id,
            reason,
        )
        return f"pending:{reason}"

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

    def handle_markets(self, message: Any) -> None:
        trace = CommandTrace("/markets", message)
        try:
            chat_type = str(getattr(getattr(message, "chat", None), "type", "") or "").strip().lower()
            if chat_type and chat_type != "private":
                self.bot.reply_to(
                    message,
                    "ℹ️ `/markets` 仅支持私聊机器人查询。",
                    parse_mode="Markdown",
                )
                trace.set_status("blocked", f"unsupported_chat_type:{chat_type}")
                return

            self.bot.reply_to(
                message,
                "ℹ️ 市场概览 (Focus Digest) 功能已移除。\n频道继续接收关键市场警报推送；如需查看当前市场状态，请访问 https://polyweather-pro.vercel.app/",
                disable_web_page_preview=True,
            )
            trace.set_status("ok", "removed")
        finally:
            trace.emit()
