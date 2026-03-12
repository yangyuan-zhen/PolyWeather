from types import SimpleNamespace
from unittest.mock import Mock

from src.bot.handlers.city import CityCommandHandler
from src.bot.handlers.deb import DebCommandHandler
from src.bot.services.city_command_service import CityReportResult, CityResolveResult
from src.bot.services.deb_command_service import DebReportResult


class DummyBot:
    def __init__(self):
        self.replies = []
        self.sent = []

    def reply_to(self, message, text, parse_mode=None):
        self.replies.append(
            {
                "chat_id": message.chat.id,
                "text": text,
                "parse_mode": parse_mode,
            }
        )

    def send_message(self, chat_id, text, parse_mode=None):
        self.sent.append(
            {
                "chat_id": chat_id,
                "text": text,
                "parse_mode": parse_mode,
            }
        )

    def message_handler(self, *args, **kwargs):  # pragma: no cover - decorator stub
        def _decorator(func):
            return func

        return _decorator


def _message(text: str):
    return SimpleNamespace(
        text=text,
        from_user=SimpleNamespace(id=123, username="tester", first_name="Tester"),
        chat=SimpleNamespace(id=999),
    )


def test_city_handler_missing_city_shows_usage():
    bot = DummyBot()
    guard = SimpleNamespace(ensure_access_and_points=Mock(return_value=True))
    city_service = SimpleNamespace(
        resolve_city=Mock(),
        build_report=Mock(),
    )
    handler = CityCommandHandler(bot=bot, guard=guard, city_service=city_service)

    handler.handle(_message("/city"))

    assert len(bot.replies) == 1
    assert "请输入城市名称" in bot.replies[0]["text"]
    assert guard.ensure_access_and_points.call_count == 0


def test_city_handler_happy_path_pushes_progress_and_report():
    bot = DummyBot()
    guard = SimpleNamespace(ensure_access_and_points=Mock(return_value=True))
    city_service = SimpleNamespace(
        resolve_city=Mock(
            return_value=CityResolveResult(ok=True, city_name="london", supported_cities=["london"])
        ),
        build_report=Mock(return_value=CityReportResult(ok=True, report="CITY_REPORT")),
    )
    handler = CityCommandHandler(bot=bot, guard=guard, city_service=city_service)

    handler.handle(_message("/city london"))

    assert len(bot.sent) == 2
    assert "正在查询 London 的天气数据" in bot.sent[0]["text"]
    assert bot.sent[1]["text"] == "CITY_REPORT"
    assert bot.sent[1]["parse_mode"] == "HTML"


def test_deb_handler_history_missing_returns_hint():
    bot = DummyBot()
    guard = SimpleNamespace(ensure_access_and_points=Mock(return_value=True))
    deb_service = SimpleNamespace(
        resolve_city=Mock(return_value="ankara"),
        has_history=Mock(return_value=False),
        build_report=Mock(return_value=DebReportResult(ok=True, report="DEB_REPORT")),
    )
    handler = DebCommandHandler(bot=bot, guard=guard, deb_service=deb_service)

    handler.handle(_message("/deb ankara"))

    assert len(bot.replies) == 1
    assert "暂无 ankara 的历史数据" in bot.replies[0]["text"]
    assert guard.ensure_access_and_points.call_count == 0

