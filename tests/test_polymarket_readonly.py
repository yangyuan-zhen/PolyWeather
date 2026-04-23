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


def test_fetch_token_market_data_uses_rest_orderbook_executable_prices():
    layer = PolymarketReadOnlyLayer()
    payloads = {
        ("/price", "BUY"): {"price": "0.11"},
        ("/price", "SELL"): {"price": "0.88"},
        ("/midpoint", None): {"midpoint": "0.50"},
        ("/last-trade-price", None): {"price": "0.49"},
        ("/book", None): {
            "bids": [{"price": "0.24", "size": "10"}],
            "asks": [{"price": "0.26", "size": "12"}],
        },
    }

    def _fake_clob_get(path, params):
        if path == "/price":
            return payloads[(path, params.get("side"))]
        return payloads[(path, None)]

    layer._clob_get = _fake_clob_get

    data = layer._fetch_token_market_data("token-1")

    # Executable BUY should match best ask from the book.
    assert data["buy"] == 0.26
    # Executable SELL should match best bid from the book.
    assert data["sell"] == 0.24
    assert data["midpoint"] == 0.5
    assert data["last_trade_price"] == 0.49
    assert data["quote_source"] == "polymarket_clob_rest"


def test_get_token_market_data_uses_price_cache_within_ttl():
    layer = PolymarketReadOnlyLayer()
    calls = []

    def _fake_fetch(_token_id):
        calls.append(_token_id)
        return {"buy": 0.33, "sell": 0.31, "midpoint": 0.32}

    layer._fetch_token_market_data = _fake_fetch

    first = layer._get_token_market_data("token-1")
    second = layer._get_token_market_data("token-1")

    assert first["buy"] == 0.33
    assert second["midpoint"] == 0.32
    assert calls == ["token-1"]


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


def test_lau_fau_shan_uses_shenzhen_market_city():
    layer = PolymarketReadOnlyLayer()
    captured = {}

    def _fake_find_primary_market(city_key, target_date, **_kwargs):
        captured["primary_city_key"] = city_key
        captured["target_date"] = target_date
        return (
            {
                "id": "market-1",
                "question": "Will the highest temperature in Shenzhen be 30C or higher on April 23?",
                "slug": "highest-temperature-in-shenzhen-on-april-23-2026-30c-or-higher",
                "conditionId": "condition-1",
                "active": True,
                "closed": False,
                "acceptingOrders": True,
                "volumeNum": 1000,
                "liquidityNum": 500,
            },
            None,
        )

    layer._find_primary_market = _fake_find_primary_market
    layer._extract_market_tokens = lambda _market: [
        {"outcome": "Yes", "token_id": "yes-token"},
        {"outcome": "No", "token_id": "no-token"},
    ]
    layer._get_token_market_data = lambda token_id: (
        {"buy": 0.42, "sell": 0.40, "midpoint": 0.41}
        if token_id == "yes-token"
        else {"buy": 0.61, "sell": 0.59, "midpoint": 0.60}
    )

    def _fake_build_top_temperature_buckets(city_key, **_kwargs):
        captured["bucket_city_key"] = city_key
        return []

    layer._build_top_temperature_buckets = _fake_build_top_temperature_buckets

    scan = layer.build_market_scan(
        city="Lau Fau Shan",
        target_date="2026-04-23",
        temperature_bucket={"temp": 30, "probability": 0.58},
        model_probability=0.58,
    )

    assert captured["primary_city_key"] == "shenzhen"
    assert captured["bucket_city_key"] == "shenzhen"
    assert scan["city_key"] == "lau fau shan"
    assert scan["market_city_key"] == "shenzhen"
    assert scan["selected_slug"] == "highest-temperature-in-shenzhen-on-april-23-2026-30c-or-higher"


def test_build_market_scan_lite_skips_related_buckets():
    layer = PolymarketReadOnlyLayer()

    layer._find_primary_market = lambda *_args, **_kwargs: (
        {
            "id": "market-1",
            "question": "Will the highest temperature in Shenzhen be 30C or higher on April 23?",
            "slug": "highest-temperature-in-shenzhen-on-april-23-2026-30c-or-higher",
            "conditionId": "condition-1",
            "active": True,
            "closed": False,
            "acceptingOrders": True,
        },
        None,
    )
    layer._extract_market_tokens = lambda _market: [
        {"outcome": "Yes", "token_id": "yes-token"},
        {"outcome": "No", "token_id": "no-token"},
    ]
    layer._get_token_market_data = lambda token_id: (
        {"buy": 0.42, "sell": 0.40, "midpoint": 0.41}
        if token_id == "yes-token"
        else {"buy": 0.61, "sell": 0.59, "midpoint": 0.60}
    )

    called = {"bucket": 0}

    def _fake_build_top_temperature_buckets(**_kwargs):
        called["bucket"] += 1
        return [{"value": 30.0, "market_price": 0.41}]

    layer._build_top_temperature_buckets = _fake_build_top_temperature_buckets

    scan = layer.build_market_scan(
        city="Shenzhen",
        target_date="2026-04-23",
        temperature_bucket={"temp": 30, "probability": 0.58},
        model_probability=0.58,
        include_related_buckets=False,
    )

    assert scan["scan_scope"] == "lite"
    assert scan["midpoint"] == 0.41
    assert round(scan["spread"], 6) == 0.02
    assert scan["top_buckets"] == []
    assert scan["all_buckets"] == []
    assert called["bucket"] == 0


def test_build_market_scan_aggregates_emos_probability_for_threshold_market():
    layer = PolymarketReadOnlyLayer()

    layer._find_primary_market = lambda *_args, **_kwargs: (
        {
            "id": "market-1",
            "question": "Will the highest temperature in Shenzhen be 30C or higher on April 23?",
            "slug": "highest-temperature-in-shenzhen-on-april-23-2026-30c-or-higher",
            "conditionId": "condition-1",
            "active": True,
            "closed": False,
            "acceptingOrders": True,
        },
        None,
    )
    layer._extract_market_tokens = lambda _market: [
        {"outcome": "Yes", "token_id": "yes-token"},
        {"outcome": "No", "token_id": "no-token"},
    ]
    layer._get_token_market_data = lambda token_id: (
        {"buy": 0.42, "sell": 0.40, "midpoint": 0.41}
        if token_id == "yes-token"
        else {"buy": 0.61, "sell": 0.59, "midpoint": 0.60}
    )
    layer._build_top_temperature_buckets = lambda **_kwargs: []

    scan = layer.build_market_scan(
        city="Shenzhen",
        target_date="2026-04-23",
        temperature_bucket={"temp": 30, "probability": 0.30},
        model_probability=0.30,
        probability_distribution=[
            {"value": 29, "probability": 0.20},
            {"value": 30, "probability": 0.30},
            {"value": 31, "probability": 0.50},
        ],
        temp_symbol="°C",
    )

    assert round(scan["model_probability"], 6) == 0.8
    assert round(scan["edge_percent"], 6) == 39.0


def test_build_top_temperature_buckets_use_aggregated_emos_probability():
    layer = PolymarketReadOnlyLayer()

    primary_market = {
        "slug": "highest-temperature-in-ankara-on-march-12-2026-14c-or-higher",
        "question": "Will the highest temperature in Ankara be 14C or higher on March 12?",
        "volumeNum": 1000,
    }
    markets = [
        primary_market,
        {
            "slug": "highest-temperature-in-ankara-on-march-12-2026-15c-or-higher",
            "question": "Will the highest temperature in Ankara be 15C or higher on March 12?",
            "volumeNum": 900,
        },
    ]
    layer._collect_related_temperature_markets = (
        lambda city_key, target_date, primary_market: markets
    )
    layer._extract_market_tokens = lambda market: [
        {"outcome": "Yes", "token_id": f"{market['slug']}|yes"},
        {"outcome": "No", "token_id": f"{market['slug']}|no"},
    ]
    layer._get_token_market_data = lambda token_id: (
        {"midpoint": 0.41, "buy": 0.42, "sell": 0.40}
        if token_id.endswith("|yes")
        else {"midpoint": 0.59, "buy": 0.60, "sell": 0.58}
    )

    rows = layer._build_top_temperature_buckets(
        city_key="ankara",
        target_date="2026-03-12",
        primary_market=primary_market,
        probability_distribution=[
            {"value": 13, "probability": 0.10},
            {"value": 14, "probability": 0.25},
            {"value": 15, "probability": 0.35},
            {"value": 16, "probability": 0.30},
        ],
        temp_symbol="°C",
        limit=4,
    )

    assert round(rows[0]["probability"], 6) == 0.9
    assert round(rows[0]["edge_percent"], 6) == 49.0
    assert round(rows[1]["probability"], 6) == 0.65


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


def test_find_primary_market_prefers_preferred_temperature_and_cache_key():
    layer = PolymarketReadOnlyLayer()
    markets = [
        {
            "slug": "highest-temperature-in-madrid-on-april-23-2026-22corbelow",
            "question": "Will the highest temperature in Madrid be 22C or below on April 23?",
            "volumeNum": 900000,
            "active": True,
            "closed": False,
            "acceptingOrders": True,
            "enableOrderBook": True,
        },
        {
            "slug": "highest-temperature-in-madrid-on-april-23-2026-27c",
            "question": "Will the highest temperature in Madrid be 27C on April 23?",
            "volumeNum": 1000,
            "active": True,
            "closed": False,
            "acceptingOrders": True,
            "enableOrderBook": True,
        },
    ]

    layer._load_markets = lambda active_only=True: markets

    selected_27, reason_27 = layer._find_primary_market(
        "madrid",
        "2026-04-23",
        preferred_temp=27.0,
    )
    selected_22, reason_22 = layer._find_primary_market(
        "madrid",
        "2026-04-23",
        preferred_temp=22.0,
    )

    assert reason_27 is None
    assert reason_22 is None
    assert selected_27["slug"] == "highest-temperature-in-madrid-on-april-23-2026-27c"
    assert selected_22["slug"] == "highest-temperature-in-madrid-on-april-23-2026-22corbelow"


def _build_scan_test_layer():
    layer = PolymarketReadOnlyLayer()
    markets = [
        {
            "id": "m-above-14",
            "slug": "highest-temperature-in-wellington-on-april-24-2026-14c-or-higher",
            "question": "Will the highest temperature in Wellington be 14C or higher on April 24?",
            "active": True,
            "closed": False,
            "acceptingOrders": True,
            "enableOrderBook": True,
            "liquidityNum": 12000,
            "volumeNum": 4000,
            "_model_prob": 0.60,
        },
        {
            "id": "m-below-16",
            "slug": "highest-temperature-in-wellington-on-april-24-2026-16c-or-lower",
            "question": "Will the highest temperature in Wellington be 16C or lower on April 24?",
            "active": True,
            "closed": False,
            "acceptingOrders": True,
            "enableOrderBook": True,
            "liquidityNum": 9000,
            "volumeNum": 3500,
            "_model_prob": 0.30,
        },
        {
            "id": "m-above-17",
            "slug": "highest-temperature-in-wellington-on-april-24-2026-17c-or-higher",
            "question": "Will the highest temperature in Wellington be 17C or higher on April 24?",
            "active": True,
            "closed": False,
            "acceptingOrders": True,
            "enableOrderBook": True,
            "liquidityNum": 7000,
            "volumeNum": 2800,
            "_model_prob": 0.20,
        },
    ]
    token_map = {
        "m-above-14": {"yes": "yes-14", "no": "no-14"},
        "m-below-16": {"yes": "yes-16", "no": "no-16"},
        "m-above-17": {"yes": "yes-17", "no": "no-17"},
    }
    quote_map = {
        "yes-14": {"buy": 0.48, "sell": 0.46, "midpoint": 0.40, "spread": 0.02, "book_liquidity": 14000},
        "no-14": {"buy": 0.54, "sell": 0.52, "midpoint": 0.60, "spread": 0.02, "book_liquidity": 14000},
        "yes-16": {"buy": 0.42, "sell": 0.40, "midpoint": 0.50, "spread": 0.02, "book_liquidity": 9000},
        "no-16": {"buy": 0.56, "sell": 0.54, "midpoint": 0.50, "spread": 0.02, "book_liquidity": 9000},
        "yes-17": {"buy": 0.08, "sell": 0.07, "midpoint": 0.10, "spread": 0.01, "book_liquidity": 7500},
        "no-17": {"buy": 0.92, "sell": 0.91, "midpoint": 0.90, "spread": 0.01, "book_liquidity": 7500},
    }

    layer._collect_related_temperature_markets = lambda **_kwargs: markets
    layer._aggregate_distribution_probability_for_market = (
        lambda market, **_kwargs: market.get("_model_prob")
    )
    layer._extract_market_tokens = lambda market: [
        {"outcome": "Yes", "token_id": token_map[market["id"]]["yes"]},
        {"outcome": "No", "token_id": token_map[market["id"]]["no"]},
    ]
    layer._batch_get_token_market_data = (
        lambda token_ids, include_books=False: {
            token_id: dict(quote_map[token_id])
            for token_id in token_ids
            if token_id in quote_map
        }
    )
    return layer, markets


def test_distribution_scan_bias_flips_below_markets_into_hotter_signal():
    layer, markets = _build_scan_test_layer()

    scan = layer._build_distribution_scan_pack(
        city_key="wellington",
        target_date="2026-04-24",
        primary_market=markets[0],
        probability_distribution=[],
        temp_symbol="°C",
        scan_context={
            "local_date": "2026-04-24",
            "local_time": "13:10",
            "peak": {"first_h": 14, "last_h": 16},
            "current_max_so_far": 13.4,
            "current_temp": 13.0,
            "trend": {"recent": []},
            "network_lead_signal": {},
        },
        scan_filters={"limit": 10},
    )

    bias = scan["distribution_bias"]
    assert bias["available"] is True
    assert bias["direction"] == "hotter"
    assert bias["score"] > 0


def test_distribution_scan_returns_single_primary_signal_from_yes_no_mix():
    layer, markets = _build_scan_test_layer()

    scan = layer._build_distribution_scan_pack(
        city_key="wellington",
        target_date="2026-04-24",
        primary_market=markets[0],
        probability_distribution=[],
        temp_symbol="°C",
        scan_context={
            "local_date": "2026-04-24",
            "local_time": "13:10",
            "peak": {"first_h": 14, "last_h": 16},
            "current_max_so_far": 13.6,
            "current_temp": 13.2,
            "trend": {"recent": []},
            "network_lead_signal": {},
        },
        scan_filters={"limit": 10, "min_edge_pct": 2},
    )

    assert scan["candidate_count"] >= 2
    assert isinstance(scan["primary_signal"], dict)
    assert scan["primary_signal"]["side"] == "yes"
    assert scan["primary_signal"]["id"] == scan["rows"][0]["id"]
    assert scan["signal_status"] == "ready"


def test_distribution_scan_hard_filters_block_unusable_extreme_quotes():
    layer, markets = _build_scan_test_layer()
    layer._batch_get_token_market_data = (
        lambda token_ids, include_books=False: {
            token_id: {
                "buy": 0.99 if token_id.startswith("yes") else 0.01,
                "sell": 0.95 if token_id.startswith("yes") else 0.0,
                "midpoint": 0.97 if token_id.startswith("yes") else 0.03,
                "spread": 0.04,
                "book_liquidity": 100,
            }
            for token_id in token_ids
        }
    )

    scan = layer._build_distribution_scan_pack(
        city_key="wellington",
        target_date="2026-04-24",
        primary_market=markets[0],
        probability_distribution=[],
        temp_symbol="°C",
        scan_context={
            "local_date": "2026-04-24",
            "local_time": "13:10",
            "peak": {"first_h": 14, "last_h": 16},
            "current_max_so_far": 13.6,
            "current_temp": 13.2,
            "trend": {"recent": []},
            "network_lead_signal": {},
        },
        scan_filters={"limit": 10},
    )

    assert scan["signal_status"] == "no_signal"
    assert scan["candidate_count"] == 0
    assert scan["rows"] == []


def test_batch_token_market_data_falls_back_to_single_fetch_when_batch_fails():
    layer = PolymarketReadOnlyLayer()
    layer._clob_post = lambda *_args, **_kwargs: None
    layer._fetch_token_market_data = lambda token_id: {
        "buy": 0.33,
        "sell": 0.31,
        "midpoint": 0.32,
        "quote_source": f"fallback:{token_id}",
    }

    result = layer._batch_get_token_market_data(["token-a", "token-b"])

    assert result["token-a"]["midpoint"] == 0.32
    assert result["token-b"]["quote_source"] == "fallback:token-b"


def test_normalize_scan_filters_raises_liquidity_floor_when_high_liquidity_only():
    layer = PolymarketReadOnlyLayer()

    filters = layer._normalize_scan_filters({"high_liquidity_only": True})

    assert filters["high_liquidity_only"] is True
    assert filters["min_liquidity"] >= 5000
