from src.bot.runtime_coordinator import RuntimeStatus, StartupCoordinator, render_runtime_status_html


class DummyBot:
    pass


def test_startup_coordinator_respects_disable_flags(monkeypatch):
    monkeypatch.setenv("TELEGRAM_ALERT_PUSH_ENABLED", "false")
    monkeypatch.setenv("POLYGON_WALLET_WATCH_ENABLED", "false")
    monkeypatch.setenv("POLYMARKET_WALLET_ACTIVITY_ENABLED", "false")
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)

    coordinator = StartupCoordinator(
        bot=DummyBot(),
        config={},
        entitlement_enabled=False,
        protected_commands=["/city", "/deb"],
    )
    runtime = coordinator.start_all()
    loop_map = runtime.loop_map()

    assert loop_map["trade_alert_push"].configured_enabled is False
    assert loop_map["trade_alert_push"].started is False
    assert loop_map["trade_alert_push"].reason == "disabled_by_env"
    assert loop_map["polygon_wallet_watch"].reason == "disabled_by_env"
    assert loop_map["polymarket_wallet_activity"].reason == "disabled_by_env"


def test_render_runtime_status_html_contains_key_fields():
    runtime = RuntimeStatus(
        started_at="2026-03-12 00:00:00 UTC",
        entitlement_enabled=True,
        protected_commands=["/city", "/deb"],
        loops=[],
    )
    html = render_runtime_status_html(runtime)

    assert "Bot 启动诊断" in html
    assert "Entitlement" in html
    assert "/city, /deb" in html

