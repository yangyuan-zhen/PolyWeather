from __future__ import annotations

from typing import Any

from src.bot.io_layer import BotIOLayer


class ActivityHandler:
    def __init__(self, bot: Any, io_layer: BotIOLayer):
        self.bot = bot
        self.io_layer = io_layer

    def register(self) -> None:
        @self.bot.message_handler(func=lambda message: True, content_types=["text"])
        def _activity(message):
            self.handle(message)

    def handle(self, message: Any) -> None:
        text = str(getattr(message, "text", "") or "")
        normalized = text
        for marker in (
            "\ufeff",
            "\u200b",
            "\u200c",
            "\u200d",
            "\u2060",
            "\u2066",
            "\u2067",
            "\u2068",
            "\u2069",
        ):
            normalized = normalized.replace(marker, "")
        normalized = normalized.lstrip()
        if normalized.startswith("/") or normalized.startswith("／"):
            return
        self.io_layer.track_group_text_activity(message)
