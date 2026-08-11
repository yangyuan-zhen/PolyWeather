"""Shared helpers for training-history restore scripts.

Extracted from the removed ``scripts/fit_probability_calibration.py`` so that
``restore_training_truth_history.py`` and
``backfill_recent_daily_actuals_from_metar.py`` no longer import a deleted module.
"""

import json
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from src.analysis.deb_algorithm import load_history  # noqa: E402
from src.database.runtime_state import (  # noqa: E402
    DailyRecordRepository,
    STATE_STORAGE_FILE,
    STATE_STORAGE_SQLITE,
    get_state_storage_mode,
)


def _load_json_if_exists(path):
    if not path or not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    return data if isinstance(data, dict) else {}


def _legacy_history_path():
    return os.path.join(PROJECT_ROOT, "data", "daily_records.json")


def _default_history_arg():
    return _legacy_history_path() if get_state_storage_mode() == STATE_STORAGE_FILE else None


def _load_history_with_fallback(path):
    if not path:
        if get_state_storage_mode() == STATE_STORAGE_SQLITE:
            return DailyRecordRepository().load_all()
        return {}
    data = _load_json_if_exists(path)
    if data:
        return data
    return load_history(path)
