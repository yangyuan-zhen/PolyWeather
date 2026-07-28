import time
from datetime import datetime, timedelta, timezone

from web.scan_terminal_filters import normalize_scan_terminal_filters
from web import scan_terminal_cache
from web import scan_terminal_service
from web.scan_terminal_metar_gate import _apply_metar_gate_to_row
from web.scan_terminal_payloads import (
    build_scan_terminal_incremental_payload,
    build_failed_scan_terminal_payload,
    build_scan_terminal_snapshot_id,
    build_stale_scan_terminal_payload,
    compact_ranked_scan_rows_for_payload,
    SCAN_PAYLOAD_DEFERRED_RUNWAY_POINTS,
    SCAN_PAYLOAD_FULL_RUNWAY_HISTORY_ROWS,
)
from web.scan_terminal_ranker import build_ranked_scan_terminal_result
from web import scan_terminal_city_row
from web.scan_terminal_city_row import _build_quick_row
from web.routers.scan import router as scan_router
from web.scan_terminal_service import _scan_terminal_prewarm_filters


def _local_date_for_offset(offset_seconds):
    return (datetime.now(timezone.utc) + timedelta(seconds=offset_seconds)).strftime("%Y-%m-%d")


class _FakeRedis:
    def __init__(self):
        self.data = {}

    def get(self, key):
        return self.data.get(key)

    def setex(self, key, _ttl, value):
        self.data[key] = value


def test_scan_terminal_cache_hydrates_success_payload_from_redis(monkeypatch):
    fake_redis = _FakeRedis()
    monkeypatch.setenv("POLYWEATHER_SCAN_TERMINAL_REDIS_CACHE_ENABLED", "true")
    monkeypatch.setattr(scan_terminal_cache, "_get_redis_client", lambda: fake_redis)
    scan_terminal_cache._SCAN_TERMINAL_CACHE.clear()

    filters = {"scan_mode": "tradable", "limit": 9}
    payload = {
        "generated_at": "2026-06-01T00:00:00Z",
        "rows": [{"id": "row-1"}],
        "summary": {"candidate_total": 1},
    }

    scan_terminal_cache.set_cached_scan_terminal_payload(filters, payload)
    scan_terminal_cache._SCAN_TERMINAL_CACHE.clear()

    entry = scan_terminal_cache.get_scan_terminal_cache_entry(filters)
    cached = scan_terminal_cache.get_cached_scan_terminal_payload(filters, ttl_sec=3600)

    assert entry["success_payload"]["rows"] == [{"id": "row-1"}]
    assert cached["summary"]["candidate_total"] == 1


def test_scan_terminal_redis_cache_prefix_skips_legacy_blank_snapshots(monkeypatch):
    monkeypatch.delenv("POLYWEATHER_SCAN_TERMINAL_REDIS_CACHE_PREFIX", raising=False)

    assert scan_terminal_cache._redis_cache_prefix() == "polyweather:scan_terminal:v2:"

    monkeypatch.setenv(
        "POLYWEATHER_SCAN_TERMINAL_REDIS_CACHE_PREFIX",
        "polyweather:scan_terminal:v1:",
    )

    assert scan_terminal_cache._redis_cache_prefix() == "polyweather:scan_terminal:v2:"


def test_scan_terminal_failure_state_preserves_redis_success_payload(monkeypatch):
    fake_redis = _FakeRedis()
    monkeypatch.setenv("POLYWEATHER_SCAN_TERMINAL_REDIS_CACHE_ENABLED", "true")
    monkeypatch.setattr(scan_terminal_cache, "_get_redis_client", lambda: fake_redis)
    scan_terminal_cache._SCAN_TERMINAL_CACHE.clear()

    filters = {"scan_mode": "tradable", "limit": 9}
    scan_terminal_cache.set_cached_scan_terminal_payload(
        filters,
        {
            "generated_at": "2026-06-01T00:00:00Z",
            "rows": [{"id": "row-1"}],
        },
    )
    scan_terminal_cache._SCAN_TERMINAL_CACHE.clear()

    scan_terminal_cache.set_scan_terminal_failure_state(filters, error_message="timeout")
    scan_terminal_cache._SCAN_TERMINAL_CACHE.clear()

    entry = scan_terminal_cache.get_scan_terminal_cache_entry(filters)

    assert entry["success_payload"]["rows"] == [{"id": "row-1"}]
    assert entry["last_error"] == "timeout"


def test_scan_terminal_cache_keeps_previous_success_snapshot_for_diffs(monkeypatch):
    fake_redis = _FakeRedis()
    monkeypatch.setenv("POLYWEATHER_SCAN_TERMINAL_REDIS_CACHE_ENABLED", "true")
    monkeypatch.setattr(scan_terminal_cache, "_get_redis_client", lambda: fake_redis)
    scan_terminal_cache._SCAN_TERMINAL_CACHE.clear()

    filters = {"scan_mode": "tradable", "limit": 9}
    scan_terminal_cache.set_cached_scan_terminal_payload(
        filters,
        {
            "snapshot_id": "scan-old",
            "generated_at": "2026-06-01T00:00:00Z",
            "rows": [{"id": "row-1", "edge_percent": 3}],
        },
    )
    scan_terminal_cache.set_cached_scan_terminal_payload(
        filters,
        {
            "snapshot_id": "scan-new",
            "generated_at": "2026-06-01T00:01:00Z",
            "rows": [{"id": "row-1", "edge_percent": 4}],
        },
    )

    scan_terminal_cache._SCAN_TERMINAL_CACHE.clear()
    entry = scan_terminal_cache.get_scan_terminal_cache_entry(filters)

    assert entry["success_payload"]["snapshot_id"] == "scan-new"
    assert entry["previous_success_payload"]["snapshot_id"] == "scan-old"


def test_build_scan_terminal_incremental_payload_returns_not_modified():
    filters = {"scan_mode": "tradable", "limit": 2}
    current = {
        "generated_at": "2026-06-01T00:01:00Z",
        "snapshot_id": "scan-current",
        "status": "ready",
        "stale": False,
        "filters": filters,
        "summary": {"candidate_total": 2},
        "top_signal": {"id": "row-1"},
        "rows": [{"id": "row-1"}, {"id": "row-2"}],
    }

    payload = build_scan_terminal_incremental_payload(
        filters=filters,
        current_payload=current,
        since_snapshot_id="scan-current",
        base_payload=current,
    )

    assert payload["status"] == "not_modified"
    assert payload["rows"] == []
    assert payload["summary"] == current["summary"]
    assert payload["top_signal"] == current["top_signal"]
    assert payload["diff"] == {
        "mode": "not_modified",
        "base_snapshot_id": "scan-current",
        "snapshot_id": "scan-current",
        "rows_changed": [],
        "removed_row_ids": [],
    }


def test_build_scan_terminal_incremental_payload_returns_changed_row_delta():
    filters = {"scan_mode": "tradable", "limit": 3}
    base = {
        "generated_at": "2026-06-01T00:00:00Z",
        "snapshot_id": "scan-old",
        "status": "ready",
        "stale": False,
        "filters": filters,
        "summary": {"candidate_total": 2},
        "top_signal": {"id": "row-1"},
        "rows": [
            {"id": "row-1", "rank": 1, "edge_percent": 3},
            {"id": "row-removed", "rank": 2, "edge_percent": 2},
        ],
    }
    current = {
        "generated_at": "2026-06-01T00:01:00Z",
        "snapshot_id": "scan-new",
        "status": "ready",
        "stale": False,
        "filters": filters,
        "summary": {"candidate_total": 2},
        "top_signal": {"id": "row-added"},
        "rows": [
            {"id": "row-1", "rank": 1, "edge_percent": 4},
            {"id": "row-added", "rank": 2, "edge_percent": 5},
        ],
    }

    payload = build_scan_terminal_incremental_payload(
        filters=filters,
        current_payload=current,
        since_snapshot_id="scan-old",
        base_payload=base,
    )

    assert payload["status"] == "ready"
    assert payload["rows"] == []
    assert payload["snapshot_id"] == "scan-new"
    assert payload["diff"]["mode"] == "row_delta"
    assert payload["diff"]["base_snapshot_id"] == "scan-old"
    assert payload["diff"]["snapshot_id"] == "scan-new"
    assert {row["id"] for row in payload["diff"]["rows_changed"]} == {
        "row-1",
        "row-added",
    }
    assert payload["diff"]["removed_row_ids"] == ["row-removed"]


def test_build_scan_terminal_incremental_payload_falls_back_to_full_without_base():
    filters = {"scan_mode": "tradable", "limit": 2}
    current = {
        "generated_at": "2026-06-01T00:01:00Z",
        "snapshot_id": "scan-new",
        "status": "ready",
        "stale": False,
        "filters": filters,
        "summary": {"candidate_total": 1},
        "top_signal": None,
        "rows": [{"id": "row-1", "edge_percent": 4}],
    }

    payload = build_scan_terminal_incremental_payload(
        filters=filters,
        current_payload=current,
        since_snapshot_id="scan-old",
        base_payload=None,
    )

    assert payload["status"] == "ready"
    assert payload["rows"] == current["rows"]
    assert payload["diff"]["mode"] == "full"
    assert payload["diff"]["base_snapshot_id"] == "scan-old"
    assert payload["diff"]["snapshot_id"] == "scan-new"


def test_scan_terminal_prewarm_covers_default_api_limit():
    limits = {filters["limit"] for filters in _scan_terminal_prewarm_filters()}

    assert 25 in limits
    assert 180 in limits


def test_scan_terminal_prewarm_queues_city_refresh_without_analyze(monkeypatch):
    enqueued = []

    class _DB:
        @staticmethod
        def enqueue_observation_refresh_request(**kwargs):
            enqueued.append(kwargs)
            return True

    monkeypatch.setattr(scan_terminal_service, "_SCAN_PREWARM_DB", _DB(), raising=False)
    monkeypatch.setattr(
        scan_terminal_service,
        "_analyze",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("scan terminal prewarm must not fetch external sources")
        ),
        raising=False,
    )

    assert scan_terminal_service._queue_scan_terminal_city_prewarm("shenzhen") == "shenzhen"
    assert enqueued == [
        {
            "city": "shenzhen",
            "kind": "panel",
            "priority": "normal",
            "reason": "scan_terminal_prewarm",
        }
    ]


def test_scan_city_terminal_rows_reuses_persisted_panel_cache(monkeypatch):
    payload = {
        "display_name": "Paris",
        "local_date": _local_date_for_offset(3600),
        "local_time": "12:00",
        "current": {"temp": 18.0},
        "risk": {},
        "deb": {"prediction": 20.0},
        "probabilities": {},
        "multi_model": {},
    }

    class _Cache:
        @staticmethod
        def get_city_cache(kind, city):
            assert (kind, city) == ("panel", "paris")
            return {"payload": payload, "updated_at_ts": time.time()}

    monkeypatch.setattr(scan_terminal_city_row, "_PANEL_CACHE_DB", _Cache())
    monkeypatch.setattr(
        scan_terminal_city_row,
        "_analyze",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("non-force scan must not fetch external sources")
        ),
    )

    result = scan_terminal_city_row._scan_city_terminal_rows(
        "paris",
        {"market_type": "maxtemp"},
        force_refresh=False,
    )

    assert result["city"] == "paris"
    assert result["rows"][0]["current_temp"] == 18.0


def test_scan_city_terminal_rows_rejects_expired_panel_cache(monkeypatch):
    enqueued = []
    payload = {
        "display_name": "Paris",
        "local_date": _local_date_for_offset(3600),
        "local_time": "12:00",
        "current": {"temp": 18.0},
        "risk": {},
        "deb": {"prediction": 20.0},
        "probabilities": {},
        "multi_model_daily": {},
    }

    class _Cache:
        @staticmethod
        def get_city_cache(kind, city):
            assert (kind, city) == ("panel", "paris")
            return {"payload": payload, "updated_at_ts": 1}

        @staticmethod
        def get_canonical_temperature(city):
            assert city == "paris"
            return None

        @staticmethod
        def enqueue_observation_refresh_request(**kwargs):
            enqueued.append(kwargs)
            return True

    monkeypatch.setattr(scan_terminal_city_row, "_PANEL_CACHE_DB", _Cache())
    monkeypatch.setattr(scan_terminal_city_row._weather, "fetch_multi_model", lambda *args, **kwargs: None)

    result = scan_terminal_city_row._scan_city_terminal_rows(
        "paris",
        {"market_type": "maxtemp"},
        force_refresh=False,
    )

    assert result["city"] == "paris"
    assert result["rows"] == []
    assert enqueued == [
        {
            "city": "paris",
            "kind": "panel",
            "priority": "high",
            "reason": "scan_terminal_stale_panel",
        }
    ]


def test_scan_city_terminal_rows_refreshes_models_for_wrong_local_date_panel(monkeypatch):
    enqueued = []
    today = _local_date_for_offset(3600)
    payload = {
        "display_name": "Paris",
        "local_date": "2000-01-01",
        "local_time": "12:00",
        "current": {"temp": 18.0},
        "risk": {},
        "deb": {"prediction": 20.0},
        "probabilities": {},
        "multi_model_daily": {
            "2000-01-01": {
                "deb": {"prediction": 20.0},
                "models": {"ECMWF": 19.0},
            }
        },
    }
    fetched = []

    class _Cache:
        @staticmethod
        def get_city_cache(kind, city):
            assert (kind, city) == ("panel", "paris")
            return {"payload": payload, "updated_at_ts": time.time()}

        @staticmethod
        def get_canonical_temperature(city):
            assert city == "paris"
            return None

        @staticmethod
        def enqueue_observation_refresh_request(**kwargs):
            enqueued.append(kwargs)
            return True

    monkeypatch.setattr(scan_terminal_city_row, "_PANEL_CACHE_DB", _Cache())
    monkeypatch.setattr(
        scan_terminal_city_row._weather,
        "fetch_multi_model",
        lambda lat, lon, city="", use_fahrenheit=False: (
            fetched.append((lat, lon, city, use_fahrenheit))
            or {
                "daily_forecasts": {
                    today: {"ECMWF": 22.0, "GFS": 23.0},
                },
                "forecasts": {"ECMWF": 99.0},
                "dates": [today],
                "unit": "celsius",
            }
        ),
    )
    monkeypatch.setattr(
        scan_terminal_city_row,
        "calculate_deb_prediction",
        lambda city, forecasts, raw_calculator=None: {
            "prediction": 22.4,
            "raw_prediction": 22.5,
            "version": "test-deb",
        },
    )

    result = scan_terminal_city_row._scan_city_terminal_rows(
        "paris",
        {"market_type": "maxtemp"},
        force_refresh=False,
    )

    assert result["city"] == "paris"
    assert fetched, "scan terminal should fetch today's multi-model forecast when panel date is stale"
    assert result["rows"][0]["local_date"] == today
    assert result["rows"][0]["forecast_refreshed"] is True
    assert result["rows"][0]["forecast_source_local_date"] == today
    assert result["rows"][0]["deb_prediction"] == 22.4
    assert result["rows"][0]["model_cluster_sources"] == {"ECMWF": 22.0, "GFS": 23.0}
    assert enqueued == [
        {
            "city": "paris",
            "kind": "panel",
            "priority": "high",
            "reason": "scan_terminal_stale_panel_date",
        }
    ]


def test_scan_city_terminal_rows_reuses_cached_today_models_when_direct_fetch_disabled(monkeypatch):
    today = _local_date_for_offset(3600)
    enqueued = []
    payload = {
        "display_name": "Paris",
        "local_date": "2000-01-01",
        "local_time": "12:00",
        "utc_offset_seconds": 3600,
        "current": {"max_so_far": 20.0},
        "risk": {},
        "deb": {"prediction": 20.0},
        "probabilities": {},
        "multi_model_daily": {
            today: {
                "deb": {"prediction": 22.4},
                "models": {"ECMWF": 22.0, "GFS": 23.0},
            }
        },
    }

    class _Cache:
        @staticmethod
        def get_city_cache(kind, city):
            assert (kind, city) == ("panel", "paris")
            return {"payload": payload, "updated_at_ts": 1}

        @staticmethod
        def get_canonical_temperature(city):
            assert city == "paris"
            return None

        @staticmethod
        def enqueue_observation_refresh_request(**kwargs):
            enqueued.append(kwargs)
            return True

    monkeypatch.setattr(
        scan_terminal_city_row,
        "CITIES",
        {"paris": {"lat": 48.85, "lon": 2.35, "tz": 3600}},
    )
    monkeypatch.setattr(scan_terminal_city_row, "_PANEL_CACHE_DB", _Cache())
    monkeypatch.setattr(
        scan_terminal_city_row._weather,
        "fetch_multi_model",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("direct multi-model fetch should stay disabled")
        ),
    )
    monkeypatch.setattr(
        scan_terminal_city_row,
        "calculate_deb_prediction",
        lambda city, forecasts, raw_calculator=None: {"prediction": 22.4},
    )

    result = scan_terminal_city_row._scan_city_terminal_rows(
        "paris",
        {"market_type": "maxtemp"},
        force_refresh=False,
        allow_direct_fetch=False,
    )

    row = result["rows"][0]
    assert row["local_date"] == today
    assert row["forecast_refreshed"] is True
    assert row["forecast_source_local_date"] == today
    assert row["deb_prediction"] == 22.4
    assert row["model_cluster_sources"] == {"ECMWF": 22.0, "GFS": 23.0}
    assert enqueued == [
        {
            "city": "paris",
            "kind": "panel",
            "priority": "high",
            "reason": "scan_terminal_stale_panel",
        }
    ]


def test_scan_terminal_fetches_multi_model_daily_in_batches(monkeypatch):
    today_paris = _local_date_for_offset(3600)
    today_houston = _local_date_for_offset(-18000)
    monkeypatch.setattr(
        scan_terminal_city_row,
        "CITIES",
        {
            "paris": {"lat": 48.85, "lon": 2.35, "tz": 3600},
            "houston": {"lat": 29.76, "lon": -95.36, "tz": -18000, "f": True},
        },
    )
    monkeypatch.setattr(
        scan_terminal_city_row._weather,
        "_multi_model_cache",
        {},
        raising=False,
    )
    monkeypatch.setattr(
        scan_terminal_city_row._weather,
        "_maybe_reload_open_meteo_disk_cache",
        lambda: None,
        raising=False,
    )
    monkeypatch.setattr(
        scan_terminal_city_row._weather,
        "_flush_open_meteo_disk_cache",
        lambda: None,
        raising=False,
    )

    requests = []

    class _Response:
        def __init__(self, payload):
            self._payload = payload

        @staticmethod
        def raise_for_status():
            return None

        def json(self):
            return self._payload

    def _http_get(_url, *, params, timeout):
        requests.append((params, timeout))
        unit_is_f = params.get("temperature_unit") == "fahrenheit"
        date = today_houston if unit_is_f else today_paris
        value = 94.0 if unit_is_f else 24.0
        return _Response(
            [
                {
                    "daily": {
                        "time": [date],
                        "temperature_2m_max_ecmwf_ifs025": [value],
                        "temperature_2m_max_gfs_seamless": [value + 1],
                    }
                }
            ]
        )

    monkeypatch.setattr(scan_terminal_city_row._weather, "_http_get", _http_get, raising=False)
    monkeypatch.setattr(
        scan_terminal_city_row._weather,
        "_wait_open_meteo_slot",
        lambda _endpoint: None,
        raising=False,
    )

    result = scan_terminal_city_row._fetch_scan_terminal_multi_model_batch(["paris", "houston"])

    assert len(requests) == 2
    assert requests[0][0]["latitude"] == "48.85"
    assert requests[1][0]["temperature_unit"] == "fahrenheit"
    assert result["paris"]["daily_forecasts"][today_paris]["ECMWF"] == 24.0
    assert result["paris"]["daily_forecasts"][today_paris]["GFS"] == 25.0
    assert result["houston"]["daily_forecasts"][today_houston]["ECMWF"] == 94.0


def test_scan_terminal_multi_model_batch_chunks_long_city_lists(monkeypatch):
    today = _local_date_for_offset(0)
    cities = {
        f"city{i}": {"lat": float(i), "lon": float(i + 1), "tz": 0}
        for i in range(45)
    }
    monkeypatch.setattr(scan_terminal_city_row, "CITIES", cities)
    monkeypatch.setattr(
        scan_terminal_city_row._weather,
        "_multi_model_cache",
        {},
        raising=False,
    )
    monkeypatch.setattr(
        scan_terminal_city_row._weather,
        "_maybe_reload_open_meteo_disk_cache",
        lambda: None,
        raising=False,
    )
    monkeypatch.setattr(
        scan_terminal_city_row._weather,
        "_flush_open_meteo_disk_cache",
        lambda: None,
        raising=False,
    )
    monkeypatch.setattr(
        scan_terminal_city_row._weather,
        "_wait_open_meteo_slot",
        lambda _endpoint: None,
        raising=False,
    )
    requests = []

    class _Response:
        def __init__(self, count):
            self.count = count

        @staticmethod
        def raise_for_status():
            return None

        def json(self):
            return [
                {
                    "daily": {
                        "time": [today],
                        "temperature_2m_max_ecmwf_ifs025": [20.0 + idx],
                    }
                }
                for idx in range(self.count)
            ]

    def _http_get(_url, *, params, timeout):
        latitude_count = len(str(params["latitude"]).split(","))
        requests.append(latitude_count)
        return _Response(latitude_count)

    monkeypatch.setattr(scan_terminal_city_row._weather, "_http_get", _http_get, raising=False)

    result = scan_terminal_city_row._fetch_scan_terminal_multi_model_batch(list(cities.keys()))

    assert requests == [20, 20, 5]
    assert len(result) == 45
    assert result["city0"]["daily_forecasts"][today]["ECMWF"] == 20.0
    assert result["city44"]["daily_forecasts"][today]["ECMWF"] == 24.0


def test_scan_terminal_uncached_passes_batch_multi_model_overrides(monkeypatch):
    scan_terminal_cache._SCAN_TERMINAL_CACHE.clear()
    monkeypatch.setattr(
        scan_terminal_service,
        "CITIES",
        {"paris": {"tz": 3600}, "houston": {"tz": -18000}},
    )
    monkeypatch.setattr(scan_terminal_service, "SCAN_TERMINAL_MAX_WORKERS", 2)
    monkeypatch.setattr(
        scan_terminal_service,
        "_fetch_scan_terminal_multi_model_batch",
        lambda cities: {"paris": {"source": "batch-paris"}},
    )
    seen = []

    def _scan_city(
        city,
        _filters,
        *,
        force_refresh=False,
        multi_model_override=None,
        allow_direct_fetch=True,
    ):
        seen.append((city, force_refresh, multi_model_override, allow_direct_fetch))
        return {
            "city": city,
            "candidate_total": 1,
            "primary_scores": [1.0],
            "rows": [
                {
                    "id": f"{city}:today",
                    "market_key": f"{city}:today",
                    "final_score": 1.0,
                    "edge_percent": 0.0,
                    "volume": 0.0,
                }
            ],
        }

    monkeypatch.setattr(scan_terminal_service, "_scan_city_terminal_rows", _scan_city)

    payload = scan_terminal_service._build_scan_terminal_payload_uncached(
        {"limit": 2},
        force_refresh=True,
        timeout_sec=5,
    )

    assert payload["status"] == "ready"
    assert sorted(seen) == [
        ("paris", True, {"source": "batch-paris"}, False),
    ]
    assert payload["summary"]["total_city_count"] == 2
    assert payload["summary"]["scanned_city_count"] == 1


def test_scan_city_terminal_rows_builds_forecast_only_row_from_batch_override(monkeypatch):
    today = _local_date_for_offset(3600)

    class _Cache:
        @staticmethod
        def get_city_cache(*_args, **_kwargs):
            raise AssertionError("batch forecast rows should not read panel cache")

        @staticmethod
        def get_canonical_temperature(*_args, **_kwargs):
            raise AssertionError("batch forecast rows should not read canonical cache")

    monkeypatch.setattr(scan_terminal_city_row, "_PANEL_CACHE_DB", _Cache())
    monkeypatch.setattr(
        scan_terminal_city_row,
        "calculate_deb_prediction",
        lambda city, forecasts, raw_calculator=None: {"prediction": 24.5},
    )

    result = scan_terminal_city_row._scan_city_terminal_rows(
        "paris",
        {"market_type": "maxtemp"},
        force_refresh=True,
        multi_model_override={
            "daily_forecasts": {today: {"ECMWF": 24.0, "GFS": 25.0}},
            "dates": [today],
            "unit": "celsius",
        },
        allow_direct_fetch=False,
    )

    row = result["rows"][0]
    assert row["local_date"] == today
    assert row["deb_prediction"] == 24.5
    assert row["model_cluster_sources"] == {"ECMWF": 24.0, "GFS": 25.0}
    assert row["forecast_refreshed"] is True


def test_scan_timeout_prefers_partial_rows_with_models_over_blank_stale_cache(monkeypatch):
    cached_entry = {
        "success_payload": {
            "rows": [
                {"id": "old-1", "model_cluster_sources": {}},
                {"id": "old-2", "model_cluster_sources": {}},
            ]
        },
        "last_failed_at": None,
    }

    stale = scan_terminal_service._build_stale_payload_for_timeout_if_better_cached(
        filters={"limit": 2},
        cached_entry=cached_entry,
        ranked_rows=[
            {
                "id": "new-1",
                "model_cluster_sources": {"ECMWF": 24.0},
            }
        ],
        timeout_message="scan terminal build timed out after 30s",
    )

    assert stale is None


def test_scan_terminal_refresh_without_model_rows_keeps_previous_model_snapshot(monkeypatch):
    cached_entry = {
        "success_payload": {
            "generated_at": "2026-06-01T00:00:00Z",
            "snapshot_id": "good-model-snapshot",
            "rows": [
                {
                    "id": "paris:today",
                    "market_key": "paris:today",
                    "model_cluster_sources": {"ECMWF": 24.0},
                }
            ],
            "summary": {"candidate_total": 1},
            "top_signal": None,
        },
        "last_failed_at": "2026-06-01T00:01:00Z",
    }
    failures = []

    monkeypatch.setattr(scan_terminal_service, "CITIES", {"paris": {"tz": 3600}})
    monkeypatch.setattr(scan_terminal_service, "_fetch_scan_terminal_multi_model_batch", lambda _cities: {})
    monkeypatch.setattr(
        scan_terminal_service,
        "get_scan_terminal_cache_entry",
        lambda _filters: cached_entry,
    )
    monkeypatch.setattr(
        scan_terminal_service,
        "set_scan_terminal_failure_state",
        lambda _filters, *, error_message: failures.append(error_message),
    )
    monkeypatch.setattr(
        scan_terminal_service,
        "set_cached_scan_terminal_payload",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("blank model refresh must not overwrite success payload")
        ),
    )

    def _scan_city(*_args, **_kwargs):
        return {
            "city": "paris",
            "candidate_total": 1,
            "primary_scores": [0.0],
            "rows": [
                {
                    "id": "paris:today",
                    "market_key": "paris:today",
                    "final_score": 0.0,
                    "edge_percent": 0.0,
                    "volume": 0.0,
                    "model_cluster_sources": {},
                }
            ],
        }

    monkeypatch.setattr(scan_terminal_service, "_scan_city_terminal_rows", _scan_city)

    payload = scan_terminal_service._build_scan_terminal_payload_uncached(
        {"limit": 1},
        timeout_sec=5,
    )

    assert payload["status"] == "stale"
    assert payload["stale"] is True
    assert payload["snapshot_id"] == "good-model-snapshot"
    assert payload["rows"][0]["model_cluster_sources"] == {"ECMWF": 24.0}
    assert failures == ["scan terminal refresh returned rows without model forecasts"]


def test_scan_city_terminal_rows_uses_canonical_without_analyze(monkeypatch):
    enqueued = []

    class _Cache:
        @staticmethod
        def get_city_cache(kind, city):
            assert (kind, city) == ("panel", "qingdao")
            return None

        @staticmethod
        def get_canonical_temperature(city):
            assert city == "qingdao"
            return {
                "payload": {
                    "city": "qingdao",
                    "value": 22.5,
                    "temp_symbol": "°C",
                    "source": "amos",
                    "source_label": "AMOS",
                    "source_role": "settlement_proxy",
                    "observed_at": "2026-06-01T08:00:00Z",
                    "fetched_at": "2026-06-01T08:00:30Z",
                    "freshness_sec": 30,
                    "freshness_status": "fresh",
                    "confidence": 0.92,
                }
            }

        @staticmethod
        def enqueue_observation_refresh_request(**kwargs):
            enqueued.append(kwargs)
            return True

    monkeypatch.setattr(scan_terminal_city_row, "_PANEL_CACHE_DB", _Cache())
    monkeypatch.setattr(scan_terminal_city_row._weather, "fetch_multi_model", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        scan_terminal_city_row,
        "_analyze",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("scan terminal must not fetch external sources")
        ),
    )

    result = scan_terminal_city_row._scan_city_terminal_rows(
        "qingdao",
        {"market_type": "maxtemp"},
        force_refresh=False,
    )

    assert result["city"] == "qingdao"
    assert result["candidate_total"] == 1
    assert result["rows"][0]["current_temp"] == 22.5
    assert result["rows"][0]["temp_symbol"] == "°C"
    assert enqueued == [
        {
            "city": "qingdao",
            "kind": "panel",
            "priority": "high",
            "reason": "scan_terminal_canonical_fallback",
        }
    ]


def test_scan_city_terminal_rows_cold_start_only_enqueues(monkeypatch):
    enqueued = []

    class _Cache:
        @staticmethod
        def get_city_cache(kind, city):
            assert (kind, city) == ("panel", "seoul")
            return None

        @staticmethod
        def get_canonical_temperature(city):
            assert city == "seoul"
            return None

        @staticmethod
        def enqueue_observation_refresh_request(**kwargs):
            enqueued.append(kwargs)
            return True

    monkeypatch.setattr(scan_terminal_city_row, "_PANEL_CACHE_DB", _Cache())
    monkeypatch.setattr(
        scan_terminal_city_row,
        "_analyze",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("scan terminal must not fetch external sources")
        ),
    )

    result = scan_terminal_city_row._scan_city_terminal_rows(
        "seoul",
        {"market_type": "maxtemp"},
        force_refresh=False,
    )

    assert result == {
        "city": "seoul",
        "rows": [],
        "candidate_total": 0,
        "primary_scores": [],
    }
    assert enqueued == [
        {
            "city": "seoul",
            "kind": "panel",
            "priority": "high",
            "reason": "scan_terminal_cold_start",
        }
    ]


def test_scan_router_does_not_expose_terminal_ai_endpoint():
    routes = {
        getattr(route, "path", None): getattr(route, "methods", set())
        for route in scan_router.routes
    }

    assert "/api/scan/terminal/ai" not in routes


def test_normalize_scan_terminal_filters_clamps_and_swaps_bounds():
    filters = normalize_scan_terminal_filters(
        {
            "min_price": 1.2,
            "max_price": -0.2,
            "limit": 999,
            "high_liquidity_only": True,
            "min_liquidity": 100,
            "timezone_offset_seconds": "28800",
        }
    )

    assert filters["min_price"] == 0.0
    assert filters["max_price"] == 1.0
    assert filters["limit"] == 200
    assert filters["min_liquidity"] == 5000.0
    assert filters["timezone_offset_seconds"] == 28800


def test_ranked_scan_terminal_result_sorts_and_summarizes_unique_markets():
    result = build_ranked_scan_terminal_result(
        city_results=[
            {
                "candidate_total": 2,
                "primary_scores": [80.0],
                "rows": [
                    {
                        "id": "low",
                        "market_key": "m1",
                        "final_score": 70.0,
                        "edge_percent": 4.0,
                        "volume": 100,
                    },
                    {
                        "id": "high",
                        "market_key": "m1",
                        "final_score": 90.0,
                        "edge_percent": 2.0,
                        "volume": 250,
                    },
                ],
            },
            {
                "candidate_total": 1,
                "primary_scores": [60.0],
                "rows": [
                    {
                        "id": "tie-break",
                        "market_key": "m2",
                        "final_score": 90.0,
                        "edge_percent": 5.0,
                        "volume": 300,
                    }
                ],
            },
        ],
        filters={"limit": 2},
        total_city_count=3,
        failed_city_count=1,
    )

    assert [row["id"] for row in result["ranked_rows"]] == ["tie-break", "high"]
    assert [row["rank"] for row in result["ranked_rows"]] == [1, 2]
    assert result["top_signal"]["id"] == "tie-break"
    assert result["summary"]["candidate_total"] == 3
    assert result["summary"]["visible_count"] == 2
    assert result["summary"]["tradable_market_count"] == 2
    assert result["summary"]["total_volume"] == 550
    assert result["summary"]["failed_city_count"] == 1


def test_scan_terminal_payload_helpers_preserve_stale_and_failed_shape():
    success_payload = {
        "generated_at": "2026-04-28T00:00:00Z",
        "snapshot_id": "scan-old",
        "filters": {"scan_mode": "tradable"},
        "rows": [{"id": "row-1"}],
    }

    stale = build_stale_scan_terminal_payload(
        filters={"scan_mode": "trend"},
        success_payload=success_payload,
        error_message="refresh failed",
        failed_at="2026-04-28T00:01:00Z",
    )
    failed = build_failed_scan_terminal_payload(
        filters={"scan_mode": "trend"},
        error_message="network down",
        failed_at="2026-04-28T00:02:00Z",
    )

    assert stale["status"] == "stale"
    assert stale["stale"] is True
    assert stale["rows"] == [{"id": "row-1"}]
    assert stale["filters"] == {"scan_mode": "trend"}
    assert stale["last_success_at"] == "2026-04-28T00:00:00Z"
    assert failed["status"] == "failed"
    assert failed["summary"]["candidate_total"] == 0
    assert failed["rows"] == []


def test_scan_terminal_snapshot_id_is_stable_for_same_ranked_inputs():
    summary = {
        "candidate_total": 2,
        "tradable_market_count": 2,
        "avg_edge_percent": 3.5,
    }
    rows = [
        {"id": "a", "edge_percent": 4.0, "final_score": 90.0},
        {"id": "b", "edge_percent": 3.0, "final_score": 80.0},
    ]

    first = build_scan_terminal_snapshot_id({"limit": 2}, rows, summary, rows[0])
    second = build_scan_terminal_snapshot_id({"limit": 2}, rows, summary, rows[0])

    assert first == second
    assert first.startswith("scan-")


def test_scan_terminal_payload_slims_deferred_runway_history_rows():
    runway_points = [
        {"time": f"2026-05-31T{hour:02d}:00:00+00:00", "temp": 20 + hour}
        for hour in range(24)
    ]
    rows = [
        {
            "id": f"row-{index}",
            "runway_plate_history": {"35R": list(runway_points)},
        }
        for index in range(SCAN_PAYLOAD_FULL_RUNWAY_HISTORY_ROWS + 2)
    ]

    compacted = compact_ranked_scan_rows_for_payload(rows)

    assert len(compacted[0]["runway_plate_history"]["35R"]) == len(runway_points)
    assert (
        len(
            compacted[SCAN_PAYLOAD_FULL_RUNWAY_HISTORY_ROWS - 1][
                "runway_plate_history"
            ]["35R"]
        )
        == len(runway_points)
    )
    assert (
        len(
            compacted[SCAN_PAYLOAD_FULL_RUNWAY_HISTORY_ROWS][
                "runway_plate_history"
            ]["35R"]
        )
        == SCAN_PAYLOAD_DEFERRED_RUNWAY_POINTS
    )
    assert len(rows[SCAN_PAYLOAD_FULL_RUNWAY_HISTORY_ROWS]["runway_plate_history"]["35R"]) == len(
        runway_points
    )


def test_scan_terminal_quick_row_compacts_runway_history_for_list_payload():
    raw_history = {
        "35R": [
            {"time": "2026-05-31T00:00:00+00:00", "temp": 22.11},
            {"time": "2026-05-31T00:01:00+00:00", "temp": 22.22},
            {"time": "2026-05-31T00:02:00+00:00", "temp": 22.33},
            {"time": "2026-05-31T00:10:00+00:00", "temp": 23.44},
            {"time": "2026-05-31T00:11:00+00:00", "temp": 23.55},
        ]
    }

    row = _build_quick_row(
        city="shanghai",
        data={
            "display_name": "Shanghai",
            "local_date": "2026-05-31",
            "local_time": "2026-05-31T08:11:00+08:00",
            "temp_symbol": "°C",
            "current": {"temp": 22.3, "max_so_far": 23.0},
            "risk": {"airport": "Shanghai Pudong", "level": "medium"},
            "deb": {"prediction": 24.0},
            "probabilities": {"distribution": []},
            "multi_model": {},
            "runway_plate_history": raw_history,
        },
    )

    compact_history = row["runway_plate_history"]["35R"]

    assert len(compact_history) == 2
    assert compact_history[0]["temp"] == 22.3
    assert compact_history[1]["temp"] == 23.6
    assert len(str(row["runway_plate_history"])) < len(str(raw_history))


def test_scan_terminal_quick_row_exposes_airport_primary_source_metadata():
    row = _build_quick_row(
        city="ankara",
        data={
            "display_name": "Ankara",
            "local_date": "2026-06-14",
            "local_time": "2026-06-14T15:10:00+03:00",
            "temp_symbol": "°C",
            "current": {"temp": 19.0, "max_so_far": 19.0},
            "risk": {"airport": "Esenboğa", "icao": "LTAC", "level": "medium"},
            "airport_primary": {
                "station_code": "LTAC",
                "station_label": "Esenboğa 机场",
                "source_code": "mgm",
                "source_label": "MGM",
            },
            "official_network_source": "turkey_mgm",
            "official_network_status": {
                "provider_code": "turkey_mgm",
                "provider_label": "MGM",
            },
            "deb": {"prediction": 20.0},
            "probabilities": {"distribution": []},
            "multi_model": {},
        },
    )

    assert row["icao"] == "LTAC"
    assert row["station_source_code"] == "mgm"
    assert row["station_source_label"] == "MGM"
    assert row["station_code"] == "LTAC"
    assert row["network_provider"] == "turkey_mgm"


def test_metar_gate_vetoes_yes_when_observed_breaks_above_bucket():
    row = {
        "id": "yes-row",
        "side": "yes",
        "target_lower": 32.0,
        "target_upper": 34.0,
        "target_unit": "°C",
        "metar_context": {
            "obs_count": 6,
            "max_temp": 35.0,
            "last_temp": 35.0,
            "trend_delta": 1.0,
            "stale_for_today": False,
        },
    }

    _apply_metar_gate_to_row(row)

    assert row["v4_metar_decision"] == "veto"
    assert row["ai_decision"] == "veto"
    assert "越过目标桶上沿" in row["ai_reason_zh"]
