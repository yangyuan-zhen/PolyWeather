import sys
from types import SimpleNamespace

from fastapi.testclient import TestClient

from web.app import app
import web.services.telegram_webhook as telegram_webhook


client = TestClient(app)


def test_telegram_webhook_dispatches_update_when_secret_matches(monkeypatch):
    calls = []

    class FakeBot:
        def process_new_updates(self, updates):
            calls.append(updates)

    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "secret-path")
    monkeypatch.delenv("TELEGRAM_WEBHOOK_HEADER_SECRET", raising=False)
    monkeypatch.setattr(telegram_webhook, "_get_webhook_bot", lambda: FakeBot())
    monkeypatch.setattr(
        telegram_webhook,
        "_parse_update",
        lambda payload: {"update_id": payload["update_id"]},
    )

    response = client.post(
        "/api/telegram/webhook/secret-path",
        json={"update_id": 123, "message": {"text": "/start"}},
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert calls == [[{"update_id": 123}]]


def test_telegram_webhook_rejects_wrong_secret(monkeypatch):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "secret-path")

    response = client.post(
        "/api/telegram/webhook/wrong",
        json={"update_id": 123},
    )

    assert response.status_code == 403


def test_start_bot_can_run_loops_without_polling(monkeypatch):
    import src.bot.orchestrator as orchestrator
    import src.database.db_manager as db_manager
    import src.utils.config_loader as config_loader

    fake_bot = SimpleNamespace(poll_calls=0)

    def infinity_polling(**_kwargs):
        fake_bot.poll_calls += 1

    fake_bot.infinity_polling = infinity_polling
    waited = []

    class FakeCoordinator:
        def __init__(self, **_kwargs):
            pass

        def get_runtime_status(self):
            return SimpleNamespace(loops=[])

        def start_all(self):
            return SimpleNamespace(loops=[])

    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:test")
    monkeypatch.setenv("TELEGRAM_BOT_POLLING_ENABLED", "false")
    monkeypatch.setitem(
        sys.modules,
        "telebot",
        SimpleNamespace(TeleBot=lambda _token: fake_bot),
    )
    monkeypatch.setattr(orchestrator, "validate_or_raise", lambda _role: None)
    monkeypatch.setattr(config_loader, "load_config", lambda: {})
    monkeypatch.setattr(db_manager, "DBManager", lambda: object())
    monkeypatch.setattr(orchestrator, "StartupCoordinator", FakeCoordinator)
    monkeypatch.setattr(orchestrator, "_register_handlers", lambda **_kwargs: None)
    monkeypatch.setattr(orchestrator, "_wait_forever", lambda: waited.append(True), raising=False)

    orchestrator.start_bot()

    assert fake_bot.poll_calls == 0
    assert waited == [True]
