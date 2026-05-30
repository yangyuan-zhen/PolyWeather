"""Runtime secret lookup helpers.

Secrets rotated from the ops UI live in the shared SQLite database so backend
processes can pick them up without host-level Docker access. Environment
variables remain the fallback source for bootstrapping and local development.
"""

from __future__ import annotations

import os
from typing import Any

from src.database.db_manager import DBManager


def get_runtime_secret(key: str) -> str:
    normalized_key = str(key or "").strip()
    if not normalized_key:
        return ""
    try:
        stored = DBManager().get_runtime_secret(normalized_key)
    except Exception:
        stored = None
    if stored:
        return str(stored).strip()
    return str(os.getenv(normalized_key) or "").strip()


def get_runtime_secret_status(key: str) -> dict[str, Any]:
    normalized_key = str(key or "").strip()
    if not normalized_key:
        return {
            "key": "",
            "configured": False,
            "masked": "",
            "updated_at": "",
            "updated_by": "",
            "source": "runtime_store",
        }
    try:
        metadata = DBManager().get_runtime_secret_metadata(normalized_key)
    except Exception:
        metadata = {}
    if isinstance(metadata, dict) and metadata.get("configured"):
        return metadata

    env_value = str(os.getenv(normalized_key) or "").strip()
    if not env_value:
        return {
            "key": normalized_key,
            "configured": False,
            "masked": "",
            "updated_at": "",
            "updated_by": "",
            "source": "runtime_store",
        }
    return {
        "key": normalized_key,
        "configured": True,
        "masked": DBManager._mask_secret_value(env_value),
        "length": len(env_value),
        "updated_at": "",
        "updated_by": "",
        "source": "environment",
    }
