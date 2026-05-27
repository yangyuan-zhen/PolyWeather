
from fastapi.testclient import TestClient

from web.app import app
import web.routes as routes
import web.scan_terminal_cache as scan_terminal_cache
import web.scan_terminal_service as scan_terminal_service
from web.scan_terminal_cache import scan_terminal_cache_key
from src.database.runtime_state import TruthRecordRepository


client = TestClient(app)


def test_healthz_returns_ok_shape():
    response = client.get('/healthz')
    assert response.status_code == 200
    payload = response.json()
    assert payload['status'] in {'ok', 'degraded'}
    assert 'db' in payload
    assert 'state_storage_mode' in payload
    assert 'cities_count' in payload


def test_system_status_returns_summary_shape():
    response = client.get('/api/system/status')
    assert response.status_code == 200
    payload = response.json()
    assert 'db' in payload
    assert 'state_storage_mode' in payload
    assert 'features' in payload
    assert 'integrations' in payload
    assert 'cache' in payload
    assert 'analysis' in payload['cache']
    assert 'probability' in payload
    assert payload['probability']['engine_mode'] == 'legacy'
    assert 'training_data' in payload
    assert 'station_networks' in payload
    assert 'realtime' in payload
    assert payload['realtime']['store'] in {'sqlite', 'redis', 'degraded_sqlite'}
    assert 'latest_revision' in payload['realtime']
    assert 'sse_connections' in payload['realtime']
    assert 'truth_records' in payload['training_data']
    assert 'training_features' in payload['training_data']
    assert 'city_coverage' in payload['training_data']
    assert 'model_city_coverage' in payload['training_data']
    assert 'metar_entries' in payload['cache']
    assert 'cities_count' in payload


def test_metrics_endpoint_returns_prometheus_payload():
    response = client.get('/metrics')
    assert response.status_code == 200
    assert 'polyweather_http_requests_total' in response.text



def test_cities_endpoint_uses_denver_display_name_for_aurora_market():
    response = client.get("/api/cities")
    assert response.status_code == 200
    payload = response.json()
    denver = next(item for item in payload["cities"] if item["name"] == "denver")
    assert denver["display_name"] == "Denver"
    assert denver["network_provider"] == "global_metar"
    assert denver["deb_recent_tier"] in {"high", "medium", "low", "other"}
    assert "deb_recent_sample_count" in denver


def test_cities_endpoint_includes_new_wunderground_cities():
    response = client.get("/api/cities")
    assert response.status_code == 200
    payload = response.json()
    names = {item["name"] for item in payload["cities"]}
    assert {
        "busan",
        "qingdao",
        "panama city",
        "kuala lumpur",
        "jakarta",
        "helsinki",
        "amsterdam",
    }.issubset(names)


def test_payment_runtime_endpoint_returns_shape():
    response = client.get('/api/payments/runtime')
    assert response.status_code == 200
    payload = response.json()
    assert 'checkout' in payload
    assert 'rpc' in payload
    assert 'event_loop_state' in payload
    assert 'recent_audit_events' in payload


def test_auth_me_does_not_reconcile_on_status_probe(monkeypatch):
    monkeypatch.setattr(routes, "_assert_entitlement", lambda request: None)

    def _bind_identity(request):
        request.state.auth_user_id = "user-1"
        request.state.auth_email = "user@example.com"

    monkeypatch.setattr(routes, "_bind_optional_supabase_identity", _bind_identity)
    monkeypatch.setattr(routes, "_resolve_auth_points", lambda request: 0)
    monkeypatch.setattr(routes, "_resolve_weekly_profile", lambda request: {"weekly_points": 0, "weekly_rank": None})
    monkeypatch.setattr(routes.SUPABASE_ENTITLEMENT, "enabled", True)

    calls = {"count": 0}
    reconcile_calls = {"count": 0}

    def _latest_subscription(user_id, respect_requirement=False):
        calls["count"] += 1
        return {
            "plan_code": "pro_monthly",
            "starts_at": "2026-03-22T00:00:00+00:00",
            "expires_at": "2026-04-21T00:00:00+00:00",
        }

    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "get_latest_active_subscription",
        _latest_subscription,
    )
    monkeypatch.setattr(routes.PAYMENT_CHECKOUT, "enabled", True)

    def _reconcile_latest_intent(user_id):
        reconcile_calls["count"] += 1
        return {"ok": True, "action": "reconciled_confirmed_intent"}

    monkeypatch.setattr(
        routes.PAYMENT_CHECKOUT,
        "reconcile_latest_intent",
        _reconcile_latest_intent,
    )

    response = client.get("/api/auth/me")

    assert response.status_code == 200
    payload = response.json()
    assert payload["subscription_active"] is True
    assert payload["subscription_plan_code"] == "pro_monthly"
    assert reconcile_calls["count"] == 0


def test_ops_memberships_prefers_supabase_auth_email(monkeypatch):
    monkeypatch.setattr(routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(routes, "_require_ops_admin", lambda request: None)
    monkeypatch.setattr(routes.PAYMENT_CHECKOUT, "enabled", False)

    class _FakeDB:
        @staticmethod
        def get_users_by_supabase_user_ids(user_ids):
            return {
                "user-1": {
                    "supabase_email": "stale@example.com",
                    "username": "tester",
                    "telegram_id": 1,
                    "created_at": "2026-03-01T00:00:00+00:00",
                }
            }

    import src.database.db_manager as db_module

    monkeypatch.setattr(db_module, "DBManager", lambda: _FakeDB())
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "list_active_subscriptions",
        lambda limit=200: [
            {
                "user_id": "user-1",
                "plan_code": "pro_monthly",
                "starts_at": "2026-03-22T00:00:00+00:00",
                "expires_at": "2026-04-21T00:00:00+00:00",
            }
        ],
    )
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "get_auth_users",
        lambda user_ids: {
            "user-1": {
                "email": "fresh@example.com",
                "created_at": "2026-03-02T00:00:00+00:00",
            }
        },
    )
    response = client.get("/api/ops/memberships")

    assert response.status_code == 200
    payload = response.json()
    assert payload["memberships"][0]["email"] == "fresh@example.com"


def test_ops_truth_history_returns_filtered_rows(monkeypatch):
    monkeypatch.setattr(routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(routes, "_require_ops_admin", lambda request: None)

    repo = TruthRecordRepository()
    repo.upsert_truth(
        city="taipei",
        target_date="2026-04-02",
        actual_high=26.0,
        settlement_source="wunderground",
        settlement_station_code="RCSS",
        settlement_station_label="Taipei Songshan Airport Station",
        truth_version="v1",
        updated_by="test",
        source_payload={"sample": True},
        is_final=True,
    )

    response = client.get("/api/ops/truth-history?city=taipei&date_from=2026-04-01&date_to=2026-04-03&limit=10")

    assert response.status_code == 200
    payload = response.json()
    assert "items" in payload
    assert payload["filters"]["city"] == "taipei"
    assert payload["items"][0]["city"] == "taipei"


def test_scan_terminal_service_returns_stale_payload_after_failed_refresh(monkeypatch):
    filters = {"scan_mode": "tradable", "limit": 5}
    normalized_filters = scan_terminal_service._normalize_scan_terminal_filters(filters)
    scan_terminal_cache._SCAN_TERMINAL_CACHE.clear()

    monkeypatch.setattr(
        scan_terminal_service,
        "_scan_city_terminal_rows",
        lambda *_args, **_kwargs: {
            "city": "taipei",
            "rows": [
                {
                    "id": "row-1",
                    "market_key": "market-1",
                    "edge_percent": 12.4,
                    "final_score": 83.0,
                    "volume": 2000,
                }
            ],
            "candidate_total": 1,
            "primary_scores": [83.0],
        },
    )

    ready = scan_terminal_service.build_scan_terminal_payload(filters, force_refresh=True)
    assert ready["status"] == "ready"
    assert ready["rows"][0]["id"] == "row-1"

    def _explode(*_args, **_kwargs):
        raise RuntimeError("upstream 504")

    monkeypatch.setattr(scan_terminal_service, "_scan_city_terminal_rows", _explode)

    stale = scan_terminal_service.build_scan_terminal_payload(filters, force_refresh=True)

    assert stale["status"] == "stale"
    assert stale["stale"] is True
    assert stale["rows"][0]["id"] == "row-1"
    assert stale["filters"] == normalized_filters
    assert stale["stale_reason"] == "upstream 504"


def test_scan_terminal_service_returns_failed_without_success_snapshot(monkeypatch):
    filters = {"scan_mode": "tradable", "limit": 5}
    scan_terminal_cache._SCAN_TERMINAL_CACHE.clear()

    def _explode(*_args, **_kwargs):
        raise RuntimeError("network down")

    monkeypatch.setattr(scan_terminal_service, "_scan_city_terminal_rows", _explode)

    failed = scan_terminal_service.build_scan_terminal_payload(filters, force_refresh=True)

    assert failed["status"] == "failed"
    assert failed["stale"] is False
    assert failed["rows"] == []
    assert failed["summary"]["candidate_total"] == 0
    assert failed["stale_reason"] == "network down"


def test_scan_terminal_endpoint_forwards_filters(monkeypatch):
    monkeypatch.setattr(routes, "_assert_entitlement", lambda request: None)

    captured = {}

    def _fake_build_scan_terminal_payload(filters, *, force_refresh=False):
        captured["filters"] = dict(filters)
        captured["force_refresh"] = force_refresh
        return {
            "generated_at": "2026-04-23T00:00:00Z",
            "filters": filters,
            "summary": {
                "recommended_count": 1,
                "visible_count": 1,
                "candidate_total": 3,
                "avg_edge_percent": 4.2,
                "avg_primary_confidence": 88.0,
                "tradable_market_count": 1,
                "total_volume": 1500,
                "resolved_market_type": "maxtemp",
            },
            "top_signal": None,
            "rows": [],
        }

    monkeypatch.setattr(routes, "build_scan_terminal_payload", _fake_build_scan_terminal_payload)

    response = client.get(
        "/api/scan/terminal?scan_mode=trend&min_price=0.1&max_price=0.8&min_edge_pct=3"
        "&min_liquidity=700&high_liquidity_only=true&market_type=all&time_range=week&limit=12&force_refresh=true"
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["recommended_count"] == 1
    assert captured["force_refresh"] is True
    assert captured["filters"]["scan_mode"] == "trend"
    assert captured["filters"]["market_type"] == "all"
    assert captured["filters"]["time_range"] == "week"
    assert captured["filters"]["limit"] == 12


def test_scan_terminal_cache_key_includes_filter_dimensions():
    first = scan_terminal_cache_key(
        {
            "scan_mode": "tradable",
            "time_range": "today",
            "limit": 25,
        }
    )
    second = scan_terminal_cache_key(
        {
            "scan_mode": "trend",
            "time_range": "week",
            "limit": 10,
        }
    )

    assert first != second
    assert "trend" in second
    assert "week" in second
