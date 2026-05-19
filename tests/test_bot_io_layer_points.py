from __future__ import annotations

from types import SimpleNamespace

from src.bot.io_layer import BotIOLayer


class DummyDB:
    def __init__(self):
        self.upserts = []
        self.activities = []

    def upsert_user(self, telegram_id, username):
        self.upserts.append((telegram_id, username))

    def add_message_activity(self, telegram_id, **kwargs):
        self.activities.append({"telegram_id": telegram_id, **kwargs})
        return {"awarded": True, "points_added": kwargs.get("points_to_add", 0)}


def _message(chat_id: int | str, text: str = "有效发言"):
    return SimpleNamespace(
        text=text,
        from_user=SimpleNamespace(id=123, username="alice", first_name="Alice"),
        chat=SimpleNamespace(id=chat_id, type="supergroup"),
        message_thread_id=None,
    )


def test_group_message_points_include_configured_forum_chat(monkeypatch):
    monkeypatch.delenv("POLYWEATHER_BOT_POINTS_CHAT_IDS", raising=False)
    monkeypatch.delenv("POLYWEATHER_BOT_POINTS_CHAT_ID", raising=False)
    monkeypatch.setenv("TELEGRAM_CHAT_IDS", "-1003965137823")
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    db = DummyDB()
    io_layer = BotIOLayer(bot=SimpleNamespace(), db=db)

    io_layer.track_group_text_activity(_message(-1003965137823))

    assert db.upserts == [(123, "alice")]
    assert len(db.activities) == 1
    assert db.activities[0]["telegram_id"] == 123


def test_group_message_points_skip_unconfigured_chat_when_allowlist_exists(monkeypatch):
    monkeypatch.setenv("POLYWEATHER_BOT_POINTS_CHAT_IDS", "-1003965137823")
    monkeypatch.setenv("TELEGRAM_CHAT_IDS", "-1003965137823")
    db = DummyDB()
    io_layer = BotIOLayer(bot=SimpleNamespace(), db=db)

    io_layer.track_group_text_activity(_message(-1000000000000))

    assert db.upserts == []
    assert db.activities == []
