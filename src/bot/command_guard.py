from __future__ import annotations

import os
from typing import Any

from loguru import logger

from src.bot.io_layer import BotIOLayer


class CommandGuard:
    """Unified command gate: group membership + points charge."""

    _ALLOWED_MEMBER_STATUSES = {"creator", "administrator", "member", "restricted"}

    def __init__(self, io_layer: BotIOLayer, group_chat_id: str | None = None):
        self.io_layer = io_layer
        self.group_chat_id = str(group_chat_id or os.getenv("TELEGRAM_CHAT_ID") or "").strip()
        self.group_invite_url = str(os.getenv("POLYWEATHER_BOT_GROUP_INVITE_URL") or "").strip()

    def _reply_group_required(self, message: Any) -> None:
        lines = ["🔒 该指令仅限群成员使用，请先加入官方群。"]
        if self.group_invite_url:
            lines.append(f"👉 入群链接: {self.group_invite_url}")
        self.io_layer.bot.reply_to(message, "\n".join(lines))

    def ensure_group_member(self, message: Any, command_label: str) -> bool:
        user = getattr(message, "from_user", None)
        user_id = getattr(user, "id", None)
        if user_id is None:
            return False

        if not self.group_chat_id:
            logger.error(
                "group member blocked command={} user_id={} reason=missing_TELEGRAM_CHAT_ID",
                command_label,
                user_id,
            )
            self.io_layer.bot.reply_to(
                message,
                "⚠️ 机器人未配置群组准入（TELEGRAM_CHAT_ID），请联系管理员。",
            )
            return False

        try:
            member = self.io_layer.bot.get_chat_member(self.group_chat_id, int(user_id))
            status = str(getattr(member, "status", "") or "").strip().lower()
        except Exception as exc:
            logger.info(
                "group member blocked command={} user_id={} chat_id={} reason=lookup_failed error={}",
                command_label,
                user_id,
                self.group_chat_id,
                exc,
            )
            self._reply_group_required(message)
            return False

        if status in self._ALLOWED_MEMBER_STATUSES:
            return True

        logger.info(
            "group member blocked command={} user_id={} chat_id={} status={}",
            command_label,
            user_id,
            self.group_chat_id,
            status or "unknown",
        )
        self._reply_group_required(message)
        return False

    def ensure_access_and_points(self, message: Any, cost: int, command_label: str) -> bool:
        if not self.ensure_group_member(message, command_label):
            return False
        return self.io_layer.ensure_query_points(message, cost, command_label)
