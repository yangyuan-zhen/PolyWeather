from __future__ import annotations

from types import SimpleNamespace

from src.bot.io_layer import BotIOLayer


class DummyDB:
    def __init__(self):
        self.upserts = []
        self.users = {}

    def upsert_user(self, telegram_id, username):
        self.upserts.append((telegram_id, username))
        self.users.setdefault(
            telegram_id,
            {
                "points": 0,
                "daily_queries_date": "",
                "daily_city_queries": 0,
                "daily_deb_queries": 0,
            },
        )

    def get_user(self, telegram_id):
        return self.users.get(telegram_id)

    def get_leaderboard(self, limit=5):
        return []


def test_welcome_text_hides_removed_query_commands():
    io_layer = BotIOLayer(bot=SimpleNamespace(), db=DummyDB())

    text = io_layer.build_welcome_text()

    assert "/city" not in text
    assert "/pwcity" not in text
    assert "/deb" not in text
    assert "/pwdeb" not in text
    assert "/markets" not in text
    assert "私有频道" not in text
    assert "示例" not in text
    assert "积分现在通过邀请制度" not in text


def test_points_rank_text_hides_removed_query_usage():
    db = DummyDB()
    io_layer = BotIOLayer(bot=SimpleNamespace(), db=db)
    user = SimpleNamespace(id=123, username="alice", first_name="Alice")

    text = io_layer.build_points_rank_text(user)

    assert "/city" not in text
    assert "/deb" not in text
