from types import SimpleNamespace

from src.bot.handlers.basic import BasicCommandHandler
from src.bot.runtime_coordinator import RuntimeStatus


class DummyBot:
    def __init__(self):
        self.replies = []
        self.sent_messages = []

    def reply_to(self, message, text, parse_mode=None, disable_web_page_preview=None, **kwargs):
        self.replies.append(
            {
                "text": text,
                "parse_mode": parse_mode,
                "chat_id": message.chat.id,
                "disable_web_page_preview": disable_web_page_preview,
            }
        )

    def send_message(
        self,
        chat_id,
        text,
        parse_mode=None,
        disable_web_page_preview=None,
    ):  # pragma: no cover
        self.sent_messages.append(
            {
                "chat_id": chat_id,
                "text": text,
                "parse_mode": parse_mode,
                "disable_web_page_preview": disable_web_page_preview,
            }
        )

    def message_handler(self, *args, **kwargs):  # pragma: no cover - decorator stub
        def _decorator(func):
            return func

        return _decorator


def _message(text: str):
    return SimpleNamespace(
        text=text,
        from_user=SimpleNamespace(id=1, username="u", first_name="U"),
        chat=SimpleNamespace(id=100, type="private"),
    )


def _handler(bot):
    return BasicCommandHandler(
        bot=bot,
        io_layer=SimpleNamespace(
            build_welcome_text=lambda: "WELCOME",
            build_points_rank_text=lambda _user: "TOP",
        ),
        runtime_status_provider=lambda: RuntimeStatus(
            started_at="2026-03-12 00:00:00 UTC",
            loops=[],
        ),
    )


def test_basic_handler_diag_returns_html():
    bot = DummyBot()
    handler = _handler(bot)

    handler.handle_diag(_message("/diag"))

    assert len(bot.replies) == 1
    assert bot.replies[0]["parse_mode"] == "HTML"
    assert "Bot 启动诊断" in bot.replies[0]["text"]


def test_private_text_fallback_replies_with_help():
    bot = DummyBot()
    handler = _handler(bot)

    result = handler.handle_private_text_fallback(_message("@polyyuanbot"))

    assert result == "replied"
    assert len(bot.replies) == 1
    assert "/help" in bot.replies[0]["text"]


def test_private_text_fallback_ignores_slash_commands():
    bot = DummyBot()
    handler = _handler(bot)

    result = handler.handle_private_text_fallback(_message("/city seoul"))

    assert result == "ignored:slash_command"
    assert bot.replies == []


def test_basic_handler_ignores_removed_markets_command():
    bot = DummyBot()
    handler = _handler(bot)

    handler._dispatch(_message("/markets"))

    assert bot.replies == []
    assert bot.sent_messages == []
