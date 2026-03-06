from src.data_collection import polymarket_client as pm


def test_extract_best_prices():
    book = {
        "bids": [{"price": "0.41", "size": "100"}, {"price": "0.39", "size": "80"}],
        "asks": [{"price": "0.45", "size": "90"}, {"price": "0.47", "size": "70"}],
        "last_trade_price": "0.44",
    }
    out = pm._extract_best_prices(book)
    assert out["best_bid"] == 0.41
    assert out["best_ask"] == 0.45
    assert out["spread"] == 0.04
    assert out["last_trade_price"] == 0.44


def test_build_city_market_snapshot_buy_sell_and_alerts(monkeypatch):
    pm._prev_snapshots.clear()

    markets = [
        {
            "id": "m1",
            "question": "Highest temperature in Ankara on March 7?",
            "city": "ankara",
            "date": "2026-03-07",
            "slug": "m1",
            "url": "https://polymarket.com/event/m1",
            "volume": 1000.0,
            "liquidity": 500.0,
            "outcomes": [
                {"name": "6-7°C", "token_id": "t1", "last_price": 0.32},
                {"name": "8-9°C", "token_id": "t2", "last_price": 0.40},
            ],
        }
    ]

    books = {
        "t1": {
            "bids": [{"price": "0.30", "size": "50"}],
            "asks": [{"price": "0.36", "size": "55"}],
            "last_trade_price": "0.34",
            "timestamp": "2026-03-06T10:00:00Z",
        },
        # one-sided book + thin liquidity to trigger anomaly
        "t2": {
            "bids": [],
            "asks": [{"price": "0.52", "size": "10"}],
            "last_trade_price": "0.51",
            "timestamp": "2026-03-06T10:00:00Z",
        },
    }

    def fake_get_city_markets(**kwargs):
        return markets

    def fake_fetch_order_books(*args, **kwargs):
        return books

    monkeypatch.setattr(pm, "get_city_markets", fake_get_city_markets)
    monkeypatch.setattr(pm, "fetch_order_books", fake_fetch_order_books)

    # Seed previous snapshot for token t1, so we can detect a price jump alert
    pm._prev_snapshots["t1"] = {
        "ts": 1.0,
        "best_bid": 0.20,
        "best_ask": 0.24,
        "spread": 0.04,
        "last_trade_price": 0.22,
    }

    snap = pm.build_city_market_snapshot(city="ankara", target_date="2026-03-07")

    assert snap["city"] == "ankara"
    assert snap["target_date"] == "2026-03-07"
    assert snap["summary"]["market_count"] == 1
    assert snap["summary"]["outcome_count"] == 2

    first_market = snap["markets"][0]
    row_t1 = next(x for x in first_market["outcomes"] if x["token_id"] == "t1")
    row_t2 = next(x for x in first_market["outcomes"] if x["token_id"] == "t2")

    # Buy uses ask, sell uses bid
    assert row_t1["buy_price"] == 0.36
    assert row_t1["sell_price"] == 0.30
    assert round(row_t1["spread"], 2) == 0.06

    # one-sided orderbook has no sell price
    assert row_t2["buy_price"] == 0.52
    assert row_t2["sell_price"] is None
    assert "one_sided_orderbook" in row_t2["anomaly_flags"]
