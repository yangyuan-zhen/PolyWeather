"""Arbitrage overview service.

Builds the DEB probability distribution vs Polymarket Yes/No price view used
by the ``套利对比`` (arbitrage comparison) terminal tab, plus the dynamic
city enumeration backed by the Polymarket public-search endpoint. Reuses the
Polymarket scanner and DEB normal-distribution helpers from existing modules;
no new dependencies are added.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Optional, Set, Tuple

import requests
from fastapi import HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from web.services.ops.market_opportunities import (
    GAMMA_API_BASE,
    CLOB_API_BASE,
    PolymarketQuoteScanner,
    _date_slug,
    _market_hint_prices,
    _market_tokens,
    _market_url,
    _normalize_key,
    parse_market_option_from_question,
)

logger = logging.getLogger(__name__)

# Default per-bucket ask price time budget. Market-opportunities uses 18s for
# the full ops scan; the arbitrage view is single-city, so 8s is enough to
# cover the ~N buckets without saturating the request thread.
_ARBITRAGE_QUOTE_BUDGET_SEC = 8.0

# Process-wide cache for the arbitrage city enumeration (one entry).
_ARBITRAGE_CITIES_CACHE_TTL_SEC = 3600
_ARBITRAGE_CITIES_CACHE_KEY = "arbitrage_cities"
_ARBITRAGE_CITIES_LOCK = threading.Lock()
_ARBITRAGE_CITIES_CACHE: Dict[str, Tuple[float, Optional[Dict[str, Any]]]] = {}

# Shared Redis cache for the same payload (cross-worker / cross-restart),
# mirroring the scan-terminal cache pattern. Redis is opt-in via env and
# degrades to the in-memory cache above when unavailable.
_ARBITRAGE_REDIS_CLIENT_LOCK = threading.Lock()
_ARBITRAGE_REDIS_CLIENT: Any = None
_ARBITRAGE_REDIS_UNAVAILABLE = False


def _truthy_env(name: str, *, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return str(value).strip().lower() not in ("", "0", "false", "no", "off")


def _arbitrage_redis_enabled() -> bool:
    return _truthy_env(
        "POLYWEATHER_ARBITRAGE_REDIS_CACHE_ENABLED",
        default=bool(os.getenv("POLYWEATHER_REDIS_URL")),
    )


def _arbitrage_redis_ttl_sec() -> int:
    try:
        value = int(
            os.getenv(
                "POLYWEATHER_ARBITRAGE_REDIS_CACHE_TTL_SEC",
                str(_ARBITRAGE_CITIES_CACHE_TTL_SEC),
            )
        )
    except Exception:
        value = _ARBITRAGE_CITIES_CACHE_TTL_SEC
    return max(600, min(value, 86400))


def _arbitrage_redis_entry_key() -> str:
    return f"polyweather:arbitrage:v1:{_ARBITRAGE_CITIES_CACHE_KEY}"


def _get_arbitrage_redis_client() -> Any:
    global _ARBITRAGE_REDIS_CLIENT, _ARBITRAGE_REDIS_UNAVAILABLE

    if not _arbitrage_redis_enabled() or _ARBITRAGE_REDIS_UNAVAILABLE:
        return None

    with _ARBITRAGE_REDIS_CLIENT_LOCK:
        if _ARBITRAGE_REDIS_CLIENT is not None:
            return _ARBITRAGE_REDIS_CLIENT
        try:
            import redis  # type: ignore

            url = os.getenv("POLYWEATHER_REDIS_URL") or "redis://127.0.0.1:6379/0"
            client = redis.Redis.from_url(
                url,
                socket_timeout=float(
                    os.getenv("POLYWEATHER_REDIS_SOCKET_TIMEOUT_SECONDS", "2")
                ),
                socket_connect_timeout=float(
                    os.getenv("POLYWEATHER_REDIS_SOCKET_CONNECT_TIMEOUT_SECONDS", "1")
                ),
                health_check_interval=30,
            )
            client.ping()
            _ARBITRAGE_REDIS_CLIENT = client
            return client
        except Exception:
            _ARBITRAGE_REDIS_UNAVAILABLE = True
            return None


def _read_arbitrage_redis_cache() -> Optional[Dict[str, Any]]:
    client = _get_arbitrage_redis_client()
    if client is None:
        return None
    try:
        raw = client.get(_arbitrage_redis_entry_key())
        if not raw:
            return None
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        entry = json.loads(str(raw))
        return dict(entry) if isinstance(entry, dict) else None
    except Exception:
        return None


def _write_arbitrage_redis_cache(payload: Dict[str, Any]) -> None:
    client = _get_arbitrage_redis_client()
    if client is None:
        return
    try:
        client.setex(
            _arbitrage_redis_entry_key(),
            _arbitrage_redis_ttl_sec(),
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        )
    except Exception:
        return

# Static city list returned when public-search discovery fails or yields no
# monitored city. Keys must exist in CITY_REGISTRY.
_ARBITRAGE_CITY_FALLBACK_KEYS: Tuple[str, ...] = (
    "shanghai",
    "tokyo",
    "seoul",
    "london",
    "paris",
    "new york",
    "miami",
    "chicago",
)

# Title display names that neither exact nor containment matching resolves
# (e.g. Polymarket uses "NYC" where CITY_REGISTRY uses "New York").
_SEARCH_CITY_ALIASES: Dict[str, str] = {
    "nyc": "new york",
    "new york city": "new york",
}

# Event titles look like "Highest temperature in Shanghai on July 31?".
_EVENT_TITLE_CITY_RE = re.compile(r"Highest temperature in (.+?) on ", re.IGNORECASE)


def _sf(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if _isfinite(number) else None


def _isfinite(value: float) -> bool:
    return value == value and value not in (float("inf"), float("-inf"))


def _resolve_city_key(request: Request, city_input: str) -> Tuple[str, str]:
    """Resolve user-supplied display name to ``(city_key, display_name)``.

    Uses the legacy ``_normalize_city_or_404`` so display names, alias keys
    (NYC, NY, CHI, ...) and the canonical lowercase key are all accepted.
    """
    import web.routes as legacy_routes

    city_key = legacy_routes._normalize_city_or_404(city_input)
    display_name = str(
        (legacy_routes.CITY_REGISTRY.get(city_key) or {}).get("name")
        or city_input.strip()
    )
    return city_key, display_name


def _analyze_city(city_key: str, force_refresh: bool) -> Dict[str, Any]:
    """Run the canonical city analysis (same path the detail page uses)."""
    from web.analysis_service import _analyze

    return _analyze(city_key, force_refresh=force_refresh)


def _load_city_deb_payload(
    request: Request, city_key: str, force_refresh: bool
) -> Tuple[List[Dict[str, Any]], Optional[float], str]:
    """Return ``(probabilities_all, deb_prediction, engine_label)`` for city.

    Returns a tuple with the full integer-degree DEB distribution (or empty),
    the underlying DEB prediction value, and a human-readable engine label
    (``deb_normal`` / ``weathernext2`` / ``legacy`` / ``unavailable``).
    """
    data = _analyze_city(city_key, force_refresh)
    probabilities = data.get("probabilities") if isinstance(data, dict) else {}
    if not isinstance(probabilities, dict):
        probabilities = {}

    distribution_all = probabilities.get("distribution_all") or probabilities.get(
        "distribution"
    )
    if not isinstance(distribution_all, list):
        distribution_all = []

    deb_payload = data.get("deb") if isinstance(data, dict) else None
    deb_prediction: Optional[float] = None
    if isinstance(deb_payload, dict):
        deb_prediction = _sf(deb_payload.get("prediction"))

    engine_label = str(probabilities.get("engine") or "")
    if engine_label == "deb_normal":
        engine = "deb_normal"
    elif engine_label == "weathernext2":
        engine = "weathernext2"
    elif engine_label:
        engine = "legacy"
    elif deb_prediction is not None:
        engine = "legacy"
    else:
        engine = "unavailable"
    return distribution_all, deb_prediction, engine


def _build_event_slug(display_name: str, local_date: str) -> Optional[str]:
    """Compose the Polymarket event slug without re-implementing rules."""
    date_part = _date_slug(local_date)
    if not date_part:
        return None
    row = {"city_display_name": display_name, "selected_date": local_date}
    from web.services.ops.market_opportunities import _city_slug, _event_slug_for_row

    if not _city_slug(row):
        return None
    return _event_slug_for_row(row)


def _price_to_cents(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    if not _isfinite(value):
        return None
    return round(value * 100.0, 2)


def _align_buckets(
    market_buckets: List[Dict[str, Any]],
    deb_distribution: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Align DEB probability onto each Polymarket market bucket.

    - Middle bucket (e.g. ``33°C``) maps to DEB ``value == 33``.
    - Or-below tail maps to Σ DEB ``value <= upper_bound``.
    - Or-higher tail maps to Σ DEB ``value >= lower_bound``.
    - DEB distribution may be empty; missing coverage is reported as 0.
    """
    deb_points: List[Tuple[int, float]] = []
    for bucket in deb_distribution or []:
        if not isinstance(bucket, Mapping):
            continue
        value = _sf(
            bucket.get("value") or bucket.get("temp") or bucket.get("temperature")
        )
        probability = _sf(bucket.get("probability") or bucket.get("model_probability"))
        if value is None or probability is None or probability <= 0:
            continue
        deb_points.append((int(round(value)), float(probability)))

    aligned: List[Dict[str, Any]] = []
    for bucket in market_buckets:
        lower = bucket.get("lower")
        upper = bucket.get("upper")
        is_tail = bucket.get("isTail") or None
        value: Optional[int]
        if is_tail == "below" and upper is not None:
            value = int(upper)
        elif is_tail == "higher" and lower is not None:
            value = int(lower)
        elif lower is not None and upper is not None and lower == upper:
            value = int(lower)
        else:
            value = None

        deb_probability = 0.0
        if is_tail == "below" and upper is not None:
            upper_int = int(upper)
            deb_probability = round(
                sum(prob for tau, prob in deb_points if tau <= upper_int), 4
            )
        elif is_tail == "higher" and lower is not None:
            lower_int = int(lower)
            deb_probability = round(
                sum(prob for tau, prob in deb_points if tau >= lower_int), 4
            )
        elif value is not None:
            tau = int(value)
            deb_probability = round(sum(prob for t, prob in deb_points if t == tau), 4)
        else:
            # Range buckets (e.g. 33-34°F): Σ DEB values that fall inside.
            lo = int(lower) if lower is not None else None
            hi = int(upper) if upper is not None else None
            deb_probability = round(
                sum(
                    prob
                    for tau, prob in deb_points
                    if (lo is None or tau >= lo) and (hi is None or tau <= hi)
                ),
                4,
            )

        aligned.append(
            {
                **bucket,
                "value": value,
                "deb_probability": deb_probability,
            }
        )
    return aligned


def _collect_market_buckets(
    event: Optional[Mapping[str, Any]],
    scanner: PolymarketQuoteScanner,
    *,
    time_budget_sec: float = _ARBITRAGE_QUOTE_BUDGET_SEC,
) -> Tuple[List[Dict[str, Any]], List[Optional[float]], List[Optional[float]], str]:
    """Parse the event markets and fetch Yes/No ask prices within the budget."""
    import time as _time

    if not isinstance(event, Mapping) or not event.get("markets"):
        return [], [], [], "event_missing"

    markets = [m for m in (event.get("markets") or []) if isinstance(m, Mapping)]
    if not markets:
        return [], [], [], "event_missing"

    started = _time.monotonic()
    ask_prices: Dict[str, Optional[float]] = {}
    status = "ready"
    temp_symbol_hint = ""
    for market in markets:
        if _time.monotonic() - started >= time_budget_sec:
            status = "partial"
            break
        hint_prices = _market_hint_prices(market)
        tokens = _market_tokens(market)
        for side in ("yes", "no"):
            token_id = tokens.get(side)
            if not token_id or token_id in ask_prices:
                continue
            hint_price = hint_prices.get(side)
            if hint_price is not None and _isfinite(float(hint_price)):
                ask_prices[token_id] = float(hint_price)
                continue
            if _time.monotonic() - started >= time_budget_sec:
                status = "partial"
                continue
            try:
                ask_prices[token_id] = scanner.fetch_ask_price(token_id)
            except Exception as exc:  # pragma: no cover - network error path
                logger.warning("arbitrage fetch_ask_price failed: %s", exc)
                ask_prices[token_id] = hint_price
                status = "partial"

    buckets: List[Dict[str, Any]] = []
    yes_asks: List[Optional[float]] = []
    no_asks: List[Optional[float]] = []
    for market in markets:
        question = str(market.get("question") or "")
        if not temp_symbol_hint:
            # First market determines °C vs °F for label consistency.
            temp_symbol_hint = (
                "°F" if "°F" in question or " f " in question.lower() else "°C"
            )
        option = parse_market_option_from_question(question, temp_symbol_hint)
        tokens = _market_tokens(market)
        market_slug = str(market.get("slug") or "")
        market_url = _market_url(str(market.get("slug") or event.get("slug") or ""))
        bucket = {
            "label": option["label"],
            "lower": option.get("lower"),
            "upper": option.get("upper"),
            "isTail": (
                "below"
                if option.get("lower") is None and option.get("upper") is not None
                else "higher"
                if option.get("lower") is not None and option.get("upper") is None
                else None
            ),
            "market_yes_cents": _price_to_cents(
                ask_prices.get(tokens.get("yes") or "")
            ),
            "market_no_cents": _price_to_cents(ask_prices.get(tokens.get("no") or "")),
            "market_volume_usd": _sf(market.get("volume")),
            "market_liquidity_usd": _sf(market.get("liquidity")),
            "market_slug": market_slug,
            "market_url": market_url,
        }
        buckets.append(bucket)
        yes_asks.append(bucket["market_yes_cents"])
        no_asks.append(bucket["market_no_cents"])

    return buckets, yes_asks, no_asks, status


def _sort_aligned_buckets(buckets: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Sort buckets by temperature ascending (below-tails first, then exact, then higher)."""

    def _sort_key(bucket: Mapping[str, Any]) -> Tuple[int, int, int]:
        is_tail = bucket.get("isTail")
        lower = bucket.get("lower")
        upper = bucket.get("upper")
        if is_tail == "below" and upper is not None:
            return (0, int(upper), 0)
        if is_tail == "higher" and lower is not None:
            return (2, int(lower), 0)
        anchor = (
            int(lower) if lower is not None else int(upper) if upper is not None else 0
        )
        return (1, anchor, 0)

    return sorted(buckets, key=_sort_key)


def _serialise_bucket(bucket: Mapping[str, Any]) -> Dict[str, Any]:
    return {
        "label": bucket.get("label") or "—",
        "value": bucket.get("value"),
        "isTail": bucket.get("isTail"),
        "deb_probability": round(float(bucket.get("deb_probability") or 0.0), 4),
        "market_yes_cents": bucket.get("market_yes_cents"),
        "market_no_cents": bucket.get("market_no_cents"),
        "market_volume_usd": bucket.get("market_volume_usd"),
        "market_liquidity_usd": bucket.get("market_liquidity_usd"),
        "market_slug": bucket.get("market_slug"),
        "market_url": bucket.get("market_url"),
    }


def get_arbitrage_overview(
    request: Request,
    city: str,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    """Build the DEB-vs-Polymarket arbitrage overview payload for one city.

    Always returns HTTP 200; failures are surfaced via the ``market_available``
    flag and the ``error`` field, matching the design doc's degradation model.
    """
    # ``request`` is reserved for future per-request cache hooks; today the
    # service is request-agnostic but we still accept the parameter to match
    # the router signature.
    _ = request
    error: Optional[str] = None
    city_key: Optional[str] = None
    display_name: str = city.strip()
    temp_symbol = "°C"
    local_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    engine = "unavailable"
    deb_distribution: List[Dict[str, Any]] = []

    try:
        city_key, display_name = _resolve_city_key(request, city)
    except HTTPException as exc:
        return {
            "city": city.strip().lower().replace(" ", "-"),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "engine": "unavailable",
            "temp_symbol": "°C",
            "market_available": False,
            "total_market_yes_sum": None,
            "buckets": [],
            "error": str(exc.detail) if exc.detail else "unknown_city",
        }

    try:
        data = _analyze_city(city_key, force_refresh=force_refresh)
        temp_symbol = str(data.get("temp_symbol") or "°C")
        local_date = str(data.get("local_date") or local_date)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("arbitrage: city analyze failed for %s: %s", city_key, exc)
        error = f"city_data_unavailable: {exc}"

    if not error:
        deb_distribution, _deb_value, engine = _load_city_deb_payload(
            request, city_key, force_refresh
        )

    event_slug = _build_event_slug(display_name, local_date)
    market_available = False
    buckets: List[Dict[str, Any]] = []
    quote_status = "scan_empty"
    if event_slug:
        scanner = PolymarketQuoteScanner()
        try:
            event = scanner.fetch_event(event_slug)
        except Exception as exc:  # pragma: no cover - network error path
            logger.warning("arbitrage fetch_event failed slug=%s: %s", event_slug, exc)
            event = None
            error = error or f"market_event_unavailable: {exc}"

        market_buckets, _yes_asks, _no_asks, fetch_status = _collect_market_buckets(
            event, scanner
        )
        quote_status = fetch_status
        if market_buckets:
            aligned = _align_buckets(market_buckets, deb_distribution)
            sorted_buckets = _sort_aligned_buckets(aligned)
            buckets = [_serialise_bucket(b) for b in sorted_buckets]
            market_available = True
        elif not error:
            error = "market_event_unavailable: no buckets parsed"
    else:
        error = error or "event_slug_unresolvable"

    total_yes_sum: Optional[float] = None
    if buckets:
        total_yes_sum = round(
            sum(
                float(b["market_yes_cents"] or 0.0)
                for b in buckets
                if b.get("market_yes_cents") is not None
            ),
            2,
        )

    return {
        "city": city_key or display_name.lower().replace(" ", "-"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "engine": engine,
        "temp_symbol": temp_symbol,
        "market_available": market_available,
        "total_market_yes_sum": total_yes_sum,
        "buckets": buckets,
        "error": error,
        "_meta": {
            "event_slug": event_slug,
            "quote_status": quote_status,
        },
    }


# ---------------------------------------------------------------------------
# Batch overview (all-city view)
# ---------------------------------------------------------------------------

_ARBITRAGE_BATCH_CACHE: Dict[Tuple[Tuple[str, ...], bool], Tuple[float, Dict[str, Any]]] = {}
_ARBITRAGE_BATCH_INFLIGHT: Dict[Tuple[Tuple[str, ...], bool], "asyncio.Task[Dict[str, Any]]"] = {}
_ARBITRAGE_BATCH_LOCK = asyncio.Lock()


def _parse_arbitrage_batch_cities(raw_cities: str, *, limit: int) -> List[str]:
    seen = set()
    out: List[str] = []
    for item in str(raw_cities or "").split(","):
        city = item.strip()
        if not city or city in seen:
            continue
        seen.add(city)
        out.append(city)
        if len(out) >= limit:
            break
    return out


def _arbitrage_batch_concurrency() -> int:
    try:
        value = int(os.getenv("POLYWEATHER_ARBITRAGE_BATCH_CONCURRENCY", "4") or "4")
    except ValueError:
        value = 4
    return max(1, min(8, value))


def _arbitrage_batch_cache_ttl() -> float:
    try:
        value = int(os.getenv("POLYWEATHER_ARBITRAGE_BATCH_CACHE_TTL_SEC", "12") or "12")
    except ValueError:
        value = 12
    return max(0.0, float(value))


def _arbitrage_batch_partial_timeout() -> Optional[float]:
    try:
        ms = int(
            os.getenv("POLYWEATHER_ARBITRAGE_BATCH_PARTIAL_TIMEOUT_MS", "15000")
            or "15000"
        )
    except ValueError:
        ms = 15000
    if ms <= 0:
        return None
    return ms / 1000.0


def _arbitrage_batch_cache_key(
    city_names: List[str], force_refresh: bool
) -> Tuple[Tuple[str, ...], bool]:
    return (tuple(sorted(city_names)), force_refresh)


async def get_arbitrage_overview_batch(
    request: Request,
    cities: str,
    force_refresh: bool = False,
    limit: int = 50,
) -> Dict[str, Any]:
    """Build arbitrage overviews for many cities in one request.

    Mirrors the ``/api/cities/detail-batch`` pattern: bounded per-request
    concurrency, a short response cache (inflight-shared), and a partial
    timeout that returns completed cities while the slowest ones land in
    ``missing``. Each city's payload is built by ``get_arbitrage_overview``,
    so per-city failures degrade to ``market_available: false`` instead of
    raising.
    """
    city_names = _parse_arbitrage_batch_cities(
        cities, limit=max(1, min(50, int(limit or 50)))
    )
    if not city_names:
        return {
            "cities": [],
            "details": {},
            "errors": {},
            "missing": [],
            "partial": False,
        }

    async def _build_uncached_payload() -> Dict[str, Any]:
        semaphore = asyncio.Semaphore(_arbitrage_batch_concurrency())
        city_durations_ms: Dict[str, float] = {}

        async def _build_with_limit(city: str) -> Tuple[str, Dict[str, Any]]:
            async with semaphore:
                started = time.perf_counter()
                try:
                    payload = await run_in_threadpool(
                        get_arbitrage_overview,
                        request,
                        city,
                        force_refresh,
                    )
                    return city, payload
                finally:
                    city_durations_ms[city] = round(
                        (time.perf_counter() - started) * 1000.0, 1
                    )

        task_by_city = {
            city: asyncio.create_task(_build_with_limit(city)) for city in city_names
        }
        task_city_lookup = {task: city for city, task in task_by_city.items()}
        done, pending = await asyncio.wait(
            task_by_city.values(),
            timeout=_arbitrage_batch_partial_timeout(),
        )
        details: Dict[str, Any] = {}
        errors: Dict[str, str] = {}
        for task in done:
            city = task_city_lookup[task]
            try:
                result_city, payload = task.result()
            except Exception as exc:
                errors[city] = str(exc)
                continue
            details[result_city] = payload

        missing = [task_city_lookup[task] for task in pending]
        for task in pending:
            task.cancel()
        missing_set = set(missing)
        missing = [city for city in city_names if city in missing_set]

        return {
            "cities": city_names,
            "details": details,
            "errors": errors,
            "missing": missing,
            "partial": bool(missing or errors),
            "_meta": {
                "city_durations_ms": city_durations_ms,
                "response_source": "fresh_build",
            },
        }

    cache_ttl = _arbitrage_batch_cache_ttl()
    cache_key = _arbitrage_batch_cache_key(city_names, force_refresh)
    if cache_ttl > 0 and not force_refresh:
        now_ts = time.time()
        async with _ARBITRAGE_BATCH_LOCK:
            cached = _ARBITRAGE_BATCH_CACHE.get(cache_key)
            if cached is not None and now_ts - cached[0] < cache_ttl:
                return cached[1]
            task = _ARBITRAGE_BATCH_INFLIGHT.get(cache_key)
            owner = False
            if task is None:
                owner = True
                task = asyncio.create_task(_build_uncached_payload())
                _ARBITRAGE_BATCH_INFLIGHT[cache_key] = task

        try:
            payload = await task
        finally:
            if owner:
                async with _ARBITRAGE_BATCH_LOCK:
                    if _ARBITRAGE_BATCH_INFLIGHT.get(cache_key) is task:
                        _ARBITRAGE_BATCH_INFLIGHT.pop(cache_key, None)

        if owner and not payload.get("partial"):
            async with _ARBITRAGE_BATCH_LOCK:
                _ARBITRAGE_BATCH_CACHE[cache_key] = (time.time(), payload)
                if len(_ARBITRAGE_BATCH_CACHE) > 64:
                    oldest_keys = sorted(
                        _ARBITRAGE_BATCH_CACHE,
                        key=lambda item: _ARBITRAGE_BATCH_CACHE[item][0],
                    )[:16]
                    for old_key in oldest_keys:
                        _ARBITRAGE_BATCH_CACHE.pop(old_key, None)
        return payload

    return await _build_uncached_payload()


# ---------------------------------------------------------------------------
# Dynamic city enumeration (public-search discovery)
# ---------------------------------------------------------------------------


def _fetch_public_search_events() -> List[Dict[str, Any]]:
    """Fetch active events from the Polymarket public-search endpoint.

    Returns the raw ``events`` list; any network/parse failure yields an
    empty list so callers can fall back to the static city set.
    """
    try:
        response = requests.get(
            f"{GAMMA_API_BASE}/public-search",
            params={"q": "highest temperature", "limit_per_type": 100},
            timeout=12,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:  # pragma: no cover - network error path
        logger.warning("arbitrage public-search failed: %s", exc)
        return []
    events = payload.get("events") if isinstance(payload, Mapping) else None
    if not isinstance(events, list):
        return []
    return [event for event in events if isinstance(event, dict)]


def _registry_display_name(key: str, row: Any) -> str:
    name = row.get("name") if isinstance(row, Mapping) else None
    return str(name or key)


def _match_registry_key(candidate: str, registry: Mapping[str, Any]) -> Optional[str]:
    """Resolve an event-title city name to a CITY_REGISTRY key.

    Exact match on the normalised registry name/key first (after applying the
    title alias map); then a containment match (e.g. ``Seoul (Incheon)`` →
    ``seoul``) which is only accepted when it hits exactly one registry entry,
    to avoid ambiguous resolutions.
    """
    raw = _normalize_key(candidate)
    candidate_norm = _SEARCH_CITY_ALIASES.get(raw, raw)
    if not candidate_norm:
        return None
    for key, row in registry.items():
        if candidate_norm in {
            _normalize_key(_registry_display_name(key, row)),
            _normalize_key(key),
        }:
            return key
    hits = [
        key
        for key, row in registry.items()
        if candidate_norm in _normalize_key(_registry_display_name(key, row))
        or _normalize_key(_registry_display_name(key, row)) in candidate_norm
    ]
    return hits[0] if len(hits) == 1 else None


def _fallback_cities(registry: Mapping[str, Any]) -> List[Dict[str, str]]:
    cities: List[Dict[str, str]] = []
    for key in _ARBITRAGE_CITY_FALLBACK_KEYS:
        row = registry.get(key)
        name = row.get("name") if isinstance(row, Mapping) else None
        cities.append({"key": key, "display_name": str(name or key.title())})
    return cities


def list_arbitrage_cities(request: Request) -> Dict[str, Any]:
    """List monitored cities that currently have active temperature events.

    Discovers cities from the Polymarket public-search endpoint, intersects
    them with CITY_REGISTRY (preserving registry order), and caches the
    payload for one hour (in-memory plus optional shared Redis). When
    discovery fails or the intersection is empty, a static eight-city list is
    returned with ``fallback: True``.
    """
    # ``request`` is accepted to match the router signature; the payload is
    # request-agnostic and cached process-wide.
    _ = request
    import web.routes as legacy_routes

    now = time.time()
    with _ARBITRAGE_CITIES_LOCK:
        cached = _ARBITRAGE_CITIES_CACHE.get(_ARBITRAGE_CITIES_CACHE_KEY)
    if cached and cached[1] and now - cached[0] < _ARBITRAGE_CITIES_CACHE_TTL_SEC:
        return dict(cached[1])

    # Redis 命中则回填内存缓存后返回（跨 worker / 跨重启共享）。
    redis_payload = _read_arbitrage_redis_cache()
    if redis_payload:
        with _ARBITRAGE_CITIES_LOCK:
            _ARBITRAGE_CITIES_CACHE[_ARBITRAGE_CITIES_CACHE_KEY] = (now, redis_payload)
        return dict(redis_payload)

    registry = legacy_routes.CITY_REGISTRY
    discovered: Set[str] = set()
    for event in _fetch_public_search_events():
        match = _EVENT_TITLE_CITY_RE.search(str(event.get("title") or ""))
        if not match:
            continue
        city_key = _match_registry_key(match.group(1), registry)
        if city_key:
            discovered.add(city_key)

    fallback = not discovered
    if fallback:
        cities: List[Dict[str, str]] = _fallback_cities(registry)
    else:
        cities = [
            {"key": key, "display_name": _registry_display_name(key, row)}
            for key, row in registry.items()
            if key in discovered
        ]

    payload: Dict[str, Any] = {
        "cities": cities,
        "fallback": fallback,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    _write_arbitrage_redis_cache(payload)
    with _ARBITRAGE_CITIES_LOCK:
        _ARBITRAGE_CITIES_CACHE[_ARBITRAGE_CITIES_CACHE_KEY] = (now, payload)
    return payload


__all__ = [
    "get_arbitrage_overview",
    "get_arbitrage_overview_batch",
    "list_arbitrage_cities",
    "GAMMA_API_BASE",
    "CLOB_API_BASE",
    "PolymarketQuoteScanner",
]
