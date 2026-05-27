from __future__ import annotations

import csv
import json
import math
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from src.analysis.settlement_rounding import apply_city_settlement

DEB_RAW_VERSION = "deb_v1_raw"
DEB_RECENT_BIAS_CORRECTED_VERSION = "deb_v1_recent_bias_corrected"
DEB_BACKTEST_SCHEMA_VERSION = "deb_backtest_report.v1"


def _sf(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        parsed = float(value)
        return parsed if math.isfinite(parsed) else None
    except (TypeError, ValueError):
        return None


def _round3(value: float | None) -> float | None:
    return None if value is None else round(float(value), 3)


def _normalise_record(row: dict[str, Any]) -> dict[str, Any] | None:
    city = str(row.get("city") or "").strip().lower()
    target_date = str(row.get("target_date") or row.get("date") or "").strip()
    prediction = _sf(row.get("prediction", row.get("deb_prediction")))
    actual = _sf(row.get("actual", row.get("actual_high")))
    if not city or not target_date or prediction is None or actual is None:
        return None
    return {
        "city": city,
        "target_date": target_date,
        "prediction": prediction,
        "actual": actual,
    }


def evaluate_prediction_records(
    records: Iterable[dict[str, Any]],
    *,
    version: str,
) -> dict[str, Any]:
    rows = [row for record in records if (row := _normalise_record(record))]
    if not rows:
        return {
            "version": version,
            "samples": 0,
            "mae": None,
            "rmse": None,
            "bias": None,
            "bucket_hit_rate": None,
        }

    signed_errors = [row["prediction"] - row["actual"] for row in rows]
    abs_errors = [abs(error) for error in signed_errors]
    sq_errors = [error * error for error in signed_errors]
    bucket_hits = 0
    bucket_total = 0
    for row in rows:
        try:
            pred_bucket = apply_city_settlement(row["city"], row["prediction"])
            actual_bucket = apply_city_settlement(row["city"], row["actual"])
        except Exception:
            continue
        if pred_bucket is None or actual_bucket is None:
            continue
        bucket_total += 1
        if pred_bucket == actual_bucket:
            bucket_hits += 1

    return {
        "version": version,
        "samples": len(rows),
        "mae": _round3(statistics.mean(abs_errors)),
        "rmse": _round3(math.sqrt(statistics.mean(sq_errors))),
        "bias": _round3(statistics.mean(signed_errors)),
        "bucket_hit_rate": (
            _round3(bucket_hits / bucket_total) if bucket_total else None
        ),
    }


@dataclass(frozen=True)
class BiasCorrectionResult:
    version: str
    raw_prediction: float
    corrected_prediction: float
    bias_adjustment: float
    samples: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "raw_prediction": self.raw_prediction,
            "corrected_prediction": self.corrected_prediction,
            "bias_adjustment": self.bias_adjustment,
            "samples": self.samples,
        }


class RecentBiasCorrector:
    def __init__(self, bias_by_city: dict[str, tuple[float, int]]) -> None:
        self._bias_by_city = bias_by_city

    def apply(self, city: str, raw_prediction: float) -> dict[str, Any]:
        city_key = str(city or "").strip().lower()
        raw = float(raw_prediction)
        bias, samples = self._bias_by_city.get(city_key, (0.0, 0))
        adjustment = round(bias, 1)
        return BiasCorrectionResult(
            version=DEB_RECENT_BIAS_CORRECTED_VERSION,
            raw_prediction=round(raw, 1),
            corrected_prediction=round(raw + adjustment, 1),
            bias_adjustment=adjustment,
            samples=samples,
        ).to_dict()


def build_recent_bias_corrector(
    history: Iterable[dict[str, Any]],
    *,
    lookback_days: int = 30,
    min_samples: int = 3,
    shrinkage_samples: int = 5,
    max_adjustment: float = 3.0,
) -> RecentBiasCorrector:
    by_city: dict[str, list[dict[str, Any]]] = {}
    for record in history:
        row = _normalise_record(record)
        if row is None:
            continue
        by_city.setdefault(row["city"], []).append(row)

    bias_by_city: dict[str, tuple[float, int]] = {}
    for city, rows in by_city.items():
        rows.sort(key=lambda row: row["target_date"], reverse=True)
        recent = rows[: max(int(lookback_days or 0), 1)]
        signed_actual_minus_prediction = [
            row["actual"] - row["prediction"] for row in recent
        ]
        samples = len(signed_actual_minus_prediction)
        if samples < min_samples:
            continue
        raw_bias = statistics.mean(signed_actual_minus_prediction)
        shrink = min(1.0, samples / max(float(shrinkage_samples), 1.0))
        adjusted = raw_bias * shrink
        adjusted = max(-abs(max_adjustment), min(abs(max_adjustment), adjusted))
        bias_by_city[city] = (adjusted, samples)

    return RecentBiasCorrector(bias_by_city)


def backtest_deb_versions(
    history: Iterable[dict[str, Any]],
    *,
    train_lookback_days: int = 30,
    min_train_samples: int = 2,
) -> dict[str, Any]:
    rows = [row for record in history if (row := _normalise_record(record))]
    rows.sort(key=lambda row: (row["city"], row["target_date"]))

    report_rows: list[dict[str, Any]] = []
    raw_eval_rows: list[dict[str, Any]] = []
    corrected_eval_rows: list[dict[str, Any]] = []

    by_city: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        previous = by_city.setdefault(row["city"], [])
        if len(previous) >= min_train_samples:
            corrector = build_recent_bias_corrector(
                previous,
                lookback_days=train_lookback_days,
                min_samples=min_train_samples,
            )
            corrected = corrector.apply(row["city"], row["prediction"])
            raw_prediction = round(row["prediction"], 1)
            corrected_prediction = corrected["corrected_prediction"]

            raw_eval_rows.append(
                {
                    "city": row["city"],
                    "target_date": row["target_date"],
                    "prediction": raw_prediction,
                    "actual": row["actual"],
                }
            )
            corrected_eval_rows.append(
                {
                    "city": row["city"],
                    "target_date": row["target_date"],
                    "prediction": corrected_prediction,
                    "actual": row["actual"],
                }
            )
            report_rows.append(
                {
                    "city": row["city"],
                    "target_date": row["target_date"],
                    "actual": row["actual"],
                    "versions": {
                        DEB_RAW_VERSION: {
                            "prediction": raw_prediction,
                            "error": round(raw_prediction - row["actual"], 3),
                        },
                        DEB_RECENT_BIAS_CORRECTED_VERSION: {
                            "prediction": corrected_prediction,
                            "error": round(corrected_prediction - row["actual"], 3),
                            "bias_adjustment": corrected["bias_adjustment"],
                            "train_samples": corrected["samples"],
                        },
                    },
                }
            )
        previous.append(row)

    return {
        "schema_version": DEB_BACKTEST_SCHEMA_VERSION,
        "versions": {
            DEB_RAW_VERSION: evaluate_prediction_records(
                raw_eval_rows,
                version=DEB_RAW_VERSION,
            ),
            DEB_RECENT_BIAS_CORRECTED_VERSION: evaluate_prediction_records(
                corrected_eval_rows,
                version=DEB_RECENT_BIAS_CORRECTED_VERSION,
            ),
        },
        "rows": report_rows,
    }


def flatten_daily_records(
    daily_records: dict[str, dict[str, dict[str, Any]]],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for city, by_date in (daily_records or {}).items():
        if not isinstance(by_date, dict):
            continue
        for target_date, record in by_date.items():
            if not isinstance(record, dict):
                continue
            rows.append(
                {
                    "city": city,
                    "target_date": target_date,
                    "deb_prediction": record.get("deb_prediction"),
                    "actual_high": record.get("actual_high"),
                }
            )
    return rows


def write_backtest_report(
    report: dict[str, Any],
    *,
    json_path: str | Path,
    csv_path: str | Path | None = None,
) -> None:
    json_target = Path(json_path)
    json_target.parent.mkdir(parents=True, exist_ok=True)
    json_target.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if csv_path is None:
        return

    csv_target = Path(csv_path)
    csv_target.parent.mkdir(parents=True, exist_ok=True)
    with csv_target.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "city",
                "target_date",
                "actual",
                f"{DEB_RAW_VERSION}_prediction",
                f"{DEB_RAW_VERSION}_error",
                f"{DEB_RECENT_BIAS_CORRECTED_VERSION}_prediction",
                f"{DEB_RECENT_BIAS_CORRECTED_VERSION}_error",
                f"{DEB_RECENT_BIAS_CORRECTED_VERSION}_bias_adjustment",
                f"{DEB_RECENT_BIAS_CORRECTED_VERSION}_train_samples",
            ],
        )
        writer.writeheader()
        for row in report.get("rows") or []:
            versions = row.get("versions") or {}
            raw = versions.get(DEB_RAW_VERSION) or {}
            corrected = versions.get(DEB_RECENT_BIAS_CORRECTED_VERSION) or {}
            writer.writerow(
                {
                    "city": row.get("city"),
                    "target_date": row.get("target_date"),
                    "actual": row.get("actual"),
                    f"{DEB_RAW_VERSION}_prediction": raw.get("prediction"),
                    f"{DEB_RAW_VERSION}_error": raw.get("error"),
                    f"{DEB_RECENT_BIAS_CORRECTED_VERSION}_prediction": corrected.get(
                        "prediction"
                    ),
                    f"{DEB_RECENT_BIAS_CORRECTED_VERSION}_error": corrected.get(
                        "error"
                    ),
                    f"{DEB_RECENT_BIAS_CORRECTED_VERSION}_bias_adjustment": corrected.get(
                        "bias_adjustment"
                    ),
                    f"{DEB_RECENT_BIAS_CORRECTED_VERSION}_train_samples": corrected.get(
                        "train_samples"
                    ),
                }
            )
