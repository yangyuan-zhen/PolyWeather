from __future__ import annotations

import os


def _env_int(name: str, default: int, min_value: int = 0) -> int:
    raw = str(os.getenv(name, "")).strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return max(min_value, value)


MESSAGE_POINTS = _env_int("POLYWEATHER_BOT_MESSAGE_POINTS", 4, min_value=1)
MESSAGE_DAILY_CAP = _env_int("POLYWEATHER_BOT_MESSAGE_DAILY_CAP", 40, min_value=1)
MESSAGE_MIN_LENGTH = _env_int("POLYWEATHER_BOT_MESSAGE_MIN_LENGTH", 3, min_value=1)
MESSAGE_COOLDOWN_SEC = _env_int("POLYWEATHER_BOT_MESSAGE_COOLDOWN_SEC", 30, min_value=0)
# Optional per-chat override map, parsed in BotIOLayer:
# POLYWEATHER_BOT_MESSAGE_COOLDOWN_BY_CHAT="-1003586303099:10,-1003539418691:20"
CITY_QUERY_COST = _env_int("POLYWEATHER_BOT_CITY_QUERY_COST", 2, min_value=0)
DEB_QUERY_COST = _env_int("POLYWEATHER_BOT_DEB_QUERY_COST", 2, min_value=0)
