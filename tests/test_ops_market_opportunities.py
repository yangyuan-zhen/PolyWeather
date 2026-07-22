import pytest
from fastapi import HTTPException

import web.services.ops.market_opportunities as market_opportunities
from web.services.ops.market_opportunities import (
    build_market_opportunity_rows,
    get_ops_market_opportunities,
    parse_market_option_from_question,
)


def _row(city="shanghai", symbol="°C"):
    return {
        "city": city,
        "city_display_name": city.title(),
        "local_date": "2026-07-03",
        "local_time": "18:10",
        "temp_symbol": symbol,
        "current_max_so_far": 31.0,
        "deb_prediction": 32.2,
        "model_cluster_sources": {"ECMWF": 32.0, "GFS": 33.0, "ICON": 31.0},
        "distribution_full": [
            {"value": 31, "probability": 0.10},
            {"value": 32, "probability": 0.41},
            {"value": 33, "probability": 0.46},
            {"value": 34, "probability": 0.03},
        ],
        "trading_region_label_zh": "东亚",
    }


def test_parse_market_option_supports_celsius_single_temperature():
    option = parse_market_option_from_question(
        "Will the highest temperature in Shanghai be 33°C on July 3?",
        "°C",
    )

    assert option["label"] == "33°C"
    assert option["lower"] == 33
    assert option["upper"] == 33


def test_parse_market_option_supports_fahrenheit_two_degree_range():
    option = parse_market_option_from_question(
        "Will the highest temperature in Houston be between 94-95°F on July 3?",
        "°F",
    )

    assert option["label"] == "94-95°F"
    assert option["lower"] == 94
    assert option["upper"] == 95


def test_build_market_opportunities_scans_yes_and_no_low_price_edges():
    event = {
        "slug": "highest-temperature-in-shanghai-on-july-3-2026",
        "title": "Highest temperature in Shanghai on July 3?",
        "markets": [
            {
                "question": "Will the highest temperature in Shanghai be 33°C on July 3?",
                "slug": "highest-temperature-in-shanghai-on-july-3-2026-33c",
                "active": True,
                "closed": False,
                "enableOrderBook": True,
                "liquidity": "47000",
                "volume": "13000",
                "outcomes": '["Yes", "No"]',
                "clobTokenIds": '["yes-33", "no-33"]',
            },
            {
                "question": "Will the highest temperature in Shanghai be 31°C on July 3?",
                "slug": "highest-temperature-in-shanghai-on-july-3-2026-31c",
                "active": True,
                "closed": False,
                "enableOrderBook": True,
                "liquidity": "27000",
                "volume": "6000",
                "outcomes": '["Yes", "No"]',
                "clobTokenIds": '["yes-31", "no-31"]',
            },
        ],
    }

    rows = build_market_opportunity_rows(
        [_row()],
        {"shanghai": event},
        {
            "yes-33": 0.18,
            "no-33": 0.62,
            "yes-31": 0.12,
            "no-31": 0.18,
        },
        max_price=0.20,
        side="both",
        positive_edge_only=True,
        min_edge=0.0,
        limit=20,
    )

    yes = next(row for row in rows if row["bucket_label"] == "33°C" and row["side"] == "yes")
    no = next(row for row in rows if row["bucket_label"] == "31°C" and row["side"] == "no")

    assert yes["model_probability"] == 0.46
    assert yes["yes_probability"] == 0.46
    assert yes["side_probability"] == 0.46
    assert yes["model_cluster_sources"] == {"ECMWF": 32.0, "GFS": 33.0, "ICON": 31.0}
    assert yes["model_min"] == 31.0
    assert yes["model_max"] == 33.0
    assert yes["models_below_bucket"] == 2
    assert yes["models_in_bucket"] == 1
    assert yes["models_above_bucket"] == 0
    assert yes["models_above_deb"] == 1
    assert yes["ask_price"] == 0.18
    assert round(yes["edge"], 2) == 0.28
    assert no["model_probability"] == 0.10
    assert no["yes_probability"] == 0.10
    assert no["side_probability"] == 0.90
    assert no["ask_price"] == 0.18
    assert round(no["edge"], 2) == 0.72
    assert all(row["ask_price"] < 0.20 for row in rows)
    assert rows[0]["edge"] >= rows[-1]["edge"]


def test_build_market_opportunities_includes_ask_equal_to_max_price():
    event = {
        "slug": "highest-temperature-in-shanghai-on-july-3-2026",
        "markets": [
            {
                "question": "Will the highest temperature in Shanghai be 33°C on July 3?",
                "slug": "highest-temperature-in-shanghai-on-july-3-2026-33c",
                "active": True,
                "closed": False,
                "enableOrderBook": True,
                "outcomes": '["Yes", "No"]',
                "clobTokenIds": '["yes-33", "no-33"]',
            }
        ],
    }

    rows = build_market_opportunity_rows(
        [_row()],
        {"shanghai": event},
        {"yes-33": 0.18, "no-33": 0.82},
        max_price=0.18,
        side="yes",
        positive_edge_only=True,
        min_edge=0.0,
        limit=20,
    )

    assert len(rows) == 1
    assert rows[0]["ask_price"] == 0.18


def test_build_market_opportunities_aggregates_fahrenheit_distribution():
    event = {
        "slug": "highest-temperature-in-houston-on-july-3-2026",
        "markets": [
            {
                "question": "Will the highest temperature in Houston be between 94-95°F on July 3?",
                "slug": "highest-temperature-in-houston-on-july-3-2026-94-95f",
                "active": True,
                "closed": False,
                "enableOrderBook": True,
                "liquidity": "10000",
                "volume": "2000",
                "outcomes": '["Yes", "No"]',
                "clobTokenIds": '["yes-94", "no-94"]',
            }
        ],
    }
    row = _row("houston", "°F")
    row["distribution_full"] = [
        {"value": 94, "probability": 0.40},
        {"value": 95, "probability": 0.25},
        {"value": 96, "probability": 0.10},
    ]

    rows = build_market_opportunity_rows(
        [row],
        {"houston": event},
        {"yes-94": 0.19, "no-94": 0.81},
        max_price=0.20,
        side="yes",
        positive_edge_only=True,
        min_edge=0.0,
        limit=20,
    )

    assert rows[0]["bucket_label"] == "94-95°F"
    assert rows[0]["model_probability"] == 0.65
    assert round(rows[0]["edge"], 2) == 0.46


def test_build_market_opportunities_filters_late_priced_no_when_models_are_in_bucket():
    event = {
        "slug": "highest-temperature-in-jeddah-on-july-3-2026",
        "markets": [
            {
                "question": "Will the highest temperature in Jeddah be 36°C on July 3?",
                "slug": "highest-temperature-in-jeddah-on-july-3-2026-36c",
                "active": True,
                "closed": False,
                "enableOrderBook": True,
                "liquidity": "154",
                "volume": "6833",
                "outcomes": '["Yes", "No"]',
                "clobTokenIds": '["yes-36", "no-36"]',
            }
        ],
    }
    row = _row("jeddah")
    row["local_time"] = "19:22"
    row["current_max_so_far"] = None
    row["deb_prediction"] = 35.8
    row["model_cluster_sources"] = {"ECMWF": 35.7, "GFS": 36.1, "ICON": 36.2}
    row["distribution_full"] = [
        {"value": 36, "probability": 0.10},
        {"value": 37, "probability": 0.90},
    ]

    rows = build_market_opportunity_rows(
        [row],
        {"jeddah": event},
        {"yes-36": 0.99, "no-36": 0.01},
        max_price=0.20,
        side="both",
        positive_edge_only=True,
        min_edge=0.0,
        limit=20,
    )

    assert rows == []


def test_build_market_opportunities_filters_priced_no_when_models_support_market_bucket():
    event = {
        "slug": "highest-temperature-in-buenos-aires-on-july-3-2026",
        "markets": [
            {
                "question": "Will the highest temperature in Buenos Aires be 10°C on July 3?",
                "slug": "highest-temperature-in-buenos-aires-on-july-3-2026-10c",
                "active": True,
                "closed": False,
                "enableOrderBook": True,
                "liquidity": "141",
                "volume": "7749",
                "outcomes": '["Yes", "No"]',
                "clobTokenIds": '["yes-10", "no-10"]',
            }
        ],
    }
    row = _row("buenos aires")
    row["local_time"] = "15:21"
    row["current_max_so_far"] = None
    row["deb_prediction"] = 8.7
    row["model_cluster_sources"] = {
        "AI-GFS": 8.4,
        "ECMWF": 8.3,
        "ECMWF AIFS": 9.2,
        "GFS": 9.5,
        "ICON": 9.1,
        "GEM": 9.0,
        "GDPS": 8.9,
        "JMA": 8.8,
        "AROME HD": 9.5,
    }
    row["distribution_full"] = [
        {"value": 9, "probability": 0.27},
        {"value": 10, "probability": 0.73},
    ]

    rows = build_market_opportunity_rows(
        [row],
        {"buenos aires": event},
        {"yes-10": 0.94, "no-10": 0.08},
        max_price=0.20,
        side="both",
        positive_edge_only=True,
        min_edge=0.0,
        limit=20,
    )

    assert rows == []


def test_build_market_opportunities_keeps_morning_priced_no_for_time_risk():
    event = {
        "slug": "highest-temperature-in-buenos-aires-on-july-3-2026",
        "markets": [
            {
                "question": "Will the highest temperature in Buenos Aires be 10°C on July 3?",
                "slug": "highest-temperature-in-buenos-aires-on-july-3-2026-10c",
                "active": True,
                "closed": False,
                "enableOrderBook": True,
                "liquidity": "141",
                "volume": "7749",
                "outcomes": '["Yes", "No"]',
                "clobTokenIds": '["yes-10", "no-10"]',
            }
        ],
    }
    row = _row("buenos aires")
    row["local_time"] = "10:21"
    row["current_max_so_far"] = None
    row["deb_prediction"] = 8.7
    row["model_cluster_sources"] = {
        "AI-GFS": 8.4,
        "ECMWF": 8.3,
        "ECMWF AIFS": 9.2,
        "GFS": 9.5,
        "ICON": 9.1,
        "GEM": 9.0,
        "GDPS": 8.9,
        "JMA": 8.8,
        "AROME HD": 9.5,
    }
    row["distribution_full"] = [
        {"value": 9, "probability": 0.27},
        {"value": 10, "probability": 0.73},
    ]

    rows = build_market_opportunity_rows(
        [row],
        {"buenos aires": event},
        {"yes-10": 0.94, "no-10": 0.08},
        max_price=0.20,
        side="both",
        positive_edge_only=True,
        min_edge=0.0,
        limit=20,
    )

    assert len(rows) == 1
    assert rows[0]["bucket_label"] == "10°C"
    assert rows[0]["side"] == "no"


def test_build_market_opportunities_keeps_late_no_when_bucket_conflicts_with_anchors():
    event = {
        "slug": "highest-temperature-in-jeddah-on-july-3-2026",
        "markets": [
            {
                "question": "Will the highest temperature in Jeddah be 36°C on July 3?",
                "slug": "highest-temperature-in-jeddah-on-july-3-2026-36c",
                "active": True,
                "closed": False,
                "enableOrderBook": True,
                "liquidity": "154",
                "volume": "6833",
                "outcomes": '["Yes", "No"]',
                "clobTokenIds": '["yes-36", "no-36"]',
            }
        ],
    }
    row = _row("jeddah")
    row["local_time"] = "19:22"
    row["current_max_so_far"] = None
    row["deb_prediction"] = 31.0
    row["model_cluster_sources"] = {"ECMWF": 30.5, "GFS": 31.0, "ICON": 31.5}
    row["distribution_full"] = [
        {"value": 36, "probability": 0.10},
        {"value": 31, "probability": 0.90},
    ]

    rows = build_market_opportunity_rows(
        [row],
        {"jeddah": event},
        {"yes-36": 0.99, "no-36": 0.01},
        max_price=0.20,
        side="both",
        positive_edge_only=True,
        min_edge=0.0,
        limit=20,
    )

    assert len(rows) == 1
    assert rows[0]["bucket_label"] == "36°C"
    assert rows[0]["side"] == "no"
    assert rows[0]["side_probability"] == 0.90


def test_build_market_opportunities_keeps_late_no_when_models_are_above_bucket():
    event = {
        "slug": "highest-temperature-in-jeddah-on-july-3-2026",
        "markets": [
            {
                "question": "Will the highest temperature in Jeddah be 36°C on July 3?",
                "slug": "highest-temperature-in-jeddah-on-july-3-2026-36c",
                "active": True,
                "closed": False,
                "enableOrderBook": True,
                "liquidity": "154",
                "volume": "6833",
                "outcomes": '["Yes", "No"]',
                "clobTokenIds": '["yes-36", "no-36"]',
            }
        ],
    }
    row = _row("jeddah")
    row["local_time"] = "19:22"
    row["current_max_so_far"] = None
    row["deb_prediction"] = 35.3
    row["model_cluster_sources"] = {"ECMWF": 37.0, "GFS": 38.5, "ICON": 36.8}
    row["distribution_full"] = [
        {"value": 36, "probability": 0.10},
        {"value": 37, "probability": 0.90},
    ]

    rows = build_market_opportunity_rows(
        [row],
        {"jeddah": event},
        {"yes-36": 0.99, "no-36": 0.01},
        max_price=0.20,
        side="both",
        positive_edge_only=True,
        min_edge=0.0,
        limit=20,
    )

    assert len(rows) == 1
    assert rows[0]["models_above_bucket"] == 3
    assert rows[0]["models_in_bucket"] == 0
    assert rows[0]["side"] == "no"


def test_ops_market_opportunities_requires_ops_admin(monkeypatch):
    def deny(_request):
        raise HTTPException(status_code=403, detail="ops only")

    monkeypatch.setattr(market_opportunities, "_require_ops", deny)

    with pytest.raises(HTTPException) as exc:
        get_ops_market_opportunities(object())

    assert exc.value.status_code == 403


def test_ops_market_opportunities_degrades_when_quotes_fail(monkeypatch):
    monkeypatch.setattr(market_opportunities, "_require_ops", lambda _request: {"email": "ops@example.com"})
    monkeypatch.setattr(
        market_opportunities,
        "build_scan_terminal_payload",
        lambda *_args, **_kwargs: {"rows": [_row()]},
    )

    def fail_quotes(*_args, **_kwargs):
        raise RuntimeError("polymarket down")

    monkeypatch.setattr(market_opportunities, "_collect_events_and_prices", fail_quotes)

    payload = get_ops_market_opportunities(object())

    assert payload["summary"]["quote_status"] == "unavailable"
    assert payload["summary"]["error"] == "polymarket down"
    assert payload["rows"] == []


def test_ops_market_opportunities_reuses_prewarmed_terminal_snapshot(monkeypatch):
    captured = {}
    monkeypatch.setattr(market_opportunities, "_require_ops", lambda _request: {"email": "ops@example.com"})

    def fake_scan(filters, *, force_refresh=False):
        captured["filters"] = filters
        captured["force_refresh"] = force_refresh
        return {"rows": [_row()]}

    monkeypatch.setattr(market_opportunities, "build_scan_terminal_payload", fake_scan)
    monkeypatch.setattr(
        market_opportunities,
        "_collect_events_and_prices",
        lambda rows, _scanner: ({row["city"]: None for row in rows}, {}, "ready"),
    )

    payload = get_ops_market_opportunities(object(), max_price=0.90, min_edge=0.0)

    assert payload["summary"]["scanned_city_count"] == 1
    assert captured["force_refresh"] is False
    assert captured["filters"]["limit"] == 180
    assert captured["filters"]["min_edge_pct"] == 2
    assert captured["filters"]["min_liquidity"] == 500


def test_ops_market_opportunities_force_refreshes_empty_terminal_snapshot(monkeypatch):
    calls = []
    monkeypatch.setattr(market_opportunities, "_require_ops", lambda _request: {"email": "ops@example.com"})

    def fake_scan(_filters, *, force_refresh=False):
        calls.append(force_refresh)
        return {"rows": [_row()]} if force_refresh else {"rows": [], "status": "ready"}

    monkeypatch.setattr(market_opportunities, "build_scan_terminal_payload", fake_scan)
    monkeypatch.setattr(
        market_opportunities,
        "_collect_events_and_prices",
        lambda rows, _scanner: ({row["city"]: None for row in rows}, {}, "ready"),
    )

    payload = get_ops_market_opportunities(object(), max_price=0.90, min_edge=0.0)

    assert calls == [False, True]
    assert payload["summary"]["scanned_city_count"] == 1
    assert payload["summary"]["quote_status"] == "ready"
    assert payload["summary"]["scan_source"] == "force_refresh"


def test_ops_market_opportunities_reports_scan_empty_when_refresh_is_empty(monkeypatch):
    monkeypatch.setattr(market_opportunities, "_require_ops", lambda _request: {"email": "ops@example.com"})
    monkeypatch.setattr(
        market_opportunities,
        "build_scan_terminal_payload",
        lambda *_args, **_kwargs: {"rows": [], "status": "ready"},
    )

    payload = get_ops_market_opportunities(object(), max_price=0.90, min_edge=0.0)

    assert payload["summary"]["scanned_city_count"] == 0
    assert payload["summary"]["quote_status"] == "scan_empty"
    assert payload["summary"]["matched_event_count"] == 0
    assert payload["rows"] == []


def test_collect_events_and_prices_uses_gamma_hint_prices_without_clob_fanout():
    class FakeScanner:
        def fetch_event(self, _slug):
            return {
                "slug": "highest-temperature-in-shanghai-on-july-3-2026",
                "markets": [
                    {
                        "question": "Will the highest temperature in Shanghai be 33°C on July 3?",
                        "outcomes": '["Yes", "No"]',
                        "clobTokenIds": '["yes-33", "no-33"]',
                        "outcomePrices": '["0.12", "0.88"]',
                    }
                ],
            }

        def fetch_ask_price(self, _token_id):
            raise AssertionError("CLOB should not be called when Gamma outcomePrices are present")

    events, prices, status = market_opportunities._collect_events_and_prices(
        [_row()],
        FakeScanner(),
    )

    assert status == "ready"
    assert "shanghai" in events
    assert prices == {"yes-33": 0.12, "no-33": 0.88}


def test_collect_events_and_prices_stops_on_time_budget():
    class SlowScanner:
        def fetch_event(self, _slug):
            raise AssertionError("time budget should stop external event fetching")

        def fetch_ask_price(self, _token_id):
            raise AssertionError("time budget should stop external price fetching")

    events, prices, status = market_opportunities._collect_events_and_prices(
        [_row()],
        SlowScanner(),
        time_budget_sec=0,
    )

    assert status == "partial"
    assert events == {}
    assert prices == {}
