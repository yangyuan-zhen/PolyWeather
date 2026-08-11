"""Fetch historical METAR observations from IEM Mesonet and store them as local training truth.

The IEM ASOS download API (https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py)
serves ASOS/METAR stations worldwide (653+ networks, archives back to 1900). Station
lookup is by ICAO code only, so any PolyWeather city with an ICAO in the registry can
be fetched without picking a network.

This script is the "local training data" entry point: it downloads each city's METAR
history into the local SQLite truth store (TruthRecordRepository) so DEB / probability
calibration training on this machine can consume real airport observations instead of
Open-Meteo gridpoint data. Optionally it also writes per-city CSV files under
``data/iem_historical/`` in the same ``time,temperature_2m`` shape that
``scripts/build_settlement_history_from_csv.py`` consumes.

API constraints (verified 2026-08-03):
- rate limit: 1 request / second / IP (HTTP 429 when exceeded)
- request cap: 1000 station-years per request (HTTP 422 beyond)
- data=tmpf returns Fahrenheit; temperatures are converted to Celsius here
- timestamps are UTC; local calendar day is derived from city tz_offset
- connections can be interrupted mid-body; chunked reads with retries handle that

Usage:
    python scripts/iem_cn_asos_truth.py --all-cities --years 3
    python scripts/iem_cn_asos_truth.py --cities beijing tokyo --start-date 2026-01-01 --end-date 2026-07-31
    python scripts/iem_cn_asos_truth.py --all-cities --years 3 --csv-dir data/iem_historical
"""

import argparse
import csv
import io
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import requests

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from src.data_collection.city_registry import CITY_REGISTRY  # noqa: E402
from src.database.runtime_state import TruthRecordRepository  # noqa: E402

IEM_BASE = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"
USER_AGENT = "polyweather-training/1.0 (+https://polyweather.top)"
REQUEST_INTERVAL_SECONDS = 2.0
RETRY_AFTER_429_SECONDS = 5.0
MAX_FETCH_RETRIES = 4
UTC = timezone.utc

# Chinese cities whose settlement station is a CN__ASOS airport ICAO.
DEFAULT_CITIES = [
    "beijing",
    "shanghai",
    "guangzhou",
    "qingdao",
    "chengdu",
    "chongqing",
    "wuhan",
]


def _fahrenheit_to_celsius(f: float) -> float:
    return (f - 32.0) * 5.0 / 9.0


def _city_icao(city: str) -> str | None:
    info = CITY_REGISTRY.get(city) or {}
    return str(info.get("settlement_station_code") or info.get("icao") or "").strip().upper() or None


def _city_tz_offset(city: str) -> int:
    info = CITY_REGISTRY.get(city) or {}
    try:
        return int(info.get("tz_offset") or 0)
    except (TypeError, ValueError):
        return 0


def _fetch_station_csv(icao: str, start_date: str, end_date: str) -> str:
    query = urlencode(
        {
            "station": icao,
            "data": "tmpf",
            "tz": "Etc/UTC",
            "format": "onlycomma",
            "latlon": "yes",
            "elev": "no",
            "missing": "null",
            "trace": "null",
            "direct": "yes",
            "sts": f"{start_date} 00:00+00:00",
            "ets": f"{end_date} 23:59+00:00",
        }
    )
    url = f"{IEM_BASE}?{query}"
    last_error: Exception | None = None
    for attempt in range(MAX_FETCH_RETRIES):
        try:
            resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=180)
            if resp.status_code == 429:
                last_error = RuntimeError(f"HTTP 429 rate limited (attempt {attempt + 1})")
                time.sleep(RETRY_AFTER_429_SECONDS)
                continue
            resp.raise_for_status()
            return resp.text
        except Exception as exc:  # network blips / IncompleteRead are retried
            last_error = exc
            if attempt < MAX_FETCH_RETRIES - 1:
                time.sleep(REQUEST_INTERVAL_SECONDS)
    raise RuntimeError(f"IEM fetch failed after {MAX_FETCH_RETRIES} attempts: {last_error}")


def _parse_daily_max(csv_text: str, tz_offset: int, start_date: str, end_date: str) -> dict:
    """Return {YYYY-MM-DD: {"max_temp": float, "sample_count": int}} in city-local days."""
    local_tz = timezone(timedelta(seconds=tz_offset))
    start = datetime.fromisoformat(start_date).replace(tzinfo=UTC)
    end = datetime.fromisoformat(end_date).replace(tzinfo=UTC)
    daily: dict[str, dict] = {}
    reader = csv.DictReader(io.StringIO(csv_text))
    for row in reader:
        valid = str(row.get("valid") or "")
        raw = row.get("tmpf")
        if not valid or raw in (None, "", "null", "M"):
            continue
        try:
            temp_f = float(raw)
        except (TypeError, ValueError):
            continue
        valid_dt = datetime.strptime(valid, "%Y-%m-%d %H:%M").replace(tzinfo=UTC)
        if valid_dt < start or valid_dt > end:
            continue
        local_day = (valid_dt.astimezone(local_tz)).strftime("%Y-%m-%d")
        temp_c = _fahrenheit_to_celsius(temp_f)
        entry = daily.setdefault(local_day, {"max_temp": None, "sample_count": 0})
        entry["sample_count"] += 1
        if entry["max_temp"] is None or temp_c > entry["max_temp"]:
            entry["max_temp"] = temp_c
    return daily


def _truth_meta(city: str) -> dict:
    city_meta = CITY_REGISTRY.get(city) or {}
    return {
        "settlement_source": str(city_meta.get("settlement_source") or "metar").strip().lower(),
        "settlement_station_code": str(
            city_meta.get("settlement_station_code") or city_meta.get("icao") or ""
        ).strip().upper()
        or None,
        "settlement_station_label": str(
            city_meta.get("settlement_station_label")
            or city_meta.get("airport_name")
            or city_meta.get("name")
            or ""
        ).strip()
        or None,
    }


def _write_csv(csv_dir: str, city: str, daily: dict) -> str:
    """Write {day, max_temp} rows in the build_settlement_history CSV shape."""
    os.makedirs(csv_dir, exist_ok=True)
    path = os.path.join(csv_dir, f"{city.replace(' ', '_').lower()}_historical.csv")
    with open(path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["time", "temperature_2m"])
        for day, entry in sorted(daily.items()):
            writer.writerow([f"{day}T00:00", f"{float(entry['max_temp']):.1f}"])
    return path


def _all_city_names() -> list[str]:
    return sorted(str(city).strip().lower() for city in CITY_REGISTRY.keys() if str(city).strip())


def _stored_cities_for_version(version: str) -> set[str]:
    """Cities that already have truth rows for this version (resume support)."""
    try:
        repo = TruthRecordRepository()
        with repo.db.connect() as conn:
            rows = conn.execute(
                "SELECT DISTINCT city FROM truth_records_store WHERE truth_version = ?",
                (version,),
            ).fetchall()
        return {str(row["city"]).strip().lower() for row in rows}
    except Exception:
        return set()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch IEM Mesonet METAR history (global, by ICAO) and store daily high as local training truth."
    )
    parser.add_argument(
        "--cities",
        nargs="*",
        default=None,
        help="City registry keys (default: Chinese CN__ASOS cities).",
    )
    parser.add_argument(
        "--all-cities",
        action="store_true",
        help="Fetch every city in the registry that has an ICAO.",
    )
    parser.add_argument(
        "--start-date",
        default=None,
        help="Inclusive start date YYYY-MM-DD (default: 90 days ago).",
    )
    parser.add_argument(
        "--end-date",
        default=None,
        help="Inclusive end date YYYY-MM-DD (default: yesterday).",
    )
    parser.add_argument(
        "--years",
        type=int,
        default=None,
        help="Shortcut for --start-date today-years years ago.",
    )
    parser.add_argument(
        "--truth-version",
        default="iem-cn-asos",
    )
    parser.add_argument(
        "--csv-dir",
        default=None,
        help="Optional directory to write per-city {time,temperature_2m} CSV files for build_settlement_history_from_csv.py.",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Skip cities that already have truth rows for --truth-version.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and report daily maxima without writing to the truth repository.",
    )
    args = parser.parse_args()

    if args.all_cities:
        cities = _all_city_names()
    else:
        cities = args.cities or DEFAULT_CITIES

    if args.resume:
        done = _stored_cities_for_version(args.truth_version)
        pending = [city for city in cities if city not in done]
        print(
            json.dumps(
                {"resume": True, "truth_version": args.truth_version, "skipped": len(done), "pending": len(pending)},
                ensure_ascii=False,
            )
        )
        cities = pending
    if not cities:
        print(json.dumps({"resume": True, "message": "all cities already stored"}, ensure_ascii=False))
        return

    end_date = args.end_date or (datetime.now(UTC) - timedelta(days=1)).strftime("%Y-%m-%d")
    if args.years:
        start_date = (datetime.now(UTC) - timedelta(days=365 * args.years)).strftime("%Y-%m-%d")
    else:
        start_date = args.start_date or (datetime.now(UTC) - timedelta(days=90)).strftime("%Y-%m-%d")

    repo = TruthRecordRepository()
    summary = {}
    for city in cities:
        icao = _city_icao(city)
        if not icao:
            print(json.dumps({"city": city, "error": "no ICAO"}, ensure_ascii=False))
            continue
        tz_offset = _city_tz_offset(city)
        try:
            csv_text = _fetch_station_csv(icao, start_date, end_date)
        except Exception as exc:  # network / HTTP error for this station
            print(json.dumps({"city": city, "icao": icao, "error": str(exc)}, ensure_ascii=False))
            time.sleep(REQUEST_INTERVAL_SECONDS)
            continue
        daily = _parse_daily_max(csv_text, tz_offset, start_date, end_date)
        if not daily:
            print(json.dumps({"city": city, "icao": icao, "days": 0}, ensure_ascii=False))
            time.sleep(REQUEST_INTERVAL_SECONDS)
            continue

        meta = _truth_meta(city)
        stored = 0
        for day, entry in sorted(daily.items()):
            actual_high = round(float(entry["max_temp"]), 3)
            if args.dry_run:
                continue
            repo.upsert_truth(
                city=city,
                target_date=day,
                actual_high=actual_high,
                settlement_source=meta["settlement_source"],
                settlement_station_code=meta["settlement_station_code"],
                settlement_station_label=meta["settlement_station_label"],
                truth_version=args.truth_version,
                updated_by="iem_cn_asos_truth",
                source_payload={
                    "max_temp": actual_high,
                    "sample_count": entry["sample_count"],
                    "station_icao": icao,
                    "source": "iem_mesonet",
                },
                is_final=True,
                reason="iem_cn_asos_truth",
            )
            stored += 1

        csv_path = None
        if args.csv_dir:
            csv_path = _write_csv(args.csv_dir, city, daily)

        summary[city] = {"icao": icao, "days": len(daily), "stored": stored}
        if csv_path:
            summary[city]["csv"] = csv_path
        print(json.dumps({"city": city, **summary[city]}, ensure_ascii=False))
        time.sleep(REQUEST_INTERVAL_SECONDS)

    print(
        json.dumps(
            {"start_date": start_date, "end_date": end_date, "city_count": len(summary), "summary": summary},
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
