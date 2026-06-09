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


def test_scan_terminal_prewarm_only_runs_for_web_service(monkeypatch):
    from web import app_factory

    monkeypatch.setenv("POLYWEATHER_SCAN_TERMINAL_PREWARM_ENABLED", "true")
    monkeypatch.delenv("POLYWEATHER_SERVICE_ROLE", raising=False)
    assert app_factory._scan_terminal_prewarm_enabled() is False

    monkeypatch.setenv("POLYWEATHER_SERVICE_ROLE", "bot")
    assert app_factory._scan_terminal_prewarm_enabled() is False

    monkeypatch.setenv("POLYWEATHER_SERVICE_ROLE", "web")
    assert app_factory._scan_terminal_prewarm_enabled() is True


def test_observation_collector_only_runs_for_collector_service(monkeypatch):
    from web import app_factory

    monkeypatch.delenv("POLYWEATHER_SERVICE_ROLE", raising=False)
    monkeypatch.delenv("POLYWEATHER_OBSERVATION_COLLECTOR_ENABLED", raising=False)
    assert app_factory._observation_collector_enabled() is False

    monkeypatch.setenv("POLYWEATHER_SERVICE_ROLE", "bot")
    assert app_factory._observation_collector_enabled() is False

    monkeypatch.setenv("POLYWEATHER_SERVICE_ROLE", "web")
    assert app_factory._observation_collector_enabled() is False

    monkeypatch.setenv("POLYWEATHER_SERVICE_ROLE", "collector")
    assert app_factory._observation_collector_enabled() is True

    monkeypatch.setenv("POLYWEATHER_OBSERVATION_COLLECTOR_ENABLED", "false")
    assert app_factory._observation_collector_enabled() is False


def test_docker_compose_isolates_collector_from_web_and_bot_services():
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    bot_block = compose.split("  polyweather:", 1)[1].split(
        "\n  polyweather_frontend:",
        1,
    )[0]
    web_block = compose.split("  polyweather_web:", 1)[1].split(
        "\n  polyweather_collector:",
        1,
    )[0]
    collector_block = compose.split("  polyweather_collector:", 1)[1].split(
        "\nx-polyweather-base:",
        1,
    )[0]

    assert "POLYWEATHER_SERVICE_ROLE: web" in compose
    assert "POLYWEATHER_SERVICE_ROLE: bot" in compose
    assert "POLYWEATHER_SERVICE_ROLE: collector" in collector_block
    assert "POLYWEATHER_SCAN_TERMINAL_PREWARM_ENABLED: 'false'" in bot_block
    assert "POLYWEATHER_SCAN_TERMINAL_PREWARM_ENABLED: 'true'" in web_block
    assert "POLYWEATHER_SCAN_TERMINAL_BUILD_TIMEOUT_SEC: '30'" in web_block
    assert "POLYWEATHER_SCAN_TERMINAL_MAX_WORKERS: '18'" in web_block
    assert "POLYWEATHER_SCAN_TERMINAL_PREWARM_ENABLED: 'false'" in collector_block
    assert "POLYWEATHER_OBSERVATION_COLLECTOR_ENABLED: 'false'" in bot_block
    assert "POLYWEATHER_OBSERVATION_COLLECTOR_ENABLED: 'false'" in web_block
    assert "POLYWEATHER_OBSERVATION_COLLECTOR_ENABLED: 'true'" in collector_block
    assert "POLYWEATHER_CITY_DETAIL_BATCH_CONCURRENCY: ${POLYWEATHER_CITY_DETAIL_BATCH_CONCURRENCY:-1}" in web_block
    assert "POLYWEATHER_CITY_DETAIL_BATCH_GLOBAL_CONCURRENCY: ${POLYWEATHER_CITY_DETAIL_BATCH_GLOBAL_CONCURRENCY:-1}" in web_block
    assert "POLYWEATHER_CITY_DETAIL_BATCH_PARTIAL_TIMEOUT_MS: ${POLYWEATHER_CITY_DETAIL_BATCH_PARTIAL_TIMEOUT_MS:-3000}" in web_block
    assert "UVICORN_WORKERS: ${UVICORN_WORKERS:-2}" in web_block
    assert "POLYWEATHER_COLLECTOR_PATCH_ENDPOINT: ''" in bot_block
    assert "POLYWEATHER_COLLECTOR_PATCH_ENDPOINT: ''" in web_block
    assert (
        "POLYWEATHER_COLLECTOR_PATCH_ENDPOINT: "
        "${POLYWEATHER_COLLECTOR_PATCH_ENDPOINT:-http://polyweather_web:8000/api/internal/collector-patch}"
        in collector_block
    )
    assert "command: python -m web.observation_collector_worker" in collector_block
    assert "POLYWEATHER_OBSERVATION_COLLECTOR_AMSC_SEC: ${POLYWEATHER_OBSERVATION_COLLECTOR_AMSC_SEC:-180}" in collector_block
    assert "POLYWEATHER_OBSERVATION_COLLECTOR_MADIS_SEC: ${POLYWEATHER_OBSERVATION_COLLECTOR_MADIS_SEC:-300}" in collector_block


def test_scan_terminal_backend_timeout_returns_before_next_proxy_abort():
    import web.services.scan_terminal_config as scan_terminal_config

    route_source = (
        ROOT / "frontend" / "app" / "api" / "scan" / "terminal" / "route.ts"
    ).read_text(encoding="utf-8")
    config_source = (
        ROOT / "web" / "services" / "scan_terminal_config.py"
    ).read_text(encoding="utf-8")

    assert 'POLYWEATHER_SCAN_TERMINAL_PROXY_TIMEOUT_MS || "35000"' in route_source
    assert '"POLYWEATHER_SCAN_TERMINAL_BUILD_TIMEOUT_SEC",\n    30,' in config_source
    assert '"POLYWEATHER_SCAN_TERMINAL_MAX_WORKERS",\n    18,' in config_source
    assert (
        '"POLYWEATHER_SCAN_TERMINAL_PREWARM_PAYLOAD_TIMEOUT_SEC",\n    30,'
        in config_source
    )
    assert scan_terminal_config.SCAN_TERMINAL_BUILD_TIMEOUT_SEC <= 30
    assert (
        scan_terminal_config.SCAN_TERMINAL_PREWARM_PAYLOAD_TIMEOUT_SEC
        >= scan_terminal_config.SCAN_TERMINAL_BUILD_TIMEOUT_SEC
    )


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
    assert 'warm_public_route "local cities recent stats" "http://127.0.0.1:8000/api/cities?refresh_deb_recent=1"' in script
    assert 'smoke_check "local cities" "http://127.0.0.1:8000/api/cities" 10 6 3' not in script
    assert 'smoke_check "frontend cities" "https://polyweather.top/api/cities" 20 5 5' in script
    assert 'smoke_check "frontend" "https://www.polyweather.top/" 15 3 5' in script


def test_deploy_script_rechecks_public_smoke_before_rollback():
    script = (ROOT / "deploy.sh").read_text(encoding="utf-8")

    assert "run_public_smoke_checks()" in script
    assert "Initial public smoke failed; retrying before rollback" in script
    assert "PUBLIC_SMOKE_RECHECK_DELAY_SEC" in script
    assert 'smoke_check "healthz recheck" "https://api.polyweather.top/healthz"' in script
    assert 'smoke_check "frontend cities recheck" "https://polyweather.top/api/cities"' in script
    assert 'smoke_check "frontend recheck" "https://www.polyweather.top/"' in script


def test_deploy_script_retries_compose_recreate_races():
    script = (ROOT / "deploy.sh").read_text(encoding="utf-8")

    assert "compose_up_retry()" in script
    assert "removal of container .* is already in progress" in script
    assert 'compose_up_retry "backend services" -d --no-deps polyweather_web polyweather' in script
    assert 'compose_up_retry "observation collector" -d --no-deps polyweather_collector' in script
    assert 'compose_up_retry "frontend" -d --no-deps polyweather_frontend' in script


def test_deploy_token_is_passed_over_stdin_not_process_args():
    script = (ROOT / "deploy.sh").read_text(encoding="utf-8")
    workflow = (ROOT / ".github" / "workflows" / "ci.yml").read_text(
        encoding="utf-8"
    )

    assert 'NEW_TAG="${1:-latest}"' in script
    assert 'GHCR_PAT="$1"' not in script
    assert "read -r GHCR_PAT" in script
    assert 'printf \'%s\' "$GHCR_PAT" | docker login' in script

    assert "GHCR_PAT: ${{ secrets.GHCR_PAT }}" in workflow
    assert 'printf \'%s\\n\' "$GHCR_PAT" | ssh' in workflow
    assert "bash /tmp/deploy.sh '${{ github.sha }}'" in workflow
    assert "bash /tmp/deploy.sh '${{ secrets.GHCR_PAT }}'" not in workflow


def test_docker_compose_keeps_polyweather_ports_on_loopback():
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")

    assert "127.0.0.1:3001:3000" in compose
    assert "127.0.0.1:8000:8000" in compose
    assert "\n    - 3001:3000" not in compose
    assert "\n    - 8000:8000" not in compose


def test_frontend_proxy_uses_internal_backend_url_not_public_site():
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    script = (ROOT / "deploy.sh").read_text(encoding="utf-8")
    frontend_block = compose.split("  polyweather_frontend:", 1)[1].split(
        "\n  polyweather_web:",
        1,
    )[0]

    assert "POLYWEATHER_API_BASE_URL: http://polyweather_web:8000" in frontend_block
    assert (
        "POLYWEATHER_API_BASE_URL: ${POLYWEATHER_API_BASE_URL:-http://polyweather_web:8000}"
        not in frontend_block
    )
    assert 'export POLYWEATHER_API_BASE_URL="${POLYWEATHER_FRONTEND_INTERNAL_API_BASE_URL:-http://polyweather_web:8000}"' in script
    assert script.index("export POLYWEATHER_API_BASE_URL=") < script.rindex(
        "validate_frontend_api_base_url"
    )


def test_web_container_raises_open_file_limit_for_sse_and_proxy_load():
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    web_block = compose.split("  polyweather_web:", 1)[1].split(
        "\nx-polyweather-base:",
        1,
    )[0]

    assert "ulimits:" in web_block
    assert "nofile:" in web_block
    assert "soft: 65535" in web_block
    assert "hard: 65535" in web_block


def test_city_detail_builds_deb_hourly_consensus_before_peak_window():
    source = (ROOT / "web" / "analysis_service.py").read_text(encoding="utf-8")

    assert "from src.analysis.deb_hourly_consensus import build_deb_hourly_consensus_path" in source
    assert "deb_hourly_consensus = build_deb_hourly_consensus_path(" in source
    assert '"hourly_consensus": deb_hourly_consensus' in source
    assert 'deb_base_source = "deb_hourly_consensus"' in source
    assert "base_source=deb_base_source" in source
