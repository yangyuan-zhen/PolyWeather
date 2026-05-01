#!/usr/bin/env python3
"""Backtest DEB baseline vs METAR/observation-calibrated intraday path.

This script intentionally mirrors the frontend chart logic at a data-science
level:

  DEB baseline path = hourly forecast curve + (DEB daily high - OM daily high)
  calibrated path   = DEB path + recent observation bias * fade-to-evening

It uses only local data. The best dataset is SQLite runtime state because it can
contain:
  - open_meteo_cache_store: hourly forecast curves
  - official_intraday_observations_store: intraday anchor observations
  - daily_records_store / truth_records_store: final actual high

If a city/date lacks any of those pieces, it is skipped and reported.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sqlite3
import statistics
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from src.data_collection.city_registry import CITY_REGISTRY
    from src.analysis.settlement_rounding import apply_city_settlement
except Exception:  # pragma: no cover - script fallback for partial envs
    CITY_REGISTRY = {}

    def apply_city_settlement(_city: str, value: float | None) -> int | None:
        return None if value is None else round(value)


def sf(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        num = float(value)
        return num if math.isfinite(num) else None
    except Exception:
        return None


def hm_to_minutes(value: str | None) -> int | None:
    if not value:
        return None
    text = str(value).strip()
    if "T" in text:
        text = text.split("T", 1)[1]
    text = text[:5]
    try:
        hh, mm = text.split(":")[:2]
        h = int(hh)
        m = int(mm)
        if not (0 <= h <= 23 and 0 <= m <= 59):
            return None
        return h * 60 + m
    except Exception:
        return None


def interp(times: list[str], values: list[float | None], minute: int) -> float | None:
    pts: list[tuple[int, float]] = []
    for t, v in zip(times, values):
        m = hm_to_minutes(t)
        y = sf(v)
        if m is not None and y is not None:
            pts.append((m, y))
    if not pts:
        return None
    pts.sort()
    if minute <= pts[0][0]:
        return pts[0][1]
    if minute >= pts[-1][0]:
        return pts[-1][1]
    for (lm, lv), (rm, rv) in zip(pts, pts[1:]):
        if lm <= minute <= rm:
            if rm == lm:
                return rv
            ratio = (minute - lm) / (rm - lm)
            return lv + (rv - lv) * ratio
    return pts[-1][1]


def clamp_delta(value: float, lo: float = -4.0, hi: float = 4.0) -> float:
    return min(max(value, lo), hi)


@dataclass
class Observation:
    time: str
    temp: float


@dataclass
class SampleResult:
    city: str
    date: str
    current_time: str
    obs_count: int
    actual_high: float
    deb_high: float
    calibrated_high: float
    deb_abs_error: float
    calibrated_abs_error: float
    delta_vs_deb: float
    bucket_deb_hit: bool | None
    bucket_calibrated_hit: bool | None


def dedupe_observations(rows: Iterable[Observation]) -> list[Observation]:
    by_time: dict[str, Observation] = {}
    for row in rows:
        minute = hm_to_minutes(row.time)
        if minute is None:
            continue
        key = f"{minute // 60:02d}:{minute % 60:02d}"
        existing = by_time.get(key)
        if existing is None or row.temp >= existing.temp:
            by_time[key] = Observation(key, row.temp)
    return sorted(by_time.values(), key=lambda r: hm_to_minutes(r.time) or 0)


def calibrated_future_path(
    *,
    times: list[str],
    deb_path: list[float | None],
    observations: list[Observation],
    current_minute: int,
    reversion_minute: int,
) -> tuple[list[float | None], float | None]:
    usable: list[tuple[int, float]] = []
    for obs in dedupe_observations(observations):
        minute = hm_to_minutes(obs.time)
        if minute is None or minute > current_minute + 30:
            continue
        expected = interp(times, deb_path, minute)
        if expected is None:
            continue
        usable.append((minute, clamp_delta(obs.temp - expected)))
    usable = usable[-3:]
    if not usable:
        return [None for _ in times], None

    total = 0.0
    weight_total = 0.0
    for idx, (_minute, delta) in enumerate(usable):
        weight = idx + 1
        total += delta * weight
        weight_total += weight
    adjustment = round(clamp_delta(total / max(weight_total, 1.0)), 1)

    last_minute = next((m for m in reversed([hm_to_minutes(t) for t in times]) if m is not None), current_minute + 360)
    return_to = reversion_minute if reversion_minute > current_minute else last_minute
    if return_to <= current_minute:
        return_to = current_minute + 360

    out: list[float | None] = []
    for t, base in zip(times, deb_path):
        minute = hm_to_minutes(t)
        if minute is None or minute < current_minute or base is None:
            out.append(None)
            continue
        progress = min(max((minute - current_minute) / max(return_to - current_minute, 1), 0.0), 1.0)
        decay = (1 - progress) ** 1.35
        out.append(round(base + adjustment * decay, 1))
    return out, adjustment


def connect(db_path: Path) -> sqlite3.Connection:
    con = sqlite3.connect(str(db_path))
    con.row_factory = sqlite3.Row
    return con


def get_actual_high(con: sqlite3.Connection, city: str, date: str) -> float | None:
    row = con.execute(
        "select actual_high from daily_records_store where city=? and target_date=?",
        (city, date),
    ).fetchone()
    if row and sf(row["actual_high"]) is not None:
        return sf(row["actual_high"])
    row = con.execute(
        "select actual_high from truth_records_store where city=? and target_date=? and is_final=1 order by updated_at desc limit 1",
        (city, date),
    ).fetchone()
    return sf(row["actual_high"]) if row else None


def get_daily_record(con: sqlite3.Connection, city: str, date: str) -> dict[str, Any] | None:
    row = con.execute(
        "select deb_prediction, payload_json from daily_records_store where city=? and target_date=?",
        (city, date),
    ).fetchone()
    if not row:
        return None
    payload = {}
    try:
        payload = json.loads(row["payload_json"] or "{}")
    except Exception:
        payload = {}
    payload.setdefault("deb_prediction", row["deb_prediction"])
    return payload


def cache_key_for_city(city: str) -> str | None:
    meta = CITY_REGISTRY.get(city) or {}
    lat = sf(meta.get("lat"))
    lon = sf(meta.get("lon"))
    if lat is None or lon is None:
        return None
    unit = "f" if meta.get("use_fahrenheit") else "c"
    return f"{lat:.4f}:{lon:.4f}:14:{unit}"


def load_hourly_forecast(con: sqlite3.Connection, city: str, date: str) -> tuple[list[str], list[float | None], float | None, str | None]:
    key = cache_key_for_city(city)
    if not key:
        return [], [], None, None
    row = con.execute(
        "select payload_json, updated_at from open_meteo_cache_store where source_kind='forecast' and cache_key=? order by updated_at desc limit 1",
        (key,),
    ).fetchone()
    if not row:
        return [], [], None, None
    try:
        payload = json.loads(row["payload_json"] or "{}")
    except Exception:
        return [], [], None, None
    data = payload.get("data") or payload
    hourly = data.get("hourly") or {}
    raw_times = hourly.get("time") or hourly.get("times") or []
    raw_temps = hourly.get("temperature_2m") or hourly.get("temps") or []
    times: list[str] = []
    temps: list[float | None] = []
    for ts, temp in zip(raw_times, raw_temps):
        text = str(ts)
        if not text.startswith(date):
            continue
        times.append(text.split("T", 1)[1][:5] if "T" in text else text[:5])
        temps.append(sf(temp))
    om_high = max([v for v in temps if v is not None], default=None)
    updated_at = None
    try:
        updated_at = datetime.fromtimestamp(float(row["updated_at"])).isoformat()
    except Exception:
        pass
    return times, temps, om_high, updated_at


def station_codes_for_city(city: str) -> set[str]:
    meta = CITY_REGISTRY.get(city) or {}
    values = [
        meta.get("settlement_station_code"),
        meta.get("icao"),
        *(meta.get("settlement_station_candidates") or []),
    ]
    return {str(v).strip().upper() for v in values if str(v or "").strip()}


def load_observations(con: sqlite3.Connection, city: str, date: str) -> list[Observation]:
    codes = station_codes_for_city(city)
    if not codes:
        return []
    placeholders = ",".join("?" for _ in codes)
    rows = con.execute(
        f"""
        select observation_time, value
        from official_intraday_observations_store
        where target_date=? and upper(station_code) in ({placeholders})
        order by observation_time asc
        """,
        (date, *sorted(codes)),
    ).fetchall()
    obs = []
    for row in rows:
        temp = sf(row["value"])
        time = str(row["observation_time"] or "")[:5]
        if temp is not None and hm_to_minutes(time) is not None:
            obs.append(Observation(time, temp))
    return dedupe_observations(obs)


def bucket_hit(city: str, predicted: float, actual: float) -> bool | None:
    try:
        return apply_city_settlement(city, predicted) == apply_city_settlement(city, actual)
    except Exception:
        return None


def evaluate_city_date(con: sqlite3.Connection, city: str, date: str, min_obs: int) -> list[SampleResult]:
    daily = get_daily_record(con, city, date)
    if not daily:
        return []
    actual_high = get_actual_high(con, city, date)
    deb_high = sf(daily.get("deb_prediction"))
    if actual_high is None or deb_high is None:
        return []
    times, temps, om_high, _updated_at = load_hourly_forecast(con, city, date)
    if not times or om_high is None:
        # Fallback: use Open-Meteo daily forecast from the daily record only.
        # This cannot evaluate path shape, so skip rather than pretend.
        return []
    offset = deb_high - om_high
    deb_path = [round(t + offset, 1) if t is not None else None for t in temps]
    observations = load_observations(con, city, date)
    if len(observations) < min_obs:
        return []

    sunset = "18:00"
    reversion_minute = hm_to_minutes(sunset) or 18 * 60
    results: list[SampleResult] = []
    for idx in range(min_obs - 1, len(observations)):
        current_obs = observations[idx]
        current_minute = hm_to_minutes(current_obs.time)
        if current_minute is None:
            continue
        used_obs = observations[: idx + 1]
        calibrated_path, adjustment = calibrated_future_path(
            times=times,
            deb_path=deb_path,
            observations=used_obs,
            current_minute=current_minute,
            reversion_minute=reversion_minute,
        )
        future_values = [v for v in calibrated_path if v is not None]
        observed_so_far = max(o.temp for o in used_obs)
        calibrated_high = max([observed_so_far, *future_values], default=observed_so_far)
        results.append(
            SampleResult(
                city=city,
                date=date,
                current_time=current_obs.time,
                obs_count=len(used_obs),
                actual_high=actual_high,
                deb_high=deb_high,
                calibrated_high=calibrated_high,
                deb_abs_error=abs(deb_high - actual_high),
                calibrated_abs_error=abs(calibrated_high - actual_high),
                delta_vs_deb=adjustment if adjustment is not None else 0.0,
                bucket_deb_hit=bucket_hit(city, deb_high, actual_high),
                bucket_calibrated_hit=bucket_hit(city, calibrated_high, actual_high),
            )
        )
    return results


def summarize(samples: list[SampleResult]) -> dict[str, Any]:
    if not samples:
        return {"samples": 0}
    deb_errors = [s.deb_abs_error for s in samples]
    cal_errors = [s.calibrated_abs_error for s in samples]
    improved = [s for s in samples if s.calibrated_abs_error < s.deb_abs_error]
    worsened = [s for s in samples if s.calibrated_abs_error > s.deb_abs_error]
    deb_hits = [s.bucket_deb_hit for s in samples if s.bucket_deb_hit is not None]
    cal_hits = [s.bucket_calibrated_hit for s in samples if s.bucket_calibrated_hit is not None]
    return {
        "samples": len(samples),
        "city_dates": len({(s.city, s.date) for s in samples}),
        "deb_mae": round(statistics.mean(deb_errors), 3),
        "calibrated_mae": round(statistics.mean(cal_errors), 3),
        "mae_delta_cal_minus_deb": round(statistics.mean(cal_errors) - statistics.mean(deb_errors), 3),
        "improved_samples": len(improved),
        "worsened_samples": len(worsened),
        "unchanged_samples": len(samples) - len(improved) - len(worsened),
        "deb_bucket_hit_rate": round(sum(1 for x in deb_hits if x) / len(deb_hits), 3) if deb_hits else None,
        "calibrated_bucket_hit_rate": round(sum(1 for x in cal_hits if x) / len(cal_hits), 3) if cal_hits else None,
    }


def write_csv(path: Path, samples: list[SampleResult]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(SampleResult.__dataclass_fields__.keys()))
        writer.writeheader()
        for s in samples:
            writer.writerow(s.__dict__)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(ROOT / "data" / "polyweather.db"))
    parser.add_argument("--city", action="append", help="City key; can be repeated. Defaults to cities found in daily_records_store.")
    parser.add_argument("--date", action="append", help="YYYY-MM-DD; can be repeated.")
    parser.add_argument("--min-obs", type=int, default=2)
    parser.add_argument("--output", default=str(ROOT / "tmp_metar_calibration_backtest.csv"))
    args = parser.parse_args()

    con = connect(Path(args.db))
    cities = args.city
    if not cities:
        cities = [r[0] for r in con.execute("select distinct city from daily_records_store order by city").fetchall()]
    dates_filter = set(args.date or [])

    all_samples: list[SampleResult] = []
    skipped = {"no_records_or_inputs": 0}
    for city in cities:
        rows = con.execute(
            "select distinct target_date from daily_records_store where city=? order by target_date",
            (city,),
        ).fetchall()
        for row in rows:
            date = row[0]
            if dates_filter and date not in dates_filter:
                continue
            samples = evaluate_city_date(con, city, date, args.min_obs)
            if samples:
                all_samples.extend(samples)
            else:
                skipped["no_records_or_inputs"] += 1

    summary = summarize(all_samples)
    write_csv(Path(args.output), all_samples)
    print(json.dumps({"summary": summary, "skipped": skipped, "output": args.output}, ensure_ascii=False, indent=2))
    if not all_samples:
        print(
            "No usable samples. Need matching daily_records + open_meteo_cache hourly forecast + intraday observations for the same city/date.",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
