import json
import os
import threading
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Set, Tuple

from loguru import logger
from web3 import Web3

TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
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


def _parse_addresses(raw: Optional[str]) -> Set[str]:
    out: Set[str] = set()
    if not raw:
        return out
    for part in raw.split(","):
        addr = part.strip().lower()
        if addr and addr.startswith("0x") and len(addr) == 42:
            out.add(addr)
    return out


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


def _safe_lower(value: Any) -> str:
    if value is None:
        return ""
    return str(value).lower()


def _extract_transfer_events(
    w3: Web3,
    receipt: Any,
    watch_set: Set[str],
    token_meta_cache: Dict[str, Tuple[str, int]],
) -> List[str]:
    lines: List[str] = []
    for log in receipt.logs or []:
        try:
            if not log.topics or len(log.topics) < 3:
                continue
            topic0 = log.topics[0].hex().lower()
            if topic0 != TRANSFER_TOPIC:
                continue

            from_addr = "0x" + log.topics[1].hex()[-40:]
            to_addr = "0x" + log.topics[2].hex()[-40:]
            from_addr = from_addr.lower()
            to_addr = to_addr.lower()
            if from_addr not in watch_set and to_addr not in watch_set:
                continue

            token_addr = _safe_lower(log.address)
            symbol, decimals = token_meta_cache.get(token_addr, ("ERC20", 18))
            if token_addr not in token_meta_cache:
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

            amount_int = int(log.data.hex(), 16) if log.data else 0
            amount = Decimal(amount_int) / (Decimal(10) ** Decimal(max(decimals, 0)))
            amount_txt = f"{amount.normalize():f}".rstrip("0").rstrip(".") if amount else "0"

            direction = "IN" if to_addr in watch_set and from_addr not in watch_set else "OUT"
            if from_addr in watch_set and to_addr in watch_set:
                direction = "SELF"

            lines.append(
                f"- {direction} {symbol}: {amount_txt} ({_short(from_addr)} -> {_short(to_addr)})"
            )
        except Exception:
            continue
    return lines


def _build_message(
    tx: Any,
    block_ts: int,
    matched_wallet: str,
    transfer_lines: List[str],
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

    lines = [
        "⛓ Polygon 钱包异动",
        f"钱包: {_short(matched_wallet)}",
        f"方向: {direction}",
        f"MATIC: {_format_matic(matic_value)}",
        f"区块: {tx.get('blockNumber')}",
        f"时间: {block_time}",
        f"Tx: {tx_hash}",
    ]

    if transfer_lines:
        lines.append("Token 转账:")
        lines.extend(transfer_lines[:6])

    lines.append(f"交易链接: {_polygon_scan_tx_url(tx_hash)}")
    lines.append(f"钱包链接: {_polygon_scan_addr_url(matched_wallet)}")
    return "\n".join(lines)


def start_polygon_wallet_watch_loop(bot: Any) -> Optional[threading.Thread]:
    enabled = _env_bool("POLYGON_WALLET_WATCH_ENABLED", False)
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    rpc_url = os.getenv("POLYGON_RPC_URL")
    watch_set = _parse_addresses(os.getenv("POLYGON_WALLET_WATCH_ADDRESSES"))

    if not enabled:
        logger.info("polygon wallet watcher disabled")
        return None
    if not chat_id:
        logger.warning("polygon wallet watcher skipped: TELEGRAM_CHAT_ID is not set")
        return None
    if not rpc_url:
        logger.warning("polygon wallet watcher skipped: POLYGON_RPC_URL is not set")
        return None
    if not watch_set:
        logger.warning("polygon wallet watcher skipped: POLYGON_WALLET_WATCH_ADDRESSES is empty")
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
            f"poll={poll_sec}s confirmations={confirmations} state_path={state_path}"
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

                        transfer_lines: List[str] = []
                        try:
                            receipt = w3.eth.get_transaction_receipt(tx["hash"])
                            transfer_lines = _extract_transfer_events(
                                w3=w3,
                                receipt=receipt,
                                watch_set=watch_set,
                                token_meta_cache=token_meta_cache,
                            )
                        except Exception:
                            transfer_lines = []

                        message = _build_message(
                            tx=tx,
                            block_ts=block_ts,
                            matched_wallet=matched_wallet,
                            transfer_lines=transfer_lines,
                        )
                        bot.send_message(chat_id, message, disable_web_page_preview=True)
                        state.setdefault("seen_tx", {})[tx_hash] = cycle_ts
                        logger.info(
                            f"polygon wallet alert pushed wallet={matched_wallet} "
                            f"tx={tx_hash} block={block_num}"
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
