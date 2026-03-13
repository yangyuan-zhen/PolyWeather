import json
import os
import threading
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Set, Tuple

from loguru import logger
from web3 import Web3

from src.utils.telegram_chat_ids import get_telegram_chat_ids_from_env

TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
APPROVAL_TOPIC = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925"
ERC20_ABI = [
    {
        "constant": True,
        "inputs": [],
        "name": "symbol",
        "outputs": [{"name": "", "type": "string"}],
        "type": "function",
    },
    {
        "constant": True,
        "inputs": [],
        "name": "decimals",
        "outputs": [{"name": "", "type": "uint8"}],
        "type": "function",
    },
]

# Source: Polymarket official developer docs (Polygon contract addresses)
# https://docs.polymarket.com/developers/market-makers/setup
DEFAULT_POLYMARKET_CONTRACTS: Dict[str, str] = {
    "USDC.e": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    "CTF": "0x4d97dcd97ec945f40cf65f87097ace5ea0476045",
    "CTF_EXCHANGE": "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
    "NEG_RISK_CTF_EXCHANGE": "0xC5d563A36AE78145C45a50134d48A1215220f80a",
    "NEG_RISK_ADAPTER": "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
}


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


def _short(addr: str, left: int = 6, right: int = 4) -> str:
    if not addr:
        return "unknown"
    if len(addr) <= left + right + 2:
        return addr
    return f"{addr[:left + 2]}...{addr[-right:]}"


def _state_file() -> str:
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(root, "data", "polygon_wallet_watch_state.json")


def _load_state(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        return {"last_scanned_block": 0, "seen_tx": {}}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            data.setdefault("last_scanned_block", 0)
            data.setdefault("seen_tx", {})
            return data
    except Exception as exc:
        logger.warning(f"failed to load polygon watch state: {exc}")
    return {"last_scanned_block": 0, "seen_tx": {}}


def _save_state(path: str, state: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def _cleanup_seen_tx(state: Dict[str, Any], now_ts: int, keep_sec: int) -> None:
    seen = state.get("seen_tx", {})
    if not isinstance(seen, dict):
        state["seen_tx"] = {}
        return
    stale = [key for key, value in seen.items() if now_ts - int(value or 0) > keep_sec]
    for tx_hash in stale:
        seen.pop(tx_hash, None)


def _normalize_addr(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip().lower()
    if text.startswith("0x") and len(text) == 42:
        return text
    return ""


def _parse_addresses(raw: Optional[str]) -> Set[str]:
    out: Set[str] = set()
    if not raw:
        return out
    for part in raw.split(","):
        addr = _normalize_addr(part)
        if addr:
            out.add(addr)
    return out


def _parse_polymarket_contracts(raw: Optional[str]) -> Dict[str, str]:
    """
    Parse env like:
    - "0xabc...,0xdef..."
    - "CTF:0xabc...,EXCHANGE:0xdef..."
    """
    result: Dict[str, str] = {}
    if not raw:
        return result
    for part in raw.split(","):
        segment = str(part).strip()
        if not segment:
            continue
        label = "CUSTOM_PM"
        address_part = segment
        if ":" in segment:
            maybe_label, maybe_addr = segment.split(":", 1)
            maybe_addr_n = _normalize_addr(maybe_addr)
            if maybe_addr_n:
                label = (maybe_label or "CUSTOM_PM").strip() or "CUSTOM_PM"
                address_part = maybe_addr_n
        addr = _normalize_addr(address_part)
        if not addr:
            continue
        if addr not in result:
            result[addr] = label
    return result


def _build_polymarket_contract_map() -> Dict[str, str]:
    include_defaults = _env_bool("POLYGON_WALLET_WATCH_INCLUDE_DEFAULT_PM_CONTRACTS", True)
    merged: Dict[str, str] = {}

    if include_defaults:
        for label, addr in DEFAULT_POLYMARKET_CONTRACTS.items():
            normalized = _normalize_addr(addr)
            if normalized:
                merged[normalized] = label

    custom = _parse_polymarket_contracts(os.getenv("POLYGON_WALLET_WATCH_POLYMARKET_CONTRACTS"))
    for addr, label in custom.items():
        merged[addr] = label

    return merged


def _polygon_scan_tx_url(tx_hash: str) -> str:
    base = os.getenv("POLYGON_WALLET_WATCH_TX_BASE") or "https://polygonscan.com/tx/"
    return f"{base.rstrip('/')}/{tx_hash}"


def _polygon_scan_addr_url(address: str) -> str:
    base = os.getenv("POLYGON_WALLET_WATCH_ADDR_BASE") or "https://polygonscan.com/address/"
    return f"{base.rstrip('/')}/{address}"


def _format_matic(wei_value: int) -> str:
    try:
        matic = Decimal(wei_value) / Decimal(10**18)
    except (InvalidOperation, ValueError):
        return "0"

    if matic == matic.to_integral_value():
        return f"{int(matic)}"
    return f"{matic.normalize():f}".rstrip("0").rstrip(".")


def _format_amount(amount: Decimal) -> str:
    if amount == amount.to_integral_value():
        return str(int(amount))
    return f"{amount.normalize():f}".rstrip("0").rstrip(".")


def _safe_lower(value: Any) -> str:
    if value is None:
        return ""
    return str(value).lower()


def _topic_to_addr(topic: Any) -> str:
    try:
        return _normalize_addr("0x" + topic.hex()[-40:])
    except Exception:
        return ""


def _get_token_meta(
    w3: Web3,
    token_addr: str,
    token_meta_cache: Dict[str, Tuple[str, int]],
) -> Tuple[str, int]:
    symbol, decimals = token_meta_cache.get(token_addr, ("ERC20", 18))
    if token_addr in token_meta_cache:
        return symbol, decimals

    try:
        token = w3.eth.contract(address=Web3.to_checksum_address(token_addr), abi=ERC20_ABI)
        symbol_raw = token.functions.symbol().call()
        decimals_raw = token.functions.decimals().call()
        symbol = str(symbol_raw or "ERC20")
        decimals = int(decimals_raw)
    except Exception:
        symbol = "ERC20"
        decimals = 18

    token_meta_cache[token_addr] = (symbol, decimals)
    return symbol, decimals


def _extract_receipt_signals(
    w3: Web3,
    receipt: Any,
    watch_set: Set[str],
    pm_contracts: Dict[str, str],
    token_meta_cache: Dict[str, Tuple[str, int]],
) -> Dict[str, Any]:
    transfer_lines: List[str] = []
    approval_lines: List[str] = []
    touched_labels: Set[str] = set()
    pm_hit = False

    for log in receipt.logs or []:
        try:
            log_addr = _normalize_addr(log.address)
            if log_addr in pm_contracts:
                pm_hit = True
                touched_labels.add(pm_contracts[log_addr])

            topics = log.topics or []
            if not topics:
                continue
            topic0 = topics[0].hex().lower()

            if topic0 == TRANSFER_TOPIC and len(topics) >= 3:
                from_addr = _topic_to_addr(topics[1])
                to_addr = _topic_to_addr(topics[2])
                if from_addr not in watch_set and to_addr not in watch_set:
                    continue

                other_addr = to_addr if from_addr in watch_set else from_addr
                other_label = pm_contracts.get(other_addr)
                if other_label:
                    pm_hit = True
                    touched_labels.add(other_label)

                symbol, decimals = _get_token_meta(w3, log_addr, token_meta_cache)
                amount_int = int(log.data.hex(), 16) if log.data else 0
                amount = Decimal(amount_int) / (Decimal(10) ** Decimal(max(decimals, 0)))

                if from_addr in watch_set and to_addr in watch_set:
                    direction = "SELF"
                elif to_addr in watch_set:
                    direction = "IN"
                else:
                    direction = "OUT"

                # Keep transfer line only when it is clearly Polymarket related.
                if other_label or log_addr in pm_contracts:
                    target = other_label or pm_contracts.get(log_addr) or _short(other_addr)
                    transfer_lines.append(
                        f"- {direction} {symbol}: {_format_amount(amount)} (对手: {target})"
                    )

            if topic0 == APPROVAL_TOPIC and len(topics) >= 3:
                owner = _topic_to_addr(topics[1])
                spender = _topic_to_addr(topics[2])
                if owner not in watch_set:
                    continue
                spender_label = pm_contracts.get(spender)
                if not spender_label:
                    continue

                pm_hit = True
                touched_labels.add(spender_label)

                symbol, decimals = _get_token_meta(w3, log_addr, token_meta_cache)
                amount_int = int(log.data.hex(), 16) if log.data else 0
                amount = Decimal(amount_int) / (Decimal(10) ** Decimal(max(decimals, 0)))
                approval_lines.append(
                    f"- APPROVE {symbol}: {_format_amount(amount)} -> {spender_label}"
                )
        except Exception:
            continue

    return {
        "pm_hit": pm_hit,
        "transfer_lines": transfer_lines,
        "approval_lines": approval_lines,
        "touched_labels": sorted(touched_labels),
    }


def _build_message(
    tx: Any,
    block_ts: int,
    matched_wallet: str,
    touched_labels: List[str],
    transfer_lines: List[str],
    approval_lines: List[str],
    tx_to_label: Optional[str],
) -> str:
    tx_hash = tx["hash"].hex()
    from_addr = _safe_lower(tx.get("from"))
    to_addr = _safe_lower(tx.get("to"))

    if from_addr == matched_wallet and to_addr == matched_wallet:
        direction = "SELF"
    elif to_addr == matched_wallet:
        direction = "IN"
    elif from_addr == matched_wallet:
        direction = "OUT"
    else:
        direction = "RELATED"

    matic_value = int(tx.get("value", 0) or 0)
    block_time = datetime.fromtimestamp(block_ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    selector = str(tx.get("input") or "")[:10] if tx.get("input") else "0x"

    lines = [
        "⛓ Polymarket 钱包动作",
        f"钱包: {_short(matched_wallet)}",
        f"方向: {direction}",
        f"MATIC: {_format_matic(matic_value)}",
        f"区块: {tx.get('blockNumber')}",
        f"时间: {block_time}",
        f"方法选择器: {selector}",
    ]

    if tx_to_label:
        lines.append(f"直连合约: {tx_to_label}")

    if touched_labels:
        lines.append(f"相关合约: {', '.join(touched_labels)}")

    if transfer_lines:
        lines.append("Token 动作:")
        lines.extend(transfer_lines[:6])

    if approval_lines:
        lines.append("授权动作:")
        lines.extend(approval_lines[:4])

    lines.append(f"Tx: {tx_hash}")
    lines.append(f"交易链接: {_polygon_scan_tx_url(tx_hash)}")
    lines.append(f"钱包链接: {_polygon_scan_addr_url(matched_wallet)}")
    return "\n".join(lines)


def start_polygon_wallet_watch_loop(bot: Any) -> Optional[threading.Thread]:
    enabled = _env_bool("POLYGON_WALLET_WATCH_ENABLED", False)
    chat_ids = get_telegram_chat_ids_from_env()
    rpc_url = os.getenv("POLYGON_RPC_URL")
    watch_set = _parse_addresses(os.getenv("POLYGON_WALLET_WATCH_ADDRESSES"))
    polymarket_only = _env_bool("POLYGON_WALLET_WATCH_POLYMARKET_ONLY", True)
    pm_contracts = _build_polymarket_contract_map()

    if not enabled:
        logger.info("polygon wallet watcher disabled")
        return None
    if not chat_ids:
        logger.warning("polygon wallet watcher skipped: TELEGRAM_CHAT_IDS is not set")
        return None
    if not rpc_url:
        logger.warning("polygon wallet watcher skipped: POLYGON_RPC_URL is not set")
        return None
    if not watch_set:
        logger.warning("polygon wallet watcher skipped: POLYGON_WALLET_WATCH_ADDRESSES is empty")
        return None
    if polymarket_only and not pm_contracts:
        logger.warning("polygon wallet watcher skipped: no polymarket contracts configured")
        return None

    poll_sec = max(3, _env_int("POLYGON_WALLET_WATCH_INTERVAL_SEC", 8))
    confirmations = max(0, _env_int("POLYGON_WALLET_WATCH_CONFIRMATIONS", 2))
    max_blocks_per_cycle = max(1, _env_int("POLYGON_WALLET_WATCH_MAX_BLOCKS_PER_CYCLE", 30))
    seen_ttl_sec = max(3600, _env_int("POLYGON_WALLET_WATCH_SEEN_TTL_SEC", 7 * 86400))
    state_path = _state_file()

    provider_timeout = max(5, _env_int("POLYGON_WALLET_WATCH_RPC_TIMEOUT_SEC", 10))
    w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": provider_timeout}))

    def _runner() -> None:
        token_meta_cache: Dict[str, Tuple[str, int]] = {}
        state = _load_state(state_path)

        if not w3.is_connected():
            logger.error("polygon wallet watcher failed: cannot connect to POLYGON_RPC_URL")
            return

        try:
            chain_id = int(w3.eth.chain_id)
            if chain_id != 137:
                logger.warning(f"polygon wallet watcher connected to unexpected chain_id={chain_id}")
        except Exception as exc:
            logger.warning(f"polygon wallet watcher cannot read chain id: {exc}")

        latest_block = int(w3.eth.block_number)
        if int(state.get("last_scanned_block") or 0) <= 0:
            state["last_scanned_block"] = max(0, latest_block - confirmations)
            _save_state(state_path, state)

        logger.info(
            f"polygon wallet watcher started wallets={len(watch_set)} "
            f"polymarket_only={polymarket_only} pm_contracts={len(pm_contracts)} "
            f"poll={poll_sec}s confirmations={confirmations} chat_targets={len(chat_ids)} "
            f"state_path={state_path}"
        )

        while True:
            cycle_ts = int(time.time())
            try:
                _cleanup_seen_tx(state, cycle_ts, seen_ttl_sec)

                latest = int(w3.eth.block_number)
                safe_latest = latest - confirmations
                last_scanned = int(state.get("last_scanned_block") or 0)

                if safe_latest <= last_scanned:
                    time.sleep(poll_sec)
                    continue

                from_block = last_scanned + 1
                to_block = min(safe_latest, from_block + max_blocks_per_cycle - 1)

                for block_num in range(from_block, to_block + 1):
                    block = w3.eth.get_block(block_num, full_transactions=True)
                    block_ts = int(block.get("timestamp") or cycle_ts)

                    for tx in block.transactions or []:
                        tx_hash = tx["hash"].hex().lower()
                        from_addr = _safe_lower(tx.get("from"))
                        to_addr = _safe_lower(tx.get("to"))

                        matched_wallet = ""
                        if from_addr in watch_set:
                            matched_wallet = from_addr
                        elif to_addr in watch_set:
                            matched_wallet = to_addr

                        if not matched_wallet:
                            continue

                        if tx_hash in state.get("seen_tx", {}):
                            continue

                        tx_to = _normalize_addr(tx.get("to"))
                        tx_to_label = pm_contracts.get(tx_to)
                        pm_hit = bool(tx_to_label)
                        transfer_lines: List[str] = []
                        approval_lines: List[str] = []
                        touched_labels: List[str] = [tx_to_label] if tx_to_label else []

                        try:
                            receipt = w3.eth.get_transaction_receipt(tx["hash"])
                            parsed = _extract_receipt_signals(
                                w3=w3,
                                receipt=receipt,
                                watch_set=watch_set,
                                pm_contracts=pm_contracts,
                                token_meta_cache=token_meta_cache,
                            )
                            pm_hit = pm_hit or bool(parsed.get("pm_hit"))
                            transfer_lines = parsed.get("transfer_lines") or []
                            approval_lines = parsed.get("approval_lines") or []
                            touched = parsed.get("touched_labels") or []
                            touched_labels = sorted(set(touched_labels + touched))
                        except Exception:
                            transfer_lines = []
                            approval_lines = []

                        if polymarket_only and not pm_hit:
                            continue

                        message = _build_message(
                            tx=tx,
                            block_ts=block_ts,
                            matched_wallet=matched_wallet,
                            touched_labels=touched_labels,
                            transfer_lines=transfer_lines,
                            approval_lines=approval_lines,
                            tx_to_label=tx_to_label,
                        )
                        sent_count = 0
                        for chat_id in chat_ids:
                            try:
                                bot.send_message(
                                    chat_id,
                                    message,
                                    disable_web_page_preview=True,
                                )
                                sent_count += 1
                            except Exception as exc:
                                logger.warning(
                                    "polygon wallet alert push failed wallet={} chat_id={} error={}",
                                    matched_wallet,
                                    chat_id,
                                    exc,
                                )
                        if sent_count <= 0:
                            continue
                        state.setdefault("seen_tx", {})[tx_hash] = cycle_ts
                        logger.info(
                            f"polygon wallet alert pushed wallet={matched_wallet} "
                            f"tx={tx_hash} block={block_num} polymarket={pm_hit} chat_targets={sent_count}"
                        )

                    state["last_scanned_block"] = block_num
                    _save_state(state_path, state)

                time.sleep(1)
            except Exception:
                logger.exception("polygon wallet watcher cycle failed")
                time.sleep(poll_sec)

    thread = threading.Thread(
        target=_runner,
        name="polygon-wallet-watcher",
        daemon=True,
    )
    thread.start()
    return thread

