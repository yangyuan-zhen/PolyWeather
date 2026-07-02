from __future__ import annotations

import math
import os
import json
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, Mapping, Optional, Sequence, Union

from loguru import logger


WEATHERNEXT2_SOURCE = "weathernext2"
WEATHERNEXT2_PROVIDER = "google_deepmind"
WEATHERNEXT2_GCS_ZARR_URI = "gs://weathernext/weathernext_2_0_0/zarr"
WEATHERNEXT2_MEAN_GCS_ZARR_URI = "gs://weathernext/weathernext_2_0_0_mean/zarr"

Number = Union[int, float]


def _numeric(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _round1(value: Number) -> float:
    return round(float(value), 1)


def _round3(value: Number) -> float:
    return round(float(value), 3)


def _settle_integer(value: Number) -> int:
    parsed = float(value)
    if parsed >= 0:
        return int(math.floor(parsed + 0.5))
    return int(math.ceil(parsed - 0.5))


def _is_fahrenheit(temp_symbol: str) -> bool:
    return "F" in str(temp_symbol or "").upper()


def _unit(temp_symbol: str) -> str:
    return "°F" if _is_fahrenheit(temp_symbol) else "°C"


def market_bucket_for_temperature(value: Number, temp_symbol: str = "°C") -> Dict[str, Any]:
    """Return the tradable market option bucket for a single member temperature."""
    unit = _unit(temp_symbol)
    settled = _settle_integer(value)
    if _is_fahrenheit(unit):
        lower_value = settled if settled % 2 == 0 else settled - 1
        upper_value = lower_value + 1
        return {
            "key": f"{lower_value}-{upper_value}{unit}",
            "label": f"{lower_value}-{upper_value}{unit}",
            "lower": float(lower_value) - 0.5,
            "upper": float(upper_value) + 0.5,
            "sort_value": float(lower_value),
        }
    return {
        "key": f"{settled}{unit}",
        "label": f"{settled}{unit}",
        "lower": float(settled) - 0.5,
        "upper": float(settled) + 0.5,
        "sort_value": float(settled),
    }


def _member_items(member_highs: Union[Mapping[str, Any], Sequence[Any]]) -> Iterable[tuple[str, float]]:
    if isinstance(member_highs, Mapping):
        iterable = member_highs.items()
    else:
        iterable = ((f"member_{idx:02d}", value) for idx, value in enumerate(member_highs))
    for member_id, value in iterable:
        parsed = _numeric(value)
        if parsed is not None:
            yield str(member_id), parsed


def summarize_member_highs(member_highs: Union[Mapping[str, Any], Sequence[Any]]) -> Dict[str, Any]:
    values = sorted(value for _member_id, value in _member_items(member_highs))
    if not values:
        return {
            "members": 0,
            "mean": None,
            "median": None,
            "p10": None,
            "p25": None,
            "p75": None,
            "p90": None,
            "min": None,
            "max": None,
            "spread": None,
        }

    def percentile(q: float) -> float:
        if len(values) == 1:
            return values[0]
        position = (len(values) - 1) * q
        lower_idx = int(math.floor(position))
        upper_idx = int(math.ceil(position))
        if lower_idx == upper_idx:
            return values[lower_idx]
        weight = position - lower_idx
        return values[lower_idx] * (1 - weight) + values[upper_idx] * weight

    return {
        "members": len(values),
        "mean": _round1(sum(values) / len(values)),
        "median": _round1(percentile(0.5)),
        "p10": _round1(percentile(0.1)),
        "p25": _round1(percentile(0.25)),
        "p75": _round1(percentile(0.75)),
        "p90": _round1(percentile(0.9)),
        "min": _round1(values[0]),
        "max": _round1(values[-1]),
        "spread": _round1(values[-1] - values[0]),
    }


def build_market_bucket_probabilities(
    member_highs: Union[Mapping[str, Any], Sequence[Any]],
    temp_symbol: str = "°C",
) -> list[Dict[str, Any]]:
    grouped: Dict[str, Dict[str, Any]] = {}
    total_members = 0

    for _member_id, value in _member_items(member_highs):
        total_members += 1
        option = market_bucket_for_temperature(value, temp_symbol)
        bucket = grouped.setdefault(
            option["key"],
            {
                "key": option["key"],
                "label": option["label"],
                "lower": option["lower"],
                "upper": option["upper"],
                "sort_value": option["sort_value"],
                "weighted_sum": 0.0,
                "member_count": 0,
            },
        )
        bucket["weighted_sum"] += value
        bucket["member_count"] += 1

    if total_members <= 0:
        return []

    buckets = []
    for bucket in grouped.values():
        member_count = int(bucket["member_count"])
        buckets.append(
            {
                "key": bucket["key"],
                "label": bucket["label"],
                "lower": bucket["lower"],
                "upper": bucket["upper"],
                "value": _round1(bucket["weighted_sum"] / member_count),
                "probability": _round3(member_count / total_members),
                "member_count": member_count,
                "total_members": total_members,
            }
        )

    return sorted(buckets, key=lambda item: (float(item["lower"]), float(item["upper"])))


def _parse_utc_time(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value or "").strip()
        if not text:
            return None
        if text.endswith("Z"):
            text = f"{text[:-1]}+00:00"
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _parse_date(value: Any) -> Optional[date]:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text[:10]).date()
    except ValueError:
        return None


def build_city_local_daily_highs_from_hourly(
    member_hourly: Mapping[str, Sequence[Any]],
    utc_times: Sequence[Any],
    timezone_offset_seconds: int,
    target_local_date: Any,
) -> Dict[str, float]:
    """Reduce hourly ensemble member temperatures to local-date daily highs."""
    target_date = _parse_date(target_local_date)
    if target_date is None:
        return {}

    parsed_times = [_parse_utc_time(value) for value in utc_times]
    highs: Dict[str, float] = {}
    offset = timedelta(seconds=int(timezone_offset_seconds or 0))

    for member_id, values in member_hourly.items():
        member_values = []
        for idx, utc_time in enumerate(parsed_times):
            if utc_time is None or idx >= len(values):
                continue
            local_date = (utc_time + offset).date()
            if local_date != target_date:
                continue
            parsed = _numeric(values[idx])
            if parsed is not None:
                member_values.append(parsed)
        if member_values:
            highs[str(member_id)] = _round1(max(member_values))

    return highs


def build_weathernext2_city_probability(
    *,
    city: str,
    member_highs: Union[Mapping[str, Any], Sequence[Any]],
    temp_symbol: str = "°C",
    target_date: Optional[str] = None,
    source_run: Optional[str] = None,
    generated_at: Optional[str] = None,
) -> Dict[str, Any]:
    """Build a WeatherNext 2 probability payload aligned with tradable market options."""
    buckets = build_market_bucket_probabilities(member_highs, temp_symbol=temp_symbol)
    summary = summarize_member_highs(member_highs)
    normalized_member_highs = {
        member_id: _round1(value)
        for member_id, value in _member_items(member_highs)
    }
    top_bucket = (
        max(buckets, key=lambda item: (float(item["probability"]), float(item["lower"])))
        if buckets
        else None
    )

    return {
        "source": WEATHERNEXT2_SOURCE,
        "provider": WEATHERNEXT2_PROVIDER,
        "city": str(city or "").strip(),
        "target_date": target_date,
        "source_run": source_run,
        "generated_at": generated_at or datetime.now(timezone.utc).isoformat(),
        "temp_symbol": _unit(temp_symbol),
        "members": int(summary["members"] or 0),
        "member_highs": normalized_member_highs,
        "summary": summary,
        "buckets": buckets,
        "top_bucket": top_bucket,
        "bucket_policy": "celsius_single_fahrenheit_two_degree_market_options",
        "gcs_zarr_uri": os.getenv("WEATHERNEXT2_GCS_ZARR_URI", WEATHERNEXT2_GCS_ZARR_URI),
        "mean_gcs_zarr_uri": os.getenv("WEATHERNEXT2_MEAN_GCS_ZARR_URI", WEATHERNEXT2_MEAN_GCS_ZARR_URI),
    }


def _env_enabled(name: str, default: str = "0") -> bool:
    return str(os.getenv(name, default) or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _city_key(city: str) -> str:
    return str(city or "").strip().lower()


def _load_fixture_payload(path: str, city: str) -> Optional[Dict[str, Any]]:
    if not path:
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except Exception as exc:
        logger.warning("WeatherNext2 fixture load failed path={}: {}", path, exc)
        return None
    if not isinstance(payload, dict):
        return None

    key = _city_key(city)
    if isinstance(payload.get(key), dict):
        return dict(payload[key])
    for candidate, value in payload.items():
        if _city_key(candidate) == key and isinstance(value, dict):
            return dict(value)
    if "member_highs" in payload or "member_hourly" in payload:
        return dict(payload)
    return None


def _weathernext2_data_root() -> str:
    return str(os.getenv("WEATHERNEXT2_DATA_ROOT", "/app/data/weathernext2") or "").strip()


def _weathernext2_artifact_path() -> str:
    configured = str(os.getenv("WEATHERNEXT2_CITY_HIGHS_PATH", "") or "").strip()
    if configured:
        return configured
    return os.path.join(_weathernext2_data_root(), "weathernext2_city_highs.json")


def _weathernext2_model_dir() -> str:
    return str(
        os.getenv(
            "WEATHERNEXT2_MODEL_DIR",
            "/app/data/models/weathernext2_calibrator",
        )
        or ""
    ).strip()


def _load_artifact_payload(path: str, city: str) -> Optional[Dict[str, Any]]:
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except Exception as exc:
        logger.warning("WeatherNext2 artifact load failed path={}: {}", path, exc)
        return None
    if not isinstance(payload, dict):
        return None

    key = _city_key(city)
    city_payloads: Any = payload.get("cities")
    if isinstance(city_payloads, dict):
        if isinstance(city_payloads.get(key), dict):
            return dict(city_payloads[key])
        for candidate, value in city_payloads.items():
            if _city_key(candidate) == key and isinstance(value, dict):
                return dict(value)
    if isinstance(city_payloads, list):
        for value in city_payloads:
            if not isinstance(value, dict):
                continue
            if _city_key(value.get("city")) == key:
                return dict(value)

    if isinstance(payload.get(key), dict):
        return dict(payload[key])
    for candidate, value in payload.items():
        if _city_key(candidate) == key and isinstance(value, dict):
            return dict(value)
    return None


class WeatherNext2SourceMixin:
    """Optional WeatherNext 2 probability source.

    The live Google datasets require project access and optional heavy client
    dependencies. This mixin keeps production safe by supporting a fixture or
    prepared payload first, while reserving backend configuration for the real
    GCS/BigQuery fetcher.
    """

    def _weathernext2_enabled(self) -> bool:
        return _env_enabled("WEATHERNEXT2_ENABLED")

    def _weathernext2_cache_key(
        self,
        city: str,
        lat: float,
        lon: float,
        use_fahrenheit: bool,
        target_date: Optional[str],
    ) -> str:
        return (
            f"{_city_key(city)}:{round(float(lat), 4)}:{round(float(lon), 4)}:"
            f"{'f' if use_fahrenheit else 'c'}:{target_date or ''}"
        )

    def _weathernext2_cache_state(self) -> tuple[Dict[str, Dict[str, Any]], threading.Lock, int]:
        if not hasattr(self, "_weathernext2_cache"):
            self._weathernext2_cache = {}
        if not hasattr(self, "_weathernext2_cache_lock"):
            self._weathernext2_cache_lock = threading.Lock()
        ttl_sec = int(os.getenv("WEATHERNEXT2_CACHE_TTL_SEC", "21600"))
        return self._weathernext2_cache, self._weathernext2_cache_lock, ttl_sec

    def _weathernext2_target_date(
        self,
        timezone_offset_seconds: Optional[int],
        target_date: Optional[str],
    ) -> str:
        if target_date:
            return str(target_date)
        offset = timedelta(seconds=int(timezone_offset_seconds or 0))
        return (datetime.now(timezone.utc) + offset).date().isoformat()

    def _weathernext2_from_fixture(
        self,
        *,
        city: str,
        use_fahrenheit: bool,
        target_date: str,
        timezone_offset_seconds: Optional[int],
    ) -> Optional[Dict[str, Any]]:
        fixture_path = str(os.getenv("WEATHERNEXT2_FIXTURE_PATH", "") or "").strip()
        fixture = _load_fixture_payload(fixture_path, city)
        if not fixture:
            return None

        temp_symbol = "°F" if use_fahrenheit else "°C"
        fixture_target_date = str(fixture.get("target_date") or target_date)
        member_highs = fixture.get("member_highs")
        if member_highs is None and isinstance(fixture.get("member_hourly"), dict):
            member_highs = build_city_local_daily_highs_from_hourly(
                fixture["member_hourly"],
                fixture.get("utc_times") or fixture.get("times") or [],
                int(timezone_offset_seconds or fixture.get("timezone_offset_seconds") or 0),
                fixture_target_date,
            )
        if member_highs is None:
            return None

        return build_weathernext2_city_probability(
            city=city,
            member_highs=member_highs,
            temp_symbol=temp_symbol,
            target_date=fixture_target_date,
            source_run=fixture.get("source_run"),
            generated_at=fixture.get("generated_at"),
        )

    def _weathernext2_normalize_prepared_payload(
        self,
        *,
        payload: Mapping[str, Any],
        city: str,
        use_fahrenheit: bool,
        target_date: str,
        timezone_offset_seconds: Optional[int],
    ) -> Optional[Dict[str, Any]]:
        temp_symbol = "°F" if use_fahrenheit else "°C"
        payload_target_date = str(payload.get("target_date") or target_date)
        member_highs = payload.get("member_highs")
        if member_highs is None and isinstance(payload.get("member_hourly"), dict):
            member_highs = build_city_local_daily_highs_from_hourly(
                payload["member_hourly"],
                payload.get("utc_times") or payload.get("times") or [],
                int(timezone_offset_seconds or payload.get("timezone_offset_seconds") or 0),
                payload_target_date,
            )
        if member_highs is None and isinstance(payload.get("buckets"), list):
            normalized = dict(payload)
            normalized.setdefault("source", WEATHERNEXT2_SOURCE)
            normalized.setdefault("provider", WEATHERNEXT2_PROVIDER)
            normalized.setdefault("city", city)
            normalized.setdefault("target_date", payload_target_date)
            normalized.setdefault("temp_symbol", temp_symbol)
            normalized.setdefault(
                "gcs_zarr_uri",
                os.getenv("WEATHERNEXT2_GCS_ZARR_URI", WEATHERNEXT2_GCS_ZARR_URI),
            )
            return normalized
        if member_highs is None:
            return None
        return build_weathernext2_city_probability(
            city=city,
            member_highs=member_highs,
            temp_symbol=temp_symbol,
            target_date=payload_target_date,
            source_run=payload.get("source_run"),
            generated_at=payload.get("generated_at"),
        )

    def _weathernext2_from_artifact(
        self,
        *,
        city: str,
        use_fahrenheit: bool,
        target_date: str,
        timezone_offset_seconds: Optional[int],
    ) -> Optional[Dict[str, Any]]:
        artifact = _load_artifact_payload(_weathernext2_artifact_path(), city)
        if not artifact:
            return None
        payload = self._weathernext2_normalize_prepared_payload(
            payload=artifact,
            city=city,
            use_fahrenheit=use_fahrenheit,
            target_date=target_date,
            timezone_offset_seconds=timezone_offset_seconds,
        )
        if payload is None:
            return None
        try:
            from src.analysis.weathernext2_calibration import apply_quantile_calibration_to_payload

            return apply_quantile_calibration_to_payload(
                payload,
                model_dir=_weathernext2_model_dir(),
            )
        except Exception as exc:
            logger.warning("WeatherNext2 calibration apply failed city={}: {}", city, exc)
            return payload

    def fetch_weathernext2_probability(
        self,
        city: str,
        lat: float,
        lon: float,
        *,
        use_fahrenheit: bool = False,
        target_date: Optional[str] = None,
        timezone_offset_seconds: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        if not self._weathernext2_enabled():
            return None
        if lat is None or lon is None:
            return None

        resolved_target_date = self._weathernext2_target_date(
            timezone_offset_seconds,
            target_date,
        )
        cache_key = self._weathernext2_cache_key(
            city,
            lat,
            lon,
            use_fahrenheit,
            resolved_target_date,
        )
        cache, lock, ttl_sec = self._weathernext2_cache_state()
        now_ts = time.time()
        with lock:
            cached = cache.get(cache_key)
            cached_data = cached.get("data") if isinstance(cached, dict) else None
            if isinstance(cached_data, dict) and now_ts - float(cached.get("t", 0)) < ttl_sec:
                return dict(cached_data)

        payload = self._weathernext2_from_artifact(
            city=city,
            use_fahrenheit=use_fahrenheit,
            target_date=resolved_target_date,
            timezone_offset_seconds=timezone_offset_seconds,
        )
        if payload is None:
            payload = self._weathernext2_from_fixture(
                city=city,
                use_fahrenheit=use_fahrenheit,
                target_date=resolved_target_date,
                timezone_offset_seconds=timezone_offset_seconds,
            )
        if payload is None:
            backend = str(os.getenv("WEATHERNEXT2_BACKEND", "") or "").strip().lower()
            if backend:
                logger.warning(
                    "WeatherNext2 backend={} configured but live fetcher is not installed; use fixture/prepared payload first",
                    backend,
                )
            return None

        with lock:
            cache[cache_key] = {"t": now_ts, "data": dict(payload)}
        return payload
