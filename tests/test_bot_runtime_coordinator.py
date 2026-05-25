from src.bot.runtime_coordinator import RuntimeStatus, StartupCoordinator, render_runtime_status_html


class DummyBot:
    pass


def test_startup_coordinator_respects_disable_flags(monkeypatch):
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)

    coordinator = StartupCoordinator(
        bot=DummyBot(),
        config={},
        command_access_mode="group_member",
        protected_commands=["/city", "/deb"],
        required_group_chat_id="-1001234567890",
    )
    runtime = coordinator.start_all()
    loop_map = runtime.loop_map()

    assert "weekly_reward" in loop_map
    assert "polygon_wallet_watch" not in loop_map


def test_render_runtime_status_html_contains_key_fields():
    runtime = RuntimeStatus(
        started_at="2026-03-12 00:00:00 UTC",
        command_access_mode="group_member",
        protected_commands=["/city", "/deb"],
        required_group_chat_id="-1001234567890",
        loops=[],
    )
    html = render_runtime_status_html(runtime)

    assert "Bot 启动诊断" in html
    assert "命令准入" in html
    assert "/city, /deb" in html
