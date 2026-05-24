import asyncio
import json
import time

from src.data_collection.polymarket_ws_cache import PolymarketWsQuoteCache


def test_ws_cache_parses_best_bid_ask_event():
    cache = PolymarketWsQuoteCache(enabled=True, quote_ttl_sec=30)

    cache.subscribe(["asset-1"])
    cache._handle_message(
        {
            "event_type": "best_bid_ask",
            "asset_id": "asset-1",
            "best_bid": "0.41",
            "best_ask": "0.44",
        }
    )

    data = cache.get_market_data("asset-1")

    assert data is not None
    assert data["sell"] == 0.41
    assert data["buy"] == 0.44
    assert data["midpoint"] == 0.425
    assert data["quote_source"] == "polymarket_ws"


def test_ws_cache_ignores_stale_quotes():
    cache = PolymarketWsQuoteCache(enabled=True, quote_ttl_sec=1)
    cache._quotes["asset-1"] = {
        "asset_id": "asset-1",
        "best_bid": 0.41,
        "best_ask": 0.44,
        "t": time.time() - 10,
    }

    assert cache.get_market_data("asset-1") is None


def test_ws_cache_parses_price_change_side_updates():
    cache = PolymarketWsQuoteCache(enabled=True, quote_ttl_sec=30)

    cache._handle_message(
        {
            "event_type": "price_change",
            "changes": [
                {
                    "asset_id": "asset-1",
                    "side": "BUY",
                    "price": "0.48",
                },
                {
                    "asset_id": "asset-1",
                    "side": "SELL",
                    "price": "0.45",
                },
            ],
        }
    )

    data = cache.get_market_data("asset-1")

    assert data is not None
    assert data["buy"] == 0.45
    assert data["sell"] == 0.48


def test_ws_cache_parses_price_changes_key_and_book_event():
    cache = PolymarketWsQuoteCache(enabled=True, quote_ttl_sec=30)

    cache._handle_message(
        {
            "event_type": "book",
            "asset_id": "asset-1",
            "bids": [{"price": "0.42"}, {"price": "0.44"}],
            "asks": [{"price": "0.51"}, {"price": "0.49"}],
        }
    )
    cache._handle_message(
        {
            "event_type": "price_change",
            "price_changes": [
                {
                    "asset_id": "asset-1",
                    "side": "BUY",
                    "price": "0.48",
                }
            ],
        }
    )

    data = cache.get_market_data("asset-1")

    assert data is not None
    assert data["sell"] == 0.48
    assert data["buy"] == 0.49


def test_ws_cache_subscription_payloads_match_market_channel_shape():
    class FakeWs:
        def __init__(self):
            self.messages = []

        async def send(self, payload):
            self.messages.append(json.loads(payload))

    cache = PolymarketWsQuoteCache(enabled=True)
    ws = FakeWs()

    asyncio.run(cache._send_subscription(ws, ["asset-1"], initial=True))
    asyncio.run(cache._send_subscription(ws, ["asset-2"], initial=False))

    assert ws.messages[0] == {
        "type": "subscribe",
        "channel": "market",
        "assets_ids": ["asset-1"],
    }
    assert ws.messages[1] == {
        "type": "subscribe",
        "channel": "market",
        "assets_ids": ["asset-2"],
    }
