from __future__ import annotations

from typing import Any, Dict, Optional

from web.scan_city_ai_helpers import _safe_float


def safe_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return int(default)


def normalize_scan_terminal_filters(
    raw_filters: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    raw = raw_filters if isinstance(raw_filters, dict) else {}
    min_price = _safe_float(raw.get("min_price"))
    max_price = _safe_float(raw.get("max_price"))
    if min_price is None:
        min_price = 0.05
    if max_price is None:
        max_price = 0.95
    min_price = max(0.0, min(1.0, min_price))
    max_price = max(0.0, min(1.0, max_price))
    if min_price > max_price:
        min_price, max_price = max_price, min_price

    high_liquidity_only = bool(raw.get("high_liquidity_only"))
    min_liquidity = _safe_float(raw.get("min_liquidity"))
    if min_liquidity is None:
        min_liquidity = 5000.0 if high_liquidity_only else 500.0
    if high_liquidity_only:
        min_liquidity = max(min_liquidity, 5000.0)

    result: Dict[str, Any] = {
        "scan_mode": str(raw.get("scan_mode") or "tradable").strip().lower()
        or "tradable",
        "min_price": float(min_price),
        "max_price": float(max_price),
        "min_edge_pct": max(0.0, _safe_float(raw.get("min_edge_pct")) or 2.0),
        "min_liquidity": max(0.0, float(min_liquidity)),
        "high_liquidity_only": high_liquidity_only,
        "market_type": str(raw.get("market_type") or "maxtemp").strip().lower()
        or "maxtemp",
        "time_range": str(raw.get("time_range") or "today").strip().lower()
        or "today",
        "limit": max(1, min(safe_int(raw.get("limit"), 25), 100)),
        "max_spread": max(0.0, _safe_float(raw.get("max_spread")) or 0.03),
    }
    trading_region = str(raw.get("trading_region") or "").strip().lower()
    if trading_region and trading_region not in ("all", ""):
        result["trading_region"] = trading_region
    return result


def market_region_from_tz_offset(tz_offset_seconds: Any) -> Dict[str, object]:
    """Map UTC offset to geographic region with an east-to-west sort order.

    Sort order follows the sun: 1=East Asia → 7=North America.
    """
    tz_hours = safe_int(tz_offset_seconds, 0) / 3600.0
    if tz_hours >= 8:
        return {"key": "east_asia", "label_en": "East Asia", "label_zh": "东亚", "sort_order": 1}
    if tz_hours >= 7:
        return {"key": "southeast_asia", "label_en": "Southeast Asia", "label_zh": "东南亚", "sort_order": 2}
    if tz_hours >= 4.5:
        return {"key": "central_asia", "label_en": "Central / South Asia", "label_zh": "中亚 / 南亚", "sort_order": 3}
    if tz_hours >= 2:
        return {"key": "west_asia", "label_en": "West Asia / Middle East", "label_zh": "西亚 / 中东", "sort_order": 4}
    if tz_hours >= -2:
        return {"key": "europe_africa", "label_en": "Europe / Africa", "label_zh": "欧洲 / 非洲", "sort_order": 5}
    if tz_hours >= -4:
        return {"key": "south_america", "label_en": "Latin America", "label_zh": "拉美", "sort_order": 6}
    return {"key": "north_america", "label_en": "North America", "label_zh": "北美", "sort_order": 7}
