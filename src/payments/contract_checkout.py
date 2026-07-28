from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional

from web3 import Web3
from eth_account import Account  # noqa: F401 — used by test monkeypatches


from src.auth.supabase_entitlement import SUPABASE_ENTITLEMENT  # noqa: F401 — used by test monkeypatches

from src.database.db_manager import DBManager
from src.payments.chain_config import (
    DEFAULT_NATIVE_USDC_ADDRESS,
    DEFAULT_PLAN_CATALOG,
    DEFAULT_POINTS_MAX_DISCOUNT_BY_PLAN,
    DEFAULT_POLYGON_CHAIN_ID,
)
from src.payments.checkout.admin import AdminMixin
from src.payments.checkout.intent import IntentMixin
from src.payments.checkout.models import PaymentCheckoutError, PaymentIntentRecord, PaymentTokenConfig, WalletBindingRecord  # noqa: F401
from src.payments.checkout.rpc import RpcMixin
from src.payments.checkout.token import TokenMixin
from src.payments.checkout.tx import TxMixin
from src.payments.checkout.wallet import WalletMixin

def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _config_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    return default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except Exception:
        return default


def _normalize_address(address: Any) -> str:
    text = str(address or "").strip()
    if not text or not Web3.is_address(text):
        return ""
    return Web3.to_checksum_address(text).lower()


def _normalize_order_id_hex(order_id_hex: Any) -> str:
    text = str(order_id_hex or "").strip().lower()
    if not text:
        return ""
    if not text.startswith("0x"):
        text = f"0x{text}"
    if len(text) != 66:
        return ""
    try:
        int(text[2:], 16)
    except Exception:
        return ""
    return text


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _to_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _parse_decimal(value: Any, default: Decimal = Decimal("0")) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return default


def _decimal_to_units(amount: Decimal, decimals: int) -> int:
    q = Decimal(10) ** Decimal(max(0, int(decimals)))
    normalized = (amount * q).quantize(Decimal("1"))
    return int(normalized)


def _units_to_decimal(units: int, decimals: int) -> Decimal:
    q = Decimal(10) ** Decimal(max(0, int(decimals)))
    return Decimal(int(units)) / q


def _format_decimal(value: Decimal, places: int = 6) -> str:
    raw = f"{value:.{places}f}"
    return raw.rstrip("0").rstrip(".") or "0"


def _parse_plan_catalog(raw: str) -> Dict[str, Dict[str, Any]]:
    if not raw:
        return dict(DEFAULT_PLAN_CATALOG)
    try:
        parsed = json.loads(raw)
    except Exception:
        return dict(DEFAULT_PLAN_CATALOG)
    if not isinstance(parsed, dict):
        return dict(DEFAULT_PLAN_CATALOG)

    out: Dict[str, Dict[str, Any]] = {}
    for plan_code, row in parsed.items():
        code = str(plan_code or "").strip().lower()
        if not code or not isinstance(row, dict):
            continue
        plan_id = int(row.get("plan_id") or 0)
        duration_days = int(row.get("duration_days") or 0)
        amount_usdc = _parse_decimal(row.get("amount_usdc"), Decimal("0"))
        if plan_id <= 0 or duration_days <= 0 or amount_usdc <= 0:
            continue
        out[code] = {
            "plan_id": plan_id,
            "duration_days": duration_days,
            "amount_usdc": _format_decimal(amount_usdc),
        }
    return out or dict(DEFAULT_PLAN_CATALOG)


def _parse_allowed_plan_codes(raw: str) -> List[str]:
    text = str(raw or "").strip()
    if not text:
        return ["pro_monthly", "pro_quarterly"]
    out: List[str] = []
    for part in text.split(","):
        code = str(part or "").strip().lower()
        if code and code not in out:
            out.append(code)
    return out or ["pro_monthly", "pro_quarterly"]


def _parse_points_max_discount_by_plan(raw: str, fallback: int) -> Dict[str, int]:
    if not raw:
        return dict(DEFAULT_POINTS_MAX_DISCOUNT_BY_PLAN)
    try:
        parsed = json.loads(raw)
    except Exception:
        return dict(DEFAULT_POINTS_MAX_DISCOUNT_BY_PLAN)
    if not isinstance(parsed, dict):
        return dict(DEFAULT_POINTS_MAX_DISCOUNT_BY_PLAN)

    out: Dict[str, int] = {}
    for plan_code, raw_value in parsed.items():
        code = str(plan_code or "").strip().lower()
        if not code:
            continue
        try:
            value = int(raw_value)
        except Exception:
            value = fallback
        out[code] = max(0, value)
    return out or dict(DEFAULT_POINTS_MAX_DISCOUNT_BY_PLAN)

class PaymentContractCheckoutService(RpcMixin, TokenMixin, WalletMixin, IntentMixin, TxMixin, AdminMixin):

    def __init__(self):
        self.enabled = _env_bool("POLYWEATHER_PAYMENT_ENABLED", False)
        self.supabase_url = str(os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
        self.supabase_service_role_key = str(
            os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
        ).strip()
        self.chain_id = _env_int(
            "POLYWEATHER_PAYMENT_CHAIN_ID", DEFAULT_POLYGON_CHAIN_ID
        )
        self.token_decimals = _env_int("POLYWEATHER_PAYMENT_TOKEN_DECIMALS", 6)
        self.rpc_url = str(os.getenv("POLYWEATHER_PAYMENT_RPC_URL") or "").strip()
        self.rpc_urls = self._load_rpc_urls(
            os.getenv("POLYWEATHER_PAYMENT_RPC_URLS") or self.rpc_url
        )
        legacy_receiver_contract = _normalize_address(
            os.getenv("POLYWEATHER_PAYMENT_RECEIVER_CONTRACT") or ""
        )
        legacy_direct_receiver_address = (
            _normalize_address(
                os.getenv("POLYWEATHER_PAYMENT_DIRECT_RECEIVER_ADDRESS") or ""
            )
            or legacy_receiver_contract
        )
        legacy_token_address = (
            os.getenv("POLYWEATHER_PAYMENT_TOKEN_ADDRESS")
            or DEFAULT_NATIVE_USDC_ADDRESS
        )
        self.supported_tokens = self._load_supported_tokens(
            os.getenv("POLYWEATHER_PAYMENT_ACCEPTED_TOKENS_JSON") or "",
            fallback_receiver_contract=legacy_receiver_contract,
            fallback_direct_receiver_address=legacy_direct_receiver_address,
            fallback_token_address=legacy_token_address,
            fallback_token_decimals=self.token_decimals,
        )
        self.default_token_key = next(
            (
                key
                for key, token in self.supported_tokens.items()
                if bool(token.is_default)
            ),
            "",
        )
        if not self.default_token_key and self.supported_tokens:
            self.default_token_key = next(iter(self.supported_tokens.keys()))
        default_token = self.supported_tokens.get(self.default_token_key)
        self.default_chain_id = int(default_token.chain_id) if default_token else self.chain_id
        self.default_token_address = default_token.address if default_token else ""
        self.token_address = default_token.address if default_token else ""
        self.receiver_contract = (
            default_token.receiver_contract if default_token else ""
        )
        self.direct_receiver_address = (
            default_token.direct_receiver_address if default_token else ""
        )
        self.token_decimals = (
            int(default_token.decimals) if default_token else int(self.token_decimals)
        )
        self.rpc_urls_by_chain = self._load_rpc_urls_by_chain(
            os.getenv("POLYWEATHER_PAYMENT_RPC_URLS_BY_CHAIN_JSON") or "",
            default_chain_id=self.chain_id,
            default_rpc_urls=self.rpc_urls,
        )
        for token in self.supported_tokens.values():
            if token.rpc_urls:
                self.rpc_urls_by_chain.setdefault(int(token.chain_id), [])
                for rpc_url in token.rpc_urls:
                    if rpc_url not in self.rpc_urls_by_chain[int(token.chain_id)]:
                        self.rpc_urls_by_chain[int(token.chain_id)].append(rpc_url)
        self.intent_ttl_sec = max(
            300, _env_int("POLYWEATHER_PAYMENT_INTENT_TTL_SEC", 1800)
        )
        self.challenge_ttl_sec = max(
            60, _env_int("POLYWEATHER_PAYMENT_WALLET_CHALLENGE_TTL_SEC", 600)
        )
        self.confirmations = max(1, _env_int("POLYWEATHER_PAYMENT_CONFIRMATIONS", 2))
        self.timeout_sec = max(5, _env_int("POLYWEATHER_PAYMENT_HTTP_TIMEOUT_SEC", 10))
        self.poll_interval_sec = max(
            2, _env_int("POLYWEATHER_PAYMENT_POLL_INTERVAL_SEC", 4)
        )
        self.max_wait_sec = max(10, _env_int("POLYWEATHER_PAYMENT_MAX_WAIT_SEC", 50))
        self.plan_catalog = _parse_plan_catalog(
            os.getenv("POLYWEATHER_PAYMENT_PLAN_CATALOG_JSON") or ""
        )
        self.allowed_plan_codes = _parse_allowed_plan_codes(
            os.getenv("POLYWEATHER_PAYMENT_ALLOWED_PLAN_CODES") or ""
        )
        filtered_catalog = {
            code: row
            for code, row in self.plan_catalog.items()
            if code in self.allowed_plan_codes
        }
        if filtered_catalog:
            self.plan_catalog = filtered_catalog
        elif "pro_monthly" in self.plan_catalog:
            self.plan_catalog = {"pro_monthly": self.plan_catalog["pro_monthly"]}
        elif self.plan_catalog:
            first_code = sorted(self.plan_catalog.keys())[0]
            self.plan_catalog = {first_code: self.plan_catalog[first_code]}
        self.notify_telegram = _env_bool(
            "POLYWEATHER_PAYMENT_TELEGRAM_NOTIFY_ENABLED", True
        )
        self.telegram_payment_pricing_enabled = _env_bool(
            "POLYWEATHER_PAYMENT_TELEGRAM_PRICING_ENABLED",
            True,
        )
        self.points_enabled = _env_bool("POLYWEATHER_PAYMENT_POINTS_ENABLED", True)
        self.points_per_usdc = max(
            1, _env_int("POLYWEATHER_PAYMENT_POINTS_PER_USDC", 500)
        )
        self.points_max_discount_usdc = max(
            0, _env_int("POLYWEATHER_PAYMENT_POINTS_MAX_DISCOUNT_USDC", 3)
        )
        self.points_max_discount_usdc_by_plan = _parse_points_max_discount_by_plan(
            os.getenv("POLYWEATHER_PAYMENT_POINTS_MAX_DISCOUNT_USDC_BY_PLAN_JSON")
            or "",
            self.points_max_discount_usdc,
        )
        self._w3_lock = threading.Lock()
        self._w3: Optional[Web3] = None
        self._w3_url: str = ""
        self._w3_by_chain: Dict[int, Web3] = {}
        self._w3_url_by_chain: Dict[int, str] = {}
        self._event_topic = Web3.keccak(
            text="OrderPaid(bytes32,address,uint256,address,uint256)"
        ).hex()
        self._db = DBManager()

    @property
    def configured(self) -> bool:
        has_valid_token_routes = bool(
            self.supported_tokens
            and all(
                token.address
                and token.direct_receiver_address
                and (token.receiver_contract or token.supports_direct_transfer)
                for token in self.supported_tokens.values()
            )
        )
        has_rpc_for_token_chains = bool(
            self.supported_tokens
            and all(
                bool(self.rpc_urls_by_chain.get(int(token.chain_id)))
                for token in self.supported_tokens.values()
            )
        )
        return bool(
            self.supabase_url
            and self.supabase_service_role_key
            and has_rpc_for_token_chains
            and has_valid_token_routes
        )

    def _ensure_enabled(self) -> None:
        if not self.enabled:
            raise PaymentCheckoutError(503, "payment feature disabled")
        if not self.configured:
            raise PaymentCheckoutError(
                503,
                (
                    "payment feature not configured: require SUPABASE + RPC + "
                    "POLYWEATHER_PAYMENT_ACCEPTED_TOKENS_JSON"
                ),
            )


    def get_config_payload(self) -> Dict[str, Any]:
        default_chain_id = int(self.default_chain_id or self.chain_id)
        chains_payload = [
            {
                "chain_id": chain_id,
                "code": self._chain_code_for(chain_id),
                "name": self._chain_name_for(chain_id),
                "native_currency_symbol": self._native_currency_for(chain_id),
                "block_explorer_url": self._explorer_base_for(chain_id),
                "explorer_tx_url": self._explorer_tx_url_for(chain_id),
                "is_default": chain_id == default_chain_id,
            }
            for chain_id in self._chain_ids()
        ]
        tokens_payload = [
            {
                "code": token.code,
                "symbol": token.symbol,
                "name": token.name,
                "address": token.address,
                "decimals": int(token.decimals),
                "chain_id": int(token.chain_id),
                "chain_code": token.chain_code,
                "chain_name": token.chain_name,
                "receiver_contract": token.receiver_contract,
                "direct_receiver_address": token.direct_receiver_address,
                "explorer_tx_url": token.explorer_tx_url,
                "supports_contract_checkout": bool(token.supports_contract_checkout),
                "supports_direct_transfer": bool(token.supports_direct_transfer),
                "is_default": bool(
                    token.is_default
                    or self._token_key(token.chain_id, token.address)
                    == self.default_token_key
                ),
            }
            for token in sorted(
                self.supported_tokens.values(),
                key=lambda row: (int(row.chain_id), row.code),
            )
        ]
        return {
            "enabled": self.enabled,
            "configured": self.configured,
            "chain_id": default_chain_id,
            "default_chain_id": default_chain_id,
            "token_address": self.token_address,
            "token_decimals": self.token_decimals,
            "receiver_contract": self.receiver_contract,
            "direct_receiver_address": self.direct_receiver_address,
            "default_token_address": self.default_token_address or self.token_address,
            "chains": chains_payload,
            "tokens": tokens_payload,
            "confirmations": self.confirmations,
            "intent_ttl_sec": self.intent_ttl_sec,
            "event_name": "OrderPaid",
            "event_topic0": self._event_topic,
            "points_redemption": {
                "enabled": bool(self.points_enabled),
                "points_per_usdc": int(self.points_per_usdc),
                "max_discount_usdc": int(self.points_max_discount_usdc),
                "max_discount_usdc_by_plan": {
                    str(plan_code): int(self._points_max_discount_for_plan(plan_code))
                    for plan_code in sorted(self.plan_catalog.keys())
                },
            },
            "plans": [
                {
                    "plan_code": plan_code,
                    "plan_id": int(row.get("plan_id") or 0),
                    "amount_usdc": str(row.get("amount_usdc")),
                    "duration_days": int(row.get("duration_days") or 0),
                }
                for plan_code, row in sorted(self.plan_catalog.items())
            ],
        }



PAYMENT_CHECKOUT = PaymentContractCheckoutService()
