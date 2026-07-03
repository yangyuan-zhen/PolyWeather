from __future__ import annotations

import json
import math
import re
import threading
import time
import unicodedata
from datetime import datetime
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

import requests
from fastapi import Request

from web.scan_terminal_service import build_scan_terminal_payload

GAMMA_API_BASE = "https://gamma-api.polymarket.com"
CLOB_API_BASE = "https://clob.polymarket.com"
_QUOTE_CACHE_TTL_SEC = 60
_EVENT_CACHE_TTL_SEC = 180

_CACHE_LOCK = threading.Lock()
_EVENT_CACHE: Dict[str, Tuple[float, Optional[Dict[str, Any]]]] = {}
_PRICE_CACHE: Dict[str, Tuple[float, Optional[float]]] = {}


def _require_ops(request: Request) -> Dict[str, Any] | None:
    from web.services.ops_api import _require_ops as _real

    return _real(request)


def _finite_number(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def _json_list(value: Any) -> List[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        return parsed if isinstance(parsed, list) else []
    return []


def _normalize_key(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    ascii_text = ascii_text.lower().replace("&", " and ")
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", ascii_text)).strip("-")


def _city_slug(row: Mapping[str, Any]) -> str:
    city = _normalize_key(row.get("city_display_name") or row.get("display_name") or row.get("city"))
    if city in {"new york", "new york city"}:
        return "nyc"
    return _slugify(city)


def _date_slug(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text[:10])
    except ValueError:
        return None
    return f"{parsed.strftime('%B').lower()}-{parsed.day}-{parsed.year}"


def _event_slug_for_row(row: Mapping[str, Any]) -> Optional[str]:
    date_key = row.get("selected_date") or row.get("local_date")
    date_slug = _date_slug(date_key)
    city_slug = _city_slug(row)
    if not date_slug or not city_slug:
        return None
    return f"highest-temperature-in-{city_slug}-on-{date_slug}"


def _market_url(slug: str) -> str:
    return f"https://polymarket.com/event/{slug}"


def _round_probability(value: float) -> float:
    return round(value + 0.0000000001, 4)


def _round_price(value: float) -> float:
    return round(value + 0.0000000001, 4)


def _probability_from_bucket(bucket: Mapping[str, Any]) -> Optional[float]:
    raw = _finite_number(bucket.get("probability") or bucket.get("model_probability"))
    if raw is None:
        return None
    return raw / 100.0 if raw > 1 else raw


def _distribution_points(row: Mapping[str, Any]) -> List[Tuple[int, float]]:
    raw = row.get("distribution_full") or row.get("distribution_preview") or []
    if not isinstance(raw, list):
        return []
    points: List[Tuple[int, float]] = []
    for bucket in raw:
        if not isinstance(bucket, Mapping):
            continue
        value = _finite_number(bucket.get("value") or bucket.get("temp") or bucket.get("temperature"))
        probability = _probability_from_bucket(bucket)
        if value is None or probability is None or probability <= 0:
            continue
        points.append((int(round(value)), float(probability)))
    return points


def parse_market_option_from_question(question: str, unit: str) -> Dict[str, Any]:
    text = str(question or "").strip()
    unit_text = "°F" if "f" in str(unit or "").lower() else "°C"

    between = re.search(
        r"between\s+(-?\d+)\s*-\s*(-?\d+)\s*°?\s*([CF])",
        text,
        flags=re.IGNORECASE,
    )
    if between:
        lower = int(between.group(1))
        upper = int(between.group(2))
        parsed_unit = f"°{between.group(3).upper()}"
        return {
            "label": f"{lower}-{upper}{parsed_unit}",
            "lower": min(lower, upper),
            "upper": max(lower, upper),
            "unit": parsed_unit,
        }

    below = re.search(r"(-?\d+)\s*°?\s*([CF])\s+or\s+below", text, flags=re.IGNORECASE)
    if below:
        upper = int(below.group(1))
        parsed_unit = f"°{below.group(2).upper()}"
        return {
            "label": f"{upper}{parsed_unit} or below",
            "lower": None,
            "upper": upper,
            "unit": parsed_unit,
        }

    higher = re.search(r"(-?\d+)\s*°?\s*([CF])\s+or\s+higher", text, flags=re.IGNORECASE)
    if higher:
        lower = int(higher.group(1))
        parsed_unit = f"°{higher.group(2).upper()}"
        return {
            "label": f"{lower}{parsed_unit} or higher",
            "lower": lower,
            "upper": None,
            "unit": parsed_unit,
        }

    exact = re.search(r"\bbe\s+(-?\d+)\s*°?\s*([CF])\b", text, flags=re.IGNORECASE)
    if exact:
        value = int(exact.group(1))
        parsed_unit = f"°{exact.group(2).upper()}"
        return {
            "label": f"{value}{parsed_unit}",
            "lower": value,
            "upper": value,
            "unit": parsed_unit,
        }

    value_match = re.search(r"(-?\d+)\s*°?\s*([CF])", text, flags=re.IGNORECASE)
    if value_match:
        value = int(value_match.group(1))
        parsed_unit = f"°{value_match.group(2).upper()}"
        return {
            "label": f"{value}{parsed_unit}",
            "lower": value,
            "upper": value,
            "unit": parsed_unit,
        }

    return {"label": text or "—", "lower": None, "upper": None, "unit": unit_text}


def _bucket_probability(row: Mapping[str, Any], option: Mapping[str, Any]) -> Optional[float]:
    points = _distribution_points(row)
    if not points:
        return None
    lower = option.get("lower")
    upper = option.get("upper")
    lower_number = int(lower) if lower is not None else None
    upper_number = int(upper) if upper is not None else None
    probability = 0.0
    for settled_value, point_probability in points:
        if lower_number is not None and settled_value < lower_number:
            continue
        if upper_number is not None and settled_value > upper_number:
            continue
        probability += point_probability
    return _round_probability(probability)


def _model_stats(row: Mapping[str, Any]) -> Tuple[Optional[float], Optional[float]]:
    sources = row.get("model_cluster_sources") or {}
    if not isinstance(sources, Mapping):
        return None, None
    values = sorted(
        number
        for number in (_finite_number(value) for value in sources.values())
        if number is not None
    )
    if not values:
        return None, None
    mid = len(values) // 2
    median = values[mid] if len(values) % 2 else (values[mid - 1] + values[mid]) / 2
    return round(median, 1), round(max(values) - min(values), 1)


def _market_tokens(market: Mapping[str, Any]) -> Dict[str, Optional[str]]:
    outcomes = [str(item).strip().lower() for item in _json_list(market.get("outcomes"))]
    token_ids = [str(item).strip() for item in _json_list(market.get("clobTokenIds"))]
    result = {"yes": None, "no": None}
    for index, outcome in enumerate(outcomes):
        if index >= len(token_ids) or not token_ids[index]:
            continue
        if outcome in result:
            result[outcome] = token_ids[index]
    return result


def _market_hint_prices(market: Mapping[str, Any]) -> Dict[str, Optional[float]]:
    outcomes = [str(item).strip().lower() for item in _json_list(market.get("outcomes"))]
    prices = _json_list(market.get("outcomePrices"))
    result: Dict[str, Optional[float]] = {"yes": None, "no": None}
    for index, outcome in enumerate(outcomes):
        if index >= len(prices) or outcome not in result:
            continue
        result[outcome] = _finite_number(prices[index])
    return result


def _iter_market_sides(side: str) -> Iterable[str]:
    normalized = str(side or "both").strip().lower()
    if normalized in {"yes", "no"}:
        yield normalized
        return
    yield "yes"
    yield "no"


def build_market_opportunity_rows(
    scan_rows: List[Dict[str, Any]],
    events_by_city: Mapping[str, Optional[Dict[str, Any]]],
    ask_prices_by_token: Mapping[str, Optional[float]],
    *,
    max_price: float = 0.20,
    side: str = "both",
    positive_edge_only: bool = True,
    min_edge: float = 0.0,
    limit: int = 200,
    query: str = "",
    region: str = "",
) -> List[Dict[str, Any]]:
    opportunities: List[Dict[str, Any]] = []
    query_text = _normalize_key(query)
    region_text = _normalize_key(region)

    for scan_row in scan_rows:
        city_key = _normalize_key(scan_row.get("city"))
        display_name = str(scan_row.get("city_display_name") or scan_row.get("display_name") or scan_row.get("city") or "—")
        if query_text and query_text not in _normalize_key(display_name) and query_text not in city_key:
            continue
        row_region = str(scan_row.get("trading_region_label_zh") or scan_row.get("trading_region_label") or "")
        if region_text and region_text not in {"all", ""} and region_text not in _normalize_key(row_region):
            continue

        event = events_by_city.get(city_key)
        if not isinstance(event, Mapping):
            continue
        market_url = _market_url(str(event.get("slug") or ""))
        model_median, model_spread = _model_stats(scan_row)
        for market in event.get("markets") or []:
            if not isinstance(market, Mapping):
                continue
            if market.get("active") is False or market.get("closed") is True:
                continue
            if market.get("enableOrderBook") is False:
                continue
            option = parse_market_option_from_question(
                str(market.get("question") or ""),
                str(scan_row.get("temp_symbol") or "°C"),
            )
            model_probability = _bucket_probability(scan_row, option)
            if model_probability is None:
                continue
            tokens = _market_tokens(market)
            for option_side in _iter_market_sides(side):
                token_id = tokens.get(option_side)
                if not token_id:
                    continue
                ask = ask_prices_by_token.get(token_id)
                ask_number = _finite_number(ask)
                if ask_number is None or ask_number <= 0 or ask_number >= float(max_price):
                    continue
                target_probability = (
                    model_probability
                    if option_side == "yes"
                    else _round_probability(1.0 - model_probability)
                )
                edge = _round_probability(target_probability - ask_number)
                if positive_edge_only and edge <= float(min_edge):
                    continue
                if not positive_edge_only and edge < float(min_edge):
                    continue
                market_slug = str(market.get("slug") or "")
                opportunities.append(
                    {
                        "id": f"{city_key}:{market_slug}:{option_side}",
                        "city": city_key,
                        "display_name": display_name,
                        "target_date": scan_row.get("selected_date") or scan_row.get("local_date"),
                        "bucket_label": option["label"],
                        "side": option_side,
                        "ask_price": _round_price(ask_number),
                        "model_probability": model_probability,
                        "edge": edge,
                        "liquidity": _finite_number(market.get("liquidity")),
                        "volume": _finite_number(market.get("volume")),
                        "market_url": market_url,
                        "market_slug": market_slug,
                        "question": market.get("question"),
                        "current_max_so_far": _finite_number(scan_row.get("current_max_so_far")),
                        "deb_prediction": _finite_number(scan_row.get("deb_prediction")),
                        "model_median": model_median,
                        "model_spread": model_spread,
                        "local_time": scan_row.get("local_time"),
                        "region": row_region,
                    }
                )

    opportunities.sort(
        key=lambda row: (
            float(row.get("edge") or 0),
            -float(row.get("ask_price") or 0),
            float(row.get("liquidity") or 0),
        ),
        reverse=True,
    )
    safe_limit = max(1, min(int(limit or 200), 500))
    return opportunities[:safe_limit]


class PolymarketQuoteScanner:
    def __init__(self, session: Optional[requests.Session] = None) -> None:
        self.session = session or requests.Session()

    def fetch_event(self, slug: str) -> Optional[Dict[str, Any]]:
        now = time.time()
        with _CACHE_LOCK:
            cached = _EVENT_CACHE.get(slug)
            if cached and now - cached[0] < _EVENT_CACHE_TTL_SEC:
                return cached[1]
        response = self.session.get(
            f"{GAMMA_API_BASE}/events",
            params={"slug": slug},
            timeout=12,
        )
        response.raise_for_status()
        payload = response.json()
        event = payload[0] if isinstance(payload, list) and payload else None
        with _CACHE_LOCK:
            _EVENT_CACHE[slug] = (now, event if isinstance(event, dict) else None)
        return event if isinstance(event, dict) else None

    def fetch_ask_price(self, token_id: str) -> Optional[float]:
        now = time.time()
        with _CACHE_LOCK:
            cached = _PRICE_CACHE.get(token_id)
            if cached and now - cached[0] < _QUOTE_CACHE_TTL_SEC:
                return cached[1]
        response = self.session.get(
            f"{CLOB_API_BASE}/price",
            params={"token_id": token_id, "side": "SELL"},
            timeout=8,
        )
        response.raise_for_status()
        price = _finite_number((response.json() or {}).get("price"))
        with _CACHE_LOCK:
            _PRICE_CACHE[token_id] = (now, price)
        return price


def _collect_events_and_prices(
    rows: List[Dict[str, Any]],
    scanner: PolymarketQuoteScanner,
) -> Tuple[Dict[str, Optional[Dict[str, Any]]], Dict[str, Optional[float]], str]:
    events_by_city: Dict[str, Optional[Dict[str, Any]]] = {}
    prices: Dict[str, Optional[float]] = {}
    status = "ready"
    for row in rows:
        city_key = _normalize_key(row.get("city"))
        if not city_key or city_key in events_by_city:
            continue
        slug = _event_slug_for_row(row)
        if not slug:
            events_by_city[city_key] = None
            continue
        try:
            event = scanner.fetch_event(slug)
        except Exception:
            status = "partial"
            event = None
        events_by_city[city_key] = event
        if not isinstance(event, Mapping):
            continue
        for market in event.get("markets") or []:
            if not isinstance(market, Mapping):
                continue
            hint_prices = _market_hint_prices(market)
            for market_side, token_id in _market_tokens(market).items():
                if not token_id or token_id in prices:
                    continue
                hint_price = hint_prices.get(market_side)
                if hint_price is not None and hint_price > 0.30:
                    prices[token_id] = hint_price
                    continue
                try:
                    prices[token_id] = scanner.fetch_ask_price(token_id)
                except Exception:
                    status = "partial"
                    prices[token_id] = hint_price
    return events_by_city, prices, status


def get_ops_market_opportunities(
    request: Request,
    *,
    max_price: float = 0.20,
    side: str = "both",
    positive_edge_only: bool = True,
    min_edge: float = 0.0,
    limit: int = 200,
    query: str = "",
    region: str = "",
) -> Dict[str, Any]:
    _require_ops(request)
    filters = {
        "scan_mode": "tradable",
        "min_price": 0.05,
        "max_price": 0.95,
        "min_edge_pct": 0,
        "min_liquidity": 0,
        "market_type": "maxtemp",
        "time_range": "today",
        "limit": 180,
    }
    scan_payload = build_scan_terminal_payload(filters, force_refresh=False)
    scan_rows = scan_payload.get("rows") if isinstance(scan_payload, dict) else []
    if not isinstance(scan_rows, list):
        scan_rows = []

    quote_status = "ready"
    try:
        events_by_city, ask_prices, quote_status = _collect_events_and_prices(
            scan_rows,
            PolymarketQuoteScanner(),
        )
    except Exception as exc:
        events_by_city = {}
        ask_prices = {}
        quote_status = "unavailable"
        error = str(exc)
    else:
        error = None

    rows = build_market_opportunity_rows(
        scan_rows,
        events_by_city,
        ask_prices,
        max_price=float(max_price),
        side=side,
        positive_edge_only=positive_edge_only,
        min_edge=float(min_edge),
        limit=limit,
        query=query,
        region=region,
    )
    prices = [float(row["ask_price"]) for row in rows if _finite_number(row.get("ask_price")) is not None]
    edges = [float(row["edge"]) for row in rows if _finite_number(row.get("edge")) is not None]
    return {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "filters": {
            "max_price": float(max_price),
            "side": side,
            "positive_edge_only": bool(positive_edge_only),
            "min_edge": float(min_edge),
            "limit": int(limit),
            "query": query,
            "region": region,
        },
        "summary": {
            "opportunity_count": len(rows),
            "positive_edge_count": sum(1 for row in rows if float(row.get("edge") or 0) > 0),
            "min_price": min(prices) if prices else None,
            "max_edge": max(edges) if edges else None,
            "quote_status": quote_status,
            "scanned_city_count": len(scan_rows),
            "matched_event_count": sum(1 for event in events_by_city.values() if isinstance(event, Mapping)),
            "error": error,
        },
        "rows": rows,
    }


__all__ = [
    "PolymarketQuoteScanner",
    "build_market_opportunity_rows",
    "get_ops_market_opportunities",
    "parse_market_option_from_question",
]
