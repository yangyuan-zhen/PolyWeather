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

