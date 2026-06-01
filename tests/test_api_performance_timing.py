from pathlib import Path

from fastapi.testclient import TestClient

from web.app import app
import web.services.city_api as city_api
import web.services.scan_api as scan_api


ROOT = Path(__file__).resolve().parents[1]
client = TestClient(app)


def test_backend_shared_timing_helper_avoids_sensitive_identity_fields():
    source = (ROOT / "web" / "services" / "request_timing.py").read_text(
        encoding="utf-8"
    )

    assert "ServerTimingRecorder" in source
    assert "server_timing_value" in source
    assert "user_id" not in source
    assert "email" not in source


def test_city_detail_batch_response_includes_backend_server_timing(monkeypatch):
    city_api._CITY_DETAIL_BATCH_RESPONSE_CACHE.clear()
    city_api._CITY_DETAIL_BATCH_RESPONSE_CACHE_TS.clear()
    city_api._CITY_DETAIL_BATCH_RESPONSE_INFLIGHT.clear()

    class FakeCache:
        def get_city_cache(self, kind, city):
            assert kind == "full"
            return {"payload": {"city": city, "hourly": {"times": [], "temps": []}}}

    def build_detail(data, market_slug, target_date, resolution):
        return {"city": data["city"], "resolution": resolution}

    monkeypatch.setattr(city_api.legacy_routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(
        city_api.legacy_routes,
        "_normalize_city_or_404",
        lambda name: name.strip().lower(),
    )
    monkeypatch.setattr(city_api.legacy_routes, "_city_cache_is_fresh", lambda entry, ttl: True)
    monkeypatch.setattr(
        city_api.legacy_routes,
        "_overlay_latest_wunderground_current",
        lambda city, payload: payload,
    )
    monkeypatch.setattr(city_api.legacy_routes, "_CACHE_DB", FakeCache())
    monkeypatch.setattr(city_api.legacy_routes, "_build_city_detail_payload", build_detail)

    response = client.get("/api/cities/detail-batch?cities=Paris&resolution=10m")

    assert response.status_code == 200
    server_timing = response.headers["server-timing"]
    assert "city_detail_batch_assert_entitlement" in server_timing
    assert "city_detail_batch_full_data_paris" in server_timing
    assert "city_detail_batch_detail_payload_paris" in server_timing
    assert "city_detail_batch_total" in server_timing


def test_city_detail_response_includes_backend_server_timing(monkeypatch):
    class FakeCache:
        def get_city_cache(self, kind, city):
            assert kind == "full"
            return {"payload": {"city": city, "hourly": {"times": [], "temps": []}}}

    def build_detail(data, market_slug, target_date, resolution):
        return {"city": data["city"], "resolution": resolution}

    monkeypatch.setattr(city_api.legacy_routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(
        city_api.legacy_routes,
        "_normalize_city_or_404",
        lambda name: name.strip().lower(),
    )
    monkeypatch.setattr(city_api.legacy_routes, "_city_cache_is_fresh", lambda entry, ttl: True)
    monkeypatch.setattr(
        city_api.legacy_routes,
        "_overlay_latest_wunderground_current",
        lambda city, payload: payload,
    )
    monkeypatch.setattr(city_api.legacy_routes, "_CACHE_DB", FakeCache())
    monkeypatch.setattr(city_api.legacy_routes, "_build_city_detail_payload", build_detail)

    response = client.get("/api/city/Paris/detail?resolution=10m")

    assert response.status_code == 200
    server_timing = response.headers["server-timing"]
    assert "city_detail_assert_entitlement" in server_timing
    assert "city_detail_full_data" in server_timing
    assert "city_detail_detail_payload" in server_timing
    assert "city_detail_total" in server_timing


def test_scan_terminal_response_includes_backend_server_timing(monkeypatch):
    monkeypatch.setattr(scan_api.legacy_routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(
        scan_api.legacy_routes,
        "build_scan_terminal_payload",
        lambda filters, force_refresh=False, timing_recorder=None: {"rows": [], "filters": filters},
    )

    response = client.get("/api/scan/terminal?limit=1")

    assert response.status_code == 200
    server_timing = response.headers["server-timing"]
    assert "scan_terminal_assert_entitlement" in server_timing
    assert "scan_terminal_build_payload" in server_timing
    assert "scan_terminal_total" in server_timing


def test_online_users_response_includes_backend_server_timing():
    response = client.get("/api/ops/online-users")

    assert response.status_code == 200
    server_timing = response.headers["server-timing"]
    assert "ops_online_users_online_count" in server_timing
    assert "ops_online_users_total" in server_timing
