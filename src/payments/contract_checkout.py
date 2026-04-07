from __future__ import annotations

import json
import os
import secrets
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_FLOOR
from typing import Any, Dict, List, Optional

import requests
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3

from src.auth.supabase_entitlement import SUPABASE_ENTITLEMENT
from src.database.db_manager import DBManager

DEFAULT_POLYGON_CHAIN_ID = 137
DEFAULT_USDC_E_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"
DEFAULT_NATIVE_USDC_ADDRESS = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359"

PAYMENT_CONTRACT_ABI = [
    {
        "inputs": [
            {"internalType": "bytes32", "name": "orderId", "type": "bytes32"},
            {"internalType": "uint256", "name": "planId", "type": "uint256"},
            {"internalType": "uint256", "name": "amount", "type": "uint256"},
            {"internalType": "address", "name": "token", "type": "address"},
        ],
        "name": "pay",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "anonymous": False,
        "inputs": [
            {
                "indexed": True,
                "internalType": "bytes32",
                "name": "orderId",
                "type": "bytes32",
            },
            {
                "indexed": True,
                "internalType": "address",
                "name": "payer",
                "type": "address",
            },
            {
                "indexed": True,
                "internalType": "uint256",
                "name": "planId",
                "type": "uint256",
            },
            {
                "indexed": False,
                "internalType": "address",
                "name": "token",
                "type": "address",
            },
            {
                "indexed": False,
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256",
            },
        ],
        "name": "OrderPaid",
        "type": "event",
    },
]

DEFAULT_PLAN_CATALOG: Dict[str, Dict[str, Any]] = {
    "pro_monthly": {"plan_id": 101, "amount_usdc": "5", "duration_days": 30},
    "pro_quarterly": {"plan_id": 102, "amount_usdc": "79", "duration_days": 90},
    "pro_yearly": {"plan_id": 103, "amount_usdc": "279", "duration_days": 365},
}


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


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
        return ["pro_monthly"]
    out: List[str] = []
    for part in text.split(","):
        code = str(part or "").strip().lower()
        if code and code not in out:
            out.append(code)
    return out or ["pro_monthly"]


@dataclass
class WalletBindingRecord:
    chain_id: int
    address: str
    status: str
    is_primary: bool
    verified_at: Optional[str]


@dataclass
class PaymentTokenConfig:
    code: str
    symbol: str
    name: str
    address: str
    decimals: int
    receiver_contract: str
    is_default: bool


@dataclass
class PaymentIntentRecord:
    intent_id: str
    order_id_hex: str
    plan_code: str
    plan_id: int
    chain_id: int
    amount_units: int
    amount_usdc: str
    token_address: str
    token_decimals: int
    token_symbol: str
    receiver_address: str
    status: str
    payment_mode: str
    allowed_wallet: Optional[str]
    expires_at: str
    tx_hash: Optional[str]
    metadata: Dict[str, Any]


class PaymentCheckoutError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = int(status_code)
        self.detail = str(detail)
        super().__init__(self.detail)


class PaymentContractCheckoutService:
    def __init__(self):
        self.enabled = _env_bool("POLYWEATHER_PAYMENT_ENABLED", False)
        self.supabase_url = str(os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
        self.supabase_service_role_key = str(
            os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
        ).strip()
        self.chain_id = _env_int("POLYWEATHER_PAYMENT_CHAIN_ID", DEFAULT_POLYGON_CHAIN_ID)
        self.token_decimals = _env_int("POLYWEATHER_PAYMENT_TOKEN_DECIMALS", 6)
        self.rpc_url = str(os.getenv("POLYWEATHER_PAYMENT_RPC_URL") or "").strip()
        self.rpc_urls = self._load_rpc_urls(
            os.getenv("POLYWEATHER_PAYMENT_RPC_URLS") or self.rpc_url
        )
        legacy_receiver_contract = _normalize_address(
            os.getenv("POLYWEATHER_PAYMENT_RECEIVER_CONTRACT") or ""
        )
        legacy_token_address = _normalize_address(
            os.getenv("POLYWEATHER_PAYMENT_TOKEN_ADDRESS") or DEFAULT_USDC_E_ADDRESS
        )
        self.supported_tokens = self._load_supported_tokens(
            os.getenv("POLYWEATHER_PAYMENT_ACCEPTED_TOKENS_JSON") or "",
            fallback_receiver_contract=legacy_receiver_contract,
            fallback_token_address=legacy_token_address,
            fallback_token_decimals=self.token_decimals,
        )
        self.default_token_address = next(
            (
                address
                for address, token in self.supported_tokens.items()
                if bool(token.is_default)
            ),
            "",
        )
        if not self.default_token_address and self.supported_tokens:
            self.default_token_address = next(iter(self.supported_tokens.keys()))
        default_token = self.supported_tokens.get(self.default_token_address)
        self.token_address = default_token.address if default_token else ""
        self.receiver_contract = default_token.receiver_contract if default_token else ""
        self.token_decimals = (
            int(default_token.decimals) if default_token else int(self.token_decimals)
        )
        self.intent_ttl_sec = max(300, _env_int("POLYWEATHER_PAYMENT_INTENT_TTL_SEC", 1800))
        self.challenge_ttl_sec = max(
            60, _env_int("POLYWEATHER_PAYMENT_WALLET_CHALLENGE_TTL_SEC", 600)
        )
        self.confirmations = max(
            1, _env_int("POLYWEATHER_PAYMENT_CONFIRMATIONS", 2)
        )
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
        self.points_enabled = _env_bool("POLYWEATHER_PAYMENT_POINTS_ENABLED", True)
        self.points_per_usdc = max(1, _env_int("POLYWEATHER_PAYMENT_POINTS_PER_USDC", 500))
        self.points_max_discount_usdc = max(
            0, _env_int("POLYWEATHER_PAYMENT_POINTS_MAX_DISCOUNT_USDC", 3)
        )
        self._w3_lock = threading.Lock()
        self._w3: Optional[Web3] = None
        self._w3_url: str = ""
        self._event_topic = Web3.keccak(
            text="OrderPaid(bytes32,address,uint256,address,uint256)"
        ).hex()
        self._db = DBManager()

    @property
    def configured(self) -> bool:
        has_valid_token_routes = bool(
            self.supported_tokens
            and all(
                token.address and token.receiver_contract
                for token in self.supported_tokens.values()
            )
        )
        return bool(
            self.supabase_url
            and self.supabase_service_role_key
            and bool(self.rpc_urls)
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

    def _load_rpc_urls(self, raw: str) -> List[str]:
        out: List[str] = []
        for part in str(raw or "").split(","):
            url = str(part or "").strip()
            if url and url not in out:
                out.append(url)
        return out

    def _default_token_meta(self, address: str) -> Dict[str, str]:
        normalized = _normalize_address(address)
        if normalized == _normalize_address(DEFAULT_NATIVE_USDC_ADDRESS):
            return {"code": "usdc", "symbol": "USDC", "name": "Native USDC"}
        if normalized == _normalize_address(DEFAULT_USDC_E_ADDRESS):
            return {"code": "usdc_e", "symbol": "USDC.e", "name": "USDC.e (PoS)"}
        return {"code": "usdc_token", "symbol": "USDC", "name": "USDC"}

    def _to_token_config(
        self,
        row: Dict[str, Any],
        fallback_receiver_contract: str,
        fallback_token_decimals: int,
    ) -> Optional[PaymentTokenConfig]:
        if not isinstance(row, dict):
            return None
        address = _normalize_address(
            row.get("address") or row.get("token_address") or row.get("contract")
        )
        if not address:
            return None
        receiver_contract = _normalize_address(
            row.get("receiver_contract")
            or row.get("checkout_contract")
            or row.get("contract_address")
            or fallback_receiver_contract
        )
        if not receiver_contract:
            return None
        default_meta = self._default_token_meta(address)
        code = str(row.get("code") or default_meta["code"]).strip().lower()
        symbol = str(row.get("symbol") or default_meta["symbol"]).strip()
        name = str(row.get("name") or default_meta["name"]).strip()
        if not code:
            code = default_meta["code"]
        if not symbol:
            symbol = default_meta["symbol"]
        if not name:
            name = default_meta["name"]
        try:
            decimals = int(
                row.get("decimals")
                or row.get("token_decimals")
                or fallback_token_decimals
            )
        except Exception:
            decimals = int(fallback_token_decimals)
        decimals = max(0, decimals)
        is_default = bool(row.get("is_default"))
        return PaymentTokenConfig(
            code=code,
            symbol=symbol,
            name=name,
            address=address,
            decimals=decimals,
            receiver_contract=receiver_contract,
            is_default=is_default,
        )

    def _load_supported_tokens(
        self,
        raw: str,
        *,
        fallback_receiver_contract: str,
        fallback_token_address: str,
        fallback_token_decimals: int,
    ) -> Dict[str, PaymentTokenConfig]:
        parsed_rows: List[Dict[str, Any]] = []
        text = str(raw or "").strip()
        if text:
            try:
                parsed = json.loads(text)
            except Exception:
                parsed = None
            if isinstance(parsed, list):
                parsed_rows = [row for row in parsed if isinstance(row, dict)]
            elif isinstance(parsed, dict):
                if isinstance(parsed.get("tokens"), list):
                    parsed_rows = [
                        row for row in parsed.get("tokens") or [] if isinstance(row, dict)
                    ]
                else:
                    for key, value in parsed.items():
                        if isinstance(value, dict):
                            row = dict(value)
                            row.setdefault("code", str(key))
                            parsed_rows.append(row)

        out: Dict[str, PaymentTokenConfig] = {}
        for row in parsed_rows:
            token = self._to_token_config(
                row,
                fallback_receiver_contract=fallback_receiver_contract,
                fallback_token_decimals=fallback_token_decimals,
            )
            if not token:
                continue
            out[token.address] = token

        if out:
            return out

        fallback_address = _normalize_address(fallback_token_address)
        if not (fallback_address and fallback_receiver_contract):
            return {}
        fallback_meta = self._default_token_meta(fallback_address)
        fallback_token = PaymentTokenConfig(
            code=fallback_meta["code"],
            symbol=fallback_meta["symbol"],
            name=fallback_meta["name"],
            address=fallback_address,
            decimals=max(0, int(fallback_token_decimals)),
            receiver_contract=fallback_receiver_contract,
            is_default=True,
        )
        return {fallback_token.address: fallback_token}

    def _resolve_supported_token(
        self,
        token_address: Optional[str] = None,
    ) -> PaymentTokenConfig:
        normalized = _normalize_address(token_address or "")
        if normalized:
            token = self.supported_tokens.get(normalized)
            if token:
                return token
            available = ", ".join(
                f"{item.symbol}:{item.address}" for item in self.supported_tokens.values()
            )
            raise PaymentCheckoutError(
                400,
                f"token_address not supported: {normalized}. available={available}",
            )
        default_token = self.supported_tokens.get(self.default_token_address)
        if default_token:
            return default_token
        raise PaymentCheckoutError(503, "no supported payment token configured")

    def _token_decimals_for(self, token_address: str) -> int:
        token = self.supported_tokens.get(_normalize_address(token_address))
        if token:
            return int(token.decimals)
        return int(self.token_decimals)

    def _token_symbol_for(self, token_address: str) -> str:
        token = self.supported_tokens.get(_normalize_address(token_address))
        if token and token.symbol:
            return str(token.symbol)
        return "USDC"

    def _service_headers(self, prefer: Optional[str] = None) -> Dict[str, str]:
        headers = {
            "apikey": self.supabase_service_role_key,
            "Authorization": f"Bearer {self.supabase_service_role_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        return headers

    def _rest(
        self,
        method: str,
        table: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        payload: Optional[Any] = None,
        prefer: Optional[str] = None,
        allowed_status: Optional[List[int]] = None,
    ) -> Any:
        url = f"{self.supabase_url}/rest/v1/{table}"
        status_ok = allowed_status or [200, 201, 204]
        try:
            response = requests.request(
                method=method.upper(),
                url=url,
                params=params,
                json=payload,
                headers=self._service_headers(prefer=prefer),
                timeout=self.timeout_sec,
            )
        except Exception as exc:
            raise PaymentCheckoutError(503, f"supabase request failed: {exc}") from exc

        if response.status_code not in status_ok:
            detail = response.text[:350] if response.text else response.reason
            raise PaymentCheckoutError(
                502,
                f"supabase {method.upper()} {table} failed: {response.status_code} {detail}",
            )
        if not response.content:
            return None
        try:
            return response.json()
        except Exception:
            return None

    def _admin_auth_headers(self) -> Dict[str, str]:
        return {
            "apikey": self.supabase_service_role_key,
            "Authorization": f"Bearer {self.supabase_service_role_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _auth_admin_request(
        self,
        method: str,
        path: str,
        *,
        payload: Optional[Dict[str, Any]] = None,
        allowed_status: Optional[List[int]] = None,
    ) -> Any:
        url = f"{self.supabase_url}/auth/v1{path}"
        status_ok = allowed_status or [200]
        try:
            response = requests.request(
                method=method.upper(),
                url=url,
                json=payload,
                headers=self._admin_auth_headers(),
                timeout=self.timeout_sec,
            )
        except Exception as exc:
            raise PaymentCheckoutError(503, f"supabase auth request failed: {exc}") from exc
        if response.status_code not in status_ok:
            detail = response.text[:350] if response.text else response.reason
            raise PaymentCheckoutError(
                502,
                (
                    f"supabase auth {method.upper()} {path} failed: "
                    f"{response.status_code} {detail}"
                ),
            )
        if not response.content:
            return None
        try:
            return response.json()
        except Exception:
            return None

    def _extract_user_metadata(self, user_payload: Any) -> Dict[str, Any]:
        if not isinstance(user_payload, dict):
            return {}
        if isinstance(user_payload.get("user_metadata"), dict):
            return dict(user_payload.get("user_metadata") or {})
        user_obj = user_payload.get("user")
        if isinstance(user_obj, dict) and isinstance(user_obj.get("user_metadata"), dict):
            return dict(user_obj.get("user_metadata") or {})
        return {}

    def _extract_points_from_metadata(self, metadata: Dict[str, Any]) -> int:
        if not isinstance(metadata, dict):
            return 0
        for key in ("points", "total_points"):
            raw = metadata.get(key)
            if raw is None:
                continue
            try:
                return max(0, int(raw))
            except Exception:
                continue
        return 0

    def _resolve_points_balance(self, user_id: str) -> Dict[str, Any]:
        db_user = self._db.get_user_by_supabase_user_id(user_id)
        if db_user is not None:
            try:
                balance = max(0, int(db_user.get("points") or 0))
            except Exception:
                balance = 0
            return {"source": "bot_db", "balance": balance}

        user_obj = self._auth_admin_get_user(user_id)
        metadata = self._extract_user_metadata(user_obj)
        balance = self._extract_points_from_metadata(metadata)
        return {"source": "supabase_metadata", "balance": balance, "metadata": metadata}

    def _auth_admin_get_user(self, user_id: str) -> Dict[str, Any]:
        user_id_text = str(user_id or "").strip()
        if not user_id_text:
            raise PaymentCheckoutError(400, "user_id required")
        data = self._auth_admin_request(
            "GET",
            f"/admin/users/{user_id_text}",
            allowed_status=[200],
        )
        if isinstance(data, dict):
            user_obj = data.get("user")
            if isinstance(user_obj, dict):
                return user_obj
            return data
        return {}

    def _auth_admin_update_user_metadata(
        self,
        user_id: str,
        metadata: Dict[str, Any],
    ) -> Dict[str, Any]:
        user_id_text = str(user_id or "").strip()
        if not user_id_text:
            raise PaymentCheckoutError(400, "user_id required")
        payload = {"user_metadata": metadata or {}}
        data = self._auth_admin_request(
            "PUT",
            f"/admin/users/{user_id_text}",
            payload=payload,
            allowed_status=[200],
        )
        if isinstance(data, dict):
            user_obj = data.get("user")
            if isinstance(user_obj, dict):
                return user_obj
            return data
        return {}

    def _build_points_redemption(
        self,
        *,
        user_id: str,
        plan_amount_usdc: Decimal,
        use_points: bool,
        requested_points_to_consume: Optional[int],
    ) -> Dict[str, Any]:
        base = {
            "enabled": bool(self.points_enabled),
            "applied": False,
            "points_per_usdc": int(self.points_per_usdc),
            "max_discount_usdc": int(self.points_max_discount_usdc),
            "points_source": "supabase_metadata",
            "points_balance_snapshot": 0,
            "points_to_consume": 0,
            "discount_usdc": "0",
            "pay_amount_usdc": plan_amount_usdc,
        }
        if not self.points_enabled:
            return base
        if not use_points:
            return base
        if plan_amount_usdc <= 0:
            return base
        points_ctx = self._resolve_points_balance(user_id)
        balance = int(points_ctx.get("balance") or 0)
        base["points_source"] = str(points_ctx.get("source") or "supabase_metadata")
        base["points_balance_snapshot"] = balance
        if balance <= 0:
            return base

        max_discount_usdc = min(
            Decimal(int(self.points_max_discount_usdc)),
            plan_amount_usdc,
        )
        max_points_by_plan = int(
            (max_discount_usdc * Decimal(int(self.points_per_usdc))).to_integral_value(
                rounding=ROUND_FLOOR
            )
        )
        if max_points_by_plan <= 0:
            return base

        desired_points = max_points_by_plan
        if requested_points_to_consume is not None:
            try:
                desired_points = max(0, int(requested_points_to_consume))
            except Exception:
                desired_points = 0
        candidate_points = min(balance, max_points_by_plan, desired_points)
        if candidate_points <= 0:
            return base

        normalized_points = (candidate_points // int(self.points_per_usdc)) * int(
            self.points_per_usdc
        )
        if normalized_points <= 0:
            return base
        discount_units = normalized_points // int(self.points_per_usdc)
        discount_usdc = Decimal(discount_units)
        pay_amount = plan_amount_usdc - discount_usdc
        if pay_amount <= 0:
            return base

        base["applied"] = True
        base["points_to_consume"] = int(normalized_points)
        base["discount_usdc"] = _format_decimal(discount_usdc)
        base["pay_amount_usdc"] = pay_amount
        return base

    def _consume_points_for_intent(
        self,
        user_id: str,
        intent: PaymentIntentRecord,
    ) -> Dict[str, Any]:
        result = {
            "enabled": bool(self.points_enabled),
            "applied": False,
            "points_per_usdc": int(self.points_per_usdc),
            "points_redeemed": 0,
            "points_before": 0,
            "points_after": 0,
            "discount_usdc": "0",
        }
        if not self.points_enabled:
            return result

        metadata = dict(intent.metadata or {})
        redemption = metadata.get("points_redemption")
        if not isinstance(redemption, dict):
            return result
        if not bool(redemption.get("applied")):
            return result
        if bool(redemption.get("consumed")):
            result["applied"] = True
            result["points_redeemed"] = int(redemption.get("consumed_points") or 0)
            result["points_after"] = int(redemption.get("points_after") or 0)
            result["discount_usdc"] = str(redemption.get("discount_usdc") or "0")
            return result

        planned_points = int(redemption.get("points_to_consume") or 0)
        points_source = str(redemption.get("points_source") or "").strip().lower()
        if planned_points <= 0:
            return result

        if points_source == "bot_db":
            points_before = self._db.get_points_by_supabase_user_id(user_id)
            if points_before <= 0:
                return result
            redeemable = min(points_before, planned_points)
            redeemable = (redeemable // int(self.points_per_usdc)) * int(self.points_per_usdc)
            if redeemable <= 0:
                return result
            spend_result = self._db.spend_points_by_supabase_user_id(user_id, redeemable)
            if not bool(spend_result.get("ok")):
                return result
            points_after = int(spend_result.get("balance") or 0)
            discount_usdc = Decimal(redeemable // int(self.points_per_usdc))
            result["applied"] = True
            result["points_redeemed"] = int(redeemable)
            result["points_before"] = int(points_before)
            result["points_after"] = int(points_after)
            result["discount_usdc"] = _format_decimal(discount_usdc)
            return result

        user_obj = self._auth_admin_get_user(user_id)
        user_metadata = self._extract_user_metadata(user_obj)
        points_before = self._extract_points_from_metadata(user_metadata)
        if points_before <= 0:
            return result

        redeemable = min(points_before, planned_points)
        redeemable = (redeemable // int(self.points_per_usdc)) * int(self.points_per_usdc)
        if redeemable <= 0:
            return result

        points_after = points_before - redeemable
        updated_metadata = dict(user_metadata or {})
        if "points" in updated_metadata:
            updated_metadata["points"] = points_after
        if "total_points" in updated_metadata:
            updated_metadata["total_points"] = points_after
        if "points" not in updated_metadata and "total_points" not in updated_metadata:
            updated_metadata["points"] = points_after
            updated_metadata["total_points"] = points_after
        self._auth_admin_update_user_metadata(user_id, updated_metadata)

        discount_usdc = Decimal(redeemable // int(self.points_per_usdc))
        result["applied"] = True
        result["points_redeemed"] = int(redeemable)
        result["points_before"] = int(points_before)
        result["points_after"] = int(points_after)
        result["discount_usdc"] = _format_decimal(discount_usdc)
        return result

    def _build_web3(self, rpc_url: str) -> Web3:
        return Web3(
            Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": self.timeout_sec})
        )

    def _try_connect_rpc(self, rpc_url: str) -> Optional[Web3]:
        try:
            w3 = self._build_web3(rpc_url)
            if not w3.is_connected():
                return None
            if int(w3.eth.chain_id) != int(self.chain_id):
                return None
            return w3
        except Exception:
            return None

    def _rotate_rpc(self) -> Optional[Web3]:
        for rpc_url in self.rpc_urls:
            w3 = self._try_connect_rpc(rpc_url)
            if w3 is not None:
                self._w3 = w3
                self._w3_url = rpc_url
                return w3
        self._w3 = None
        self._w3_url = ""
        return None

    def _get_web3(self, force_refresh: bool = False) -> Web3:
        with self._w3_lock:
            if self._w3 is None or force_refresh:
                self._rotate_rpc()
        assert self._w3 is not None
        return self._w3

    def get_rpc_runtime_status(self) -> Dict[str, Any]:
        candidates = list(self.rpc_urls)
        return {
            "configured_rpc_count": len(candidates),
            "active_rpc_url": self._w3_url or (candidates[0] if candidates else ""),
            "all_rpc_urls": candidates,
        }

    def _get_contract(self, receiver_address: Optional[str] = None):
        w3 = self._get_web3()
        contract_address = _normalize_address(receiver_address or self.receiver_contract)
        if not contract_address:
            contract_address = self.receiver_contract
        return w3.eth.contract(
            address=Web3.to_checksum_address(contract_address),
            abi=PAYMENT_CONTRACT_ABI,
        )

    def get_config_payload(self) -> Dict[str, Any]:
        tokens_payload = [
            {
                "code": token.code,
                "symbol": token.symbol,
                "name": token.name,
                "address": token.address,
                "decimals": int(token.decimals),
                "receiver_contract": token.receiver_contract,
                "is_default": bool(token.is_default or token.address == self.default_token_address),
            }
            for token in sorted(self.supported_tokens.values(), key=lambda row: row.code)
        ]
        return {
            "enabled": self.enabled,
            "configured": self.configured,
            "chain_id": self.chain_id,
            "token_address": self.token_address,
            "token_decimals": self.token_decimals,
            "receiver_contract": self.receiver_contract,
            "default_token_address": self.default_token_address or self.token_address,
            "tokens": tokens_payload,
            "confirmations": self.confirmations,
            "intent_ttl_sec": self.intent_ttl_sec,
            "event_name": "OrderPaid",
            "event_topic0": self._event_topic,
            "points_redemption": {
                "enabled": bool(self.points_enabled),
                "points_per_usdc": int(self.points_per_usdc),
                "max_discount_usdc": int(self.points_max_discount_usdc),
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

    def _serialize_intent(self, row: Dict[str, Any]) -> PaymentIntentRecord:
        token_address = _normalize_address(row.get("token_address") or self.token_address)
        token_decimals = self._token_decimals_for(token_address)
        amount_units = int(_parse_decimal(row.get("amount_units"), Decimal("0")))
        amount_display = _units_to_decimal(amount_units, token_decimals)
        return PaymentIntentRecord(
            intent_id=str(row.get("id")),
            order_id_hex=str(row.get("order_id_hex")),
            plan_code=str(row.get("plan_code")),
            plan_id=int(row.get("plan_id") or 0),
            chain_id=int(row.get("chain_id") or self.chain_id),
            amount_units=amount_units,
            amount_usdc=_format_decimal(amount_display),
            token_address=token_address,
            token_decimals=token_decimals,
            token_symbol=self._token_symbol_for(token_address),
            receiver_address=_normalize_address(
                row.get("receiver_address") or self.receiver_contract
            ),
            status=str(row.get("status") or "created"),
            payment_mode=str(row.get("payment_mode") or "strict"),
            allowed_wallet=_normalize_address(row.get("allowed_wallet") or "") or None,
            expires_at=str(row.get("expires_at")),
            tx_hash=str(row.get("tx_hash") or "") or None,
            metadata=dict(row.get("metadata") or {}) if isinstance(row.get("metadata"), dict) else {},
        )

    def list_wallets(self, user_id: str) -> List[WalletBindingRecord]:
        self._ensure_enabled()
        rows = self._rest(
            "GET",
            "user_wallets",
            params={
                "select": "chain_id,address,status,is_primary,verified_at",
                "user_id": f"eq.{user_id}",
                "chain_id": f"eq.{self.chain_id}",
                "status": "eq.active",
                "order": "is_primary.desc,verified_at.desc",
            },
            allowed_status=[200],
        )
        if not isinstance(rows, list):
            return []
        out: List[WalletBindingRecord] = []
        for row in rows:
            out.append(
                WalletBindingRecord(
                    chain_id=int(row.get("chain_id") or self.chain_id),
                    address=_normalize_address(row.get("address") or ""),
                    status=str(row.get("status") or "active"),
                    is_primary=bool(row.get("is_primary")),
                    verified_at=row.get("verified_at"),
                )
            )
        return out

    def _require_user_wallet(self, user_id: str, address: str) -> Dict[str, Any]:
        normalized = _normalize_address(address)
        if not normalized:
            raise PaymentCheckoutError(400, "invalid wallet address")
        rows = self._rest(
            "GET",
            "user_wallets",
            params={
                "select": "id,user_id,address,chain_id,status,is_primary",
                "user_id": f"eq.{user_id}",
                "chain_id": f"eq.{self.chain_id}",
                "address": f"eq.{normalized}",
                "limit": "1",
            },
            allowed_status=[200],
        )
        if not isinstance(rows, list) or not rows:
            raise PaymentCheckoutError(403, "wallet not bound to current user")
        row = rows[0]
        if str(row.get("status") or "active") != "active":
            raise PaymentCheckoutError(403, "wallet is not active")
        return row

    def create_wallet_challenge(self, user_id: str, address: str) -> Dict[str, Any]:
        self._ensure_enabled()
        normalized = _normalize_address(address)
        if not normalized:
            raise PaymentCheckoutError(400, "invalid wallet address")
        now = _now_utc()
        expires = now + timedelta(seconds=self.challenge_ttl_sec)
        nonce = secrets.token_urlsafe(24)
        message = (
            "PolyWeather Wallet Binding\n"
            f"User: {user_id}\n"
            f"Address: {normalized}\n"
            f"ChainId: {self.chain_id}\n"
            f"Nonce: {nonce}\n"
            f"IssuedAt: {_to_iso(now)}\n"
            f"ExpiresAt: {_to_iso(expires)}"
        )
        self._rest(
            "POST",
            "wallet_link_challenges",
            payload={
                "user_id": user_id,
                "chain_id": self.chain_id,
                "address": normalized,
                "nonce": nonce,
                "message": message,
                "expires_at": _to_iso(expires),
            },
            prefer="return=representation",
            allowed_status=[201],
        )
        return {
            "address": normalized,
            "chain_id": self.chain_id,
            "nonce": nonce,
            "message": message,
            "expires_at": _to_iso(expires),
        }

    def verify_wallet_binding(
        self,
        user_id: str,
        address: str,
        nonce: str,
        signature: str,
    ) -> WalletBindingRecord:
        self._ensure_enabled()
        normalized = _normalize_address(address)
        nonce_text = str(nonce or "").strip()
        signature_text = str(signature or "").strip()
        if not normalized:
            raise PaymentCheckoutError(400, "invalid wallet address")
        if not nonce_text:
            raise PaymentCheckoutError(400, "nonce required")
        if not signature_text:
            raise PaymentCheckoutError(400, "signature required")

        challenge_rows = self._rest(
            "GET",
            "wallet_link_challenges",
            params={
                "select": "id,user_id,address,nonce,message,expires_at,consumed_at",
                "user_id": f"eq.{user_id}",
                "chain_id": f"eq.{self.chain_id}",
                "address": f"eq.{normalized}",
                "nonce": f"eq.{nonce_text}",
                "consumed_at": "is.null",
                "order": "created_at.desc",
                "limit": "1",
            },
            allowed_status=[200],
        )
        if not isinstance(challenge_rows, list) or not challenge_rows:
            raise PaymentCheckoutError(400, "wallet challenge not found or already used")

        challenge = challenge_rows[0]
        try:
            expires_at = datetime.fromisoformat(str(challenge.get("expires_at")))
        except Exception:
            expires_at = _now_utc() - timedelta(seconds=1)
        if expires_at <= _now_utc():
            raise PaymentCheckoutError(400, "wallet challenge expired")

        message = str(challenge.get("message") or "")
        if not message:
            raise PaymentCheckoutError(400, "wallet challenge message invalid")

        try:
            recovered = Account.recover_message(
                encode_defunct(text=message), signature=signature_text
            )
        except Exception:
            raise PaymentCheckoutError(400, "invalid wallet signature")
        if _normalize_address(recovered) != normalized:
            raise PaymentCheckoutError(400, "signature does not match target wallet")

        existing = self._rest(
            "GET",
            "user_wallets",
            params={
                "select": "id,user_id,address,status,is_primary",
                "chain_id": f"eq.{self.chain_id}",
                "address": f"eq.{normalized}",
                "limit": "1",
            },
            allowed_status=[200],
        )
        if isinstance(existing, list) and existing:
            owner_id = str(existing[0].get("user_id") or "")
            if owner_id and owner_id != user_id and str(existing[0].get("status")) == "active":
                raise PaymentCheckoutError(409, "wallet already bound by another account")

        has_primary = self._rest(
            "GET",
            "user_wallets",
            params={
                "select": "id",
                "user_id": f"eq.{user_id}",
                "chain_id": f"eq.{self.chain_id}",
                "status": "eq.active",
                "is_primary": "eq.true",
                "limit": "1",
            },
            allowed_status=[200],
        )
        should_primary = not (isinstance(has_primary, list) and len(has_primary) > 0)
        now_iso = _to_iso(_now_utc())
        self._rest(
            "POST",
            "user_wallets",
            params={"on_conflict": "chain_id,address"},
            payload={
                "user_id": user_id,
                "chain_id": self.chain_id,
                "address": normalized,
                "status": "active",
                "is_primary": should_primary,
                "verified_at": now_iso,
                "updated_at": now_iso,
            },
            prefer="resolution=merge-duplicates,return=representation",
            allowed_status=[200, 201],
        )
        self._rest(
            "PATCH",
            "wallet_link_challenges",
            params={"id": f"eq.{challenge.get('id')}"},
            payload={"consumed_at": now_iso},
            prefer="return=representation",
            allowed_status=[200],
        )
        return WalletBindingRecord(
            chain_id=self.chain_id,
            address=normalized,
            status="active",
            is_primary=should_primary,
            verified_at=now_iso,
        )

    def unbind_wallet(self, user_id: str, address: str) -> Dict[str, Any]:
        self._ensure_enabled()
        normalized = _normalize_address(address)
        if not normalized:
            raise PaymentCheckoutError(400, "invalid wallet address")

        # Must be an active wallet owned by current user.
        self._require_user_wallet(user_id, normalized)

        now_iso = _to_iso(_now_utc())
        self._rest(
            "PATCH",
            "user_wallets",
            params={
                "user_id": f"eq.{user_id}",
                "chain_id": f"eq.{self.chain_id}",
                "address": f"eq.{normalized}",
            },
            payload={
                "status": "revoked",
                "is_primary": False,
                "updated_at": now_iso,
            },
            prefer="return=representation",
            allowed_status=[200],
        )

        # Ensure there is still an active primary wallet after unbind.
        active_primary_rows = self._rest(
            "GET",
            "user_wallets",
            params={
                "select": "id,address",
                "user_id": f"eq.{user_id}",
                "chain_id": f"eq.{self.chain_id}",
                "status": "eq.active",
                "is_primary": "eq.true",
                "limit": "1",
            },
            allowed_status=[200],
        )

        new_primary = ""
        if isinstance(active_primary_rows, list) and active_primary_rows:
            new_primary = _normalize_address(active_primary_rows[0].get("address") or "")
        else:
            active_wallet_rows = self._rest(
                "GET",
                "user_wallets",
                params={
                    "select": "id,address",
                    "user_id": f"eq.{user_id}",
                    "chain_id": f"eq.{self.chain_id}",
                    "status": "eq.active",
                    "order": "verified_at.desc,updated_at.desc",
                    "limit": "1",
                },
                allowed_status=[200],
            )
            if isinstance(active_wallet_rows, list) and active_wallet_rows:
                candidate = active_wallet_rows[0]
                candidate_id = candidate.get("id")
                candidate_addr = _normalize_address(candidate.get("address") or "")
                if candidate_id and candidate_addr:
                    self._rest(
                        "PATCH",
                        "user_wallets",
                        params={"id": f"eq.{candidate_id}"},
                        payload={"is_primary": True, "updated_at": now_iso},
                        prefer="return=representation",
                        allowed_status=[200],
                    )
                    new_primary = candidate_addr

        return {
            "address": normalized,
            "unbound": True,
            "new_primary": new_primary or None,
        }

    def _select_plan(self, plan_code: str) -> Dict[str, Any]:
        code = str(plan_code or "").strip().lower() or "pro_monthly"
        row = self.plan_catalog.get(code)
        if not row:
            available = ", ".join(sorted(self.plan_catalog.keys()))
            raise PaymentCheckoutError(
                400, f"unknown plan_code={code}; available={available}"
            )
        amount_dec = _parse_decimal(row.get("amount_usdc"), Decimal("0"))
        if amount_dec <= 0:
            raise PaymentCheckoutError(500, f"invalid plan amount for {code}")
        return {
            "plan_code": code,
            "plan_id": int(row.get("plan_id") or 0),
            "duration_days": int(row.get("duration_days") or 0),
            "amount_usdc_decimal": amount_dec,
        }

    def _build_tx_payload(self, intent: PaymentIntentRecord) -> Dict[str, Any]:
        contract = self._get_contract(intent.receiver_address)
        tx_data = contract.encode_abi(
            "pay",
            args=[
                intent.order_id_hex,
                int(intent.plan_id),
                int(intent.amount_units),
                Web3.to_checksum_address(intent.token_address),
            ],
        )
        return {
            "chain_id": self.chain_id,
            "to": Web3.to_checksum_address(intent.receiver_address),
            "data": tx_data,
            "value": "0x0",
            "order_id_hex": intent.order_id_hex,
            "amount_units": str(intent.amount_units),
            "amount_usdc": intent.amount_usdc,
            "token_address": Web3.to_checksum_address(intent.token_address),
            "token_symbol": intent.token_symbol,
            "token_decimals": int(intent.token_decimals),
        }

    def create_intent(
        self,
        user_id: str,
        plan_code: str,
        payment_mode: str = "strict",
        allowed_wallet: Optional[str] = None,
        token_address: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        use_points: bool = False,
        points_to_consume: Optional[int] = None,
    ) -> Dict[str, Any]:
        self._ensure_enabled()
        plan = self._select_plan(plan_code)
        selected_token = self._resolve_supported_token(token_address)
        mode = str(payment_mode or "strict").strip().lower()
        if mode not in {"strict", "flex"}:
            raise PaymentCheckoutError(400, "payment_mode must be strict or flex")
        bound_wallets = self.list_wallets(user_id)
        if not bound_wallets:
            raise PaymentCheckoutError(403, "bind wallet first")
        target_wallet = _normalize_address(allowed_wallet or "")
        if mode == "strict":
            if target_wallet:
                self._require_user_wallet(user_id, target_wallet)
            else:
                primary = next(
                    (w for w in bound_wallets if w.is_primary and w.status == "active"),
                    None,
                )
                target_wallet = primary.address if primary else bound_wallets[0].address
        elif target_wallet:
            self._require_user_wallet(user_id, target_wallet)
        plan_amount_usdc = plan["amount_usdc_decimal"]
        redemption = self._build_points_redemption(
            user_id=user_id,
            plan_amount_usdc=plan_amount_usdc,
            use_points=bool(use_points),
            requested_points_to_consume=points_to_consume,
        )
        final_amount_usdc = redemption["pay_amount_usdc"]
        amount_units = _decimal_to_units(final_amount_usdc, int(selected_token.decimals))
        if amount_units <= 0:
            raise PaymentCheckoutError(400, "invalid final payment amount")
        combined_metadata = dict(metadata or {})
        combined_metadata["token_code"] = str(selected_token.code)
        combined_metadata["token_symbol"] = str(selected_token.symbol)
        combined_metadata["amount_before_discount_usdc"] = _format_decimal(plan_amount_usdc)
        combined_metadata["amount_after_discount_usdc"] = _format_decimal(final_amount_usdc)
        combined_metadata["points_redemption"] = {
            "enabled": bool(redemption.get("enabled")),
            "applied": bool(redemption.get("applied")),
            "points_per_usdc": int(redemption.get("points_per_usdc") or self.points_per_usdc),
            "max_discount_usdc": int(redemption.get("max_discount_usdc") or self.points_max_discount_usdc),
            "points_source": str(redemption.get("points_source") or "supabase_metadata"),
            "points_balance_snapshot": int(redemption.get("points_balance_snapshot") or 0),
            "points_to_consume": int(redemption.get("points_to_consume") or 0),
            "discount_usdc": str(redemption.get("discount_usdc") or "0"),
        }
        order_id_hex = "0x" + secrets.token_hex(32)
        now = _now_utc()
        expires_at = now + timedelta(seconds=self.intent_ttl_sec)
        rows = self._rest(
            "POST",
            "payment_intents",
            payload={
                "user_id": user_id,
                "plan_code": plan["plan_code"],
                "plan_id": plan["plan_id"],
                "chain_id": self.chain_id,
                "token_address": selected_token.address,
                "receiver_address": selected_token.receiver_contract,
                "amount_units": str(amount_units),
                "payment_mode": mode,
                "allowed_wallet": target_wallet or None,
                "order_id_hex": order_id_hex,
                "status": "created",
                "expires_at": _to_iso(expires_at),
                "metadata": combined_metadata,
                "created_at": _to_iso(now),
                "updated_at": _to_iso(now),
            },
            prefer="return=representation",
            allowed_status=[201],
        )
        if not isinstance(rows, list) or not rows:
            raise PaymentCheckoutError(500, "failed to create payment intent")
        intent = self._serialize_intent(rows[0])
        return {
            "intent": intent.__dict__,
            "tx_payload": self._build_tx_payload(intent),
            "plan": {
                "plan_code": plan["plan_code"],
                "plan_id": plan["plan_id"],
                "duration_days": plan["duration_days"],
                "amount_before_discount_usdc": _format_decimal(plan_amount_usdc),
                "amount_after_discount_usdc": _format_decimal(final_amount_usdc),
            },
            "token": {
                "code": selected_token.code,
                "symbol": selected_token.symbol,
                "name": selected_token.name,
                "address": selected_token.address,
                "decimals": int(selected_token.decimals),
            },
            "points_redemption": {
                "applied": bool(redemption.get("applied")),
                "points_source": str(redemption.get("points_source") or "supabase_metadata"),
                "points_to_consume": int(redemption.get("points_to_consume") or 0),
                "discount_usdc": str(redemption.get("discount_usdc") or "0"),
                "points_balance_snapshot": int(redemption.get("points_balance_snapshot") or 0),
            },
        }
    def get_intent(self, user_id: str, intent_id: str) -> PaymentIntentRecord:
        self._ensure_enabled()
        rows = self._rest(
            "GET",
            "payment_intents",
            params={
                "select": (
                    "id,user_id,plan_code,plan_id,chain_id,token_address,receiver_address,"
                    "amount_units,payment_mode,allowed_wallet,order_id_hex,status,expires_at,tx_hash,metadata"
                ),
                "id": f"eq.{intent_id}",
                "user_id": f"eq.{user_id}",
                "limit": "1",
            },
            allowed_status=[200],
        )
        if not isinstance(rows, list) or not rows:
            raise PaymentCheckoutError(404, "payment intent not found")
        intent = self._serialize_intent(rows[0])
        setattr(intent, "user_id", user_id)
        return intent

    def list_pending_confirm_intents(self, limit: int = 20) -> List[Dict[str, Any]]:
        """
        List submitted intents that already have tx_hash and need background confirm.
        """
        self._ensure_enabled()
        safe_limit = max(1, min(int(limit or 20), 200))
        rows = self._rest(
            "GET",
            "payment_intents",
            params={
                "select": "id,user_id,tx_hash,status,updated_at,created_at,chain_id",
                "status": "eq.submitted",
                "tx_hash": "not.is.null",
                "chain_id": f"eq.{self.chain_id}",
                "order": "updated_at.asc",
                "limit": str(safe_limit),
            },
            allowed_status=[200],
        )
        if not isinstance(rows, list):
            return []

        out: List[Dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            intent_id = str(row.get("id") or "").strip()
            user_id = str(row.get("user_id") or "").strip()
            tx_hash = str(row.get("tx_hash") or "").strip().lower()
            if not intent_id or not user_id or not tx_hash:
                continue
            out.append(
                {
                    "intent_id": intent_id,
                    "user_id": user_id,
                    "tx_hash": tx_hash,
                    "status": str(row.get("status") or ""),
                    "updated_at": row.get("updated_at"),
                    "created_at": row.get("created_at"),
                }
            )
        return out

    def list_open_intents_by_order_id(
        self,
        order_id_hex: str,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """
        Find intents by on-chain order id for event-driven reconciliation.
        Includes created/submitted intents; confirmed intents are returned too for idempotent skip.
        """
        self._ensure_enabled()
        normalized_order = _normalize_order_id_hex(order_id_hex)
        if not normalized_order:
            return []
        safe_limit = max(1, min(int(limit or 10), 50))
        rows = self._rest(
            "GET",
            "payment_intents",
            params={
                "select": (
                    "id,user_id,status,tx_hash,order_id_hex,plan_id,token_address,"
                    "amount_units,payment_mode,allowed_wallet,chain_id,created_at,updated_at"
                ),
                "order_id_hex": f"eq.{normalized_order}",
                "chain_id": f"eq.{self.chain_id}",
                "status": "in.(created,submitted,confirmed)",
                "order": "created_at.desc",
                "limit": str(safe_limit),
            },
            allowed_status=[200],
        )
        if not isinstance(rows, list):
            return []

        out: List[Dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            intent_id = str(row.get("id") or "").strip()
            user_id = str(row.get("user_id") or "").strip()
            status = str(row.get("status") or "").strip().lower()
            if not intent_id or not user_id or not status:
                continue
            out.append(
                {
                    "intent_id": intent_id,
                    "user_id": user_id,
                    "status": status,
                    "tx_hash": str(row.get("tx_hash") or "").strip().lower(),
                    "order_id_hex": str(row.get("order_id_hex") or "").strip().lower(),
                    "plan_id": int(row.get("plan_id") or 0),
                    "token_address": _normalize_address(row.get("token_address")),
                    "amount_units": int(row.get("amount_units") or 0),
                    "payment_mode": str(row.get("payment_mode") or "").strip().lower(),
                    "allowed_wallet": _normalize_address(row.get("allowed_wallet")),
                    "created_at": row.get("created_at"),
                    "updated_at": row.get("updated_at"),
                }
            )
        return out

    def submit_intent_tx(
        self,
        user_id: str,
        intent_id: str,
        tx_hash: str,
        from_address: str,
    ) -> Dict[str, Any]:
        self._ensure_enabled()
        intent = self.get_intent(user_id, intent_id)
        if intent.status not in {"created", "submitted"}:
            raise PaymentCheckoutError(409, f"intent status is {intent.status}, cannot submit")

        tx_hash_text = str(tx_hash or "").strip().lower()
        from_addr = _normalize_address(from_address)
        if not (tx_hash_text.startswith("0x") and len(tx_hash_text) == 66):
            raise PaymentCheckoutError(400, "invalid tx_hash")
        if not from_addr:
            raise PaymentCheckoutError(400, "invalid from_address")

        now = _now_utc()
        try:
            expires_at = datetime.fromisoformat(intent.expires_at)
        except Exception:
            expires_at = now - timedelta(seconds=1)
        if expires_at <= now:
            self._rest(
                "PATCH",
                "payment_intents",
                params={"id": f"eq.{intent.intent_id}", "user_id": f"eq.{user_id}"},
                payload={"status": "expired", "updated_at": _to_iso(now)},
                prefer="return=representation",
                allowed_status=[200],
            )
            raise PaymentCheckoutError(409, "payment intent expired")

        if intent.payment_mode == "strict" and intent.allowed_wallet:
            if from_addr != intent.allowed_wallet:
                raise PaymentCheckoutError(
                    400,
                    f"strict mode requires allowed wallet {intent.allowed_wallet}",
                )
        else:
            self._require_user_wallet(user_id, from_addr)

        now_iso = _to_iso(now)
        self._rest(
            "PATCH",
            "payment_intents",
            params={"id": f"eq.{intent.intent_id}", "user_id": f"eq.{user_id}"},
            payload={
                "status": "submitted",
                "tx_hash": tx_hash_text,
                "updated_at": now_iso,
            },
            prefer="return=representation",
            allowed_status=[200],
        )
        tx_rows = self._rest(
            "POST",
            "payment_transactions",
            params={"on_conflict": "tx_hash"},
            payload={
                "intent_id": intent.intent_id,
                "chain_id": self.chain_id,
                "tx_hash": tx_hash_text,
                "from_address": from_addr,
                "to_address": intent.receiver_address,
                "status": "submitted",
                "updated_at": now_iso,
            },
            prefer="resolution=merge-duplicates,return=representation",
            allowed_status=[200, 201],
        )
        return {
            "intent_id": intent.intent_id,
            "status": "submitted",
            "tx_hash": tx_hash_text,
            "from_address": from_addr,
            "transaction": tx_rows[0] if isinstance(tx_rows, list) and tx_rows else None,
        }

    def _wait_receipt(self, tx_hash: str) -> Any:
        import time as _time

        start = _now_utc()
        while (_now_utc() - start).total_seconds() < self.max_wait_sec:
            try:
                w3 = self._get_web3()
                receipt = w3.eth.get_transaction_receipt(tx_hash)
            except Exception:
                try:
                    w3 = self._get_web3(force_refresh=True)
                    receipt = w3.eth.get_transaction_receipt(tx_hash)
                except Exception:
                    receipt = None
            if receipt and receipt.get("blockNumber"):
                return receipt
            try:
                latest_w3 = self._get_web3()
                if not latest_w3.is_connected():
                    self._get_web3(force_refresh=True)
            except Exception:
                receipt = None
            _time.sleep(self.poll_interval_sec)
        raise PaymentCheckoutError(408, "tx receipt timeout")

    def _extract_matching_event(
        self, receipt: Any, intent: PaymentIntentRecord
    ) -> Optional[Dict[str, Any]]:
        contract = self._get_contract(intent.receiver_address)
        try:
            events = contract.events.OrderPaid().process_receipt(receipt)
        except Exception:
            events = []
        if not events:
            return None

        for ev in events:
            args = ev.get("args") if isinstance(ev, dict) else getattr(ev, "args", None)
            if not args:
                continue
            order_id_hex = str(Web3.to_hex(args.get("orderId"))).lower()
            payer = _normalize_address(args.get("payer"))
            plan_id = int(args.get("planId") or 0)
            token = _normalize_address(args.get("token"))
            amount = int(args.get("amount") or 0)
            if (
                order_id_hex == intent.order_id_hex.lower()
                and plan_id == int(intent.plan_id)
                and token == intent.token_address
                and amount == int(intent.amount_units)
            ):
                if intent.payment_mode == "strict" and intent.allowed_wallet:
                    if payer != intent.allowed_wallet:
                        continue
                return {
                    "order_id_hex": order_id_hex,
                    "payer": payer,
                    "plan_id": plan_id,
                    "token_address": token,
                    "amount_units": amount,
                }
        return None

    def _insert_payment_record(
        self,
        user_id: str,
        tx_hash: str,
        amount_units: int,
        token_address: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        token_decimals = self._token_decimals_for(token_address)
        amount_dec = _units_to_decimal(amount_units, token_decimals)
        currency = self._token_symbol_for(token_address)
        rows = self._rest(
            "POST",
            "payments",
            params={"on_conflict": "tx_hash"},
            payload={
                "user_id": user_id,
                "amount": str(amount_dec),
                "currency": currency,
                "chain": "polygon",
                "tx_hash": tx_hash,
                "status": "confirmed",
                "raw_payload": payload,
                "updated_at": _to_iso(_now_utc()),
            },
            prefer="resolution=merge-duplicates,return=representation",
            allowed_status=[200, 201],
        )
        return rows[0] if isinstance(rows, list) and rows else {}

    def _grant_subscription(
        self,
        user_id: str,
        plan_code: str,
        duration_days: int,
        tx_hash: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        now = _now_utc()
        latest_rows = self._rest(
            "GET",
            "subscriptions",
            params={
                "select": "id,expires_at,status,plan_code,source,starts_at",
                "user_id": f"eq.{user_id}",
                "status": "eq.active",
                "order": "expires_at.desc",
                "limit": "20",
            },
            allowed_status=[200],
        )
        starts = now
        current_subscription = None
        if isinstance(latest_rows, list):
            for row in latest_rows:
                if not isinstance(row, dict):
                    continue
                try:
                    starts_at = datetime.fromisoformat(
                        str(row.get("starts_at") or "").replace("Z", "+00:00")
                    )
                    if starts_at.tzinfo is None:
                        starts_at = starts_at.replace(tzinfo=timezone.utc)
                    starts_at = starts_at.astimezone(timezone.utc)
                except Exception:
                    starts_at = None
                if starts_at is None or starts_at <= now:
                    current_subscription = row
                    break
        if isinstance(current_subscription, dict):
            current_plan_code = str(current_subscription.get("plan_code") or "").strip().lower()
            current_source = str(current_subscription.get("source") or "").strip().lower()
            current_is_trial = "trial" in current_plan_code or "trial" in current_source
            if not current_is_trial:
                try:
                    latest_exp = datetime.fromisoformat(
                        str(current_subscription.get("expires_at") or "").replace("Z", "+00:00")
                    )
                    if latest_exp.tzinfo is None:
                        latest_exp = latest_exp.replace(tzinfo=timezone.utc)
                    latest_exp = latest_exp.astimezone(timezone.utc)
                    if latest_exp > starts:
                        starts = latest_exp
                except Exception:
                    pass
        expires = starts + timedelta(days=max(1, duration_days))
        sub_rows = self._rest(
            "POST",
            "subscriptions",
            payload={
                "user_id": user_id,
                "plan_code": plan_code,
                "status": "active",
                "starts_at": _to_iso(starts),
                "expires_at": _to_iso(expires),
                "source": "payment_contract",
                "created_at": _to_iso(now),
                "updated_at": _to_iso(now),
            },
            prefer="return=representation",
            allowed_status=[201],
        )
        self._rest(
            "POST",
            "entitlement_events",
            payload={
                "user_id": user_id,
                "action": "subscription_granted",
                "reason": "payment_confirmed",
                "actor": "payment_contract_checkout",
                "payload": {"tx_hash": tx_hash, **payload},
                "created_at": _to_iso(now),
            },
            prefer="return=representation",
            allowed_status=[201],
        )
        SUPABASE_ENTITLEMENT.invalidate_subscription_cache(user_id)
        return sub_rows[0] if isinstance(sub_rows, list) and sub_rows else {}

    def _ensure_confirmed_subscription(
        self,
        user_id: str,
        intent: PaymentIntentRecord,
        tx_hash: str,
    ) -> Optional[Dict[str, Any]]:
        SUPABASE_ENTITLEMENT.invalidate_subscription_cache(user_id)
        latest_subscription = SUPABASE_ENTITLEMENT.get_latest_active_subscription(
            user_id,
            respect_requirement=False,
        )
        if isinstance(latest_subscription, dict):
            return latest_subscription

        plan = self._select_plan(intent.plan_code)
        return self._grant_subscription(
            user_id=user_id,
            plan_code=intent.plan_code,
            duration_days=plan["duration_days"],
            tx_hash=tx_hash,
            payload={
                "intent_id": intent.intent_id,
                "order_id_hex": intent.order_id_hex,
                "repaired_from_confirmed_intent": True,
            },
        )

    def _ensure_confirm_side_effects(
        self,
        user_id: str,
        intent: PaymentIntentRecord,
        tx_hash: str,
    ) -> Dict[str, Any]:
        payment_row = {}
        if tx_hash:
            payment_row = self._insert_payment_record(
                user_id=user_id,
                tx_hash=tx_hash,
                amount_units=int(intent.amount_units),
                token_address=intent.token_address,
                payload={
                    "tx_hash": tx_hash,
                    "intent_id": intent.intent_id,
                    "order_id_hex": intent.order_id_hex,
                    "reconciled": True,
                },
            )
        subscription_row = self._ensure_confirmed_subscription(user_id, intent, tx_hash)
        return {
            "payment": payment_row,
            "subscription": subscription_row,
        }

    def _attempt_confirm_repair(
        self,
        *,
        user_id: str,
        intent: PaymentIntentRecord,
        tx_hash: str,
        reason: str,
        detail: str,
    ) -> Dict[str, Any]:
        self._db.append_payment_audit_event(
            "payment_confirm_repair_needed",
            {
                "user_id": user_id,
                "intent_id": intent.intent_id,
                "plan_code": intent.plan_code,
                "reason": str(reason or "").strip().lower(),
                "detail": str(detail or "").strip(),
                "tx_hash": str(tx_hash or "").strip().lower(),
            },
        )
        repaired = self._ensure_confirm_side_effects(user_id, intent, tx_hash)
        if repaired.get("payment") or repaired.get("subscription"):
            self._db.append_payment_audit_event(
                "payment_confirm_repaired",
                {
                    "user_id": user_id,
                    "intent_id": intent.intent_id,
                    "plan_code": intent.plan_code,
                    "tx_hash": str(tx_hash or "").strip().lower(),
                    "reason": str(reason or "").strip().lower(),
                },
            )
        return repaired

    def _mark_intent_failed(
        self,
        *,
        user_id: str,
        intent: PaymentIntentRecord,
        tx_hash: str,
        reason: str,
        detail: str,
        extra: Optional[Dict[str, Any]] = None,
    ) -> None:
        now_iso = _to_iso(_now_utc())
        metadata = dict(intent.metadata or {})
        metadata["confirm_failure"] = {
            "reason": str(reason or "").strip().lower(),
            "detail": str(detail or "").strip(),
            "tx_hash": str(tx_hash or "").strip().lower(),
            "at": now_iso,
            **(extra or {}),
        }
        self._rest(
            "PATCH",
            "payment_intents",
            params={"id": f"eq.{intent.intent_id}", "user_id": f"eq.{user_id}"},
            payload={
                "status": "failed",
                "metadata": metadata,
                "updated_at": now_iso,
            },
            prefer="return=representation",
            allowed_status=[200],
        )
        if tx_hash:
            self._rest(
                "POST",
                "payment_transactions",
                params={"on_conflict": "tx_hash"},
                payload={
                    "intent_id": intent.intent_id,
                    "chain_id": self.chain_id,
                    "tx_hash": str(tx_hash).strip().lower(),
                    "from_address": None,
                    "to_address": intent.receiver_address,
                    "status": "failed",
                    "updated_at": now_iso,
                },
                prefer="resolution=merge-duplicates,return=representation",
                allowed_status=[200, 201],
            )
        self._db.append_payment_audit_event(
            "payment_intent_failed",
            {
                "intent_id": intent.intent_id,
                "user_id": user_id,
                "plan_code": intent.plan_code,
                "reason": str(reason or "").strip().lower(),
                "detail": str(detail or "").strip(),
                "tx_hash": str(tx_hash or "").strip().lower(),
                "receiver_expected": intent.receiver_address,
                **(extra or {}),
            },
        )

    def _notify_telegram(self, user_id: str, plan_code: str, amount_usdc: str, tx_hash: str) -> None:
        if not self.notify_telegram:
            return
        token = str(os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
        if not token:
            return
        user = self._db.get_user_by_supabase_user_id(user_id)
        if not isinstance(user, dict):
            return
        telegram_id = int(user.get("telegram_id") or 0)
        if telegram_id <= 0:
            return
        short_hash = tx_hash[:10] + "..." + tx_hash[-8:] if len(tx_hash) > 20 else tx_hash
        text = (
            "✅ PolyWeather 支付确认\n"
            f"用户: {user_id}\n"
            f"套餐: {plan_code}\n"
            f"金额: {amount_usdc} USDC\n"
            f"Tx: {short_hash}"
        )
        try:
            requests.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={
                    "chat_id": str(telegram_id),
                    "text": text,
                    "disable_web_page_preview": True,
                },
                timeout=8,
            )
        except Exception:
            return

    def confirm_intent_tx(
        self,
        user_id: str,
        intent_id: str,
        tx_hash: Optional[str] = None,
    ) -> Dict[str, Any]:
        self._ensure_enabled()
        intent = self.get_intent(user_id, intent_id)
        if intent.status == "confirmed":
            tx_hash_text = str(tx_hash or intent.tx_hash or "").strip().lower()
            repaired = self._ensure_confirm_side_effects(user_id, intent, tx_hash_text)
            refreshed = self.get_intent(user_id, intent_id)
            return {
                "intent": refreshed.__dict__,
                "already_confirmed": True,
                "payment": repaired.get("payment"),
                "subscription": repaired.get("subscription"),
            }
        if intent.status in {"failed", "cancelled", "expired"}:
            raise PaymentCheckoutError(409, f"intent status is {intent.status}")
        tx_hash_text = str(tx_hash or intent.tx_hash or "").strip().lower()
        if not tx_hash_text:
            raise PaymentCheckoutError(400, "tx_hash required")
        if not (tx_hash_text.startswith("0x") and len(tx_hash_text) == 66):
            raise PaymentCheckoutError(400, "invalid tx_hash")
        w3 = self._get_web3()
        if not w3.is_connected():
            raise PaymentCheckoutError(503, "cannot connect payment rpc")
        if int(w3.eth.chain_id) != int(self.chain_id):
            raise PaymentCheckoutError(503, "payment rpc chain mismatch")
        # Wait for receipt first to avoid transient RPC lag on eth_getTransaction.
        receipt = self._wait_receipt(tx_hash_text)
        if int(receipt.get("status") or 0) != 1:
            self._mark_intent_failed(
                user_id=user_id,
                intent=intent,
                tx_hash=tx_hash_text,
                reason="tx_reverted",
                detail="tx reverted",
            )
            raise PaymentCheckoutError(400, "tx reverted")

        try:
            tx = w3.eth.get_transaction(tx_hash_text)
        except Exception:
            tx = None

        tx_get = getattr(tx, "get", None)
        tx_to_raw = tx_get("to") if callable(tx_get) else None
        tx_from_raw = tx_get("from") if callable(tx_get) else None
        tx_to = _normalize_address(
            tx_to_raw or receipt.get("to")
        )
        tx_from = _normalize_address(
            tx_from_raw or receipt.get("from")
        )
        if not tx_to or not tx_from:
            raise PaymentCheckoutError(409, "tx indexed partially; retry confirm")
        if tx_to != intent.receiver_address:
            self._mark_intent_failed(
                user_id=user_id,
                intent=intent,
                tx_hash=tx_hash_text,
                reason="receiver_mismatch",
                detail=f"tx to mismatch: got={tx_to} expected={intent.receiver_address}",
                extra={
                    "receiver_actual": tx_to,
                    "from_address": tx_from,
                },
            )
            raise PaymentCheckoutError(
                400,
                f"tx to mismatch: got={tx_to} expected={intent.receiver_address}",
            )
        if intent.payment_mode == "strict" and intent.allowed_wallet:
            if tx_from != intent.allowed_wallet:
                self._mark_intent_failed(
                    user_id=user_id,
                    intent=intent,
                    tx_hash=tx_hash_text,
                    reason="sender_mismatch",
                    detail=f"tx sender mismatch: got={tx_from} expected={intent.allowed_wallet}",
                    extra={"from_address": tx_from},
                )
                raise PaymentCheckoutError(
                    400,
                    f"tx sender mismatch: got={tx_from} expected={intent.allowed_wallet}",
                )
        else:
            self._require_user_wallet(user_id, tx_from)
        block_number = int(receipt.get("blockNumber") or 0)
        latest_block = int(w3.eth.block_number)
        confirmations = max(0, latest_block - block_number + 1) if block_number else 0
        if confirmations < self.confirmations:
            raise PaymentCheckoutError(
                409, f"confirmations not enough: {confirmations}/{self.confirmations}"
            )
        event_match = self._extract_matching_event(receipt, intent)
        if not event_match:
            self._mark_intent_failed(
                user_id=user_id,
                intent=intent,
                tx_hash=tx_hash_text,
                reason="event_mismatch",
                detail="OrderPaid event mismatch; ensure contract emits OrderPaid(orderId,payer,planId,token,amount)",
                extra={"from_address": tx_from, "receiver_actual": tx_to},
            )
            raise PaymentCheckoutError(
                400,
                "OrderPaid event mismatch; ensure contract emits OrderPaid(orderId,payer,planId,token,amount)",
            )
        points_result = self._consume_points_for_intent(user_id, intent)
        now_iso = _to_iso(_now_utc())
        confirmed_metadata = dict(intent.metadata or {})
        redemption_meta = confirmed_metadata.get("points_redemption")
        if isinstance(redemption_meta, dict):
            redemption_meta["consumed"] = bool(points_result.get("points_redeemed"))
            redemption_meta["consumed_points"] = int(points_result.get("points_redeemed") or 0)
            redemption_meta["points_after"] = points_result.get("points_after")
            redemption_meta["consumed_at"] = now_iso
            confirmed_metadata["points_redemption"] = redemption_meta
        self._rest(
            "PATCH",
            "payment_intents",
            params={"id": f"eq.{intent.intent_id}", "user_id": f"eq.{user_id}"},
            payload={
                "status": "confirmed",
                "tx_hash": tx_hash_text,
                "confirmed_at": now_iso,
                "metadata": confirmed_metadata,
                "updated_at": now_iso,
            },
            prefer="return=representation",
            allowed_status=[200],
        )
        tx_rows = self._rest(
            "POST",
            "payment_transactions",
            params={"on_conflict": "tx_hash"},
            payload={
                "intent_id": intent.intent_id,
                "tx_hash": tx_hash_text,
                "chain_id": self.chain_id,
                "from_address": tx_from,
                "to_address": tx_to,
                "block_number": block_number,
                "status": "confirmed",
                "raw_receipt": json.loads(Web3.to_json(receipt)),
                "raw_tx": json.loads(Web3.to_json(tx)) if tx is not None else None,
                "updated_at": now_iso,
            },
            prefer="resolution=merge-duplicates,return=representation",
            allowed_status=[200, 201],
        )
        payload = {
            "tx_hash": tx_hash_text,
            "block_number": block_number,
            "confirmations": confirmations,
            "event": event_match,
            "points_redemption": points_result,
        }
        plan = self._select_plan(intent.plan_code)
        payment_row = {}
        subscription_row = {}
        try:
            payment_row = self._insert_payment_record(
                user_id=user_id,
                tx_hash=tx_hash_text,
                amount_units=intent.amount_units,
                token_address=intent.token_address,
                payload=payload,
            )
            subscription_row = self._grant_subscription(
                user_id=user_id,
                plan_code=intent.plan_code,
                duration_days=plan["duration_days"],
                tx_hash=tx_hash_text,
                payload=payload,
            )
        except PaymentCheckoutError as exc:
            repaired = self._attempt_confirm_repair(
                user_id=user_id,
                intent=intent,
                tx_hash=tx_hash_text,
                reason="side_effect_failure",
                detail=exc.detail,
            )
            payment_row = repaired.get("payment") or payment_row
            subscription_row = repaired.get("subscription") or subscription_row
            if not subscription_row:
                raise
        self._notify_telegram(
            user_id=user_id,
            plan_code=intent.plan_code,
            amount_usdc=intent.amount_usdc,
            tx_hash=tx_hash_text,
        )
        refreshed = self.get_intent(user_id, intent.intent_id)
        return {
            "intent": refreshed.__dict__,
            "transaction": tx_rows[0] if isinstance(tx_rows, list) and tx_rows else None,
            "payment": payment_row,
            "subscription": subscription_row,
            "points_redemption": points_result,
            "tx": payload,
        }

    def reconcile_latest_intent(self, user_id: str) -> Dict[str, Any]:
        self._ensure_enabled()
        rows = self._rest(
            "GET",
            "payment_intents",
            params={
                "select": (
                    "id,user_id,plan_code,plan_id,chain_id,token_address,receiver_address,"
                    "amount_units,payment_mode,allowed_wallet,order_id_hex,status,expires_at,tx_hash,metadata"
                ),
                "user_id": f"eq.{user_id}",
                "status": "in.(created,submitted,confirmed)",
                "order": "updated_at.desc",
                "limit": "5",
            },
            allowed_status=[200],
        )
        if not isinstance(rows, list) or not rows:
            return {"ok": False, "reason": "intent_not_found"}

        attempts: List[Dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            intent = self._serialize_intent(row)
            status = str(intent.status or "").strip().lower()
            tx_hash_text = str(intent.tx_hash or "").strip().lower()
            try:
                if status == "submitted" and tx_hash_text:
                    result = self.confirm_intent_tx(user_id, intent.intent_id, tx_hash_text)
                    return {"ok": True, "action": "confirmed_submitted_intent", **result}
                if status == "confirmed":
                    repaired = self._ensure_confirm_side_effects(user_id, intent, tx_hash_text)
                    refreshed = self.get_intent(user_id, intent.intent_id)
                    return {
                        "ok": True,
                        "action": "reconciled_confirmed_intent",
                        "intent": refreshed.__dict__,
                        "payment": repaired.get("payment"),
                        "subscription": repaired.get("subscription"),
                    }
            except PaymentCheckoutError as exc:
                attempts.append(
                    {
                        "intent_id": intent.intent_id,
                        "status": status,
                        "status_code": exc.status_code,
                        "error": exc.detail,
                    }
                )

        SUPABASE_ENTITLEMENT.invalidate_subscription_cache(user_id)
        latest_subscription = SUPABASE_ENTITLEMENT.get_latest_active_subscription(
            user_id,
            respect_requirement=False,
        )
        return {
            "ok": bool(latest_subscription),
            "action": "checked_without_repair",
            "subscription": latest_subscription,
            "attempts": attempts,
        }

    def reconcile_recent_intents(self, limit: int = 50) -> Dict[str, Any]:
        self._ensure_enabled()
        safe_limit = max(1, min(int(limit or 50), 200))
        rows = self._rest(
            "GET",
            "payment_intents",
            params={
                "select": "id,user_id,status,updated_at",
                "status": "in.(submitted,confirmed)",
                "order": "updated_at.desc",
                "limit": str(safe_limit),
            },
            allowed_status=[200],
        )
        if not isinstance(rows, list) or not rows:
            return {"ok": True, "processed_users": 0, "repaired_users": 0}

        seen_users: set[str] = set()
        repaired_users = 0
        for row in rows:
            if not isinstance(row, dict):
                continue
            user_id = str(row.get("user_id") or "").strip()
            if not user_id or user_id in seen_users:
                continue
            seen_users.add(user_id)
            try:
                result = self.reconcile_latest_intent(user_id)
                if bool(result.get("ok")) and result.get("subscription"):
                    repaired_users += 1
            except PaymentCheckoutError:
                continue
            except Exception:
                continue

        return {
            "ok": True,
            "processed_users": len(seen_users),
            "repaired_users": repaired_users,
        }
PAYMENT_CHECKOUT = PaymentContractCheckoutService()

