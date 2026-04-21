from src.data_collection.polymarket_readonly import PolymarketReadOnlyLayer


def test_normalize_orderbook_uses_sorted_best_prices():
    layer = PolymarketReadOnlyLayer()
    raw = {
        "bids": [
            {"price": "0.24", "size": "10"},
            {"price": "0.31", "size": "5"},
            {"price": "0.27", "size": "8"},
        ],
        "asks": [
            {"price": "0.44", "size": "9"},
            {"price": "0.39", "size": "6"},
            {"price": "0.42", "size": "4"},
        ],
    }

    book, _liquidity = layer._normalize_orderbook(raw)

    assert book is not None
    assert book["best_bid"] == 0.31
    assert book["best_ask"] == 0.39
    assert book["bid_levels"][0][0] == 0.31
    assert book["ask_levels"][0][0] == 0.39


def test_extract_market_bucket_range_supports_fahrenheit_ranges():
    layer = PolymarketReadOnlyLayer()
    market = {
        "question": "Will the highest temperature in Miami be between 80-81°F on April 21?",
        "slug": "highest-temperature-in-miami-on-april-21-2026-80-81f",
    }

    assert layer._extract_market_bucket_range(market) == (80.0, 81.0, "F")
    assert layer._extract_market_bucket_temp(market) == 80.5
    assert layer._extract_market_bucket_label(market, 80.5) == "80-81F"


def test_fetch_token_market_data_prefers_orderbook_executable_prices():
    class FakeClob:
        @staticmethod
        def get_price(_token_id: str, side: str):
            if side == "BUY":
                return {"price": "0.11"}
            return {"price": "0.88"}

        @staticmethod
        def get_midpoint(_token_id: str):
            return {"midpoint": "0.50"}

        @staticmethod
        def get_last_trade_price(_token_id: str):
            return {"price": "0.49"}

        @staticmethod
        def get_order_book(_token_id: str):
            return {
                "bids": [{"price": "0.24", "size": "10"}],
                "asks": [{"price": "0.26", "size": "12"}],
            }

    layer = PolymarketReadOnlyLayer()
    layer._get_clob_client = lambda: FakeClob()

    data = layer._fetch_token_market_data("token-1")

    # Executable BUY should match best ask from the book.
    assert data["buy"] == 0.26
    # Executable SELL should match best bid from the book.
    assert data["sell"] == 0.24
    assert data["midpoint"] == 0.5
    assert data["last_trade_price"] == 0.49
    assert data["quote_source"] == "polymarket_clob_client"


def test_get_token_market_data_prefers_fresh_ws_cache():
    layer = PolymarketReadOnlyLayer()

    class FakeWsCache:
        enabled = True

        def subscribe(self, asset_ids):
            self.asset_ids = list(asset_ids)

        @staticmethod
        def get_market_data(_token_id):
            return {
                "buy": 0.33,
                "sell": 0.31,
                "midpoint": 0.32,
                "quote_source": "polymarket_ws",
                "quote_age_ms": 80,
            }

    layer._ws_quote_cache = FakeWsCache()
    layer._fetch_token_market_data = lambda _token_id: {"buy": 0.99}

    data = layer._get_token_market_data("token-1")

    assert data["buy"] == 0.33
    assert data["sell"] == 0.31
    assert data["quote_source"] == "polymarket_ws"


def test_price_analysis_computes_edge_kelly_and_lock():
    layer = PolymarketReadOnlyLayer()

    analysis = layer._build_price_analysis(
        model_probability=0.62,
        yes_buy=0.52,
        yes_sell=0.50,
        no_buy=0.45,
        no_sell=0.43,
    )

    assert analysis["available"] is True
    assert abs(analysis["yes"]["edge"] - 0.10) < 0.000001
    assert round(analysis["yes"]["kelly_fraction"], 6) == round(
        (0.62 - 0.52) / (1.0 - 0.52),
        6,
    )
    assert round(analysis["yes"]["quarter_kelly"], 6) == round(
        ((0.62 - 0.52) / (1.0 - 0.52)) / 4.0,
        6,
    )
    assert abs(analysis["no"]["edge"] - -0.07) < 0.000001
    assert analysis["lock"]["available"] is True
    assert round(analysis["lock"]["edge"], 6) == 0.03
    assert analysis["best_side"] == "yes"


def test_trade_state_keeps_open_markets_tradable_after_gamma_end_date():
    layer = PolymarketReadOnlyLayer()

    state = layer._market_trade_state(
        {
            "active": True,
            "closed": False,
            "acceptingOrders": True,
            "endDate": "2020-01-01T00:00:00Z",
        }
    )

    assert state["tradable"] is True
    assert state["reason"] is None
    assert state["ended_at_utc"] == "2020-01-01T00:00:00+00:00"


def test_hydrate_bucket_prices_uses_executable_quotes_without_midpoint():
    layer = PolymarketReadOnlyLayer()
    buckets = [
        {
            "temp": 14.0,
            "yes_token_id": "yes-token",
            "no_token_id": "no-token",
        }
    ]

    def _fake_get_token_market_data(token_id):
        if token_id == "yes-token":
            return {
                "buy": 0.66,
                "sell": 0.70,
                "quote_source": "polymarket_clob_rest",
                "quote_age_ms": 0,
            }
        return {"buy": 0.30, "sell": 0.36}

    layer._get_token_market_data = _fake_get_token_market_data

    layer._hydrate_bucket_prices(buckets)

    assert buckets[0]["yes_buy"] == 0.66
    assert buckets[0]["yes_sell"] == 0.70
    assert buckets[0]["no_buy"] == 0.30
    assert buckets[0]["no_sell"] == 0.36
    assert round(buckets[0]["market_price"], 6) == 0.68
    assert round(buckets[0]["probability"], 6) == 0.68
    assert buckets[0]["quote_source"] == "polymarket_clob_rest"


def test_build_top_temperature_buckets_dedupes_same_temperature():
    layer = PolymarketReadOnlyLayer()

    primary_market = {
        "slug": "highest-temperature-in-ankara-on-march-12-2026-14c-or-higher",
        "question": "Will the highest temperature in Ankara be 14C or higher on March 12?",
        "volumeNum": 1000,
    }
    markets = [
        primary_market,
        {
            "slug": "highest-temperature-in-ankara-on-march-12-2026-14c-or-higher-v2",
            "question": "Will the highest temperature in Ankara be 14C or higher on March 12? (v2)",
            "volumeNum": 900,
        },
        {
            "slug": "highest-temperature-in-ankara-on-march-12-2026-13c-or-higher",
            "question": "Will the highest temperature in Ankara be 13C or higher on March 12?",
            "volumeNum": 1100,
        },
        {
            "slug": "highest-temperature-in-ankara-on-march-12-2026-12c-or-higher",
            "question": "Will the highest temperature in Ankara be 12C or higher on March 12?",
            "volumeNum": 1200,
        },
        {
            "slug": "highest-temperature-in-ankara-on-march-12-2026-14c-or-lower",
            "question": "Will the highest temperature in Ankara be 14C or lower on March 12?",
            "volumeNum": 1300,
        },
    ]
    layer._collect_related_temperature_markets = (
        lambda city_key, target_date, primary_market: markets
    )

    def _fake_extract_market_tokens(market):
        slug = str(market.get("slug") or "")
        return [
            {"outcome": "Yes", "token_id": f"{slug}|yes"},
            {"outcome": "No", "token_id": f"{slug}|no"},
        ]

    layer._extract_market_tokens = _fake_extract_market_tokens

    midpoint_map = {
        "highest-temperature-in-ankara-on-march-12-2026-14c-or-higher": 0.79,
        "highest-temperature-in-ankara-on-march-12-2026-14c-or-higher-v2": 0.16,
        "highest-temperature-in-ankara-on-march-12-2026-13c-or-higher": 0.06,
        "highest-temperature-in-ankara-on-march-12-2026-12c-or-higher": 0.01,
        "highest-temperature-in-ankara-on-march-12-2026-14c-or-lower": 0.92,
    }

    def _fake_get_token_market_data(token_id):
        slug, side = str(token_id).split("|", 1)
        if side == "yes":
            midpoint = midpoint_map.get(slug, 0.5)
            return {
                "midpoint": midpoint,
                "buy": max(0.0, min(1.0, midpoint + 0.01)),
                "sell": max(0.0, min(1.0, midpoint - 0.01)),
            }
        midpoint = 1.0 - midpoint_map.get(slug, 0.5)
        return {
            "midpoint": midpoint,
            "buy": max(0.0, min(1.0, midpoint + 0.01)),
            "sell": max(0.0, min(1.0, midpoint - 0.01)),
        }

    layer._get_token_market_data = _fake_get_token_market_data

    rows = layer._build_top_temperature_buckets(
        city_key="ankara",
        target_date="2026-03-12",
        primary_market=primary_market,
        limit=4,
    )

    values = [row.get("value") for row in rows]
    token_ids = [row.get("yes_token_id") for row in rows]
    assert len(values) == len(set(values))
    assert len(token_ids) == len(set(token_ids))
    assert rows[0]["value"] == 14.0
    assert rows[0]["yes_token_id"] == (
        "highest-temperature-in-ankara-on-march-12-2026-14c-or-higher|yes"
    )
    assert all(not str(row.get("label") or "").startswith("<=") for row in rows)
