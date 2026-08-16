from __future__ import annotations

from typing import Any

from src.database.db_manager import DBManager


class BotIOLayer:
    """Telegram IO + points/account side effects."""

    def __init__(self, bot: Any, db: DBManager):
        self.bot = bot
        self.db = db

    @staticmethod
    def display_name(user: Any) -> str:
        return user.username or user.first_name or f"User_{user.id}"

    def build_welcome_text(self) -> str:
        return (
            "🚀 <b>PolyWeather 机器人</b>\n\n"
            "可用指令:\n"
            "/top - 查看积分排行榜\n"
            "/id - 获取当前聊天的 Chat ID\n\n"
            "/diag - 查看 Bot 启动诊断\n\n"
            "🔗 机器人: <a href=\"https://t.me/polyyuanbot\">@polyyuanbot</a>"
        )

    def build_points_rank_text(self, user: Any) -> str:
        self.db.upsert_user(user.id, self.display_name(user))
        user_info = self.db.get_user(user.id)

        leaderboard = self.db.get_leaderboard(limit=5)
        rank_text = "🏆 <b>PolyWeather 用户积分排行</b>\n"
        rank_text += "────────────────────\n"
        for i, entry in enumerate(leaderboard):
            medal = ["🥇", "🥈", "🥉", "  ", "  "][i] if i < 5 else "  "
            username = (entry.get("username") or "unknown")[:12]
            points = int(entry.get("points") or 0)
            rank_text += f"{medal} {username}: <b>{points}</b> 分\n"

        if user_info:
            rank_text += "────────────────────\n"
            rank_text += (
                "👤 <b>我的状态：</b>\n"
                f"┣ 累计积分: <code>{user_info['points']}</code>\n"
                "┣ 积分获取: <code>邀请付费用户</code>\n"
                "┗ 抵扣规则: <code>500分 = 1 USDC，单笔最多抵3U</code>"
            )
        return rank_text
