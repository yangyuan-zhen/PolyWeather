from datetime import datetime

from src.bot.io_layer import BotIOLayer
from src.database.db_manager import DBManager


class _DummyBot:
    def send_message(self, *args, **kwargs):
        return None


class _User:
    def __init__(self, user_id: int, username: str):
        self.id = user_id
        self.username = username
        self.first_name = username


def test_weekly_points_display_uses_weekly_profile_archive_fallback(tmp_path):
    db = DBManager(str(tmp_path / "test.db"))
    io = BotIOLayer(_DummyBot(), db)
    user = _User(1001, "yuan")

    db.upsert_user(user.id, user.username)
    now = datetime.now()
    week_key = f"{now.isocalendar()[0]}-W{now.isocalendar()[1]:02d}"
    with db._get_connection() as conn:  # noqa: SLF001
        conn.execute(
            """
            UPDATE users
            SET points = ?, message_count = ?, daily_points = ?, daily_points_date = ?, weekly_points = ?, weekly_points_week = ?
            WHERE telegram_id = ?
            """,
            (206, 15, 0, now.strftime("%Y-%m-%d"), 0, "", user.id),
        )
        conn.execute(
            """
            INSERT INTO weekly_points_archive (telegram_id, week_key, points, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(telegram_id, week_key) DO UPDATE SET
                points = excluded.points,
                updated_at = excluded.updated_at
            """,
            (user.id, week_key, 192, now.isoformat()),
        )
        conn.commit()

    text = io.build_points_rank_text(user)
    assert "累计发言" in text
    assert "本周发言积分: <code>192</code>" in text
    assert "本周排名: <code>1/1</code>" in text
