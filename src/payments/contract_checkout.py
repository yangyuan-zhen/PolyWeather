from __future__ import annotations

import json
import os
import secrets
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional

import requests
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3

DEFAULT_POLYGON_CHAIN_ID = 137
DEFAULT_USDC_E_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"

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
    "pro_monthly": {"plan_id": 101, "amount_usdc": "29", "duration_days": 30},
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
class PaymentIntentRecord:
    intent_id: str
    order_id_hex: str
    plan_code: str
    plan_id: int
    chain_id: int
    amount_units: int
    amount_usdc: str
    token_address: str
    receiver_address: str
    status: str
    payment_mode: str
    allowed_wallet: Optional[str]
    expires_at: str
    tx_hash: Optional[str]


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
        self.receiver_contract = _normalize_address(
            os.getenv("POLYWEATHER_PAYMENT_RECEIVER_CONTRACT") or ""
        )
        self.token_address = _normalize_address(
            os.getenv("POLYWEATHER_PAYMENT_TOKEN_ADDRESS") or DEFAULT_USDC_E_ADDRESS
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
        self._w3_lock = threading.Lock()
        self._w3: Optional[Web3] = None
        self._event_topic = Web3.keccak(
            text="OrderPaid(bytes32,address,uint256,address,uint256)"
        ).hex()

    @property
    def configured(self) -> bool:
        return bool(
            self.supabase_url
            and self.supabase_service_role_key
            and self.rpc_url
            and self.receiver_contract
            and self.token_address
        )

    def _ensure_enabled(self) -> None:
        if not self.enabled:
            raise PaymentCheckoutError(503, "payment feature disabled")
        if not self.configured:
            raise PaymentCheckoutError(
                503,
                "payment feature not configured: require SUPABASE + RPC + contract + token",
            )

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

    def _get_web3(self) -> Web3:
        with self._w3_lock:
            if self._w3 is None:
                self._w3 = Web3(
                    Web3.HTTPProvider(self.rpc_url, request_kwargs={"timeout": self.timeout_sec})
                )
        assert self._w3 is not None
        return self._w3

    def _get_contract(self):
        w3 = self._get_web3()
        return w3.eth.contract(
            address=Web3.to_checksum_address(self.receiver_contract),
            abi=PAYMENT_CONTRACT_ABI,
        )

    def get_config_payload(self) -> Dict[str, Any]:
        return {
            "enabled": self.enabled,
            "configured": self.configured,
            "chain_id": self.chain_id,
            "token_address": self.token_address,
            "token_decimals": self.token_decimals,
            "receiver_contract": self.receiver_contract,
            "confirmations": self.confirmations,
            "intent_ttl_sec": self.intent_ttl_sec,
            "event_name": "OrderPaid",
            "event_topic0": self._event_topic,
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
        amount_units = int(_parse_decimal(row.get("amount_units"), Decimal("0")))
        amount_display = _units_to_decimal(amount_units, self.token_decimals)
        return PaymentIntentRecord(
            intent_id=str(row.get("id")),
            order_id_hex=str(row.get("order_id_hex")),
            plan_code=str(row.get("plan_code")),
            plan_id=int(row.get("plan_id") or 0),
            chain_id=int(row.get("chain_id") or self.chain_id),
            amount_units=amount_units,
            amount_usdc=_format_decimal(amount_display),
            token_address=_normalize_address(row.get("token_address") or self.token_address),
            receiver_address=_normalize_address(
                row.get("receiver_address") or self.receiver_contract
            ),
            status=str(row.get("status") or "created"),
            payment_mode=str(row.get("payment_mode") or "strict"),
            allowed_wallet=_normalize_address(row.get("allowed_wallet") or "") or None,
            expires_at=str(row.get("expires_at")),
            tx_hash=str(row.get("tx_hash") or "") or None,
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
        contract = self._get_contract()
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
        }

    def create_intent(
        self,
        user_id: str,
        plan_code: str,
        payment_mode: str = "strict",
        allowed_wallet: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        self._ensure_enabled()
        plan = self._select_plan(plan_code)
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

        amount_units = _decimal_to_units(plan["amount_usdc_decimal"], self.token_decimals)
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
                "token_address": self.token_address,
                "receiver_address": self.receiver_contract,
                "amount_units": str(amount_units),
                "payment_mode": mode,
                "allowed_wallet": target_wallet or None,
                "order_id_hex": order_id_hex,
                "status": "created",
                "expires_at": _to_iso(expires_at),
                "metadata": metadata or {},
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
                    "amount_units,payment_mode,allowed_wallet,order_id_hex,status,expires_at,tx_hash"
                ),
                "id": f"eq.{intent_id}",
                "user_id": f"eq.{user_id}",
                "limit": "1",
            },
            allowed_status=[200],
        )
        if not isinstance(rows, list) or not rows:
            raise PaymentCheckoutError(404, "payment intent not found")
        return self._serialize_intent(rows[0])

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

        w3 = self._get_web3()
        start = _now_utc()
        while (_now_utc() - start).total_seconds() < self.max_wait_sec:
            try:
                receipt = w3.eth.get_transaction_receipt(tx_hash)
            except Exception:
                receipt = None
            if receipt and receipt.get("blockNumber"):
                return receipt
            _time.sleep(self.poll_interval_sec)
        raise PaymentCheckoutError(408, "tx receipt timeout")

    def _extract_matching_event(
        self, receipt: Any, intent: PaymentIntentRecord
    ) -> Optional[Dict[str, Any]]:
        contract = self._get_contract()
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
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        amount_dec = _units_to_decimal(amount_units, self.token_decimals)
        rows = self._rest(
            "POST",
            "payments",
            params={"on_conflict": "tx_hash"},
            payload={
                "user_id": user_id,
                "amount": str(amount_dec),
                "currency": "USDC",
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
                "select": "id,expires_at,status",
                "user_id": f"eq.{user_id}",
                "status": "eq.active",
                "order": "expires_at.desc",
                "limit": "1",
            },
            allowed_status=[200],
        )
        starts = now
        if isinstance(latest_rows, list) and latest_rows:
            try:
                latest_exp = datetime.fromisoformat(str(latest_rows[0].get("expires_at")))
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
        return sub_rows[0] if isinstance(sub_rows, list) and sub_rows else {}

    def _notify_telegram(self, user_id: str, plan_code: str, amount_usdc: str, tx_hash: str) -> None:
        if not self.notify_telegram:
            return
        token = str(os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
        chat_id = str(os.getenv("TELEGRAM_CHAT_ID") or "").strip()
        if not token or not chat_id:
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
                    "chat_id": chat_id,
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
            return {"intent": intent.__dict__, "already_confirmed": True}
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

        try:
            tx = w3.eth.get_transaction(tx_hash_text)
        except Exception:
            raise PaymentCheckoutError(404, "tx not found on chain")

        tx_to = _normalize_address(tx.get("to"))
        tx_from = _normalize_address(tx.get("from"))
        if tx_to != intent.receiver_address:
            raise PaymentCheckoutError(
                400,
                f"tx to mismatch: got={tx_to} expected={intent.receiver_address}",
            )
        if intent.payment_mode == "strict" and intent.allowed_wallet:
            if tx_from != intent.allowed_wallet:
                raise PaymentCheckoutError(
                    400,
                    f"tx sender mismatch: got={tx_from} expected={intent.allowed_wallet}",
                )
        else:
            self._require_user_wallet(user_id, tx_from)

        receipt = self._wait_receipt(tx_hash_text)
        if int(receipt.get("status") or 0) != 1:
            raise PaymentCheckoutError(400, "tx reverted")

        block_number = int(receipt.get("blockNumber") or 0)
        latest_block = int(w3.eth.block_number)
        confirmations = max(0, latest_block - block_number + 1) if block_number else 0
        if confirmations < self.confirmations:
            raise PaymentCheckoutError(
                409, f"confirmations not enough: {confirmations}/{self.confirmations}"
            )

        event_match = self._extract_matching_event(receipt, intent)
        if not event_match:
            raise PaymentCheckoutError(
                400,
                "OrderPaid event mismatch; ensure contract emits OrderPaid(orderId,payer,planId,token,amount)",
            )

        now_iso = _to_iso(_now_utc())
        self._rest(
            "PATCH",
            "payment_intents",
            params={"id": f"eq.{intent.intent_id}", "user_id": f"eq.{user_id}"},
            payload={
                "status": "confirmed",
                "tx_hash": tx_hash_text,
                "confirmed_at": now_iso,
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
                "raw_tx": json.loads(Web3.to_json(tx)),
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
        }
        plan = self._select_plan(intent.plan_code)
        payment_row = self._insert_payment_record(
            user_id=user_id,
            tx_hash=tx_hash_text,
            amount_units=intent.amount_units,
            payload=payload,
        )
        subscription_row = self._grant_subscription(
            user_id=user_id,
            plan_code=intent.plan_code,
            duration_days=plan["duration_days"],
            tx_hash=tx_hash_text,
            payload=payload,
        )
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
            "tx": payload,
        }


PAYMENT_CHECKOUT = PaymentContractCheckoutService()
