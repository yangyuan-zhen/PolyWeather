from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_frontend_dockerfile_uses_standalone_multistage_runtime():
    dockerfile = (ROOT / "frontend" / "Dockerfile").read_text(encoding="utf-8")
    next_config = (ROOT / "frontend" / "next.config.mjs").read_text(encoding="utf-8")

    assert 'output: "standalone"' in next_config
    assert "AS deps" in dockerfile
    assert "AS builder" in dockerfile
    assert "AS runner" in dockerfile
    assert "npm ci" in dockerfile
    assert "npm prune --omit=dev" in dockerfile or "npm ci --omit=dev" in dockerfile
    assert ".next/standalone" in dockerfile
    assert "CMD [\"node\", \"server.js\"]" in dockerfile


def test_nginx_proxy_buffers_cover_supabase_auth_cookies():
    nginx_conf = (ROOT / "deploy" / "nginx" / "polyweather.conf").read_text(
        encoding="utf-8"
    )

    assert "proxy_buffer_size 16k;" in nginx_conf
    assert "proxy_buffers 8 16k;" in nginx_conf
    assert "proxy_busy_buffers_size 32k;" in nginx_conf


def test_scan_terminal_prewarm_is_lazy_by_default():
    app_factory = (ROOT / "web" / "app_factory.py").read_text(encoding="utf-8")

    assert "POLYWEATHER_SCAN_TERMINAL_PREWARM_ENABLED" in app_factory
    assert "start_scan_terminal_prewarm()" not in app_factory.replace(
        "if _scan_terminal_prewarm_enabled():\n            start_scan_terminal_prewarm()",
        "",
    )
