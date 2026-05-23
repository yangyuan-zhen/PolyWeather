from __future__ import annotations

import os
from typing import List


def _split_chat_ids(raw: str | None) -> List[str]:
    if not raw:
        return []
    normalized = str(raw).replace("\r", ",").replace("\n", ",").replace(";", ",")
    out: List[str] = []
    for token in normalized.split(","):
        value = token.strip()
        if value:
            out.append(value)
    return out


def parse_telegram_chat_ids(*raw_values: str | None) -> List[str]:
    """Parse and de-duplicate chat ids while keeping original order."""
    out: List[str] = []
    seen: set[str] = set()
    for raw in raw_values:
        for chat_id in _split_chat_ids(raw):
            if chat_id in seen:
                continue
            seen.add(chat_id)
            out.append(chat_id)
    return out


def get_telegram_chat_ids_from_env() -> List[str]:
    """
    Preferred env is TELEGRAM_CHAT_IDS (comma-separated).
    TELEGRAM_CHAT_ID is kept for backward compatibility.
    """
    return parse_telegram_chat_ids(
        os.getenv("TELEGRAM_CHAT_IDS"),
        os.getenv("TELEGRAM_CHAT_ID"),
    )


def get_primary_telegram_chat_id_from_env() -> str:
    chat_ids = get_telegram_chat_ids_from_env()
    return chat_ids[0] if chat_ids else ""
