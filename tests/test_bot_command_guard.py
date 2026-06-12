from types import SimpleNamespace
from unittest.mock import Mock

from src.bot.command_guard import CommandGuard
from src.bot.services.entitlement_service import BotEntitlementService


def _message():
    return SimpleNamespace(
        from_user=SimpleNamespace(id=123, username="tester", first_name="Tester"),
        chat=SimpleNamespace(id=999),
    )


def test_guard_charges_points():
    fake_bot = SimpleNamespace(
        reply_to=Mock(),
        get_chat_member=Mock(return_value=SimpleNamespace(status="member")),
    )
    io_layer = SimpleNamespace(bot=fake_bot, ensure_query_points=Mock(return_value=True))
    guard = CommandGuard(io_layer=io_layer, group_chat_id="-100123")

    ok = guard.ensure_access_and_points(_message(), 1, "/top")

    assert ok is True
    assert io_layer.ensure_query_points.call_count == 1
    assert fake_bot.reply_to.call_count == 0


def test_entitlement_service_has_no_removed_protected_commands_by_default(monkeypatch):
    monkeypatch.setenv("POLYWEATHER_BOT_USE_SUPABASE_ENTITLEMENT", "false")
    db = SimpleNamespace(get_user=lambda _user_id: {})
    service = BotEntitlementService(db=db, enabled=True)

    decision = service.check(123, "/city")

    assert service.protected_commands == set()
    assert decision.allowed is True
    assert decision.reason == "command_not_protected"
