"""Observation repository."""

from __future__ import annotations

import json
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional


class ObservationRepo:
    """Repository for observation data."""

    def __init__(self, get_connection):
        self._get_connection = get_connection

    @staticmethod
    def _float_or_none(value: Any) -> Optional[float]:
        try:
            if value is None or value == "":
                return None
            return float(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _int_or_none(value: Any) -> Optional[int]:
        try:
            if value is None or value == "":
                return None
            return int(float(value))
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _parse_datetime_or_none(value: Any) -> Optional[datetime]:
        raw = str(value or "").strip()
        if not raw:
            return None
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    @classmethod
    def _source_latency_or_none(cls, observed_at: Any, fetched_at: Any) -> Optional[float]:
        observed = cls._parse_datetime_or_none(observed_at)
        fetched = cls._parse_datetime_or_none(fetched_at)
        if observed is None or fetched is None:
            return None
        return max(0.0, round((fetched - observed).total_seconds(), 3))

    def get_canonical_temperature(self, city: str) -> Optional[Dict[str, Any]]:
        normalized_city = str(city or "").strip().lower()
        if not normalized_city:
            return None
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT city, payload_json, value, source, source_role, observed_at,
                       fetched_at, freshness_sec, freshness_status, confidence,
                       explanation, updated_at, updated_at_ts
                FROM canonical_temperature_latest
                WHERE city = ?
                LIMIT 1
                """,
                (normalized_city,),
            ).fetchone()
        if not row:
            return None
        try:
            payload = json.loads(str(row["payload_json"] or "{}"))
        except Exception:
            return None
        if not isinstance(payload, dict):
            return None
        return {
            "city": str(row["city"] or normalized_city),
            "payload": payload,
            "value": self._float_or_none(row["value"]),
            "source": str(row["source"] or ""),
            "source_role": str(row["source_role"] or ""),
            "observed_at": str(row["observed_at"] or ""),
            "fetched_at": str(row["fetched_at"] or ""),
            "freshness_sec": self._int_or_none(row["freshness_sec"]),
            "freshness_status": str(row["freshness_status"] or ""),
            "confidence": self._float_or_none(row["confidence"]),
            "explanation": str(row["explanation"] or ""),
            "updated_at": str(row["updated_at"] or ""),
            "updated_at_ts": float(row["updated_at_ts"] or 0.0),
        }

    def set_canonical_temperature(self, city: str, payload: Dict[str, Any]) -> None:
        normalized_city = str(city or "").strip().lower()
        if not normalized_city or not isinstance(payload, dict):
            return
        value = self._float_or_none(payload.get("value"))
        source = str(payload.get("source") or "").strip().lower()
        source_role = str(payload.get("source_role") or "").strip().lower()
        observed_at = str(payload.get("observed_at") or "").strip()
        fetched_at = str(payload.get("fetched_at") or "").strip()
        freshness_sec = self._int_or_none(payload.get("freshness_sec"))
        freshness_status = str(payload.get("freshness_status") or "").strip().lower()
        confidence = self._float_or_none(payload.get("confidence"))
        explanation = str(payload.get("explanation") or "").strip()
        now_dt = datetime.now()
        now = now_dt.isoformat()
        now_ts = now_dt.timestamp()
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO canonical_temperature_latest (
                    city, payload_json, value, source, source_role, observed_at,
                    fetched_at, freshness_sec, freshness_status, confidence,
                    explanation, updated_at, updated_at_ts
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(city) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    value = excluded.value,
                    source = excluded.source,
                    source_role = excluded.source_role,
                    observed_at = excluded.observed_at,
                    fetched_at = excluded.fetched_at,
                    freshness_sec = excluded.freshness_sec,
                    freshness_status = excluded.freshness_status,
                    confidence = excluded.confidence,
                    explanation = excluded.explanation,
                    updated_at = excluded.updated_at,
                    updated_at_ts = excluded.updated_at_ts
                """,
                (
                    normalized_city,
                    json.dumps({**payload, "city": normalized_city}, ensure_ascii=False),
                    value,
                    source,
                    source_role,
                    observed_at,
                    fetched_at,
                    freshness_sec,
                    freshness_status,
                    confidence,
                    explanation,
                    now,
                    now_ts,
                ),
            )
            conn.commit()

    def append_raw_observation(
        self,
        *,
        source: str,
        city: str,
        value: Any = None,
        observed_at: str = "",
        fetched_at: str = "",
        station_code: str = "",
        station_name: str = "",
        runway: str = "",
        value_unit: str = "",
        source_latency_sec: Any = None,
        status: str = "ok",
        error_count: int = 0,
        last_success_at: str = "",
        payload: Optional[Dict[str, Any]] = None,
    ) -> None:
        normalized_source = str(source or "").strip().lower()
        normalized_city = str(city or "").strip().lower()
        if not normalized_source or not normalized_city:
            return
        safe_station_code = str(station_code or "").strip().upper()
        safe_station_name = str(station_name or "").strip()
        safe_runway = str(runway or "").strip().upper()
        safe_observed_at = str(observed_at or "").strip()
        now_dt = datetime.now()
        safe_fetched_at = str(fetched_at or now_dt.isoformat()).strip()
        safe_status = str(status or "ok").strip().lower() or "ok"
        value_float = self._float_or_none(value)
        latency_float = self._float_or_none(source_latency_sec)
        if latency_float is None:
            latency_float = self._source_latency_or_none(safe_observed_at, safe_fetched_at)
        payload_json = json.dumps(payload or {}, ensure_ascii=False)
        created_at_ts = now_dt.timestamp()
        with self._get_connection() as conn:
            previous_latest = conn.execute(
                """
                SELECT status, error_count, last_success_at, fetched_at
                FROM raw_observation_latest
                WHERE source = ? AND city = ?
                ORDER BY updated_at_ts DESC
                LIMIT 1
                """,
                (normalized_source, normalized_city),
            ).fetchone()
            previous_error_count = int(previous_latest[1] or 0) if previous_latest else 0
            previous_last_success = str(previous_latest[2] or "").strip() if previous_latest else ""
            previous_status = str(previous_latest[0] or "").strip().lower() if previous_latest else ""
            previous_fetched_at = str(previous_latest[3] or "").strip() if previous_latest else ""
            if safe_status == "ok":
                safe_error_count = 0
                success_at = str(last_success_at or safe_fetched_at).strip()
            else:
                safe_error_count = max(1, int(error_count or 0), previous_error_count + 1)
                success_at = str(
                    last_success_at
                    or previous_last_success
                    or (previous_fetched_at if previous_status == "ok" else "")
                ).strip()
            conn.execute(
                """
                INSERT INTO raw_observation_store (
                    source, city, station_code, station_name, runway, value,
                    value_unit, observed_at, fetched_at, source_latency_sec,
                    status, error_count, last_success_at, payload_json, created_at_ts
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    normalized_source,
                    normalized_city,
                    safe_station_code,
                    safe_station_name,
                    safe_runway,
                    value_float,
                    str(value_unit or "").strip(),
                    safe_observed_at,
                    safe_fetched_at,
                    latency_float,
                    safe_status,
                    safe_error_count,
                    success_at,
                    payload_json,
                    created_at_ts,
                ),
            )
            conn.execute(
                """
                INSERT INTO raw_observation_latest (
                    source, city, station_code, station_name, runway, value,
                    value_unit, observed_at, fetched_at, source_latency_sec,
                    status, error_count, last_success_at, payload_json, updated_at_ts
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source, city, station_code, runway) DO UPDATE SET
                    station_name = excluded.station_name,
                    value = excluded.value,
                    value_unit = excluded.value_unit,
                    observed_at = excluded.observed_at,
                    fetched_at = excluded.fetched_at,
                    source_latency_sec = excluded.source_latency_sec,
                    status = excluded.status,
                    error_count = excluded.error_count,
                    last_success_at = excluded.last_success_at,
                    payload_json = excluded.payload_json,
                    updated_at_ts = excluded.updated_at_ts
                """,
                (
                    normalized_source,
                    normalized_city,
                    safe_station_code,
                    safe_station_name,
                    safe_runway,
                    value_float,
                    str(value_unit or "").strip(),
                    safe_observed_at,
                    safe_fetched_at,
                    latency_float,
                    safe_status,
                    safe_error_count,
                    success_at,
                    payload_json,
                    created_at_ts,
                ),
            )
            conn.commit()

    def get_latest_raw_observation(
        self,
        source: str,
        city: str,
        *,
        station_code: str = "",
        runway: str = "",
    ) -> Optional[Dict[str, Any]]:
        normalized_source = str(source or "").strip().lower()
        normalized_city = str(city or "").strip().lower()
        if not normalized_source or not normalized_city:
            return None
        filters = ["source = ?", "city = ?"]
        params: List[Any] = [normalized_source, normalized_city]
        if station_code:
            filters.append("station_code = ?")
            params.append(str(station_code or "").strip().upper())
        if runway:
            filters.append("runway = ?")
            params.append(str(runway or "").strip().upper())
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                f"""
                SELECT *
                FROM raw_observation_latest
                WHERE {' AND '.join(filters)}
                ORDER BY updated_at_ts DESC
                LIMIT 1
                """,
                params,
            ).fetchone()
        if not row:
            return None
        try:
            payload = json.loads(str(row["payload_json"] or "{}"))
        except Exception:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        return {
            "source": str(row["source"] or ""),
            "city": str(row["city"] or ""),
            "station_code": str(row["station_code"] or ""),
            "station_name": str(row["station_name"] or ""),
            "runway": str(row["runway"] or ""),
            "value": self._float_or_none(row["value"]),
            "value_unit": str(row["value_unit"] or ""),
            "observed_at": str(row["observed_at"] or ""),
            "fetched_at": str(row["fetched_at"] or ""),
            "source_latency_sec": self._float_or_none(row["source_latency_sec"]),
            "status": str(row["status"] or ""),
            "error_count": int(row["error_count"] or 0),
            "last_success_at": str(row["last_success_at"] or ""),
            "payload": payload,
            "updated_at_ts": float(row["updated_at_ts"] or 0.0),
        }

    def list_latest_raw_observations_for_city(self, city: str, *, limit: int = 100) -> List[Dict[str, Any]]:
        normalized_city = str(city or "").strip().lower()
        if not normalized_city:
            return []
        safe_limit = max(1, min(int(limit or 100), 500))
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT *
                FROM raw_observation_latest
                WHERE city = ?
                ORDER BY updated_at_ts DESC
                LIMIT ?
                """,
                (normalized_city, safe_limit),
            ).fetchall()
        out: List[Dict[str, Any]] = []
        for row in rows:
            try:
                payload = json.loads(str(row["payload_json"] or "{}"))
            except Exception:
                payload = {}
            if not isinstance(payload, dict):
                payload = {}
            out.append(
                {
                    "source": str(row["source"] or ""),
                    "city": str(row["city"] or ""),
                    "station_code": str(row["station_code"] or ""),
                    "station_name": str(row["station_name"] or ""),
                    "runway": str(row["runway"] or ""),
                    "value": self._float_or_none(row["value"]),
                    "value_unit": str(row["value_unit"] or ""),
                    "observed_at": str(row["observed_at"] or ""),
                    "fetched_at": str(row["fetched_at"] or ""),
                    "source_latency_sec": self._float_or_none(row["source_latency_sec"]),
                    "status": str(row["status"] or ""),
                    "error_count": int(row["error_count"] or 0),
                    "last_success_at": str(row["last_success_at"] or ""),
                    "payload": payload,
                    "updated_at_ts": float(row["updated_at_ts"] or 0.0),
                }
            )
        return out

    def list_raw_observation_history(
        self,
        source: str,
        city: str,
        *,
        minutes: int = 60,
        limit: int = 1000,
    ) -> List[Dict[str, Any]]:
        normalized_source = str(source or "").strip().lower()
        normalized_city = str(city or "").strip().lower()
        if not normalized_source or not normalized_city:
            return []
        safe_limit = max(1, min(int(limit or 1000), 5000))
        safe_minutes = max(1, min(int(minutes or 60), 7 * 24 * 60))
        cutoff_dt = datetime.now(timezone.utc) - timedelta(minutes=safe_minutes)
        cutoff_observed_at = cutoff_dt.replace(microsecond=0).isoformat()
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT *
                FROM (
                    SELECT *
                    FROM raw_observation_store
                    WHERE source = ?
                      AND city = ?
                      AND observed_at >= ?
                    ORDER BY observed_at DESC, fetched_at DESC, created_at_ts DESC
                    LIMIT ?
                )
                ORDER BY observed_at ASC, fetched_at ASC, created_at_ts ASC
                """,
                (normalized_source, normalized_city, cutoff_observed_at, safe_limit),
            ).fetchall()
        out: List[Dict[str, Any]] = []
        for row in rows:
            try:
                payload = json.loads(str(row["payload_json"] or "{}"))
            except Exception:
                payload = {}
            if not isinstance(payload, dict):
                payload = {}
            out.append(
                {
                    "source": str(row["source"] or ""),
                    "city": str(row["city"] or ""),
                    "station_code": str(row["station_code"] or ""),
                    "station_name": str(row["station_name"] or ""),
                    "runway": str(row["runway"] or ""),
                    "value": self._float_or_none(row["value"]),
                    "value_unit": str(row["value_unit"] or ""),
                    "observed_at": str(row["observed_at"] or ""),
                    "fetched_at": str(row["fetched_at"] or ""),
                    "source_latency_sec": self._float_or_none(row["source_latency_sec"]),
                    "status": str(row["status"] or ""),
                    "error_count": int(row["error_count"] or 0),
                    "last_success_at": str(row["last_success_at"] or ""),
                    "payload": payload,
                    "created_at_ts": float(row["created_at_ts"] or 0.0),
                }
            )
        return out

    def enqueue_observation_refresh_request(
        self,
        *,
        city: str,
        kind: str = "",
        source: str = "",
        priority: str = "normal",
        reason: str = "",
    ) -> bool:
        normalized_city = str(city or "").strip().lower()
        normalized_kind = str(kind or "").strip().lower()
        normalized_source = str(source or "").strip().lower()
        normalized_priority = str(priority or "normal").strip().lower()
        if normalized_priority not in {"high", "normal", "low"}:
            normalized_priority = "normal"
        if not normalized_city:
            return False
        priority_rank = {"low": 0, "normal": 1, "high": 2}
        now_dt = datetime.now()
        now = now_dt.isoformat()
        now_ts = now_dt.timestamp()
        with self._get_connection() as conn:
            existing = conn.execute(
                """
                SELECT id, priority
                FROM observation_refresh_requests
                WHERE city = ? AND source = ? AND status IN ('pending', 'claimed')
                ORDER BY requested_at_ts DESC
                LIMIT 1
                """,
                (normalized_city, normalized_source),
            ).fetchone()
            if existing:
                existing_priority = str(existing[1] or "normal").strip().lower()
                if priority_rank.get(existing_priority, 1) > priority_rank[normalized_priority]:
                    normalized_priority = existing_priority
                conn.execute(
                    """
                    UPDATE observation_refresh_requests
                    SET kind = ?, priority = ?, reason = ?, requested_at = ?, requested_at_ts = ?
                    WHERE id = ?
                    """,
                    (
                        normalized_kind,
                        normalized_priority,
                        str(reason or "").strip(),
                        now,
                        now_ts,
                        int(existing[0]),
                    ),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO observation_refresh_requests (
                        city, kind, source, priority, reason, status,
                        requested_at, requested_at_ts
                    )
                    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
                    """,
                    (
                        normalized_city,
                        normalized_kind,
                        normalized_source,
                        normalized_priority,
                        str(reason or "").strip(),
                        now,
                        now_ts,
                    ),
                )
            conn.commit()
        return True

    def claim_observation_refresh_requests(
        self,
        *,
        limit: int = 20,
        owner: str = "",
        now_ts: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        safe_limit = max(1, min(int(limit or 20), 200))
        safe_owner = str(owner or "").strip() or secrets.token_hex(6)
        claim_ts = float(now_ts if now_ts is not None else datetime.now().timestamp())
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT *
                FROM observation_refresh_requests
                WHERE status = 'pending'
                ORDER BY
                    CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                    requested_at_ts ASC
                LIMIT ?
                """,
                (safe_limit,),
            ).fetchall()
            ids = [int(row["id"]) for row in rows]
            if ids:
                placeholders = ",".join("?" for _ in ids)
                conn.execute(
                    f"""
                    UPDATE observation_refresh_requests
                    SET status = 'claimed',
                        owner = ?,
                        attempts = attempts + 1,
                        claimed_at_ts = ?
                    WHERE id IN ({placeholders})
                    """,
                    [safe_owner, claim_ts, *ids],
                )
                conn.commit()
        return [
            {
                "id": int(row["id"]),
                "city": str(row["city"] or ""),
                "kind": str(row["kind"] or ""),
                "source": str(row["source"] or ""),
                "priority": str(row["priority"] or ""),
                "reason": str(row["reason"] or ""),
                "status": "claimed",
                "attempts": int(row["attempts"] or 0) + 1,
                "owner": safe_owner,
                "requested_at": str(row["requested_at"] or ""),
                "requested_at_ts": float(row["requested_at_ts"] or 0.0),
                "claimed_at_ts": claim_ts,
                "last_error": str(row["last_error"] or ""),
            }
            for row in rows
        ]

    def mark_observation_refresh_request_done(
        self,
        request_id: int,
        *,
        status: str = "done",
        error: str = "",
    ) -> None:
        safe_status = str(status or "done").strip().lower()
        if safe_status not in {"done", "failed"}:
            safe_status = "done"
        with self._get_connection() as conn:
            conn.execute(
                """
                UPDATE observation_refresh_requests
                SET status = ?,
                    completed_at_ts = ?,
                    last_error = ?
                WHERE id = ?
                """,
                (
                    safe_status,
                    datetime.now().timestamp(),
                    str(error or "").strip(),
                    int(request_id),
                ),
            )
            conn.commit()
