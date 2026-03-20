import argparse
import csv
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from typing import Dict, Iterable, Tuple

import requests

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from src.data_collection.city_registry import CITY_REGISTRY  # noqa: E402


HOURLY_FIELDS = (
    "temperature_2m",
    "relative_humidity_2m",
    "wind_speed_10m",
    "wind_direction_10m",
    "cloud_cover",
    "shortwave_radiation",
    "precipitation",
    "surface_pressure",
)


def _city_output_path(output_dir: str, city_name: str) -> str:
    filename = f"{city_name.replace(' ', '_').lower()}_historical.csv"
    return os.path.join(output_dir, filename)


def _fetch_city_history(
    city_name: str,
    city_info: Dict[str, object],
    output_dir: str,
    start_date: str,
    end_date: str,
    session: requests.Session,
    overwrite: bool = False,
    max_retries: int = 4,
) -> Tuple[str, str]:
    output_path = _city_output_path(output_dir, city_name)
    if os.path.exists(output_path) and not overwrite:
        return city_name, "skipped_existing"

    lat = city_info["lat"]
    lon = city_info["lon"]
    url = (
        "https://archive-api.open-meteo.com/v1/archive"
        f"?latitude={lat}&longitude={lon}"
        f"&start_date={start_date}&end_date={end_date}"
        f"&hourly={','.join(HOURLY_FIELDS)}"
        "&timezone=auto"
    )
    last_error = None
    payload = None
    for attempt in range(max_retries + 1):
        try:
            response = session.get(url, timeout=90)
            response.raise_for_status()
            payload = response.json()
            break
        except requests.HTTPError as exc:
            last_error = exc
            response = getattr(exc, "response", None)
            status_code = response.status_code if response is not None else None
            if status_code == 429 and attempt < max_retries:
                retry_after = 0
                if response is not None:
                    try:
                        retry_after = int(response.headers.get("Retry-After") or "0")
                    except Exception:
                        retry_after = 0
                sleep_sec = retry_after if retry_after > 0 else min(90, 5 * (attempt + 1))
                time.sleep(sleep_sec)
                continue
            raise
        except requests.RequestException as exc:
            last_error = exc
            if attempt < max_retries:
                time.sleep(min(30, 3 * (attempt + 1)))
                continue
            raise

    if payload is None:
        raise RuntimeError(f"failed to fetch {city_name}: {last_error}")

    hourly = payload.get("hourly") or {}
    times = hourly.get("time") or []
    if not times:
        raise RuntimeError(f"missing hourly data for {city_name}")

    fieldnames = ["time", *HOURLY_FIELDS]
    rows = []
    for idx, ts in enumerate(times):
        row = {"time": ts}
        for field in HOURLY_FIELDS:
            values = hourly.get(field) or []
            row[field] = values[idx] if idx < len(values) else None
        rows.append(row)

    os.makedirs(output_dir, exist_ok=True)
    with open(output_path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    return city_name, f"downloaded:{len(rows)}"


def _iter_target_cities(selected: Iterable[str]) -> Iterable[Tuple[str, Dict[str, object]]]:
    if not selected:
        for city_name, city_info in sorted(CITY_REGISTRY.items()):
            yield city_name, city_info
        return

    normalized = {str(city).strip().lower() for city in selected if str(city).strip()}
    for city_name, city_info in sorted(CITY_REGISTRY.items()):
        if city_name in normalized:
            yield city_name, city_info


def main():
    parser = argparse.ArgumentParser(description="Backfill historical Open-Meteo CSVs for PolyWeather cities.")
    parser.add_argument(
        "--output-dir",
        default=os.path.join(PROJECT_ROOT, "data", "historical"),
        help="Output directory for per-city historical CSV files.",
    )
    parser.add_argument(
        "--start-date",
        default="2023-01-01",
        help="Archive start date in YYYY-MM-DD.",
    )
    parser.add_argument(
        "--end-date",
        default=(date.today() - timedelta(days=1)).strftime("%Y-%m-%d"),
        help="Archive end date in YYYY-MM-DD.",
    )
    parser.add_argument(
        "--cities",
        nargs="*",
        default=[],
        help="Optional subset of city registry keys to backfill.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Re-download existing CSV files instead of skipping them.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=4,
        help="Maximum concurrent download workers.",
    )
    args = parser.parse_args()

    cities = list(_iter_target_cities(args.cities))
    if not cities:
        raise SystemExit("no matching cities found")

    session = requests.Session()
    session.headers.update({"User-Agent": "PolyWeather Historical Backfill/1.0"})

    results = []
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = {
            executor.submit(
                _fetch_city_history,
                city_name,
                city_info,
                args.output_dir,
                args.start_date,
                args.end_date,
                session,
                args.overwrite,
            ): city_name
            for city_name, city_info in cities
        }
        for future in as_completed(futures):
            city_name = futures[future]
            try:
                _, status = future.result()
                print(f"{city_name}: {status}")
                results.append((city_name, status))
            except Exception as exc:
                print(f"{city_name}: error:{exc}")
                results.append((city_name, f"error:{exc}"))
            time.sleep(0.1)

    downloaded = sum(1 for _, status in results if status.startswith("downloaded:"))
    skipped = sum(1 for _, status in results if status == "skipped_existing")
    failed = [city for city, status in results if status.startswith("error:")]
    print(
        "summary downloaded={downloaded} skipped={skipped} failed={failed}".format(
            downloaded=downloaded,
            skipped=skipped,
            failed=len(failed),
        )
    )
    if failed:
        print("failed_cities=" + ",".join(sorted(failed)))


if __name__ == "__main__":
    main()
