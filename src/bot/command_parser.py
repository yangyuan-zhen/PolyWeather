from __future__ import annotations

import re
import unicodedata
from typing import Any
from typing import Iterable
from typing import Tuple

_SLASH_CHARS = "/／⁄∕╱⧸"
_COMMAND_RE = re.compile(
    rf"^[\s\u00A0]*[{re.escape(_SLASH_CHARS)}]\s*([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?",
    flags=re.ASCII,
)


def _clean_text(text: str | None) -> str:
    raw = str(text or "")
    if not raw:
        return ""
    cleaned: list[str] = []
    for ch in raw:
        code = ord(ch)
        if 0xFE00 <= code <= 0xFE0F:
            continue
        if 0xE0100 <= code <= 0xE01EF:
            continue
        if unicodedata.category(ch) == "Cf":
            continue
        cleaned.append(ch)
    normalized = "".join(cleaned).strip()
    if not normalized:
        return ""
    for slash in ("／", "⁄", "∕", "╱", "⧸"):
        normalized = normalized.replace(slash, "/")
    return normalized


def _parse_command_token(text: str | None) -> Tuple[str, str]:
    normalized = _clean_text(text)
    if not normalized:
        return ("", "")
    match = _COMMAND_RE.match(normalized)
    if not match:
        return ("", "")
    command = str(match.group(1) or "").strip().lower()
    username = str(match.group(2) or "").strip().lower()
    return (command, username)


def extract_command_token(
    text: str | None,
    entities: Iterable[Any] | None = None,
) -> Tuple[str, str]:
    raw = str(text or "")
    if entities:
        for entity in entities:
            if str(getattr(entity, "type", "") or "").strip() != "bot_command":
                continue
            try:
                offset = int(getattr(entity, "offset", 0) or 0)
                length = int(getattr(entity, "length", 0) or 0)
            except Exception:
                continue
            if length <= 0:
                continue
            fragment = raw[offset : offset + length]
            command, username = _parse_command_token(fragment)
            if command:
                return (command, username)
    return _parse_command_token(raw)


def extract_command_name(text: str | None, entities: Iterable[Any] | None = None) -> str:
    return extract_command_token(text, entities)[0]


def looks_like_slash_command(text: str | None) -> bool:
    normalized = _clean_text(text)
    if not normalized:
        return False
    return normalized[:1] == "/"


def split_command_and_args(text: str | None) -> Tuple[str, str]:
    normalized = _clean_text(text)
    if not normalized:
        return ("", "")
    match = _COMMAND_RE.match(normalized)
    if not match:
        return ("", "")
    command = str(match.group(1) or "").strip().lower()
    rest = normalized[match.end() :].lstrip()
    return (command, rest)

