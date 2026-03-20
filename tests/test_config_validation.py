from src.utils.config_validation import validate_runtime_env


def test_validate_runtime_env_bot_requires_telegram_token(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    report = validate_runtime_env("bot", load_env_file=False)
    assert not report.ok
    assert any("TELEGRAM_BOT_TOKEN" in err for err in report.errors)


def test_validate_runtime_env_web_auth_requires_supabase(monkeypatch):
    monkeypatch.setenv("POLYWEATHER_AUTH_ENABLED", "true")
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)

    report = validate_runtime_env("web", load_env_file=False)

    assert not report.ok
    assert any("SUPABASE_URL" in err for err in report.errors)


def test_validate_runtime_env_payment_requires_receiver_or_tokens(monkeypatch):
    monkeypatch.setenv("POLYWEATHER_PAYMENT_ENABLED", "true")
    monkeypatch.setenv("POLYWEATHER_PAYMENT_RPC_URL", "https://polygon-rpc.com")
    monkeypatch.delenv("POLYWEATHER_PAYMENT_RECEIVER_CONTRACT", raising=False)
    monkeypatch.delenv("POLYWEATHER_PAYMENT_ACCEPTED_TOKENS_JSON", raising=False)

    report = validate_runtime_env("web", load_env_file=False)

    assert not report.ok
    assert any("POLYWEATHER_PAYMENT_RECEIVER_CONTRACT" in err for err in report.errors)
