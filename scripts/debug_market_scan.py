from __future__ import annotations

import argparse
import importlib
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _safe_float(value: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _bucket_from_temp(value: Optional[str]) -> Optional[Dict[str, Any]]:
    temp = _safe_float(value)
    if temp is None:
        return None
    return {
        "value": temp,
        "temp": temp,
        "label": f"{temp:g}°C",
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Print a read-only Polymarket market-scan diagnostic payload.",
    )
    parser.add_argument("--city", required=True, help="City key or display name.")
    parser.add_argument("--date", required=True, help="Target date, YYYY-MM-DD.")
    parser.add_argument(
        "--bucket-temp",
        help="Optional model/probability bucket temperature in Celsius.",
    )
    parser.add_argument(
        "--model-probability",
        help="Optional model probability. Accepts 0-1 or 0-100.",
    )
    parser.add_argument(
        "--market-slug",
        help="Optional Polymarket event/market slug.",
    )
    parser.add_argument(
        "--debug-log",
        action="store_true",
        help="Also enable POLYMARKET_MARKET_SCAN_DEBUG for this process.",
    )
    args = parser.parse_args()

    if args.debug_log:
        os.environ["POLYMARKET_MARKET_SCAN_DEBUG"] = "true"

    model_probability = _safe_float(args.model_probability)
    if model_probability is not None and model_probability > 1.0:
        model_probability = model_probability / 100.0

    module = importlib.import_module("src.data_collection.polymarket_readonly")
    layer = module.PolymarketReadOnlyLayer()
    scan = layer.build_market_scan(
        city=args.city,
        target_date=args.date,
        temperature_bucket=_bucket_from_temp(args.bucket_temp),
        model_probability=model_probability,
        forced_market_slug=args.market_slug,
    )

    print(json.dumps(scan, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
