#!/usr/bin/env python3
"""Run versioned DEB backtests from runtime SQLite daily records."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.analysis.deb_evaluation import (  # noqa: E402
    backtest_deb_versions,
    flatten_daily_records,
    write_backtest_report,
)
from src.database.runtime_state import DailyRecordRepository, RuntimeStateDB  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(ROOT / "data" / "polyweather.db"))
    parser.add_argument(
        "--output-json",
        default=str(ROOT / "data" / "deb_backtest_latest.json"),
    )
    parser.add_argument(
        "--output-csv",
        default=str(ROOT / "data" / "deb_backtest_latest.csv"),
    )
    parser.add_argument("--train-lookback-days", type=int, default=30)
    parser.add_argument("--min-train-samples", type=int, default=2)
    args = parser.parse_args()

    db = RuntimeStateDB(args.db)
    daily_records = DailyRecordRepository(db).load_all()
    history = flatten_daily_records(daily_records)
    report = backtest_deb_versions(
        history,
        train_lookback_days=args.train_lookback_days,
        min_train_samples=args.min_train_samples,
    )
    write_backtest_report(
        report,
        json_path=args.output_json,
        csv_path=args.output_csv,
    )
    print(
        json.dumps(
            {
                "schema_version": report.get("schema_version"),
                "versions": report.get("versions"),
                "rows": len(report.get("rows") or []),
                "output_json": args.output_json,
                "output_csv": args.output_csv,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    if not report.get("rows"):
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
