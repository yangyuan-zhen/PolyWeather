"""Verify the DEB lead-time fix by recomputing stats offline (read-only).

Compares the sigma currently served in production against a fresh training
pass that uses the earliest intraday snapshot (what the user sees in the
morning) instead of the last upserted value (what training used to see).

Nothing is written: this only reads the runtime DB and prints the delta.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.analysis.deb_probability import train_deb_lead_stats  # noqa: E402
from src.database.runtime_state import (  # noqa: E402
    DailyRecordRepository,
    DebNormalResidualStatsRepository,
    IntradayPathSnapshotRepository,
    ProbabilitySnapshotRepository,
)


def show(label, stats):
    print(f"\n--- {label}")
    if not stats:
        print("  (no stats)")
        return
    print(f"  samples={stats.get('samples')}  window_days={stats.get('window_days')}")
    print(f"  lead_sigmas : {stats.get('lead_sigmas')}")
    for lead, bucket in sorted((stats.get("temp_sigmas") or {}).items()):
        print(f"  temp_sigmas[lead={lead}]: {bucket}")


def main():
    try:
        current = DebNormalResidualStatsRepository().load_stats()
    except Exception as exc:  # noqa: BLE001
        print(f"could not load production stats: {exc}")
        current = None
    show("production stats (currently served)", current)

    try:
        daily = DailyRecordRepository().load_all(
            fields=("forecasts", "actual_high", "deb_prediction", "mu")
        )
    except Exception as exc:  # noqa: BLE001
        print(f"\ncould not load daily records (db may have corrupt pages): {exc}")
        return

    lead_by_cd = {}
    try:
        lead_by_cd.update(ProbabilitySnapshotRepository().load_earliest_lead_days())
    except Exception as exc:  # noqa: BLE001
        print(f"lead labels unavailable: {exc}")

    earliest = {}
    try:
        earliest.update(IntradayPathSnapshotRepository().load_earliest_deb_prediction())
    except Exception as exc:  # noqa: BLE001
        print(f"earliest predictions unavailable: {exc}")

    print(
        f"\ninputs: {len(daily)} cities, "
        f"{sum(len(v) for v in daily.values())} daily records, "
        f"{len(lead_by_cd)} lead labels, {len(earliest)} earliest predictions"
    )

    show("BEFORE semantics (last snapshot, no lead labels)", train_deb_lead_stats(daily))
    show(
        "AFTER (earliest snapshot + lead labels)",
        train_deb_lead_stats(
            daily, lead_by_cd=lead_by_cd, earliest_pred_by_cd=earliest
        ),
    )


if __name__ == "__main__":
    main()
