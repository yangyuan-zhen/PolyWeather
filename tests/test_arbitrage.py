"""Tests for the arbitrage comparison overview service and router."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import pytest

import web.analysis_service as analysis_service
import web.routes as legacy_routes
import web.services.arbitrage_service as arbitrage_service
import web.services.ops.market_opportunities as market_opportunities
from fastapi import HTTPException
from web.routers.arbitrage import router as arbitrage_router
from web.services.arbitrage_service import (
    _align_buckets,
    _build_event_slug,
    _collect_market_buckets,
    _load_city_deb_payload,
    _serialise_bucket,
    _sort_aligned_buckets,
    get_arbitrage_overview,
)


# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------


def _deb_distribution(values: List[int], probs: List[float]) -> List[Dict[str, Any]]:
    return [
        {"value": v, "range": f"[{v - 0.5}~{v + 0.5})", "probability": p}
        for v, p in zip(values, probs)
    ]


def _market(
    label: str,
    *,
    lower: Optional[int],
    upper: Optional[int],
    yes_cents: float = 10.0,
    no_cents: float = 90.0,
    slug: str = "mkt",
    volume: str = "1000",
    liquidity: str = "500",
) -> Dict[str, Any]:
    """Compose a minimal market dict matching the schema ``parse_market_option_from_question`` accepts."""
    if lower is not None and upper is not None and lower == upper:
        question = f"Will the highest temperature in Shanghai be {lower}°C on August 1?"
    elif lower is None and upper is not None:
        question = f"Will the highest temperature in Shanghai be {upper}°C or below on August 1?"
    elif lower is not None and upper is None:
        question = f"Will the highest temperature in Shanghai be {lower}°C or higher on August 1?"
    else:
        question = label
    return {
        "question": question,
        "slug": slug,
        "active": True,
        "closed": False,
        "enableOrderBook": True,
        "liquidity": liquidity,
        "volume": volume,
        "outcomes": '["Yes", "No"]',
        "clobTokenIds": f'["{slug}-yes", "{slug}-no"]',
        "outcomePrices": f"[{yes_cents / 100.0}, {no_cents / 100.0}]",
    }


def _event(markets: List[Dict[str, Any]], slug: str = "evt") -> Dict[str, Any]:
    return {
        "slug": slug,
        "title": "Highest temperature in Shanghai on August 1?",
        "markets": markets,
    }


class _FakeScanner:
    """Stub for PolymarketQuoteScanner: returns pre-seeded event; records ask calls."""

    def __init__(self, event: Optional[Dict[str, Any]] = None) -> None:
        self._event = event
        self.calls: List[str] = []

    def fetch_event(self, slug: str) -> Optional[Dict[str, Any]]:
        self.calls.append(f"event:{slug}")
        return self._event

    def fetch_ask_price(self, token_id: str) -> Optional[float]:
        self.calls.append(f"ask:{token_id}")
        # Tokens in the fixture map to hint prices stored on the market payload
        # (``outcomePrices`` is already in dollars), so we treat this as a
        # fallback that should rarely be hit by the budgeted collector.
        return None


def _stub_city_data(
    city_key: str,
    *,
    distribution: Optional[List[Dict[str, Any]]] = None,
    deb_prediction: Optional[float] = 32.5,
    engine: str = "deb_normal",
    temp_symbol: str = "°C",
    local_date: str = "2026-08-01",
) -> Dict[str, Any]:
    return {
        "name": city_key,
        "local_date": local_date,
        "temp_symbol": temp_symbol,
        "deb": {"prediction": deb_prediction} if deb_prediction is not None else {},
        "probabilities": {
            "mu": 32.5,
            "distribution": distribution or [],
            "distribution_all": distribution or [],
            "engine": engine,
        },
    }


@pytest.fixture(autouse=True)
def _reset_quote_caches(monkeypatch):
    """Ensure the in-process quote/event caches don't leak across tests."""
    monkeypatch.setattr(market_opportunities, "_EVENT_CACHE", {})
    monkeypatch.setattr(market_opportunities, "_PRICE_CACHE", {})
    monkeypatch.setattr(
        market_opportunities, "_CACHE_LOCK", market_opportunities._CACHE_LOCK
    )
    monkeypatch.setattr(arbitrage_service, "_ARBITRAGE_CITIES_CACHE", {})


# ---------------------------------------------------------------------------
# Slug generation (must reuse the existing helpers, not reimplement)
# ---------------------------------------------------------------------------


def test_build_event_slug_uses_existing_helpers_for_shanghai():
    slug = _build_event_slug("Shanghai", "2026-08-01")
    assert slug == "highest-temperature-in-shanghai-on-august-1-2026"


def test_build_event_slug_applies_nyc_special_case():
    slug = _build_event_slug("New York", "2026-08-01")
    assert slug == "highest-temperature-in-nyc-on-august-1-2026"


def test_build_event_slug_returns_none_for_invalid_date():
    assert _build_event_slug("Shanghai", "not-a-date") is None


def test_build_event_slug_returns_none_for_blank_display_name():
    assert _build_event_slug("", "2026-08-01") is None


# ---------------------------------------------------------------------------
# Alignment layer (the core "对齐层" business logic)
# ---------------------------------------------------------------------------


def test_align_buckets_direct_match_for_middle_buckets():
    market_buckets = [
        {
            "label": "32°C",
            "lower": 32,
            "upper": 32,
            "isTail": None,
            "market_yes_cents": 18.0,
        },
        {
            "label": "33°C",
            "lower": 33,
            "upper": 33,
            "isTail": None,
            "market_yes_cents": 41.0,
        },
    ]
    deb_distribution = _deb_distribution([31, 32, 33, 34], [0.10, 0.41, 0.46, 0.03])

    aligned = _align_buckets(market_buckets, deb_distribution)
    by_label = {b["label"]: b for b in aligned}

    assert by_label["32°C"]["deb_probability"] == 0.41
    assert by_label["32°C"]["value"] == 32
    assert by_label["32°C"]["isTail"] is None
    assert by_label["33°C"]["deb_probability"] == 0.46
    assert by_label["33°C"]["value"] == 33


def test_align_buckets_or_below_tail_aggregates_lower_or_equal():
    market_buckets = [
        {
            "label": "31°C or below",
            "lower": None,
            "upper": 31,
            "isTail": "below",
            "market_yes_cents": 1.2,
        },
        {
            "label": "32°C",
            "lower": 32,
            "upper": 32,
            "isTail": None,
            "market_yes_cents": 18.0,
        },
    ]
    deb_distribution = _deb_distribution(
        [30, 31, 32, 33, 34], [0.02, 0.05, 0.41, 0.46, 0.06]
    )

    aligned = _align_buckets(market_buckets, deb_distribution)
    by_label = {b["label"]: b for b in aligned}

    assert by_label["31°C or below"]["deb_probability"] == pytest.approx(0.07, abs=1e-4)
    assert by_label["31°C or below"]["isTail"] == "below"
    assert by_label["31°C or below"]["value"] == 31


def test_align_buckets_or_higher_tail_aggregates_greater_or_equal():
    market_buckets = [
        {
            "label": "36°C",
            "lower": 36,
            "upper": 36,
            "isTail": None,
            "market_yes_cents": 4.0,
        },
        {
            "label": "37°C or higher",
            "lower": 37,
            "upper": None,
            "isTail": "higher",
            "market_yes_cents": 1.0,
        },
    ]
    deb_distribution = _deb_distribution(
        [35, 36, 37, 38, 39], [0.20, 0.30, 0.25, 0.15, 0.10]
    )

    aligned = _align_buckets(market_buckets, deb_distribution)
    by_label = {b["label"]: b for b in aligned}

    assert by_label["37°C or higher"]["deb_probability"] == pytest.approx(
        0.50, abs=1e-4
    )
    assert by_label["37°C or higher"]["isTail"] == "higher"
    assert by_label["37°C or higher"]["value"] == 37


def test_align_buckets_pads_zero_when_deb_distribution_empty():
    market_buckets = [
        {
            "label": "33°C",
            "lower": 33,
            "upper": 33,
            "isTail": None,
            "market_yes_cents": 18.0,
        },
    ]

    aligned = _align_buckets(market_buckets, [])
    assert aligned[0]["deb_probability"] == 0.0


def test_align_buckets_pads_zero_when_market_value_outside_deb_range():
    market_buckets = [
        {
            "label": "45°C",
            "lower": 45,
            "upper": 45,
            "isTail": None,
            "market_yes_cents": 0.5,
        },
    ]
    deb_distribution = _deb_distribution([30, 31, 32], [0.2, 0.5, 0.3])

    aligned = _align_buckets(market_buckets, deb_distribution)
    assert aligned[0]["deb_probability"] == 0.0


def test_sort_aligned_buckets_orders_below_exact_higher_ascending():
    market_buckets = [
        {"label": "37°C or higher", "lower": 37, "upper": None, "isTail": "higher"},
        {"label": "31°C or below", "lower": None, "upper": 31, "isTail": "below"},
        {"label": "35°C", "lower": 35, "upper": 35, "isTail": None},
        {"label": "33°C", "lower": 33, "upper": 33, "isTail": None},
    ]
    deb_distribution = _deb_distribution(
        [30, 31, 32, 33, 34, 35, 36, 37, 38], [0.05] * 9
    )

    aligned = _align_buckets(market_buckets, deb_distribution)
    sorted_buckets = _sort_aligned_buckets(aligned)
    labels = [b["label"] for b in sorted_buckets]
    assert labels == [
        "31°C or below",
        "33°C",
        "35°C",
        "37°C or higher",
    ]


def test_serialise_bucket_emits_only_design_doc_fields():
    payload = _serialise_bucket(
        {
            "label": "33°C",
            "value": 33,
            "isTail": None,
            "deb_probability": 0.4123,
            "market_yes_cents": 41.0,
            "market_no_cents": 59.0,
            "market_volume_usd": 1234.5,
            "market_liquidity_usd": 678.9,
            "market_slug": "highest-temperature-in-shanghai-on-august-1-2026-33c",
            "market_url": "https://polymarket.com/event/foo",
        }
    )
    assert payload == {
        "label": "33°C",
        "value": 33,
        "isTail": None,
        "deb_probability": 0.4123,
        "market_yes_cents": 41.0,
        "market_no_cents": 59.0,
        "market_volume_usd": 1234.5,
        "market_liquidity_usd": 678.9,
        "market_slug": "highest-temperature-in-shanghai-on-august-1-2026-33c",
        "market_url": "https://polymarket.com/event/foo",
    }


# ---------------------------------------------------------------------------
# Bucket collection / price fallback
# ---------------------------------------------------------------------------


def test_collect_market_buckets_uses_hint_prices_without_calling_clob():
    markets = [
        _market("33°C", lower=33, upper=33, yes_cents=41.0, no_cents=59.0),
    ]
    event = _event(markets)
    scanner = _FakeScanner(event=event)

    buckets, _yes, _no, status = _collect_market_buckets(
        event, scanner, time_budget_sec=2.0
    )

    assert status == "ready"
    assert len(buckets) == 1
    bucket = buckets[0]
    assert bucket["label"] == "33°C"
    assert bucket["market_yes_cents"] == 41.0
    assert bucket["market_no_cents"] == 59.0
    assert bucket["isTail"] is None
    # Hint prices are picked up directly; CLOB fallback is not invoked.
    assert all(not call.startswith("ask:") for call in scanner.calls)


def test_collect_market_buckets_returns_empty_when_event_missing():
    scanner = _FakeScanner(event=None)
    buckets, _yes, _no, status = _collect_market_buckets(None, scanner)
    assert buckets == []
    assert status == "event_missing"


def test_collect_market_buckets_marks_partial_when_budget_exhausted(monkeypatch):
    markets = [
        _market("33°C", lower=33, upper=33, yes_cents=41.0, no_cents=59.0),
        _market("34°C", lower=34, upper=34, yes_cents=12.0, no_cents=88.0, slug="mkt2"),
    ]
    event = _event(markets)

    # Strip outcomePrices so every token needs a CLOB round-trip; force the
    # collector past its time budget on the first token.
    for market in event["markets"]:
        market["outcomePrices"] = ""
    scanner = _FakeScanner(event=event)
    # The collector uses ``time.monotonic``; return an already-exhausted clock
    # on the second call so the budget check trips before any CLOB fetch.
    fake_time = iter([0.0, 100.0])
    monkeypatch.setattr("time.monotonic", lambda: next(fake_time))

    buckets, _yes, _no, status = _collect_market_buckets(
        event, scanner, time_budget_sec=2.0
    )
    assert status == "partial"
    assert len(buckets) == 2  # both markets still parsed; only price fetch is partial


# ---------------------------------------------------------------------------
# End-to-end service: full payload, aligned buckets, totals
# ---------------------------------------------------------------------------


def _install_service_mocks(
    monkeypatch,
    *,
    city_data: Optional[Dict[str, Any]] = None,
    event: Optional[Dict[str, Any]] = None,
    raise_on_event: Optional[Exception] = None,
):
    if city_data is None:
        city_data = _stub_city_data(
            "shanghai",
            distribution=_deb_distribution(
                [31, 32, 33, 34, 35], [0.05, 0.20, 0.45, 0.25, 0.05]
            ),
            deb_prediction=33.1,
            engine="deb_normal",
            temp_symbol="°C",
            local_date="2026-08-01",
        )
    monkeypatch.setattr(
        legacy_routes, "_normalize_city_or_404", lambda name: name.strip().lower()
    )
    monkeypatch.setattr(analysis_service, "_analyze", lambda *a, **kw: city_data)
    monkeypatch.setattr(
        legacy_routes, "CITY_REGISTRY", {"shanghai": {"name": "Shanghai"}}
    )
    scanner = _FakeScanner(event=event)

    def _scanner_factory(*_a, **_kw):
        if raise_on_event is not None:

            def _raise(slug):
                raise raise_on_event

            scanner.fetch_event = _raise  # type: ignore[assignment]
        return scanner

    monkeypatch.setattr(arbitrage_service, "PolymarketQuoteScanner", _scanner_factory)
    return scanner


def test_get_arbitrage_overview_returns_aligned_buckets_and_totals(monkeypatch):
    distribution = _deb_distribution(
        [31, 32, 33, 34, 35], [0.05, 0.20, 0.45, 0.25, 0.05]
    )
    city_data = _stub_city_data(
        "shanghai",
        distribution=distribution,
        deb_prediction=33.1,
        engine="deb_normal",
    )
    markets = [
        _market(
            "31°C or below",
            lower=None,
            upper=31,
            yes_cents=1.2,
            no_cents=98.8,
            slug="mkt-31b",
        ),
        _market(
            "32°C", lower=32, upper=32, yes_cents=18.0, no_cents=82.0, slug="mkt-32"
        ),
        _market(
            "33°C", lower=33, upper=33, yes_cents=41.0, no_cents=59.0, slug="mkt-33"
        ),
        _market(
            "34°C", lower=34, upper=34, yes_cents=25.0, no_cents=75.0, slug="mkt-34"
        ),
        _market(
            "35°C or higher",
            lower=35,
            upper=None,
            yes_cents=12.0,
            no_cents=88.0,
            slug="mkt-35h",
        ),
    ]
    event = _event(markets, slug="highest-temperature-in-shanghai-on-august-1-2026")
    scanner = _install_service_mocks(monkeypatch, city_data=city_data, event=event)

    payload = get_arbitrage_overview(
        _FakeRequest(), city="Shanghai", force_refresh=False
    )

    assert payload["city"] == "shanghai"
    assert payload["engine"] == "deb_normal"
    assert payload["temp_symbol"] == "°C"
    assert payload["market_available"] is True
    assert payload["error"] is None
    assert payload["total_market_yes_sum"] == pytest.approx(97.2, abs=1e-2)
    assert (
        payload["_meta"]["event_slug"]
        == "highest-temperature-in-shanghai-on-august-1-2026"
    )
    assert payload["_meta"]["quote_status"] == "ready"

    by_label = {b["label"]: b for b in payload["buckets"]}
    # Tails pinned to the boundary value used for sorting.
    assert by_label["31°C or below"]["isTail"] == "below"
    assert by_label["31°C or below"]["value"] == 31
    assert by_label["31°C or below"]["deb_probability"] == pytest.approx(0.05, abs=1e-4)
    # Middle bucket: direct match.
    assert by_label["33°C"]["deb_probability"] == pytest.approx(0.45, abs=1e-4)
    # Or-higher tail aggregates the top buckets.
    assert by_label["35°C or higher"]["isTail"] == "higher"
    assert by_label["35°C or higher"]["deb_probability"] == pytest.approx(
        0.05, abs=1e-4
    )

    # Buckets come back sorted: below tail, then ascending, then higher tail.
    labels = [b["label"] for b in payload["buckets"]]
    assert labels == [
        "31°C or below",
        "32°C",
        "33°C",
        "34°C",
        "35°C or higher",
    ]
    # Scanner was used to fetch the event exactly once.
    assert (
        scanner.calls
        and scanner.calls[0] == "event:highest-temperature-in-shanghai-on-august-1-2026"
    )


def test_get_arbitrage_overview_handles_market_unavailable(monkeypatch):
    city_data = _stub_city_data(
        "shanghai",
        distribution=_deb_distribution(
            [31, 32, 33, 34, 35], [0.05, 0.20, 0.45, 0.25, 0.05]
        ),
        deb_prediction=33.1,
        engine="deb_normal",
    )
    _install_service_mocks(monkeypatch, city_data=city_data, event=None)

    payload = get_arbitrage_overview(
        _FakeRequest(), city="Shanghai", force_refresh=False
    )

    assert payload["market_available"] is False
    assert payload["buckets"] == []
    assert payload["total_market_yes_sum"] is None
    # Even with no market, the engine label still reports DEB state.
    assert payload["engine"] == "deb_normal"
    assert "market_event_unavailable" in (payload["error"] or "")


def test_get_arbitrage_overview_handles_both_unavailable(monkeypatch):
    city_data = _stub_city_data(
        "shanghai",
        distribution=[],
        deb_prediction=None,
        engine="weathernext2",
    )
    _install_service_mocks(monkeypatch, city_data=city_data, event=None)

    payload = get_arbitrage_overview(
        _FakeRequest(), city="Shanghai", force_refresh=False
    )

    assert payload["market_available"] is False
    assert payload["buckets"] == []
    # DEB unavailable => engine falls through to weathernext2 from data.
    assert payload["engine"] in {"weathernext2", "legacy", "unavailable"}
    assert payload["error"] is not None


def test_get_arbitrage_overview_unknown_city_returns_404_message(monkeypatch):
    def _raise(_name: str) -> str:
        raise HTTPException(status_code=404, detail="Unknown city: mars")

    monkeypatch.setattr(legacy_routes, "_normalize_city_or_404", _raise)

    payload = get_arbitrage_overview(_FakeRequest(), city="Mars", force_refresh=False)
    assert payload["market_available"] is False
    assert payload["buckets"] == []
    assert payload["error"] == "Unknown city: mars"


def test_load_city_deb_payload_handles_missing_probabilities_block(monkeypatch):
    city_data = {
        "name": "shanghai",
        "local_date": "2026-08-01",
        "temp_symbol": "°C",
        "deb": {"prediction": 33.0},
        "probabilities": {},
    }
    monkeypatch.setattr(analysis_service, "_analyze", lambda *a, **kw: city_data)
    distribution, deb_value, engine = _load_city_deb_payload(
        _FakeRequest(), "shanghai", force_refresh=False
    )
    assert distribution == []
    assert deb_value == 33.0
    assert engine == "legacy"


def test_load_city_deb_payload_distinguishes_deb_normal_vs_weathernext2(monkeypatch):
    deb_data = _stub_city_data(
        "shanghai",
        distribution=_deb_distribution([32, 33, 34], [0.2, 0.5, 0.3]),
        deb_prediction=33.0,
        engine="weathernext2",
    )
    monkeypatch.setattr(analysis_service, "_analyze", lambda *a, **kw: deb_data)
    _distribution, _deb, engine = _load_city_deb_payload(
        _FakeRequest(), "shanghai", force_refresh=False
    )
    assert engine == "weathernext2"


# ---------------------------------------------------------------------------
# Router registration & HTTP contract
# ---------------------------------------------------------------------------


class _FakeRequest:
    def __init__(self) -> None:
        self.state = type("State", (), {})()


def test_arbitrage_router_registers_expected_route():
    paths = {
        getattr(route, "path", None): tuple(
            sorted(getattr(route, "methods", set()) or [])
        )
        for route in arbitrage_router.routes
    }
    assert "/api/arbitrage/overview" in paths
    assert "GET" in paths["/api/arbitrage/overview"]


def test_arbitrage_overview_endpoint_returns_no_store_cache(monkeypatch):
    from fastapi.testclient import TestClient

    from web.app import app

    city_data = _stub_city_data(
        "shanghai",
        distribution=_deb_distribution([32, 33, 34], [0.2, 0.5, 0.3]),
        deb_prediction=33.0,
    )
    markets = [
        _market(
            "33°C", lower=33, upper=33, yes_cents=50.0, no_cents=50.0, slug="mkt-33"
        )
    ]
    event = _event(markets, slug="highest-temperature-in-shanghai-on-august-1-2026")
    _install_service_mocks(monkeypatch, city_data=city_data, event=event)

    client = TestClient(app)
    response = client.get("/api/arbitrage/overview?city=Shanghai")

    assert response.status_code == 200
    body = response.json()
    assert body["city"] == "shanghai"
    assert body["market_available"] is True
    assert body["engine"] == "deb_normal"
    assert response.headers["cache-control"] == "no-store, max-age=0"
    assert response.headers["cloudflare-cdn-cache-control"] == "no-store, max-age=0"


# ---------------------------------------------------------------------------
# Dynamic city enumeration (list_arbitrage_cities + /api/arbitrage/cities)
# ---------------------------------------------------------------------------


_CITIES_REGISTRY_3 = {
    "shanghai": {"name": "Shanghai"},
    "london": {"name": "London"},
    "paris": {"name": "Paris"},
}

_FALLBACK_CITY_KEYS = [
    "shanghai",
    "tokyo",
    "seoul",
    "london",
    "paris",
    "new york",
    "miami",
    "chicago",
]


def _search_event(title: str) -> Dict[str, Any]:
    return {"title": title, "slug": "evt-slug"}


def test_list_arbitrage_cities_returns_discovered_cities_in_registry_order(
    monkeypatch,
):
    monkeypatch.setattr(legacy_routes, "CITY_REGISTRY", _CITIES_REGISTRY_3)
    monkeypatch.setattr(
        arbitrage_service,
        "_fetch_public_search_events",
        lambda: [
            _search_event("Highest temperature in Shanghai on August 1?"),
            _search_event("Highest temperature in London on August 1?"),
        ],
    )

    payload = arbitrage_service.list_arbitrage_cities(_FakeRequest())

    assert payload["fallback"] is False
    # Paris has no active event, so only Shanghai/London survive, in the
    # CITY_REGISTRY iteration order (not sorted alphabetically).
    assert payload["cities"] == [
        {"key": "shanghai", "display_name": "Shanghai"},
        {"key": "london", "display_name": "London"},
    ]
    assert payload["generated_at"]


def test_list_arbitrage_cities_resolves_nyc_alias_to_new_york(monkeypatch):
    monkeypatch.setattr(
        legacy_routes, "CITY_REGISTRY", {"new york": {"name": "New York"}}
    )
    monkeypatch.setattr(
        arbitrage_service,
        "_fetch_public_search_events",
        lambda: [_search_event("Highest temperature in NYC on August 1?")],
    )

    payload = arbitrage_service.list_arbitrage_cities(_FakeRequest())

    assert payload["fallback"] is False
    assert payload["cities"] == [{"key": "new york", "display_name": "New York"}]


def test_list_arbitrage_cities_loose_match_seoul_incheon(monkeypatch):
    monkeypatch.setattr(
        legacy_routes,
        "CITY_REGISTRY",
        {"seoul": {"name": "Seoul"}, "busan": {"name": "Busan"}},
    )
    monkeypatch.setattr(
        arbitrage_service,
        "_fetch_public_search_events",
        lambda: [_search_event("Highest temperature in Seoul (Incheon) on August 1?")],
    )

    payload = arbitrage_service.list_arbitrage_cities(_FakeRequest())

    assert payload["fallback"] is False
    assert payload["cities"] == [{"key": "seoul", "display_name": "Seoul"}]


def test_list_arbitrage_cities_falls_back_when_request_fails(monkeypatch):
    monkeypatch.setattr(legacy_routes, "CITY_REGISTRY", _CITIES_REGISTRY_3)
    monkeypatch.setattr(arbitrage_service, "_fetch_public_search_events", lambda: [])

    payload = arbitrage_service.list_arbitrage_cities(_FakeRequest())

    assert payload["fallback"] is True
    assert [c["key"] for c in payload["cities"]] == _FALLBACK_CITY_KEYS


def test_list_arbitrage_cities_falls_back_when_no_monitored_city_matches(monkeypatch):
    monkeypatch.setattr(legacy_routes, "CITY_REGISTRY", _CITIES_REGISTRY_3)
    monkeypatch.setattr(
        arbitrage_service,
        "_fetch_public_search_events",
        lambda: [
            _search_event("Highest temperature in Zhengzhou on August 1?"),
            _search_event("Some unrelated market title"),
        ],
    )

    payload = arbitrage_service.list_arbitrage_cities(_FakeRequest())

    assert payload["fallback"] is True
    assert [c["key"] for c in payload["cities"]] == _FALLBACK_CITY_KEYS


def test_list_arbitrage_cities_caches_payload_for_one_hour(monkeypatch):
    monkeypatch.setattr(legacy_routes, "CITY_REGISTRY", _CITIES_REGISTRY_3)
    calls: List[int] = []

    def _fetch() -> List[Dict[str, Any]]:
        calls.append(1)
        return [_search_event("Highest temperature in Shanghai on August 1?")]

    monkeypatch.setattr(arbitrage_service, "_fetch_public_search_events", _fetch)

    first = arbitrage_service.list_arbitrage_cities(_FakeRequest())
    second = arbitrage_service.list_arbitrage_cities(_FakeRequest())

    assert len(calls) == 1
    assert second["fallback"] is False
    assert second["cities"] == first["cities"]


def test_arbitrage_router_registers_cities_route():
    paths = {
        getattr(route, "path", None): tuple(
            sorted(getattr(route, "methods", set()) or [])
        )
        for route in arbitrage_router.routes
    }
    assert "/api/arbitrage/cities" in paths
    assert "GET" in paths["/api/arbitrage/cities"]


def test_arbitrage_cities_endpoint_returns_no_store_cache(monkeypatch):
    from fastapi.testclient import TestClient

    from web.app import app

    monkeypatch.setattr(legacy_routes, "CITY_REGISTRY", _CITIES_REGISTRY_3)
    monkeypatch.setattr(
        arbitrage_service,
        "_fetch_public_search_events",
        lambda: [_search_event("Highest temperature in Shanghai on August 1?")],
    )

    client = TestClient(app)
    response = client.get("/api/arbitrage/cities")

    assert response.status_code == 200
    body = response.json()
    assert body["fallback"] is False
    assert body["cities"] == [{"key": "shanghai", "display_name": "Shanghai"}]
    assert response.headers["cache-control"] == "no-store, max-age=0"
    assert response.headers["cloudflare-cdn-cache-control"] == "no-store, max-age=0"
