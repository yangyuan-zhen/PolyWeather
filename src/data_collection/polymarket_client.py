"""
Polymarket Weather Market Client
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Market discovery + orderbook snapshot + anomaly detection for weather markets.
"""

import json
import logging
import re
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

GAMMA_API = "https://gamma-api.polymarket.com"
CLOB_API = "https://clob.polymarket.com"

CITY_KEYWORDS = {
    "ankara": ["ankara"],
    "london": ["london"],
    "paris": ["paris"],
    "seoul": ["seoul"],
    "toronto": ["toronto"],
    "buenos aires": ["buenos aires"],
    "wellington": ["wellington"],
    "new york": ["new york", "nyc", "new york city"],
    "chicago": ["chicago"],
    "dallas": ["dallas"],
    "miami": ["miami"],
    "atlanta": ["atlanta"],
    "seattle": ["seattle"],
}

CACHE_TTL_MARKETS = 300
CACHE_TTL_BOOKS = 20
SNAPSHOT_RETENTION_SEC = 48 * 3600

_market_cache: Dict[str, Any] = {}
_market_cache_ts: float = 0.0
_book_cache: Dict[str, Dict[str, Any]] = {}
_book_cache_ts: Dict[str, float] = {}
_prev_snapshots: Dict[str, Dict[str, Any]] = {}


def _build_session(proxy: Optional[str] = None) -> requests.Session:
    """Build a requests session with optional explicit proxy."""
    session = requests.Session()
    # Disable implicit system/environment proxies for deterministic behavior.
    session.trust_env = False

    if proxy:
        if not proxy.startswith("http"):
            proxy = f"http://{proxy}"
        session.proxies = {"http": proxy, "https": proxy}

    return session


def _safe_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except Exception:
        return None


def _parse_json_list(v: Any) -> List[Any]:
    """Parse value into list. Gamma often returns JSON-encoded strings."""
    if isinstance(v, list):
        return v
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return []
        try:
            parsed = json.loads(s)
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []
    return []


def _parse_threshold_from_question(question: str) -> Optional[Dict[str, Any]]:
    """Extract simple threshold contracts like: exceed 45°F/7°C."""
    m = re.search(r"exceed\s+([\d.]+)\s*[°掳]?\s*([FC])", question, re.IGNORECASE)
    if m:
        return {
            "threshold": float(m.group(1)),
            "unit": m.group(2).upper(),
            "type": "exceed",
        }

    if re.search(r"highest\s+temperature", question, re.IGNORECASE):
        return {"type": "range"}

    return None


def _match_city(text: str) -> Optional[str]:
    text_l = (text or "").lower()
    for city, aliases in CITY_KEYWORDS.items():
        if any(alias in text_l for alias in aliases):
            return city
    return None


def _parse_date_from_question(text: str) -> Optional[str]:
    """Extract date from market question, return YYYY-MM-DD."""
    m = re.search(r"on\s+(\w+)\s+(\d{1,2})(?:,?\s*(\d{4}))?", text, re.IGNORECASE)
    if not m:
        return None

    month_map = {
        "january": 1,
        "february": 2,
        "march": 3,
        "april": 4,
        "may": 5,
        "june": 6,
        "july": 7,
        "august": 8,
        "september": 9,
        "october": 10,
        "november": 11,
        "december": 12,
    }

    month = month_map.get(m.group(1).lower())
    if month is None:
        return None

    day = int(m.group(2))
    year = int(m.group(3)) if m.group(3) else datetime.utcnow().year
    return f"{year:04d}-{month:02d}-{day:02d}"


def _parse_iso_date(dt: Optional[str]) -> Optional[str]:
    if not dt:
        return None
    try:
        return dt[:10]
    except Exception:
        return None


def _sort_by_volume(markets: List[Dict[str, Any]]) -> None:
    markets.sort(key=lambda x: _safe_float(x.get("volume")) or 0.0, reverse=True)


def _cleanup_old_snapshots(now_ts: float) -> None:
    stale = [
        token for token, rec in _prev_snapshots.items()
        if now_ts - (_safe_float(rec.get("ts")) or 0.0) > SNAPSHOT_RETENTION_SEC
    ]
    for token in stale:
        _prev_snapshots.pop(token, None)


def fetch_weather_markets(
    proxy: Optional[str] = None,
    timeout: int = 15,
    force_refresh: bool = False,
) -> List[Dict[str, Any]]:
    """Fetch active weather markets and normalize outcome/token metadata."""
    global _market_cache, _market_cache_ts

    now_ts = time.time()
    if (
        not force_refresh
        and _market_cache
        and now_ts - _market_cache_ts < CACHE_TTL_MARKETS
    ):
        return _market_cache.get("_all", [])

    session = _build_session(proxy)

    try:
        resp = session.get(
            f"{GAMMA_API}/events",
            params={
                "tag": "weather",
                "active": "true",
                "closed": "false",
                "limit": 200,
            },
            timeout=timeout,
            headers={"Accept": "application/json"},
        )
        resp.raise_for_status()
        events = resp.json()
    except Exception as exc:
        logger.warning(f"Polymarket fetch_weather_markets failed: {exc}")
        return _market_cache.get("_all", [])

    all_markets: List[Dict[str, Any]] = []

    for event in events:
        event_title = event.get("title", "")
        event_slug = event.get("slug", "")
        event_end_date = _parse_iso_date(event.get("endDate"))

        for mkt in event.get("markets", []) or []:
            question = mkt.get("question") or event_title
            city = _match_city(question) or _match_city(event_title)
            if not city:
                continue

            target_date = (
                _parse_date_from_question(question)
                or _parse_date_from_question(event_title)
                or _parse_iso_date(mkt.get("endDate"))
                or event_end_date
            )

            parsed = _parse_threshold_from_question(question)
            outcomes = [str(x) for x in _parse_json_list(mkt.get("outcomes"))]
            outcome_prices = [
                _safe_float(x) for x in _parse_json_list(mkt.get("outcomePrices"))
            ]
            token_ids = [str(x) for x in _parse_json_list(mkt.get("clobTokenIds"))]

            outcome_rows: List[Dict[str, Any]] = []
            for idx, name in enumerate(outcomes):
                outcome_rows.append(
                    {
                        "name": name,
                        "token_id": token_ids[idx] if idx < len(token_ids) else None,
                        "last_price": (
                            outcome_prices[idx] if idx < len(outcome_prices) else None
                        ),
                    }
                )

            yes_price = None
            no_price = None
            for row in outcome_rows:
                name_l = row["name"].strip().lower()
                if name_l == "yes":
                    yes_price = row.get("last_price")
                elif name_l == "no":
                    no_price = row.get("last_price")

            all_markets.append(
                {
                    "id": mkt.get("id"),
                    "question": question,
                    "city": city,
                    "date": target_date,
                    "threshold": parsed.get("threshold") if parsed else None,
                    "threshold_unit": parsed.get("unit") if parsed else None,
                    "contract_type": (
                        parsed.get("type", "unknown") if parsed else "unknown"
                    ),
                    "yes_price": yes_price,
                    "no_price": no_price,
                    "volume": _safe_float(mkt.get("volume")),
                    "liquidity": _safe_float(mkt.get("liquidityNum") or mkt.get("liquidity")),
                    "slug": mkt.get("slug", ""),
                    "event_slug": event_slug,
                    "url": f"https://polymarket.com/event/{event_slug}" if event_slug else None,
                    "outcomes": outcome_rows,
                    "enable_order_book": bool(mkt.get("enableOrderBook", True)),
                }
            )

    by_city: Dict[str, List[Dict[str, Any]]] = {}
    for m in all_markets:
        by_city.setdefault(m["city"], []).append(m)

    for city in by_city:
        _sort_by_volume(by_city[city])

    _sort_by_volume(all_markets)
    _market_cache = {"_all": all_markets, **by_city}
    _market_cache_ts = now_ts
    logger.info(f"Polymarket fetched {len(all_markets)} weather markets")
    return all_markets


def get_city_markets(
    city: str,
    target_date: Optional[str] = None,
    proxy: Optional[str] = None,
    timeout: int = 15,
    force_refresh: bool = False,
) -> List[Dict[str, Any]]:
    """Get city markets, optionally filtered by YYYY-MM-DD target date."""
    if not _market_cache or force_refresh or (time.time() - _market_cache_ts >= CACHE_TTL_MARKETS):
        fetch_weather_markets(proxy=proxy, timeout=timeout, force_refresh=force_refresh)

    rows = list(_market_cache.get(city, []))
    if target_date:
        rows = [m for m in rows if m.get("date") == target_date]

    _sort_by_volume(rows)
    return rows


def _extract_best_prices(orderbook: Dict[str, Any]) -> Dict[str, Optional[float]]:
    bids = orderbook.get("bids") or []
    asks = orderbook.get("asks") or []

    best_bid_price = None
    best_bid_size = None
    best_ask_price = None
    best_ask_size = None

    for level in bids:
        p = _safe_float(level.get("price"))
        if p is None:
            continue
        s = _safe_float(level.get("size"))
        if best_bid_price is None or p > best_bid_price:
            best_bid_price = p
            best_bid_size = s

    for level in asks:
        p = _safe_float(level.get("price"))
        if p is None:
            continue
        s = _safe_float(level.get("size"))
        if best_ask_price is None or p < best_ask_price:
            best_ask_price = p
            best_ask_size = s

    spread = None
    if best_bid_price is not None and best_ask_price is not None:
        spread = best_ask_price - best_bid_price

    return {
        "best_bid": best_bid_price,
        "best_bid_size": best_bid_size,
        "best_ask": best_ask_price,
        "best_ask_size": best_ask_size,
        "spread": spread,
        "last_trade_price": _safe_float(orderbook.get("last_trade_price")),
    }


def fetch_order_books(
    token_ids: List[str],
    proxy: Optional[str] = None,
    timeout: int = 12,
    force_refresh: bool = False,
) -> Dict[str, Dict[str, Any]]:
    """Fetch order books for token IDs (prefer POST /books, fallback GET /book)."""
    now_ts = time.time()
    session = _build_session(proxy)

    # Deduplicate while keeping order
    seen = set()
    normalized: List[str] = []
    for token_id in token_ids:
        tid = str(token_id or "").strip()
        if not tid or tid in seen:
            continue
        seen.add(tid)
        normalized.append(tid)

    books: Dict[str, Dict[str, Any]] = {}
    to_fetch: List[str] = []

    for tid in normalized:
        cached_ok = (
            (not force_refresh)
            and (tid in _book_cache)
            and (now_ts - _book_cache_ts.get(tid, 0) < CACHE_TTL_BOOKS)
        )
        if cached_ok:
            books[tid] = _book_cache[tid]
        else:
            to_fetch.append(tid)

    if to_fetch:
        try:
            payload = [{"token_id": tid} for tid in to_fetch]
            resp = session.post(
                f"{CLOB_API}/books",
                json=payload,
                timeout=timeout,
                headers={"Accept": "application/json"},
            )
            resp.raise_for_status()
            rows = resp.json() or []

            for row in rows:
                tid = str(row.get("asset_id") or row.get("token_id") or "").strip()
                if not tid:
                    continue
                books[tid] = row
                _book_cache[tid] = row
                _book_cache_ts[tid] = now_ts
        except Exception as exc:
            logger.warning(f"Polymarket POST /books failed, fallback to /book: {exc}")

    # Fallback for missing tokens
    for tid in to_fetch:
        if tid in books:
            continue
        try:
            resp = session.get(
                f"{CLOB_API}/book",
                params={"token_id": tid},
                timeout=timeout,
                headers={"Accept": "application/json"},
            )
            resp.raise_for_status()
            row = resp.json()
            books[tid] = row
            _book_cache[tid] = row
            _book_cache_ts[tid] = now_ts
        except Exception as exc:
            logger.debug(f"Polymarket GET /book failed token={tid}: {exc}")

    return books


def _detect_anomaly_flags(
    token_id: str,
    best_bid: Optional[float],
    best_ask: Optional[float],
    spread: Optional[float],
    last_trade_price: Optional[float],
    best_bid_size: Optional[float],
    best_ask_size: Optional[float],
    now_ts: float,
) -> List[str]:
    flags: List[str] = []

    if best_bid is None or best_ask is None:
        flags.append("one_sided_orderbook")

    if spread is not None and spread >= 0.08:
        flags.append("wide_spread")

    if (best_bid_size is not None and best_bid_size < 25) or (
        best_ask_size is not None and best_ask_size < 25
    ):
        flags.append("thin_liquidity")

    prev = _prev_snapshots.get(token_id)
    if prev:
        prev_bid = _safe_float(prev.get("best_bid"))
        prev_ask = _safe_float(prev.get("best_ask"))
        prev_trade = _safe_float(prev.get("last_trade_price"))
        prev_spread = _safe_float(prev.get("spread"))

        if (
            best_bid is not None
            and prev_bid is not None
            and abs(best_bid - prev_bid) >= 0.06
        ):
            flags.append("bid_price_jump")

        if (
            best_ask is not None
            and prev_ask is not None
            and abs(best_ask - prev_ask) >= 0.06
        ):
            flags.append("ask_price_jump")

        if (
            last_trade_price is not None
            and prev_trade is not None
            and abs(last_trade_price - prev_trade) >= 0.06
        ):
            flags.append("last_trade_jump")

        if (
            spread is not None
            and prev_spread is not None
            and spread - prev_spread >= 0.05
        ):
            flags.append("spread_widening")

    _prev_snapshots[token_id] = {
        "ts": now_ts,
        "best_bid": best_bid,
        "best_ask": best_ask,
        "spread": spread,
        "last_trade_price": last_trade_price,
    }

    return flags


def build_city_market_snapshot(
    city: str,
    target_date: Optional[str] = None,
    proxy: Optional[str] = None,
    timeout: int = 15,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    """
    Build city/date market snapshot with buy/sell prices and anomaly flags.

    buy_price  = best ask (what you pay to buy)
    sell_price = best bid (what you receive when selling)
    """
    now_ts = time.time()
    _cleanup_old_snapshots(now_ts)

    markets = get_city_markets(
        city=city,
        target_date=target_date,
        proxy=proxy,
        timeout=timeout,
        force_refresh=force_refresh,
    )

    token_ids: List[str] = []
    for market in markets:
        for outcome in market.get("outcomes", []):
            tid = outcome.get("token_id")
            if tid:
                token_ids.append(str(tid))

    books_by_token = fetch_order_books(
        token_ids,
        proxy=proxy,
        timeout=timeout,
        force_refresh=force_refresh,
    )

    snapshot_markets: List[Dict[str, Any]] = []
    alerts: List[Dict[str, Any]] = []

    for market in markets:
        market_outcomes: List[Dict[str, Any]] = []
        market_alerts: List[Dict[str, Any]] = []

        for outcome in market.get("outcomes", []):
            token_id = outcome.get("token_id")
            orderbook = books_by_token.get(str(token_id), {}) if token_id else {}
            top = _extract_best_prices(orderbook)

            buy_price = top["best_ask"]
            sell_price = top["best_bid"]
            spread = top["spread"]
            last_trade_price = top["last_trade_price"]

            flags = _detect_anomaly_flags(
                token_id=str(token_id or ""),
                best_bid=top["best_bid"],
                best_ask=top["best_ask"],
                spread=spread,
                last_trade_price=last_trade_price,
                best_bid_size=top["best_bid_size"],
                best_ask_size=top["best_ask_size"],
                now_ts=now_ts,
            ) if token_id else []

            row = {
                "name": outcome.get("name"),
                "token_id": token_id,
                "last_price": outcome.get("last_price"),
                "buy_price": buy_price,
                "sell_price": sell_price,
                "buy_size": top["best_ask_size"],
                "sell_size": top["best_bid_size"],
                "spread": spread,
                "last_trade_price": last_trade_price,
                "book_timestamp": orderbook.get("timestamp"),
                "anomaly_flags": flags,
            }
            market_outcomes.append(row)

            if flags:
                market_alert = {
                    "market_id": market.get("id"),
                    "question": market.get("question"),
                    "outcome": outcome.get("name"),
                    "token_id": token_id,
                    "flags": flags,
                    "buy_price": buy_price,
                    "sell_price": sell_price,
                    "spread": spread,
                    "last_trade_price": last_trade_price,
                }
                market_alerts.append(market_alert)
                alerts.append(market_alert)

        snapshot_markets.append(
            {
                "id": market.get("id"),
                "question": market.get("question"),
                "city": market.get("city"),
                "date": market.get("date"),
                "threshold": market.get("threshold"),
                "threshold_unit": market.get("threshold_unit"),
                "contract_type": market.get("contract_type"),
                "slug": market.get("slug"),
                "url": market.get("url"),
                "volume": market.get("volume"),
                "liquidity": market.get("liquidity"),
                "outcomes": market_outcomes,
                "market_alerts": market_alerts,
            }
        )

    return {
        "city": city,
        "target_date": target_date,
        "updated_at": datetime.utcnow().isoformat() + "Z",
        "summary": {
            "market_count": len(snapshot_markets),
            "outcome_count": sum(len(m.get("outcomes", [])) for m in snapshot_markets),
            "alert_count": len(alerts),
        },
        "markets": snapshot_markets,
        "alerts": alerts,
    }


def compute_divergence(
    city_markets: List[Dict[str, Any]],
    prob_distribution: List[Dict[str, Any]],
    temp_symbol: str = "°C",
    use_fahrenheit: bool = False,
) -> List[Dict[str, Any]]:
    """Compare probability-engine output with Polymarket yes/no pricing."""
    signals: List[Dict[str, Any]] = []

    for mkt in city_markets:
        if mkt.get("contract_type") != "exceed" or mkt.get("yes_price") is None:
            continue

        threshold = _safe_float(mkt.get("threshold"))
        market_prob = _safe_float(mkt.get("yes_price"))
        mkt_unit = mkt.get("threshold_unit", "F")
        if threshold is None or market_prob is None:
            continue

        # Convert threshold to our unit scale
        if mkt_unit == "F" and not use_fahrenheit:
            threshold_v = (threshold - 32) * 5 / 9
        else:
            threshold_v = threshold

        threshold_wu = round(threshold_v)
        our_exceed_prob = 0.0
        for p in prob_distribution:
            if (p.get("value") or 0) >= threshold_wu:
                our_exceed_prob += _safe_float(p.get("probability")) or 0.0

        divergence = our_exceed_prob - market_prob

        signal = "neutral"
        if abs(divergence) > 0.10:
            signal = "underpriced" if divergence > 0 else "overpriced"
        elif abs(divergence) > 0.05:
            signal = "slight_under" if divergence > 0 else "slight_over"

        signals.append(
            {
                "question": mkt.get("question"),
                "threshold": threshold,
                "threshold_unit": mkt_unit,
                "our_prob": round(our_exceed_prob, 3),
                "market_prob": round(market_prob, 3),
                "divergence": round(divergence, 3),
                "signal": signal,
                "volume": mkt.get("volume"),
                "url": mkt.get("url"),
            }
        )

    return signals

