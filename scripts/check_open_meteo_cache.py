"""Safely inspect local Open-Meteo cache state.

This diagnostic is intentionally cache-first:

- It does not call Open-Meteo.
- It does not hard-code any auth token.
- Optional backend API probing requires ``--api-detail`` and reads the bearer
  token from ``POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN``.

Examples:
    python scripts/check_open_meteo_cache.py --city "sao paulo"
    python scripts/check_open_meteo_cache.py --city ankara --api-detail
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.data_collection.city_registry import CITY_REGISTRY  # noqa: E402
from src.data_collection.weather_sources import WeatherDataCollector  # noqa: E402
from src.utils.config_loader import load_config  # noqa: E402


def _cache_age(entry: dict[str, Any]) -> str:
    try:
        age = int(time.time() - float(entry.get("t") or 0))
    except Exception:
        return "unknown"
    return f"{age}s"


def _city_meta(city: str) -> dict[str, Any]:
    key = city.strip().lower()
    meta = CITY_REGISTRY.get(key)
    if not meta:
        raise SystemExit(f"Unknown city {city!r}. Use a key from CITY_REGISTRY.")
    return meta


def _coord_prefix(meta: dict[str, Any]) -> str:
    return f"{round(float(meta['lat']), 4)}:{round(float(meta['lon']), 4)}"


def _print_cooldown(collector: WeatherDataCollector) -> None:
    refresh = getattr(collector, "_refresh_open_meteo_rate_limit_until", None)
    until = float(refresh() if callable(refresh) else collector._open_meteo_rate_limit_until)
    now = time.time()
    if until > now:
        print(f"Open-Meteo cooldown: active ({int(until - now)}s remaining)")
    else:
        print("Open-Meteo cooldown: inactive")


def _print_forecast_cache(collector: WeatherDataCollector, prefix: str) -> None:
    print("\n[forecast cache]")
    found = False
    for key in sorted(collector._open_meteo_cache.keys()):
        if not key.startswith(prefix):
            continue
        found = True
        entry = collector._open_meteo_cache[key]
        data = entry.get("data") if isinstance(entry, dict) else {}
        hourly = data.get("hourly", {}) if isinstance(data, dict) else {}
        daily = data.get("daily", {}) if isinstance(data, dict) else {}
        print(
            f"- key={key} age={_cache_age(entry)} "
            f"hourly={len(hourly.get('time') or [])} daily={len(daily.get('time') or [])}"
        )
    if not found:
        print("- no matching forecast cache")


def _print_multi_model_cache(collector: WeatherDataCollector, prefix: str) -> None:
    print("\n[multi-model cache]")
    found = False
    for key in sorted(collector._multi_model_cache.keys()):
        if not key.startswith(prefix):
            continue
        found = True
        entry = collector._multi_model_cache[key]
        data = entry.get("data") if isinstance(entry, dict) else {}
        forecasts = data.get("forecasts", {}) if isinstance(data, dict) else {}
        dates = data.get("dates", []) if isinstance(data, dict) else []
        print(
            f"- key={key} age={_cache_age(entry)} "
            f"models={len(forecasts)} dates={len(dates)}"
        )
    if not found:
        print("- no matching multi-model cache")


def _print_ensemble_cache(collector: WeatherDataCollector, prefix: str) -> None:
    print("\n[ensemble cache]")
    found = False
    for key in sorted(collector._ensemble_cache.keys()):
        if not key.startswith(prefix):
            continue
        found = True
        entry = collector._ensemble_cache[key]
        data = entry.get("data") if isinstance(entry, dict) else {}
        print(
            f"- key={key} age={_cache_age(entry)} "
            f"members={data.get('members') if isinstance(data, dict) else None}"
        )
    if not found:
        print("- no matching ensemble cache")


def _fetch_api_detail(city: str, base_url: str) -> None:
    token = os.getenv("POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN", "").strip()
    if not token:
        raise SystemExit(
            "--api-detail requires POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN in the environment"
        )
    quoted_city = urllib.parse.quote(city)
    url = f"{base_url.rstrip('/')}/api/city/{quoted_city}/detail?force_refresh=false"
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read())

    hourly = (payload.get("timeseries") or {}).get("hourly") or {}
    models = payload.get("models") or {}
    deb = payload.get("deb") or {}
    print("\n[backend detail]")
    print(f"- status=ok hourly={len(hourly.get('times') or [])} models={len(models)}")
    print(f"- deb_prediction={deb.get('prediction')}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect local Open-Meteo caches safely.")
    parser.add_argument("--city", default="sao paulo", help="CITY_REGISTRY key to inspect")
    parser.add_argument("--api-detail", action="store_true", help="Also query local backend detail API")
    parser.add_argument("--base-url", default="http://localhost:8000", help="Backend base URL")
    args = parser.parse_args()

    city = args.city.strip().lower()
    meta = _city_meta(city)
    prefix = _coord_prefix(meta)
    print(f"city={city} coord_prefix={prefix}")

    collector = WeatherDataCollector(load_config())
    _print_cooldown(collector)
    _print_forecast_cache(collector, prefix)
    _print_multi_model_cache(collector, prefix)
    _print_ensemble_cache(collector, prefix)

    if args.api_detail:
        _fetch_api_detail(city, args.base_url)


if __name__ == "__main__":
    main()
