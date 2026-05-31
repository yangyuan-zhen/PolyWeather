from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_auth_me_backend_records_stage_timing_without_sensitive_identity():
    source = (ROOT / "web" / "services" / "auth_api.py").read_text(encoding="utf-8")

    assert "_AuthMeTimer" in source
    assert "auth_me_timing" in source
    for stage in [
        "assert_entitlement",
        "bind_identity",
        "ensure_signup_trial",
        "subscription_window",
        "auth_points",
        "weekly_profile",
        "telegram_pricing",
        "referral_summary",
        "total",
    ]:
        assert stage in source

    log_start = source.index("def _log_auth_me_timing")
    log_end = source.index("def _require_auth_identity_without_subscription_gate")
    log_source = source[log_start:log_end]
    assert "auth_user_id" not in log_source
    assert "auth_email" not in log_source


def test_auth_me_backend_exposes_server_timing_header_for_proxy_logs():
    router_source = (ROOT / "web" / "routers" / "auth.py").read_text(
        encoding="utf-8"
    )

    assert "Response" in router_source
    assert "auth_me_server_timing" in router_source
    assert '"Server-Timing"' in router_source
