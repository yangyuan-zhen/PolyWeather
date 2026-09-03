"""Unified per-city data-quality snapshot (read-only)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from src.data_collection.city_registry import CITY_REGISTRY
from src.data_collection.data_quality import (
    combine_observation_with_source_health,
    evaluate_observation,
    fallback_info,
)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_data_quality_snapshot(db: Any = None) -> Dict[str, Any]:
    """Return one row per city: source/station/times/age/status/fallback/error."""
    rows: List[Dict[str, Any]] = []
    counts: Dict[str, int] = {}
    fallback_count = 0
    now = datetime.now(timezone.utc)
    entries_by_city_source: Dict[tuple[str, str], Dict[str, Any]] = {}
    try:
        from src.database.runtime_state import ObservationCollectorStatusRepository, RuntimeStateDB

        if db is not None and hasattr(db, "db_path"):
            status_db = RuntimeStateDB(str(db.db_path))
        elif db is not None and hasattr(db, "connect"):
            status_db = db
        else:
            status_db = RuntimeStateDB.instance()
        snapshot = ObservationCollectorStatusRepository(status_db).load_snapshot(limit=1000)
        entries = snapshot.get("entries") if isinstance(snapshot, dict) else None
        for entry in entries or []:
            if not isinstance(entry, dict):
                continue
            key = str(entry.get("city") or "").strip().lower()
            if not key:
                continue
            skey = str(entry.get("source") or "").strip().lower()
            ekey = (key, skey)
            prev = entries_by_city_source.get(ekey)
            try:
                newer = float(entry.get("updated_at_ts") or 0) > float((prev or {}).get("updated_at_ts") or 0)
            except (TypeError, ValueError):
                newer = prev is None
            if prev is None or newer:
                entries_by_city_source[ekey] = entry
    except Exception:
        entries_by_city_source = {}
    for city in sorted(CITY_REGISTRY.keys()):
        row: Dict[str, Any] = {
            "city": city,
            "source": None,
            "station": None,
            "latest_observation_at": None,
            "fetched_at": None,
            "age_seconds": None,
            "freshness_status": "unknown",
            "status": "stale",
            "fallback_in_use": False,
            "fallback_reason": "",
            "fallback_since": None,
            "primary_source": None,
            "active_source": None,
            "primary_last_success_at": None,
            "last_success_at": None,
            "last_error_at": None,
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
                # Canonical payloads are flat (value/source/observed_at at top
                # level); some paths nest a "current" block, prefer flat first.
                current = canonical.get("current") if isinstance(canonical.get("current"), dict) else {}
                source = str(
                    canonical.get("source")
                    or current.get("source_code")
                    or current.get("settlement_source")
                    or ""
                ).strip().lower()
                station = str(
                    canonical.get("station_code") or current.get("station_code") or ""
                ).strip().upper()
                observed_at = canonical.get("observed_at") or current.get("observed_at") or current.get("obs_time")
                fetched_at = canonical.get("fetched_at") or canonical.get("updated_at")
                temp = canonical.get("value", current.get("temp"))
                info = fallback_info(city=city, active_source=source, active_observed_at=observed_at)
                quality = evaluate_observation(
                    source=source or "unknown",
                    station=station,
                    observed_at=observed_at,
                    fetched_at=fetched_at,
                    temp=temp,
                    value_unit="c",
                    fallback_in_use=bool(info["fallback_in_use"]),
                    now_utc=now,
                )
                row.update(
                    {
                        "source": source or None,
                        "station": station or None,
                        "latest_observation_at": quality["observed_at"],
                        "fetched_at": quality["fetched_at"],
                        "age_seconds": quality["age_seconds"],
                        "freshness_status": quality["freshness_status"],
                        "status": quality["status"],
                        "fallback_in_use": bool(info["fallback_in_use"]),
                        "fallback_reason": info["fallback_reason"],
                        "fallback_since": info["fallback_since"],
                        "primary_source": info["primary_source"],
                        "active_source": info["active_source"],
                        "quality_flags": quality["quality_flags"],
                    }
                )
        except Exception:
            row["quality_flags"] = ["snapshot_error"]
        # Active-source collector health: match the entry for the source the
        # city is actually reading, so recovered old errors cannot pollute it.
        active = str(row.get("active_source") or row.get("source") or "").strip().lower()
        status_row = entries_by_city_source.get((city, active)) if active else None
        primary_last_success: Any = None
        primary_key = str(row.get("primary_source") or "").strip().lower()
        if primary_key:
            primary_entry = entries_by_city_source.get((city, primary_key))
            if isinstance(primary_entry, dict):
                primary_last_success = primary_entry.get("last_success_at") or primary_entry.get("last_success_ts")
        row["primary_last_success_at"] = primary_last_success
        if isinstance(status_row, dict):
            last_success = status_row.get("last_success_at") or status_row.get("last_success_ts")
            last_failure = status_row.get("last_failure_at") or status_row.get("last_failure_ts")
            failing_now = bool(
                last_failure
                and (not last_success or str(last_failure) >= str(last_success))
            )
            failing_count = int(status_row.get("failure_count") or 0) if failing_now else 0
            combined = combine_observation_with_source_health(
                quality={
                    "status": row["status"],
                    "quality_flags": row["quality_flags"],
                    "freshness_status": row.get("freshness_status") or "",
                },
                failing_now=failing_now,
                last_error=status_row.get("last_error"),
                consecutive_failures=failing_count,
            )
            row["status"] = combined["status"]
            row["quality_flags"] = combined["quality_flags"]
            row["consecutive_failures"] = failing_count
            row["request_latency_ms"] = status_row.get("last_latency_ms")
            row["last_error"] = combined.get("last_error") or status_row.get("last_error")
            row["last_success_at"] = last_success
            row["last_error_at"] = last_failure
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
