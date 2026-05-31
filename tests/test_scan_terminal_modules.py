from web.scan_terminal_filters import normalize_scan_terminal_filters
from web import scan_terminal_cache
from web.scan_terminal_metar_gate import _apply_metar_gate_to_row
from web.scan_terminal_payloads import (
    build_failed_scan_terminal_payload,
    build_scan_terminal_snapshot_id,
    build_stale_scan_terminal_payload,
    compact_ranked_scan_rows_for_payload,
    SCAN_PAYLOAD_DEFERRED_RUNWAY_POINTS,
    SCAN_PAYLOAD_FULL_RUNWAY_HISTORY_ROWS,
)
from web.scan_terminal_ranker import build_ranked_scan_terminal_result
from web.scan_terminal_city_row import _build_quick_row
from web.routers.scan import router as scan_router
from web.scan_terminal_service import _scan_terminal_prewarm_filters


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


def test_scan_terminal_prewarm_covers_default_api_limit():
    limits = {filters["limit"] for filters in _scan_terminal_prewarm_filters()}

    assert 25 in limits
    assert 180 in limits


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
