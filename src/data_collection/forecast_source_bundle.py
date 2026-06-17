from __future__ import annotations

from typing import Any, Dict


def _open_meteo_cache_key(
    lat: float,
    lon: float,
    *,
    forecast_days: int = 14,
    use_fahrenheit: bool = False,
) -> str:
    return (
        f"{round(float(lat), 4)}:{round(float(lon), 4)}:"
        f"{forecast_days}:{'f' if use_fahrenheit else 'c'}"
    )


def _multi_model_cache_key(
    collector: Any,
    city: str,
    lat: float,
    lon: float,
    *,
    use_fahrenheit: bool = False,
) -> str:
    cache_city = str(city or "").strip().lower()
    return (
        f"{round(float(lat), 4)}:{round(float(lon), 4)}:{cache_city}:"
        f"{'f' if use_fahrenheit else 'c'}:{collector.multi_model_cache_version}"
    )


def _read_open_meteo_bundle_from_cache(
    collector: Any,
    *,
    city: str,
    lat: float,
    lon: float,
    use_fahrenheit: bool,
    include_multi_model: bool,
) -> Dict[str, Any]:
    collector._maybe_reload_open_meteo_disk_cache()
    results: Dict[str, Any] = {}
    om_key = _open_meteo_cache_key(lat, lon, use_fahrenheit=use_fahrenheit)
    with collector._open_meteo_cache_lock:
        om_cached = collector._open_meteo_cache.get(om_key)

    if om_cached and isinstance(om_cached.get("data"), dict):
        results["open-meteo"] = dict(om_cached["data"])
    if include_multi_model:
        mm_key = _multi_model_cache_key(
            collector,
            city,
            lat,
            lon,
            use_fahrenheit=use_fahrenheit,
        )
        with collector._multi_model_cache_lock:
            mm_cached = collector._multi_model_cache.get(mm_key)
        if mm_cached and isinstance(mm_cached.get("data"), dict):
            results["multi_model"] = dict(mm_cached["data"])
    return results


def fetch_open_meteo_forecast_bundle(
    collector: Any,
    *,
    city: str,
    lat: float,
    lon: float,
    use_fahrenheit: bool,
    include_multi_model: bool = True,
    cache_only: bool = False,
) -> Dict[str, Any]:
    """Fetch non-high-frequency Open-Meteo forecast payloads for a city.

    Observation-only refreshes can set *cache_only* so high-frequency callers
    reuse existing model data without making outbound Open-Meteo requests.
    """
    if lat is None or lon is None:
        return {}

    if cache_only:
        return _read_open_meteo_bundle_from_cache(
            collector,
            city=city,
            lat=lat,
            lon=lon,
            use_fahrenheit=use_fahrenheit,
            include_multi_model=include_multi_model,
        )

    results: Dict[str, Any] = {}
    # Populate the richer multi-model cache before the regular forecast
    # endpoint can trip the shared Open-Meteo cooldown.
    if include_multi_model:
        multi_model_data = collector.fetch_multi_model(
            lat,
            lon,
            city=city,
            use_fahrenheit=use_fahrenheit,
        )
        if multi_model_data:
            results["multi_model"] = multi_model_data

    open_meteo = collector.fetch_from_open_meteo(
        lat,
        lon,
        use_fahrenheit=use_fahrenheit,
    )
    if open_meteo:
        results["open-meteo"] = open_meteo

    return results


def ensure_multi_model_hourly_payload(
    collector: Any,
    current: Any,
    *,
    city: str,
    lat: float,
    lon: float,
    use_fahrenheit: bool,
) -> Dict[str, Any]:
    """Return a multi-model payload with hourly curves when available."""
    current_payload = current if isinstance(current, dict) else {}
    if current_payload.get("hourly_times"):
        return current_payload

    hourly_payload = collector.fetch_multi_model(
        lat,
        lon,
        city=city,
        use_fahrenheit=use_fahrenheit,
    )
    if hourly_payload and hourly_payload.get("hourly_times"):
        return {**current_payload, **hourly_payload}
    return current_payload
