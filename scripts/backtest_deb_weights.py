#!/usr/bin/env python3
"""Walk-forward backtest of DEB weight hyperparameters from runtime SQLite records.

Compares decay_factor / bias_penalty / lookback_days combinations against an
equal-weight baseline and writes a JSON + CSV report.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.analysis.deb_evaluation import (  # noqa: E402
    backtest_deb_weight_configs,
    write_weight_config_report,
)
from src.database.runtime_state import DailyRecordRepository, RuntimeStateDB  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(ROOT / "data" / "polyweather.db"))
    parser.add_argument(
        "--output-json",
        default=str(ROOT / "data" / "deb_weight_backtest_latest.json"),
    )
    parser.add_argument(
        "--output-csv",
        default=str(ROOT / "data" / "deb_weight_backtest_latest.csv"),
    )
    parser.add_argument("--min-history-days", type=int, default=2)
    args = parser.parse_args()

    db = RuntimeStateDB(args.db)
    daily_records = DailyRecordRepository(db).load_all()
    report = backtest_deb_weight_configs(
        daily_records,
        min_history_days=args.min_history_days,
    )
    write_weight_config_report(
        report,
        json_path=args.output_json,
        csv_path=args.output_csv,
    )
    print(
        json.dumps(
            {
                "schema_version": report.get("schema_version"),
                "configs": report.get("configs"),
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
