from types import SimpleNamespace

from src.bot.handlers.basic import BasicCommandHandler
from src.bot.runtime_coordinator import RuntimeStatus


class DummyBot:
    def __init__(self):
        self.replies = []

    def reply_to(self, message, text, parse_mode=None):
        self.replies.append({"text": text, "parse_mode": parse_mode, "chat_id": message.chat.id})

    def send_message(self, chat_id, text, parse_mode=None):  # pragma: no cover
        pass

    def message_handler(self, *args, **kwargs):  # pragma: no cover - decorator stub
        def _decorator(func):
            return func

        return _decorator


def _message(text: str):
    return SimpleNamespace(
        text=text,
        from_user=SimpleNamespace(id=1, username="u", first_name="U"),
        chat=SimpleNamespace(id=100),
    )


def test_basic_handler_diag_returns_html():
    runtime = RuntimeStatus(
        started_at="2026-03-12 00:00:00 UTC",
        loops=[],
        entitlement_enabled=False,
        protected_commands=["/city", "/deb"],
    )
    bot = DummyBot()
    io_layer = SimpleNamespace(
        build_welcome_text=lambda: "WELCOME",
        build_points_rank_text=lambda _user: "TOP",
    )
    handler = BasicCommandHandler(
        bot=bot,
        io_layer=io_layer,
        runtime_status_provider=lambda: runtime,
    )

    handler.handle_diag(_message("/diag"))

    assert len(bot.replies) == 1
    assert bot.replies[0]["parse_mode"] == "HTML"
    assert "Bot 启动诊断" in bot.replies[0]["text"]

