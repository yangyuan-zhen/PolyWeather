from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple

from loguru import logger

DEB_HOURLY_PEAK_CORRECTED_VERSION = "deb_hourly_peak_corrected.v1"

_DEFAULT_MAX_NEAREST_MINUTES = 75
_DEFAULT_MAX_ADJUSTMENT = 3.0


def _to_float(value: Any) -> Optional[float]:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if result != result:
        return None
    return result


def _parse_minutes(value: Any) -> Optional[int]:
    text = str(value or "").strip()
    if not text:
        return None
    if "T" in text:
        text = text.split("T", 1)[1]
    if " " in text:
        text = text.rsplit(" ", 1)[-1]
    text = text.replace("Z", "")
    if "+" in text:
        text = text.split("+", 1)[0]
    if "-" in text and text.count(":") >= 1 and text[0:1].isdigit():
        text = text.split("-", 1)[0]
    parts = text.split(":")
    if len(parts) < 2:
        return None
    try:
        hour = int(parts[0])
        minute = int(parts[1])
    except ValueError:
        return None
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return hour * 60 + minute


def _phase_for_minute(minute: int, first_h: Optional[int], last_h: Optional[int]) -> str:
    hour = minute // 60
    first = int(first_h if first_h is not None else 13)
    last = int(last_h if last_h is not None else 15)
    if hour < first:
        return "before_peak"
    if hour <= last:
        return "peak_window"
    return "after_peak"


def _nearest_value(
    target_minute: int,
    base_points: List[Tuple[int, float]],
    max_minutes: int,
) -> Optional[float]:
    best: Optional[Tuple[int, float]] = None
    for minute, value in base_points:
        distance = abs(minute - target_minute)
        if distance > max_minutes:
            continue
        if best is None or distance < best[0]:
            best = (distance, value)
    return best[1] if best is not None else None


def _mean(values: Iterable[float]) -> float:
    items = list(values)
    if not items:
        return 0.0
    return sum(items) / len(items)


def _clamp(value: float, limit: float) -> float:
    return max(-limit, min(limit, value))


def _stat(values: List[float], max_adjustment: float) -> Dict[str, Any]:
    average = _clamp(_mean(values), max_adjustment)
    return {
        "adjustment": round(average, 3),
        "samples": len(values),
    }


def _normalize_city(value: Any) -> str:
    return str(value or "").strip().lower()


def _iter_observations(snapshot: Dict[str, Any]) -> Tuple[str, List[Any]]:
    settlement_rows = snapshot.get("settlement_today_obs")
    if isinstance(settlement_rows, list) and settlement_rows:
        return "settlement", settlement_rows
    metar_rows = snapshot.get("metar_today_obs")
    if isinstance(metar_rows, list) and metar_rows:
        return "metar", metar_rows
    return "", []


def _obs_time_temp(item: Any) -> Tuple[Optional[int], Optional[float]]:
    if isinstance(item, dict):
        minute = _parse_minutes(
            item.get("time")
            or item.get("obs_time")
            or item.get("observation_time")
            or item.get("timestamp")
        )
        value = _to_float(item.get("temp") if "temp" in item else item.get("value"))
        return minute, value
    if isinstance(item, (list, tuple)) and len(item) >= 2:
        return _parse_minutes(item[0]), _to_float(item[1])
    return None, None


@dataclass(frozen=True)
class HourlyPeakCorrector:
    city_hour_adjustments: Dict[str, Dict[int, Dict[str, Any]]]
    city_phase_adjustments: Dict[str, Dict[str, Dict[str, Any]]]
    min_samples: int
    max_adjustment: float
    sample_count: int

    def _adjustment_for(self, city: str, minute: int, first_h: Optional[int], last_h: Optional[int]) -> Tuple[float, str]:
        city_key = _normalize_city(city)
        hour = minute // 60
        hour_stats = self.city_hour_adjustments.get(city_key, {}).get(hour)
        if hour_stats and int(hour_stats.get("samples") or 0) >= self.min_samples:
            return float(hour_stats.get("adjustment") or 0.0), "hour"
        phase = _phase_for_minute(minute, first_h, last_h)
        phase_stats = self.city_phase_adjustments.get(city_key, {}).get(phase)
        if phase_stats and int(phase_stats.get("samples") or 0) >= self.min_samples:
            return float(phase_stats.get("adjustment") or 0.0), phase
        return 0.0, "none"

    def apply(
        self,
        city: str,
        times: List[str],
        temps: List[Optional[float]],
        *,
        peak_first_h: Optional[int],
        peak_last_h: Optional[int],
        deb_prediction: Optional[float] = None,
    ) -> Dict[str, Any]:
        corrected: List[Optional[float]] = []
        applied_sources: Dict[str, int] = {}
        for index, raw in enumerate(temps):
            base_value = _to_float(raw)
            minute = _parse_minutes(times[index] if index < len(times) else None)
            if base_value is None or minute is None:
                corrected.append(None)
                continue
            adjustment, source = self._adjustment_for(city, minute, peak_first_h, peak_last_h)
            applied_sources[source] = applied_sources.get(source, 0) + 1
            corrected.append(round(base_value + adjustment, 1))

        anchor_adjustment = 0.0
        deb_value = _to_float(deb_prediction)
        numeric_values = [value for value in corrected if value is not None]
        if deb_value is not None and numeric_values:
            anchor_adjustment = deb_value - max(numeric_values)
            corrected = [
                round(value + anchor_adjustment, 1) if value is not None else None
                for value in corrected
            ]

        city_key = _normalize_city(city)
        return {
            "version": DEB_HOURLY_PEAK_CORRECTED_VERSION,
            "source": DEB_HOURLY_PEAK_CORRECTED_VERSION,
            "times": list(times),
            "temps": corrected,
            "samples": self.sample_count,
            "phase_adjustments": self.city_phase_adjustments.get(city_key, {}),
            "hour_adjustments": self.city_hour_adjustments.get(city_key, {}),
            "applied_sources": applied_sources,
            "anchor_adjustment": round(anchor_adjustment, 3),
        }


def build_hourly_peak_corrector(
    snapshots: Iterable[Dict[str, Any]],
    *,
    min_samples: int = 6,
    max_adjustment: float = _DEFAULT_MAX_ADJUSTMENT,
    nearest_minutes: int = _DEFAULT_MAX_NEAREST_MINUTES,
) -> HourlyPeakCorrector:
    hour_errors: Dict[str, Dict[int, List[float]]] = {}
    phase_errors: Dict[str, Dict[str, List[float]]] = {}
    seen_observations: set[Tuple[str, str, str, int]] = set()
    sample_count = 0

    for snapshot in snapshots:
        if not isinstance(snapshot, dict):
            continue
        city_key = _normalize_city(snapshot.get("city"))
        if not city_key:
            continue
        base_path = snapshot.get("deb_base_path") or {}
        base_times = base_path.get("times") if isinstance(base_path, dict) else []
        base_temps = base_path.get("temps") if isinstance(base_path, dict) else []
        if not isinstance(base_times, list) or not isinstance(base_temps, list):
            continue
        base_points: List[Tuple[int, float]] = []
        for index, time_value in enumerate(base_times):
            minute = _parse_minutes(time_value)
            value = _to_float(base_temps[index] if index < len(base_temps) else None)
            if minute is not None and value is not None:
                base_points.append((minute, value))
        if not base_points:
            continue

        peak = snapshot.get("peak") or {}
        first_h = peak.get("first_h") if isinstance(peak, dict) else None
        last_h = peak.get("last_h") if isinstance(peak, dict) else None
        source_key, obs_rows = _iter_observations(snapshot)
        if not obs_rows:
            continue

        target_date = str(snapshot.get("target_date") or snapshot.get("local_date") or "").strip()
        for item in obs_rows:
            minute, observed = _obs_time_temp(item)
            if minute is None or observed is None:
                continue
            dedupe_key = (city_key, target_date, source_key, minute)
            if dedupe_key in seen_observations:
                continue
            seen_observations.add(dedupe_key)
            base_value = _nearest_value(minute, base_points, nearest_minutes)
            if base_value is None:
                continue
            error = _clamp(observed - base_value, max_adjustment)
            hour = minute // 60
            phase = _phase_for_minute(minute, first_h, last_h)
            hour_errors.setdefault(city_key, {}).setdefault(hour, []).append(error)
            phase_errors.setdefault(city_key, {}).setdefault(phase, []).append(error)
            sample_count += 1

    city_hour_adjustments = {
        city: {
            hour: _stat(values, max_adjustment)
            for hour, values in hours.items()
            if len(values) >= min_samples
        }
        for city, hours in hour_errors.items()
    }
    city_phase_adjustments = {
        city: {
            phase: _stat(values, max_adjustment)
            for phase, values in phases.items()
            if len(values) >= min_samples
        }
        for city, phases in phase_errors.items()
    }
    return HourlyPeakCorrector(
        city_hour_adjustments=city_hour_adjustments,
        city_phase_adjustments=city_phase_adjustments,
        min_samples=min_samples,
        max_adjustment=max_adjustment,
        sample_count=sample_count,
    )


def build_deb_hourly_path(
    *,
    city: str,
    hourly_times: List[str],
    hourly_temps: List[Optional[float]],
    deb_prediction: Optional[float],
    peak_first_h: Optional[int],
    peak_last_h: Optional[int],
    corrector: HourlyPeakCorrector,
    base_source: str = "hourly_plus_deb_offset",
) -> Dict[str, Any]:
    deb_value = _to_float(deb_prediction)
    numeric_base = [_to_float(value) for value in hourly_temps]
    numeric_only = [value for value in numeric_base if value is not None]
    if deb_value is not None and numeric_only:
        offset = deb_value - max(numeric_only)
    else:
        offset = 0.0
    base_temps = [
        round(value + offset, 1) if value is not None else None
        for value in numeric_base
    ]
    applied = corrector.apply(
        city,
        list(hourly_times),
        base_temps,
        peak_first_h=peak_first_h,
        peak_last_h=peak_last_h,
        deb_prediction=deb_value,
    )
    return {
        "source": DEB_HOURLY_PEAK_CORRECTED_VERSION,
        "version": DEB_HOURLY_PEAK_CORRECTED_VERSION,
        "times": applied["times"],
        "temps": applied["temps"],
        "base_source": base_source,
        "base_offset": round(offset, 3),
        "correction": {
            "version": applied["version"],
            "samples": applied["samples"],
            "phase_adjustments": applied["phase_adjustments"],
            "hour_adjustments": applied["hour_adjustments"],
            "applied_sources": applied["applied_sources"],
            "anchor_adjustment": applied["anchor_adjustment"],
        },
    }


_CORRECTOR_CACHE: Dict[str, Any] = {"loaded_at": 0.0, "corrector": None}


def get_cached_hourly_peak_corrector(
    *,
    ttl_seconds: int = 600,
    max_rows: int = 20000,
    min_samples: int = 6,
) -> HourlyPeakCorrector:
    now = time.time()
    cached = _CORRECTOR_CACHE.get("corrector")
    if cached is not None and now - float(_CORRECTOR_CACHE.get("loaded_at") or 0) < ttl_seconds:
        return cached

    rows: List[Dict[str, Any]] = []
    try:
        from src.database.runtime_state import IntradayPathSnapshotRepository

        repo = IntradayPathSnapshotRepository()
        if hasattr(repo, "load_recent_rows"):
            rows = repo.load_recent_rows(limit=max_rows)
        else:
            rows = repo.load_all_rows()[-max_rows:]
    except Exception as exc:
        logger.debug(f"DEB hourly peak corrector load skipped: {exc}")

    corrector = build_hourly_peak_corrector(rows, min_samples=min_samples)
    _CORRECTOR_CACHE["loaded_at"] = now
    _CORRECTOR_CACHE["corrector"] = corrector
    return corrector
