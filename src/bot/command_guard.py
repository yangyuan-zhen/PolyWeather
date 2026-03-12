from __future__ import annotations

from typing import Any

from loguru import logger

from src.bot.io_layer import BotIOLayer
from src.bot.services.entitlement_service import BotEntitlementService


class CommandGuard:
    """Unified command gate: entitlement + points charge."""

    def __init__(self, io_layer: BotIOLayer, entitlement_service: BotEntitlementService):
        self.io_layer = io_layer
        self.entitlement_service = entitlement_service

    def ensure_entitled(self, message: Any, command_label: str) -> bool:
        user = getattr(message, "from_user", None)
        user_id = getattr(user, "id", None)
        if user_id is None:
            return False

        decision = self.entitlement_service.check(int(user_id), command_label)
        if decision.allowed:
            return True

        if decision.reason == "bind_required":
            denial_text = (
                "🔒 当前指令需要订阅权限。\n"
                "请先绑定账号后再试：\n"
                "<code>/bind &lt;supabase_user_id&gt; [email]</code>"
            )
        elif decision.reason in {"supabase_subscription_required", "premium_required"}:
            denial_text = (
                "🔒 当前指令需要高级权限。\n"
                "请先开通订阅后再使用。"
            )
        else:
            denial_text = (
                "🔒 当前指令需要高级权限。\n"
                "请先开通订阅后再使用。"
            )

        self.io_layer.bot.reply_to(
            message,
            denial_text,
            parse_mode="HTML",
        )
        logger.info(
            "bot entitlement blocked command={} user_id={} reason={}",
            command_label,
            user_id,
            decision.reason,
        )
        return False

    def ensure_access_and_points(self, message: Any, cost: int, command_label: str) -> bool:
        if not self.ensure_entitled(message, command_label):
            return False
        return self.io_layer.ensure_query_points(message, cost, command_label)
