from web.scan_terminal_ai_merge import merge_scan_ai_result
from web.scan_terminal_filters import normalize_scan_terminal_filters
from web.scan_terminal_metar_gate import _apply_metar_gate_to_row
from web.scan_terminal_payloads import (
    build_failed_scan_terminal_payload,
    build_scan_terminal_snapshot_id,
    build_stale_scan_terminal_payload,
)
from web.scan_terminal_ranker import build_ranked_scan_terminal_result


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


def test_merge_scan_ai_result_applies_city_forecast_and_metadata():
    payload = {
        "snapshot_id": "scan-abc",
        "rows": [
            {
                "id": "row-1",
                "city": "manila",
                "city_display_name": "Manila",
                "final_score": 80.0,
                "edge_percent": 5.0,
                "metar_context": {"obs_count": 0},
            }
        ],
    }
    ai_raw = {
        "summary_zh": "摘要",
        "city_forecasts": [
            {
                "city": "Manila",
                "predicted_max": 35.0,
                "range_low": 34.0,
                "range_high": 36.0,
                "reasoning_zh": "实测突破",
            }
        ],
        "recommendations": [{"row_id": "row-1", "rank": 1, "reason_zh": "观察"}],
        "_polyweather_input_meta": {"sent_cities": 1, "sent_contracts": 1},
    }

    merged = merge_scan_ai_result(
        payload,
        ai_raw,
        model="mimo-v2.5-pro",
        max_rows=40,
        timeout_sec=40,
        cache_ttl_sec=1800,
        base_url="https://token-plan-cn.xiaomimimo.com/v1",
        provider="mimo",
        duration_ms=123,
        input_rows=1,
    )

    row = merged["rows"][0]
    assert row["ai_predicted_max"] == 35.0
    assert row["ai_forecast_reason_zh"] == "实测突破"
    assert row["ai_decision"] == "approve"
    assert merged["ai_scan"]["sent_cities"] == 1
    assert merged["ai_scan"]["sent_rows"] == 1
    assert merged["ai_scan"]["duration_ms"] == 123
    assert merged["ai_scan"]["model"] == "mimo-v2.5-pro"
    assert merged["ai_scan"]["provider"] == "mimo"
    assert merged["ai_scan"]["base_url"] == "https://token-plan-cn.xiaomimimo.com/v1"
