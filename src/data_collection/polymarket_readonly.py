"""
Polymarket read-only market layer.

P0 scope:
- Market discovery from Gamma REST
- Price / orderbook read from py-clob-client public methods (fallback to CLOB REST)
- No signing, no order placement
"""

from __future__ import annotations

import json
import math
import os
import re
import threading
import time
import unicodedata
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import requests
from loguru import logger

from src.data_collection.city_registry import ALIASES, CITY_REGISTRY

try:
    from py_clob_client.client import ClobClient  # type: ignore
except Exception:  # pragma: no cover - optional dependency in P0
    ClobClient = None


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


def _safe_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _normalize_text(value: Any) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace("_", " ").replace("-", " ")
    return " ".join(text.split())


def _normalize_city_key(city: Any) -> str:
    raw = _normalize_text(city)
    if not raw:
        return ""
    return ALIASES.get(raw, raw)


def _contains_token(haystack: str, token: str) -> bool:
    token = _normalize_text(token)
    if not token:
        return False
    pattern = r"\b" + re.escape(token) + r"\b"
    try:
        return re.search(pattern, haystack) is not None
    except re.error:
        return False


def _json_or_list(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return parsed
        except Exception:
            return []
    return []


def _to_plain_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if value is None:
        return {}
    if hasattr(value, "dict") and callable(value.dict):
        try:
            data = value.dict()
            if isinstance(data, dict):
                return data
        except Exception:
            pass
    if hasattr(value, "__dict__"):
        try:
            data = dict(vars(value))
            if isinstance(data, dict):
                return data
        except Exception:
            pass
    return {}


def _extract_price(value: Any) -> Optional[float]:
    if value is None:
        return None
    direct = _safe_float(value)
    if direct is not None:
        return direct
    if isinstance(value, dict):
        for key in (
            "price",
            "mid",
            "midpoint",
            "value",
            "last_trade_price",
            "lastPrice",
        ):
            numeric = _safe_float(value.get(key))
            if numeric is not None:
                return numeric
    plain = _to_plain_dict(value)
    if plain:
        for key in (
            "price",
            "mid",
            "midpoint",
            "value",
            "last_trade_price",
            "lastPrice",
        ):
            numeric = _safe_float(plain.get(key))
            if numeric is not None:
                return numeric
    return None


def _extract_iso_date(value: Any) -> Optional[str]:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return text[:10]
    # Common API formats from Gamma/CLOB
    candidates = (
        text,
        text.replace("Z", "+00:00"),
        text.split(".")[0] + "Z" if "." in text and "T" in text else text,
    )
    for candidate in candidates:
        try:
            dt = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
            return dt.date().isoformat()
        except Exception:
            continue
    return None


def _build_city_token_index() -> Dict[str, List[str]]:
    result: Dict[str, List[str]] = {}
    for key, info in CITY_REGISTRY.items():
        normalized_key = _normalize_text(key)
        tokens = {normalized_key, normalized_key.replace(" ", "")}

        display_name = _normalize_text(info.get("name"))
        if display_name:
            tokens.add(display_name)
            tokens.add(display_name.replace(" ", ""))

        for alias, target in ALIASES.items():
            if target != key:
                continue
            norm_alias = _normalize_text(alias)
            if not norm_alias:
                continue
            # Ignore very short aliases to reduce false-positive matching.
            if len(norm_alias) < 3 and norm_alias not in {"nyc"}:
                continue
            tokens.add(norm_alias)

        if key == "new york":
            tokens.update({"central park", "new yorks central park"})
        if key == "sao paulo":
            tokens.update({"sao paulo", "sao-paulo", "sao paulo"})

        result[key] = sorted(tokens, key=len, reverse=True)
    return result


CITY_TOKEN_INDEX = _build_city_token_index()

WEATHER_KEYWORDS = (
    "temperature",
    "temp",
    "high",
    "low",
    "hotter",
    "colder",
    "above",
    "below",
)

MONTH_TO_NUM = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}


def _parse_target_date(value: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(value)
    except Exception:
        return None


def _extract_dates_from_text(
    text: str,
    default_year: Optional[int],
) -> List[str]:
    dates: List[str] = []

    for year, month, day in re.findall(r"\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b", text):
        try:
            parsed = datetime(int(year), int(month), int(day)).date().isoformat()
            dates.append(parsed)
        except Exception:
            continue

    month_pattern = "|".join(sorted(MONTH_TO_NUM.keys(), key=len, reverse=True))
    for month_name, day_raw, year_raw in re.findall(
        rf"\b({month_pattern})\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:\s*(20\d{{2}}))?\b",
        text,
    ):
        year = int(year_raw) if year_raw else default_year
        if not year:
            continue
        try:
            parsed = datetime(year, MONTH_TO_NUM[month_name], int(day_raw)).date().isoformat()
            dates.append(parsed)
        except Exception:
            continue

    for day_raw, month_name, year_raw in re.findall(
        rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+({month_pattern})(?:\s*(20\d{{2}}))?\b",
        text,
    ):
        year = int(year_raw) if year_raw else default_year
        if not year:
            continue
        try:
            parsed = datetime(year, MONTH_TO_NUM[month_name], int(day_raw)).date().isoformat()
            dates.append(parsed)
        except Exception:
            continue

    # Deduplicate while preserving order
    unique: List[str] = []
    seen = set()
    for value in dates:
        if value in seen:
            continue
        seen.add(value)
        unique.append(value)
    return unique


class PolymarketReadOnlyLayer:
    def __init__(self) -> None:
        self.enabled = (
            str(os.getenv("POLYMARKET_MARKET_SCAN_ENABLED", "true")).strip().lower()
            not in {"0", "false", "no", "off"}
        )
        self.gamma_url = (
            str(os.getenv("POLYMARKET_GAMMA_URL", "https://gamma-api.polymarket.com"))
            .strip()
            .rstrip("/")
        )
        self.clob_url = (
            str(os.getenv("POLYMARKET_CLOB_URL", "https://clob.polymarket.com"))
            .strip()
            .rstrip("/")
        )
        self.chain_id = _safe_int(os.getenv("POLYMARKET_CHAIN_ID", "137"), 137)
        self.http_timeout = _safe_float(os.getenv("POLYMARKET_HTTP_TIMEOUT_SEC")) or 8.0
        self.market_cache_ttl = _safe_int(
            os.getenv("POLYMARKET_MARKET_CACHE_TTL_SEC", "180"),
            180,
        )
        self.price_cache_ttl = _safe_int(
            os.getenv("POLYMARKET_PRICE_CACHE_TTL_SEC", "10"),
            10,
        )
        self.discovery_pages = _safe_int(
            os.getenv("POLYMARKET_DISCOVERY_PAGES", "6"),
            6,
        )
        self.discovery_limit = _safe_int(
            os.getenv("POLYMARKET_DISCOVERY_LIMIT", "200"),
            200,
        )
        self.min_liquidity_for_signal = (
            _safe_float(os.getenv("POLYMARKET_SIGNAL_MIN_LIQUIDITY")) or 500.0
        )
        self.edge_threshold = _safe_float(os.getenv("POLYMARKET_SIGNAL_EDGE_PCT")) or 2.0

        self._session = requests.Session()
        self._markets_cache: Dict[str, Dict[str, Any]] = {}
        self._active_markets_cache: Dict[str, Any] = {"data": [], "t": 0.0}
        self._broad_markets_cache: Dict[str, Any] = {"data": [], "t": 0.0}
        self._price_cache: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._clob_client: Any = None
        self._clob_unavailable_reason: Optional[str] = None

    def build_market_scan(
        self,
        city: Any,
        target_date: Any,
        temperature_bucket: Optional[Dict[str, Any]] = None,
        model_probability: Optional[float] = None,
        fallback_sparkline: Optional[List[float]] = None,
        forced_market_slug: Optional[str] = None,
    ) -> Dict[str, Any]:
        date_str = _extract_iso_date(target_date) or str(target_date or "")
        city_key = _normalize_city_key(city)
        requested_slug = str(forced_market_slug or "").strip().lower() or None

        scan: Dict[str, Any] = {
            "available": False,
            "reason": None,
            "primary_market": None,
            "selected_date": date_str or None,
            "selected_condition_id": None,
            "selected_slug": requested_slug,
            "temperature_bucket": temperature_bucket,
            "model_probability": model_probability,
            "market_price": None,
            "edge_percent": None,
            "signal_label": "MONITOR",
            "confidence": "low",
            "yes_token": None,
            "no_token": None,
            "yes_buy": None,
            "yes_sell": None,
            "no_buy": None,
            "no_sell": None,
            "last_trade_price": None,
            "liquidity": None,
            "volume": None,
            "sparkline": fallback_sparkline or [],
            "top_buckets": [],
            "recent_trades": [],
            "websocket": {},
        }

        if not self.enabled:
            scan["reason"] = "Market scan disabled by POLYMARKET_MARKET_SCAN_ENABLED."
            return scan

        if not city_key or city_key not in CITY_REGISTRY:
            scan["reason"] = "City is not supported by the Polymarket market layer."
            return scan

        if not date_str:
            scan["reason"] = "Missing target date for market discovery."
            return scan

        try:
            preferred_temp = None
            if isinstance(temperature_bucket, dict):
                preferred_temp = _safe_float(temperature_bucket.get("temp"))
            market, reason = self._find_primary_market(
                city_key,
                date_str,
                forced_market_slug=requested_slug,
                preferred_temp=preferred_temp,
            )
        except Exception as exc:
            logger.warning(f"Polymarket market discovery failed ({city_key}): {exc}")
            scan["reason"] = "Market discovery failed."
            return scan

        if not market:
            scan["reason"] = reason or "No active Polymarket market matched city/date."
            return scan

        market_date = self._extract_market_date(market)
        condition_id = str(
            market.get("conditionId")
            or market.get("condition_id")
            or market.get("conditionID")
            or ""
        ).strip() or None
        market_slug = str(market.get("slug") or "").strip() or None
        liquidity = _extract_price(
            market.get("liquidityNum")
            or market.get("liquidity")
            or market.get("liquidityClob")
        )
        volume = _extract_price(
            market.get("volumeNum")
            or market.get("volume")
            or market.get("volume24hr")
        )

        tokens = self._extract_market_tokens(market)
        yes_token, no_token = self._resolve_yes_no_tokens(tokens)
        if not yes_token or not no_token:
            scan["reason"] = "Matched market has no resolvable YES/NO token pair."
            scan["primary_market"] = {
                "condition_id": condition_id,
                "end_date": market_date,
                "id": market.get("id"),
                "liquidity": liquidity,
                "question": market.get("question") or market.get("title"),
                "slug": market_slug,
                "volume": volume,
            }
            scan["selected_condition_id"] = condition_id
            scan["selected_slug"] = market_slug
            scan["liquidity"] = liquidity
            scan["volume"] = volume
            return scan

        yes_prices = self._get_token_market_data(str(yes_token.get("token_id")))
        no_prices = self._get_token_market_data(str(no_token.get("token_id")))

        if liquidity is None:
            liquidity = _extract_price(yes_prices.get("book_liquidity"))
        last_trade_price = _extract_price(yes_prices.get("last_trade_price"))
        market_price = (
            _extract_price(yes_prices.get("midpoint"))
            or _extract_price(yes_prices.get("buy"))
            or _extract_price(yes_token.get("implied_probability"))
        )

        edge_percent = None
        if model_probability is not None and market_price is not None:
            edge_percent = (model_probability - market_price) * 100.0

        signal_label, confidence = self._derive_signal(edge_percent, liquidity)

        top_bucket_limit = max(
            1,
            _safe_int(os.getenv("POLYMARKET_TOP_BUCKET_LIMIT", "4"), 4),
        )
        all_bucket_limit = max(
            top_bucket_limit,
            _safe_int(os.getenv("POLYMARKET_ALL_BUCKET_LIMIT", "24"), 24),
        )
        all_buckets = self._build_top_temperature_buckets(
            city_key=city_key,
            target_date=date_str,
            primary_market=market,
            limit=all_bucket_limit,
        )
        top_buckets = list(all_buckets[:top_bucket_limit])

        yes_payload = {
            "outcome": yes_token.get("outcome") or "Yes",
            "token_id": yes_token.get("token_id"),
            "implied_probability": _extract_price(yes_token.get("implied_probability")),
            "buy_price": _extract_price(yes_prices.get("buy")),
            "sell_price": _extract_price(yes_prices.get("sell")),
            "midpoint": _extract_price(yes_prices.get("midpoint")),
            "last_trade_price": _extract_price(yes_prices.get("last_trade_price")),
            "book": yes_prices.get("book"),
        }
        no_payload = {
            "outcome": no_token.get("outcome") or "No",
            "token_id": no_token.get("token_id"),
            "implied_probability": _extract_price(no_token.get("implied_probability")),
            "buy_price": _extract_price(no_prices.get("buy")),
            "sell_price": _extract_price(no_prices.get("sell")),
            "midpoint": _extract_price(no_prices.get("midpoint")),
            "last_trade_price": _extract_price(no_prices.get("last_trade_price")),
            "book": no_prices.get("book"),
        }

        sparkline_values: List[float] = []
        for candidate in (
            _extract_price(yes_payload.get("sell_price")),
            _extract_price(yes_payload.get("buy_price")),
            market_price,
            model_probability,
        ):
            if candidate is None:
                continue
            sparkline_values.append(round(candidate * 100.0, 2))
        if not sparkline_values:
            sparkline_values = fallback_sparkline or []

        market_url = self._build_market_url(market)
        scan.update(
            {
                "available": True,
                "reason": None,
                "primary_market": {
                    "id": market.get("id"),
                    "question": market.get("question") or market.get("title"),
                    "slug": market_slug,
                    "condition_id": condition_id,
                    "end_date": market_date,
                    "active": bool(market.get("active", False)),
                    "closed": bool(market.get("closed", False)),
                    "liquidity": liquidity,
                    "volume": volume,
                },
                "selected_condition_id": condition_id,
                "selected_slug": market_slug,
                "market_price": market_price,
                "edge_percent": edge_percent,
                "signal_label": signal_label,
                "confidence": confidence,
                "yes_token": yes_payload,
                "no_token": no_payload,
                "yes_buy": _extract_price(yes_payload.get("buy_price")),
                "yes_sell": _extract_price(yes_payload.get("sell_price")),
                "no_buy": _extract_price(no_payload.get("buy_price")),
                "no_sell": _extract_price(no_payload.get("sell_price")),
                "last_trade_price": last_trade_price,
                "liquidity": liquidity,
                "volume": volume,
                "sparkline": sparkline_values,
                "top_buckets": top_buckets,
                "all_buckets": all_buckets,
                "websocket": {
                    "market_url": market_url,
                    "asset_ids": [
                        token
                        for token in [
                            yes_payload.get("token_id"),
                            no_payload.get("token_id"),
                        ]
                        if token
                    ],
                    "condition_ids": [condition_id] if condition_id else [],
                },
            }
        )
        return scan

    def _derive_signal(
        self,
        edge_percent: Optional[float],
        liquidity: Optional[float],
    ) -> Tuple[str, str]:
        if edge_percent is None:
            return "MONITOR", "low"
        if liquidity is not None and liquidity < self.min_liquidity_for_signal:
            return "MONITOR", "low"

        absolute_edge = abs(edge_percent)
        if absolute_edge >= 8:
            confidence = "high"
        elif absolute_edge >= 4:
            confidence = "medium"
        else:
            confidence = "low"

        if edge_percent >= self.edge_threshold:
            return "BUY YES", confidence
        if edge_percent <= -self.edge_threshold:
            return "BUY NO", confidence
        return "MONITOR", confidence

    def _find_primary_market(
        self,
        city_key: str,
        target_date: str,
        forced_market_slug: Optional[str] = None,
        preferred_temp: Optional[float] = None,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        if forced_market_slug:
            return self._find_market_by_slug(
                forced_market_slug,
                preferred_temp=preferred_temp,
            )

        cache_key = f"{city_key}|{target_date}"
        now = time.time()

        with self._lock:
            cached = self._markets_cache.get(cache_key)
            if cached and now - cached.get("t", 0) < self.market_cache_ttl:
                return cached.get("market"), cached.get("reason")

        markets = self._load_markets(active_only=True)
        if not markets:
            return None, "No active markets returned by Gamma API."

        scored: List[Tuple[float, Dict[str, Any]]] = []
        for market in markets:
            score = self._score_market(city_key, target_date, market)
            if score <= 0:
                continue
            scored.append((score, market))

        # Fallback to broader active universe when strict filters miss.
        if not scored:
            broader = self._load_markets(active_only=False)
            for market in broader:
                score = self._score_market(city_key, target_date, market)
                if score <= 0:
                    continue
                scored.append((score, market))

        # Deterministic weather event fallback:
        # If Gamma /markets discovery misses, resolve by canonical weather event slug.
        if not scored:
            event_slug = self._build_weather_event_slug(city_key, target_date)
            if event_slug:
                fallback_market, _ = self._find_market_by_slug(
                    event_slug,
                    preferred_temp=preferred_temp,
                )
                if fallback_market:
                    with self._lock:
                        self._markets_cache[cache_key] = {
                            "market": fallback_market,
                            "reason": None,
                            "t": now,
                        }
                    return fallback_market, None

        scored.sort(
            key=lambda item: (
                item[0],
                _extract_price(
                    item[1].get("volumeNum")
                    or item[1].get("volume")
                    or item[1].get("volume24hr")
                )
                or 0.0,
            ),
            reverse=True,
        )

        market = scored[0][1] if scored else None
        reason = None if market else "No market matched city/date with weather filters."

        with self._lock:
            self._markets_cache[cache_key] = {"market": market, "reason": reason, "t": now}

        return market, reason

    def _find_market_by_slug(
        self,
        market_slug: str,
        preferred_temp: Optional[float] = None,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        normalized_slug = str(market_slug or "").strip().lower()
        if not normalized_slug:
            return None, "market_slug is empty."

        # 0) Event slug path (Polymarket weather pages are often event slugs).
        try:
            resp = self._session.get(
                f"{self.gamma_url}/events",
                params={"slug": normalized_slug, "limit": 5},
                timeout=self.http_timeout,
            )
            resp.raise_for_status()
            payload = resp.json()
            events = payload if isinstance(payload, list) else []
            for event in events:
                if not isinstance(event, dict):
                    continue
                event_slug = str(event.get("slug") or "").strip().lower()
                markets = event.get("markets") if isinstance(event.get("markets"), list) else []
                market_candidates = [m for m in markets if isinstance(m, dict)]
                # Try exact market slug match first.
                for market in market_candidates:
                    item_slug = str(market.get("slug") or "").strip().lower()
                    if item_slug == normalized_slug:
                        market["eventSlug"] = market.get("eventSlug") or event_slug
                        market["eventTitle"] = market.get("eventTitle") or event.get("title")
                        return market, None
                # If input is event slug, pick the most liquid active/ready market.
                if event_slug == normalized_slug and market_candidates:
                    def _event_market_rank(m: Dict[str, Any]) -> Tuple[float, bool, bool, float]:
                        market_temp = self._extract_market_bucket_temp(m)
                        temp_score = 0.0
                        if preferred_temp is not None and market_temp is not None:
                            temp_score = max(0.0, 100.0 - abs(market_temp - preferred_temp) * 10.0)
                        liquidity_score = (
                            _extract_price(
                                m.get("volumeNum")
                                or m.get("volume")
                                or m.get("liquidityNum")
                                or m.get("liquidity")
                            )
                            or 0.0
                        )
                        return (
                            temp_score,
                            bool(m.get("active", False)),
                            not bool(m.get("closed", False)),
                            liquidity_score,
                        )

                    market_candidates.sort(
                        key=_event_market_rank,
                        reverse=True,
                    )
                    best = market_candidates[0]
                    best["eventSlug"] = best.get("eventSlug") or event_slug
                    best["eventTitle"] = best.get("eventTitle") or event.get("title")
                    return best, None
        except Exception:
            pass

        # 1) Direct Gamma query by slug (fast-path for debug and deterministic checks).
        query_params = [
            {"slug": normalized_slug, "limit": 20, "offset": 0, "archived": "false"},
            {"search": normalized_slug, "limit": 50, "offset": 0, "archived": "false"},
        ]
        for params in query_params:
            try:
                resp = self._session.get(
                    f"{self.gamma_url}/markets",
                    params=params,
                    timeout=self.http_timeout,
                )
                resp.raise_for_status()
                payload = resp.json()
                if isinstance(payload, dict):
                    candidates = payload.get("markets")
                    if not isinstance(candidates, list):
                        candidates = []
                elif isinstance(payload, list):
                    candidates = payload
                else:
                    candidates = []
                for item in candidates:
                    if not isinstance(item, dict):
                        continue
                    item_slug = str(item.get("slug") or "").strip().lower()
                    if item_slug == normalized_slug:
                        return item, None
            except Exception:
                continue

        # 2) Fallback to cached discovery lists.
        for active_only in (True, False):
            for item in self._load_markets(active_only=active_only):
                item_slug = str(item.get("slug") or "").strip().lower()
                if item_slug == normalized_slug:
                    return item, None

        return None, f"Specified market_slug not found: {normalized_slug}"

    def _score_market(self, city_key: str, target_date: str, market: Dict[str, Any]) -> float:
        city_tokens = CITY_TOKEN_INDEX.get(city_key, [city_key])
        text_parts = [
            market.get("question"),
            market.get("title"),
            market.get("slug"),
            market.get("eventSlug"),
            market.get("description"),
        ]
        haystack = _normalize_text(" ".join(str(part or "") for part in text_parts))
        if not haystack:
            return 0.0

        city_hit = any(_contains_token(haystack, token) for token in city_tokens)
        if not city_hit:
            return 0.0

        score = 40.0

        weather_hit = any(_contains_token(haystack, keyword) for keyword in WEATHER_KEYWORDS)
        if not weather_hit:
            return 0.0
        score += 18.0

        d_target = _parse_target_date(target_date)
        text_dates = _extract_dates_from_text(haystack, d_target.year if d_target else None)
        if d_target and text_dates:
            diffs: List[int] = []
            for date_str in text_dates:
                try:
                    diffs.append(abs((datetime.fromisoformat(date_str).date() - d_target.date()).days))
                except Exception:
                    continue
            if diffs:
                best = min(diffs)
                if best == 0:
                    score += 45.0
                elif best == 1:
                    score += 20.0
                elif best == 2:
                    score += 10.0
                else:
                    score -= 6.0
        else:
            market_date = self._extract_market_date(market)
            if market_date and d_target:
                try:
                    d_market = datetime.fromisoformat(market_date).date()
                    diff = abs((d_market - d_target.date()).days)
                    if diff == 0:
                        score += 18.0
                    elif diff == 1:
                        score += 8.0
                    elif diff == 2:
                        score += 3.0
                    else:
                        score -= 2.0
                except Exception:
                    pass

        if bool(market.get("active", False)):
            score += 5.0
        if not bool(market.get("closed", False)):
            score += 5.0
        if bool(market.get("enableOrderBook", market.get("enable_order_book", False))):
            score += 4.0

        volume = (
            _extract_price(
                market.get("volumeNum")
                or market.get("volume")
                or market.get("volume24hr")
            )
            or 0.0
        )
        score += min(volume / 50000.0, 8.0)
        return score

    def _extract_market_date(self, market: Dict[str, Any]) -> Optional[str]:
        for key in (
            "endDate",
            "endDateIso",
            "endDateISO",
            "resolutionDate",
            "gameStartTime",
            "closedTime",
        ):
            date_str = _extract_iso_date(market.get(key))
            if date_str:
                return date_str
        return None

    def _extract_market_bucket_temp(self, market: Dict[str, Any]) -> Optional[float]:
        text = " ".join(
            str(part or "")
            for part in (
                market.get("question"),
                market.get("title"),
                market.get("slug"),
            )
        )
        if not text:
            return None
        # Match "... 9°C ..." / "... 9C ..." / "... -2 C ..."
        match = re.search(r"(-?\d+(?:\.\d+)?)\s*°?\s*c\b", text, re.IGNORECASE)
        if match:
            return _safe_float(match.group(1))
        return None

    def _build_weather_event_slug(self, city_key: str, target_date: str) -> Optional[str]:
        try:
            dt = datetime.fromisoformat(str(target_date))
        except Exception:
            return None
        city_slug = str(city_key or "").strip().lower().replace(" ", "-")
        if not city_slug:
            return None
        month_name = dt.strftime("%B").lower()
        return f"highest-temperature-in-{city_slug}-on-{month_name}-{dt.day}-{dt.year}"

    def _load_markets(self, active_only: bool = True) -> List[Dict[str, Any]]:
        now = time.time()
        with self._lock:
            cached = self._active_markets_cache if active_only else self._broad_markets_cache
            if now - float(cached.get("t", 0)) < self.market_cache_ttl:
                data = cached.get("data")
                if isinstance(data, list):
                    return data

        all_markets: List[Dict[str, Any]] = []
        offset = 0
        for _ in range(max(self.discovery_pages, 1)):
            params = {"archived": "false", "limit": self.discovery_limit, "offset": offset}
            if active_only:
                params.update({"active": "true", "closed": "false"})
            else:
                params.update({"active": "true"})
            url = f"{self.gamma_url}/markets"
            try:
                resp = self._session.get(url, params=params, timeout=self.http_timeout)
                resp.raise_for_status()
                payload = resp.json()
            except Exception as exc:
                logger.warning(f"Gamma markets fetch failed (offset={offset}): {exc}")
                break

            if isinstance(payload, dict):
                batch = payload.get("markets")
                if not isinstance(batch, list):
                    # Gamma can also return object arrays directly.
                    batch = []
            elif isinstance(payload, list):
                batch = payload
            else:
                batch = []

            if not batch:
                break

            all_markets.extend(item for item in batch if isinstance(item, dict))
            if len(batch) < self.discovery_limit:
                break
            offset += self.discovery_limit

        with self._lock:
            if active_only:
                self._active_markets_cache = {"data": all_markets, "t": now}
            else:
                self._broad_markets_cache = {"data": all_markets, "t": now}

        return all_markets

    def _extract_market_tokens(self, market: Dict[str, Any]) -> List[Dict[str, Any]]:
        result: List[Dict[str, Any]] = []

        direct_tokens = market.get("tokens")
        if isinstance(direct_tokens, list):
            for token in direct_tokens:
                token_obj = _to_plain_dict(token)
                if not token_obj:
                    continue
                token_id = str(
                    token_obj.get("token_id")
                    or token_obj.get("tokenId")
                    or token_obj.get("id")
                    or token_obj.get("clobTokenId")
                    or ""
                ).strip()
                if not token_id:
                    continue
                result.append(
                    {
                        "outcome": token_obj.get("outcome") or token_obj.get("name"),
                        "token_id": token_id,
                        "implied_probability": _extract_price(
                            token_obj.get("price")
                            or token_obj.get("probability")
                            or token_obj.get("lastPrice")
                        ),
                    }
                )
            if result:
                return result

        outcomes = _json_or_list(market.get("outcomes"))
        prices = _json_or_list(market.get("outcomePrices"))
        token_ids = _json_or_list(market.get("clobTokenIds"))
        if not token_ids:
            token_ids = _json_or_list(market.get("tokenIds"))

        for index, outcome in enumerate(outcomes):
            token_id = str(token_ids[index]).strip() if index < len(token_ids) else ""
            if not token_id:
                continue
            implied_probability = (
                _extract_price(prices[index]) if index < len(prices) else None
            )
            result.append(
                {
                    "outcome": str(outcome),
                    "token_id": token_id,
                    "implied_probability": implied_probability,
                }
            )
        return result

    def _resolve_yes_no_tokens(
        self,
        tokens: List[Dict[str, Any]],
    ) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
        if not tokens:
            return None, None

        yes_token = None
        no_token = None
        for token in tokens:
            label = _normalize_text(token.get("outcome"))
            if label in {"yes", "true", "above", "over"}:
                yes_token = token
            elif label in {"no", "false", "below", "under"}:
                no_token = token

        if yes_token and no_token:
            return yes_token, no_token

        if len(tokens) == 2:
            # Fallback for markets with unnamed binary outcomes.
            return tokens[0], tokens[1]

        return None, None

    def _get_clob_client(self) -> Optional[Any]:
        if self._clob_unavailable_reason:
            return None
        if self._clob_client is not None:
            return self._clob_client
        if ClobClient is None:
            self._clob_unavailable_reason = "py-clob-client is not installed."
            return None
        try:
            self._clob_client = ClobClient(host=self.clob_url, chain_id=self.chain_id)
            return self._clob_client
        except Exception as exc:
            self._clob_unavailable_reason = f"ClobClient init failed: {exc}"
            logger.warning(self._clob_unavailable_reason)
            return None

    def _get_token_market_data(self, token_id: str) -> Dict[str, Any]:
        token_id = str(token_id or "").strip()
        if not token_id:
            return {}

        now = time.time()
        with self._lock:
            cached = self._price_cache.get(token_id)
            if cached and now - cached.get("t", 0) < self.price_cache_ttl:
                return cached.get("data", {})

        data = self._fetch_token_market_data(token_id)

        with self._lock:
            self._price_cache[token_id] = {"data": data, "t": now}
        return data

    def _fetch_token_market_data(self, token_id: str) -> Dict[str, Any]:
        # 1) Preferred path: py-clob-client public methods.
        clob = self._get_clob_client()
        if clob is not None:
            try:
                buy = _extract_price(self._safe_call(clob, "get_price", token_id, "BUY"))
                sell = _extract_price(self._safe_call(clob, "get_price", token_id, "SELL"))
                midpoint = _extract_price(self._safe_call(clob, "get_midpoint", token_id))
                last_trade = _extract_price(
                    self._safe_call(clob, "get_last_trade_price", token_id)
                )
                orderbook_raw = self._safe_call(clob, "get_order_book", token_id)
                book, book_liquidity = self._normalize_orderbook(orderbook_raw)
                return {
                    "buy": buy,
                    "sell": sell,
                    "midpoint": midpoint,
                    "last_trade_price": last_trade,
                    "book": book,
                    "book_liquidity": book_liquidity,
                }
            except Exception as exc:
                logger.warning(f"py-clob-client read failed for {token_id}: {exc}")

        # 2) Fallback path: direct CLOB REST.
        buy = _extract_price(self._clob_get("/price", {"token_id": token_id, "side": "BUY"}))
        sell = _extract_price(
            self._clob_get("/price", {"token_id": token_id, "side": "SELL"})
        )
        midpoint = _extract_price(self._clob_get("/midpoint", {"token_id": token_id}))
        last_trade = _extract_price(
            self._clob_get("/last-trade-price", {"token_id": token_id})
        )
        orderbook_raw = self._clob_get("/book", {"token_id": token_id})
        book, book_liquidity = self._normalize_orderbook(orderbook_raw)
        return {
            "buy": buy,
            "sell": sell,
            "midpoint": midpoint,
            "last_trade_price": last_trade,
            "book": book,
            "book_liquidity": book_liquidity,
        }

    def _safe_call(self, client: Any, method: str, *args: Any) -> Any:
        fn = getattr(client, method, None)
        if not callable(fn):
            return None
        return fn(*args)

    def _clob_get(self, path: str, params: Dict[str, Any]) -> Any:
        url = f"{self.clob_url}{path}"
        try:
            resp = self._session.get(url, params=params, timeout=self.http_timeout)
            resp.raise_for_status()
            return resp.json()
        except Exception:
            return None

    def _normalize_orderbook(self, orderbook_raw: Any) -> Tuple[Optional[Dict[str, Any]], Optional[float]]:
        payload = _to_plain_dict(orderbook_raw)
        if not payload and isinstance(orderbook_raw, dict):
            payload = orderbook_raw
        if not payload:
            return None, None

        bids_raw = payload.get("bids") or []
        asks_raw = payload.get("asks") or []

        bid_levels: List[List[float]] = []
        ask_levels: List[List[float]] = []
        book_liquidity = 0.0

        def _parse_side(items: Any, sink: List[List[float]]) -> None:
            nonlocal book_liquidity
            if not isinstance(items, list):
                return
            for item in items:
                item_dict = _to_plain_dict(item)
                if item_dict:
                    price = _extract_price(item_dict.get("price"))
                    size = _extract_price(item_dict.get("size") or item_dict.get("quantity"))
                elif isinstance(item, (list, tuple)) and len(item) >= 2:
                    price = _extract_price(item[0])
                    size = _extract_price(item[1])
                else:
                    continue
                if price is None or size is None:
                    continue
                sink.append([price, size])
                book_liquidity += max(0.0, price * size)

        _parse_side(bids_raw, bid_levels)
        _parse_side(asks_raw, ask_levels)

        best_bid = bid_levels[0][0] if bid_levels else None
        best_ask = ask_levels[0][0] if ask_levels else None
        normalized = {
            "best_bid": best_bid,
            "best_ask": best_ask,
            "bid_levels": bid_levels[:10],
            "ask_levels": ask_levels[:10],
        }
        return normalized, (book_liquidity if book_liquidity > 0 else None)

    def _build_market_url(self, market: Dict[str, Any]) -> Optional[str]:
        slug = str(market.get("slug") or "").strip()
        event_slug = str(market.get("eventSlug") or "").strip()
        if event_slug:
            return f"https://polymarket.com/event/{event_slug}"
        if slug:
            return f"https://polymarket.com/market/{slug}"
        return None

    def _build_top_temperature_buckets(
        self,
        city_key: str,
        target_date: str,
        primary_market: Dict[str, Any],
        limit: int = 4,
    ) -> List[Dict[str, Any]]:
        candidate_markets = self._collect_related_temperature_markets(
            city_key=city_key,
            target_date=target_date,
            primary_market=primary_market,
        )
        if not candidate_markets:
            return []

        ranked: List[
            Tuple[
                float,
                float,
                Dict[str, Any],
                Dict[str, Any],
                Dict[str, Any],
                Dict[str, Any],
                Dict[str, Any],
            ]
        ] = []
        for market in candidate_markets:
            tokens = self._extract_market_tokens(market)
            yes_token, no_token = self._resolve_yes_no_tokens(tokens)
            if not yes_token or not no_token:
                continue

            yes_token_id = str(yes_token.get("token_id") or "").strip()
            no_token_id = str(no_token.get("token_id") or "").strip()
            yes_prices = self._get_token_market_data(yes_token_id) if yes_token_id else {}
            no_prices = self._get_token_market_data(no_token_id) if no_token_id else {}

            yes_midpoint = _extract_price(yes_prices.get("midpoint"))
            yes_implied = _extract_price(yes_token.get("implied_probability"))
            no_implied = _extract_price(no_token.get("implied_probability"))
            market_prob = (
                yes_midpoint
                if yes_midpoint is not None
                else (
                    yes_implied
                    if yes_implied is not None
                    else (1.0 - no_implied if no_implied is not None else None)
                )
            )
            if market_prob is None:
                continue

            market_prob = max(0.0, min(1.0, float(market_prob)))
            volume = (
                _extract_price(
                    market.get("volumeNum")
                    or market.get("volume")
                    or market.get("volume24hr")
                )
                or 0.0
            )
            ranked.append(
                (
                    market_prob,
                    volume,
                    market,
                    yes_token,
                    no_token,
                    yes_prices,
                    no_prices,
                )
            )

        if not ranked:
            return []

        ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)
        top_rows: List[Dict[str, Any]] = []
        max_items = max(1, int(limit or 4))
        primary_slug = str(primary_market.get("slug") or "").strip().lower()

        for market_prob, _volume, market, yes_token, no_token, yes_prices, no_prices in ranked[
            :max_items
        ]:
            yes_buy = _extract_price(yes_prices.get("buy"))
            yes_sell = _extract_price(yes_prices.get("sell"))
            yes_midpoint = _extract_price(yes_prices.get("midpoint")) or market_prob
            no_buy = _extract_price(no_prices.get("buy"))
            no_sell = _extract_price(no_prices.get("sell"))

            if no_buy is None and yes_buy is not None:
                no_buy = max(0.0, min(1.0, 1.0 - yes_buy))
            if no_sell is None and yes_sell is not None:
                no_sell = max(0.0, min(1.0, 1.0 - yes_sell))

            bucket_temp = self._extract_market_bucket_temp(market)
            market_slug = str(market.get("slug") or "").strip()

            top_rows.append(
                {
                    "label": self._extract_market_bucket_label(market, bucket_temp),
                    "value": bucket_temp,
                    "temp": bucket_temp,
                    "probability": market_prob,
                    "market_price": yes_midpoint,
                    "yes_buy": yes_buy,
                    "yes_sell": yes_sell,
                    "no_buy": no_buy,
                    "no_sell": no_sell,
                    "slug": market_slug or None,
                    "question": market.get("question") or market.get("title"),
                    "is_primary": bool(
                        primary_slug
                        and market_slug
                        and primary_slug == market_slug.strip().lower()
                    ),
                }
            )

        return top_rows

    def _collect_related_temperature_markets(
        self,
        city_key: str,
        target_date: str,
        primary_market: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        related: List[Dict[str, Any]] = []
        canonical_event_slug = self._build_weather_event_slug(city_key, target_date)
        if canonical_event_slug:
            related.extend(self._load_event_markets(canonical_event_slug))

        event_slug = self._extract_event_slug(primary_market)
        if event_slug and event_slug != canonical_event_slug:
            related.extend(self._load_event_markets(event_slug))

        if not related:
            for market in self._load_markets(active_only=True):
                if self._score_market(city_key, target_date, market) <= 0:
                    continue
                if self._extract_market_bucket_temp(market) is None:
                    continue
                related.append(market)

        related.append(primary_market)

        unique: List[Dict[str, Any]] = []
        seen = set()
        for market in related:
            if not isinstance(market, dict):
                continue
            dedupe_key = str(
                market.get("id")
                or market.get("slug")
                or market.get("conditionId")
                or ""
            ).strip()
            if not dedupe_key:
                continue
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            unique.append(market)
        return unique

    def _extract_event_slug(self, market: Dict[str, Any]) -> Optional[str]:
        event_slug = str(market.get("eventSlug") or "").strip().lower()
        if event_slug:
            return event_slug

        slug = str(market.get("slug") or "").strip().lower()
        if not slug:
            return None

        trimmed = re.sub(
            r"-(?:m)?\d+(?:-\d+)?c(?:-or-(?:higher|lower|above|below))?$",
            "",
            slug,
        )
        trimmed = trimmed.strip("-")
        return trimmed or None

    def _load_event_markets(self, event_slug: str) -> List[Dict[str, Any]]:
        normalized_slug = str(event_slug or "").strip().lower()
        if not normalized_slug:
            return []

        try:
            resp = self._session.get(
                f"{self.gamma_url}/events",
                params={"slug": normalized_slug, "limit": 5},
                timeout=self.http_timeout,
            )
            resp.raise_for_status()
            payload = resp.json()
        except Exception:
            return []

        events = payload if isinstance(payload, list) else []
        out: List[Dict[str, Any]] = []
        for event in events:
            if not isinstance(event, dict):
                continue
            event_item_slug = str(event.get("slug") or "").strip().lower()
            if event_item_slug and event_item_slug != normalized_slug:
                continue
            for market in event.get("markets") or []:
                if not isinstance(market, dict):
                    continue
                market["eventSlug"] = market.get("eventSlug") or event_item_slug
                market["eventTitle"] = market.get("eventTitle") or event.get("title")
                out.append(market)
        return out

    def _extract_market_bucket_label(
        self,
        market: Dict[str, Any],
        bucket_temp: Optional[float],
    ) -> str:
        question = str(market.get("question") or market.get("title") or "").strip()
        text = question.lower()
        if bucket_temp is not None:
            if "or higher" in text or "or above" in text or "and above" in text:
                return f"{bucket_temp:g}C+"
            if "or lower" in text or "or below" in text or "and below" in text:
                return f"<={bucket_temp:g}C"
            return f"{bucket_temp:g}C"
        return question or str(market.get("slug") or "")
