from types import SimpleNamespace
from unittest.mock import Mock

from src.bot.command_guard import CommandGuard
from src.bot.services.entitlement_service import BotEntitlementService


class _FakeDB:
    def __init__(self, user):
        self._user = user

    def get_user(self, _user_id):
        return self._user


def _message():
    return SimpleNamespace(
        from_user=SimpleNamespace(id=123, username="tester", first_name="Tester"),
        chat=SimpleNamespace(id=999),
    )


def test_guard_blocks_non_premium_when_entitlement_enabled():
    fake_bot = SimpleNamespace(reply_to=Mock())
    io_layer = SimpleNamespace(bot=fake_bot, ensure_query_points=Mock(return_value=True))
    entitlement = BotEntitlementService(db=_FakeDB(user=None), enabled=True)
    guard = CommandGuard(io_layer=io_layer, entitlement_service=entitlement)

    ok = guard.ensure_access_and_points(_message(), 1, "/city")

    assert ok is False
    assert io_layer.ensure_query_points.call_count == 0
    assert fake_bot.reply_to.call_count == 1


def test_guard_allows_premium_then_charges_points():
    fake_bot = SimpleNamespace(reply_to=Mock())
    io_layer = SimpleNamespace(bot=fake_bot, ensure_query_points=Mock(return_value=True))
    entitlement = BotEntitlementService(
        db=_FakeDB(user={"is_web_premium": 1, "is_group_premium": 0}),
        enabled=True,
    )
    guard = CommandGuard(io_layer=io_layer, entitlement_service=entitlement)

    ok = guard.ensure_access_and_points(_message(), 1, "/city")

    assert ok is True
    assert io_layer.ensure_query_points.call_count == 1
    assert fake_bot.reply_to.call_count == 0

