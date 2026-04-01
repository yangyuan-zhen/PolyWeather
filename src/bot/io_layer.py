from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Dict, Optional, Tuple

from loguru import logger

from src.bot.settings import (
    CITY_QUERY_COST,
    DEB_QUERY_COST,
    MESSAGE_COOLDOWN_SEC,
    MESSAGE_DAILY_CAP,
    MESSAGE_MIN_LENGTH,
    MESSAGE_POINTS,
)
from src.database.db_manager import DBManager


class BotIOLayer:
    """Telegram IO + points/account side effects."""

    def __init__(self, bot: Any, db: DBManager):
        self.bot = bot
        self.db = db
        self.query_topic_map = self._parse_topic_map(
            os.getenv("TELEGRAM_QUERY_TOPIC_MAP")
        )
        self.message_cooldown_map = self._parse_int_map(
            os.getenv("POLYWEATHER_BOT_MESSAGE_COOLDOWN_BY_CHAT")
        )
        self.query_topic_chat_id = str(
            os.getenv("TELEGRAM_QUERY_TOPIC_CHAT_ID") or ""
        ).strip()
        self.query_topic_id = self._safe_int(
            os.getenv("TELEGRAM_QUERY_TOPIC_ID"),
            default=0,
        )

    @staticmethod
    def display_name(user: Any) -> str:
        return user.username or user.first_name or f"User_{user.id}"

    @staticmethod
    def _safe_int(raw: Any, default: int = 0) -> int:
        try:
            return int(raw)
        except Exception:
            return default

    @staticmethod
    def _parse_topic_map(raw: Optional[str]) -> Dict[str, int]:
        """
        Parse TELEGRAM_QUERY_TOPIC_MAP:
        - "-1003586303099:25513,-1003539418691:25514"
        - Supports comma/semicolon/newline separators.
        """
        out: Dict[str, int] = {}
        if not raw:
            return out
        normalized = str(raw).replace("\r", ",").replace("\n", ",").replace(";", ",")
        for part in normalized.split(","):
            row = part.strip()
            if not row or ":" not in row:
                continue
            chat_id, topic_raw = row.split(":", 1)
            chat_id = str(chat_id or "").strip()
            topic_id = BotIOLayer._safe_int(topic_raw, default=0)
            if chat_id and topic_id > 0:
                out[chat_id] = topic_id
        return out

    @staticmethod
    def _parse_int_map(raw: Optional[str]) -> Dict[str, int]:
        """
        Parse env maps like:
        - "-1003586303099:10,-1003539418691:20"
        - Supports comma/semicolon/newline separators.
        """
        out: Dict[str, int] = {}
        if not raw:
            return out
        normalized = str(raw).replace("\r", ",").replace("\n", ",").replace(";", ",")
        for part in normalized.split(","):
            row = part.strip()
            if not row or ":" not in row:
                continue
            key, value_raw = row.split(":", 1)
            key = str(key or "").strip()
            value = BotIOLayer._safe_int(value_raw, default=-1)
            if key and value >= 0:
                out[key] = value
        return out

    def _resolve_message_cooldown(self, chat_id: Any) -> int:
        chat_key = str(chat_id).strip() if chat_id is not None else ""
        if chat_key and chat_key in self.message_cooldown_map:
            return self.message_cooldown_map[chat_key]
        return MESSAGE_COOLDOWN_SEC

    def _resolve_query_target(
        self,
        source_chat_id: Any,
    ) -> Tuple[Optional[str], int]:
        src = str(source_chat_id).strip() if source_chat_id is not None else ""
        if src and src in self.query_topic_map:
            return src, self.query_topic_map[src]
        if self.query_topic_chat_id:
            return self.query_topic_chat_id, self.query_topic_id
        # No mapping/fixed topic configured: reply directly to source chat without topic.
        return src or None, 0

    def send_query_message(
        self,
        message: Any,
        text: str,
        *,
        parse_mode: str | None = None,
    ) -> None:
        chat = getattr(message, "chat", None)
        fallback_chat_id = getattr(chat, "id", None)
        target_chat_id, target_topic_id = self._resolve_query_target(fallback_chat_id)
        if target_chat_id is None:
            self.bot.send_message(message.chat.id, text, parse_mode=parse_mode)
            return

        kwargs = {}
        if parse_mode:
            kwargs["parse_mode"] = parse_mode
        if target_topic_id > 0:
            kwargs["message_thread_id"] = target_topic_id

        try:
            self.bot.send_message(target_chat_id, text, **kwargs)
            return
        except Exception as exc:
            logger.warning(
                "query topic send failed chat_id={} topic_id={} source_chat_id={} error={}",
                target_chat_id,
                target_topic_id,
                fallback_chat_id,
                exc,
            )

        # Fallback: drop topic and send to source chat.
        if fallback_chat_id is not None:
            fallback_kwargs = dict(kwargs)
            fallback_kwargs.pop("message_thread_id", None)
            self.bot.send_message(fallback_chat_id, text, **fallback_kwargs)

    def ensure_query_points(self, message: Any, cost: int, label: str) -> bool:
        user = message.from_user
        self.db.upsert_user(user.id, self.display_name(user))
        result = self.db.spend_points(user.id, cost)
        if result.get("ok"):
            return True

        balance = int(result.get("balance") or 0)
        required = int(result.get("required") or cost)
        missing = max(0, required - balance)
        self.send_query_message(
            message,
            (
                f"❌ 积分不足，无法执行 <b>{label}</b>\n"
                f"当前积分: <code>{balance}</code>\n"
                f"需要积分: <code>{required}</code>\n"
                f"还差积分: <code>{missing}</code>\n\n"
                f"积分规则：有效发言满 {MESSAGE_MIN_LENGTH} 字获得 <b>{MESSAGE_POINTS}</b> 积分，"
                f"每日上限 {MESSAGE_DAILY_CAP} 分。"
            ),
            parse_mode="HTML",
        )
        return False

    def build_welcome_text(self) -> str:
        return (
            "🚀 <b>PolyWeather 天气查询机器人</b>\n\n"
            "可用指令:\n"
            f"/city [城市名] 或 /pwcity [城市名] - 查询城市天气预测与实测 (消耗 {CITY_QUERY_COST} 积分)\n"
            f"/deb [城市名] 或 /pwdeb [城市名] - 查看 DEB 融合预测准确率 (消耗 {DEB_QUERY_COST} 积分)\n"
            "/markets - 私聊机器人查看当前市场监控摘要\n"
            "/top - 查看积分排行榜\n"
            "/id - 获取当前聊天的 Chat ID\n\n"
            "/diag - 查看 Bot 启动诊断\n\n"
            "/bind - 绑定 Supabase 账号（可选）\n"
            "/unbind - 解除当前 Telegram 与网页账号绑定\n\n"
            "🔗 机器人: <a href=\"https://t.me/WeatherQuant_bot\">@WeatherQuant_bot</a>\n"
            "👥 社群: <a href=\"https://t.me/+nMG7SjziUKYyZmM1\">加入 Telegram 群组</a>\n\n"
            "📌 <i>私有频道用于接收自动推送；手动查看市场概览请私聊机器人发送 <code>/markets</code>。</i>\n\n"
            "🔐 <i>/city 与 /deb 仅限官方群成员使用。</i>\n\n"
            "示例: <code>/city 伦敦</code> 或 <code>/pwcity 伦敦</code>\n"
            f"💡 <i>提示: 每日签到(有效发言满 {MESSAGE_MIN_LENGTH} 字)获得 <b>{MESSAGE_POINTS}</b> 积分，"
            f"每日上限 {MESSAGE_DAILY_CAP} 分。</i>"
        )

    def build_points_rank_text(self, user: Any) -> str:
        self.db.upsert_user(user.id, self.display_name(user))
        user_info = self.db.get_user(user.id)
        now = datetime.now()
        today_str = now.strftime("%Y-%m-%d")
        weekly_profile = self.db.get_weekly_profile(user.id)
        week_key = str(weekly_profile.get("week_key") or "")

        leaderboard = self.db.get_weekly_leaderboard(limit=5)
        rank_text = f"🏆 <b>PolyWeather 周活跃度排行榜 ({week_key})</b>\n"
        rank_text += "────────────────────\n"
        for i, entry in enumerate(leaderboard):
            medal = ["🥇", "🥈", "🥉", "  ", "  "][i] if i < 5 else "  "
            username = (entry.get("username") or "unknown")[:12]
            weekly_points = int(entry.get("weekly_points") or 0)
            rank_text += f"{medal} {username}: <b>{weekly_points}</b> 点\n"

        if user_info:
            daily_points = int(user_info.get("daily_points") or 0)
            daily_points_date = str(user_info.get("daily_points_date") or "")
            if daily_points_date != today_str:
                daily_points = 0
            if daily_points > MESSAGE_DAILY_CAP:
                daily_points = MESSAGE_DAILY_CAP

            weekly_points = int(weekly_profile.get("weekly_points") or 0)
            weekly_rank = weekly_profile.get("weekly_rank")
            ranked_count = int(weekly_profile.get("total_ranked") or 0)
            weekly_rank_text = (
                f"{weekly_rank}/{ranked_count}" if weekly_rank and ranked_count > 0 else "未上榜"
            )

            rank_text += "────────────────────\n"
            rank_text += (
                "👤 <b>我的状态：</b>\n"
                f"┣ 累计积分: <code>{user_info['points']}</code>\n"
                f"┣ 累计发言: <code>{user_info['message_count']}</code> 次\n"
                f"┣ 本周排名: <code>{weekly_rank_text}</code>\n"
                f"┣ 本周发言积分: <code>{weekly_points}</code>\n"
                f"┣ 今日发言积分: <code>{daily_points}/{MESSAGE_DAILY_CAP}</code>\n"
                f"┗ /city 消耗: <code>{CITY_QUERY_COST}</code> | /deb 消耗: <code>{DEB_QUERY_COST}</code>"
            )
        return rank_text

    def track_group_text_activity(self, message: Any) -> None:
        text = str(getattr(message, "text", "") or "")
        if text.startswith("/"):
            return
        chat = getattr(message, "chat", None)
        if not chat or chat.type not in ("group", "supergroup"):
            return

        user = message.from_user
        username = self.display_name(user)
        cooldown_sec = self._resolve_message_cooldown(getattr(chat, "id", None))
        preview = text.strip().replace("\n", " ")
        if len(preview) > 80:
            preview = preview[:77] + "..."
        logger.info(
            "group text received chat_id={} thread_id={} user_id={} text_len={} cooldown_sec={} preview={!r}",
            getattr(chat, "id", None),
            getattr(message, "message_thread_id", None),
            getattr(user, "id", None),
            len(text.strip()),
            cooldown_sec,
            preview,
        )
        self.db.upsert_user(user.id, username)

        result = self.db.add_message_activity(
            user.id,
            text=text,
            points_to_add=MESSAGE_POINTS,
            cooldown_sec=cooldown_sec,
            daily_cap=MESSAGE_DAILY_CAP,
            min_text_length=MESSAGE_MIN_LENGTH,
        )
        if result.get("awarded"):
            awarded = int(result.get("points_added") or MESSAGE_POINTS)
            logger.info(
                f"message points awarded user={user.id} points=+{awarded} "
                f"daily_points={result.get('daily_points')}/{MESSAGE_DAILY_CAP}"
            )
            return

        logger.info(
            "message points skipped chat_id={} thread_id={} user_id={} reason={} daily_points={} weekly_points={}",
            getattr(chat, "id", None),
            getattr(message, "message_thread_id", None),
            getattr(user, "id", None),
            result.get("reason") or "unknown",
            result.get("daily_points"),
            result.get("weekly_points"),
        )
