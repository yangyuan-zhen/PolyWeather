from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict

DEFAULT_POLYGON_CHAIN_ID = 137
DEFAULT_ETHEREUM_CHAIN_ID = 1
DEFAULT_ETHEREUM_USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
DEFAULT_USDC_E_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"
DEFAULT_NATIVE_USDC_ADDRESS = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359"
DEFAULT_USDT_ADDRESS = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f"

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

ERC20_TRANSFER_EVENT_ABI = {
    "anonymous": False,
    "inputs": [
        {"indexed": True, "name": "from", "type": "address"},
        {"indexed": True, "name": "to", "type": "address"},
        {"indexed": False, "name": "value", "type": "uint256"},
    ],
    "name": "Transfer",
    "type": "event",
}

DEFAULT_PLAN_CATALOG: Dict[str, Dict[str, Any]] = {
    "pro_monthly": {"plan_id": 101, "amount_usdc": "29.9", "duration_days": 30},
    "pro_quarterly": {"plan_id": 102, "amount_usdc": "79.9", "duration_days": 90},
}

REFERRAL_FIRST_MONTH_DISCOUNT_USDC = Decimal("9.9")

DEFAULT_POINTS_MAX_DISCOUNT_BY_PLAN: Dict[str, int] = {
    "pro_monthly": 3,
    "pro_quarterly": 8,
}
