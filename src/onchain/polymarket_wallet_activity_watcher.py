import json
import os
import threading
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import Any, Dict, List, Optional, Tuple

import requests
from loguru import logger


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except Exception:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except Exception:
        return default


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def _normalize_addr(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip().lower()
    if text.startswith("0x") and len(text) == 42:
        return text
    return ""


def _short(addr: str, left: int = 6, right: int = 4) -> str:
    if not addr:
        return "unknown"
    if len(addr) <= left + right + 2:
        return addr
    return f"{addr[:left + 2]}...{addr[-right:]}"


def _parse_addresses(raw: Optional[str]) -> List[str]:
    out: List[str] = []
    if not raw:
        return out
    seen = set()
    for part in raw.split(","):
        addr = _normalize_addr(part)
        if addr and addr not in seen:
            out.append(addr)
            seen.add(addr)
    return out


def _state_file() -> str:
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(root, "data", "polymarket_wallet_activity_state.json")


def _load_state(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        return {"users": {}}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            data.setdefault("users", {})
            return data
    except Exception as exc:
        logger.warning(f"failed to load wallet activity state: {exc}")
    return {"users": {}}


def _save_state(path: str, state: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _market_url(position: Dict[str, Any]) -> str:
    slug = str(position.get("slug") or "").strip()
    event_slug = str(position.get("event_slug") or "").strip()

    if slug and event_slug:
        return f"https://polymarket.com/event/{event_slug}/{slug}"
    if slug:
        return f"https://polymarket.com/market/{slug}"
    if event_slug:
        return f"https://polymarket.com/event/{event_slug}"
    return ""


def _position_key(position: Dict[str, Any]) -> str:
    asset = str(position.get("asset") or "").strip().lower()
    condition_id = str(position.get("condition_id") or "").strip().lower()
    outcome = str(position.get("outcome") or "").strip().lower()
    if asset:
        return f"asset:{asset}"
    return f"condition:{condition_id}|outcome:{outcome}"


def _normalize_position(row: Dict[str, Any]) -> Dict[str, Any]:
    title = (
        str(
            row.get("title")
            or row.get("question")
            or row.get("market")
            or row.get("name")
            or ""
        )
        .strip()
    )
    outcome = str(row.get("outcome") or row.get("side") or "").strip()

    return {
        "proxy_wallet": _normalize_addr(row.get("proxyWallet") or row.get("proxy_wallet")),
        "asset": str(row.get("asset") or row.get("assetId") or "").strip(),
        "condition_id": str(row.get("conditionId") or row.get("condition_id") or "").strip(),
        "title": title,
        "slug": str(row.get("slug") or row.get("marketSlug") or "").strip(),
        "event_slug": str(row.get("eventSlug") or row.get("event_slug") or "").strip(),
        "outcome": outcome,
        "size": _safe_float(row.get("size") or row.get("shares")),
        "avg_price": _safe_float(row.get("avgPrice") or row.get("avg_price")),
        "position_value": _safe_float(row.get("currentValue") or row.get("positionValue")),
        "cash_pnl": _safe_float(row.get("cashPnl") or row.get("realizedPnl") or row.get("pnl")),
        "percent_pnl": _safe_float(
            row.get("percentPnl")
            or row.get("pnlPercent")
            or row.get("pnl_pct")
        ),
        "cur_price": _safe_float(row.get("curPrice") or row.get("lastPrice")),
        "updated_at": int(time.time()),
    }


def _fetch_positions(
    session: requests.Session,
    base_url: str,
    user: str,
    timeout_sec: int,
) -> List[Dict[str, Any]]:
    url = f"{base_url.rstrip('/')}/positions"
    resp = session.get(url, params={"user": user}, timeout=timeout_sec)
    resp.raise_for_status()
    data = resp.json()

    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]

    if isinstance(data, dict):
        for key in ("positions", "data", "results", "items"):
            maybe = data.get(key)
            if isinstance(maybe, list):
                return [row for row in maybe if isinstance(row, dict)]

    return []


def _build_snapshot(
    rows: List[Dict[str, Any]],
    min_size_abs: float,
) -> Dict[str, Dict[str, Any]]:
    snap: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        pos = _normalize_position(row)
        if abs(pos["size"]) < min_size_abs:
            continue
        key = _position_key(pos)
        snap[key] = pos
    return snap


def _diff_positions(
    previous: Dict[str, Dict[str, Any]],
    current: Dict[str, Dict[str, Any]],
    min_size_delta: float,
    notify_closed: bool,
    min_price: float = 0.0,
    max_price: float = 1.0,
) -> List[Tuple[str, Dict[str, Any]]]:
    changes: List[Tuple[str, Dict[str, Any]]] = []

    for key, now_pos in current.items():
        # 价格过滤：如果设置了价格区间，不符合的直接跳过
        price = _safe_float(now_pos.get("avg_price"))
        if price < min_price or price > max_price:
            logger.debug(f"skipped position due to price range limit: market={now_pos.get('title')} price={price}")
            continue

        old_pos = previous.get(key)
        if old_pos is None:
            changes.append(("new", now_pos))
            continue

        size_delta = now_pos["size"] - old_pos.get("size", 0.0)
        avg_delta = now_pos["avg_price"] - old_pos.get("avg_price", 0.0)

        if abs(size_delta) >= min_size_delta or abs(avg_delta) >= 1e-9:
            merged = {**now_pos}
            merged["size_delta"] = size_delta
            merged["old_size"] = old_pos.get("size", 0.0)
            merged["old_avg_price"] = old_pos.get("avg_price", 0.0)
            changes.append(("update", merged))

    if notify_closed:
        for key, old_pos in previous.items():
            if key not in current:
                changes.append(("closed", old_pos))

    return changes


def _fmt_pct(value: float) -> str:
    # Data API may return either ratio (0.12) or percent (12.0).
    display = value * 100.0 if abs(value) <= 1.5 else value
    return f"{display:.1f}%"


def _fmt_usd(value: float) -> str:
    return f"${value:.2f}"


def _fmt_price(value: float) -> str:
    return f"{value:.3f}"


def _should_show_avg_price(avg_price: float) -> bool:
    # Extreme prices near 0/1 are usually not informative for activity alerts.
    min_show = max(
        0.0,
        min(1.0, _env_float("POLYMARKET_WALLET_ACTIVITY_AVG_PRICE_SHOW_MIN", 0.01)),
    )
    max_show = max(
        0.0,
        min(1.0, _env_float("POLYMARKET_WALLET_ACTIVITY_AVG_PRICE_SHOW_MAX", 0.99)),
    )
    if min_show > max_show:
        min_show, max_show = max_show, min_show
    return min_show <= avg_price <= max_show


def _format_change_block(
    change_type: str,
    wallet: str,
    pos: Dict[str, Any],
    now_utc: str,
) -> str:
    title = pos.get("title") or "Unknown market"
    outcome = pos.get("outcome") or "Unknown"
    market_url = _market_url(pos)

    lines: List[str] = []
    if change_type == "new":
        lines.append("🆕 New Position")
    elif change_type == "update":
        lines.append("🔄 Position Update")
    else:
        lines.append("❌ Position Closed")

    lines.append(f"Wallet: {_short(wallet)}")
    if market_url:
        lines.append(f"Market: {title} ({market_url})")
    else:
        lines.append(f"Market: {title}")

    lines.append(f"Outcome: {outcome}")

    if change_type == "update":
        old_size = _safe_float(pos.get("old_size"))
        now_size = _safe_float(pos.get("size"))
        delta = _safe_float(pos.get("size_delta"))
        lines.append(f"Size: {old_size:.3f} -> {now_size:.3f} (Δ {delta:+.3f})")
    elif change_type == "closed":
        lines.append(f"Size: 0.000 (was {_safe_float(pos.get('size')):.3f})")
    else:
        lines.append(f"Size: {_safe_float(pos.get('size')):.3f}")

    avg_price = _safe_float(pos.get("avg_price"))
    if _should_show_avg_price(avg_price):
        lines.append(f"Avg Price: {_fmt_price(avg_price)}")
    lines.append(f"Position Value: {_fmt_usd(_safe_float(pos.get('position_value')))}")

    pnl = _safe_float(pos.get("cash_pnl"))
    pnl_pct = _safe_float(pos.get("percent_pnl"))
    lines.append(f"PnL: {_fmt_usd(pnl)} ({_fmt_pct(pnl_pct)})")
    lines.append(f"Time: {now_utc}")
    return "\n".join(lines)


def _build_message(
    wallet: str,
    changes: List[Tuple[str, Dict[str, Any]]],
    max_changes: int,
) -> str:
    now_bj = (
        datetime.now(timezone.utc)
        .astimezone(ZoneInfo("Asia/Shanghai"))
        .strftime("%Y-%m-%d %H:%M:%S")
    )
    shown = changes[:max_changes]
    lines = [f"🚨 Wallet Activity ({len(changes)} changes):", ""]

    for idx, (change_type, pos) in enumerate(shown):
        lines.append(_format_change_block(change_type, wallet, pos, f"{now_bj} 北京时间"))
        if idx != len(shown) - 1:
            lines.append("")

    if len(changes) > max_changes:
        lines.append("")
        lines.append(f"... and {len(changes) - max_changes} more changes")

    return "\n".join(lines)


def start_polymarket_wallet_activity_loop(bot: Any) -> Optional[threading.Thread]:
    enabled = _env_bool("POLYMARKET_WALLET_ACTIVITY_ENABLED", False)
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    users = _parse_addresses(os.getenv("POLYMARKET_WALLET_ACTIVITY_USERS"))

    if not enabled:
        logger.info("polymarket wallet activity watcher disabled")
        return None
    if not chat_id:
        logger.warning("polymarket wallet activity watcher skipped: TELEGRAM_CHAT_ID is not set")
        return None
    if not users:
        logger.warning("polymarket wallet activity watcher skipped: POLYMARKET_WALLET_ACTIVITY_USERS is empty")
        return None

    data_api_url = str(
        os.getenv("POLYMARKET_WALLET_ACTIVITY_DATA_API_URL", "https://data-api.polymarket.com")
    ).strip()
    poll_sec = max(5, _env_int("POLYMARKET_WALLET_ACTIVITY_INTERVAL_SEC", 20))
    timeout_sec = max(5, _env_int("POLYMARKET_WALLET_ACTIVITY_TIMEOUT_SEC", 10))
    min_size_abs = max(0.0, _env_float("POLYMARKET_WALLET_ACTIVITY_MIN_SIZE_ABS", 0.001))
    min_size_delta = max(0.0, _env_float("POLYMARKET_WALLET_ACTIVITY_MIN_SIZE_DELTA", 0.001))
    max_changes = max(1, _env_int("POLYMARKET_WALLET_ACTIVITY_MAX_CHANGES_PER_MSG", 5))
    notify_closed = _env_bool("POLYMARKET_WALLET_ACTIVITY_NOTIFY_CLOSED", False)
    bootstrap_alert = _env_bool("POLYMARKET_WALLET_ACTIVITY_BOOTSTRAP_ALERT", False)

    # 价格过滤范围配置
    min_price = _env_float("POLYMARKET_WALLET_ACTIVITY_AVG_PRICE_SHOW_MIN", 0.0)
    max_price = _env_float("POLYMARKET_WALLET_ACTIVITY_AVG_PRICE_SHOW_MAX", 1.0)

    state_path = _state_file()
    session = requests.Session()

    def _runner() -> None:
        state = _load_state(state_path)
        users_state = state.setdefault("users", {})

        logger.info(
            f"polymarket wallet activity watcher started users={len(users)} "
            f"poll={poll_sec}s data_api={data_api_url} price_filter={min_price}-{max_price}"
        )

        while True:
            touched = False
            for user in users:
                try:
                    rows = _fetch_positions(
                        session=session,
                        base_url=data_api_url,
                        user=user,
                        timeout_sec=timeout_sec,
                    )
                    current = _build_snapshot(rows, min_size_abs=min_size_abs)
                    prev = (
                        (users_state.get(user) or {}).get("positions")
                        if isinstance(users_state.get(user), dict)
                        else {}
                    ) or {}

                    if not prev and not bootstrap_alert:
                        users_state[user] = {
                            "positions": current,
                            "updated_at": int(time.time()),
                        }
                        touched = True
                        continue

                    changes = _diff_positions(
                        previous=prev,
                        current=current,
                        min_size_delta=min_size_delta,
                        notify_closed=notify_closed,
                        min_price=min_price,
                        max_price=max_price,
                    )

                    if changes:
                        msg = _build_message(user, changes, max_changes=max_changes)
                        bot.send_message(chat_id, msg, disable_web_page_preview=True)
                        logger.info(
                            f"wallet activity pushed user={user} changes={len(changes)}"
                        )

                    users_state[user] = {
                        "positions": current,
                        "updated_at": int(time.time()),
                    }
                    touched = True
                except Exception:
                    logger.exception(f"wallet activity cycle failed user={user}")

            if touched:
                try:
                    _save_state(state_path, state)
                except Exception:
                    logger.exception("failed to save wallet activity state")

            time.sleep(poll_sec)

    thread = threading.Thread(
        target=_runner,
        name="polymarket-wallet-activity-watcher",
        daemon=True,
    )
    thread.start()
    return thread







