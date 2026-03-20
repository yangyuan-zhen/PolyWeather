from types import SimpleNamespace
from unittest.mock import Mock

from src.bot.command_guard import CommandGuard


def _message():
    return SimpleNamespace(
        from_user=SimpleNamespace(id=123, username="tester", first_name="Tester"),
        chat=SimpleNamespace(id=999),
    )


def test_guard_blocks_non_member_before_points_charge():
    fake_bot = SimpleNamespace(
        reply_to=Mock(),
        get_chat_member=Mock(return_value=SimpleNamespace(status="left")),
    )
    io_layer = SimpleNamespace(bot=fake_bot, ensure_query_points=Mock(return_value=True))
    guard = CommandGuard(io_layer=io_layer, group_chat_id="-100123")

    ok = guard.ensure_access_and_points(_message(), 1, "/city")

    assert ok is False
    assert io_layer.ensure_query_points.call_count == 0
    assert fake_bot.reply_to.call_count == 1


def test_guard_allows_member_then_charges_points():
    fake_bot = SimpleNamespace(
        reply_to=Mock(),
        get_chat_member=Mock(return_value=SimpleNamespace(status="member")),
    )
    io_layer = SimpleNamespace(bot=fake_bot, ensure_query_points=Mock(return_value=True))
    guard = CommandGuard(io_layer=io_layer, group_chat_id="-100123")

    ok = guard.ensure_access_and_points(_message(), 1, "/city")

    assert ok is True
    assert io_layer.ensure_query_points.call_count == 1
    assert fake_bot.reply_to.call_count == 0
