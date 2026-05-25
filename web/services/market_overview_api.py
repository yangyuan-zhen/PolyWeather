"""Deterministic market overview for scan terminal rows, cached 10 minutes."""

from __future__ import annotations

import hashlib
import json
import threading
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

_OVERVIEW_CACHE: Dict[str, Dict[str, Any]] = {}
_OVERVIEW_CACHE_LOCK = threading.Lock()
OVERVIEW_CACHE_TTL_SEC = 600


def _safe_float(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        number = float(value)
    except Exception:
        return None
    return number if number == number else None


def _row_city(row: Dict[str, Any]) -> str:
    return str(row.get("display_name") or row.get("city") or row.get("name") or "").strip()


def _row_edge(row: Dict[str, Any]) -> Optional[float]:
    return (
        _safe_float(row.get("edge_percent"))
        or _safe_float(row.get("edge_pct"))
        or _safe_float(row.get("edge"))
    )


def _row_score(row: Dict[str, Any]) -> float:
    edge = _row_edge(row) or 0.0
    final_score = _safe_float(row.get("final_score")) or 0.0
    liquidity = _safe_float(row.get("liquidity")) or _safe_float(row.get("liquidity_num")) or 0.0
    return edge * 10.0 + final_score + min(liquidity / 1000.0, 25.0)


def _row_liquidity(row: Dict[str, Any]) -> float:
    return _safe_float(row.get("liquidity")) or _safe_float(row.get("liquidity_num")) or 0.0


def _row_prob_gap(row: Dict[str, Any]) -> Optional[float]:
    model_prob = _safe_float(row.get("model_probability"))
    market_prob = _safe_float(row.get("market_probability"))
    if model_prob is None or market_prob is None:
        return None
    return model_prob - market_prob


def _cache_key(rows: List[Dict[str, Any]], locale: str) -> str:
    finger = {
        "locale": locale,
        "rows": [
            {
                "city": row.get("city") or row.get("name") or "",
                "edge": _row_edge(row),
                "score": _safe_float(row.get("final_score")),
                "liquidity": _row_liquidity(row),
                "status": row.get("status") or row.get("signal_status") or "",
            }
            for row in rows
            if isinstance(row, dict)
        ],
    }
    raw = json.dumps(finger, sort_keys=True, ensure_ascii=False, default=str)
    return "overview:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _build_highlights(rows: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    ranked = sorted(
        (row for row in rows if isinstance(row, dict) and _row_city(row)),
        key=lambda item: (_row_score(item), _row_liquidity(item)),
        reverse=True,
    )
    highlights: List[Dict[str, str]] = []
    for row in ranked[:5]:
        city = _row_city(row)
        edge = _row_edge(row)
        liquidity = _row_liquidity(row)
        gap = _row_prob_gap(row)
        edge_text = f"{edge:.1f}%" if edge is not None else "--"
        gap_text = f"{gap * 100:.1f}pp" if gap is not None else "--"
        liquidity_text = f"{liquidity:,.0f}" if liquidity else "--"
        highlights.append(
            {
                "city": city,
                "note_zh": f"edge {edge_text}，模型/市场概率差 {gap_text}，流动性 {liquidity_text}。",
                "note_en": f"edge {edge_text}, model-market gap {gap_text}, liquidity {liquidity_text}.",
            }
        )
    return highlights


def _build_payload(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    clean_rows = [row for row in rows if isinstance(row, dict)]
    total = len(clean_rows)
    tradable = sum(1 for row in clean_rows if not row.get("closed") and not row.get("stale_for_today"))
    high_risk = sum(
        1
        for row in clean_rows
        if str(row.get("risk_level") or row.get("risk") or "").lower() in {"high", "danger", "red"}
    )
    avg_edge_values = [_row_edge(row) for row in clean_rows]
    avg_edge_nums = [value for value in avg_edge_values if value is not None]
    avg_edge = sum(avg_edge_nums) / len(avg_edge_nums) if avg_edge_nums else 0.0
    total_liquidity = sum(_row_liquidity(row) for row in clean_rows)
    highlights = _build_highlights(clean_rows)

    overview_zh = (
        f"当前区域共有 {total} 个天气合约，{tradable} 个可交易；"
        f"高风险 {high_risk} 个，平均 edge {avg_edge:.1f}%，总流动性 {total_liquidity:,.0f}。"
        "优先查看 edge、final score 与流动性同时靠前的城市。"
    )
    overview_en = (
        f"{total} weather contracts are in scope, {tradable} tradable; "
        f"{high_risk} high-risk rows, average edge {avg_edge:.1f}%, total liquidity {total_liquidity:,.0f}. "
        "Prioritize rows where edge, final score and liquidity align."
    )

    return {
        "overview_zh": overview_zh,
        "overview_en": overview_en,
        "highlights": highlights,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "cache_ttl_sec": OVERVIEW_CACHE_TTL_SEC,
        "source": "deterministic",
    }


def build_market_overview_payload(
    rows: List[Dict[str, Any]],
    *,
    locale: str = "zh-CN",
    force_refresh: bool = False,
) -> Dict[str, Any]:
    if not rows:
        return {
            "overview_zh": "",
            "overview_en": "",
            "highlights": [],
            "generated_at": None,
            "cache_ttl_sec": OVERVIEW_CACHE_TTL_SEC,
            "source": "deterministic",
        }

    key = _cache_key(rows, locale)
    if not force_refresh:
        with _OVERVIEW_CACHE_LOCK:
            cached = _OVERVIEW_CACHE.get(key)
            if cached and cached.get("expires_at", 0) >= time.time():
                return cached["payload"]

    payload = _build_payload(rows)
    with _OVERVIEW_CACHE_LOCK:
        _OVERVIEW_CACHE[key] = {
            "expires_at": time.time() + OVERVIEW_CACHE_TTL_SEC,
            "payload": payload,
        }
    return payload
