"""Probe DEB training data availability.

Check which stores actually hold production rows, so the lead-time bias
analysis knows where to read first/last intraday predictions from.
"""

import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parent.parent / "data" / "polyweather.db"

TABLES = [
    "daily_records_store",
    "probability_training_snapshots_store",
    "training_feature_records_store",
    "intraday_path_snapshots_store",
    "truth_records_store",
    "deb_normal_residual_stats_store",
]


def probe(conn, table):
    cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]
    print(f"\n=== {table}")
    print(f"  cols: {cols}")
    n = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    print(f"  rows: {n}")
    if n == 0:
        return

    date_col = next((c for c in cols if c in ("target_date", "date", "snapshot_time")), None)
    if date_col:
        span = conn.execute(
            f"SELECT MIN({date_col}), MAX({date_col}) FROM {table}"
        ).fetchone()
        print(f"  {date_col} span: {span[0]} .. {span[1]}")

    if "city" in cols:
        cities = conn.execute(f"SELECT COUNT(DISTINCT city) FROM {table}").fetchone()[0]
        print(f"  distinct cities: {cities}")

    row = conn.execute(f"SELECT * FROM {table} ORDER BY rowid DESC LIMIT 1").fetchone()
    for c in cols:
        v = row[c] if row is not None else None
        s = str(v)
        if len(s) > 160:
            s = s[:160] + "..."
        print(f"    {c} = {s}")


def main():
    if not DB.exists():
        print(f"db not found: {DB}")
        return
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=30)
    conn.row_factory = sqlite3.Row
    existing = {
        r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    for t in TABLES:
        if t not in existing:
            print(f"\n=== {t}\n  MISSING")
            continue
        try:
            probe(conn, t)
        except Exception as exc:  # noqa: BLE001
            print(f"\n=== {t}\n  ERROR: {exc}")
    conn.close()


if __name__ == "__main__":
    main()
