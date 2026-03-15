from __future__ import annotations

from typing import Any

from loguru import logger

from src.bot.command_parser import extract_command_name
from src.bot.command_parser import looks_like_slash_command
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
        if looks_like_slash_command(text):
            if not getattr(message, "_pw_command_handled", False):
                command = extract_command_name(
                    getattr(message, "text", None),
                    getattr(message, "entities", None),
                )
                logger.warning(
                    "command fell through handlers chat_id={} thread_id={} user_id={} command={} text={!r}",
                    getattr(getattr(message, "chat", None), "id", None),
                    getattr(message, "message_thread_id", None),
                    getattr(getattr(message, "from_user", None), "id", None),
                    command or "-",
                    text,
                )
            return
        self.io_layer.track_group_text_activity(message)
