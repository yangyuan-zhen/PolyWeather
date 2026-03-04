"""
Polymarket Weather Market Client
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Fetches real-time odds from Polymarket's Gamma API for weather contracts.
Used by the web dashboard only (not the Telegram bot).
"""

import re
import time
import logging
import requests
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

GAMMA_API = "https://gamma-api.polymarket.com"

# Map our city names → Polymarket contract keywords
CITY_KEYWORDS = {
    "ankara":       ["ankara", "Ankara"],
    "london":       ["london", "London"],
    "paris":        ["paris", "Paris"],
    "seoul":        ["seoul", "Seoul"],
    "toronto":      ["toronto", "Toronto"],
    "buenos aires": ["buenos aires", "Buenos Aires"],
    "wellington":   ["wellington", "Wellington"],
    "new york":     ["new york", "New York", "NYC"],
    "chicago":      ["chicago", "Chicago"],
    "dallas":       ["dallas", "Dallas"],
    "miami":        ["miami", "Miami"],
    "atlanta":      ["atlanta", "Atlanta"],
    "seattle":      ["seattle", "Seattle"],
}

# In-memory cache: {city: {date: data, ...}}
_market_cache: Dict[str, Any] = {}
_cache_ts: float = 0
CACHE_TTL = 300  # 5 minutes


def _parse_threshold_from_question(question: str) -> Optional[dict]:
    """
    Parse a Polymarket weather question to extract city, threshold, and date.

    Examples:
      "Will the high temperature in Ankara exceed 8°C on March 5?"
      "Highest temperature in London on March 4?"
      "Will the high in New York City exceed 45°F on March 5, 2026?"
    """
    # Pattern 1: "exceed X°F/°C"
    m = re.search(
        r"exceed\s+([\d.]+)\s*°\s*([FC])", question, re.IGNORECASE
    )
    if m:
        value = float(m.group(1))
        unit = m.group(2).upper()
        return {"threshold": value, "unit": unit, "type": "exceed"}

    # Pattern 2: "Highest temperature in City on Date?" (multi-outcome)
    m = re.search(r"[Hh]ighest\s+temperature", question)
    if m:
        return {"type": "range"}

    return None


def _match_city(question: str) -> Optional[str]:
    """Match a Polymarket question to one of our tracked cities."""
    q_lower = question.lower()
    for city, keywords in CITY_KEYWORDS.items():
        for kw in keywords:
            if kw.lower() in q_lower:
                return city
    return None


def _parse_date_from_question(question: str) -> Optional[str]:
    """Extract date from question, return as YYYY-MM-DD."""
    # "on March 5, 2026" or "on March 5"
    m = re.search(
        r"on\s+(\w+)\s+(\d{1,2})(?:,?\s*(\d{4}))?", question, re.IGNORECASE
    )
    if m:
        month_str, day_str, year_str = m.group(1), m.group(2), m.group(3)
        month_map = {
            "january": 1, "february": 2, "march": 3, "april": 4,
            "may": 5, "june": 6, "july": 7, "august": 8,
            "september": 9, "october": 10, "november": 11, "december": 12,
        }
        month = month_map.get(month_str.lower())
        if month:
            year = int(year_str) if year_str else datetime.now().year
            return f"{year}-{month:02d}-{int(day_str):02d}"
    return None


def fetch_weather_markets(
    proxy: Optional[str] = None, timeout: int = 15
) -> List[Dict]:
    """
    Fetch all active weather markets from Polymarket.

    Returns a list of dicts, each representing a market with:
      - question, city, date, odds, volume, etc.
    """
    global _market_cache, _cache_ts

    if time.time() - _cache_ts < CACHE_TTL and _market_cache:
        return _market_cache.get("_all", [])

    try:
        session = requests.Session()
        if proxy:
            if not proxy.startswith("http"):
                proxy = f"http://{proxy}"
            session.proxies = {"http": proxy, "https": proxy}

        # Fetch weather-tagged events
        resp = session.get(
            f"{GAMMA_API}/events",
            params={
                "tag": "weather",
                "active": "true",
                "closed": "false",
                "limit": 50,
            },
            timeout=timeout,
            headers={"Accept": "application/json"},
        )
        resp.raise_for_status()
        events = resp.json()

        all_markets = []
        for event in events:
            markets = event.get("markets", [])
            event_title = event.get("title", "")

            for mkt in markets:
                question = mkt.get("question", event_title)
                city = _match_city(question)
                if not city:
                    continue

                date_str = _parse_date_from_question(question)
                parsed = _parse_threshold_from_question(question)

                # Extract outcome prices
                outcome_prices = mkt.get("outcomePrices", "")
                outcomes = mkt.get("outcomes", "")
                yes_price = None
                no_price = None

                try:
                    if isinstance(outcome_prices, str) and outcome_prices:
                        import json
                        prices = json.loads(outcome_prices)
                        if len(prices) >= 2:
                            yes_price = float(prices[0])
                            no_price = float(prices[1])
                    elif isinstance(outcome_prices, list) and len(outcome_prices) >= 2:
                        yes_price = float(outcome_prices[0])
                        no_price = float(outcome_prices[1])
                except Exception:
                    pass

                market_info = {
                    "id": mkt.get("id"),
                    "question": question,
                    "city": city,
                    "date": date_str,
                    "threshold": parsed.get("threshold") if parsed else None,
                    "threshold_unit": parsed.get("unit") if parsed else None,
                    "contract_type": parsed.get("type", "unknown") if parsed else "unknown",
                    "yes_price": yes_price,    # 0.00-1.00 = market probability
                    "no_price": no_price,
                    "volume": mkt.get("volume"),
                    "liquidity": mkt.get("liquidityNum"),
                    "slug": mkt.get("slug", ""),
                    "url": f"https://polymarket.com/event/{event.get('slug', '')}",
                }
                all_markets.append(market_info)

        # Organize by city
        _market_cache = {"_all": all_markets}
        for m in all_markets:
            c = m["city"]
            if c not in _market_cache:
                _market_cache[c] = []
            _market_cache[c].append(m)

        _cache_ts = time.time()
        logger.info(f"📊 Polymarket: 获取 {len(all_markets)} 个天气合约")
        return all_markets

    except Exception as e:
        logger.warning(f"Polymarket API 请求失败: {e}")
        return _market_cache.get("_all", [])


def get_city_markets(city: str, target_date: Optional[str] = None) -> List[Dict]:
    """
    Get Polymarket contracts for a specific city.

    Args:
        city: City name (lowercase)
        target_date: Optional date filter (YYYY-MM-DD)

    Returns:
        List of market dicts for this city, sorted by volume desc.
    """
    # Ensure markets are fetched
    if not _market_cache or time.time() - _cache_ts >= CACHE_TTL:
        fetch_weather_markets()

    markets = _market_cache.get(city, [])
    if target_date:
        markets = [m for m in markets if m.get("date") == target_date]

    # Sort by volume (descending)
    markets.sort(key=lambda m: float(m.get("volume") or 0), reverse=True)
    return markets


def compute_divergence(
    city_markets: List[Dict],
    prob_distribution: List[Dict],
    temp_symbol: str = "°C",
    use_fahrenheit: bool = False,
) -> List[Dict]:
    """
    Compare our probability engine output with Polymarket odds.

    Args:
        city_markets: Markets from get_city_markets()
        prob_distribution: Our engine's [{value, probability}, ...]
        temp_symbol: "°C" or "°F"
        use_fahrenheit: Whether our data is in Fahrenheit

    Returns:
        List of divergence signals:
        [{threshold, our_prob, market_prob, divergence, signal}, ...]
    """
    signals = []

    for mkt in city_markets:
        if mkt.get("contract_type") != "exceed" or mkt.get("yes_price") is None:
            continue

        threshold = mkt.get("threshold")
        mkt_unit = mkt.get("threshold_unit", "F")
        if threshold is None:
            continue

        # Convert threshold to match our unit
        if mkt_unit == "F" and not use_fahrenheit:
            threshold_c = (threshold - 32) * 5 / 9
        elif mkt_unit == "C" and use_fahrenheit:
            threshold_c = threshold  # keep as-is, our data is F
        else:
            threshold_c = threshold

        # Calculate our probability of exceeding this threshold
        # Sum probabilities for all values >= threshold (rounded)
        threshold_wu = round(threshold_c)
        our_exceed_prob = 0.0
        for p in prob_distribution:
            if p.get("value", 0) >= threshold_wu:
                our_exceed_prob += p.get("probability", 0)

        market_prob = mkt["yes_price"]
        divergence = our_exceed_prob - market_prob

        signal = "neutral"
        if abs(divergence) > 0.10:
            signal = "underpriced" if divergence > 0 else "overpriced"
        elif abs(divergence) > 0.05:
            signal = "slight_under" if divergence > 0 else "slight_over"

        signals.append({
            "question": mkt["question"],
            "threshold": threshold,
            "threshold_unit": mkt_unit,
            "our_prob": round(our_exceed_prob, 3),
            "market_prob": round(market_prob, 3),
            "divergence": round(divergence, 3),
            "signal": signal,
            "volume": mkt.get("volume"),
            "url": mkt.get("url", ""),
        })

    return signals
