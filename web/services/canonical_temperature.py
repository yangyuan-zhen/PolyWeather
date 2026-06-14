from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Dict, Optional


_SETTLEMENT_PROXY_SOURCES = {"amsc_awos", "amos", "runway", "awos"}
_SETTLEMENT_OFFICIAL_SOURCES = {"hko", "cwa", "noaa", "wunderground", "mgm", "knmi", "ims"}
_AIRPORT_OFFICIAL_SOURCES = {"metar", "madis_hfmetar", "aeroweb"}


def _to_float(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int(value: Any) -> Optional[int]:
    try:
        if value is None or value == "":
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _source_role(source: str) -> str:
    normalized = str(source or "").strip().lower()
    if normalized in _SETTLEMENT_PROXY_SOURCES or "amsc" in normalized or "runway" in normalized:
        return "settlement_proxy"
    if (
        normalized in _SETTLEMENT_OFFICIAL_SOURCES
        or "hko" in normalized
        or "cowin" in normalized
        or "cwa" in normalized
    ):
        return "settlement_official"
    if normalized in _AIRPORT_OFFICIAL_SOURCES or "metar" in normalized or "madis" in normalized:
        return "airport_official"
    if "model" in normalized or normalized in {"deb", "open_meteo"}:
        return "model_blend"
    return "fallback"


def _confidence(source_role: str, freshness_status: str) -> float:
    base = {
        "settlement_proxy": 0.92,
        "settlement_official": 0.9,
        "airport_official": 0.78,
        "model_blend": 0.55,
        "fallback": 0.42,
    }.get(source_role, 0.42)
    penalty = {
        "fresh": 0.0,
        "expected_wait": 0.03,
        "delayed": 0.1,
        "stale": 0.18,
        "expired": 0.28,
        "missing": 0.35,
        "unknown": 0.12,
    }.get(str(freshness_status or "").strip().lower(), 0.12)
    return round(max(0.05, min(0.99, base - penalty)), 2)


def build_canonical_temperature(
    city: str,
    payload: Dict[str, Any],
    *,
    fetched_at: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    if not isinstance(payload, dict):
        return None
    current = payload.get("current") or {}
    if not isinstance(current, dict):
        return None
    value = _to_float(current.get("temp"))
    if value is None:
        return None

    freshness = current.get("freshness") or {}
    if not isinstance(freshness, dict):
        freshness = {}
    source = str(
        current.get("source_code")
        or current.get("settlement_source")
        or current.get("source")
        or freshness.get("source_code")
        or ""
    ).strip().lower()
    source_label = str(
        current.get("settlement_source_label")
        or current.get("source_label")
        or freshness.get("source_label")
        or source.upper()
    ).strip()
    observed_at = str(
        current.get("observed_at")
        or current.get("observation_time")
        or freshness.get("observed_at")
        or ""
    ).strip()
    observed_at_local = str(
        current.get("observed_at_local")
        or freshness.get("observed_at_local")
        or current.get("obs_time")
        or ""
    ).strip()
    freshness_sec = _to_int(freshness.get("age_sec"))
    if freshness_sec is None:
        age_min = _to_float(current.get("obs_age_min"))
        if age_min is not None:
            freshness_sec = int(age_min * 60)
    freshness_status = str(
        freshness.get("freshness_status")
        or current.get("observation_status")
        or "unknown"
    ).strip().lower()
    role = _source_role(source)
    canonical = {
        "city": str(city or payload.get("name") or payload.get("city") or "").strip().lower(),
        "value": round(value, 2),
        "temp_symbol": str(payload.get("temp_symbol") or "°C"),
        "source": source,
        "source_label": source_label,
        "source_role": role,
        "station_code": current.get("station_code"),
        "station_name": current.get("station_name"),
        "observed_at": observed_at or None,
        "observed_at_local": observed_at_local or None,
        "fetched_at": str(fetched_at or payload.get("updated_at") or _now_iso()),
        "freshness_sec": freshness_sec,
        "freshness_status": freshness_status,
        "confidence": _confidence(role, freshness_status),
    }
    age_text = f" updated {freshness_sec}s ago" if freshness_sec is not None else ""
    canonical["explanation"] = f"{source_label or source or 'Source'}{age_text}."
    return canonical


def attach_canonical_temperature(
    payload: Dict[str, Any],
    *,
    city: Optional[str] = None,
) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return payload
    next_payload = payload
    canonical = build_canonical_temperature(
        city or str(payload.get("name") or payload.get("city") or ""),
        next_payload,
    )
    if canonical:
        next_payload["canonical_temperature"] = canonical
    return next_payload


def store_canonical_temperature_from_payload(db: Any, city: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    canonical = build_canonical_temperature(city, payload)
    if not canonical:
        return None
    setter = getattr(db, "set_canonical_temperature", None)
    if callable(setter):
        setter(city, canonical)
    return canonical


def build_city_weather_from_canonical(city: str, canonical: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(canonical, dict):
        return None
    value = _to_float(canonical.get("value"))
    if value is None:
        return None
    observed_at = str(canonical.get("observed_at") or "").strip()
    observed_at_local = str(canonical.get("observed_at_local") or "").strip()
    source = str(canonical.get("source") or "").strip().lower()
    source_label = str(canonical.get("source_label") or source.upper()).strip()
    freshness = {
        "freshness_status": canonical.get("freshness_status") or "unknown",
        "age_sec": canonical.get("freshness_sec"),
        "observed_at": observed_at or None,
        "observed_at_local": observed_at_local or None,
    }
    current = {
        "temp": value,
        "source_code": source,
        "settlement_source": source,
        "settlement_source_label": source_label,
        "observed_at": observed_at or None,
        "observed_at_local": observed_at_local or None,
        "obs_time": observed_at_local or observed_at,
        "freshness": freshness,
        "observation_status": "live",
    }
    airport_primary = {
        "temp": value,
        "source_code": source,
        "source_label": source_label,
        "obs_time": observed_at or observed_at_local,
        "freshness": freshness,
    }
    payload = {
        "name": str(city or canonical.get("city") or "").strip().lower(),
        "temp_symbol": str(canonical.get("temp_symbol") or "°C"),
        "current": current,
        "airport_primary": airport_primary,
        "airport_current": deepcopy(airport_primary),
        "canonical_temperature": dict(canonical),
        "deb": {"prediction": canonical.get("deb_prediction")},
        "updated_at": canonical.get("fetched_at"),
    }
    return payload
