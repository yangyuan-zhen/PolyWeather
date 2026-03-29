from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMA_PATH = os.path.join(ROOT_DIR, "artifacts", "models", "lgbm_daily_high_schema.json")


def _load_schema(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise SystemExit(f"Invalid schema payload in {path}")
    return data


def _fmt_metric(value: Any) -> str:
    if value is None:
        return "--"
    try:
        return f"{float(value):.3f}"
    except Exception:
        return str(value)


def _winner(metrics: Dict[str, Any]) -> str:
    candidates = {
        "LGBM": metrics.get("lgbm_mae"),
        "DEB": metrics.get("deb_mae"),
        "Best Single": metrics.get("best_single_mae"),
        "Median": metrics.get("median_mae"),
    }
    filtered = {k: float(v) for k, v in candidates.items() if v is not None}
    if not filtered:
        return "--"
    return min(filtered.items(), key=lambda item: item[1])[0]


def _print_block(label: str, metrics: Dict[str, Any]) -> None:
    print(label)
    print(f"  Samples      : {metrics.get('sample_count', 0)}")
    print(f"  LGBM MAE     : {_fmt_metric(metrics.get('lgbm_mae'))}")
    print(f"  DEB MAE      : {_fmt_metric(metrics.get('deb_mae'))}")
    print(f"  Best Single  : {_fmt_metric(metrics.get('best_single_mae'))}")
    print(f"  Model Median : {_fmt_metric(metrics.get('median_mae'))}")
    print(f"  Winner       : {_winner(metrics)}")


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else SCHEMA_PATH
    if not os.path.exists(path):
        raise SystemExit(f"Schema file not found: {path}")

    schema = _load_schema(path)
    metrics = schema.get("metrics") or {}
    validation = metrics.get("validation") or {}
    full_sample = metrics.get("full_sample") or {}

    print("LightGBM Daily High Report")
    print(f"  Target       : {schema.get('target', '--')}")
    print(f"  Horizon      : {schema.get('horizon', '--')}")
    print(f"  Sample Count : {schema.get('sample_count', 0)}")
    print(f"  Train Count  : {schema.get('train_count', 0)}")
    print(f"  Valid Count  : {schema.get('validation_count', 0)}")
    print(f"  Trained At   : {schema.get('trained_at', '--')}")
    print("")
    _print_block("Validation", validation)
    print("")
    _print_block("Full Sample", full_sample)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
