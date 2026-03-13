import json
import os
import threading
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import Any, Dict, List, Optional, Tuple

import requests
from loguru import logger

from src.utils.telegram_chat_ids import get_telegram_chat_ids_from_env


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


def _parse_address_set(raw: Optional[str]) -> set[str]:
    return set(_parse_addresses(raw))


def _parse_address_aliases(raw: Optional[str]) -> Dict[str, str]:
    """
    Parse wallet aliases from either:
    - JSON object: {"0xabc...": "Whale A", "0xdef...": "Whale B"}
    - CSV pairs: 0xabc...=Whale A,0xdef...=Whale B
    """
    out: Dict[str, str] = {}
    if not raw:
        return out

    text = str(raw).strip()
    if not text:
        return out

    if text.startswith("{"):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                for k, v in parsed.items():
                    addr = _normalize_addr(k)
                    alias = str(v or "").strip()
                    if addr and alias:
                        out[addr] = alias
            return out
        except Exception:
            pass

    for part in text.split(","):
        row = part.strip()
        if not row:
            continue
        if "=" in row:
            left, right = row.split("=", 1)
        elif ":" in row:
            left, right = row.split(":", 1)
        else:
            continue
        addr = _normalize_addr(left)
        alias = str(right or "").strip()
        if addr and alias:
            out[addr] = alias

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

    # Prefer event-level URL first: Telegram preview is usually more stable.
    if event_slug:
        return f"https://polymarket.com/event/{event_slug}"
    if slug:
        return f"https://polymarket.com/market/{slug}"
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
    min_avg_price_delta: float = 0.002,
) -> List[Tuple[str, Dict[str, Any]]]:
    changes: List[Tuple[str, Dict[str, Any]]] = []
    min_avg_price_delta = max(0.0, min_avg_price_delta)

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

        if abs(size_delta) >= min_size_delta or abs(avg_delta) >= min_avg_price_delta:
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


def _merge_pending_update(
    pending_updates: Dict[str, Dict[str, Any]],
    pos_key: str,
    pos: Dict[str, Any],
    now_ts: int,
) -> None:
    entry = pending_updates.get(pos_key)
    size_delta = _safe_float(pos.get("size_delta"))
    old_size = _safe_float(pos.get("old_size"))
    new_size = _safe_float(pos.get("size"))
    old_avg = _safe_float(pos.get("old_avg_price"))
    new_avg = _safe_float(pos.get("avg_price"))

    if entry is None:
        pending_updates[pos_key] = {
            "count": 1,
            "first_ts": now_ts,
            "last_ts": now_ts,
            "title": pos.get("title"),
            "slug": pos.get("slug"),
            "event_slug": pos.get("event_slug"),
            "outcome": pos.get("outcome"),
            "asset": pos.get("asset"),
            "condition_id": pos.get("condition_id"),
            "old_size": old_size,
            "size": new_size,
            "size_delta": size_delta,
            "old_avg_price": old_avg,
            "avg_price": new_avg,
            "position_value": _safe_float(pos.get("position_value")),
            "cash_pnl": _safe_float(pos.get("cash_pnl")),
            "percent_pnl": _safe_float(pos.get("percent_pnl")),
        }
        return

    entry["count"] = int(entry.get("count", 1)) + 1
    entry["last_ts"] = now_ts
    entry["size_delta"] = _safe_float(entry.get("size_delta")) + size_delta
    entry["size"] = new_size
    entry["avg_price"] = new_avg
    entry["position_value"] = _safe_float(pos.get("position_value"))
    entry["cash_pnl"] = _safe_float(pos.get("cash_pnl"))
    entry["percent_pnl"] = _safe_float(pos.get("percent_pnl"))
    pending_updates[pos_key] = entry


def _finalize_pending_update(
    pending_entry: Dict[str, Any],
    now_ts: int,
) -> Dict[str, Any]:
    first_ts = int(pending_entry.get("first_ts") or now_ts)
    last_ts = int(pending_entry.get("last_ts") or now_ts)
    return {
        "title": pending_entry.get("title") or "",
        "slug": pending_entry.get("slug") or "",
        "event_slug": pending_entry.get("event_slug") or "",
        "outcome": pending_entry.get("outcome") or "",
        "asset": pending_entry.get("asset") or "",
        "condition_id": pending_entry.get("condition_id") or "",
        "old_size": _safe_float(pending_entry.get("old_size")),
        "size": _safe_float(pending_entry.get("size")),
        "size_delta": _safe_float(pending_entry.get("size_delta")),
        "old_avg_price": _safe_float(pending_entry.get("old_avg_price")),
        "avg_price": _safe_float(pending_entry.get("avg_price")),
        "position_value": _safe_float(pending_entry.get("position_value")),
        "cash_pnl": _safe_float(pending_entry.get("cash_pnl")),
        "percent_pnl": _safe_float(pending_entry.get("percent_pnl")),
        "agg_count": int(pending_entry.get("count") or 1),
        "agg_span_sec": max(0, last_ts - first_ts),
    }


def _flush_ready_pending_updates(
    pending_updates: Dict[str, Dict[str, Any]],
    now_ts: int,
    debounce_sec: int,
    max_hold_sec: int,
    force_keys: Optional[set] = None,
) -> List[Tuple[str, Dict[str, Any]]]:
    out: List[Tuple[str, Dict[str, Any]]] = []
    keys = list(pending_updates.keys())
    for key in keys:
        entry = pending_updates.get(key)
        if not isinstance(entry, dict):
            pending_updates.pop(key, None)
            continue

        if force_keys and key in force_keys:
            out.append(("update", _finalize_pending_update(entry, now_ts)))
            pending_updates.pop(key, None)
            continue

        first_ts = int(entry.get("first_ts") or now_ts)
        last_ts = int(entry.get("last_ts") or now_ts)
        quiet_enough = (now_ts - last_ts) >= debounce_sec
        held_too_long = (now_ts - first_ts) >= max_hold_sec
        if quiet_enough or held_too_long:
            out.append(("update", _finalize_pending_update(entry, now_ts)))
            pending_updates.pop(key, None)

    return out


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
    wallet_alias: Optional[str],
    pos: Dict[str, Any],
    now_utc: str,
) -> str:
    title = pos.get("title") or "Unknown market"
    outcome = pos.get("outcome") or "Unknown"
    market_url = _market_url(pos)

    lines: List[str] = []
    if change_type == "new":
        lines.append("🆕 新开仓位")
    elif change_type == "closed":
        lines.append("❌ 仓位关闭")
    else:
        agg_count = int(pos.get("agg_count") or 1)
        if agg_count > 1:
            lines.append("🔁 连续仓位变动汇总")
        else:
            lines.append("🔄 仓位更新")

    wallet_label = _short(wallet)
    if wallet_alias:
        wallet_label = f"{wallet_alias} ({wallet_label})"
    lines.append(f"钱包: {wallet_label}")
    lines.append(f"市场: {title}")
    if market_url:
        # Keep raw URL on its own line so Telegram can generate link preview.
        lines.append(f"链接: {market_url}")

    lines.append(f"买入方向: {outcome}")

    if change_type == "update":
        old_size = _safe_float(pos.get("old_size"))
        now_size = _safe_float(pos.get("size"))
        delta = _safe_float(pos.get("size_delta"))
        lines.append(f"持有数量: {old_size:.3f} -> {now_size:.3f} (Δ {delta:+.3f})")
        agg_count = int(pos.get("agg_count") or 1)
        if agg_count > 1:
            span_sec = int(_safe_float(pos.get("agg_span_sec")))
            lines.append(f"变动次数: {agg_count} 次 | 聚合窗口: {span_sec}s")
    else:
        lines.append(f"持有数量: {_safe_float(pos.get('size')):.3f}")

    avg_price = _safe_float(pos.get("avg_price"))
    old_avg_price = _safe_float(pos.get("old_avg_price"))
    agg_count = int(pos.get("agg_count") or 1)
    if change_type == "update" and agg_count > 1:
        if _should_show_avg_price(old_avg_price) or _should_show_avg_price(avg_price):
            lines.append(f"建仓均价: {_fmt_price(old_avg_price)} -> {_fmt_price(avg_price)}")
    elif _should_show_avg_price(avg_price):
        lines.append(f"建仓均价: {_fmt_price(avg_price)}")
    lines.append(f"当前价值: {_fmt_usd(_safe_float(pos.get('position_value')))}")

    pnl = _safe_float(pos.get("cash_pnl"))
    pnl_pct = _safe_float(pos.get("percent_pnl"))
    lines.append(f"盈亏: {_fmt_usd(pnl)} ({_fmt_pct(pnl_pct)})")
    lines.append(f"时间: {now_utc}")
    return "\n".join(lines)


def _build_message(
    wallet: str,
    changes: List[Tuple[str, Dict[str, Any]]],
    max_changes: int,
    wallet_alias: Optional[str] = None,
) -> str:
    now_bj = (
        datetime.now(timezone.utc)
        .astimezone(ZoneInfo("Asia/Shanghai"))
        .strftime("%Y-%m-%d %H:%M:%S")
    )
    shown = changes[:max_changes]
    lines = [f"🚨 钱包异动监控 ({len(changes)} 个异动):", ""]

    for idx, (change_type, pos) in enumerate(shown):
        lines.append(
            _format_change_block(
                change_type,
                wallet,
                wallet_alias,
                pos,
                f"{now_bj} 北京时间",
            )
        )
        if idx != len(shown) - 1:
            lines.append("")

    if len(changes) > max_changes:
        lines.append("")
        lines.append(f"... 以及其他 {len(changes) - max_changes} 个异动")

    return "\n".join(lines)


def _filter_changes_by_position_value(
    *,
    wallet: str,
    changes: List[Tuple[str, Dict[str, Any]]],
    min_position_value_usd: float,
    exempt_wallets: set[str],
) -> List[Tuple[str, Dict[str, Any]]]:
    if min_position_value_usd <= 0:
        return changes
    if wallet in exempt_wallets:
        return changes

    out: List[Tuple[str, Dict[str, Any]]] = []
    for change_type, pos in changes:
        value = _safe_float(pos.get("position_value"))
        if value >= min_position_value_usd:
            out.append((change_type, pos))
        else:
            logger.info(
                "wallet activity skipped by position value floor user={} change={} value={:.2f} floor={:.2f} market={}",
                wallet,
                change_type,
                value,
                min_position_value_usd,
                str(pos.get("title") or ""),
            )
    return out


def start_polymarket_wallet_activity_loop(bot: Any) -> Optional[threading.Thread]:
    enabled = _env_bool("POLYMARKET_WALLET_ACTIVITY_ENABLED", False)
    chat_ids = get_telegram_chat_ids_from_env()
    users = _parse_addresses(os.getenv("POLYMARKET_WALLET_ACTIVITY_USERS"))
    user_aliases = _parse_address_aliases(
        os.getenv("POLYMARKET_WALLET_ACTIVITY_USER_ALIASES")
        or os.getenv("POLYMARKET_WALLET_ACTIVITY_USERS_ALIASES")
    )
    exempt_wallets = _parse_address_set(
        os.getenv("POLYMARKET_WALLET_ACTIVITY_MIN_VALUE_EXEMPT_USERS")
    )

    if not enabled:
        logger.info("polymarket wallet activity watcher disabled")
        return None
    if not chat_ids:
        logger.warning("polymarket wallet activity watcher skipped: TELEGRAM_CHAT_IDS is not set")
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
    min_avg_price_delta = max(
        0.0,
        _env_float("POLYMARKET_WALLET_ACTIVITY_MIN_AVG_PRICE_DELTA", 0.002),
    )
    immediate_on_size_delta = _env_bool(
        "POLYMARKET_WALLET_ACTIVITY_IMMEDIATE_ON_SIZE_DELTA",
        True,
    )
    immediate_size_delta_min = max(
        min_size_delta,
        _env_float(
            "POLYMARKET_WALLET_ACTIVITY_IMMEDIATE_SIZE_DELTA_MIN",
            min_size_delta,
        ),
    )
    immediate_cooldown_sec = max(
        0,
        _env_int("POLYMARKET_WALLET_ACTIVITY_IMMEDIATE_COOLDOWN_SEC", 20),
    )
    max_changes = max(1, _env_int("POLYMARKET_WALLET_ACTIVITY_MAX_CHANGES_PER_MSG", 5))
    min_position_value_usd = max(
        0.0, _env_float("POLYMARKET_WALLET_ACTIVITY_MIN_POSITION_VALUE_USD", 0.0)
    )
    notify_closed = _env_bool("POLYMARKET_WALLET_ACTIVITY_NOTIFY_CLOSED", False)
    bootstrap_alert = _env_bool("POLYMARKET_WALLET_ACTIVITY_BOOTSTRAP_ALERT", False)
    link_preview = _env_bool("POLYMARKET_WALLET_ACTIVITY_LINK_PREVIEW", True)
    default_debounce_sec = max(poll_sec, 30)
    update_debounce_sec = max(
        poll_sec,
        _env_int("POLYMARKET_WALLET_ACTIVITY_UPDATE_DEBOUNCE_SEC", default_debounce_sec),
    )
    default_update_max_hold_sec = max(update_debounce_sec, 120)
    update_max_hold_sec = max(
        update_debounce_sec,
        _env_int("POLYMARKET_WALLET_ACTIVITY_UPDATE_MAX_HOLD_SEC", default_update_max_hold_sec),
    )

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
            f"poll={poll_sec}s data_api={data_api_url} price_filter={min_price}-{max_price} "
            f"min_position_value_usd={min_position_value_usd} "
            f"min_value_exempt_users={len(exempt_wallets)} "
            f"chat_targets={len(chat_ids)} "
            f"aliases={len(user_aliases)} link_preview={link_preview} "
            f"min_avg_price_delta={min_avg_price_delta} "
            f"immediate_on_size_delta={immediate_on_size_delta} "
            f"immediate_size_delta_min={immediate_size_delta_min} "
            f"immediate_cooldown={immediate_cooldown_sec}s "
            f"update_debounce={update_debounce_sec}s update_max_hold={update_max_hold_sec}s"
        )

        while True:
            cycle_started = time.time()
            touched = False
            for user in users:
                try:
                    now_ts = int(time.time())
                    rows = _fetch_positions(
                        session=session,
                        base_url=data_api_url,
                        user=user,
                        timeout_sec=timeout_sec,
                    )
                    current = _build_snapshot(rows, min_size_abs=min_size_abs)

                    user_state = users_state.get(user) if isinstance(users_state.get(user), dict) else {}
                    prev = (user_state.get("positions") if isinstance(user_state, dict) else {}) or {}
                    if not isinstance(prev, dict):
                        prev = {}
                    pending_updates = (
                        user_state.get("pending_updates") if isinstance(user_state, dict) else {}
                    ) or {}
                    if not isinstance(pending_updates, dict):
                        pending_updates = {}
                    update_push_meta = (
                        user_state.get("update_push_meta") if isinstance(user_state, dict) else {}
                    ) or {}
                    if not isinstance(update_push_meta, dict):
                        update_push_meta = {}
                    initialized = bool(user_state.get("initialized")) if isinstance(user_state, dict) else False

                    # First cycle for each wallet only initializes baseline unless bootstrap alert is enabled.
                    if not initialized:
                        if not bootstrap_alert:
                            users_state[user] = {
                                "positions": current,
                                "pending_updates": {},
                                "update_push_meta": {},
                                "initialized": True,
                                "updated_at": now_ts,
                            }
                            touched = True
                            continue
                        prev = {}

                    changes = _diff_positions(
                        previous=prev,
                        current=current,
                        min_size_delta=min_size_delta,
                        notify_closed=notify_closed,
                        min_price=min_price,
                        max_price=max_price,
                        min_avg_price_delta=min_avg_price_delta,
                    )

                    outgoing: List[Tuple[str, Dict[str, Any]]] = []
                    for change_type, pos in changes:
                        pos_key = _position_key(pos)
                        if change_type == "update":
                            size_delta_abs = abs(_safe_float(pos.get("size_delta")))
                            if (
                                immediate_on_size_delta
                                and size_delta_abs >= immediate_size_delta_min
                            ):
                                last_push_ts = int(update_push_meta.get(pos_key) or 0)
                                if now_ts - last_push_ts >= immediate_cooldown_sec:
                                    outgoing.extend(
                                        _flush_ready_pending_updates(
                                            pending_updates=pending_updates,
                                            now_ts=now_ts,
                                            debounce_sec=update_debounce_sec,
                                            max_hold_sec=update_max_hold_sec,
                                            force_keys={pos_key},
                                        )
                                    )
                                    outgoing.append((change_type, pos))
                                    update_push_meta[pos_key] = now_ts
                                    continue

                            _merge_pending_update(
                                pending_updates=pending_updates,
                                pos_key=pos_key,
                                pos=pos,
                                now_ts=now_ts,
                            )
                            continue

                        outgoing.extend(
                            _flush_ready_pending_updates(
                                pending_updates=pending_updates,
                                now_ts=now_ts,
                                debounce_sec=update_debounce_sec,
                                max_hold_sec=update_max_hold_sec,
                                force_keys={pos_key},
                            )
                        )
                        outgoing.append((change_type, pos))

                    # If a key disappeared from snapshot, flush pending summary now.
                    missing_keys = {k for k in pending_updates.keys() if k not in current}
                    if missing_keys:
                        outgoing.extend(
                            _flush_ready_pending_updates(
                                pending_updates=pending_updates,
                                now_ts=now_ts,
                                debounce_sec=update_debounce_sec,
                                max_hold_sec=update_max_hold_sec,
                                force_keys=missing_keys,
                            )
                        )
                        for missing_key in missing_keys:
                            update_push_meta.pop(missing_key, None)

                    outgoing.extend(
                        _flush_ready_pending_updates(
                            pending_updates=pending_updates,
                            now_ts=now_ts,
                            debounce_sec=update_debounce_sec,
                            max_hold_sec=update_max_hold_sec,
                        )
                    )

                    outgoing = _filter_changes_by_position_value(
                        wallet=user,
                        changes=outgoing,
                        min_position_value_usd=min_position_value_usd,
                        exempt_wallets=exempt_wallets,
                    )

                    if outgoing:
                        msg = _build_message(
                            user,
                            outgoing,
                            max_changes=max_changes,
                            wallet_alias=user_aliases.get(user),
                        )
                        sent_count = 0
                        for chat_id in chat_ids:
                            try:
                                bot.send_message(
                                    chat_id,
                                    msg,
                                    disable_web_page_preview=not link_preview,
                                )
                                sent_count += 1
                            except Exception as exc:
                                logger.warning(
                                    "wallet activity push failed user={} chat_id={} error={}",
                                    user,
                                    chat_id,
                                    exc,
                                )
                        if sent_count <= 0:
                            continue
                        logger.info(
                            f"wallet activity pushed user={user} changes={len(outgoing)} chat_targets={sent_count}"
                        )

                    users_state[user] = {
                        "positions": current,
                        "pending_updates": pending_updates,
                        "update_push_meta": update_push_meta,
                        "initialized": True,
                        "updated_at": now_ts,
                    }
                    touched = True
                except Exception:
                    logger.exception(f"wallet activity cycle failed user={user}")

            if touched:
                try:
                    _save_state(state_path, state)
                except Exception:
                    logger.exception("failed to save wallet activity state")

            elapsed = time.time() - cycle_started
            sleep_sec = max(0.0, poll_sec - elapsed)
            time.sleep(sleep_sec)

    thread = threading.Thread(
        target=_runner,
        name="polymarket-wallet-activity-watcher",
        daemon=True,
    )
    thread.start()
    return thread
