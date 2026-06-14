from __future__ import annotations

import asyncio
from types import SimpleNamespace


def _sample_panel_payload() -> dict:
    return {
        "name": "shanghai",
        "temp_symbol": "°C",
        "updated_at": "2026-06-14T01:02:03+00:00",
        "current": {
            "temp": 31.2,
            "source_code": "amsc_awos",
            "settlement_source": "amsc_awos",
            "settlement_source_label": "AMSC AWOS runway-point air temperature",
            "station_code": "ZSPD",
            "station_name": "Shanghai Pudong",
            "observed_at": "2026-06-14T01:01:00+00:00",
            "obs_time": "09:01",
            "freshness": {
                "freshness_status": "fresh",
                "age_sec": 63,
                "observed_at": "2026-06-14T01:01:00+00:00",
                "observed_at_local": "09:01",
            },
        },
    }


def test_db_manager_stores_canonical_temperature_latest(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "polyweather.db"))
    canonical = {
        "city": "shanghai",
        "value": 31.2,
        "source": "amsc_awos",
        "source_role": "settlement_proxy",
        "observed_at": "2026-06-14T01:01:00+00:00",
        "fetched_at": "2026-06-14T01:02:03+00:00",
        "freshness_sec": 63,
        "freshness_status": "fresh",
        "confidence": 0.92,
        "explanation": "AMSC AWOS runway-point air temperature updated 63s ago.",
    }

    db.set_canonical_temperature("Shanghai", canonical)

    row = db.get_canonical_temperature("shanghai")
    assert row is not None
    assert row["city"] == "shanghai"
    assert row["value"] == 31.2
    assert row["source"] == "amsc_awos"
    assert row["source_role"] == "settlement_proxy"
    assert row["freshness_status"] == "fresh"
    assert row["payload"]["observed_at"] == "2026-06-14T01:01:00+00:00"


def test_refresh_city_panel_cache_persists_canonical_temperature(monkeypatch):
    import web.services.city_runtime as city_runtime

    writes = {}

    class FakeDB:
        def set_city_cache(self, kind, city, payload, **_kwargs):
            writes["city_cache"] = (kind, city, payload)

        def set_canonical_temperature(self, city, payload):
            writes["canonical"] = (city, payload)

    monkeypatch.setattr(city_runtime, "_CACHE_DB", FakeDB())
    monkeypatch.setattr(
        city_runtime,
        "_analyze",
        lambda city, force_refresh=False, detail_mode="panel": _sample_panel_payload(),
    )

    payload = city_runtime._refresh_city_panel_cache("shanghai")

    assert payload["canonical_temperature"]["value"] == 31.2
    assert payload["canonical_temperature"]["source"] == "amsc_awos"
    assert payload["canonical_temperature"]["freshness_sec"] == 63
    assert payload["canonical_temperature"]["source_role"] == "settlement_proxy"
    assert writes["canonical"][0] == "shanghai"
    assert writes["canonical"][1]["observed_at"] == "2026-06-14T01:01:00+00:00"


def test_city_panel_cold_cache_returns_canonical_latest_without_sync_refresh(monkeypatch):
    import web.services.city_api as city_api

    started = []

    class FakeDB:
        def get_city_cache(self, kind, city):
            assert kind == "panel"
            assert city == "shanghai"
            return None

        def get_canonical_temperature(self, city):
            assert city == "shanghai"
            return {
                "payload": {
                    "city": "shanghai",
                    "value": 31.2,
                    "temp_symbol": "°C",
                    "source": "amsc_awos",
                    "source_label": "AMSC AWOS runway-point air temperature",
                    "source_role": "settlement_proxy",
                    "observed_at": "2026-06-14T01:01:00+00:00",
                    "observed_at_local": "09:01",
                    "freshness_sec": 63,
                    "freshness_status": "fresh",
                    "fetched_at": "2026-06-14T01:02:03+00:00",
                    "confidence": 0.92,
                }
            }

    def fail_refresh(*_args, **_kwargs):
        raise AssertionError("cold panel cache must not synchronously refresh when canonical latest exists")

    monkeypatch.setattr(city_api.legacy_routes, "_normalize_city_or_404", lambda name: name.strip().lower())
    monkeypatch.setattr(city_api.legacy_routes, "_CACHE_DB", FakeDB())
    monkeypatch.setattr(city_api.legacy_routes, "_refresh_city_panel_cache", fail_refresh)
    monkeypatch.setattr(
        city_api,
        "_start_city_cache_stale_refresh",
        lambda city, kind, refresh_fn: started.append((city, kind, refresh_fn)),
    )

    payload = asyncio.run(
        city_api.get_city_detail_payload(
            object(),
            "Shanghai",
            force_refresh=False,
            depth="panel",
        )
    )

    assert payload["current"]["temp"] == 31.2
    assert payload["canonical_temperature"]["source"] == "amsc_awos"
    assert payload["detail_depth"] == "panel"
    assert [(city, kind) for city, kind, _ in started] == [("shanghai", "panel")]


def test_city_full_cold_cache_returns_canonical_latest_without_sync_refresh(monkeypatch):
    import web.services.city_api as city_api

    started = []

    class FakeDB:
        def get_city_cache(self, kind, city):
            assert kind == "full"
            assert city == "shanghai"
            return None

        def get_canonical_temperature(self, city):
            assert city == "shanghai"
            return {
                "payload": {
                    "city": "shanghai",
                    "value": 31.2,
                    "temp_symbol": "°C",
                    "source": "amsc_awos",
                    "source_label": "AMSC AWOS runway-point air temperature",
                    "source_role": "settlement_proxy",
                    "observed_at": "2026-06-14T01:01:00+00:00",
                    "observed_at_local": "09:01",
                    "freshness_sec": 63,
                    "freshness_status": "fresh",
                    "fetched_at": "2026-06-14T01:02:03+00:00",
                    "confidence": 0.92,
                }
            }

    def fail_refresh(*_args, **_kwargs):
        raise AssertionError("cold full cache must not synchronously refresh when canonical latest exists")

    monkeypatch.setattr(city_api.legacy_routes, "_CACHE_DB", FakeDB())
    monkeypatch.setattr(city_api.legacy_routes, "_refresh_city_full_cache", fail_refresh)
    monkeypatch.setattr(city_api, "_start_city_full_stale_refresh", lambda city: started.append(city))

    payload = asyncio.run(city_api._get_city_full_data("shanghai", force_refresh=False))

    assert payload["current"]["temp"] == 31.2
    assert payload["canonical_temperature"]["source"] == "amsc_awos"
    assert payload["detail_depth"] == "full"
    assert started == ["shanghai"]


def test_city_nearby_and_market_cold_cache_return_canonical_latest_without_sync_refresh(monkeypatch):
    import web.services.city_api as city_api

    started = []
    requested_kinds = []

    class FakeDB:
        def get_city_cache(self, kind, city):
            requested_kinds.append((kind, city))
            return None

        def get_canonical_temperature(self, city):
            assert city == "shanghai"
            return {
                "payload": {
                    "city": "shanghai",
                    "value": 31.2,
                    "temp_symbol": "°C",
                    "source": "amsc_awos",
                    "source_label": "AMSC AWOS runway-point air temperature",
                    "source_role": "settlement_proxy",
                    "observed_at": "2026-06-14T01:01:00+00:00",
                    "observed_at_local": "09:01",
                    "freshness_sec": 63,
                    "freshness_status": "fresh",
                    "fetched_at": "2026-06-14T01:02:03+00:00",
                    "confidence": 0.92,
                }
            }

    def fail_refresh(*_args, **_kwargs):
        raise AssertionError("cold city cache must not synchronously refresh when canonical latest exists")

    monkeypatch.setattr(city_api.legacy_routes, "_normalize_city_or_404", lambda name: name.strip().lower())
    monkeypatch.setattr(city_api.legacy_routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(city_api.legacy_routes, "_CACHE_DB", FakeDB())
    monkeypatch.setattr(city_api.legacy_routes, "_refresh_city_nearby_cache", fail_refresh)
    monkeypatch.setattr(city_api.legacy_routes, "_refresh_city_market_cache", fail_refresh)
    monkeypatch.setattr(
        city_api,
        "_start_city_cache_stale_refresh",
        lambda city, kind, refresh_fn: started.append((city, kind, refresh_fn)),
    )

    nearby = asyncio.run(
        city_api.get_city_detail_payload(object(), "Shanghai", force_refresh=False, depth="nearby")
    )
    market = asyncio.run(
        city_api.get_city_detail_payload(object(), "Shanghai", force_refresh=False, depth="market")
    )

    assert nearby["detail_depth"] == "nearby"
    assert market["detail_depth"] == "market"
    assert nearby["current"]["temp"] == 31.2
    assert market["current"]["temp"] == 31.2
    assert [(city, kind) for city, kind, _ in started] == [
        ("shanghai", "nearby"),
        ("shanghai", "market"),
    ]
    assert requested_kinds == [("nearby", "shanghai"), ("market", "shanghai")]


def test_force_refresh_panel_returns_canonical_latest_without_waiting_for_sync_refresh(monkeypatch):
    import web.services.city_api as city_api

    class FakeDB:
        def get_city_cache(self, kind, city):
            assert kind == "panel"
            assert city == "shanghai"
            return None

        def get_canonical_temperature(self, city):
            assert city == "shanghai"
            return {
                "payload": {
                    "city": "shanghai",
                    "value": 31.2,
                    "temp_symbol": "°C",
                    "source": "amsc_awos",
                    "source_label": "AMSC AWOS runway-point air temperature",
                    "source_role": "settlement_proxy",
                    "observed_at": "2026-06-14T01:01:00+00:00",
                    "observed_at_local": "09:01",
                    "freshness_sec": 63,
                    "freshness_status": "fresh",
                    "fetched_at": "2026-06-14T01:02:03+00:00",
                    "confidence": 0.92,
                }
            }

    def fail_refresh(*_args, **_kwargs):
        raise AssertionError("force refresh must not block on sync refresh when canonical latest exists")

    city_api._CITY_FORCE_REFRESH_INFLIGHT.clear()
    monkeypatch.setattr(city_api.legacy_routes, "_normalize_city_or_404", lambda name: name.strip().lower())
    monkeypatch.setattr(city_api.legacy_routes, "_CACHE_DB", FakeDB())
    monkeypatch.setattr(city_api.legacy_routes, "_refresh_city_panel_cache", fail_refresh)

    payload = asyncio.run(
        city_api.get_city_detail_payload(
            object(),
            "Shanghai",
            force_refresh=True,
            depth="panel",
        )
    )

    assert payload["current"]["temp"] == 31.2
    assert payload["canonical_temperature"]["source"] == "amsc_awos"
    assert payload["detail_depth"] == "panel"


def test_city_panel_canonical_fallback_enqueues_collector_refresh_when_queue_exists(monkeypatch):
    import web.services.city_api as city_api

    enqueued = []

    class FakeDB:
        def get_city_cache(self, kind, city):
            assert kind == "panel"
            assert city == "shanghai"
            return None

        def get_canonical_temperature(self, city):
            assert city == "shanghai"
            return {
                "payload": {
                    "city": "shanghai",
                    "value": 31.2,
                    "temp_symbol": "°C",
                    "source": "amsc_awos",
                    "source_label": "AMSC AWOS runway-point air temperature",
                    "source_role": "settlement_proxy",
                    "observed_at": "2026-06-14T01:01:00+00:00",
                    "observed_at_local": "09:01",
                    "freshness_sec": 63,
                    "freshness_status": "fresh",
                    "fetched_at": "2026-06-14T01:02:03+00:00",
                    "confidence": 0.92,
                }
            }

        def enqueue_observation_refresh_request(self, **kwargs):
            enqueued.append(kwargs)
            return True

    def fail_start(*_args, **_kwargs):
        raise AssertionError("canonical fallback should enqueue collector refresh instead of direct stale refresh")

    monkeypatch.setattr(city_api.legacy_routes, "_normalize_city_or_404", lambda name: name.strip().lower())
    monkeypatch.setattr(city_api.legacy_routes, "_CACHE_DB", FakeDB())
    monkeypatch.setattr(city_api, "_start_city_cache_stale_refresh", fail_start)

    payload = asyncio.run(
        city_api.get_city_detail_payload(
            object(),
            "Shanghai",
            force_refresh=False,
            depth="panel",
        )
    )

    assert payload["current"]["temp"] == 31.2
    assert enqueued == [
        {
            "city": "shanghai",
            "kind": "panel",
            "priority": "high",
            "reason": "canonical_fallback",
        }
    ]


def test_city_panel_cold_start_without_canonical_returns_initializing_payload(monkeypatch):
    import web.services.city_api as city_api

    enqueued = []

    class FakeDB:
        def get_city_cache(self, kind, city):
            assert kind == "panel"
            assert city == "shanghai"
            return None

        def get_canonical_temperature(self, city):
            assert city == "shanghai"
            return None

        def enqueue_observation_refresh_request(self, **kwargs):
            enqueued.append(kwargs)
            return True

    def fail_refresh(*_args, **_kwargs):
        raise AssertionError("cold start without canonical must not synchronously refresh")

    monkeypatch.setattr(city_api.legacy_routes, "_normalize_city_or_404", lambda name: name.strip().lower())
    monkeypatch.setattr(city_api.legacy_routes, "_CACHE_DB", FakeDB())
    monkeypatch.setattr(city_api.legacy_routes, "_refresh_city_panel_cache", fail_refresh)

    payload = asyncio.run(
        city_api.get_city_detail_payload(
            object(),
            "Shanghai",
            force_refresh=False,
            depth="panel",
        )
    )

    assert payload["name"] == "shanghai"
    assert payload["detail_depth"] == "panel"
    assert payload["status"] == "initializing"
    assert payload["current"]["temp"] is None
    assert enqueued == [
        {
            "city": "shanghai",
            "kind": "panel",
            "priority": "high",
            "reason": "cold_start",
        }
    ]


def test_dashboard_init_uses_safe_city_detail_path_without_direct_refresh(monkeypatch):
    import web.services.dashboard_init_api as dashboard_init_api

    calls = []

    class FakeRequest:
        headers = {}
        state = SimpleNamespace()

    class FakeDB:
        def get_city_cache(self, kind, city):
            assert kind == "panel"
            assert city == "shanghai"
            return None

    def fail_refresh(*_args, **_kwargs):
        raise AssertionError("dashboard init must not directly refresh city panel cache")

    async def fake_get_city_detail_payload(request, name, *, force_refresh=False, depth="panel"):
        calls.append((name, force_refresh, depth))
        return {"name": name, "status": "initializing"}

    monkeypatch.setattr(dashboard_init_api.legacy_routes, "_bind_optional_supabase_identity", lambda request: None)
    monkeypatch.setattr(dashboard_init_api, "_build_cities_payload", lambda: {"cities": []})
    monkeypatch.setattr(dashboard_init_api, "_resolve_default_city", lambda request: "shanghai")
    monkeypatch.setattr(dashboard_init_api.legacy_routes, "_CACHE_DB", FakeDB())
    monkeypatch.setattr(dashboard_init_api.legacy_routes, "_refresh_city_panel_cache", fail_refresh)
    monkeypatch.setattr(dashboard_init_api, "get_city_detail_payload", fake_get_city_detail_payload, raising=False)

    payload = asyncio.run(dashboard_init_api.build_dashboard_init_payload(FakeRequest()))

    assert payload["default_city_detail"] == {"name": "shanghai", "status": "initializing"}
    assert calls == [("shanghai", False, "panel")]
