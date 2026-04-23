"""
Polymarket read-only market layer.

P0 scope:
- Market discovery from Gamma REST
- Price / midpoint / spread / orderbook read from CLOB REST
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
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from loguru import logger

from src.data_collection.city_registry import ALIASES, CITY_REGISTRY


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


def _safe_bool(value: Any) -> Optional[bool]:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    return bool(value)


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


MARKET_CITY_ALIASES: Dict[str, str] = {
    # Lau Fau Shan has its own HKO observation / settlement layer, but
    # Polymarket lists this temperature market under nearby Shenzhen.
    "lau fau shan": "shenzhen",
}


def _resolve_market_city_key(city_key: str) -> str:
    return MARKET_CITY_ALIASES.get(city_key, city_key)


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


def _clamp_probability(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value


def _clamp_float(value: Optional[float], lower: float, upper: float) -> Optional[float]:
    if value is None:
        return None
    return max(lower, min(upper, float(value)))


def _parse_hhmm_to_minutes(value: Any) -> Optional[int]:
    text = str(value or "").strip()
    if not text or ":" not in text:
        return None
    try:
        hh, mm = text.split(":", 1)
        hour = int(hh)
        minute = int(mm[:2])
    except Exception:
        return None
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        return None
    return hour * 60 + minute


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


def _parse_iso_datetime_utc(value: Any) -> Optional[datetime]:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    # Prefer timestamps that include a time component; plain dates are ambiguous.
    if "T" not in text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except Exception:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


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
        self.http_timeout = _safe_float(os.getenv("POLYMARKET_HTTP_TIMEOUT_SEC")) or 8.0
        self.market_cache_ttl = _safe_int(
            os.getenv("POLYMARKET_MARKET_CACHE_TTL_SEC", "60"),
            60,
        )
        self.price_cache_ttl = _safe_int(
            os.getenv("POLYMARKET_PRICE_CACHE_TTL_SEC", "30"),
            30,
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

        self._session = httpx.Client(
            timeout=self.http_timeout,
            follow_redirects=True,
        )
        self._markets_cache: Dict[str, Dict[str, Any]] = {}
        self._active_markets_cache: Dict[str, Any] = {"data": [], "t": 0.0}
        self._broad_markets_cache: Dict[str, Any] = {"data": [], "t": 0.0}
        self._price_cache: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()

    def _market_scan_debug_enabled(self) -> bool:
        return (
            str(os.getenv("POLYMARKET_MARKET_SCAN_DEBUG", "false")).strip().lower()
            in {"1", "true", "yes", "on"}
        )

    def _debug_market_scan(self, message: str, **payload: Any) -> None:
        if not self._market_scan_debug_enabled():
            return
        try:
            details = json.dumps(payload, ensure_ascii=False, default=str)
        except Exception:
            details = str(payload)
        logger.info(f"POLYMARKET_MARKET_SCAN_DEBUG {message} {details}")

    def build_market_scan(
        self,
        city: Any,
        target_date: Any,
        temperature_bucket: Optional[Dict[str, Any]] = None,
        model_probability: Optional[float] = None,
        probability_distribution: Optional[List[Dict[str, Any]]] = None,
        temp_symbol: Optional[str] = None,
        fallback_sparkline: Optional[List[float]] = None,
        forced_market_slug: Optional[str] = None,
        include_related_buckets: bool = True,
        scan_filters: Optional[Dict[str, Any]] = None,
        scan_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        date_str = _extract_iso_date(target_date) or str(target_date or "")
        city_key = _normalize_city_key(city)
        market_city_key = _resolve_market_city_key(city_key)
        requested_slug = str(forced_market_slug or "").strip().lower() or None

        scan: Dict[str, Any] = {
            "available": False,
            "reason": None,
            "city_key": city_key or None,
            "market_city_key": market_city_key or None,
            "primary_market": None,
            "selected_date": date_str or None,
            "selected_condition_id": None,
            "selected_slug": requested_slug,
            "temperature_bucket": temperature_bucket,
            "model_probability": model_probability,
            "market_price": None,
            "midpoint": None,
            "spread": None,
            "edge_percent": None,
            "signal_label": "MONITOR",
            "confidence": "low",
            "yes_token": None,
            "no_token": None,
            "yes_buy": None,
            "yes_sell": None,
            "yes_midpoint": None,
            "yes_spread": None,
            "no_buy": None,
            "no_sell": None,
            "no_midpoint": None,
            "no_spread": None,
            "last_trade_price": None,
            "liquidity": None,
            "volume": None,
            "quote_source": None,
            "quote_age_ms": None,
            "price_analysis": None,
            "sparkline": fallback_sparkline or [],
            "top_buckets": [],
            "all_buckets": [],
            "recent_trades": [],
            "scan_scope": "full" if include_related_buckets else "lite",
            "distribution_bias": None,
            "window_phase": None,
            "window_score": None,
            "primary_signal": None,
            "signal_status": "no_market",
            "candidate_count": 0,
            "scan_rows": [],
            "resolved_market_type": "maxtemp",
            "websocket": {
                "enabled": False,
                "status": "disabled_rest_only",
            },
        }

        if not self.enabled:
            scan["reason"] = "Market scan disabled by POLYMARKET_MARKET_SCAN_ENABLED."
            self._debug_market_scan("disabled", city=city_key, date=date_str)
            return scan

        if not city_key or city_key not in CITY_REGISTRY:
            scan["reason"] = "City is not supported by the Polymarket market layer."
            self._debug_market_scan("unsupported_city", city=city, normalized=city_key)
            return scan

        if not market_city_key or market_city_key not in CITY_REGISTRY:
            scan["reason"] = "Mapped market city is not supported by the Polymarket market layer."
            self._debug_market_scan(
                "unsupported_market_city",
                city=city_key,
                market_city=market_city_key,
            )
            return scan

        if not date_str:
            scan["reason"] = "Missing target date for market discovery."
            self._debug_market_scan("missing_date", city=city_key, market_city=market_city_key)
            return scan

        try:
            preferred_temp = None
            if isinstance(temperature_bucket, dict):
                preferred_temp = _safe_float(temperature_bucket.get("temp"))
            market, reason = self._find_primary_market(
                market_city_key,
                date_str,
                forced_market_slug=requested_slug,
                preferred_temp=preferred_temp,
            )
        except Exception as exc:
            logger.warning(
                f"Polymarket market discovery failed ({city_key}->{market_city_key}): {exc}"
            )
            scan["reason"] = "Market discovery failed."
            self._debug_market_scan(
                "discovery_exception",
                city=city_key,
                market_city=market_city_key,
                error=str(exc),
            )
            return scan

        if not market:
            scan["reason"] = reason or "No active Polymarket market matched city/date."
            self._debug_market_scan(
                "no_market",
                city=city_key,
                market_city=market_city_key,
                date=date_str,
                forced_slug=requested_slug,
                reason=scan["reason"],
            )
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
        trade_state = self._market_trade_state(market)
        primary_market_payload = {
            "id": market.get("id"),
            "question": market.get("question") or market.get("title"),
            "slug": market_slug,
            "condition_id": condition_id,
            "end_date": market_date,
            "active": trade_state.get("active"),
            "closed": trade_state.get("closed"),
            "accepting_orders": trade_state.get("accepting_orders"),
            "ended_at_utc": trade_state.get("ended_at_utc"),
            "tradable": trade_state.get("tradable"),
            "tradable_reason": trade_state.get("reason"),
            "liquidity": liquidity,
            "volume": volume,
        }
        if not trade_state.get("tradable"):
            scan["reason"] = (
                "Matched market is not tradable."
                + (
                    f" reason={trade_state.get('reason')}"
                    if trade_state.get("reason")
                    else ""
                )
            )
            scan["primary_market"] = primary_market_payload
            scan["selected_condition_id"] = condition_id
            scan["selected_slug"] = market_slug
            scan["liquidity"] = liquidity
            scan["volume"] = volume
            self._debug_market_scan(
                "not_tradable",
                city=city_key,
                market_city=market_city_key,
                date=date_str,
                slug=market_slug,
                trade_state=trade_state,
            )
            return scan

        tokens = self._extract_market_tokens(market)
        yes_token, no_token = self._resolve_yes_no_tokens(tokens)
        if not yes_token or not no_token:
            scan["reason"] = "Matched market has no resolvable YES/NO token pair."
            scan["primary_market"] = primary_market_payload
            scan["selected_condition_id"] = condition_id
            scan["selected_slug"] = market_slug
            scan["liquidity"] = liquidity
            scan["volume"] = volume
            self._debug_market_scan(
                "missing_tokens",
                city=city_key,
                market_city=market_city_key,
                date=date_str,
                slug=market_slug,
                token_count=len(tokens),
            )
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
        distribution_model_probability = self._aggregate_distribution_probability_for_market(
            market=market,
            probability_distribution=probability_distribution,
            temp_symbol=temp_symbol,
        )
        if distribution_model_probability is not None:
            model_probability = distribution_model_probability

        edge_percent = None
        if model_probability is not None and market_price is not None:
            edge_percent = (model_probability - market_price) * 100.0

        signal_label, confidence = self._derive_signal(edge_percent, liquidity)

        top_buckets: List[Dict[str, Any]] = []
        all_buckets: List[Dict[str, Any]] = []
        if include_related_buckets:
            top_bucket_limit = max(
                1,
                _safe_int(os.getenv("POLYMARKET_TOP_BUCKET_LIMIT", "4"), 4),
            )
            all_bucket_limit = max(
                top_bucket_limit,
                _safe_int(os.getenv("POLYMARKET_ALL_BUCKET_LIMIT", "8"), 8),
            )
            all_buckets = self._build_top_temperature_buckets(
                city_key=market_city_key,
                target_date=date_str,
                primary_market=market,
                probability_distribution=probability_distribution,
                temp_symbol=temp_symbol,
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
            "quote_source": yes_prices.get("quote_source"),
            "quote_age_ms": _safe_int(yes_prices.get("quote_age_ms"), 0),
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
            "quote_source": no_prices.get("quote_source"),
            "quote_age_ms": _safe_int(no_prices.get("quote_age_ms"), 0),
            "book": no_prices.get("book"),
        }
        yes_midpoint = _extract_price(yes_payload.get("midpoint"))
        no_midpoint = _extract_price(no_payload.get("midpoint"))
        yes_buy = _extract_price(yes_payload.get("buy_price"))
        yes_sell = _extract_price(yes_payload.get("sell_price"))
        no_buy = _extract_price(no_payload.get("buy_price"))
        no_sell = _extract_price(no_payload.get("sell_price"))
        yes_spread = (
            max(0.0, float(yes_buy) - float(yes_sell))
            if yes_buy is not None and yes_sell is not None
            else None
        )
        no_spread = (
            max(0.0, float(no_buy) - float(no_sell))
            if no_buy is not None and no_sell is not None
            else None
        )
        price_analysis = self._build_price_analysis(
            model_probability=model_probability,
            yes_buy=yes_buy,
            yes_sell=yes_sell,
            no_buy=no_buy,
            no_sell=no_sell,
        )
        distribution_scan = self._build_distribution_scan_pack(
            city_key=market_city_key,
            target_date=date_str,
            primary_market=market,
            probability_distribution=probability_distribution,
            temp_symbol=temp_symbol,
            scan_context=scan_context,
            scan_filters=scan_filters,
        )
        primary_signal = distribution_scan.get("primary_signal")
        if isinstance(primary_signal, dict):
            signal_label = str(primary_signal.get("action") or signal_label or "").strip() or signal_label
            signal_score = _safe_float(primary_signal.get("final_score"))
            if signal_score is not None and signal_score >= 85.0:
                confidence = "high"
            elif signal_score is not None and signal_score >= 70.0:
                confidence = "medium"
            elif signal_score is not None:
                confidence = "low"
            signal_edge = _safe_float(primary_signal.get("edge_percent"))
            if signal_edge is not None:
                edge_percent = signal_edge

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
                "primary_market": primary_market_payload,
                "selected_condition_id": condition_id,
                "selected_slug": market_slug,
                "model_probability": model_probability,
                "market_price": market_price,
                "midpoint": yes_midpoint if yes_midpoint is not None else market_price,
                "spread": yes_spread,
                "edge_percent": edge_percent,
                "signal_label": signal_label,
                "confidence": confidence,
                "yes_token": yes_payload,
                "no_token": no_payload,
                "yes_buy": yes_buy,
                "yes_sell": yes_sell,
                "yes_midpoint": yes_midpoint,
                "yes_spread": yes_spread,
                "no_buy": no_buy,
                "no_sell": no_sell,
                "no_midpoint": no_midpoint,
                "no_spread": no_spread,
                "last_trade_price": last_trade_price,
                "liquidity": liquidity,
                "volume": volume,
                "quote_source": yes_prices.get("quote_source"),
                "quote_age_ms": _safe_int(yes_prices.get("quote_age_ms"), 0),
                "price_analysis": price_analysis,
                "sparkline": sparkline_values,
                "top_buckets": top_buckets,
                "all_buckets": all_buckets,
                "distribution_bias": distribution_scan.get("distribution_bias"),
                "window_phase": distribution_scan.get("window_phase"),
                "window_score": distribution_scan.get("window_score"),
                "primary_signal": primary_signal,
                "signal_status": distribution_scan.get("signal_status"),
                "candidate_count": distribution_scan.get("candidate_count"),
                "scan_rows": distribution_scan.get("rows") or [],
                "resolved_market_type": distribution_scan.get("resolved_market_type") or "maxtemp",
                "websocket": {
                    "enabled": False,
                    "status": "disabled_rest_only",
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
        self._debug_market_scan(
            "scan_ready",
            city=city_key,
            market_city=market_city_key,
            date=date_str,
            selected_slug=market_slug,
            market_price=scan.get("market_price"),
            yes_buy=scan.get("yes_buy"),
            yes_sell=scan.get("yes_sell"),
            no_buy=scan.get("no_buy"),
            no_sell=scan.get("no_sell"),
            price_analysis_available=bool(price_analysis and price_analysis.get("available")),
            all_buckets_count=len(all_buckets),
            top_buckets=[
                {
                    "temp": row.get("temp"),
                    "yes_buy": row.get("yes_buy"),
                    "market_price": row.get("market_price"),
                    "quote_source": row.get("quote_source"),
                    "slug": row.get("slug"),
                }
                for row in all_buckets[:6]
                if isinstance(row, dict)
            ],
            websocket=scan.get("websocket"),
        )
        return scan

    def _hydrate_bucket_prices(self, buckets: List[Dict[str, Any]]) -> None:
        for bucket in buckets:
            if not isinstance(bucket, dict):
                continue
            yes_token_id = str(bucket.get("yes_token_id") or "").strip()
            no_token_id = str(bucket.get("no_token_id") or "").strip()
            if not yes_token_id:
                continue

            yes_prices = self._get_token_market_data(yes_token_id)
            no_prices = self._get_token_market_data(no_token_id) if no_token_id else {}
            yes_buy = _extract_price(yes_prices.get("buy"))
            yes_sell = _extract_price(yes_prices.get("sell"))
            no_buy = _extract_price(no_prices.get("buy"))
            no_sell = _extract_price(no_prices.get("sell"))
            yes_midpoint = _extract_price(yes_prices.get("midpoint"))

            if yes_buy is not None:
                bucket["yes_buy"] = yes_buy
            if yes_sell is not None:
                bucket["yes_sell"] = yes_sell
            if no_buy is not None:
                bucket["no_buy"] = no_buy
            if no_sell is not None:
                bucket["no_sell"] = no_sell
            reference_price = yes_midpoint
            if reference_price is None and yes_buy is not None and yes_sell is not None:
                reference_price = (yes_buy + yes_sell) / 2.0
            if reference_price is None:
                reference_price = yes_buy if yes_buy is not None else yes_sell
            if reference_price is not None:
                reference_price = max(0.0, min(1.0, float(reference_price)))
                bucket["market_price"] = reference_price
                bucket["probability"] = reference_price
            if yes_prices.get("quote_source"):
                bucket["quote_source"] = yes_prices.get("quote_source")
            if yes_prices.get("quote_age_ms") is not None:
                bucket["quote_age_ms"] = _safe_int(yes_prices.get("quote_age_ms"), 0)

    def _build_price_analysis(
        self,
        *,
        model_probability: Optional[float],
        yes_buy: Optional[float],
        yes_sell: Optional[float],
        no_buy: Optional[float],
        no_sell: Optional[float],
    ) -> Dict[str, Any]:
        """Build read-only market price diagnostics.

        Polymarket CLOB naming is from the user's perspective:
        BUY is the executable ask to buy that outcome, SELL is the executable bid.
        Kelly here is a sizing reference only; no order execution is performed.
        """
        p_yes = _clamp_probability(_safe_float(model_probability))
        p_no = _clamp_probability(1.0 - p_yes if p_yes is not None else None)
        yes_ask = _clamp_probability(_safe_float(yes_buy))
        no_ask = _clamp_probability(_safe_float(no_buy))
        yes_bid = _clamp_probability(_safe_float(yes_sell))
        no_bid = _clamp_probability(_safe_float(no_sell))

        yes = self._build_side_price_analysis("yes", p_yes, yes_ask, yes_bid)
        no = self._build_side_price_analysis("no", p_no, no_ask, no_bid)

        ask_sum = None
        lock_edge = None
        lock_available = False
        if yes_ask is not None and no_ask is not None:
            ask_sum = yes_ask + no_ask
            lock_edge = 1.0 - ask_sum
            lock_available = lock_edge > 0

        bid_sum = None
        sell_side_edge = None
        if yes_bid is not None and no_bid is not None:
            bid_sum = yes_bid + no_bid
            sell_side_edge = bid_sum - 1.0

        best_side = None
        side_rows = [
            row
            for row in [yes, no]
            if isinstance(row.get("edge"), (int, float))
            and isinstance(row.get("kelly_fraction"), (int, float))
            and row.get("kelly_fraction") > 0
        ]
        if side_rows:
            best_side = max(
                side_rows,
                key=lambda row: (
                    float(row.get("edge") or 0.0),
                    float(row.get("kelly_fraction") or 0.0),
                ),
            ).get("side")

        return {
            "available": any(
                value is not None
                for value in (yes_ask, no_ask, yes_bid, no_bid, p_yes)
            ),
            "source": "polymarket_clob_orderbook",
            "model_probability": p_yes,
            "yes": yes,
            "no": no,
            "best_side": best_side,
            "lock": {
                "available": lock_available,
                "ask_sum": ask_sum,
                "edge": lock_edge,
            },
            "sell_side": {
                "bid_sum": bid_sum,
                "edge": sell_side_edge,
            },
        }

    def _build_side_price_analysis(
        self,
        side: str,
        probability: Optional[float],
        ask: Optional[float],
        bid: Optional[float],
    ) -> Dict[str, Any]:
        edge = None
        kelly_fraction = None
        if probability is not None and ask is not None:
            edge = probability - ask
            if 0.0 < ask < 1.0:
                kelly_fraction = edge / (1.0 - ask)

        return {
            "side": side,
            "model_probability": probability,
            "ask": ask,
            "bid": bid,
            "edge": edge,
            "edge_percent": edge * 100.0 if edge is not None else None,
            "kelly_fraction": kelly_fraction,
            "quarter_kelly": (
                max(0.0, kelly_fraction) / 4.0
                if kelly_fraction is not None
                else None
            ),
        }

    def _market_trade_state(self, market: Dict[str, Any]) -> Dict[str, Any]:
        active = _safe_bool(market.get("active"))
        closed_raw = _safe_bool(market.get("closed"))
        closed = bool(closed_raw) if closed_raw is not None else False
        accepting_orders = _safe_bool(
            market.get("acceptingOrders", market.get("accepting_orders"))
        )

        ended_at = None
        for key in ("endDate", "resolutionDate", "closedTime", "gameStartTime"):
            parsed = _parse_iso_datetime_utc(market.get(key))
            if parsed is not None:
                ended_at = parsed
                break

        tradable = True
        reason = None
        if closed:
            tradable = False
            reason = "closed"
        elif active is False:
            tradable = False
            reason = "inactive"
        elif accepting_orders is False:
            tradable = False
            reason = "not_accepting_orders"

        return {
            "active": active,
            "closed": closed,
            "accepting_orders": accepting_orders,
            "ended_at_utc": ended_at.isoformat() if ended_at is not None else None,
            "tradable": tradable,
            "reason": reason,
        }

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

        preferred_temp_key = (
            f"{float(preferred_temp):.2f}"
            if preferred_temp is not None
            else "none"
        )
        cache_key = f"{city_key}|{target_date}|{preferred_temp_key}"
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
            score = self._score_market(
                city_key,
                target_date,
                market,
                preferred_temp=preferred_temp,
            )
            if score <= 0:
                continue
            scored.append((score, market))

        # Fallback to broader active universe when strict filters miss.
        if not scored:
            broader = self._load_markets(active_only=False)
            for market in broader:
                score = self._score_market(
                    city_key,
                    target_date,
                    market,
                    preferred_temp=preferred_temp,
                )
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

    def _score_market(
        self,
        city_key: str,
        target_date: str,
        market: Dict[str, Any],
        preferred_temp: Optional[float] = None,
    ) -> float:
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

        if not self._is_temperature_market(market):
            return 0.0

        score = 40.0
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

        if preferred_temp is not None:
            market_temp = self._extract_market_bucket_temp(market)
            bucket_range = self._extract_market_bucket_range(market)
            direction = self._extract_market_bucket_direction(market)
            if market_temp is not None:
                diff = abs(float(market_temp) - float(preferred_temp))
                score += max(-40.0, 60.0 - diff * 15.0)

            if bucket_range is not None:
                lower, upper, _unit = bucket_range
                contains_preferred = False
                if upper is not None:
                    contains_preferred = lower <= float(preferred_temp) <= upper
                elif direction == "above":
                    contains_preferred = float(preferred_temp) >= lower
                elif direction == "below":
                    contains_preferred = float(preferred_temp) <= lower
                else:
                    contains_preferred = abs(float(preferred_temp) - lower) <= 0.51

                if contains_preferred:
                    if upper is not None or direction == "exact":
                        score += 28.0
                    else:
                        score += 18.0
        return score

    def _is_temperature_market(self, market: Dict[str, Any]) -> bool:
        text_parts = [
            market.get("question"),
            market.get("title"),
            market.get("slug"),
            market.get("eventSlug"),
            market.get("description"),
        ]
        raw_text = " ".join(str(part or "") for part in text_parts)
        if not raw_text:
            return False

        # Hard signal: contains explicit Celsius bucket text like "10C" / "10°C"
        if re.search(r"(-?\d+(?:\.\d+)?)\s*[°º]?\s*c\b", raw_text, re.IGNORECASE):
            return True

        text = _normalize_text(raw_text)
        if not text:
            return False

        # Weather temperature event patterns.
        if "highest temperature" in text:
            return True
        if "temperature in" in text:
            return True
        if "high temperature" in text:
            return True

        # Conservative fallback: must explicitly mention temperature and boundary wording.
        if "temperature" in text and any(
            key in text for key in ("or higher", "or above", "or lower", "or below", "and above", "and below")
        ):
            return True

        return False

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
        parsed = self._extract_market_bucket_range(market)
        if parsed:
            lower, upper, _unit = parsed
            if upper is not None:
                return (lower + upper) / 2.0
            return lower
        return None

    def _extract_market_bucket_range(
        self,
        market: Dict[str, Any],
    ) -> Optional[Tuple[float, Optional[float], str]]:
        slug = str(market.get("slug") or "").strip().lower()
        slug_range = re.search(
            r"-(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)([cf])(?:$|-or-higher|-or-lower|orhigher|orlower)",
            slug,
            re.IGNORECASE,
        )
        if slug_range:
            lower = _safe_float(slug_range.group(1))
            upper = _safe_float(slug_range.group(2))
            unit = slug_range.group(3).upper()
            if lower is not None and upper is not None and abs(upper - lower) <= 20:
                return min(lower, upper), max(lower, upper), unit

        text = " ".join(
            str(part or "")
            for part in (
                market.get("question"),
                market.get("title"),
            )
        )
        # Match range buckets such as "80-81°F" and "80 to 81F".
        range_match = re.search(
            r"(-?\d+(?:\.\d+)?)\s*(?:-|–|—|\bto\b)\s*(-?\d+(?:\.\d+)?)\s*°?\s*([cf])\b",
            text,
            re.IGNORECASE,
        )
        if range_match:
            lower = _safe_float(range_match.group(1))
            upper = _safe_float(range_match.group(2))
            unit = range_match.group(3).upper()
            if lower is not None and upper is not None and abs(upper - lower) <= 20:
                return min(lower, upper), max(lower, upper), unit

        slug_exact = re.search(
            r"-(\d+(?:\.\d+)?)([cf])(?:$|-or-higher|-or-lower|orhigher|orlower)",
            slug,
            re.IGNORECASE,
        )
        if slug_exact:
            value = _safe_float(slug_exact.group(1))
            unit = slug_exact.group(2).upper()
            if value is not None:
                return value, None, unit

        # Match "... 9°C ..." / "... 9F ..." / "... -2 C ..."
        match = re.search(r"(-?\d+(?:\.\d+)?)\s*°?\s*([cf])\b", text, re.IGNORECASE)
        if match:
            value = _safe_float(match.group(1))
            unit = match.group(2).upper()
            if value is not None:
                return value, None, unit
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

    def _is_fahrenheit_symbol(self, symbol: Optional[str]) -> bool:
        return "F" in str(symbol or "").upper()

    def _convert_temp_to_market_unit(
        self,
        value: Optional[float],
        source_symbol: Optional[str],
        market_unit: Optional[str],
    ) -> Optional[float]:
        numeric = _safe_float(value)
        if numeric is None:
            return None
        normalized_unit = str(market_unit or "").upper()
        source_is_f = self._is_fahrenheit_symbol(source_symbol)
        if normalized_unit == "F":
            return numeric if source_is_f else (numeric * 9.0 / 5.0) + 32.0
        return ((numeric - 32.0) * 5.0 / 9.0) if source_is_f else numeric

    def _market_bucket_contains_distribution_temp(
        self,
        market: Dict[str, Any],
        distribution_temp: Optional[float],
        temp_symbol: Optional[str],
    ) -> bool:
        compare_temp = self._convert_temp_to_market_unit(
            distribution_temp,
            source_symbol=temp_symbol,
            market_unit=(self._extract_market_bucket_range(market) or (None, None, "C"))[2],
        )
        if compare_temp is None:
            return False

        bucket_range = self._extract_market_bucket_range(market)
        lower = bucket_range[0] if bucket_range else None
        upper = bucket_range[1] if bucket_range else None
        unit = bucket_range[2] if bucket_range else "C"
        direction = self._extract_market_bucket_direction(market)

        if lower is not None and upper is not None:
            return compare_temp >= lower - 0.01 and compare_temp <= upper + 0.01
        if lower is not None and direction == "above":
            return compare_temp >= lower - 0.01
        if lower is not None and direction == "below":
            return compare_temp <= lower + 0.01

        reference = self._extract_market_bucket_temp(market)
        if reference is None:
            return False
        tolerance = 0.56 if str(unit or "").upper() == "F" else 0.26
        return abs(compare_temp - reference) <= tolerance

    def _aggregate_distribution_probability_for_market(
        self,
        market: Dict[str, Any],
        probability_distribution: Optional[List[Dict[str, Any]]],
        temp_symbol: Optional[str],
    ) -> Optional[float]:
        if not isinstance(probability_distribution, list) or not probability_distribution:
            return None

        total = 0.0
        matched = 0
        for row in probability_distribution:
            if not isinstance(row, dict):
                continue
            distribution_temp = _safe_float(row.get("value"))
            if distribution_temp is None:
                continue
            if not self._market_bucket_contains_distribution_temp(
                market,
                distribution_temp,
                temp_symbol,
            ):
                continue
            raw_probability = _safe_float(row.get("probability"))
            if raw_probability is None:
                continue
            probability = raw_probability / 100.0 if raw_probability > 1.0 else raw_probability
            probability = max(0.0, min(1.0, probability))
            total += probability
            matched += 1
        if matched <= 0:
            return None
        return max(0.0, min(1.0, total))

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
        # REST-only path: CLOB public endpoints.
        bid = _extract_price(self._clob_get("/price", {"token_id": token_id, "side": "BUY"}))
        ask = _extract_price(
            self._clob_get("/price", {"token_id": token_id, "side": "SELL"})
        )
        midpoint = _extract_price(self._clob_get("/midpoint", {"token_id": token_id}))
        last_trade = _extract_price(
            self._clob_get("/last-trade-price", {"token_id": token_id})
        )
        orderbook_raw = self._clob_get("/book", {"token_id": token_id})
        book, book_liquidity = self._normalize_orderbook(orderbook_raw)
        buy, sell = self._resolve_trade_prices(buy=ask, sell=bid, book=book)
        return {
            "buy": buy,
            "sell": sell,
            "midpoint": midpoint,
            "last_trade_price": last_trade,
            "quote_source": "polymarket_clob_rest",
            "quote_age_ms": 0,
            "book": book,
            "book_liquidity": book_liquidity,
        }

    def _clob_get(self, path: str, params: Dict[str, Any]) -> Any:
        url = f"{self.clob_url}{path}"
        try:
            resp = self._session.get(url, params=params, timeout=self.http_timeout)
            resp.raise_for_status()
            return resp.json()
        except Exception:
            return None

    def _resolve_trade_prices(
        self,
        buy: Optional[float],
        sell: Optional[float],
        book: Optional[Dict[str, Any]],
    ) -> Tuple[Optional[float], Optional[float]]:
        payload = book if isinstance(book, dict) else {}
        best_bid = _extract_price(payload.get("best_bid"))
        best_ask = _extract_price(payload.get("best_ask"))
        resolved_buy = best_ask if best_ask is not None else buy
        resolved_sell = best_bid if best_bid is not None else sell
        return resolved_buy, resolved_sell

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

        bid_levels.sort(key=lambda level: level[0], reverse=True)
        ask_levels.sort(key=lambda level: level[0])
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
        probability_distribution: Optional[List[Dict[str, Any]]] = None,
        temp_symbol: Optional[str] = None,
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
                float,
                float,
                Dict[str, Any],
                Dict[str, Any],
                Dict[str, Any],
                Dict[str, Any],
                Dict[str, Any],
                Optional[Tuple[float, Optional[float], str]],
            ]
        ] = []
        for market in candidate_markets:
            if not self._market_trade_state(market).get("tradable"):
                continue
            bucket_temp = self._extract_market_bucket_temp(market)
            bucket_range = self._extract_market_bucket_range(market)
            if bucket_temp is None:
                continue

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
            model_prob = self._aggregate_distribution_probability_for_market(
                market=market,
                probability_distribution=probability_distribution,
                temp_symbol=temp_symbol,
            )
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
                    model_prob if model_prob is not None else market_prob,
                    volume,
                    bucket_temp,
                    market_prob,
                    market,
                    yes_token,
                    no_token,
                    yes_prices,
                    no_prices,
                    bucket_range,
                )
            )

        if not ranked:
            return []

        ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)
        top_rows: List[Dict[str, Any]] = []
        max_items = max(1, int(limit or 4))
        primary_slug = str(primary_market.get("slug") or "").strip().lower()
        primary_direction = self._extract_market_bucket_direction(primary_market)
        seen_temp_keys: set = set()

        def _append_rows(enforce_primary_direction: bool) -> None:
            for (
                model_prob,
                _volume,
                bucket_temp,
                market_prob,
                market,
                yes_token,
                no_token,
                yes_prices,
                no_prices,
                bucket_range,
            ) in ranked:
                row_direction = self._extract_market_bucket_direction(market)
                if (
                    enforce_primary_direction
                    and primary_direction in {"above", "below"}
                    and row_direction != primary_direction
                ):
                    continue

                temp_key = f"{round(float(bucket_temp), 2):.2f}"
                if temp_key in seen_temp_keys:
                    continue

                yes_buy = _extract_price(yes_prices.get("buy"))
                yes_sell = _extract_price(yes_prices.get("sell"))
                yes_midpoint = _extract_price(yes_prices.get("midpoint")) or market_prob
                no_buy = _extract_price(no_prices.get("buy"))
                no_sell = _extract_price(no_prices.get("sell"))

                if no_buy is None and yes_buy is not None:
                    no_buy = max(0.0, min(1.0, 1.0 - yes_buy))
                if no_sell is None and yes_sell is not None:
                    no_sell = max(0.0, min(1.0, 1.0 - yes_sell))

                market_slug = str(market.get("slug") or "").strip()
                row_yes_token_id = str(yes_token.get("token_id") or "").strip()
                row_no_token_id = str(no_token.get("token_id") or "").strip()
                top_rows.append(
                    {
                        "label": self._extract_market_bucket_label(market, bucket_temp),
                        "value": bucket_temp,
                        "temp": bucket_temp,
                        "lower": bucket_range[0] if bucket_range else None,
                        "upper": bucket_range[1] if bucket_range else None,
                        "unit": bucket_range[2] if bucket_range else None,
                        "probability": model_prob,
                        "model_probability": model_prob,
                        "market_price": yes_midpoint,
                        "edge_percent": (
                            (model_prob - yes_midpoint) * 100.0
                            if model_prob is not None and yes_midpoint is not None
                            else None
                        ),
                        "yes_buy": yes_buy,
                        "yes_sell": yes_sell,
                        "no_buy": no_buy,
                        "no_sell": no_sell,
                        "yes_token_id": row_yes_token_id or None,
                        "no_token_id": row_no_token_id or None,
                        "quote_source": yes_prices.get("quote_source"),
                        "quote_age_ms": _safe_int(yes_prices.get("quote_age_ms"), 0),
                        "slug": market_slug or None,
                        "question": market.get("question") or market.get("title"),
                        "is_primary": bool(
                            primary_slug
                            and market_slug
                            and primary_slug == market_slug.strip().lower()
                        ),
                    }
                )
                seen_temp_keys.add(temp_key)
                if len(top_rows) >= max_items:
                    break

        if primary_direction in {"above", "below"}:
            _append_rows(enforce_primary_direction=True)
        if len(top_rows) < max_items:
            _append_rows(enforce_primary_direction=False)

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
        direction = self._extract_market_bucket_direction(market)
        bucket_range = self._extract_market_bucket_range(market)
        unit = bucket_range[2] if bucket_range else "C"
        if bucket_range and bucket_range[1] is not None:
            return f"{bucket_range[0]:g}-{bucket_range[1]:g}{unit}"
        if bucket_temp is not None:
            if direction == "above":
                return f"{bucket_temp:g}{unit}+"
            if direction == "below":
                return f"<={bucket_temp:g}{unit}"
            return f"{bucket_temp:g}{unit}"
        return question or str(market.get("slug") or "")

    def _extract_market_bucket_direction(self, market: Dict[str, Any]) -> str:
        text = " ".join(
            str(part or "")
            for part in (
                market.get("question"),
                market.get("title"),
                market.get("slug"),
            )
        ).lower()
        if not text:
            return "exact"

        if any(
            token in text
            for token in (
                "or higher",
                "or above",
                "and above",
                "forhigher",
                "forabove",
                "or-higher",
                "or-above",
            )
        ):
            return "above"
        if any(
            token in text
            for token in (
                "or lower",
                "or below",
                "and below",
                "forlower",
                "forbelow",
                "or-lower",
                "or-below",
            )
        ):
            return "below"
        return "exact"

    def _clob_post(self, path: str, payload: Any) -> Any:
        url = f"{self.clob_url}{path}"
        try:
            resp = self._session.post(url, json=payload, timeout=self.http_timeout)
            resp.raise_for_status()
            return resp.json()
        except Exception:
            return None

    def _batch_chunks(self, values: List[str], size: int = 200) -> List[List[str]]:
        if not values:
            return []
        chunk_size = max(1, min(int(size or 200), 500))
        return [values[index : index + chunk_size] for index in range(0, len(values), chunk_size)]

    def _extract_payload_token_id(self, payload: Any) -> Optional[str]:
        item = _to_plain_dict(payload)
        if not item and isinstance(payload, dict):
            item = payload
        if not item:
            return None
        token_id = str(
            item.get("asset_id")
            or item.get("assetId")
            or item.get("token_id")
            or item.get("tokenId")
            or item.get("id")
            or ""
        ).strip()
        return token_id or None

    def _extract_batch_scalar_map(self, payload: Any) -> Dict[str, float]:
        if not payload:
            return {}
        data = payload
        if isinstance(data, dict):
            for key in ("data", "midpoints", "spreads", "items", "results"):
                nested = data.get(key)
                if isinstance(nested, (dict, list)):
                    data = nested
                    break
        result: Dict[str, float] = {}
        if isinstance(data, dict):
            for key, value in data.items():
                numeric = _extract_price(value)
                if numeric is None:
                    continue
                result[str(key).strip()] = numeric
            return result
        if isinstance(data, list):
            for item in data:
                token_id = self._extract_payload_token_id(item)
                if not token_id:
                    continue
                item_dict = _to_plain_dict(item)
                numeric = _extract_price(
                    item_dict.get("midpoint")
                    or item_dict.get("mid_price")
                    or item_dict.get("spread")
                    or item_dict.get("price")
                    or item_dict.get("last_trade_price")
                    or item_dict.get("value")
                )
                if numeric is None:
                    continue
                result[token_id] = numeric
        return result

    def _extract_batch_price_map(self, payload: Any, side: str) -> Dict[str, float]:
        if not payload:
            return {}
        data = payload.get("data") if isinstance(payload, dict) and isinstance(payload.get("data"), dict) else payload
        result: Dict[str, float] = {}
        if not isinstance(data, dict):
            return result
        for token_id, side_map in data.items():
            token_key = str(token_id).strip()
            if not token_key:
                continue
            item = _to_plain_dict(side_map)
            if not item and isinstance(side_map, dict):
                item = side_map
            numeric = _extract_price(item.get(side) if item else side_map)
            if numeric is None:
                continue
            result[token_key] = numeric
        return result

    def _extract_batch_book_map(self, payload: Any) -> Dict[str, Dict[str, Any]]:
        if not payload:
            return {}
        data = payload
        if isinstance(data, dict):
            for key in ("data", "books", "items", "results"):
                nested = data.get(key)
                if isinstance(nested, (dict, list)):
                    data = nested
                    break
        result: Dict[str, Dict[str, Any]] = {}
        if isinstance(data, dict):
            for token_id, book in data.items():
                token_key = str(token_id).strip()
                book_dict = _to_plain_dict(book)
                if not token_key or not book_dict:
                    continue
                result[token_key] = book_dict
            return result
        if isinstance(data, list):
            for item in data:
                token_id = self._extract_payload_token_id(item)
                book_dict = _to_plain_dict(item)
                if not token_id or not book_dict:
                    continue
                result[token_id] = book_dict
        return result

    def _batch_get_token_market_data(
        self,
        token_ids: List[str],
        *,
        include_books: bool = False,
    ) -> Dict[str, Dict[str, Any]]:
        unique_tokens = []
        seen = set()
        for token_id in token_ids:
            normalized = str(token_id or "").strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            unique_tokens.append(normalized)

        if not unique_tokens:
            return {}

        now = time.time()
        results: Dict[str, Dict[str, Any]] = {}
        missing: List[str] = []
        with self._lock:
            for token_id in unique_tokens:
                cached = self._price_cache.get(token_id)
                if not cached or now - cached.get("t", 0) >= self.price_cache_ttl:
                    missing.append(token_id)
                    continue
                cached_data = cached.get("data", {}) or {}
                if include_books and not cached_data.get("book") and cached_data.get("book_liquidity") is None:
                    missing.append(token_id)
                    continue
                results[token_id] = dict(cached_data)

        if not missing:
            return results

        ask_map: Dict[str, float] = {}
        bid_map: Dict[str, float] = {}
        midpoint_map: Dict[str, float] = {}
        spread_map: Dict[str, float] = {}
        last_trade_map: Dict[str, float] = {}
        book_map: Dict[str, Dict[str, Any]] = {}

        for chunk in self._batch_chunks(missing):
            sell_payload = self._clob_post(
                "/prices",
                [{"token_id": token_id, "side": "SELL"} for token_id in chunk],
            )
            buy_payload = self._clob_post(
                "/prices",
                [{"token_id": token_id, "side": "BUY"} for token_id in chunk],
            )
            midpoint_payload = self._clob_post(
                "/midpoints",
                [{"token_id": token_id} for token_id in chunk],
            )
            spread_payload = self._clob_post(
                "/spreads",
                [{"token_id": token_id} for token_id in chunk],
            )
            last_trade_payload = self._clob_post(
                "/last-trade-prices",
                [{"token_id": token_id} for token_id in chunk],
            )
            books_payload = (
                self._clob_post(
                    "/books",
                    [{"token_id": token_id} for token_id in chunk],
                )
                if include_books
                else None
            )
            ask_map.update(self._extract_batch_price_map(sell_payload, "SELL"))
            bid_map.update(self._extract_batch_price_map(buy_payload, "BUY"))
            midpoint_map.update(self._extract_batch_scalar_map(midpoint_payload))
            spread_map.update(self._extract_batch_scalar_map(spread_payload))
            last_trade_map.update(self._extract_batch_scalar_map(last_trade_payload))
            if include_books:
                book_map.update(self._extract_batch_book_map(books_payload))

        fetched: Dict[str, Dict[str, Any]] = {}
        unresolved: List[str] = []
        for token_id in missing:
            raw_book = book_map.get(token_id)
            book, book_liquidity = self._normalize_orderbook(raw_book)
            ask = _extract_price(ask_map.get(token_id))
            bid = _extract_price(bid_map.get(token_id))
            midpoint = _extract_price(midpoint_map.get(token_id))
            spread = _extract_price(spread_map.get(token_id))
            last_trade = _extract_price(last_trade_map.get(token_id))

            buy, sell = self._resolve_trade_prices(buy=ask, sell=bid, book=book)
            if midpoint is None and buy is not None and sell is not None:
                midpoint = (buy + sell) / 2.0
            if midpoint is None:
                midpoint = _extract_price(raw_book.get("last_trade_price") if isinstance(raw_book, dict) else None)
            if spread is None and buy is not None and sell is not None:
                spread = max(0.0, float(buy) - float(sell))
            if spread is not None and midpoint is not None:
                midpoint = _clamp_probability(midpoint)
            if buy is None and midpoint is not None and spread is not None:
                buy = _clamp_probability(midpoint + spread / 2.0)
            if sell is None and midpoint is not None and spread is not None:
                sell = _clamp_probability(midpoint - spread / 2.0)

            if (
                buy is None
                and sell is None
                and midpoint is None
                and last_trade is None
                and book is None
            ):
                unresolved.append(token_id)
                continue

            fetched[token_id] = {
                "buy": buy,
                "sell": sell,
                "midpoint": midpoint,
                "spread": spread,
                "last_trade_price": last_trade,
                "quote_source": "polymarket_clob_rest_batch",
                "quote_age_ms": 0,
                "book": book,
                "book_liquidity": book_liquidity,
            }

        for token_id in unresolved:
            fetched[token_id] = self._fetch_token_market_data(token_id)

        with self._lock:
            for token_id, data in fetched.items():
                self._price_cache[token_id] = {"data": data, "t": now}

        results.update(fetched)
        return results

    def _normalize_scan_filters(self, scan_filters: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        raw = scan_filters if isinstance(scan_filters, dict) else {}
        min_price = _clamp_float(_safe_float(raw.get("min_price")), 0.0, 1.0)
        max_price = _clamp_float(_safe_float(raw.get("max_price")), 0.0, 1.0)
        if min_price is None:
            min_price = 0.05
        if max_price is None:
            max_price = 0.95
        if min_price > max_price:
            min_price, max_price = max_price, min_price

        high_liquidity_only = bool(_safe_bool(raw.get("high_liquidity_only")))
        min_liquidity = _safe_float(raw.get("min_liquidity"))
        if min_liquidity is None:
            min_liquidity = 5000.0 if high_liquidity_only else float(self.min_liquidity_for_signal or 500.0)
        if high_liquidity_only:
            min_liquidity = max(min_liquidity, 5000.0)

        return {
            "scan_mode": str(raw.get("scan_mode") or "tradable").strip().lower() or "tradable",
            "min_price": float(min_price),
            "max_price": float(max_price),
            "min_edge_pct": max(0.0, _safe_float(raw.get("min_edge_pct")) or float(self.edge_threshold or 2.0)),
            "min_liquidity": max(0.0, float(min_liquidity)),
            "high_liquidity_only": high_liquidity_only,
            "market_type": str(raw.get("market_type") or "maxtemp").strip().lower() or "maxtemp",
            "time_range": str(raw.get("time_range") or "today").strip().lower() or "today",
            "limit": max(1, _safe_int(raw.get("limit"), 60)),
            "max_spread": max(0.0, _safe_float(raw.get("max_spread")) or 0.03),
        }

    def _build_window_meta(
        self,
        target_date: str,
        scan_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        context = scan_context if isinstance(scan_context, dict) else {}
        local_date = _extract_iso_date(context.get("local_date")) or _extract_iso_date(target_date)
        local_time = context.get("local_time")
        peak = context.get("peak") if isinstance(context.get("peak"), dict) else {}
        first_h = int(_safe_float(peak.get("first_h")) or 13)
        last_h = int(_safe_float(peak.get("last_h")) or 15)
        target_iso = _extract_iso_date(target_date)
        if not local_date or not target_iso:
            return {
                "phase": "today_default",
                "score": 0.65,
                "remaining_minutes": None,
                "same_day": True,
            }

        try:
            diff_days = (
                datetime.fromisoformat(target_iso).date()
                - datetime.fromisoformat(local_date).date()
            ).days
        except Exception:
            diff_days = 0

        if diff_days >= 2:
            return {
                "phase": "week_ahead",
                "score": 0.45,
                "remaining_minutes": None,
                "same_day": False,
            }
        if diff_days == 1:
            return {
                "phase": "tomorrow",
                "score": 0.60,
                "remaining_minutes": None,
                "same_day": False,
            }
        if diff_days < 0:
            return {
                "phase": "past",
                "score": 0.0,
                "remaining_minutes": None,
                "same_day": False,
            }

        now_minutes = _parse_hhmm_to_minutes(local_time)
        if now_minutes is None:
            return {
                "phase": "today_default",
                "score": 0.65,
                "remaining_minutes": None,
                "same_day": True,
            }

        first_minutes = max(0, first_h * 60)
        last_minutes = min(23 * 60 + 59, last_h * 60)
        if now_minutes > last_minutes + 120:
            return {
                "phase": "post_peak",
                "score": 0.50,
                "remaining_minutes": 0,
                "same_day": True,
            }
        if first_minutes <= now_minutes <= last_minutes + 120:
            return {
                "phase": "active_peak",
                "score": 1.00,
                "remaining_minutes": max(0, last_minutes + 120 - now_minutes),
                "same_day": True,
            }
        if first_minutes - 180 <= now_minutes < first_minutes:
            return {
                "phase": "setup_today",
                "score": 0.85,
                "remaining_minutes": max(0, last_minutes + 120 - now_minutes),
                "same_day": True,
            }
        return {
            "phase": "early_today",
            "score": 0.70,
            "remaining_minutes": max(0, first_minutes - now_minutes),
            "same_day": True,
        }

    def _resolve_market_target_threshold(
        self,
        market_direction: str,
        bucket_range: Optional[Tuple[float, Optional[float], str]],
        bucket_temp: Optional[float],
    ) -> Optional[float]:
        if not bucket_range:
            return bucket_temp
        lower, upper, _unit = bucket_range
        if market_direction in {"above", "below"}:
            return lower
        if upper is not None:
            return (lower + upper) / 2.0
        return lower

    def _resolve_temperature_direction(
        self,
        *,
        side: str,
        market_direction: str,
        target_threshold: Optional[float],
        current_reference: Optional[float],
    ) -> str:
        if market_direction == "above":
            return "hotter" if side == "yes" else "colder"
        if market_direction == "below":
            return "colder" if side == "yes" else "hotter"
        hotter_bias = True
        if target_threshold is not None and current_reference is not None:
            hotter_bias = target_threshold >= current_reference
        if side == "yes":
            return "hotter" if hotter_bias else "colder"
        return "colder" if hotter_bias else "hotter"

    def _is_trend_aligned(
        self,
        *,
        temperature_direction: str,
        trend_info: Optional[Dict[str, Any]],
        network_lead_signal: Optional[Dict[str, Any]],
    ) -> bool:
        trend = trend_info if isinstance(trend_info, dict) else {}
        network = network_lead_signal if isinstance(network_lead_signal, dict) else {}
        trend_direction = _normalize_text(trend.get("direction"))
        if temperature_direction == "hotter" and trend_direction == "rising":
            return True
        if temperature_direction == "colder" and trend_direction in {"falling", "stagnant"}:
            return True
        lead_delta = _safe_float(network.get("delta"))
        if lead_delta is None:
            return False
        if temperature_direction == "hotter":
            return lead_delta > 0
        return lead_delta < 0

    def _build_distribution_scan_pack(
        self,
        *,
        city_key: str,
        target_date: str,
        primary_market: Dict[str, Any],
        probability_distribution: Optional[List[Dict[str, Any]]] = None,
        temp_symbol: Optional[str] = None,
        scan_context: Optional[Dict[str, Any]] = None,
        scan_filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        filters = self._normalize_scan_filters(scan_filters)
        window_meta = self._build_window_meta(target_date, scan_context)
        related_markets = self._collect_related_temperature_markets(
            city_key=city_key,
            target_date=target_date,
            primary_market=primary_market,
        )
        if not related_markets:
            return {
                "rows": [],
                "distribution_bias": {
                    "available": False,
                    "value": None,
                    "direction": "balanced",
                    "score": 0.0,
                    "valid_markets": 0,
                },
                "primary_signal": None,
                "signal_status": "no_market",
                "candidate_count": 0,
                "window_phase": window_meta.get("phase"),
                "window_score": window_meta.get("score"),
                "resolved_market_type": "maxtemp",
            }

        market_entries: List[Dict[str, Any]] = []
        token_ids: List[str] = []
        for market in related_markets:
            tokens = self._extract_market_tokens(market)
            yes_token, no_token = self._resolve_yes_no_tokens(tokens)
            if not yes_token or not no_token:
                continue
            yes_token_id = str(yes_token.get("token_id") or "").strip()
            no_token_id = str(no_token.get("token_id") or "").strip()
            if not yes_token_id or not no_token_id:
                continue
            bucket_range = self._extract_market_bucket_range(market)
            bucket_temp = self._extract_market_bucket_temp(market)
            raw_direction = self._extract_market_bucket_direction(market)
            market_direction = "range" if bucket_range and bucket_range[1] is not None else raw_direction
            model_event_probability = self._aggregate_distribution_probability_for_market(
                market=market,
                probability_distribution=probability_distribution,
                temp_symbol=temp_symbol,
            )
            token_ids.extend([yes_token_id, no_token_id])
            market_entries.append(
                {
                    "market": market,
                    "yes_token": yes_token,
                    "no_token": no_token,
                    "yes_token_id": yes_token_id,
                    "no_token_id": no_token_id,
                    "bucket_range": bucket_range,
                    "bucket_temp": bucket_temp,
                    "market_direction": market_direction,
                    "target_threshold": self._resolve_market_target_threshold(
                        market_direction,
                        bucket_range,
                        bucket_temp,
                    ),
                    "target_label": self._extract_market_bucket_label(market, bucket_temp),
                    "model_event_probability": model_event_probability,
                    "market_liquidity": _extract_price(
                        market.get("liquidityNum")
                        or market.get("liquidity")
                        or market.get("liquidityClob")
                    ),
                    "volume": _extract_price(
                        market.get("volumeNum")
                        or market.get("volume")
                        or market.get("volume24hr")
                    ),
                    "trade_state": self._market_trade_state(market),
                    "enable_order_book": bool(
                        market.get("enableOrderBook", market.get("enable_order_book", False))
                    ),
                }
            )

        broad_quotes = self._batch_get_token_market_data(token_ids, include_books=False)
        bias_inputs: List[Tuple[float, float]] = []
        for entry in market_entries:
            yes_quote = broad_quotes.get(entry["yes_token_id"], {})
            no_quote = broad_quotes.get(entry["no_token_id"], {})
            market_event_probability = (
                _extract_price(yes_quote.get("midpoint"))
                or _extract_price(yes_quote.get("buy"))
                or _extract_price(yes_quote.get("sell"))
                or _extract_price(entry["yes_token"].get("implied_probability"))
            )
            if market_event_probability is not None:
                market_event_probability = _clamp_probability(market_event_probability)
            yes_ask = _extract_price(yes_quote.get("buy"))
            yes_bid = _extract_price(yes_quote.get("sell"))
            no_ask = _extract_price(no_quote.get("buy"))
            no_bid = _extract_price(no_quote.get("sell"))
            if no_ask is None and yes_ask is not None:
                no_ask = _clamp_probability(1.0 - yes_bid) if yes_bid is not None else None
            if no_bid is None and yes_bid is not None:
                no_bid = _clamp_probability(1.0 - yes_ask) if yes_ask is not None else None
            spread = _extract_price(yes_quote.get("spread"))
            if spread is None and yes_ask is not None and yes_bid is not None:
                spread = max(0.0, yes_ask - yes_bid)

            entry["market_event_probability"] = market_event_probability
            entry["yes_ask"] = yes_ask
            entry["yes_bid"] = yes_bid
            entry["no_ask"] = no_ask
            entry["no_bid"] = no_bid
            entry["midpoint"] = _extract_price(yes_quote.get("midpoint")) or market_event_probability
            entry["spread"] = spread
            entry["yes_book_liquidity"] = _extract_price(yes_quote.get("book_liquidity"))
            entry["no_book_liquidity"] = _extract_price(no_quote.get("book_liquidity"))
            entry["quote_source"] = yes_quote.get("quote_source") or no_quote.get("quote_source")
            entry["quote_age_ms"] = _safe_int(
                yes_quote.get("quote_age_ms") if yes_quote.get("quote_age_ms") is not None else no_quote.get("quote_age_ms"),
                0,
            )

            model_event_probability = _clamp_probability(_safe_float(entry.get("model_event_probability")))
            if (
                model_event_probability is not None
                and market_event_probability is not None
                and entry["market_direction"] in {"above", "below"}
            ):
                gap = model_event_probability - market_event_probability
                signed_gap = -gap if entry["market_direction"] == "below" else gap
                bias_inputs.append((max(model_event_probability, 0.08), signed_gap))

        distribution_bias_value = None
        distribution_bias_score = 0.0
        distribution_bias_direction = "balanced"
        if len(bias_inputs) >= 3:
            total_weight = sum(weight for weight, _signed_gap in bias_inputs)
            if total_weight > 0:
                distribution_bias_value = sum(weight * signed_gap for weight, signed_gap in bias_inputs) / total_weight
                distribution_bias_score = max(0.0, min(abs(distribution_bias_value) / 0.08, 1.0)) * 100.0
                if distribution_bias_value >= 0.015:
                    distribution_bias_direction = "hotter"
                elif distribution_bias_value <= -0.015:
                    distribution_bias_direction = "colder"

        distribution_bias = {
            "available": len(bias_inputs) >= 3 and distribution_bias_value is not None,
            "value": distribution_bias_value,
            "direction": distribution_bias_direction,
            "score": distribution_bias_score,
            "valid_markets": len(bias_inputs),
        }
        distribution_preview: List[Dict[str, Any]] = []
        for entry in market_entries:
            label = str(entry.get("target_label") or "").strip()
            if not label:
                continue
            preview_item = {
                "label": label,
                "value": _safe_float(entry.get("bucket_temp")),
                "unit": (
                    entry.get("bucket_range")[2]
                    if isinstance(entry.get("bucket_range"), tuple)
                    and len(entry.get("bucket_range")) >= 3
                    else ("F" if self._is_fahrenheit_symbol(temp_symbol) else "C")
                ),
                "model_probability": _clamp_probability(
                    _safe_float(entry.get("model_event_probability"))
                ),
                "market_probability": _clamp_probability(
                    _safe_float(entry.get("market_event_probability"))
                ),
                "highlighted": False,
            }
            distribution_preview.append(preview_item)

        distribution_preview.sort(
            key=lambda item: (
                _safe_float(item.get("value"))
                if _safe_float(item.get("value")) is not None
                else float("inf"),
                str(item.get("label") or ""),
            )
        )
        if distribution_preview:
            highlighted_index = max(
                range(len(distribution_preview)),
                key=lambda index: _safe_float(distribution_preview[index].get("model_probability")) or 0.0,
            )
            distribution_preview[highlighted_index]["highlighted"] = True

        current_reference_raw = _safe_float(
            (scan_context or {}).get("current_max_so_far")
            or (scan_context or {}).get("current_temp")
        )

        def _row_from_entry(entry: Dict[str, Any], side: str) -> Optional[Dict[str, Any]]:
            model_event_probability = _clamp_probability(_safe_float(entry.get("model_event_probability")))
            market_event_probability = _clamp_probability(_safe_float(entry.get("market_event_probability")))
            ask = _clamp_probability(_safe_float(entry.get("yes_ask") if side == "yes" else entry.get("no_ask")))
            bid = _clamp_probability(_safe_float(entry.get("yes_bid") if side == "yes" else entry.get("no_bid")))
            if model_event_probability is None or ask is None:
                return None

            model_probability = (
                model_event_probability
                if side == "yes"
                else _clamp_probability(1.0 - model_event_probability)
            )
            market_probability = (
                market_event_probability
                if side == "yes"
                else _clamp_probability(1.0 - market_event_probability)
            )
            if model_probability is None:
                return None

            market = entry["market"]
            target_threshold = _safe_float(entry.get("target_threshold"))
            bucket_range = entry.get("bucket_range")
            market_unit = bucket_range[2] if bucket_range else ("F" if self._is_fahrenheit_symbol(temp_symbol) else "C")
            current_reference = self._convert_temp_to_market_unit(
                current_reference_raw,
                source_symbol=temp_symbol,
                market_unit=market_unit,
            )
            gap_to_target = (
                target_threshold - current_reference
                if target_threshold is not None and current_reference is not None
                else None
            )
            temperature_direction = self._resolve_temperature_direction(
                side=side,
                market_direction=str(entry.get("market_direction") or "exact"),
                target_threshold=target_threshold,
                current_reference=current_reference,
            )
            trend_alignment = self._is_trend_aligned(
                temperature_direction=temperature_direction,
                trend_info=(scan_context or {}).get("trend"),
                network_lead_signal=(scan_context or {}).get("network_lead_signal"),
            )
            edge = model_probability - ask
            edge_percent = edge * 100.0
            liquidity_reference = max(
                _safe_float(
                    entry.get("yes_book_liquidity") if side == "yes" else entry.get("no_book_liquidity")
                ) or 0.0,
                _safe_float(entry.get("market_liquidity")) or 0.0,
            )
            if liquidity_reference >= 10000:
                liquidity_score = 1.0
            elif liquidity_reference >= 5000:
                liquidity_score = 0.8
            elif liquidity_reference >= 1000:
                liquidity_score = 0.6
            else:
                liquidity_score = 0.4
            if 0.10 <= ask <= 0.90:
                price_usefulness_score = 1.0
            elif 0.05 <= ask < 0.10 or 0.90 < ask <= 0.95:
                price_usefulness_score = 0.7
            else:
                price_usefulness_score = 0.0
            bias_score = 0.0
            if distribution_bias["available"]:
                if distribution_bias_direction == "balanced" or distribution_bias_direction == temperature_direction:
                    bias_score = distribution_bias_score / 100.0
            spread = _safe_float(entry.get("spread"))
            spread_penalty = max(
                0.0,
                min(((spread or 0.0) - 0.01) / 0.02, 1.0),
            ) * 15.0
            edge_score = max(0.0, min(edge_percent / 12.0, 1.0))
            final_score = 100.0 * (
                0.35 * edge_score
                + 0.25 * bias_score
                + 0.20 * float(window_meta.get("score") or 0.0)
                + 0.10 * liquidity_score
                + 0.10 * price_usefulness_score
            ) - spread_penalty
            market_slug = str(market.get("slug") or "").strip()
            target_label = str(entry.get("target_label") or "").strip()
            action = f"BUY {'YES' if side == 'yes' else 'NO'}"
            if target_label:
                action = f"{action} {target_label}"
            return {
                "id": f"{city_key}|{target_date}|{market_slug}|{side}",
                "city": city_key,
                "selected_date": target_date,
                "market_slug": market_slug or None,
                "market_question": market.get("question") or market.get("title"),
                "market_url": self._build_market_url(market),
                "side": side,
                "action": action,
                "market_direction": entry.get("market_direction"),
                "temperature_direction": temperature_direction,
                "target_label": entry.get("target_label"),
                "target_value": entry.get("bucket_temp"),
                "target_threshold": target_threshold,
                "target_lower": bucket_range[0] if bucket_range else None,
                "target_upper": bucket_range[1] if bucket_range else None,
                "target_unit": market_unit,
                "model_probability": model_probability,
                "market_probability": market_probability,
                "model_event_probability": model_event_probability,
                "market_event_probability": market_event_probability,
                "gap": (
                    model_event_probability - market_event_probability
                    if model_event_probability is not None and market_event_probability is not None
                    else None
                ),
                "signed_gap": (
                    -1.0 * (model_event_probability - market_event_probability)
                    if model_event_probability is not None
                    and market_event_probability is not None
                    and entry.get("market_direction") == "below"
                    else (
                        model_event_probability - market_event_probability
                        if model_event_probability is not None and market_event_probability is not None
                        else None
                    )
                ),
                "yes_token_id": entry.get("yes_token_id"),
                "no_token_id": entry.get("no_token_id"),
                "yes_ask": entry.get("yes_ask"),
                "yes_bid": entry.get("yes_bid"),
                "no_ask": entry.get("no_ask"),
                "no_bid": entry.get("no_bid"),
                "ask": ask,
                "bid": bid,
                "midpoint": entry.get("midpoint"),
                "spread": spread,
                "book_liquidity": _safe_float(
                    entry.get("yes_book_liquidity") if side == "yes" else entry.get("no_book_liquidity")
                ),
                "market_liquidity": entry.get("market_liquidity"),
                "volume": entry.get("volume"),
                "quote_source": entry.get("quote_source"),
                "quote_age_ms": entry.get("quote_age_ms"),
                "edge": edge,
                "edge_percent": edge_percent,
                "edge_score": edge_score,
                "bias_score": bias_score,
                "window_phase": window_meta.get("phase"),
                "window_score": window_meta.get("score"),
                "remaining_window_minutes": window_meta.get("remaining_minutes"),
                "liquidity_score": liquidity_score,
                "price_usefulness_score": price_usefulness_score,
                "spread_penalty": spread_penalty,
                "final_score": final_score,
                "distribution_bias_direction": distribution_bias_direction,
                "distribution_bias_score": distribution_bias_score,
                "distribution_bias_available": distribution_bias["available"],
                "distribution_preview": distribution_preview[:6],
                "current_reference": current_reference,
                "gap_to_target": gap_to_target,
                "touch_distance": abs(gap_to_target) if gap_to_target is not None else None,
                "trend_alignment": trend_alignment,
                "tradable": bool(entry["trade_state"].get("tradable")),
                "active": entry["trade_state"].get("active"),
                "closed": entry["trade_state"].get("closed"),
                "accepting_orders": entry["trade_state"].get("accepting_orders"),
                "enable_order_book": entry.get("enable_order_book"),
                "is_primary_market": bool(
                    str(primary_market.get("slug") or "").strip().lower()
                    and market_slug
                    and str(primary_market.get("slug") or "").strip().lower() == market_slug.lower()
                ),
            }

        preliminary_rows: List[Dict[str, Any]] = []
        for entry in market_entries:
            row_yes = _row_from_entry(entry, "yes")
            row_no = _row_from_entry(entry, "no")
            if row_yes:
                preliminary_rows.append(row_yes)
            if row_no:
                preliminary_rows.append(row_no)

        preliminary_rows.sort(key=lambda row: float(row.get("final_score") or 0.0), reverse=True)
        shortlist_market_slugs = []
        seen_slugs = set()
        for row in preliminary_rows:
            market_slug = str(row.get("market_slug") or "").strip()
            if not market_slug or market_slug in seen_slugs:
                continue
            seen_slugs.add(market_slug)
            shortlist_market_slugs.append(market_slug)
            if len(shortlist_market_slugs) >= 10:
                break

        shortlisted_tokens: List[str] = []
        for entry in market_entries:
            market_slug = str(entry["market"].get("slug") or "").strip()
            if market_slug not in seen_slugs:
                continue
            shortlisted_tokens.extend([entry["yes_token_id"], entry["no_token_id"]])

        precise_quotes = self._batch_get_token_market_data(shortlisted_tokens, include_books=True)
        for entry in market_entries:
            market_slug = str(entry["market"].get("slug") or "").strip()
            if market_slug not in seen_slugs:
                continue
            yes_quote = precise_quotes.get(entry["yes_token_id"], {})
            no_quote = precise_quotes.get(entry["no_token_id"], {})
            if yes_quote:
                entry["yes_ask"] = _extract_price(yes_quote.get("buy")) or entry.get("yes_ask")
                entry["yes_bid"] = _extract_price(yes_quote.get("sell")) or entry.get("yes_bid")
                entry["midpoint"] = _extract_price(yes_quote.get("midpoint")) or entry.get("midpoint")
                entry["spread"] = _extract_price(yes_quote.get("spread")) or entry.get("spread")
                entry["yes_book_liquidity"] = _extract_price(yes_quote.get("book_liquidity")) or entry.get("yes_book_liquidity")
                entry["quote_source"] = yes_quote.get("quote_source") or entry.get("quote_source")
            if no_quote:
                entry["no_ask"] = _extract_price(no_quote.get("buy")) or entry.get("no_ask")
                entry["no_bid"] = _extract_price(no_quote.get("sell")) or entry.get("no_bid")
                entry["no_book_liquidity"] = _extract_price(no_quote.get("book_liquidity")) or entry.get("no_book_liquidity")
                entry["quote_source"] = no_quote.get("quote_source") or entry.get("quote_source")
            if entry.get("spread") is None and entry.get("yes_ask") is not None and entry.get("yes_bid") is not None:
                entry["spread"] = max(0.0, float(entry["yes_ask"]) - float(entry["yes_bid"]))

        final_rows: List[Dict[str, Any]] = []
        for entry in market_entries:
            for side in ("yes", "no"):
                row = _row_from_entry(entry, side)
                if row:
                    final_rows.append(row)

        def _passes_hard_filters(row: Dict[str, Any]) -> bool:
            ask = _safe_float(row.get("ask"))
            edge_percent = _safe_float(row.get("edge_percent"))
            spread = _safe_float(row.get("spread"))
            liquidity = max(
                _safe_float(row.get("book_liquidity")) or 0.0,
                _safe_float(row.get("market_liquidity")) or 0.0,
            )
            if ask is None or edge_percent is None:
                return False
            if not row.get("tradable") or row.get("accepting_orders") is False:
                return False
            if row.get("enable_order_book") is False:
                return False
            if ask < filters["min_price"] or ask > filters["max_price"]:
                return False
            if edge_percent < filters["min_edge_pct"]:
                return False
            if spread is None or spread > filters["max_spread"]:
                return False
            if liquidity < filters["min_liquidity"]:
                return False
            return True

        def _passes_mode_filters(row: Dict[str, Any]) -> bool:
            scan_mode = filters["scan_mode"]
            if scan_mode == "tradable":
                return float(row.get("window_score") or 0.0) >= 0.65
            if scan_mode == "early":
                return str(row.get("window_phase") or "") in {"tomorrow", "week_ahead", "early_today"}
            if scan_mode == "touch":
                return (
                    bool(window_meta.get("same_day"))
                    and str(row.get("window_phase") or "") in {"setup_today", "active_peak"}
                    and (_safe_float(row.get("touch_distance")) is not None)
                    and float(row.get("touch_distance")) <= 2.0
                )
            if scan_mode == "trend":
                return bool(row.get("trend_alignment"))
            return True

        filtered_rows = [
            row
            for row in final_rows
            if _passes_hard_filters(row) and _passes_mode_filters(row)
        ]
        filtered_rows.sort(
            key=lambda row: (
                float(row.get("final_score") or 0.0),
                float(row.get("edge_percent") or 0.0),
            ),
            reverse=True,
        )

        primary_signal = filtered_rows[0] if filtered_rows else None
        signal_status = "ready" if primary_signal else "no_signal"
        return {
            "rows": filtered_rows[: filters["limit"]],
            "distribution_bias": distribution_bias,
            "primary_signal": primary_signal,
            "signal_status": signal_status,
            "candidate_count": len(filtered_rows),
            "window_phase": window_meta.get("phase"),
            "window_score": window_meta.get("score"),
            "distribution_preview": distribution_preview[:6],
            "resolved_market_type": "maxtemp",
        }
