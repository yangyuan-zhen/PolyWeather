from types import SimpleNamespace
from unittest.mock import Mock

from src.bot.orchestrator import _register_handlers
from src.bot.runtime_coordinator import RuntimeStatus


class RecordingBot:
    def __init__(self):
        self.command_handlers = []

    def message_handler(self, *args, **kwargs):
        commands = kwargs.get("commands")
        if commands:
            self.command_handlers.extend(commands)

        def _decorator(func):
            return func

        return _decorator

    def chat_join_request_handler(self, *args, **kwargs):
        def _decorator(func):
            return func

        return _decorator

    def callback_query_handler(self, *args, **kwargs):
        def _decorator(func):
            return func

        return _decorator

def test_register_handlers_does_not_expose_removed_query_commands():
    bot = RecordingBot()
    io_layer = SimpleNamespace(
        build_welcome_text=Mock(return_value="WELCOME"),
        build_points_rank_text=Mock(return_value="TOP"),
        track_group_text_activity=Mock(),
    )
    startup_coordinator = SimpleNamespace(
        get_runtime_status=Mock(
            return_value=RuntimeStatus(
                started_at="2026-06-13 00:00:00 UTC",
                loops=[],
                command_access_mode="public",
                protected_commands=[],
                required_group_chat_id="",
            )
        )
    )

    _register_handlers(
        bot=bot,
        config={},
        io_layer=io_layer,
        guard=SimpleNamespace(),
        city_service=SimpleNamespace(),
        deb_service=SimpleNamespace(),
        startup_coordinator=startup_coordinator,
    )

    assert "city" not in bot.command_handlers
    assert "pwcity" not in bot.command_handlers
    assert "deb" not in bot.command_handlers
    assert "pwdeb" not in bot.command_handlers
    assert "markets" not in bot.command_handlers
