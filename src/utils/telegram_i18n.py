import os
from typing import Optional


def normalize_push_language(raw: Optional[str]) -> str:
    value = str(raw or "").strip().lower().replace("_", "-")
    if value in {"zh", "zh-cn", "cn", "chinese"}:
        return "zh"
    if value in {"en", "en-us", "english"}:
        return "en"
    if value in {"both", "bilingual", "dual", "en-zh", "zh-en"}:
        return "both"
    return "both"


def telegram_push_language(*env_names: str, default: str = "both") -> str:
    names = env_names or (
        "TELEGRAM_PUSH_LANGUAGE",
        "POLYWEATHER_TELEGRAM_PUSH_LANGUAGE",
    )
    for name in names:
        raw = os.getenv(name)
        if raw:
            return normalize_push_language(raw)
    return normalize_push_language(default)


def is_zh(language: Optional[str]) -> bool:
    return normalize_push_language(language) == "zh"


def is_bilingual(language: Optional[str]) -> bool:
    return normalize_push_language(language) == "both"


def copy_text(language: Optional[str], en: str, zh: str) -> str:
    if is_zh(language):
        return zh
    if is_bilingual(language):
        return f"{en} / {zh}"
    return en
