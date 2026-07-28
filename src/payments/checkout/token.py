from __future__ import annotations

from typing import Any, Dict, List, Optional

from web3 import Web3

from src.payments.chain_config import (
    DEFAULT_ETHEREUM_CHAIN_ID,
    DEFAULT_ETHEREUM_USDC_ADDRESS,
    DEFAULT_NATIVE_USDC_ADDRESS,
    DEFAULT_POLYGON_CHAIN_ID,
    DEFAULT_USDC_E_ADDRESS,
    DEFAULT_USDT_ADDRESS,
)
from src.payments.checkout.models import PaymentCheckoutError, PaymentIntentRecord, PaymentTokenConfig


def _normalize_address(address: Any) -> str:
    text = str(address or "").strip()
    if not text or not Web3.is_address(text):
        return ""
    return Web3.to_checksum_address(text).lower()


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


class TokenMixin:
    def _token_key(self, chain_id: int, token_address: str) -> str:
        return f"{int(chain_id)}:{_normalize_address(token_address)}"

    def _chain_code_for(self, chain_id: int) -> str:
        if int(chain_id) == DEFAULT_ETHEREUM_CHAIN_ID:
            return "ethereum"
        if int(chain_id) == DEFAULT_POLYGON_CHAIN_ID:
            return "polygon"
        return f"chain_{int(chain_id)}"

    def _chain_name_for(self, chain_id: int) -> str:
        if int(chain_id) == DEFAULT_ETHEREUM_CHAIN_ID:
            return "Ethereum Mainnet"
        if int(chain_id) == DEFAULT_POLYGON_CHAIN_ID:
            return "Polygon"
        return f"Chain ID {int(chain_id)}"

    def _native_currency_for(self, chain_id: int) -> str:
        if int(chain_id) == DEFAULT_ETHEREUM_CHAIN_ID:
            return "ETH"
        if int(chain_id) == DEFAULT_POLYGON_CHAIN_ID:
            return "POL"
        return "ETH"

    def _explorer_base_for(self, chain_id: int) -> str:
        if int(chain_id) == DEFAULT_ETHEREUM_CHAIN_ID:
            return "https://etherscan.io"
        if int(chain_id) == DEFAULT_POLYGON_CHAIN_ID:
            return "https://polygonscan.com"
        return ""

    def _explorer_tx_url_for(self, chain_id: int) -> str:
        base = self._explorer_base_for(chain_id)
        return f"{base}/tx/{{tx_hash}}" if base else ""

    def _chain_ids(self) -> List[int]:
        ids = {int(token.chain_id) for token in self.supported_tokens.values()}
        ids.update(int(chain_id) for chain_id in self.rpc_urls_by_chain.keys())
        if self.default_chain_id:
            ids.add(int(self.default_chain_id))
        return sorted(ids)

    def _chain_label_for(self, chain_id: int) -> str:
        return self._chain_code_for(chain_id)

    def _tokens_for_chain(self, chain_id: int) -> List[PaymentTokenConfig]:
        return [
            token
            for token in self.supported_tokens.values()
            if int(token.chain_id) == int(chain_id)
        ]

    def _find_token_by_address(
        self, token_address: str, chain_id: Optional[int] = None
    ) -> Optional[PaymentTokenConfig]:
        normalized = _normalize_address(token_address)
        if not normalized:
            return None
        for token in self.supported_tokens.values():
            if token.address != normalized:
                continue
            if chain_id is not None and int(token.chain_id) != int(chain_id):
                continue
            return token
        return None

    def _default_token_meta(self, address: str) -> Dict[str, str]:
        normalized = _normalize_address(address)
        if normalized == _normalize_address(DEFAULT_ETHEREUM_USDC_ADDRESS):
            return {"code": "usdc", "symbol": "USDC", "name": "USDC"}
        if normalized == _normalize_address(DEFAULT_NATIVE_USDC_ADDRESS):
            return {"code": "usdc", "symbol": "USDC", "name": "Native USDC"}
        if normalized == _normalize_address(DEFAULT_USDT_ADDRESS):
            return {"code": "usdt", "symbol": "USDT", "name": "USDT"}
        if normalized == _normalize_address(DEFAULT_USDC_E_ADDRESS):
            return {"code": "usdc_e", "symbol": "USDC.e", "name": "USDC.e (PoS)"}
        short = f"{normalized[:6]}...{normalized[-4:]}"
        return {"code": f"token_{short}", "symbol": short, "name": short}

    def _to_token_config(
        self,
        row: Dict[str, Any],
        fallback_receiver_contract: str,
        fallback_direct_receiver_address: str,
        fallback_token_decimals: int,
    ) -> Optional[PaymentTokenConfig]:
        if not isinstance(row, dict):
            return None
        try:
            chain_id = int(row.get("chain_id") or row.get("network_id") or self.chain_id)
        except Exception:
            chain_id = int(self.chain_id)
        chain_code = str(
            row.get("chain_code") or row.get("network") or self._chain_code_for(chain_id)
        ).strip().lower()
        chain_name = str(
            row.get("chain_name") or row.get("network_name") or self._chain_name_for(chain_id)
        ).strip()
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
        direct_receiver_address = _normalize_address(
            row.get("direct_receiver_address")
            or row.get("direct_receiver")
            or fallback_direct_receiver_address
            or receiver_contract
        )
        if not receiver_contract and not direct_receiver_address:
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
        rpc_urls = self._load_rpc_urls(row.get("rpc_urls") or row.get("rpc_url") or "")
        explorer_tx_url = str(
            row.get("explorer_tx_url") or self._explorer_tx_url_for(chain_id)
        ).strip()
        try:
            confirmations_raw = row.get("confirmations")
            confirmations = (
                int(confirmations_raw) if confirmations_raw is not None else None
            )
        except Exception:
            confirmations = None
        supports_direct_transfer = _config_bool(
            row.get("supports_direct_transfer"),
            True,
        )
        contract_support_raw = row.get(
            "supports_contract_checkout",
            row.get("supports_contract"),
        )
        same_direct_receiver = bool(
            receiver_contract
            and direct_receiver_address
            and receiver_contract == direct_receiver_address
        )
        supports_contract_checkout = _config_bool(
            contract_support_raw,
            bool(chain_id == self.chain_id and receiver_contract and not same_direct_receiver),
        )
        return PaymentTokenConfig(
            code=code,
            symbol=symbol,
            name=name,
            address=address,
            decimals=decimals,
            chain_id=chain_id,
            chain_code=chain_code or self._chain_code_for(chain_id),
            chain_name=chain_name or self._chain_name_for(chain_id),
            receiver_contract=receiver_contract,
            direct_receiver_address=direct_receiver_address or receiver_contract,
            rpc_urls=rpc_urls,
            explorer_tx_url=explorer_tx_url,
            confirmations=confirmations,
            supports_contract_checkout=supports_contract_checkout,
            supports_direct_transfer=supports_direct_transfer,
            is_default=is_default,
        )

    def _load_supported_tokens(
        self,
        raw: str,
        *,
        fallback_receiver_contract: str,
        fallback_direct_receiver_address: str,
        fallback_token_address: str,
        fallback_token_decimals: int,
    ) -> Dict[str, PaymentTokenConfig]:
        import json as _json

        parsed_rows: List[Dict[str, Any]] = []
        text = str(raw or "").strip()
        if text:
            try:
                parsed = _json.loads(text)
            except Exception:
                parsed = None
            if isinstance(parsed, list):
                parsed_rows = [row for row in parsed if isinstance(row, dict)]
            elif isinstance(parsed, dict):
                if isinstance(parsed.get("tokens"), list):
                    parsed_rows = [
                        row
                        for row in parsed.get("tokens") or []
                        if isinstance(row, dict)
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
                fallback_direct_receiver_address=fallback_direct_receiver_address,
                fallback_token_decimals=fallback_token_decimals,
            )
            if not token:
                continue
            out[self._token_key(token.chain_id, token.address)] = token

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
            chain_id=int(self.chain_id),
            chain_code=self._chain_code_for(self.chain_id),
            chain_name=self._chain_name_for(self.chain_id),
            receiver_contract=fallback_receiver_contract,
            direct_receiver_address=fallback_direct_receiver_address
            or fallback_receiver_contract,
            rpc_urls=[],
            explorer_tx_url=self._explorer_tx_url_for(self.chain_id),
            confirmations=None,
            supports_contract_checkout=True,
            supports_direct_transfer=True,
            is_default=True,
        )
        return {self._token_key(fallback_token.chain_id, fallback_token.address): fallback_token}

    def _resolve_supported_token(
        self,
        token_address: Optional[str] = None,
        chain_id: Optional[int] = None,
    ) -> PaymentTokenConfig:
        selected_chain_id = int(chain_id) if chain_id is not None else None
        normalized = _normalize_address(token_address or "")
        if normalized:
            token = self._find_token_by_address(normalized, selected_chain_id)
            if token:
                return token
            available = ", ".join(
                f"{item.chain_code}/{item.symbol}:{item.address}"
                for item in self.supported_tokens.values()
            )
            raise PaymentCheckoutError(
                400,
                f"token_address not supported: {normalized}. available={available}",
            )
        if selected_chain_id is not None:
            chain_tokens = self._tokens_for_chain(selected_chain_id)
            default_for_chain = next(
                (token for token in chain_tokens if bool(token.is_default)),
                chain_tokens[0] if chain_tokens else None,
            )
            if default_for_chain:
                return default_for_chain
            raise PaymentCheckoutError(
                400, f"payment chain_id not supported: {selected_chain_id}"
            )
        default_token = self.supported_tokens.get(self.default_token_key)
        if default_token:
            return default_token
        raise PaymentCheckoutError(503, "no supported payment token configured")

    def _token_decimals_for(
        self, token_address: str, chain_id: Optional[int] = None
    ) -> int:
        token = self._find_token_by_address(token_address, chain_id)
        if token:
            return int(token.decimals)
        return int(self.token_decimals)

    def _token_symbol_for(
        self, token_address: str, chain_id: Optional[int] = None
    ) -> str:
        token = self._find_token_by_address(token_address, chain_id)
        if token and token.symbol:
            return str(token.symbol)
        normalized = _normalize_address(token_address)
        if normalized:
            return f"{normalized[:6]}...{normalized[-4:]}"
        return "Unknown"

    def _token_config_for_intent(
        self, intent: PaymentIntentRecord
    ) -> Optional[PaymentTokenConfig]:
        return self._find_token_by_address(intent.token_address, intent.chain_id)

    def _confirmations_for_chain(self, chain_id: int) -> int:
        chain_tokens = self._tokens_for_chain(chain_id)
        token_confirmations = next(
            (
                int(token.confirmations)
                for token in chain_tokens
                if token.confirmations is not None and int(token.confirmations) > 0
            ),
            None,
        )
        if token_confirmations:
            return max(1, int(token_confirmations))
        return int(self.confirmations)
