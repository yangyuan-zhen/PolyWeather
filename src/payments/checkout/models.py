from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional


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
    chain_id: int
    chain_code: str
    chain_name: str
    receiver_contract: str
    direct_receiver_address: str
    rpc_urls: List[str]
    explorer_tx_url: str
    confirmations: Optional[int]
    supports_contract_checkout: bool
    supports_direct_transfer: bool
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
