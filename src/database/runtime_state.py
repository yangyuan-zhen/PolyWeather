
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
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
            conn.commit()


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
