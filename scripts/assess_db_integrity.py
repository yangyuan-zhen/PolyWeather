"""Assess SQLite corruption scope before attempting a rebuild.

Read-only. Scans every table in rowid batches and reports how many rows are
readable and which id ranges sit on damaged pages. Run this BEFORE choosing a
rebuild strategy: a single bad page does not justify a full rebuild.

Usage:
    python scripts/assess_db_integrity.py [db_path]
"""

import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BATCH = 2000


def scan_table(conn, table, cols):
    """Return (readable, bad_batches, first_bad_ranges)."""
    try:
        total = conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
    except sqlite3.DatabaseError as exc:
        return None, -1, [f"COUNT failed: {exc}"]
    if total == 0:
        return 0, 0, []

    try:
        max_rowid = conn.execute(
            f'SELECT MAX(rowid) FROM "{table}"'
        ).fetchone()[0]
    except sqlite3.DatabaseError:
        max_rowid = total

    if max_rowid is None:
        max_rowid = total

    readable = 0
    bad = []
    start = 1
    while start <= int(max_rowid):
        end = start + BATCH - 1
        try:
            rows = conn.execute(
                f'SELECT * FROM "{table}" WHERE rowid BETWEEN ? AND ?',
                (start, end),
            ).fetchall()
            readable += len(rows)
        except sqlite3.DatabaseError:
            bad.append((start, end))
        start = end + 1
    return readable, len(bad), bad[:5]


def main():
    db = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "polyweather.db"
    if not db.exists():
        print(f"not found: {db}")
        return

    size_mb = db.stat().st_size / 1024 / 1024
    print(f"database : {db}")
    print(f"size     : {size_mb:,.1f} MB")
    print(f"batch    : {BATCH} rowids\n")

    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=60)
    conn.row_factory = sqlite3.Row
    tables = [
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
    ]

    print(f"{'table':42s} {'total':>9s} {'read':>9s} {'bad':>5s}  first bad ranges")
    print("-" * 100)

    summary = []
    for t in tables:
        if t.startswith("sqlite_"):
            continue
        cols = [r[1] for r in conn.execute(f'PRAGMA table_info("{t}")')]
        try:
            total = conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        except sqlite3.DatabaseError:
            total = -1
        t0 = time.time()
        readable, nbad, ranges = scan_table(conn, t, cols)
        dt = time.time() - t0
        rng = ", ".join(f"{a}-{b}" for a, b in ranges) if ranges else ""
        print(
            f"{t:42s} {total:9d} {(readable if readable is not None else -1):9d} "
            f"{nbad:5d}  {rng}"
        )
        if nbad:
            summary.append((t, total, readable, nbad, dt))

    conn.close()

    print("\n=== damaged tables")
    if not summary:
        print("  none detected by rowid scan")
        return
    for t, total, readable, nbad, dt in summary:
        lost = (total - readable) if readable is not None and total > 0 else -1
        print(
            f"  {t}: {nbad} bad batches, ~{lost} rows unreadable "
            f"(of {total}) in {dt:.1f}s"
        )
    print(
        "\nNote: COUNT(*) may itself fail on a damaged table; a rowid scan is"
        "\nthe reliable signal. Rebuild only if unreadable rows matter."
    )


if __name__ == "__main__":
    main()
