"""Pydantic request models for PolyWeather payment endpoints."""

from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class WalletBindRequest(BaseModel):
    address: str = Field(..., min_length=8)


class WalletChallengeRequest(BaseModel):
    address: str = Field(..., min_length=8)


class WalletVerifyRequest(BaseModel):
    address: str = Field(..., min_length=8)
    nonce: str = Field(..., min_length=6)
    signature: str = Field(..., min_length=20)


class WalletUnbindRequest(BaseModel):
    address: str = Field(..., min_length=8)


class CreatePaymentIntentRequest(BaseModel):
    plan_code: str = Field(default="pro_monthly", min_length=2)
    payment_mode: str = Field(default="strict")
    allowed_wallet: Optional[str] = None
    token_address: Optional[str] = None
    chain_id: Optional[int] = None
    use_points: bool = False
    points_to_consume: Optional[int] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class SubmitPaymentTxRequest(BaseModel):
    tx_hash: str = Field(..., min_length=10)
    from_address: Optional[str] = None


class ValidatePaymentTxRequest(BaseModel):
    tx_hash: str = Field(..., min_length=10)


class ConfirmPaymentTxRequest(BaseModel):
    tx_hash: Optional[str] = None
