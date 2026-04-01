from types import SimpleNamespace

from src.bot.handlers.basic import BasicCommandHandler
from src.bot.runtime_coordinator import RuntimeStatus


class DummyBot:
    def __init__(self):
        self.replies = []
        self.sent_messages = []

    def reply_to(self, message, text, parse_mode=None, disable_web_page_preview=None):
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


def test_basic_handler_diag_returns_html():
    runtime = RuntimeStatus(
        started_at="2026-03-12 00:00:00 UTC",
        loops=[],
        command_access_mode="group_member",
        protected_commands=["/city", "/deb"],
        required_group_chat_id="-1001234567890",
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


def test_basic_handler_markets_returns_summary(monkeypatch):
    bot = DummyBot()
    io_layer = SimpleNamespace(
        build_welcome_text=lambda: "WELCOME",
        build_points_rank_text=lambda _user: "TOP",
    )
    handler = BasicCommandHandler(
        bot=bot,
        io_layer=io_layer,
        runtime_status_provider=lambda: RuntimeStatus(
            started_at="2026-03-12 00:00:00 UTC",
            loops=[],
            command_access_mode="group_member",
            protected_commands=["/city", "/deb"],
            required_group_chat_id="-1001234567890",
        ),
        config={},
    )

    monkeypatch.setattr(
        "src.utils.telegram_push.build_market_monitor_digest",
        lambda config, slot_label="当前概览", top_n=None, force_refresh=False: "MARKET DIGEST",
    )
    monkeypatch.setattr(
        "src.utils.telegram_push.load_cached_market_monitor_digest",
        lambda: "",
    )
    monkeypatch.setattr(
        "src.bot.handlers.basic.threading.Thread",
        lambda target, name=None, daemon=None: SimpleNamespace(start=target),
    )

    handler.handle_markets(_message("/markets"))

    assert len(bot.replies) == 1
    assert "正在生成当前市场概览" in bot.replies[0]["text"]
    assert len(bot.sent_messages) == 1
    assert bot.sent_messages[0]["text"] == "MARKET DIGEST"


def test_basic_handler_markets_rejects_channel_chat():
    bot = DummyBot()
    io_layer = SimpleNamespace(
        build_welcome_text=lambda: "WELCOME",
        build_points_rank_text=lambda _user: "TOP",
    )
    handler = BasicCommandHandler(
        bot=bot,
        io_layer=io_layer,
        runtime_status_provider=lambda: RuntimeStatus(
            started_at="2026-03-12 00:00:00 UTC",
            loops=[],
            command_access_mode="group_member",
            protected_commands=["/city", "/deb"],
            required_group_chat_id="-1001234567890",
        ),
        config={},
    )

    msg = _message("/markets")
    msg.chat = SimpleNamespace(id=-1001, type="channel")
    handler.handle_markets(msg)

    assert len(bot.replies) == 1
    assert "仅支持私聊机器人查询" in bot.replies[0]["text"]
