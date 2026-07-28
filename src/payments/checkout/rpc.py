from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from web3 import Web3

from src.payments.chain_config import PAYMENT_CONTRACT_ABI


def _normalize_address(address: Any) -> str:
    text = str(address or "").strip()
    if not text or not Web3.is_address(text):
        return ""
    return Web3.to_checksum_address(text).lower()


class RpcMixin:
    def _load_rpc_urls(self, raw: str) -> List[str]:
        out: List[str] = []
        if isinstance(raw, list):
            parts = raw
        else:
            parts = str(raw or "").split(",")
        for part in parts:
            url = str(part or "").strip()
            if url and url not in out:
                out.append(url)
        return out

    def _load_rpc_urls_by_chain(
        self,
        raw: str,
        *,
        default_chain_id: int,
        default_rpc_urls: List[str],
    ) -> Dict[int, List[str]]:
        out: Dict[int, List[str]] = {}
        if default_rpc_urls:
            out[int(default_chain_id)] = list(default_rpc_urls)
        text = str(raw or "").strip()
        if not text:
            return out
        try:
            parsed = json.loads(text)
        except Exception:
            return out
        if not isinstance(parsed, dict):
            return out
        for chain_id_raw, value in parsed.items():
            try:
                chain_id = int(chain_id_raw)
            except Exception:
                continue
            urls = self._load_rpc_urls(value)
            if not urls:
                continue
            out.setdefault(chain_id, [])
            for url in urls:
                if url not in out[chain_id]:
                    out[chain_id].append(url)
        return out

    def _build_web3(self, rpc_url: str) -> Web3:
        return Web3(
            Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": self.timeout_sec})
        )

    def _try_connect_rpc(self, rpc_url: str, chain_id: int) -> Optional[Web3]:
        try:
            w3 = self._build_web3(rpc_url)
            if not w3.is_connected():
                return None
            if int(w3.eth.chain_id) != int(chain_id):
                return None
            return w3
        except Exception:
            return None

    def _rotate_rpc(self, chain_id: Optional[int] = None) -> Optional[Web3]:
        target_chain_id = int(chain_id or self.default_chain_id or self.chain_id)
        for rpc_url in self.rpc_urls_by_chain.get(target_chain_id, []):
            w3 = self._try_connect_rpc(rpc_url, target_chain_id)
            if w3 is not None:
                self._w3_by_chain[target_chain_id] = w3
                self._w3_url_by_chain[target_chain_id] = rpc_url
                if target_chain_id == int(self.default_chain_id or self.chain_id):
                    self._w3 = w3
                    self._w3_url = rpc_url
                return w3
        self._w3_by_chain.pop(target_chain_id, None)
        self._w3_url_by_chain.pop(target_chain_id, None)
        if target_chain_id == int(self.default_chain_id or self.chain_id):
            self._w3 = None
            self._w3_url = ""
        return None

    def _get_web3(
        self,
        chain_id: Optional[int] = None,
        force_refresh: bool = False,
    ) -> Web3:
        target_chain_id = int(chain_id or self.default_chain_id or self.chain_id)
        with self._w3_lock:
            if self._w3_by_chain.get(target_chain_id) is None or force_refresh:
                self._rotate_rpc(target_chain_id)
        w3 = self._w3_by_chain.get(target_chain_id)
        assert w3 is not None
        return w3

    def get_rpc_runtime_status(self) -> Dict[str, Any]:
        default_chain_id = int(self.default_chain_id or self.chain_id)
        candidates = list(self.rpc_urls_by_chain.get(default_chain_id, []))
        chains = {
            str(chain_id): {
                "chain_id": chain_id,
                "chain_code": self._chain_code_for(chain_id),
                "chain_name": self._chain_name_for(chain_id),
                "configured_rpc_count": len(urls),
                "active_rpc_url": self._w3_url_by_chain.get(chain_id)
                or (urls[0] if urls else ""),
                "all_rpc_urls": list(urls),
            }
            for chain_id, urls in sorted(self.rpc_urls_by_chain.items())
        }
        return {
            "configured_rpc_count": len(candidates),
            "active_rpc_url": self._w3_url_by_chain.get(default_chain_id)
            or self._w3_url
            or (candidates[0] if candidates else ""),
            "all_rpc_urls": candidates,
            "chains": chains,
        }

    def _get_contract(
        self,
        receiver_address: Optional[str] = None,
        chain_id: Optional[int] = None,
    ):
        w3 = self._get_web3(chain_id=chain_id)
        contract_address = _normalize_address(
            receiver_address or self.receiver_contract
        )
        if not contract_address:
            contract_address = self.receiver_contract
        return w3.eth.contract(
            address=Web3.to_checksum_address(contract_address),
            abi=PAYMENT_CONTRACT_ABI,
        )
