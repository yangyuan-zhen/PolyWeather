from __future__ import annotations

import hashlib
import hmac
import os
import time
from decimal import Decimal
from typing import Any, Dict, Optional

import requests

from src.utils.telegram_chat_ids import parse_telegram_chat_ids

TELEGRAM_MEMBER_STATUSES = {"creator", "administrator", "member"}


def _format_decimal(value: Decimal) -> str:
    text = format(value.normalize(), "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def _decimal_env(name: str, default: str) -> Decimal:
    raw = str(os.getenv(name) or default).strip()
    try:
        return Decimal(raw)
    except Exception:
        return Decimal(default)


def _telegram_data_check_string(payload: Dict[str, Any]) -> str:
    items = []
    for key in sorted(payload.keys()):
        if key == "hash":
            continue
        value = payload.get(key)
        if value is None:
            continue
        items.append(f"{key}={value}")
    return "\n".join(items)


def verify_telegram_login_payload(
    payload: Dict[str, Any],
    bot_token: str,
    *,
    max_age_sec: int = 86400,
) -> Dict[str, Any]:
    token = str(bot_token or "").strip()
    if not token:
        raise ValueError("telegram bot token missing")
    expected_hash = str(payload.get("hash") or "").strip().lower()
    if not expected_hash:
        raise ValueError("telegram login hash missing")
    data_check = _telegram_data_check_string(payload)
    secret = hashlib.sha256(token.encode("utf-8")).digest()
    actual_hash = hmac.new(
        secret,
        data_check.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(actual_hash, expected_hash):
        raise ValueError("invalid telegram login hash")
    try:
        auth_date = int(payload.get("auth_date") or 0)
    except Exception as exc:
        raise ValueError("invalid telegram auth_date") from exc
    if auth_date <= 0:
        raise ValueError("invalid telegram auth_date")
    if max_age_sec > 0 and int(time.time()) - auth_date > max_age_sec:
        raise ValueError("telegram login payload expired")
    try:
        telegram_id = int(payload.get("id") or 0)
    except Exception as exc:
        raise ValueError("invalid telegram id") from exc
    if telegram_id <= 0:
        raise ValueError("invalid telegram id")
    return {
        "telegram_id": telegram_id,
        "username": str(payload.get("username") or "").strip(),
        "first_name": str(payload.get("first_name") or "").strip(),
        "last_name": str(payload.get("last_name") or "").strip(),
        "photo_url": str(payload.get("photo_url") or "").strip(),
        "auth_date": auth_date,
    }


class TelegramGroupPricing:
    def __init__(self) -> None:
        self.bot_token = str(os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
        dedicated_group_chat_ids = parse_telegram_chat_ids(
            os.getenv("POLYWEATHER_TELEGRAM_GROUP_ID"),
            os.getenv("POLYWEATHER_TELEGRAM_GROUP_IDS"),
        )
        fallback_group_chat_ids = parse_telegram_chat_ids(
            os.getenv("TELEGRAM_CHAT_IDS"),
            os.getenv("TELEGRAM_CHAT_ID"),
        )
        self.group_chat_ids = dedicated_group_chat_ids or fallback_group_chat_ids
        self.member_price = _decimal_env("POLYWEATHER_GROUP_MEMBER_PRICE_USDC", "5")
        self.public_price = _decimal_env("POLYWEATHER_PUBLIC_PRICE_USDC", "10")
        self.timeout_sec = max(
            2,
            int(str(os.getenv("POLYWEATHER_TELEGRAM_HTTP_TIMEOUT_SEC") or "8").strip() or "8"),
        )

    @property
    def configured(self) -> bool:
        return bool(self.bot_token and self.group_chat_ids)

    def verify_login_payload(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        max_age = int(str(os.getenv("POLYWEATHER_TELEGRAM_LOGIN_MAX_AGE_SEC") or "86400"))
        return verify_telegram_login_payload(payload, self.bot_token, max_age_sec=max_age)

    def get_member_status(self, telegram_id: int) -> Optional[str]:
        if not self.configured:
            return None
        for chat_id in self.group_chat_ids:
            try:
                response = requests.get(
                    f"https://api.telegram.org/bot{self.bot_token}/getChatMember",
                    params={"chat_id": chat_id, "user_id": int(telegram_id)},
                    timeout=self.timeout_sec,
                )
                data = response.json()
            except Exception:
                continue
            if not isinstance(data, dict) or not data.get("ok"):
                continue
            result = data.get("result")
            if not isinstance(result, dict):
                continue
            status = str(result.get("status") or "").strip().lower()
            if status:
                return status
        return None

    def resolve_price_for_telegram_id(self, telegram_id: Optional[int]) -> Dict[str, Any]:
        status = self.get_member_status(int(telegram_id or 0)) if telegram_id else None
        is_member = bool(status in TELEGRAM_MEMBER_STATUSES)
        amount = self.member_price if is_member else self.public_price
        return {
            "configured": self.configured,
            "telegram_id": int(telegram_id or 0) or None,
            "telegram_status": status,
            "is_group_member": is_member,
            "amount_usdc": _format_decimal(amount),
            "pricing_source": "telegram_group_member" if is_member else "telegram_public",
        }
