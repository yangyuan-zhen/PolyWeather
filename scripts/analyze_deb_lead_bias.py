"""Quantify the DEB lead-time bias.

Training reads the *last* intraday snapshot of a day (daily_records_store /
training_feature_records_store are upserted on every analysis call), so the
historical MAE that drives model weights and the residual sigma that drives
probabilities are both measured on near-zero-lead predictions. Production
inference, however, happens in the morning with 12-24h lead.

This script rebuilds the same error statistics per snapshot hour so the two
regimes can be compared directly.

All math is done in Celsius; Fahrenheit cities are converted.
"""

import json
import sqlite3
import statistics
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

DB = ROOT / "data" / "polyweather.db"


def fahrenheit_cities() -> set:
    try:
        from src.data_collection.city_registry import CITY_REGISTRY

        return {
            str(c).strip().lower()
            for c, m in (CITY_REGISTRY or {}).items()
            if m.get("use_fahrenheit")
        }
    except Exception as exc:  # noqa: BLE001
        print(f"warning: falling back to empty fahrenheit set ({exc})")
        return set()


def to_c(value: float, is_f: bool) -> float:
    return (value - 32.0) * 5.0 / 9.0 if is_f else value


def group_key(snapshot_time: str, target_date: str) -> str:
    """Bucket by (day offset vs target, local hour of snapshot)."""
    snap_date = (snapshot_time or "")[:10]
    hour = "??"
    tail = (snapshot_time or "")[11:13]
    if tail.isdigit():
        hour = tail
    if not snap_date or snap_date == target_date:
        return f"D0_{hour}h"
    if snap_date < target_date:
        return f"D-1_{hour}h"
    return f"D+_{hour}h"


def mad_sigma(values):
    """Same estimator production uses: deb_probability._robust_sigma."""
    if len(values) < 2:
        return 0.5
    med = statistics.median(values)
    mad = statistics.median([abs(v - med) for v in values])
    if mad <= 0:
        return 0.5
    return max(1.4826 * 1.05 * mad, 0.5)


def summarize(residuals):
    abs_err = [abs(r) for r in residuals]
    return {
        "n": len(residuals),
        "mae": statistics.mean(abs_err),
        "bias": statistics.mean(residuals),
        "rmse": (statistics.mean([r * r for r in residuals])) ** 0.5,
        "sigma": statistics.pstdev(residuals) if len(residuals) > 1 else 0.0,
        "mad_sigma": mad_sigma(residuals),
    }


def main():
    f_cities = fahrenheit_cities()
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=60)
    conn.row_factory = sqlite3.Row

    # Settled truth: authoritative, reconciled from official settlement source.
    truth = {}
    for row in conn.execute(
        "SELECT city, target_date, actual_high FROM daily_records_store "
        "WHERE actual_high IS NOT NULL"
    ):
        city = str(row["city"]).strip().lower()
        try:
            truth[(city, row["target_date"])] = to_c(float(row["actual_high"]), city in f_cities)
        except (TypeError, ValueError):
            continue
    print(f"truth rows: {len(truth)}")

    # How many training samples can `load_earliest_lead_days` actually label?
    # Both stores are upserted per (city, date), so the join below mirrors the
    # set of rows _walk_forward_deb_residuals would iterate.
    lead_pairs = conn.execute(
        "SELECT COUNT(*) FROM ("
        "  SELECT DISTINCT city, target_date FROM probability_training_snapshots_store"
        ")"
    ).fetchone()[0]
    labelled = conn.execute(
        "SELECT COUNT(*) FROM ("
        "  SELECT DISTINCT s.city, s.target_date "
        "  FROM probability_training_snapshots_store s "
        "  JOIN daily_records_store d "
        "    ON d.city = s.city AND d.target_date = s.target_date "
        "  WHERE d.actual_high IS NOT NULL"
        ")"
    ).fetchone()[0]
    trainable = conn.execute(
        "SELECT COUNT(*) FROM daily_records_store WHERE actual_high IS NOT NULL"
    ).fetchone()[0]
    print("\n=== lead-labelling coverage (probability_training_snapshots_store)")
    print(f"  distinct (city,date) in snapshot store : {lead_pairs}")
    print(f"  ...that also have settled truth        : {labelled}")
    print(f"  total training samples with truth      : {trainable}")
    print(f"  lead coverage                          : {labelled / trainable:.1%}")
    print("  -> every uncovered sample falls back to lead=1 in "
          "_walk_forward_deb_residuals")

    # Baseline: the value training actually consumes (last snapshot of the day).
    baseline = []
    for row in conn.execute(
        "SELECT city, target_date, deb_prediction FROM daily_records_store "
        "WHERE deb_prediction IS NOT NULL AND actual_high IS NOT NULL"
    ):
        city = str(row["city"]).strip().lower()
        key = (city, row["target_date"])
        if key not in truth:
            continue
        try:
            pred = to_c(float(row["deb_prediction"]), city in f_cities)
        except (TypeError, ValueError):
            continue
        baseline.append(truth[key] - pred)

    # Per-snapshot-hour residuals from the intraday path archive.
    buckets = defaultdict(list)
    by_cd = defaultdict(list)
    scanned = 0
    # The main DB has corrupt pages, so scan in id ranges and skip damaged
    # batches rather than aborting the whole run.
    max_id = conn.execute(
        "SELECT MAX(id) FROM intraday_path_snapshots_store"
    ).fetchone()[0] or 0
    batch = 5000
    bad_batches = []
    for start in range(1, int(max_id) + 1, batch):
        try:
            rows = conn.execute(
                "SELECT city, target_date, snapshot_time, deb_prediction "
                "FROM intraday_path_snapshots_store "
                "WHERE id BETWEEN ? AND ? AND deb_prediction IS NOT NULL",
                (start, start + batch - 1),
            ).fetchall()
        except sqlite3.DatabaseError:
            bad_batches.append(start)
            continue
        for row in rows:
            scanned += 1
            city = str(row["city"]).strip().lower()
            key = (city, row["target_date"])
            actual = truth.get(key)
            if actual is None:
                continue
            try:
                pred = to_c(float(row["deb_prediction"]), city in f_cities)
            except (TypeError, ValueError):
                continue
            snap_time = row["snapshot_time"] or ""
            buckets[group_key(snap_time, row["target_date"])].append(actual - pred)
            by_cd[key].append((snap_time, pred))
    conn.close()
    if bad_batches:
        print(f"  ! skipped {len(bad_batches)} corrupt id batches")
    print(f"snapshots scanned: {scanned}, matched to truth: {sum(len(v) for v in buckets.values())}")

    print("\n=== baseline (what training sees: last snapshot of the day)")
    b = summarize(baseline)
    print(
        f"  n={b['n']}  MAE={b['mae']:.2f}  bias={b['bias']:+.2f}  "
        f"RMSE={b['rmse']:.2f}  sigma={b['sigma']:.2f}"
    )

    print("\n=== residual stats by snapshot timing (truth - prediction, Celsius)")
    print(
        f"  {'bucket':10s} {'n':>6s} {'MAE':>7s} {'bias':>7s} {'RMSE':>7s} "
        f"{'pstdev':>7s} {'MAD-s':>7s}"
    )
    for key in sorted(buckets):
        if len(buckets[key]) < 30:
            continue
        s = summarize(buckets[key])
        print(
            f"  {key:10s} {s['n']:6d} {s['mae']:7.2f} {s['bias']:+7.2f} "
            f"{s['rmse']:7.2f} {s['sigma']:7.2f} {s['mad_sigma']:7.2f}"
        )

    # --- paired: same (city, date), first snapshot vs last snapshot ---------
    first_res, last_res = [], []
    for key, snaps in by_cd.items():
        actual = truth.get(key)
        if actual is None or len(snaps) < 2:
            continue
        snaps.sort(key=lambda x: x[0])
        first_res.append(actual - snaps[0][1])
        last_res.append(actual - snaps[-1][1])

    print("\n=== paired: first vs last snapshot of the SAME (city, date)")
    fs, ls = summarize(first_res), summarize(last_res)
    print(f"  {'':8s} {'n':>6s} {'MAE':>7s} {'bias':>7s} {'sigma':>7s}")
    print(
        f"  {'first':8s} {fs['n']:6d} {fs['mae']:7.2f} {fs['bias']:+7.2f} {fs['sigma']:7.2f}"
    )
    print(
        f"  {'last':8s} {ls['n']:6d} {ls['mae']:7.2f} {ls['bias']:+7.2f} {ls['sigma']:7.2f}"
    )
    if ls["sigma"]:
        print(
            f"  sigma ratio first/last: {fs['sigma'] / ls['sigma']:.2f}x "
            f"({fs['sigma'] / ls['sigma'] - 1:+.1%})"
        )
        print(
            f"  MAE  ratio first/last : {fs['mae'] / ls['mae']:.2f}x "
            f"({fs['mae'] / ls['mae'] - 1:+.1%})"
        )
    print(
        f"  MAD-sigma (production estimator): first={fs['mad_sigma']:.2f}  "
        f"last={ls['mad_sigma']:.2f}  "
        f"ratio={fs['mad_sigma'] / ls['mad_sigma']:.2f}x"
    )

    # --- what sigma production actually uses, and lead label distribution ---
    from datetime import datetime

    print("\n=== sigma in production (deb_normal_residual_stats_store)")
    conn2 = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=60)
    conn2.row_factory = sqlite3.Row
    for row in conn2.execute(
        "SELECT lead_sigmas_json, temp_sigmas_json, samples, window_days "
        "FROM deb_normal_residual_stats_store WHERE stats_key = 'global'"
    ):
        print(f"  samples={row['samples']}  window_days={row['window_days']}")
        prod_lead_sigmas = json.loads(row["lead_sigmas_json"] or "{}")
        print(f"  lead_sigmas: {prod_lead_sigmas}")
        for lead, bucket in sorted(json.loads(row["temp_sigmas_json"] or "{}").items()):
            print(f"  temp_sigmas[lead={lead}]: {bucket}")

    print("\n=== lead label distribution available to training")
    dist = defaultdict(int)
    for row in conn2.execute(
        "SELECT city, target_date, MIN(timestamp) AS first_ts "
        "FROM probability_training_snapshots_store GROUP BY city, target_date"
    ):
        try:
            ts = datetime.fromisoformat(str(row["first_ts"]).replace("Z", "+00:00"))
            tgt = datetime.strptime(str(row["target_date"])[:10], "%Y-%m-%d")
            dist[(tgt.date() - ts.date()).days] += 1
        except Exception:  # noqa: BLE001
            continue
    for k in sorted(dist):
        print(f"  lead={k}d : {dist[k]} (city,date) pairs")
    conn2.close()

    # Bottom line: what production assumes vs what each timing really needs.
    p1 = prod_lead_sigmas.get("1") if prod_lead_sigmas else None
    if p1:
        print(f"\n=== production sigma (lead=1) = {p1:.2f} vs measured MAD-sigma")
        print(f"  {'bucket':10s} {'measured':>9s} {'under-estimate':>15s}")
        for key in (
            "D0_00h", "D0_03h", "D0_06h", "D0_08h", "D0_09h",
            "D0_12h", "D0_18h", "D0_23h",
        ):
            if key in buckets and len(buckets[key]) >= 30:
                s = summarize(buckets[key])
                print(
                    f"  {key:10s} {s['mad_sigma']:9.2f} "
                    f"{s['mad_sigma'] / p1 - 1:+14.0%}"
                )

    # Aggregate the two regimes that matter.
    def collect(prefixes):
        out = []
        for key, vals in buckets.items():
            if any(key.startswith(p) for p in prefixes):
                out.extend(vals)
        return out

    early = collect(["D-1_", "D0_00h", "D0_01h", "D0_02h", "D0_03h", "D0_04h",
                     "D0_05h", "D0_06h", "D0_07h", "D0_08h", "D0_09h", "D0_10h",
                     "D0_11h"])
    late = collect(["D0_15h", "D0_16h", "D0_17h", "D0_18h", "D0_19h", "D0_20h",
                    "D0_21h", "D0_22h", "D0_23h"])

    print("\n=== regime comparison")
    for label, vals in (("early (D-1 + D0 00-11h)", early), ("late  (D0 15-23h)", late)):
        s = summarize(vals)
        print(
            f"  {label:24s} n={s['n']:6d}  MAE={s['mae']:.2f}  "
            f"bias={s['bias']:+.2f}  sigma={s['sigma']:.2f}"
        )
    if early and late:
        early_s, late_s = summarize(early), summarize(late)
        print(
            f"\n  MAE inflation (early vs late): {early_s['mae'] / late_s['mae'] - 1:+.1%}"
            f"   sigma inflation: {early_s['sigma'] / late_s['sigma'] - 1:+.1%}"
        )
        print(
            f"  MAE inflation (early vs training baseline): "
            f"{early_s['mae'] / b['mae'] - 1:+.1%}"
            f"   sigma: {early_s['sigma'] / b['sigma'] - 1:+.1%}"
        )


if __name__ == "__main__":
    main()
