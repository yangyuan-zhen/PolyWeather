from __future__ import annotations

import os
from typing import Any

from loguru import logger

from src.bot.io_layer import BotIOLayer
from src.utils.telegram_chat_ids import get_telegram_chat_ids_from_env, parse_telegram_chat_ids


class CommandGuard:
    """Unified command gate: group membership + points charge."""

    _ALLOWED_MEMBER_STATUSES = {"creator", "administrator", "member", "restricted"}

    def __init__(self, io_layer: BotIOLayer, group_chat_id: str | None = None):
        self.io_layer = io_layer
        if group_chat_id is None:
            self.group_chat_ids = get_telegram_chat_ids_from_env()
        else:
            self.group_chat_ids = parse_telegram_chat_ids(group_chat_id)
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

        if not self.group_chat_ids:
            logger.error(
                "group member blocked command={} user_id={} reason=missing_TELEGRAM_CHAT_IDS",
                command_label,
                user_id,
            )
            self.io_layer.bot.reply_to(
                message,
                "⚠️ 机器人未配置群组准入（TELEGRAM_CHAT_IDS / TELEGRAM_CHAT_ID），请联系管理员。",
            )
            return False

        blocked_statuses: list[str] = []
        lookup_failures: list[str] = []
        for chat_id in self.group_chat_ids:
            try:
                member = self.io_layer.bot.get_chat_member(chat_id, int(user_id))
                status = str(getattr(member, "status", "") or "").strip().lower()
            except Exception as exc:
                lookup_failures.append(f"{chat_id}:{type(exc).__name__}")
                continue

            if status in self._ALLOWED_MEMBER_STATUSES:
                return True
            blocked_statuses.append(f"{chat_id}:{status or 'unknown'}")

        if blocked_statuses:
            logger.info(
                "group member blocked command={} user_id={} chat_ids={} statuses={}",
                command_label,
                user_id,
                ",".join(self.group_chat_ids),
                "|".join(blocked_statuses),
            )
        else:
            logger.info(
                "group member blocked command={} user_id={} chat_ids={} reason=lookup_failed_all errors={}",
                command_label,
                user_id,
                ",".join(self.group_chat_ids),
                "|".join(lookup_failures) or "unknown",
            )
        self._reply_group_required(message)
        return False

    def ensure_access_and_points(self, message: Any, cost: int, command_label: str) -> bool:
        if not self.ensure_group_member(message, command_label):
            return False
        return self.io_layer.ensure_query_points(message, cost, command_label)
