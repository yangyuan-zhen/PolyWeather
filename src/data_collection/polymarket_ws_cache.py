"""
Read-only Polymarket market WebSocket quote cache.

The cache subscribes to public market-channel asset ids and stores executable
best bid / ask updates. It is deliberately optional: callers should keep REST
or CLOB polling as a fallback when the WebSocket client is unavailable.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import threading
import time
from typing import Any, Dict, Iterable, Optional, Set

from loguru import logger


def _safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return None
        numeric = float(value)
        if math.isnan(numeric) or math.isinf(numeric):
            return None
        return numeric
    except Exception:
        return None


def _first_float(*values: Any) -> Optional[float]:
    for value in values:
        parsed = _safe_float(value)
        if parsed is not None:
            return parsed
    return None


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class PolymarketWsQuoteCache:
    def __init__(
        self,
        *,
        enabled: bool = False,
        endpoint: Optional[str] = None,
        quote_ttl_sec: int = 8,
        max_assets: int = 256,
        reconnect_delay_sec: float = 3.0,
    ) -> None:
        self.enabled = enabled
        self.endpoint = (
            endpoint
            or os.getenv(
                "POLYMARKET_WS_MARKET_URL",
                "wss://ws-subscriptions-clob.polymarket.com/ws/market",
            )
            or ""
        ).strip()
        self.quote_ttl_sec = max(1, int(quote_ttl_sec or 8))
        self.max_assets = max(1, int(max_assets or 256))
        self.reconnect_delay_sec = max(0.5, float(reconnect_delay_sec or 3.0))

        self._desired_assets: Set[str] = set()
        self._quotes: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._started = False
        self._last_error: Optional[str] = None
        self._last_connected_at: Optional[float] = None
        self._last_message_at: Optional[float] = None

    @classmethod
    def from_env(cls) -> "PolymarketWsQuoteCache":
        return cls(
            enabled=_env_bool("POLYMARKET_WS_PRICE_ENABLED", True),
            endpoint=os.getenv("POLYMARKET_WS_MARKET_URL"),
            quote_ttl_sec=int(os.getenv("POLYMARKET_WS_QUOTE_TTL_SEC", "8")),
            max_assets=int(os.getenv("POLYMARKET_WS_MAX_ASSETS", "256")),
            reconnect_delay_sec=float(
                os.getenv("POLYMARKET_WS_RECONNECT_DELAY_SEC", "3")
            ),
        )

    def start(self) -> None:
        if not self.enabled or not self.endpoint:
            return
        with self._lock:
            if self._started:
                return
            self._started = True
        self._thread = threading.Thread(
            target=self._thread_main,
            name="polymarket-ws-quotes",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

    def subscribe(self, asset_ids: Iterable[Any]) -> None:
        if not self.enabled:
            return
        normalized = []
        for asset_id in asset_ids:
            text = str(asset_id or "").strip()
            if text:
                normalized.append(text)
        if not normalized:
            return

        with self._lock:
            remaining = self.max_assets - len(self._desired_assets)
            for asset_id in normalized:
                if asset_id in self._desired_assets:
                    continue
                if remaining <= 0:
                    break
                self._desired_assets.add(asset_id)
                remaining -= 1
        self.start()

    def get_market_data(self, asset_id: Any) -> Optional[Dict[str, Any]]:
        quote = self.get_quote(asset_id)
        if not quote:
            return None

        best_bid = _safe_float(quote.get("best_bid"))
        best_ask = _safe_float(quote.get("best_ask"))
        if best_bid is None and best_ask is None:
            return None

        midpoint = None
        if best_bid is not None and best_ask is not None:
            midpoint = (best_bid + best_ask) / 2.0

        age_ms = int((time.time() - float(quote.get("t") or time.time())) * 1000)
        return {
            "buy": best_ask,
            "sell": best_bid,
            "midpoint": midpoint,
            "last_trade_price": _safe_float(quote.get("last_trade_price")),
            "book": {
                "best_bid": best_bid,
                "best_ask": best_ask,
                "bid_levels": [[best_bid, 0.0]] if best_bid is not None else [],
                "ask_levels": [[best_ask, 0.0]] if best_ask is not None else [],
            },
            "book_liquidity": None,
            "quote_source": "polymarket_ws",
            "quote_age_ms": age_ms,
        }

    def get_quote(self, asset_id: Any) -> Optional[Dict[str, Any]]:
        text = str(asset_id or "").strip()
        if not text:
            return None
        now = time.time()
        with self._lock:
            quote = self._quotes.get(text)
            if not quote:
                return None
            if now - float(quote.get("t") or 0.0) > self.quote_ttl_sec:
                return None
            return dict(quote)

    def status(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "enabled": self.enabled,
                "started": self._started,
                "endpoint": self.endpoint,
                "asset_count": len(self._desired_assets),
                "quote_count": len(self._quotes),
                "last_error": self._last_error,
                "last_connected_at": self._last_connected_at,
                "last_message_at": self._last_message_at,
            }

    def _thread_main(self) -> None:
        try:
            asyncio.run(self._run_forever())
        except Exception as exc:  # pragma: no cover - defensive thread guard
            with self._lock:
                self._last_error = str(exc)
            logger.warning(f"Polymarket WS quote cache stopped: {exc}")

    async def _run_forever(self) -> None:
        try:
            import websockets  # type: ignore
        except Exception as exc:
            with self._lock:
                self._last_error = f"websockets import failed: {exc}"
            logger.warning(self._last_error)
            return

        while not self._stop_event.is_set():
            try:
                async with websockets.connect(
                    self.endpoint,
                    ping_interval=None,
                    close_timeout=2,
                ) as ws:
                    with self._lock:
                        self._last_connected_at = time.time()
                        self._last_error = None
                    subscribed: Set[str] = set()
                    last_ping = 0.0

                    while not self._stop_event.is_set():
                        desired = self._snapshot_assets()
                        missing = desired - subscribed
                        if missing:
                            await self._send_subscription(
                                ws,
                                missing,
                                initial=not subscribed,
                            )
                            subscribed.update(missing)

                        now = time.time()
                        if now - last_ping >= 10:
                            await ws.send(json.dumps({}))
                            last_ping = now

                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
                        except asyncio.TimeoutError:
                            continue
                        self._handle_message(raw)
            except Exception as exc:
                with self._lock:
                    self._last_error = str(exc)
                logger.warning(f"Polymarket WS reconnecting after error: {exc}")
                await asyncio.sleep(self.reconnect_delay_sec)

    def _snapshot_assets(self) -> Set[str]:
        with self._lock:
            return set(self._desired_assets)

    async def _send_subscription(
        self,
        ws: Any,
        asset_ids: Iterable[str],
        *,
        initial: bool,
    ) -> None:
        batch = [asset_id for asset_id in asset_ids if asset_id]
        if not batch:
            return
        payload: Dict[str, Any] = {
            "type": "subscribe",
            "channel": "market",
            "assets_ids": batch,
        }
        await ws.send(json.dumps(payload))

    def _handle_message(self, raw: Any) -> None:
        if raw in (None, "", "PONG"):
            return
        try:
            payload = json.loads(raw) if isinstance(raw, str) else raw
        except Exception:
            return

        if isinstance(payload, list):
            for item in payload:
                self._handle_event(item)
            return
        self._handle_event(payload)

    def _handle_event(self, event: Any) -> None:
        if not isinstance(event, dict):
            return
        if "event_type" in event:
            event_type = str(event.get("event_type") or "").strip().lower()
        else:
            event_type = str(event.get("type") or "").strip().lower()

        if event_type in {
            "best_bid_ask",
            "best_bid_ask_price_change",
            "price_change",
            "book",
            "last_trade_price",
        }:
            self._handle_quote_event(event_type, event)

    def _handle_quote_event(self, event_type: str, event: Dict[str, Any]) -> None:
        candidates = (
            event.get("price_changes")
            or event.get("changes")
            or event.get("assets")
            or event.get("data")
        )
        if isinstance(candidates, list):
            for item in candidates:
                if isinstance(item, dict):
                    self._upsert_quote(event_type, item, parent=event)
            return
        self._upsert_quote(event_type, event, parent=event)

    def _upsert_quote(
        self,
        event_type: str,
        item: Dict[str, Any],
        *,
        parent: Dict[str, Any],
    ) -> None:
        asset_id = str(
            item.get("asset_id")
            or item.get("assetId")
            or item.get("token_id")
            or item.get("tokenId")
            or parent.get("asset_id")
            or parent.get("assetId")
            or ""
        ).strip()
        if not asset_id:
            return

        best_bid = _first_float(
            item.get("best_bid"),
            item.get("bid"),
            item.get("bestBid"),
        )
        best_ask = _first_float(
            item.get("best_ask"),
            item.get("ask"),
            item.get("bestAsk"),
        )
        if event_type == "book":
            parsed_bid, parsed_ask = self._extract_book_top(item)
            best_bid = best_bid if best_bid is not None else parsed_bid
            best_ask = best_ask if best_ask is not None else parsed_ask
        price = _safe_float(item.get("price"))
        side = str(item.get("side") or "").strip().upper()
        if event_type == "price_change" and price is not None:
            if side == "BUY":
                best_bid = price
            elif side == "SELL":
                best_ask = price

        last_trade = (
            _safe_float(item.get("last_trade_price"))
            or _safe_float(item.get("lastTradePrice"))
            or (price if event_type == "last_trade_price" else None)
        )

        now = time.time()
        with self._lock:
            previous = dict(self._quotes.get(asset_id) or {})
            if best_bid is not None:
                previous["best_bid"] = best_bid
            if best_ask is not None:
                previous["best_ask"] = best_ask
            if last_trade is not None:
                previous["last_trade_price"] = last_trade
            previous["asset_id"] = asset_id
            previous["event_type"] = event_type
            previous["t"] = now
            self._quotes[asset_id] = previous
            self._last_message_at = now

    def _extract_book_top(
        self,
        payload: Dict[str, Any],
    ) -> tuple[Optional[float], Optional[float]]:
        best_bid = None
        best_ask = None

        bids = payload.get("bids")
        if isinstance(bids, list):
            for item in bids:
                price = self._extract_level_price(item)
                if price is None:
                    continue
                best_bid = price if best_bid is None else max(best_bid, price)

        asks = payload.get("asks")
        if isinstance(asks, list):
            for item in asks:
                price = self._extract_level_price(item)
                if price is None:
                    continue
                best_ask = price if best_ask is None else min(best_ask, price)

        return best_bid, best_ask

    @staticmethod
    def _extract_level_price(level: Any) -> Optional[float]:
        if isinstance(level, dict):
            return _safe_float(level.get("price"))
        if isinstance(level, (list, tuple)) and level:
            return _safe_float(level[0])
        return None
