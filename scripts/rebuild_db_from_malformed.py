"""Rebuild polyweather.db from prod backup + recoverable batches from malformed DB."""

import pathlib
import shutil
import sqlite3

src = pathlib.Path("data/polyweather.db")
prod = pathlib.Path("data/polyweather-prod.db")
dst = pathlib.Path("data/polyweather_rebuilt.db")
tmp = pathlib.Path("data/polyweather_rebuilt.tmp.db")

if dst.exists():
    dst.unlink()
if tmp.exists():
    tmp.unlink()

# Start from prod backup (clean)
shutil.copy(prod, tmp)
print(f"copied prod backup {prod.stat().st_size} -> {tmp}")

# Tables to recover
tables = [
    "intraday_path_snapshots_store",
    "probability_training_snapshots_store",
    "daily_records_store",
    "deb_normal_residual_stats_store",
    "city_observations_store",
]

src_con = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
dst_con = sqlite3.connect(str(tmp))
dst_con.execute("PRAGMA journal_mode=WAL")

for tbl in tables:
    try:
        # Get max id from src
        max_id = src_con.execute(f"SELECT MAX(id) FROM {tbl}").fetchone()[0]
        if max_id is None:
            print(f"{tbl}: no rows in src")
            continue
        print(f"{tbl}: max_id {max_id}")
        batch = 5000
        copied = 0
        bad = 0
        for start in range(1, int(max_id) + 1, batch):
            try:
                rows = src_con.execute(
                    f"SELECT * FROM {tbl} WHERE id BETWEEN ? AND ? ",
                    (start, start + batch - 1),
                ).fetchall()
                cols = [
                    d[0]
                    for d in src_con.execute(f"SELECT * FROM {tbl} LIMIT 0").description
                ]
                if not rows:
                    continue
                # Insert or replace
                placeholders = ",".join(["?"] * len(cols))
                dst_con.executemany(
                    f"INSERT OR REPLACE INTO {tbl} ({','.join(cols)}) VALUES ({placeholders})",
                    rows,
                )
                copied += len(rows)
            except sqlite3.DatabaseError as e:
                bad += 1
                print(f"  bad batch {start}: {e}")
                continue
        dst_con.commit()
        print(f"{tbl}: copied {copied} rows, {bad} bad batches")
        # Check integrity
        res = dst_con.execute("PRAGMA integrity_check").fetchone()[0]
        print(f"  integrity after {tbl}: {res[:100]}")
    except Exception as e:
        print(f"{tbl} err {e}")

dst_con.commit()
dst_con.close()
src_con.close()

# Final check
con = sqlite3.connect(str(tmp))
print("final integrity", con.execute("PRAGMA integrity_check").fetchone()[0])
con.close()

tmp.rename(dst)
print(f"rebuilt {dst} size {dst.stat().st_size}")
