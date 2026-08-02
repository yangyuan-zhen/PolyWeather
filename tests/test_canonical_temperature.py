from __future__ import annotations

import asyncio
from types import SimpleNamespace


def test_canonical_temperature_roles_understand_adapter_source_names():
    from web.services.canonical_temperature import build_canonical_temperature

    def role_for(source):
        canonical = build_canonical_temperature(
            "hong kong",
            {
                "current": {
                    "temp": 28.0,
                    "source_code": source,
                    "source_label": source,
                    "freshness": {"freshness_status": "fresh"},
                },
            },
        )
        assert canonical is not None
        return canonical["source_role"]

    assert role_for("hko_obs") == "settlement_official"
    assert role_for("cowin_obs") == "settlement_official"
    assert role_for("madis_hfmetar") == "airport_official"


def test_db_manager_stores_canonical_temperature_latest(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "polyweather.db"))
    canonical = {
        "city": "shanghai",
        "value": 31.2,
        "source": "metar",
        "source_role": "settlement_proxy",
        "observed_at": "2026-06-14T01:01:00+00:00",
        "fetched_at": "2026-06-14T01:02:03+00:00",
        "freshness_sec": 63,
        "freshness_status": "fresh",
        "confidence": 0.92,
        "explanation": "METAR airport temperature updated 63s ago.",
    }

    db.set_canonical_temperature("Shanghai", canonical)

    row = db.get_canonical_temperature("shanghai")
    assert row is not None
    assert row["city"] == "shanghai"
    assert row["value"] == 31.2
    assert row["source"] == "metar"
    assert row["source_role"] == "settlement_proxy"
    assert row["freshness_status"] == "fresh"
    assert row["payload"]["observed_at"] == "2026-06-14T01:01:00+00:00"


def test_refresh_city_panel_cache_reads_canonical_without_sync_fetch(monkeypatch):
    import web.services.city_runtime as city_runtime

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
                    "source": "metar",
                    "source_label": "METAR airport temperature",
                    "source_role": "settlement_proxy",
                    "observed_at": "2026-06-14T01:01:00+00:00",
                    "observed_at_local": "09:01",
                    "freshness_sec": 63,
                    "freshness_status": "fresh",
                    "fetched_at": "2026-06-14T01:02:03+00:00",
                    "confidence": 0.92,
                    "explanation": "METAR airport temperature updated 63s ago.",
                }
            }

        def enqueue_observation_refresh_request(self, **kwargs):
            enqueued.append(kwargs)
            return True

    def fail_analyze(*_args, **_kwargs):
        raise AssertionError("business cache refresh must not call _analyze")

    monkeypatch.setattr(city_runtime, "_CACHE_DB", FakeDB())
    if hasattr(city_runtime, "_analyze"):
        monkeypatch.setattr(city_runtime, "_analyze", fail_analyze)

    payload = city_runtime._refresh_city_panel_cache("shanghai")

    assert payload["canonical_temperature"]["value"] == 31.2
    assert payload["canonical_temperature"]["source"] == "metar"
    assert payload["canonical_temperature"]["freshness_sec"] == 63
    assert payload["canonical_temperature"]["source_role"] == "settlement_proxy"
    assert enqueued == [
        {
            "city": "shanghai",
            "kind": "panel",
            "priority": "high",
            "reason": "canonical_fallback",
        }
    ]


def test_city_runtime_refresh_helpers_have_no_sync_fetch_escape_hatch():
    import inspect

    import web.services.city_runtime as city_runtime

    for name in (
        "_refresh_city_summary_cache",
        "_refresh_city_panel_cache",
        "_refresh_city_nearby_cache",
        "_refresh_city_market_cache",
        "_refresh_city_full_cache",
    ):
        signature = inspect.signature(getattr(city_runtime, name))
        assert "allow_external_fetch" not in signature.parameters
    assert not hasattr(city_runtime, "_analyze")
    assert not hasattr(city_runtime, "_analyze_summary")


def test_refresh_city_panel_cache_defaults_to_queue_without_sync_analyze(monkeypatch):
    import web.services.city_runtime as city_runtime

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

    monkeypatch.setattr(city_runtime, "_CACHE_DB", FakeDB())

    payload = city_runtime._refresh_city_panel_cache("shanghai")

    assert payload["status"] == "initializing"
    assert payload["stale_reason"] == "collector_refresh_queued"
    assert payload["current"]["observation_status"] == "initializing"
    assert enqueued == [
        {
            "city": "shanghai",
            "kind": "panel",
            "priority": "high",
            "reason": "cold_start",
        }
    ]


def test_city_panel_cold_cache_returns_canonical_latest_without_sync_refresh(monkeypatch):
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
                    "source": "metar",
                    "source_label": "METAR airport temperature",
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

    def fail_refresh(*_args, **_kwargs):
        raise AssertionError("cold panel cache must not synchronously refresh when canonical latest exists")

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

    assert payload["current"]["temp"] == 31.2
    assert payload["canonical_temperature"]["source"] == "metar"
    assert payload["detail_depth"] == "panel"
    assert enqueued == [
        {
            "city": "shanghai",
            "kind": "panel",
            "priority": "high",
            "reason": "canonical_fallback",
        }
    ]


def test_city_full_cold_cache_returns_canonical_latest_without_sync_refresh(monkeypatch):
    import web.services.city_api as city_api

    enqueued = []

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
                    "source": "metar",
                    "source_label": "METAR airport temperature",
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

    def fail_refresh(*_args, **_kwargs):
        raise AssertionError("cold full cache must not synchronously refresh when canonical latest exists")

    monkeypatch.setattr(city_api.legacy_routes, "_CACHE_DB", FakeDB())
    monkeypatch.setattr(city_api.legacy_routes, "_refresh_city_full_cache", fail_refresh)

    payload = asyncio.run(city_api._get_city_full_data("shanghai", force_refresh=False))

    assert payload["current"]["temp"] == 31.2
    assert payload["canonical_temperature"]["source"] == "metar"
    assert payload["detail_depth"] == "full"
    assert enqueued == [
        {
            "city": "shanghai",
            "kind": "full",
            "priority": "high",
            "reason": "canonical_fallback",
        }
    ]


def test_city_nearby_and_market_cold_cache_return_canonical_latest_without_sync_refresh(monkeypatch):
    import web.services.city_api as city_api

    enqueued = []
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
                    "source": "metar",
                    "source_label": "METAR airport temperature",
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

    def fail_refresh(*_args, **_kwargs):
        raise AssertionError("cold city cache must not synchronously refresh when canonical latest exists")

    monkeypatch.setattr(city_api.legacy_routes, "_normalize_city_or_404", lambda name: name.strip().lower())
    monkeypatch.setattr(city_api.legacy_routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(city_api.legacy_routes, "_CACHE_DB", FakeDB())
    monkeypatch.setattr(city_api.legacy_routes, "_refresh_city_nearby_cache", fail_refresh)
    monkeypatch.setattr(city_api.legacy_routes, "_refresh_city_market_cache", fail_refresh)

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
    assert enqueued == [
        {
            "city": "shanghai",
            "kind": "nearby",
            "priority": "high",
            "reason": "canonical_fallback",
        },
        {
            "city": "shanghai",
            "kind": "market",
            "priority": "high",
            "reason": "canonical_fallback",
        },
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
                    "source": "metar",
                    "source_label": "METAR airport temperature",
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
    assert payload["canonical_temperature"]["source"] == "metar"
    assert payload["detail_depth"] == "panel"


def test_force_refresh_panel_overlays_latest_raw_over_stale_cache(monkeypatch):
    import web.services.city_api as city_api

    enqueued = []

    class FakeDB:
        def get_city_cache(self, kind, city):
            assert kind == "panel"
            assert city == "shanghai"
            return {
                "updated_at_ts": 1000.0,
                "payload": {
                    "detail_depth": "panel",
                    "current": {
                        "temp": 21.8,
                        "source_code": "metar",
                        "observed_at": "2026-06-14T10:30:00+00:00",
                    },
                    "airport_primary": {
                        "temp": 21.8,
                        "source_code": "metar",
                        "obs_time": "2026-06-14T10:30:00+00:00",
                    },
                    "deb": {"prediction": 24.5},
                },
            }

        def get_canonical_temperature(self, city):
            assert city == "shanghai"
            return {
                "payload": {
                    "city": "shanghai",
                    "value": 21.8,
                    "source": "metar",
                    "source_label": "METAR",
                    "source_role": "airport_official",
                    "observed_at": "2026-06-14T10:30:00+00:00",
                    "observed_at_local": "18:30",
                    "freshness_sec": 120,
                    "freshness_status": "fresh",
                    "fetched_at": "2026-06-14T10:30:05+00:00",
                    "confidence": 0.78,
                },
            }

        def get_latest_raw_observation(self, source, city):
            assert (source, city) == ("metar", "shanghai")
            return {
                "observed_at": "2026-06-14T15:43:00+00:00",
                "fetched_at": "2026-06-14T15:43:30+00:00",
                "payload": {
                    "source": "metar",
                    "source_label": "METAR Shanghai Pudong (ZSPD)",
                    "icao": "ZSPD",
                    "temp_c": 25.4,
                    "observation_time": "2026-06-14T15:43:00+00:00",
                    "observation_time_local": "2026-06-14 23:43:00",
                },
            }

        def enqueue_observation_refresh_request(self, **kwargs):
            enqueued.append(kwargs)
            return True

    monkeypatch.setattr(city_api.legacy_routes, "_normalize_city_or_404", lambda name: name.strip().lower())
    monkeypatch.setattr(city_api.legacy_routes, "_CACHE_DB", FakeDB())

    payload = asyncio.run(
        city_api.get_city_detail_payload(
            object(),
            "Shanghai",
            force_refresh=True,
            depth="panel",
        )
    )

    assert payload["current"]["source_code"] == "metar"
    assert payload["current"]["temp"] == 21.8
    assert "canonical_temperature" not in payload
    assert payload["deb"]["prediction"] == 24.5
    assert enqueued == [
        {
            "city": "shanghai",
            "kind": "panel",
            "priority": "high",
            "reason": "force_refresh",
        }
    ]


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
                    "source": "metar",
                    "source_label": "METAR airport temperature",
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
