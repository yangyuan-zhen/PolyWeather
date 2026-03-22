
from fastapi.testclient import TestClient

from web.app import app
import web.routes as routes


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
    assert 'features' in payload
    assert 'integrations' in payload
    assert 'cache' in payload
    assert 'probability' in payload
    assert 'rollout' in payload['probability']
    assert payload['probability']['rollout']['decision']['decision'] in {'hold', 'observe', 'promote'}
    assert 'cities_count' in payload


def test_metrics_endpoint_returns_prometheus_payload():
    response = client.get('/metrics')
    assert response.status_code == 200
    assert 'polyweather_http_requests_total' in response.text


def test_payment_runtime_endpoint_returns_shape():
    response = client.get('/api/payments/runtime')
    assert response.status_code == 200
    payload = response.json()
    assert 'checkout' in payload
    assert 'rpc' in payload
    assert 'event_loop_state' in payload
    assert 'recent_audit_events' in payload


def test_auth_me_auto_reconciles_missing_subscription(monkeypatch):
    monkeypatch.setattr(routes, "_assert_entitlement", lambda request: None)

    def _bind_identity(request):
        request.state.auth_user_id = "user-1"
        request.state.auth_email = "user@example.com"

    monkeypatch.setattr(routes, "_bind_optional_supabase_identity", _bind_identity)
    monkeypatch.setattr(routes, "_resolve_auth_points", lambda request: 0)
    monkeypatch.setattr(routes, "_resolve_weekly_profile", lambda request: {"weekly_points": 0, "weekly_rank": None})
    monkeypatch.setattr(routes.SUPABASE_ENTITLEMENT, "enabled", True)

    calls = {"count": 0}

    def _latest_subscription(user_id, respect_requirement=False):
        calls["count"] += 1
        if calls["count"] == 1:
            return None
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
    monkeypatch.setattr(
        routes.PAYMENT_CHECKOUT,
        "reconcile_latest_intent",
        lambda user_id: {"ok": True, "action": "reconciled_confirmed_intent"},
    )

    response = client.get("/api/auth/me")

    assert response.status_code == 200
    payload = response.json()
    assert payload["subscription_active"] is True
    assert payload["subscription_plan_code"] == "pro_monthly"
