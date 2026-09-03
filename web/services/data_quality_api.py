"""Unified per-city data-quality snapshot (read-only)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from src.data_collection.city_registry import CITY_REGISTRY
from src.data_collection.data_quality import evaluate_observation


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_data_quality_snapshot(db: Any = None) -> Dict[str, Any]:
    """Return one row per city: source/station/times/age/status/fallback/error."""
    rows: List[Dict[str, Any]] = []
    counts: Dict[str, int] = {}
    fallback_count = 0
    now = datetime.now(timezone.utc)
    status_by_city: Dict[str, Dict[str, Any]] = {}
    try:
        from src.database.runtime_state import ObservationCollectorStatusRepository

        snapshot = ObservationCollectorStatusRepository(db).load_snapshot(limit=1000) if db is not None else {}
        entries = snapshot.get("entries") if isinstance(snapshot, dict) else None
        for entry in entries or []:
            if not isinstance(entry, dict):
                continue
            key = str(entry.get("city") or "").strip().lower()
            if not key:
                continue
            prev = status_by_city.get(key)
            cur_fail = int(entry.get("failure_count") or 0)
            prev_fail = int((prev or {}).get("failure_count") or 0)
            if prev is None or cur_fail > prev_fail:
                status_by_city[key] = entry
    except Exception:
        status_by_city = {}
    for city in sorted(CITY_REGISTRY.keys()):
        row: Dict[str, Any] = {
            "city": city,
            "source": None,
            "station": None,
            "latest_observation_at": None,
            "fetched_at": None,
            "age_seconds": None,
            "status": "stale",
            "fallback_in_use": False,
            "consecutive_failures": 0,
            "request_latency_ms": None,
            "last_error": None,
            "quality_flags": ["no_observation"],
        }
        try:
            canonical = None
            getter = getattr(db, "get_canonical_temperature", None) if db is not None else None
            if callable(getter):
                canonical = getter(city)
            if isinstance(canonical, dict):
                current = canonical.get("current") if isinstance(canonical.get("current"), dict) else {}
                source = str(
                    current.get("source_code")
                    or current.get("settlement_source")
                    or canonical.get("source")
                    or ""
                ).strip().lower()
                station = str(current.get("station_code") or "").strip().upper()
                observed_at = current.get("observed_at") or current.get("obs_time")
                fetched_at = canonical.get("updated_at") or canonical.get("fetched_at")
                temp = current.get("temp")
                quality = evaluate_observation(
                    source=source or "unknown",
                    station=station,
                    observed_at=observed_at,
                    fetched_at=fetched_at,
                    temp=temp,
                    value_unit="c",
                    now_utc=now,
                )
                row.update(
                    {
                        "source": source or None,
                        "station": station or None,
                        "latest_observation_at": quality["observed_at"],
                        "fetched_at": quality["fetched_at"],
                        "age_seconds": quality["age_seconds"],
                        "status": quality["status"],
                        "fallback_in_use": bool(quality["status"] == "fallback"),
                        "quality_flags": quality["quality_flags"],
                    }
                )
        except Exception:
            row["quality_flags"] = ["snapshot_error"]
        # Overlay collector status when available (failures/latency/error).
        status_row = status_by_city.get(city)
        if isinstance(status_row, dict):
            row["consecutive_failures"] = int(status_row.get("failure_count") or 0)
            row["request_latency_ms"] = status_row.get("last_latency_ms")
            row["last_error"] = status_row.get("last_error")
            if row["consecutive_failures"] > 0 and row["status"] in {"fresh", "delayed"}:
                row["quality_flags"] = list(row["quality_flags"]) + ["recent_failures"]
        counts[row["status"]] = counts.get(row["status"], 0) + 1
        if row["fallback_in_use"]:
            fallback_count += 1
        rows.append(row)
    degraded = counts.get("delayed", 0) + counts.get("fallback", 0)
    critical = counts.get("stale", 0) + counts.get("invalid", 0) + counts.get("source_error", 0)
    overall = "ok" if critical == 0 and degraded == 0 else ("degraded" if critical == 0 else "critical")
    return {
        "checked_at": _iso_now(),
        "overall": overall,
        "total_cities": len(rows),
        "status_counts": counts,
        "fallback_count": fallback_count,
        "cities": rows,
    }
