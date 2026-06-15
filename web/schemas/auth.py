"""Pydantic request models for PolyWeather auth-related endpoints."""

from typing import Optional

from pydantic import BaseModel, Field


class TelegramLoginRequest(BaseModel):
    id: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    username: Optional[str] = None
    photo_url: Optional[str] = None
    auth_date: int
    hash: str = Field(..., min_length=10)


class TelegramBindTokenRequest(BaseModel):
    token: str = Field(..., min_length=8)


class ReferralApplyRequest(BaseModel):
    code: str = Field(..., min_length=3, max_length=32)


class AnalyticsEventRequest(BaseModel):
    event_type: str = Field(..., min_length=3, max_length=64)
    client_id: Optional[str] = Field(default=None, max_length=128)
    session_id: Optional[str] = Field(default=None, max_length=128)
    payload: dict = Field(default_factory=dict)


class UserFeedbackRequest(BaseModel):
    category: str = Field(default="bug", min_length=2, max_length=40)
    message: str = Field(..., min_length=3, max_length=5000)
    source: str = Field(default="terminal", max_length=40)
    contact: Optional[str] = Field(default=None, max_length=180)
    context: dict = Field(default_factory=dict)


class GrantPointsRequest(BaseModel):
    email: str = Field(..., min_length=3)
    points: int = Field(..., gt=0, le=100000)


class FeedbackRewardRequest(BaseModel):
    points: int = Field(..., gt=0, le=100000)
    reason: str = Field(default="", max_length=500)
