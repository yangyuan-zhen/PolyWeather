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


def test_scan_terminal_backend_timeout_returns_before_next_proxy_abort():
    import web.services.scan_terminal_config as scan_terminal_config

    route_source = (
        ROOT / "frontend" / "app" / "api" / "scan" / "terminal" / "route.ts"
    ).read_text(encoding="utf-8")

    assert 'POLYWEATHER_SCAN_TERMINAL_PROXY_TIMEOUT_MS || "40000"' in route_source
    assert scan_terminal_config.SCAN_TERMINAL_BUILD_TIMEOUT_SEC <= 30


def test_probability_engine_uses_enriched_multi_model_snapshot():
    source = (ROOT / "web" / "analysis_service.py").read_text(encoding="utf-8")

    assert 'raw["multi_model"] = mm' in source


def test_city_detail_peak_window_uses_shared_multi_model_resolver():
    source = (ROOT / "web" / "analysis_service.py").read_text(encoding="utf-8")

    assert "from src.analysis.trend_engine import _resolve_peak_hours" in source
    assert "peak_hours = _resolve_peak_hours(" in source


def test_deploy_script_retries_image_pull_for_registry_propagation():
    script = (ROOT / "deploy.sh").read_text(encoding="utf-8")

    assert "for pull_attempt in $(seq 1 6)" in script
    assert "docker compose pull && pull_ok=1 && break" in script


def test_deploy_script_retries_startup_smoke_checks():
    script = (ROOT / "deploy.sh").read_text(encoding="utf-8")

    assert "smoke_check()" in script
    assert 'smoke_check "healthz" "https://api.polyweather.top/healthz" 15 3 5' in script
    assert 'smoke_check "local cities" "http://127.0.0.1:8000/api/cities" 10 6 3' in script
    assert 'smoke_check "frontend cities" "https://polyweather.top/api/cities" 20 5 5' in script
    assert 'smoke_check "frontend" "https://www.polyweather.top/" 15 3 5' in script


def test_city_detail_builds_deb_hourly_consensus_before_peak_window():
    source = (ROOT / "web" / "analysis_service.py").read_text(encoding="utf-8")

    assert "from src.analysis.deb_hourly_consensus import build_deb_hourly_consensus_path" in source
    assert "deb_hourly_consensus = build_deb_hourly_consensus_path(" in source
    assert '"hourly_consensus": deb_hourly_consensus' in source
    assert 'deb_base_source = "deb_hourly_consensus"' in source
    assert "base_source=deb_base_source" in source
