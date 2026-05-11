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
CITY_QUERY_COST = _env_int("POLYWEATHER_BOT_CITY_QUERY_COST", 0, min_value=0)
DEB_QUERY_COST = _env_int("POLYWEATHER_BOT_DEB_QUERY_COST", 0, min_value=0)
CITY_DAILY_FREE_LIMIT = _env_int("POLYWEATHER_BOT_CITY_DAILY_FREE_LIMIT", 10, min_value=1)
DEB_DAILY_FREE_LIMIT = _env_int("POLYWEATHER_BOT_DEB_DAILY_FREE_LIMIT", 10, min_value=1)

FIRST_MESSAGE_BONUS = _env_int("POLYWEATHER_BOT_FIRST_MESSAGE_BONUS", 2, min_value=0)
WELCOME_BONUS = _env_int("POLYWEATHER_BOT_WELCOME_BONUS", 20, min_value=0)

WEEKLY_PARTICIPATION_BONUS = _env_int("POLYWEATHER_BOT_WEEKLY_PARTICIPATION_BONUS", 5, min_value=0)
WEEKLY_ACTIVE_BONUS = _env_int("POLYWEATHER_BOT_WEEKLY_ACTIVE_BONUS", 15, min_value=0)
WEEKLY_ACTIVE_THRESHOLD = _env_int("POLYWEATHER_BOT_WEEKLY_ACTIVE_THRESHOLD", 20, min_value=1)
