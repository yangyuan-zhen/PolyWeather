
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from loguru import logger

from src.database.db_manager import DBManager

STATE_STORAGE_FILE = "file"
STATE_STORAGE_DUAL = "dual"
STATE_STORAGE_SQLITE = "sqlite"
DEFAULT_STATE_STORAGE_MODE = STATE_STORAGE_SQLITE
VALID_STATE_STORAGE_MODES = {
    STATE_STORAGE_FILE,
    STATE_STORAGE_SQLITE,
}

_LOGGED_MODES: set[str] = set()


def get_state_storage_mode() -> str:
    raw = str(os.getenv("POLYWEATHER_STATE_STORAGE_MODE") or DEFAULT_STATE_STORAGE_MODE).strip().lower()
    if raw == STATE_STORAGE_DUAL:
        logger.warning(
            f"POLYWEATHER_STATE_STORAGE_MODE={STATE_STORAGE_DUAL!r} is deprecated, normalize to {STATE_STORAGE_SQLITE}"
        )
        raw = STATE_STORAGE_SQLITE
    if raw not in VALID_STATE_STORAGE_MODES:
        logger.warning(
            f"invalid POLYWEATHER_STATE_STORAGE_MODE={raw!r}, fallback to {DEFAULT_STATE_STORAGE_MODE}"
        )
        raw = DEFAULT_STATE_STORAGE_MODE
    if raw not in _LOGGED_MODES:
        logger.info(f"runtime state storage mode={raw}")
        _LOGGED_MODES.add(raw)
    return raw


class RuntimeStateDB:
    _instance: Optional["RuntimeStateDB"] = None
    _instance_lock = threading.Lock()

    def __init__(self, db_path: Optional[str] = None):
        self.db_path = DBManager(db_path).db_path
        self._init_tables()

    @classmethod
    def instance(cls) -> "RuntimeStateDB":
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_tables(self) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS daily_records_store (
                    city TEXT NOT NULL,
                    target_date TEXT NOT NULL,
                    actual_high REAL,
                    deb_prediction REAL,
                    mu REAL,
                    updated_at REAL NOT NULL,
                    payload_json TEXT NOT NULL,
                    PRIMARY KEY (city, target_date)
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS truth_records_store (
                    city TEXT NOT NULL,
                    target_date TEXT NOT NULL,
                    actual_high REAL NOT NULL,
                    settlement_source TEXT,
                    settlement_station_code TEXT,
                    settlement_station_label TEXT,
                    truth_version TEXT,
                    updated_by TEXT,
                    updated_at REAL NOT NULL,
                    source_payload_json TEXT,
                    is_final INTEGER NOT NULL DEFAULT 1,
                    PRIMARY KEY (city, target_date)
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS truth_revisions_store (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    city TEXT NOT NULL,
                    target_date TEXT NOT NULL,
                    previous_actual_high REAL,
                    next_actual_high REAL NOT NULL,
                    previous_source TEXT,
                    next_source TEXT,
                    truth_version TEXT,
                    updated_by TEXT,
                    updated_at REAL NOT NULL,
                    reason TEXT,
                    payload_json TEXT
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_truth_records_city_date ON truth_records_store(city, target_date)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_truth_revisions_city_date ON truth_revisions_store(city, target_date, id DESC)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS telegram_alert_last_by_city (
                    city TEXT PRIMARY KEY,
                    signature TEXT,
                    trigger_key TEXT,
                    severity TEXT,
                    ts INTEGER,
                    active INTEGER DEFAULT 0,
                    cleared_ts INTEGER,
                    evidence_json TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS telegram_alert_signature_state (
                    signature TEXT PRIMARY KEY,
                    ts INTEGER NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS probability_training_snapshots_store (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    city TEXT NOT NULL,
                    target_date TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    raw_mu REAL,
                    raw_sigma REAL,
                    max_so_far REAL,
                    peak_status TEXT,
                    probability_mode TEXT,
                    legacy_top_bucket INTEGER,
                    shadow_top_bucket INTEGER,
                    payload_json TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_probability_snapshot_city_date ON probability_training_snapshots_store(city, target_date, id DESC)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS training_feature_records_store (
                    city TEXT NOT NULL,
                    target_date TEXT NOT NULL,
                    updated_at REAL NOT NULL,
                    payload_json TEXT NOT NULL,
                    PRIMARY KEY (city, target_date)
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_training_feature_records_city_date ON training_feature_records_store(city, target_date)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS open_meteo_cache_store (
                    source_kind TEXT NOT NULL,
                    cache_key TEXT NOT NULL,
                    updated_at REAL NOT NULL,
                    expires_at REAL,
                    payload_json TEXT NOT NULL,
                    PRIMARY KEY (source_kind, cache_key)
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_open_meteo_cache_expires ON open_meteo_cache_store(source_kind, expires_at)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS open_meteo_rate_limit_state (
                    state_key TEXT PRIMARY KEY,
                    rate_limit_until REAL NOT NULL,
                    reason TEXT,
                    updated_at REAL NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS official_intraday_observations_store (
                    source_code TEXT NOT NULL,
                    station_code TEXT NOT NULL,
                    target_date TEXT NOT NULL,
                    observation_time TEXT NOT NULL,
                    value REAL NOT NULL,
                    payload_json TEXT,
                    PRIMARY KEY (source_code, station_code, observation_time)
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_official_intraday_obs_station_date ON official_intraday_observations_store(source_code, station_code, target_date, observation_time)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS intraday_path_snapshots_store (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    city TEXT NOT NULL,
                    target_date TEXT NOT NULL,
                    snapshot_time TEXT NOT NULL,
                    local_time TEXT,
                    deb_prediction REAL,
                    forecast_today_high REAL,
                    current_temp REAL,
                    max_so_far REAL,
                    observation_count INTEGER NOT NULL DEFAULT 0,
                    payload_json TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_intraday_path_snapshots_city_date ON intraday_path_snapshots_store(city, target_date, id DESC)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS observation_collector_status_store (
                    source TEXT NOT NULL,
                    city TEXT NOT NULL,
                    interval_sec INTEGER NOT NULL,
                    last_due_ts REAL,
                    last_started_ts REAL,
                    last_success_ts REAL,
                    last_failure_ts REAL,
                    last_latency_ms REAL,
                    failure_count INTEGER NOT NULL DEFAULT 0,
                    last_error TEXT,
                    updated_at REAL NOT NULL,
                    payload_json TEXT NOT NULL,
                    PRIMARY KEY (source, city)
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_observation_collector_status_source ON observation_collector_status_store(source, updated_at DESC)"
            )
            conn.commit()


def _ts_to_utc_iso(value: Any) -> Optional[str]:
    try:
        ts = float(value)
    except (TypeError, ValueError):
        return None
    if ts <= 0:
        return None
    return datetime.fromtimestamp(ts, timezone.utc).isoformat().replace("+00:00", "Z")


class ObservationCollectorStatusRepository:
    def __init__(self, db: Optional[RuntimeStateDB] = None):
        self.db = db or RuntimeStateDB.instance()

    def record_result(
        self,
        *,
        source: str,
        city: str,
        interval_sec: int,
        due_ts: float,
        started_ts: float,
        completed_ts: float,
        ok: bool,
        error: Optional[str] = None,
    ) -> None:
        source_key = str(source or "").strip().lower()
        city_key = str(city or "").strip().lower()
        if not source_key or not city_key:
            return
        safe_interval = max(1, int(interval_sec or 60))
        due = float(due_ts or completed_ts)
        started = float(started_ts or due)
        completed = float(completed_ts or time.time())
        latency_ms = round(max(0.0, completed - started) * 1000.0, 1)
        error_text = None if ok else str(error or "no_results").strip()[:500]
        payload = {
            "source": source_key,
            "city": city_key,
            "ok": bool(ok),
            "error": error_text,
            "interval_sec": safe_interval,
            "due_ts": due,
            "started_ts": started,
            "completed_ts": completed,
        }
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO observation_collector_status_store (
                    source, city, interval_sec, last_due_ts, last_started_ts,
                    last_success_ts, last_failure_ts, last_latency_ms,
                    failure_count, last_error, updated_at, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source, city) DO UPDATE SET
                    interval_sec = excluded.interval_sec,
                    last_due_ts = excluded.last_due_ts,
                    last_started_ts = excluded.last_started_ts,
                    last_success_ts = COALESCE(excluded.last_success_ts, observation_collector_status_store.last_success_ts),
                    last_failure_ts = COALESCE(excluded.last_failure_ts, observation_collector_status_store.last_failure_ts),
                    last_latency_ms = excluded.last_latency_ms,
                    failure_count = CASE
                        WHEN excluded.last_failure_ts IS NOT NULL
                        THEN observation_collector_status_store.failure_count + 1
                        ELSE observation_collector_status_store.failure_count
                    END,
                    last_error = excluded.last_error,
                    updated_at = excluded.updated_at,
                    payload_json = excluded.payload_json
                """,
                (
                    source_key,
                    city_key,
                    safe_interval,
                    due,
                    started,
                    completed if ok else None,
                    completed if not ok else None,
                    latency_ms,
                    0 if ok else 1,
                    error_text,
                    completed,
                    json.dumps(payload, ensure_ascii=False),
                ),
            )
            conn.commit()

    def load_snapshot(self, *, now_ts: Optional[float] = None, limit: int = 500) -> Dict[str, Any]:
        now = float(time.time() if now_ts is None else now_ts)
        safe_limit = max(1, min(int(limit or 500), 1000))
        with self.db.connect() as conn:
            rows = conn.execute(
                """
                SELECT source, city, interval_sec, last_due_ts, last_started_ts,
                       last_success_ts, last_failure_ts, last_latency_ms,
                       failure_count, last_error, updated_at
                FROM observation_collector_status_store
                ORDER BY source ASC, city ASC
                """
            ).fetchall()

        entries: List[Dict[str, Any]] = []
        status_counts: Dict[str, int] = {}
        source_summary: Dict[str, Dict[str, Any]] = {}

        for row in rows:
            source = str(row["source"] or "")
            city = str(row["city"] or "")
            interval = max(1, int(row["interval_sec"] or 60))
            last_due_ts = _float_or_none(row["last_due_ts"])
            last_started_ts = _float_or_none(row["last_started_ts"])
            last_success_ts = _float_or_none(row["last_success_ts"])
            last_failure_ts = _float_or_none(row["last_failure_ts"])
            updated_at_ts = _float_or_none(row["updated_at"])
            next_due_ts = last_due_ts + interval if last_due_ts is not None else None
            due_in_sec = round(next_due_ts - now, 1) if next_due_ts is not None else None
            latest_failure = (
                last_failure_ts is not None
                and (last_success_ts is None or last_failure_ts >= last_success_ts)
            )
            in_cooldown = bool(latest_failure and next_due_ts is not None and next_due_ts > now)
            if last_started_ts is None:
                status = "never_run"
            elif latest_failure:
                status = "cooldown" if in_cooldown else "failed"
            elif next_due_ts is not None and next_due_ts <= now:
                status = "due"
            else:
                status = "ok"

            latency = _float_or_none(row["last_latency_ms"])
            failure_count = int(row["failure_count"] or 0)
            entry = {
                "source": source,
                "city": city,
                "interval_sec": interval,
                "last_due_ts": last_due_ts,
                "last_due_at": _ts_to_utc_iso(last_due_ts),
                "last_started_ts": last_started_ts,
                "last_started_at": _ts_to_utc_iso(last_started_ts),
                "last_success_ts": last_success_ts,
                "last_success_at": _ts_to_utc_iso(last_success_ts),
                "last_failure_ts": last_failure_ts,
                "last_failure_at": _ts_to_utc_iso(last_failure_ts),
                "last_latency_ms": latency,
                "failure_count": failure_count,
                "last_error": row["last_error"],
                "updated_at_ts": updated_at_ts,
                "updated_at": _ts_to_utc_iso(updated_at_ts),
                "next_due_ts": next_due_ts,
                "next_due_at": _ts_to_utc_iso(next_due_ts),
                "due_in_sec": due_in_sec,
                "age_sec": round(now - last_success_ts, 1) if last_success_ts is not None else None,
                "in_cooldown": in_cooldown,
                "cooldown_until_ts": next_due_ts if in_cooldown else None,
                "cooldown_until_at": _ts_to_utc_iso(next_due_ts) if in_cooldown else None,
                "status": status,
            }
            entries.append(entry)
            status_counts[status] = status_counts.get(status, 0) + 1

            summary = source_summary.setdefault(
                source,
                {
                    "source": source,
                    "city_count": 0,
                    "interval_sec": interval,
                    "min_interval_sec": interval,
                    "max_interval_sec": interval,
                    "failure_count": 0,
                    "cooldown_count": 0,
                    "status_counts": {},
                    "_latencies": [],
                    "_last_success_ts": None,
                    "_last_failure_ts": None,
                },
            )
            summary["city_count"] += 1
            summary["min_interval_sec"] = min(int(summary["min_interval_sec"]), interval)
            summary["max_interval_sec"] = max(int(summary["max_interval_sec"]), interval)
            summary["failure_count"] += failure_count
            if status == "cooldown":
                summary["cooldown_count"] += 1
            summary["status_counts"][status] = summary["status_counts"].get(status, 0) + 1
            if latency is not None:
                summary["_latencies"].append(latency)
            if last_success_ts is not None:
                current_success = summary["_last_success_ts"]
                summary["_last_success_ts"] = (
                    last_success_ts if current_success is None else max(current_success, last_success_ts)
                )
            if last_failure_ts is not None:
                current_failure = summary["_last_failure_ts"]
                summary["_last_failure_ts"] = (
                    last_failure_ts if current_failure is None else max(current_failure, last_failure_ts)
                )

        source_priority = {"failed": 5, "cooldown": 4, "never_run": 3, "due": 2, "ok": 1}
        sources: List[Dict[str, Any]] = []
        for summary in source_summary.values():
            latencies = summary.pop("_latencies")
            last_success_ts = summary.pop("_last_success_ts")
            last_failure_ts = summary.pop("_last_failure_ts")
            summary["avg_latency_ms"] = (
                round(sum(latencies) / len(latencies), 1) if latencies else None
            )
            summary["last_success_at"] = _ts_to_utc_iso(last_success_ts)
            summary["last_failure_at"] = _ts_to_utc_iso(last_failure_ts)
            summary["worst_status"] = max(
                summary["status_counts"],
                key=lambda key: source_priority.get(str(key), 0),
                default="unknown",
            )
            sources.append(summary)

        return {
            "checked_at": _ts_to_utc_iso(now),
            "entries": entries[:safe_limit],
            "sources": sorted(sources, key=lambda item: str(item.get("source") or "")),
            "status_counts": status_counts,
            "total_entries": len(entries),
        }


def _float_or_none(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


class DailyRecordRepository:
    def __init__(self, db: Optional[RuntimeStateDB] = None):
        self.db = db or RuntimeStateDB.instance()

    def load_all(self) -> Dict[str, Dict[str, Dict[str, Any]]]:
        out: Dict[str, Dict[str, Dict[str, Any]]] = {}
        with self.db.connect() as conn:
            rows = conn.execute(
                "SELECT city, target_date, payload_json FROM daily_records_store ORDER BY city, target_date"
            ).fetchall()
        for row in rows:
            try:
                payload = json.loads(row["payload_json"])
            except Exception:
                continue
            city = str(row["city"])
            date_str = str(row["target_date"])
            out.setdefault(city, {})[date_str] = payload
        return out

    def load_recent_settled_rows(
        self,
        before_date: str,
        per_city_limit: int,
    ) -> Dict[str, List[Dict[str, Any]]]:
        out: Dict[str, List[Dict[str, Any]]] = {}
        limit = max(int(per_city_limit or 0), 1)
        query = """
            SELECT city, target_date, actual_high, deb_prediction
            FROM (
                SELECT
                    city,
                    target_date,
                    actual_high,
                    deb_prediction,
                    ROW_NUMBER() OVER (
                        PARTITION BY city
                        ORDER BY target_date DESC
                    ) AS row_num
                FROM daily_records_store
                WHERE
                    target_date < ?
                    AND actual_high IS NOT NULL
                    AND deb_prediction IS NOT NULL
            )
            WHERE row_num <= ?
            ORDER BY city, target_date DESC
        """
        fallback_query = """
            SELECT city, target_date, actual_high, deb_prediction
            FROM daily_records_store
            WHERE
                target_date < ?
                AND actual_high IS NOT NULL
                AND deb_prediction IS NOT NULL
            ORDER BY city, target_date DESC
        """
        try:
            with self.db.connect() as conn:
                rows = conn.execute(query, (before_date, limit)).fetchall()
        except sqlite3.OperationalError:
            with self.db.connect() as conn:
                rows = conn.execute(fallback_query, (before_date,)).fetchall()

        counts: Dict[str, int] = {}
        for row in rows:
            city = str(row["city"] or "").strip().lower()
            if not city:
                continue
            current_count = counts.get(city, 0)
            if current_count >= limit:
                continue
            out.setdefault(city, []).append(
                {
                    "target_date": str(row["target_date"]),
                    "actual_high": row["actual_high"],
                    "deb_prediction": row["deb_prediction"],
                }
            )
            counts[city] = current_count + 1
        return out

    def upsert_record(self, city: str, target_date: str, record: Dict[str, Any]) -> None:
        payload_json = json.dumps(record, ensure_ascii=False)
        updated_at = time.time()
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO daily_records_store (
                    city, target_date, actual_high, deb_prediction, mu, updated_at, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(city, target_date) DO UPDATE SET
                    actual_high = excluded.actual_high,
                    deb_prediction = excluded.deb_prediction,
                    mu = excluded.mu,
                    updated_at = excluded.updated_at,
                    payload_json = excluded.payload_json
                """,
                (
                    city,
                    target_date,
                    record.get("actual_high"),
                    record.get("deb_prediction"),
                    record.get("mu"),
                    updated_at,
                    payload_json,
                ),
            )
            conn.commit()

    def replace_all(self, data: Dict[str, Dict[str, Dict[str, Any]]]) -> int:
        count = 0
        with self.db.connect() as conn:
            conn.execute("DELETE FROM daily_records_store")
            for city, city_rows in (data or {}).items():
                if not isinstance(city_rows, dict):
                    continue
                for target_date, record in city_rows.items():
                    payload_json = json.dumps(record, ensure_ascii=False)
                    conn.execute(
                        """
                        INSERT INTO daily_records_store (
                            city, target_date, actual_high, deb_prediction, mu, updated_at, payload_json
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            city,
                            target_date,
                            record.get("actual_high"),
                            record.get("deb_prediction"),
                            record.get("mu"),
                            time.time(),
                            payload_json,
                        ),
                    )
                    count += 1
            conn.commit()
        return count

    def delete_older_than(self, cutoff_date: str) -> int:
        with self.db.connect() as conn:
            cur = conn.execute(
                "DELETE FROM daily_records_store WHERE target_date < ?",
                (cutoff_date,),
            )
            conn.commit()
            return int(cur.rowcount or 0)


class TruthRecordRepository:
    def __init__(self, db: Optional[RuntimeStateDB] = None):
        self.db = db or RuntimeStateDB.instance()

    def load_all(self) -> Dict[str, Dict[str, Dict[str, Any]]]:
        out: Dict[str, Dict[str, Dict[str, Any]]] = {}
        with self.db.connect() as conn:
            rows = conn.execute(
                """
                SELECT city, target_date, actual_high, settlement_source, settlement_station_code,
                       settlement_station_label, truth_version, updated_by, updated_at,
                       source_payload_json, is_final
                FROM truth_records_store
                ORDER BY city, target_date
                """
            ).fetchall()
        for row in rows:
            payload: Dict[str, Any] = {
                "actual_high": float(row["actual_high"]),
                "settlement_source": row["settlement_source"],
                "settlement_station_code": row["settlement_station_code"],
                "settlement_station_label": row["settlement_station_label"],
                "truth_version": row["truth_version"],
                "updated_by": row["updated_by"],
                "truth_updated_at": float(row["updated_at"]),
                "is_final": bool(row["is_final"]),
            }
            if row["source_payload_json"]:
                try:
                    payload["source_payload"] = json.loads(row["source_payload_json"])
                except Exception:
                    pass
            out.setdefault(str(row["city"]), {})[str(row["target_date"])] = payload
        return out

    def get_record(self, city: str, target_date: str) -> Optional[Dict[str, Any]]:
        with self.db.connect() as conn:
            row = conn.execute(
                """
                SELECT actual_high, settlement_source, settlement_station_code,
                       settlement_station_label, truth_version, updated_by, updated_at,
                       source_payload_json, is_final
                FROM truth_records_store
                WHERE city = ? AND target_date = ?
                """,
                (city, target_date),
            ).fetchone()
        if not row:
            return None
        payload: Dict[str, Any] = {
            "actual_high": float(row["actual_high"]),
            "settlement_source": row["settlement_source"],
            "settlement_station_code": row["settlement_station_code"],
            "settlement_station_label": row["settlement_station_label"],
            "truth_version": row["truth_version"],
            "updated_by": row["updated_by"],
            "truth_updated_at": float(row["updated_at"]),
            "is_final": bool(row["is_final"]),
        }
        if row["source_payload_json"]:
            try:
                payload["source_payload"] = json.loads(row["source_payload_json"])
            except Exception:
                pass
        return payload

    def load_city(self, city: str) -> Dict[str, Dict[str, Any]]:
        out: Dict[str, Dict[str, Any]] = {}
        with self.db.connect() as conn:
            rows = conn.execute(
                """
                SELECT target_date, actual_high, settlement_source, settlement_station_code,
                       settlement_station_label, truth_version, updated_by, updated_at,
                       source_payload_json, is_final
                FROM truth_records_store
                WHERE city = ?
                ORDER BY target_date
                """,
                (city,),
            ).fetchall()
        for row in rows:
            payload: Dict[str, Any] = {
                "actual_high": float(row["actual_high"]),
                "settlement_source": row["settlement_source"],
                "settlement_station_code": row["settlement_station_code"],
                "settlement_station_label": row["settlement_station_label"],
                "truth_version": row["truth_version"],
                "updated_by": row["updated_by"],
                "truth_updated_at": float(row["updated_at"]),
                "is_final": bool(row["is_final"]),
            }
            if row["source_payload_json"]:
                try:
                    payload["source_payload"] = json.loads(row["source_payload_json"])
                except Exception:
                    pass
            out[str(row["target_date"])] = payload
        return out

    def upsert_truth(
        self,
        *,
        city: str,
        target_date: str,
        actual_high: float,
        settlement_source: Optional[str],
        settlement_station_code: Optional[str],
        settlement_station_label: Optional[str],
        truth_version: str,
        updated_by: str,
        source_payload: Optional[Dict[str, Any]] = None,
        is_final: bool = True,
        reason: Optional[str] = None,
    ) -> bool:
        updated_at = time.time()
        payload_json = (
            json.dumps(source_payload, ensure_ascii=False) if source_payload is not None else None
        )
        with self.db.connect() as conn:
            current = conn.execute(
                """
                SELECT actual_high, settlement_source, source_payload_json
                FROM truth_records_store
                WHERE city = ? AND target_date = ?
                """,
                (city, target_date),
            ).fetchone()
            changed = True
            if current:
                prev_actual = float(current["actual_high"])
                prev_source = str(current["settlement_source"] or "")
                next_source = str(settlement_source or "")
                changed = (
                    abs(prev_actual - float(actual_high)) >= 0.0001
                    or prev_source != next_source
                    or str(current["source_payload_json"] or "") != str(payload_json or "")
                )
                if changed:
                    conn.execute(
                        """
                        INSERT INTO truth_revisions_store (
                            city, target_date, previous_actual_high, next_actual_high,
                            previous_source, next_source, truth_version, updated_by,
                            updated_at, reason, payload_json
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            city,
                            target_date,
                            prev_actual,
                            float(actual_high),
                            prev_source or None,
                            next_source or None,
                            truth_version,
                            updated_by,
                            updated_at,
                            reason,
                            payload_json,
                        ),
                    )
            conn.execute(
                """
                INSERT INTO truth_records_store (
                    city, target_date, actual_high, settlement_source,
                    settlement_station_code, settlement_station_label, truth_version,
                    updated_by, updated_at, source_payload_json, is_final
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(city, target_date) DO UPDATE SET
                    actual_high = excluded.actual_high,
                    settlement_source = excluded.settlement_source,
                    settlement_station_code = excluded.settlement_station_code,
                    settlement_station_label = excluded.settlement_station_label,
                    truth_version = excluded.truth_version,
                    updated_by = excluded.updated_by,
                    updated_at = excluded.updated_at,
                    source_payload_json = excluded.source_payload_json,
                    is_final = excluded.is_final
                """,
                (
                    city,
                    target_date,
                    float(actual_high),
                    settlement_source,
                    settlement_station_code,
                    settlement_station_label,
                    truth_version,
                    updated_by,
                    updated_at,
                    payload_json,
                    1 if is_final else 0,
                ),
            )
            conn.commit()
        return changed

    def replace_all(self, rows: Dict[str, Dict[str, Dict[str, Any]]]) -> int:
        count = 0
        with self.db.connect() as conn:
            conn.execute("DELETE FROM truth_records_store")
            conn.execute("DELETE FROM truth_revisions_store")
            for city, city_rows in (rows or {}).items():
                if not isinstance(city_rows, dict):
                    continue
                for target_date, record in city_rows.items():
                    if not isinstance(record, dict):
                        continue
                    actual_high = record.get("actual_high")
                    if actual_high is None:
                        continue
                    payload_json = (
                        json.dumps(record.get("source_payload"), ensure_ascii=False)
                        if record.get("source_payload") is not None
                        else None
                    )
                    conn.execute(
                        """
                        INSERT INTO truth_records_store (
                            city, target_date, actual_high, settlement_source,
                            settlement_station_code, settlement_station_label, truth_version,
                            updated_by, updated_at, source_payload_json, is_final
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            city,
                            target_date,
                            float(actual_high),
                            record.get("settlement_source"),
                            record.get("settlement_station_code"),
                            record.get("settlement_station_label"),
                            record.get("truth_version") or "v1",
                            record.get("updated_by") or "replace_all",
                            float(record.get("truth_updated_at") or time.time()),
                            payload_json,
                            1 if record.get("is_final", True) else 0,
                        ),
                    )
                    count += 1
            conn.commit()
        return count


class TruthRevisionRepository:
    def __init__(self, db: Optional[RuntimeStateDB] = None):
        self.db = db or RuntimeStateDB.instance()

    def load_revisions(self, city: str, target_date: str) -> List[Dict[str, Any]]:
        with self.db.connect() as conn:
            rows = conn.execute(
                """
                SELECT previous_actual_high, next_actual_high, previous_source, next_source,
                       truth_version, updated_by, updated_at, reason, payload_json
                FROM truth_revisions_store
                WHERE city = ? AND target_date = ?
                ORDER BY id ASC
                """,
                (city, target_date),
            ).fetchall()
        out: List[Dict[str, Any]] = []
        for row in rows:
            entry: Dict[str, Any] = {
                "previous_actual_high": row["previous_actual_high"],
                "next_actual_high": row["next_actual_high"],
                "previous_source": row["previous_source"],
                "next_source": row["next_source"],
                "truth_version": row["truth_version"],
                "updated_by": row["updated_by"],
                "updated_at": float(row["updated_at"]),
                "reason": row["reason"],
            }
            if row["payload_json"]:
                try:
                    entry["payload"] = json.loads(row["payload_json"])
                except Exception:
                    pass
            out.append(entry)
        return out


class TelegramAlertStateRepository:
    def __init__(self, db: Optional[RuntimeStateDB] = None):
        self.db = db or RuntimeStateDB.instance()

    def load_state(self) -> Dict[str, Any]:
        state = {"last_by_city": {}, "by_signature": {}}
        with self.db.connect() as conn:
            city_rows = conn.execute(
                "SELECT city, signature, trigger_key, severity, ts, active, cleared_ts, evidence_json FROM telegram_alert_last_by_city"
            ).fetchall()
            sig_rows = conn.execute(
                "SELECT signature, ts FROM telegram_alert_signature_state"
            ).fetchall()
        for row in city_rows:
            entry = {
                "signature": row["signature"],
                "trigger_key": row["trigger_key"],
                "severity": row["severity"],
                "ts": row["ts"],
                "active": bool(row["active"]),
            }
            if row["cleared_ts"] is not None:
                entry["cleared_ts"] = row["cleared_ts"]
            if row["evidence_json"]:
                try:
                    entry["evidence"] = json.loads(row["evidence_json"])
                except Exception:
                    pass
            state["last_by_city"][str(row["city"])] = entry
        for row in sig_rows:
            state["by_signature"][str(row["signature"])] = int(row["ts"] or 0)
        return state

    def save_state(self, state: Dict[str, Any]) -> None:
        last_by_city = state.get("last_by_city") or {}
        by_signature = state.get("by_signature") or {}
        with self.db.connect() as conn:
            conn.execute("DELETE FROM telegram_alert_last_by_city")
            conn.execute("DELETE FROM telegram_alert_signature_state")
            for city, row in last_by_city.items():
                if not isinstance(row, dict):
                    continue
                conn.execute(
                    """
                    INSERT INTO telegram_alert_last_by_city (
                        city, signature, trigger_key, severity, ts, active, cleared_ts, evidence_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        city,
                        row.get("signature"),
                        row.get("trigger_key"),
                        row.get("severity"),
                        int(row.get("ts") or 0),
                        1 if row.get("active") else 0,
                        row.get("cleared_ts"),
                        json.dumps(row.get("evidence"), ensure_ascii=False)
                        if row.get("evidence") is not None
                        else None,
                    ),
                )
            for signature, ts in by_signature.items():
                conn.execute(
                    "INSERT INTO telegram_alert_signature_state (signature, ts) VALUES (?, ?)",
                    (signature, int(ts or 0)),
                )
            conn.commit()

    def replace_from_state(self, state: Dict[str, Any]) -> int:
        self.save_state(state)
        return len((state.get("last_by_city") or {})) + len((state.get("by_signature") or {}))


class ProbabilitySnapshotRepository:
    def __init__(self, db: Optional[RuntimeStateDB] = None):
        self.db = db or RuntimeStateDB.instance()

    def append_snapshot(self, payload: Dict[str, Any]) -> None:
        legacy_top = _top_bucket(payload.get("prob_snapshot"))
        shadow_top = _top_bucket(payload.get("shadow_prob_snapshot"))
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO probability_training_snapshots_store (
                    city, target_date, timestamp, raw_mu, raw_sigma, max_so_far,
                    peak_status, probability_mode, legacy_top_bucket, shadow_top_bucket, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.get("city"),
                    payload.get("date"),
                    payload.get("timestamp"),
                    payload.get("raw_mu"),
                    payload.get("raw_sigma"),
                    payload.get("max_so_far"),
                    payload.get("peak_status"),
                    payload.get("probability_mode"),
                    legacy_top,
                    shadow_top,
                    json.dumps(payload, ensure_ascii=False),
                ),
            )
            conn.commit()

    def load_recent_rows(self, city: str, target_date: str, limit: int) -> List[Dict[str, Any]]:
        with self.db.connect() as conn:
            rows = conn.execute(
                """
                SELECT payload_json
                FROM probability_training_snapshots_store
                WHERE city = ? AND target_date = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (city, target_date, int(limit)),
            ).fetchall()
        out = []
        for row in rows:
            try:
                out.append(json.loads(row["payload_json"]))
            except Exception:
                continue
        return out

    def load_rows_by_city_date(self, city: str, target_date: str) -> List[Dict[str, Any]]:
        with self.db.connect() as conn:
            rows = conn.execute(
                """
                SELECT payload_json
                FROM probability_training_snapshots_store
                WHERE city = ? AND target_date = ?
                ORDER BY timestamp ASC, id ASC
                """,
                (city, target_date),
            ).fetchall()
        out = []
        for row in rows:
            try:
                out.append(json.loads(row["payload_json"]))
            except Exception:
                continue
        return out

    def load_all_rows(self) -> List[Dict[str, Any]]:
        with self.db.connect() as conn:
            rows = conn.execute(
                "SELECT payload_json FROM probability_training_snapshots_store ORDER BY id"
            ).fetchall()
        out = []
        for row in rows:
            try:
                out.append(json.loads(row["payload_json"]))
            except Exception:
                continue
        return out

    def replace_all(self, rows: List[Dict[str, Any]]) -> int:
        count = 0
        with self.db.connect() as conn:
            conn.execute("DELETE FROM probability_training_snapshots_store")
            for payload in rows or []:
                if not isinstance(payload, dict):
                    continue
                legacy_top = _top_bucket(payload.get("prob_snapshot"))
                shadow_top = _top_bucket(payload.get("shadow_prob_snapshot"))
                conn.execute(
                    """
                    INSERT INTO probability_training_snapshots_store (
                        city, target_date, timestamp, raw_mu, raw_sigma, max_so_far,
                        peak_status, probability_mode, legacy_top_bucket, shadow_top_bucket, payload_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        payload.get("city"),
                        payload.get("date"),
                        payload.get("timestamp"),
                        payload.get("raw_mu"),
                        payload.get("raw_sigma"),
                        payload.get("max_so_far"),
                        payload.get("peak_status"),
                        payload.get("probability_mode"),
                        legacy_top,
                        shadow_top,
                        json.dumps(payload, ensure_ascii=False),
                    ),
                )
                count += 1
            conn.commit()
        return count


class TrainingFeatureRecordRepository:
    def __init__(self, db: Optional[RuntimeStateDB] = None):
        self.db = db or RuntimeStateDB.instance()

    def upsert_record(self, city: str, target_date: str, payload: Dict[str, Any]) -> None:
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO training_feature_records_store (
                    city, target_date, updated_at, payload_json
                ) VALUES (?, ?, ?, ?)
                ON CONFLICT(city, target_date) DO UPDATE SET
                    updated_at = excluded.updated_at,
                    payload_json = excluded.payload_json
                """,
                (
                    city,
                    target_date,
                    time.time(),
                    json.dumps(payload, ensure_ascii=False),
                ),
            )
            conn.commit()

    def load_all(self) -> Dict[str, Dict[str, Dict[str, Any]]]:
        out: Dict[str, Dict[str, Dict[str, Any]]] = {}
        with self.db.connect() as conn:
            rows = conn.execute(
                """
                SELECT city, target_date, payload_json
                FROM training_feature_records_store
                ORDER BY city, target_date
                """
            ).fetchall()
        for row in rows:
            try:
                payload = json.loads(row["payload_json"])
            except Exception:
                continue
            out.setdefault(str(row["city"]), {})[str(row["target_date"])] = payload
        return out

    def get_record(self, city: str, target_date: str) -> Optional[Dict[str, Any]]:
        with self.db.connect() as conn:
            row = conn.execute(
                """
                SELECT payload_json
                FROM training_feature_records_store
                WHERE city = ? AND target_date = ?
                """,
                (city, target_date),
            ).fetchone()
        if not row:
            return None
        try:
            return json.loads(row["payload_json"])
        except Exception:
            return None

    def load_city(self, city: str) -> Dict[str, Dict[str, Any]]:
        out: Dict[str, Dict[str, Any]] = {}
        with self.db.connect() as conn:
            rows = conn.execute(
                """
                SELECT target_date, payload_json
                FROM training_feature_records_store
                WHERE city = ?
                ORDER BY target_date
                """,
                (city,),
            ).fetchall()
        for row in rows:
            try:
                out[str(row["target_date"])] = json.loads(row["payload_json"])
            except Exception:
                continue
        return out


class OpenMeteoCacheRepository:
    def __init__(self, db: Optional[RuntimeStateDB] = None):
        self.db = db or RuntimeStateDB.instance()

    def replace_payload(self, payload: Dict[str, Any], max_age: int) -> int:
        count = 0
        now = time.time()
        with self.db.connect() as conn:
            conn.execute("DELETE FROM open_meteo_cache_store")
            for source_kind in ("forecast", "ensemble", "multi_model"):
                bucket = payload.get(source_kind) or {}
                if not isinstance(bucket, dict):
                    continue
                for cache_key, entry in bucket.items():
                    if not isinstance(entry, dict):
                        continue
                    updated_at = float(entry.get("t") or now)
                    expires_at = updated_at + max_age
                    conn.execute(
                        """
                        INSERT INTO open_meteo_cache_store (
                            source_kind, cache_key, updated_at, expires_at, payload_json
                        ) VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            source_kind,
                            cache_key,
                            updated_at,
                            expires_at,
                            json.dumps(entry, ensure_ascii=False),
                        ),
                    )
                    count += 1
            conn.commit()
        return count

    def load_payload(self, max_age: int) -> Dict[str, Any]:
        now = time.time()
        payload: Dict[str, Any] = {
            "forecast": {},
            "ensemble": {},
            "multi_model": {},
            "saved_at": now,
        }
        with self.db.connect() as conn:
            rows = conn.execute(
                "SELECT source_kind, cache_key, updated_at, payload_json FROM open_meteo_cache_store"
            ).fetchall()
        for row in rows:
            updated_at = float(row["updated_at"] or 0)
            if now - updated_at >= max(600, max_age):
                continue
            try:
                entry = json.loads(row["payload_json"])
            except Exception:
                continue
            payload.setdefault(str(row["source_kind"]), {})[str(row["cache_key"])] = entry
        return payload

    def latest_updated_at(self) -> float:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT MAX(updated_at) AS max_updated_at FROM open_meteo_cache_store"
            ).fetchone()
        if not row:
            return 0.0
        try:
            return float(row["max_updated_at"] or 0.0)
        except Exception:
            return 0.0


class OpenMeteoRateLimitRepository:
    def __init__(self, db: Optional[RuntimeStateDB] = None):
        self.db = db or RuntimeStateDB.instance()

    def set_until(self, rate_limit_until: float, *, reason: str = "") -> None:
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO open_meteo_rate_limit_state (
                    state_key, rate_limit_until, reason, updated_at
                ) VALUES ('global', ?, ?, ?)
                ON CONFLICT(state_key) DO UPDATE SET
                    rate_limit_until = excluded.rate_limit_until,
                    reason = excluded.reason,
                    updated_at = excluded.updated_at
                """,
                (float(rate_limit_until), str(reason or ""), time.time()),
            )
            conn.commit()

    def load_until(self) -> float:
        with self.db.connect() as conn:
            row = conn.execute(
                """
                SELECT rate_limit_until
                FROM open_meteo_rate_limit_state
                WHERE state_key = 'global'
                """
            ).fetchone()
        if not row:
            return 0.0
        try:
            return float(row["rate_limit_until"] or 0.0)
        except Exception:
            return 0.0


class OfficialIntradayObservationRepository:
    def __init__(self, db: Optional[RuntimeStateDB] = None):
        self.db = db or RuntimeStateDB.instance()

    def upsert_point(
        self,
        *,
        source_code: str,
        station_code: str,
        target_date: str,
        observation_time: str,
        value: float,
        payload: Optional[Dict[str, Any]] = None,
    ) -> None:
        payload_json = json.dumps(payload, ensure_ascii=False) if payload is not None else None
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO official_intraday_observations_store (
                    source_code, station_code, target_date, observation_time, value, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(source_code, station_code, observation_time) DO UPDATE SET
                    target_date = excluded.target_date,
                    value = excluded.value,
                    payload_json = excluded.payload_json
                """,
                (
                    source_code,
                    station_code,
                    target_date,
                    observation_time,
                    float(value),
                    payload_json,
                ),
            )
            conn.commit()

    def load_points(
        self,
        *,
        source_code: str,
        station_code: str,
        target_date: str,
    ) -> List[Dict[str, Any]]:
        with self.db.connect() as conn:
            rows = conn.execute(
                """
                SELECT observation_time, value, payload_json
                FROM official_intraday_observations_store
                WHERE source_code = ? AND station_code = ? AND target_date = ?
                ORDER BY observation_time
                """,
                (source_code, station_code, target_date),
            ).fetchall()
        out: List[Dict[str, Any]] = []
        for row in rows:
            point = {
                "time": str(row["observation_time"] or "").strip(),
                "temp": float(row["value"]),
            }
            if row["payload_json"]:
                try:
                    payload = json.loads(row["payload_json"])
                except Exception:
                    payload = None
                if isinstance(payload, dict):
                    point.update(payload)
            if point["time"]:
                out.append(point)
        return out


class IntradayPathSnapshotRepository:
    def __init__(self, db: Optional[RuntimeStateDB] = None):
        self.db = db or RuntimeStateDB.instance()

    def append_snapshot(self, payload: Dict[str, Any]) -> None:
        observations = []
        for key in ("metar_today_obs", "settlement_today_obs"):
            rows = payload.get(key)
            if isinstance(rows, list):
                observations.extend(rows)
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO intraday_path_snapshots_store (
                    city, target_date, snapshot_time, local_time,
                    deb_prediction, forecast_today_high, current_temp,
                    max_so_far, observation_count, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.get("city"),
                    payload.get("target_date"),
                    payload.get("snapshot_time"),
                    payload.get("local_time"),
                    payload.get("deb_prediction"),
                    payload.get("forecast_today_high"),
                    payload.get("current_temp"),
                    payload.get("max_so_far"),
                    len(observations),
                    json.dumps(payload, ensure_ascii=False),
                ),
            )
            conn.commit()

    def load_rows_by_city_date(self, city: str, target_date: str) -> List[Dict[str, Any]]:
        with self.db.connect() as conn:
            rows = conn.execute(
                """
                SELECT payload_json
                FROM intraday_path_snapshots_store
                WHERE city = ? AND target_date = ?
                ORDER BY id ASC
                """,
                (city, target_date),
            ).fetchall()
        out: List[Dict[str, Any]] = []
        for row in rows:
            try:
                out.append(json.loads(row["payload_json"]))
            except Exception:
                continue
        return out

    def load_all_rows(self) -> List[Dict[str, Any]]:
        with self.db.connect() as conn:
            rows = conn.execute(
                "SELECT payload_json FROM intraday_path_snapshots_store ORDER BY id ASC"
            ).fetchall()
        out: List[Dict[str, Any]] = []
        for row in rows:
            try:
                out.append(json.loads(row["payload_json"]))
            except Exception:
                continue
        return out

    def load_recent_rows(self, limit: int = 20000) -> List[Dict[str, Any]]:
        safe_limit = max(1, int(limit or 1))
        with self.db.connect() as conn:
            rows = conn.execute(
                """
                SELECT payload_json
                FROM intraday_path_snapshots_store
                ORDER BY id DESC
                LIMIT ?
                """,
                (safe_limit,),
            ).fetchall()
        out: List[Dict[str, Any]] = []
        for row in reversed(rows):
            try:
                out.append(json.loads(row["payload_json"]))
            except Exception:
                continue
        return out

def _top_bucket(snapshot: Optional[List[Dict[str, Any]]]) -> Optional[int]:
    best_value = None
    best_prob = -1.0
    for row in snapshot or []:
        if not isinstance(row, dict):
            continue
        value = row.get("v")
        if value is None:
            value = row.get("value")
        try:
            ivalue = int(value)
        except Exception:
            continue
        prob = row.get("p")
        if prob is None:
            prob = row.get("probability")
        try:
            fprob = float(prob)
        except Exception:
            continue
        if fprob > best_prob:
            best_prob = fprob
            best_value = ivalue
    return best_value


def get_runtime_data_dir() -> str:
    raw = str(os.getenv("POLYWEATHER_RUNTIME_DATA_DIR") or "").strip()
    if raw:
        return raw
    project_root = Path(__file__).resolve().parents[2]
    return str(project_root / "data")
