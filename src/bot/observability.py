from __future__ import annotations

from time import perf_counter
from typing import Any

from loguru import logger


def _safe_attr(obj: Any, attr: str, default: Any = None) -> Any:
    try:
        return getattr(obj, attr, default)
    except Exception:
        return default


class CommandTrace:
    """Small helper for structured command logs."""

    def __init__(self, command: str, message: Any):
        self.command = command
        self.user_id = _safe_attr(_safe_attr(message, "from_user"), "id", "unknown")
        self.chat_id = _safe_attr(_safe_attr(message, "chat"), "id", "unknown")
        self.start = perf_counter()
        self.status = "ok"
        self.note = ""

    def set_status(self, status: str, note: str = "") -> None:
        self.status = status
        self.note = note

    def emit(self) -> None:
        elapsed_ms = (perf_counter() - self.start) * 1000.0
        note_part = f" note={self.note}" if self.note else ""
        logger.info(
            "bot command command={} status={} user_id={} chat_id={} elapsed_ms={:.1f}{}",
            self.command,
            self.status,
            self.user_id,
            self.chat_id,
            elapsed_ms,
            note_part,
        )

