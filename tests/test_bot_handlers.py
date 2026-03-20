from types import SimpleNamespace
from unittest.mock import Mock

from src.bot.handlers.city import CityCommandHandler
from src.bot.handlers.deb import DebCommandHandler
from src.bot.services.city_command_service import CityReportResult, CityResolveResult
from src.bot.services.deb_command_service import DebReportResult


def _message(text: str):
    return SimpleNamespace(
        text=text,
        from_user=SimpleNamespace(id=123, username="tester", first_name="Tester"),
        chat=SimpleNamespace(id=999),
        entities=[],
    )


def test_city_handler_missing_city_shows_usage():
    bot = SimpleNamespace()
    guard = SimpleNamespace(ensure_access_and_points=Mock(return_value=True))
    city_service = SimpleNamespace(resolve_city=Mock(), build_report=Mock())
    io_layer = SimpleNamespace(send_query_message=Mock())
    handler = CityCommandHandler(
        bot=bot,
        guard=guard,
        city_service=city_service,
        io_layer=io_layer,
    )

    handler.handle(_message("/city"))

    assert io_layer.send_query_message.call_count == 1
    assert "请输入城市名称" in io_layer.send_query_message.call_args[0][1]
    assert guard.ensure_access_and_points.call_count == 0


def test_city_handler_happy_path_pushes_progress_and_report():
    bot = SimpleNamespace()
    guard = SimpleNamespace(ensure_access_and_points=Mock(return_value=True))
    city_service = SimpleNamespace(
        resolve_city=Mock(
            return_value=CityResolveResult(
                ok=True,
                city_name="london",
                supported_cities=["london"],
            )
        ),
        build_report=Mock(return_value=CityReportResult(ok=True, report="CITY_REPORT")),
    )
    io_layer = SimpleNamespace(send_query_message=Mock())
    handler = CityCommandHandler(
        bot=bot,
        guard=guard,
        city_service=city_service,
        io_layer=io_layer,
    )

    handler.handle(_message("/city london"))

    assert io_layer.send_query_message.call_count == 2
    first_call = io_layer.send_query_message.call_args_list[0]
    second_call = io_layer.send_query_message.call_args_list[1]
    assert "正在查询 London 的天气数据" in first_call.args[1]
    assert second_call.args[1] == "CITY_REPORT"
    assert second_call.kwargs["parse_mode"] == "HTML"


def test_deb_handler_history_missing_returns_hint():
    bot = SimpleNamespace()
    guard = SimpleNamespace(ensure_access_and_points=Mock(return_value=True))
    deb_service = SimpleNamespace(
        resolve_city=Mock(return_value="ankara"),
        has_history=Mock(return_value=False),
        build_report=Mock(return_value=DebReportResult(ok=True, report="DEB_REPORT")),
    )
    io_layer = SimpleNamespace(send_query_message=Mock())
    handler = DebCommandHandler(
        bot=bot,
        guard=guard,
        deb_service=deb_service,
        io_layer=io_layer,
    )

    handler.handle(_message("/deb ankara"))

    assert io_layer.send_query_message.call_count == 1
    assert "暂无 ankara 的历史数据" in io_layer.send_query_message.call_args[0][1]
    assert guard.ensure_access_and_points.call_count == 0
