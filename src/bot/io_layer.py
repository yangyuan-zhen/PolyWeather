from __future__ import annotations

from typing import Any

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

    @staticmethod
    def display_name(user: Any) -> str:
        return user.username or user.first_name or f"User_{user.id}"

    def ensure_query_points(self, message: Any, cost: int, label: str) -> bool:
        user = message.from_user
        self.db.upsert_user(user.id, self.display_name(user))
        result = self.db.spend_points(user.id, cost)
        if result.get("ok"):
            return True

        balance = int(result.get("balance") or 0)
        required = int(result.get("required") or cost)
        missing = max(0, required - balance)
        self.bot.reply_to(
            message,
            (
                f"❌ 积分不足，无法执行 <b>{label}</b>\n"
                f"当前积分: <code>{balance}</code>\n"
                f"需要积分: <code>{required}</code>\n"
                f"还差积分: <code>{missing}</code>\n\n"
                f"积分规则：每日签到（有效发言满 {MESSAGE_MIN_LENGTH} 字）获得 <b>{MESSAGE_POINTS}</b> 积分，"
                f"每日上限 {MESSAGE_DAILY_CAP} 分。"
            ),
            parse_mode="HTML",
        )
        return False

    def build_welcome_text(self) -> str:
        return (
            "🚀 <b>PolyWeather 天气查询机器人</b>\n\n"
            "可用指令:\n"
            f"/city [城市名] - 查询城市天气预测与实测 (消耗 {CITY_QUERY_COST} 积分)\n"
            f"/deb [城市名] - 查看 DEB 融合预测准确率 (消耗 {DEB_QUERY_COST} 积分)\n"
            "/top - 查看积分排行榜\n"
            "/id - 获取当前聊天的 Chat ID\n\n"
            "/diag - 查看 Bot 启动诊断\n\n"
            "示例: <code>/city 伦敦</code>\n"
            f"💡 <i>提示: 每日签到(有效发言满 {MESSAGE_MIN_LENGTH} 字)获得 <b>{MESSAGE_POINTS}</b> 积分，"
            f"每日上限 {MESSAGE_DAILY_CAP} 分。</i>"
        )

    def build_points_rank_text(self, user: Any) -> str:
        self.db.upsert_user(user.id, self.display_name(user))
        user_info = self.db.get_user(user.id)

        leaderboard = self.db.get_leaderboard(limit=5)
        rank_text = "🏆 <b>PolyWeather 活跃度排行榜</b>\n"
        rank_text += "────────────────────\n"
        for i, entry in enumerate(leaderboard):
            medal = ["🥇", "🥈", "🥉", "  ", "  "][i] if i < 5 else "  "
            rank_text += f"{medal} {entry['username'][:12]}: <b>{entry['points']}</b> 点\n"

        if user_info:
            rank_text += "────────────────────\n"
            rank_text += (
                "👤 <b>我的状态：</b>\n"
                f"┣ 积分: <code>{user_info['points']}</code>\n"
                f"┣ 发言: <code>{user_info['message_count']}</code> 次\n"
                f"┣ 今日发言积分: <code>{user_info.get('daily_points') or 0}/{MESSAGE_DAILY_CAP}</code>\n"
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
        self.db.upsert_user(user.id, username)

        result = self.db.add_message_activity(
            user.id,
            text=text,
            points_to_add=MESSAGE_POINTS,
            cooldown_sec=MESSAGE_COOLDOWN_SEC,
            daily_cap=MESSAGE_DAILY_CAP,
            min_text_length=MESSAGE_MIN_LENGTH,
        )
        if result.get("awarded"):
            logger.info(
                f"message points awarded user={user.id} points=+{MESSAGE_POINTS} "
                f"daily_points={result.get('daily_points')}/{MESSAGE_DAILY_CAP}"
            )
