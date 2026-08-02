import sqlite3
import os
import json
import threading
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List, Set, Tuple
from urllib.parse import urlparse

from loguru import logger

from src.database.sqlite_connection import connect_sqlite
from src.auth.supabase_admin_client import get_supabase_admin_client
from src.database.schema import init_db as _schema_init_db
from src.database.repos.user_repo import UserRepo
from src.database.repos.payment_repo import PaymentRepo
from src.database.repos.observation_repo import ObservationRepo
from src.database.repos.cache_repo import CacheRepo
from src.database.repos.binding_repo import BindingRepo
from src.database.repos.admin_repo import AdminRepo


class DBManager:
    _init_lock = threading.Lock()
    _initialized_paths: Set[str] = set()
    _points_sync_lock = threading.Lock()
    _points_sync_cache: Dict[str, Dict[str, Any]] = {}
    _profile_sync_lock = threading.Lock()
    _profile_sync_cache: Dict[str, Dict[str, Any]] = {}

    def __init__(self, db_path: Optional[str] = None):
        self.db_path = self._resolve_db_path(db_path)
        self._ensure_initialized()

    @property
    def _user_repo(self) -> UserRepo:
        try:
            return self.__user_repo
        except AttributeError:
            self.__user_repo = UserRepo(self._get_connection)
            return self.__user_repo

    @property
    def _payment_repo(self) -> PaymentRepo:
        try:
            return self.__payment_repo
        except AttributeError:
            self.__payment_repo = PaymentRepo(self._get_connection)
            return self.__payment_repo

    @property
    def _observation_repo(self) -> ObservationRepo:
        try:
            return self.__observation_repo
        except AttributeError:
            self.__observation_repo = ObservationRepo(self._get_connection)
            return self.__observation_repo

    @property
    def _cache_repo(self) -> CacheRepo:
        try:
            return self.__cache_repo
        except AttributeError:
            self.__cache_repo = CacheRepo(self._get_connection)
            return self.__cache_repo

    @property
    def _binding_repo(self) -> BindingRepo:
        try:
            return self.__binding_repo
        except AttributeError:
            self.__binding_repo = BindingRepo(self._get_connection)
            return self.__binding_repo

    @property
    def _admin_repo(self) -> AdminRepo:
        try:
            return self.__admin_repo
        except AttributeError:
            self.__admin_repo = AdminRepo(self._get_connection)
            return self.__admin_repo

    def _resolve_db_path(self, db_path: Optional[str]) -> str:
        raw = (db_path or os.getenv("POLYWEATHER_DB_PATH") or "").strip()
        if not raw:
            project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            return os.path.join(project_root, "data", "polyweather.db")
        return raw

    def _get_connection(self):
        return connect_sqlite(self.db_path)

    @staticmethod
    def _is_sqlite_locked_error(exc: sqlite3.OperationalError) -> bool:
        return "database is locked" in str(exc).lower()

    def _init_cache_key(self) -> str:
        return os.path.abspath(self.db_path)

    def _ensure_initialized(self) -> None:
        cache_key = self._init_cache_key()
        with self._init_lock:
            if cache_key in self._initialized_paths:
                return
            self._init_db()
            self._initialized_paths.add(cache_key)

    def _supabase_profiles_endpoint(self) -> str:
        return get_supabase_admin_client().profiles_endpoint()

    def _supabase_service_headers(self) -> Dict[str, str]:
        client = get_supabase_admin_client()
        if not client.configured:
            return {}
        return client._service_headers()

    def _supabase_admin_users_endpoint(self) -> str:
        return get_supabase_admin_client().admin_users_endpoint()

    def _profile_sync_min_interval_sec(self) -> float:
        raw = str(
            os.getenv("POLYWEATHER_SUPABASE_PROFILE_SYNC_MIN_INTERVAL_SEC", "3600")
            or ""
        ).strip()
        try:
            return max(0.0, float(raw))
        except ValueError:
            return 3600.0

    def _profile_sync_cache_key(self, supabase_user_id: str) -> str:
        endpoint = self._supabase_profiles_endpoint()
        return f"{endpoint}:{str(supabase_user_id or '').strip().lower()}"

    def _should_skip_profile_sync(
        self,
        *,
        supabase_user_id: str,
        telegram_id: Optional[int],
        telegram_username: Optional[str],
        force: bool = False,
    ) -> bool:
        if force:
            return False
        min_interval = self._profile_sync_min_interval_sec()
        if min_interval <= 0:
            return False
        payload_key = {
            "telegram_id": int(telegram_id) if telegram_id is not None else None,
            "telegram_username": str(telegram_username or "").strip() or None,
        }
        cache_key = self._profile_sync_cache_key(supabase_user_id)
        now_ts = time.monotonic()
        with self._profile_sync_lock:
            cached = self._profile_sync_cache.get(cache_key)
            if not isinstance(cached, dict):
                return False
            cached_payload = cached.get("payload")
            cached_ts = float(cached.get("ts") or 0.0)
            return cached_payload == payload_key and now_ts - cached_ts < min_interval

    def _remember_profile_sync(
        self,
        *,
        supabase_user_id: str,
        telegram_id: Optional[int],
        telegram_username: Optional[str],
    ) -> None:
        cache_key = self._profile_sync_cache_key(supabase_user_id)
        payload_key = {
            "telegram_id": int(telegram_id) if telegram_id is not None else None,
            "telegram_username": str(telegram_username or "").strip() or None,
        }
        with self._profile_sync_lock:
            self._profile_sync_cache[cache_key] = {
                "payload": payload_key,
                "ts": time.monotonic(),
            }
            if len(self._profile_sync_cache) > 4096:
                oldest_key = min(
                    self._profile_sync_cache,
                    key=lambda key: float(
                        self._profile_sync_cache[key].get("ts") or 0.0
                    ),
                )
                self._profile_sync_cache.pop(oldest_key, None)

    def _points_sync_cache_key(self, telegram_id: int) -> str:
        return f"{os.path.abspath(self.db_path)}:{int(telegram_id)}"

    def _points_sync_min_interval_sec(self) -> float:
        raw = str(
            os.getenv("POLYWEATHER_SUPABASE_POINTS_SYNC_MIN_INTERVAL_SEC", "60")
            or ""
        ).strip()
        try:
            return max(0.0, float(raw))
        except Exception:
            return 60.0

    def _should_skip_points_metadata_sync(
        self,
        *,
        telegram_id: int,
        points: int,
        force: bool,
    ) -> bool:
        if force:
            return False
        cache_key = self._points_sync_cache_key(telegram_id)
        now_ts = time.monotonic()
        min_interval = self._points_sync_min_interval_sec()
        with self._points_sync_lock:
            cached = self._points_sync_cache.get(cache_key)
            if not cached:
                return False
            cached_points = int(cached.get("points") or 0)
            cached_ts = float(cached.get("ts") or 0.0)
            if cached_points == int(points):
                return True
            return min_interval > 0 and (now_ts - cached_ts) < min_interval

    def _remember_points_metadata_sync(
        self,
        *,
        telegram_id: int,
        points: int,
    ) -> None:
        cache_key = self._points_sync_cache_key(telegram_id)
        with self._points_sync_lock:
            self._points_sync_cache[cache_key] = {
                "points": int(points),
                "ts": time.monotonic(),
            }
            if len(self._points_sync_cache) > 4096:
                oldest_key = min(
                    self._points_sync_cache,
                    key=lambda key: float(
                        self._points_sync_cache[key].get("ts") or 0.0
                    ),
                )
                self._points_sync_cache.pop(oldest_key, None)

    def _sync_points_to_supabase_user_metadata(
        self,
        telegram_id: int,
        *,
        force: bool = False,
    ) -> bool:
        supabase_url = str(os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
        if not supabase_url:
            return False
        headers = self._supabase_service_headers()
        if not headers:
            return False
        endpoint = self._supabase_admin_users_endpoint()
        if not endpoint:
            return False

        supabase_user_id = None
        points = 0
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT supabase_user_id FROM supabase_bindings WHERE telegram_id = ? LIMIT 1",
                (int(telegram_id),),
            ).fetchone()
            if row and row["supabase_user_id"]:
                supabase_user_id = str(row["supabase_user_id"]).strip()
            if not supabase_user_id:
                row = conn.execute(
                    "SELECT supabase_user_id FROM users WHERE telegram_id = ? LIMIT 1",
                    (int(telegram_id),),
                ).fetchone()
                if row and row["supabase_user_id"]:
                    supabase_user_id = str(row["supabase_user_id"]).strip()
            if not supabase_user_id:
                return False
            pts_row = conn.execute(
                "SELECT points FROM users WHERE telegram_id = ? LIMIT 1",
                (int(telegram_id),),
            ).fetchone()
            if pts_row:
                points = max(0, int(pts_row["points"] or 0))

        if self._should_skip_points_metadata_sync(
            telegram_id=int(telegram_id),
            points=points,
            force=force,
        ):
            return False

        admin = get_supabase_admin_client()
        if not admin.configured:
            return False
        ok = admin.patch_user_metadata(supabase_user_id, {"points": points})
        if ok:
            self._remember_points_metadata_sync(
                telegram_id=int(telegram_id),
                points=points,
            )
        return ok

    def _sync_supabase_profile_telegram_fields(
        self,
        *,
        supabase_user_id: str,
        telegram_id: Optional[int],
        telegram_username: Optional[str],
        force: bool = False,
    ) -> bool:
        normalized_uid = str(supabase_user_id or "").strip().lower()
        endpoint = self._supabase_profiles_endpoint()
        headers = self._supabase_service_headers()
        if not normalized_uid or not endpoint or not headers:
            return False
        if self._should_skip_profile_sync(
            supabase_user_id=normalized_uid,
            telegram_id=telegram_id,
            telegram_username=telegram_username,
            force=force,
        ):
            return False

        payload = {
            "telegram_user_id": int(telegram_id) if telegram_id is not None else None,
            "telegram_username": str(telegram_username or "").strip() or None,
            "updated_at": datetime.now().isoformat(),
        }
        admin = get_supabase_admin_client()
        ok = admin.patch_profile(normalized_uid, payload)
        if ok:
            self._remember_profile_sync(
                supabase_user_id=normalized_uid,
                telegram_id=telegram_id,
                telegram_username=telegram_username,
            )
        return ok

    def _sync_bound_supabase_profiles_for_telegram(
        self,
        *,
        telegram_id: int,
        telegram_username: Optional[str],
    ) -> None:
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT supabase_user_id
                FROM supabase_bindings
                WHERE telegram_id = ?
                """,
                (int(telegram_id),),
            ).fetchall()
        for row in rows:
            user_id = str((row["supabase_user_id"] if row else "") or "").strip().lower()
            if not user_id:
                continue
            self._sync_supabase_profile_telegram_fields(
                supabase_user_id=user_id,
                telegram_id=telegram_id,
                telegram_username=telegram_username,
            )
    def _init_db(self):
        """Create tables if they don't exist."""
        _schema_init_db(self._get_connection(), self.db_path)

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

    def _cache_table_name(self, kind: str) -> Optional[str]:
        normalized = str(kind or "").strip().lower()
        if normalized == "summary":
            return "city_summary_cache"
        if normalized == "panel":
            return "city_panel_cache"
        if normalized == "nearby":
            return "city_nearby_cache"
        if normalized == "market":
            return "city_market_cache"
        if normalized == "full":
            return "city_full_cache"
        return None

    def get_city_cache(self, kind: str, city: str) -> Optional[Dict[str, Any]]:
        return self._cache_repo.get_city_cache(kind, city)

    def set_city_cache(
        self,
        kind: str,
        city: str,
        payload: Dict[str, Any],
        *,
        version: str = "v1",
        source_fingerprint: Optional[str] = None,
    ) -> None:
        return self._cache_repo.set_city_cache(kind, city, payload, version=version, source_fingerprint=source_fingerprint)

    def get_canonical_temperature(self, city: str) -> Optional[Dict[str, Any]]:
        return self._observation_repo.get_canonical_temperature(city)

    def set_canonical_temperature(self, city: str, payload: Dict[str, Any]) -> None:
        return self._observation_repo.set_canonical_temperature(city, payload)

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
        return self._observation_repo.append_raw_observation(source=source, city=city, value=value, observed_at=observed_at, fetched_at=fetched_at, station_code=station_code, station_name=station_name, runway=runway, value_unit=value_unit, source_latency_sec=source_latency_sec, status=status, error_count=error_count, last_success_at=last_success_at, payload=payload)

    def get_latest_raw_observation(
        self,
        source: str,
        city: str,
        *,
        station_code: str = "",
        runway: str = "",
    ) -> Optional[Dict[str, Any]]:
        return self._observation_repo.get_latest_raw_observation(source, city, station_code=station_code, runway=runway)

    def list_latest_raw_observations_for_city(self, city: str, *, limit: int = 100) -> List[Dict[str, Any]]:
        return self._observation_repo.list_latest_raw_observations_for_city(city, limit=limit)

    def list_raw_observation_history(
        self,
        source: str,
        city: str,
        *,
        minutes: int = 60,
        limit: int = 1000,
    ) -> List[Dict[str, Any]]:
        return self._observation_repo.list_raw_observation_history(source, city, minutes=minutes, limit=limit)

    def enqueue_observation_refresh_request(
        self,
        *,
        city: str,
        kind: str = "",
        source: str = "",
        priority: str = "normal",
        reason: str = "",
    ) -> bool:
        return self._observation_repo.enqueue_observation_refresh_request(city=city, kind=kind, source=source, priority=priority, reason=reason)

    def claim_observation_refresh_requests(
        self,
        *,
        limit: int = 20,
        owner: str = "",
        now_ts: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        return self._observation_repo.claim_observation_refresh_requests(limit=limit, owner=owner, now_ts=now_ts)

    def mark_observation_refresh_request_done(
        self,
        request_id: int,
        *,
        status: str = "done",
        error: str = "",
    ) -> None:
        return self._observation_repo.mark_observation_refresh_request_done(request_id, status=status, error=error)

    def acquire_cache_refresh_lock(
        self,
        cache_key: str,
        *,
        ttl_sec: int = 120,
        owner: Optional[str] = None,
    ) -> Optional[str]:
        return self._cache_repo.acquire_cache_refresh_lock(cache_key, ttl_sec=ttl_sec, owner=owner)

    def release_cache_refresh_lock(self, cache_key: str, owner: str) -> None:
        return self._cache_repo.release_cache_refresh_lock(cache_key, owner)

    def get_payment_runtime_state(self, state_key: str) -> Optional[Dict[str, Any]]:
        return self._payment_repo.get_payment_runtime_state(state_key)

    def set_payment_runtime_state(self, state_key: str, payload: Dict[str, Any]) -> None:
        return self._payment_repo.set_payment_runtime_state(state_key, payload)

    @staticmethod
    def _mask_secret_value(value: str) -> str:
        text = str(value or "")
        if not text:
            return ""
        if len(text) <= 8:
            return "***"
        return f"{text[:4]}...{text[-4:]}"

    def get_runtime_secret(self, key: str) -> Optional[str]:
        return self._admin_repo.get_runtime_secret(key)

    def get_runtime_secret_metadata(self, key: str) -> Dict[str, Any]:
        return self._admin_repo.get_runtime_secret_metadata(key)

    def set_runtime_secret(
        self,
        key: str,
        value: str,
        *,
        updated_by: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self._admin_repo.set_runtime_secret(key, value, updated_by=updated_by)

    def append_payment_audit_event(self, event_type: str, payload: Dict[str, Any]) -> None:
        return self._payment_repo.append_payment_audit_event(event_type, payload)

    def append_ops_audit_event(
        self,
        *,
        action: str,
        actor_email: str = "",
        target_user_id: str = "",
        target_email: str = "",
        target_type: str = "",
        target_id: str = "",
        payload: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        normalized_action = str(action or "").strip().lower()
        if not normalized_action:
            return {"ok": False, "reason": "invalid_action"}
        body = payload if isinstance(payload, dict) else {}
        now = datetime.now().isoformat()
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                """
                INSERT INTO ops_audit_events (
                    action,
                    actor_email,
                    target_user_id,
                    target_email,
                    target_type,
                    target_id,
                    payload_json,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    normalized_action,
                    str(actor_email or "").strip().lower(),
                    str(target_user_id or "").strip().lower(),
                    str(target_email or "").strip().lower(),
                    str(target_type or "").strip().lower(),
                    str(target_id or "").strip(),
                    json.dumps(body, ensure_ascii=False, default=str),
                    now,
                ),
            )
            event_id = int(cursor.lastrowid)
            conn.commit()
        return {
            "id": event_id,
            "action": normalized_action,
            "actor_email": str(actor_email or "").strip().lower(),
            "target_user_id": str(target_user_id or "").strip().lower(),
            "target_email": str(target_email or "").strip().lower(),
            "target_type": str(target_type or "").strip().lower(),
            "target_id": str(target_id or "").strip(),
            "payload": body,
            "created_at": now,
        }

    def list_ops_audit_events(
        self,
        *,
        limit: int = 100,
        action: str = "",
        actor_email: str = "",
        target_user_id: str = "",
    ) -> List[Dict[str, Any]]:
        safe_limit = max(1, min(int(limit or 100), 500))
        clauses: List[str] = []
        params: List[Any] = []
        normalized_action = str(action or "").strip().lower()
        normalized_actor = str(actor_email or "").strip().lower()
        normalized_target_user = str(target_user_id or "").strip().lower()
        if normalized_action:
            clauses.append("action = ?")
            params.append(normalized_action)
        if normalized_actor:
            clauses.append("actor_email = ?")
            params.append(normalized_actor)
        if normalized_target_user:
            clauses.append("target_user_id = ?")
            params.append(normalized_target_user)
        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(safe_limit)
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                f"""
                SELECT id, action, actor_email, target_user_id, target_email,
                       target_type, target_id, payload_json, created_at
                FROM ops_audit_events
                {where_sql}
                ORDER BY id DESC
                LIMIT ?
                """,
                tuple(params),
            ).fetchall()
        events: List[Dict[str, Any]] = []
        for row in rows:
            try:
                payload = json.loads(str(row["payload_json"] or "{}"))
            except Exception:
                payload = {}
            events.append(
                {
                    "id": int(row["id"]),
                    "action": str(row["action"] or ""),
                    "actor_email": str(row["actor_email"] or ""),
                    "target_user_id": str(row["target_user_id"] or ""),
                    "target_email": str(row["target_email"] or ""),
                    "target_type": str(row["target_type"] or ""),
                    "target_id": str(row["target_id"] or ""),
                    "payload": payload if isinstance(payload, dict) else {},
                    "created_at": row["created_at"],
                }
            )
        return events

    def _append_points_ledger_entry_conn(
        self,
        conn: sqlite3.Connection,
        *,
        telegram_id: Optional[int],
        supabase_user_id: str = "",
        supabase_email: str = "",
        source: str,
        delta_points: int,
        balance_after: int,
        actor_email: str = "",
        reference_type: str = "",
        reference_id: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        normalized_source = str(source or "").strip().lower()
        if not normalized_source or int(delta_points or 0) == 0:
            return
        conn.execute(
            """
            INSERT INTO points_ledger (
                telegram_id,
                supabase_user_id,
                supabase_email,
                source,
                delta_points,
                balance_after,
                actor_email,
                reference_type,
                reference_id,
                metadata_json,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                int(telegram_id) if telegram_id is not None else None,
                str(supabase_user_id or "").strip().lower(),
                str(supabase_email or "").strip().lower(),
                normalized_source,
                int(delta_points),
                int(balance_after),
                str(actor_email or "").strip().lower(),
                str(reference_type or "").strip().lower(),
                str(reference_id or "").strip(),
                json.dumps(metadata if isinstance(metadata, dict) else {}, ensure_ascii=False, default=str),
                datetime.now().isoformat(),
            ),
        )

    def append_points_ledger_entry(
        self,
        *,
        telegram_id: Optional[int] = None,
        supabase_user_id: str = "",
        supabase_email: str = "",
        source: str,
        delta_points: int,
        balance_after: int,
        actor_email: str = "",
        reference_type: str = "",
        reference_id: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        return self._user_repo.append_points_ledger_entry(telegram_id=telegram_id, supabase_user_id=supabase_user_id, supabase_email=supabase_email, source=source, delta_points=delta_points, balance_after=balance_after, actor_email=actor_email, reference_type=reference_type, reference_id=reference_id, metadata=metadata)

    def list_points_ledger_entries(
        self,
        *,
        limit: int = 20,
        supabase_user_id: str = "",
        supabase_email: str = "",
    ) -> List[Dict[str, Any]]:
        return self._user_repo.list_points_ledger_entries(limit=limit, supabase_user_id=supabase_user_id, supabase_email=supabase_email)

    def get_points_ledger_summary(
        self,
        *,
        supabase_user_id: str = "",
        supabase_email: str = "",
        limit: int = 20,
    ) -> Dict[str, Any]:
        return self._user_repo.get_points_ledger_summary(supabase_user_id=supabase_user_id, supabase_email=supabase_email, limit=limit)

    @staticmethod
    def _refund_case_row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
        try:
            notes = json.loads(str(row["notes_json"] or "[]"))
        except Exception:
            notes = []
        return {
            "id": int(row["id"]),
            "status": str(row["status"] or ""),
            "reason": str(row["reason"] or ""),
            "intent_id": str(row["intent_id"] or ""),
            "tx_hash": str(row["tx_hash"] or ""),
            "user_id": str(row["user_id"] or ""),
            "amount_usdc": str(row["amount_usdc"] or ""),
            "created_by": str(row["created_by"] or ""),
            "handled_by": str(row["handled_by"] or ""),
            "notes": notes if isinstance(notes, list) else [],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def create_refund_case(
        self,
        *,
        reason: str,
        intent_id: str = "",
        tx_hash: str = "",
        user_id: str = "",
        amount_usdc: str = "",
        created_by: str = "",
        note: str = "",
    ) -> Dict[str, Any]:
        return self._payment_repo.create_refund_case(reason=reason, intent_id=intent_id, tx_hash=tx_hash, user_id=user_id, amount_usdc=amount_usdc, created_by=created_by, note=note)

    def update_refund_case(
        self,
        case_id: int,
        *,
        status: str,
        handled_by: str = "",
        note: str = "",
    ) -> Optional[Dict[str, Any]]:
        return self._payment_repo.update_refund_case(case_id, status=status, handled_by=handled_by, note=note)

    def list_refund_cases(
        self,
        *,
        limit: int = 50,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        return self._payment_repo.list_refund_cases(limit=limit, status=status)

    def append_app_analytics_event(
        self,
        event_type: str,
        payload: Dict[str, Any],
        *,
        user_id: Optional[str] = None,
        client_id: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> None:
        kind = str(event_type or "").strip().lower()
        if not kind:
            return
        body = payload if isinstance(payload, dict) else {}
        normalized_user_id = str(user_id or "").strip().lower() or None
        normalized_client_id = str(client_id or "").strip() or None
        normalized_session_id = str(session_id or "").strip() or None
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO app_analytics_events (
                    event_type,
                    user_id,
                    client_id,
                    session_id,
                    payload_json,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    kind,
                    normalized_user_id,
                    normalized_client_id,
                    normalized_session_id,
                    json.dumps(body, ensure_ascii=False),
                    datetime.now().isoformat(),
                ),
            )
            conn.commit()

    def list_app_analytics_events(
        self,
        *,
        limit: int = 200,
        event_type: Optional[str] = None,
        since_iso: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        safe_limit = max(1, min(int(limit or 200), 20000))
        kind = str(event_type or "").strip().lower()
        params: List[Any] = []
        clauses: List[str] = []
        if kind:
            clauses.append("event_type = ?")
            params.append(kind)
        since_text = str(since_iso or "").strip()
        if since_text:
            clauses.append("created_at >= ?")
            params.append(since_text)
        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(safe_limit)
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                f"""
                SELECT id, event_type, user_id, client_id, session_id, payload_json, created_at
                FROM app_analytics_events
                {where_sql}
                ORDER BY id DESC
                LIMIT ?
                """,
                tuple(params),
            ).fetchall()
            out: List[Dict[str, Any]] = []
            for row in rows:
                try:
                    payload = json.loads(str(row["payload_json"] or "{}"))
                except Exception:
                    payload = {}
                out.append(
                    {
                        "id": int(row["id"]),
                        "event_type": str(row["event_type"] or ""),
                        "user_id": str(row["user_id"] or "") or None,
                        "client_id": str(row["client_id"] or "") or None,
                        "session_id": str(row["session_id"] or "") or None,
                        "payload": payload if isinstance(payload, dict) else {},
                        "created_at": row["created_at"],
                    }
                )
            return out

    def _feedback_row_to_dict(self, row: sqlite3.Row) -> Dict[str, Any]:
        try:
            context = json.loads(str(row["context_json"] or "{}"))
        except Exception:
            context = {}
        return {
            "id": int(row["id"]),
            "category": str(row["category"] or ""),
            "message": str(row["message"] or ""),
            "source": str(row["source"] or ""),
            "status": str(row["status"] or ""),
            "contact": str(row["contact"] or ""),
            "user_id": str(row["user_id"] or ""),
            "user_email": str(row["user_email"] or ""),
            "context": context if isinstance(context, dict) else {},
            "reward_points": max(0, int(row["reward_points"] or 0)),
            "reward_reason": str(row["reward_reason"] or ""),
            "rewarded_at": row["rewarded_at"],
            "reward_status": str(row["reward_status"] or ""),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def append_user_feedback(
        self,
        *,
        category: str,
        message: str,
        source: str = "terminal",
        contact: Optional[str] = None,
        user_id: Optional[str] = None,
        user_email: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        normalized_category = str(category or "other").strip().lower()[:40] or "other"
        normalized_message = str(message or "").strip()
        normalized_source = str(source or "terminal").strip().lower()[:40] or "terminal"
        normalized_contact = str(contact or "").strip()[:180]
        normalized_user_id = str(user_id or "").strip().lower()[:128]
        normalized_user_email = str(user_email or "").strip().lower()[:180]
        context_payload = context if isinstance(context, dict) else {}
        now = datetime.now().isoformat()
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                """
                INSERT INTO user_feedback (
                    category,
                    message,
                    source,
                    status,
                    contact,
                    user_id,
                    user_email,
                    context_json,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)
                """,
                (
                    normalized_category,
                    normalized_message,
                    normalized_source,
                    normalized_contact,
                    normalized_user_id,
                    normalized_user_email,
                    json.dumps(context_payload, ensure_ascii=False, default=str),
                    now,
                    now,
                ),
            )
            feedback_id = int(cursor.lastrowid)
            row = conn.execute(
                """
                SELECT id, category, message, source, status, contact, user_id,
                       user_email, context_json, reward_points, reward_reason,
                       rewarded_at, reward_status, created_at, updated_at
                FROM user_feedback
                WHERE id = ?
                """,
                (feedback_id,),
            ).fetchone()
            conn.commit()
        return self._feedback_row_to_dict(row)

    def list_user_feedback(
        self,
        *,
        limit: int = 100,
        status: Optional[str] = None,
        user_id: Optional[str] = None,
        user_email: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        safe_limit = max(1, min(int(limit or 100), 500))
        normalized_status = str(status or "").strip().lower()
        normalized_user_id = str(user_id or "").strip().lower()
        normalized_user_email = str(user_email or "").strip().lower()
        clauses: List[str] = []
        params: List[Any] = []
        if normalized_status:
            clauses.append("status = ?")
            params.append(normalized_status)
        identity_clauses: List[str] = []
        if normalized_user_id:
            identity_clauses.append("user_id = ?")
            params.append(normalized_user_id)
        if normalized_user_email:
            identity_clauses.append("user_email = ?")
            params.append(normalized_user_email)
        if identity_clauses:
            clauses.append(f"({' OR '.join(identity_clauses)})")
        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(safe_limit)
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                f"""
                SELECT id, category, message, source, status, contact, user_id,
                       user_email, context_json, reward_points, reward_reason,
                       rewarded_at, reward_status, created_at, updated_at
                FROM user_feedback
                {where_sql}
                ORDER BY id DESC
                LIMIT ?
                """,
                tuple(params),
            ).fetchall()
        return [self._feedback_row_to_dict(row) for row in rows]

    def update_user_feedback_status(
        self,
        feedback_id: int,
        *,
        status: str,
    ) -> Optional[Dict[str, Any]]:
        normalized_status = str(status or "").strip().lower()
        if not normalized_status:
            return None
        now = datetime.now().isoformat()
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            conn.execute(
                """
                UPDATE user_feedback
                SET status = ?, updated_at = ?
                WHERE id = ?
                """,
                (normalized_status, now, int(feedback_id)),
            )
            row = conn.execute(
                """
                SELECT id, category, message, source, status, contact, user_id,
                       user_email, context_json, reward_points, reward_reason,
                       rewarded_at, reward_status, created_at, updated_at
                FROM user_feedback
                WHERE id = ?
                """,
                (int(feedback_id),),
            ).fetchone()
            conn.commit()
        return self._feedback_row_to_dict(row) if row else None

    def update_user_feedback_reward(
        self,
        feedback_id: int,
        *,
        points: int,
        reason: str = "",
        status: str = "granted",
    ) -> Optional[Dict[str, Any]]:
        safe_points = max(0, int(points or 0))
        normalized_reason = str(reason or "").strip()[:500]
        normalized_status = str(status or "").strip().lower()[:40]
        if not normalized_status:
            normalized_status = "granted" if safe_points > 0 else "skipped"
        now = datetime.now().isoformat()
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            conn.execute(
                """
                UPDATE user_feedback
                SET reward_points = ?,
                    reward_reason = ?,
                    reward_status = ?,
                    rewarded_at = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    safe_points,
                    normalized_reason,
                    normalized_status,
                    now,
                    now,
                    int(feedback_id),
                ),
            )
            row = conn.execute(
                """
                SELECT id, category, message, source, status, contact, user_id,
                       user_email, context_json, reward_points, reward_reason,
                       rewarded_at, reward_status, created_at, updated_at
                FROM user_feedback
                WHERE id = ?
                """,
                (int(feedback_id),),
            ).fetchone()
            conn.commit()
        return self._feedback_row_to_dict(row) if row else None

    def grant_feedback_reward(
        self,
        feedback_id: int,
        *,
        points: int,
        reason: str = "",
        actor_email: str = "",
    ) -> Dict[str, Any]:
        safe_points = int(points or 0)
        if safe_points <= 0:
            return {"ok": False, "reason": "invalid_amount"}
        normalized_reason = str(reason or "").strip()[:500]

        now = datetime.now().isoformat()
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            conn.execute("BEGIN IMMEDIATE")
            feedback_row = conn.execute(
                """
                SELECT id, category, message, source, status, contact, user_id,
                       user_email, context_json, reward_points, reward_reason,
                       rewarded_at, reward_status, created_at, updated_at
                FROM user_feedback
                WHERE id = ?
                LIMIT 1
                """,
                (int(feedback_id),),
            ).fetchone()
            if not feedback_row:
                return {"ok": False, "reason": "feedback_not_found"}

            existing_points = int(feedback_row["reward_points"] or 0)
            existing_status = str(feedback_row["reward_status"] or "").strip().lower()
            email = str(feedback_row["user_email"] or "").strip().lower()
            if not email:
                return {
                    "ok": False,
                    "reason": "missing_feedback_user_email",
                    "feedback": self._feedback_row_to_dict(feedback_row),
                }

            user_row = conn.execute(
                """
                SELECT telegram_id, username, points, supabase_email, supabase_user_id
                FROM users
                WHERE lower(trim(COALESCE(supabase_email, ''))) = ?
                LIMIT 1
                """,
                (email,),
            ).fetchone()
            if not user_row:
                user_row = conn.execute(
                    """
                    SELECT u.telegram_id, u.username, u.points, b.supabase_email,
                           b.supabase_user_id
                    FROM users u
                    JOIN supabase_bindings b ON b.telegram_id = u.telegram_id
                    WHERE lower(trim(COALESCE(b.supabase_email, ''))) = ?
                    LIMIT 1
                    """,
                    (email,),
                ).fetchone()
            if not user_row:
                return {
                    "ok": False,
                    "reason": "user_not_found",
                    "supabase_email": email,
                    "feedback": self._feedback_row_to_dict(feedback_row),
                }

            before = int(user_row["points"] or 0)
            if existing_status == "granted" and existing_points > 0:
                return {
                    "ok": False,
                    "reason": "already_rewarded",
                    "feedback": self._feedback_row_to_dict(feedback_row),
                    "points_after": before,
                }

            telegram_id = int(user_row["telegram_id"] or 0)
            after = before + safe_points
            conn.execute(
                """
                UPDATE users
                SET points = ?
                WHERE telegram_id = ?
                """,
                (after, telegram_id),
            )
            conn.execute(
                """
                UPDATE user_feedback
                SET reward_points = ?,
                    reward_reason = ?,
                    reward_status = 'granted',
                    rewarded_at = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (safe_points, normalized_reason, now, now, int(feedback_id)),
            )
            self._append_points_ledger_entry_conn(
                conn,
                telegram_id=telegram_id,
                supabase_user_id=str(user_row["supabase_user_id"] or "").strip().lower(),
                supabase_email=str(user_row["supabase_email"] or email),
                source="feedback_reward",
                delta_points=safe_points,
                balance_after=after,
                actor_email=actor_email,
                reference_type="feedback",
                reference_id=str(feedback_id),
                metadata={"reason": normalized_reason},
            )
            updated_feedback_row = conn.execute(
                """
                SELECT id, category, message, source, status, contact, user_id,
                       user_email, context_json, reward_points, reward_reason,
                       rewarded_at, reward_status, created_at, updated_at
                FROM user_feedback
                WHERE id = ?
                LIMIT 1
                """,
                (int(feedback_id),),
            ).fetchone()
            conn.commit()

        self._sync_points_to_supabase_user_metadata(telegram_id, force=True)
        return {
            "ok": True,
            "feedback_id": int(feedback_id),
            "telegram_id": telegram_id,
            "username": str(user_row["username"] or ""),
            "supabase_email": str(user_row["supabase_email"] or email),
            "points_before": before,
            "points_added": safe_points,
            "points_after": after,
            "feedback": self._feedback_row_to_dict(updated_feedback_row)
            if updated_feedback_row
            else None,
        }

    def get_app_analytics_funnel_summary(self, *, days: int = 30) -> Dict[str, Any]:
        safe_days = max(1, min(int(days or 30), 365))
        since_dt = datetime.now() - timedelta(days=safe_days)
        rows = self.list_app_analytics_events(limit=20000, since_iso=since_dt.isoformat())
        event_names = [
            "landing_view",
            "enter_terminal",
            "login_start",
            "signup_success",
            "trial_created",
            "payment_start",
            "payment_success",
        ]
        content_event_names = [
            "brief_view",
            "brief_cta_click",
            "methodology_view",
            "social_outbound_click",
        ]
        diagnostic_event_names = ["degraded_auth_profile"]
        event_aliases = {
            "landing_view": ("landing_view",),
            "enter_terminal": ("enter_terminal", "dashboard_active"),
            "login_start": ("login_start",),
            "signup_success": ("signup_success", "signup_completed"),
            "trial_created": ("trial_created",),
            "payment_start": ("payment_start", "checkout_started"),
            "payment_success": ("payment_success", "checkout_succeeded"),
        }
        alias_to_event = {
            alias: event_name
            for event_name, aliases in event_aliases.items()
            for alias in aliases
        }
        summary: Dict[str, Dict[str, Any]] = {
            name: {
                "total": 0,
                "unique_users": 0,
                "unique_actors": 0,
            }
            for name in event_names
        }
        actor_sets: Dict[str, set[str]] = {name: set() for name in event_names}
        user_sets: Dict[str, set[str]] = {name: set() for name in event_names}
        content_summary: Dict[str, Dict[str, Any]] = {
            name: {
                "total": 0,
                "unique_users": 0,
                "unique_actors": 0,
            }
            for name in content_event_names
        }
        content_actor_sets: Dict[str, set[str]] = {
            name: set() for name in content_event_names
        }
        content_user_sets: Dict[str, set[str]] = {
            name: set() for name in content_event_names
        }
        diagnostics: Dict[str, Dict[str, Any]] = {
            name: {"total": 0, "unique_actors": 0, "by_reason": []}
            for name in diagnostic_event_names
        }
        diagnostic_actor_sets: Dict[str, set[str]] = {
            name: set() for name in diagnostic_event_names
        }
        diagnostic_reason_counts: Dict[str, Counter] = {
            name: Counter() for name in diagnostic_event_names
        }
        referrer_counts: Counter = Counter()
        country_counts: Counter = Counter()
        device_counts: Counter = Counter()
        landing_path_counts: Counter = Counter()
        content_path_counts: Counter = Counter()
        content_city_counts: Counter = Counter()

        def _payload(row: Dict[str, Any]) -> Dict[str, Any]:
            payload = row.get("payload")
            return payload if isinstance(payload, dict) else {}

        def _actor_key(row: Dict[str, Any]) -> str:
            payload = _payload(row)
            user_id = str(row.get("user_id") or payload.get("user_id") or "").strip().lower()
            client_id = str(row.get("client_id") or "").strip()
            session_id = str(row.get("session_id") or "").strip()
            if user_id:
                return f"user:{user_id}"
            if client_id:
                return f"client:{client_id}"
            if session_id:
                return f"session:{session_id}"
            return f"event:{row.get('id')}"

        def _top(counter: Counter, *, limit: int = 8) -> List[Dict[str, Any]]:
            return [
                {"name": name, "count": count}
                for name, count in counter.most_common(limit)
            ]

        def _normalize_referrer(value: Any) -> str:
            raw = str(value or "").strip()
            if not raw:
                return "(direct)"
            try:
                parsed = urlparse(raw)
                host = (parsed.netloc or parsed.path or raw).lower()
                return host.replace("www.", "", 1) or "(direct)"
            except Exception:
                return raw[:80] or "(direct)"

        for row in rows:
            raw_event_type = str(row.get("event_type") or "").strip().lower()
            payload = _payload(row)
            if raw_event_type in diagnostics:
                diagnostics[raw_event_type]["total"] += 1
                diagnostic_actor_sets[raw_event_type].add(_actor_key(row))
                reason = str(payload.get("reason") or payload.get("degraded_reason") or "unknown").strip()
                diagnostic_reason_counts[raw_event_type][reason[:120] or "unknown"] += 1
                continue

            if raw_event_type in content_summary:
                content_summary[raw_event_type]["total"] += 1
                user_id = str(row.get("user_id") or "").strip().lower()
                if user_id:
                    content_user_sets[raw_event_type].add(user_id)
                content_actor_sets[raw_event_type].add(_actor_key(row))
                path = str(payload.get("path") or "/").strip()[:120]
                content_path_counts[path or "/"] += 1
                city = str(payload.get("city") or "").strip().lower()
                if city:
                    content_city_counts[city[:80]] += 1
                continue

            event_type = alias_to_event.get(raw_event_type)
            if not event_type:
                continue
            summary[event_type]["total"] += 1
            user_id = str(row.get("user_id") or "").strip().lower()
            if user_id:
                user_sets[event_type].add(user_id)
            actor_key = _actor_key(row)
            actor_sets[event_type].add(actor_key)

            if event_type == "landing_view":
                referrer_counts[_normalize_referrer(payload.get("referrer"))] += 1
                country = str(payload.get("cf_country") or payload.get("country") or "").strip().upper()
                country_counts[country or "UNKNOWN"] += 1
                device = str(payload.get("device_type") or "unknown").strip().lower()
                device_counts[device or "unknown"] += 1
                path = str(payload.get("path") or "/").strip()[:120]
                landing_path_counts[path or "/"] += 1

        for name in event_names:
            summary[name]["unique_users"] = len(user_sets[name])
            summary[name]["unique_actors"] = len(actor_sets[name])
        for name in content_event_names:
            content_summary[name]["unique_users"] = len(content_user_sets[name])
            content_summary[name]["unique_actors"] = len(content_actor_sets[name])
        for name in diagnostic_event_names:
            diagnostics[name]["unique_actors"] = len(diagnostic_actor_sets[name])
            diagnostics[name]["by_reason"] = _top(diagnostic_reason_counts[name], limit=6)

        def _rate(numerator_key: str, denominator_key: str) -> Optional[float]:
            denominator = int(summary[denominator_key]["unique_actors"] or 0)
            numerator = int(summary[numerator_key]["unique_actors"] or 0)
            if denominator <= 0:
                return None
            return round(numerator / denominator, 3)

        return {
            "window_days": safe_days,
            "since": since_dt.isoformat(),
            "events": summary,
            "content_events": content_summary,
            "content": {
                "paths": _top(content_path_counts),
                "cities": _top(content_city_counts),
            },
            "diagnostics": diagnostics,
            "traffic": {
                "referrers": _top(referrer_counts),
                "countries": _top(country_counts),
                "devices": _top(device_counts),
                "landing_paths": _top(landing_path_counts),
            },
            "rates": {
                "enter_terminal_rate": _rate("enter_terminal", "landing_view"),
                "login_start_rate": _rate("login_start", "enter_terminal"),
                "signup_success_rate": _rate("signup_success", "login_start"),
                "trial_created_rate": _rate("trial_created", "signup_success"),
                "payment_start_rate": _rate("payment_start", "trial_created"),
                "payment_success_rate": _rate("payment_success", "payment_start"),
            },
        }

    def list_payment_audit_events(
        self,
        limit: int = 50,
        event_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        return self._payment_repo.list_payment_audit_events(limit, event_type)

    def mark_payment_audit_event_resolved(
        self,
        event_id: int,
        resolved_by: str,
    ) -> Optional[Dict[str, Any]]:
        return self._payment_repo.mark_payment_audit_event_resolved(event_id, resolved_by)

    @staticmethod
    def _payment_audit_resolution_key(
        event_type: str,
        payload: Dict[str, Any],
    ) -> Tuple[str, str, str, str, str]:
        confirm_failure = (
            payload.get("confirm_failure")
            if isinstance(payload.get("confirm_failure"), dict)
            else {}
        )
        reason = str(
            payload.get("reason")
            or confirm_failure.get("reason")
            or payload.get("error")
            or "unknown"
        ).strip().lower()
        intent_id = str(
            payload.get("intent_id")
            or payload.get("payment_intent_id")
            or confirm_failure.get("intent_id")
            or ""
        ).strip().lower()
        user_id = str(payload.get("user_id") or "").strip().lower()
        tx_hash = str(
            payload.get("tx_hash")
            or confirm_failure.get("tx_hash")
            or ""
        ).strip().lower()
        return str(event_type or "").strip().lower(), reason, user_id, intent_id, tx_hash

    def mark_related_payment_audit_events_resolved(
        self,
        event_id: int,
        resolved_by: str,
    ) -> List[Dict[str, Any]]:
        return self._payment_repo.mark_related_payment_audit_events_resolved(event_id, resolved_by)

    @staticmethod
    def _safe_week_key(value: str) -> str:
        text = str(value or "").strip()
        if len(text) >= 8 and "-W" in text:
            return text[:8]
        return ""

    def _upsert_weekly_archive(
        self,
        conn: sqlite3.Connection,
        telegram_id: int,
        week_key: str,
        points: int,
    ) -> None:
        wk = self._safe_week_key(week_key)
        if not wk:
            return
        pts = max(0, int(points or 0))
        conn.execute(
            """
            INSERT INTO weekly_points_archive (telegram_id, week_key, points, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(telegram_id, week_key) DO UPDATE SET
                points = excluded.points,
                updated_at = excluded.updated_at
            """,
            (int(telegram_id), wk, pts, datetime.now().isoformat()),
        )

    @staticmethod
    def _read_bonus_config(env_key: str, fallback: int) -> int:
        raw = os.getenv(env_key)
        if raw is None or raw.strip() == "":
            return fallback
        try:
            return max(0, int(raw))
        except Exception:
            return fallback

    def _ensure_column(self, conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
        existing = {
            row[1]
            for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
        }
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")

    def _find_telegram_id_by_supabase_user_id(
        self,
        conn: sqlite3.Connection,
        supabase_user_id: str,
    ) -> Optional[int]:
        key = str(supabase_user_id or "").strip().lower()
        if not key:
            return None
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT telegram_id
            FROM supabase_bindings
            WHERE lower(trim(COALESCE(supabase_user_id, ''))) = ?
            LIMIT 1
            """,
            (key,),
        ).fetchone()
        if row:
            try:
                return int(row["telegram_id"])
            except Exception:
                return None

        # Legacy fallback before supabase_bindings migration.
        row = conn.execute(
            """
            SELECT telegram_id
            FROM users
            WHERE lower(trim(COALESCE(supabase_user_id, ''))) = ?
            LIMIT 1
            """,
            (key,),
        ).fetchone()
        if not row:
            return None
        try:
            return int(row["telegram_id"])
        except Exception:
            return None

    def get_user(self, telegram_id: int) -> Optional[Dict[str, Any]]:
        return self._user_repo.get_user(telegram_id)

    def get_user_by_supabase_user_id(self, supabase_user_id: str) -> Optional[Dict[str, Any]]:
        return self._user_repo.get_user_by_supabase_user_id(supabase_user_id)

    def list_supabase_user_ids_for_telegram(self, telegram_id: int) -> List[str]:
        """Return all Supabase accounts currently bound to a Telegram user."""
        return self._user_repo.list_supabase_user_ids_for_telegram(telegram_id)

    def search_users(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        return self._user_repo.search_users(query, limit)

    def get_users_by_supabase_user_ids(
        self,
        supabase_user_ids: List[str],
    ) -> Dict[str, Dict[str, Any]]:
        return self._user_repo.get_users_by_supabase_user_ids(supabase_user_ids)

    def get_points_by_supabase_user_id(self, supabase_user_id: str) -> int:
        return self._user_repo.get_points_by_supabase_user_id(supabase_user_id)

    def get_points_by_supabase_email(self, supabase_email: str) -> int:
        return self._user_repo.get_points_by_supabase_email(supabase_email)

    def grant_points_by_supabase_email(
        self,
        supabase_email: str,
        amount: int,
        *,
        source: str = "manual_adjustment",
        actor_email: str = "",
        reference_type: str = "",
        reference_id: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return self._user_repo.grant_points_by_supabase_email(supabase_email, amount, source=source, actor_email=actor_email, reference_type=reference_type, reference_id=reference_id, metadata=metadata)

    def grant_points_by_supabase_user_id(
        self,
        supabase_user_id: str,
        amount: int,
        *,
        source: str = "manual_adjustment",
        actor_email: str = "",
        reference_type: str = "",
        reference_id: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return self._user_repo.grant_points_by_supabase_user_id(supabase_user_id, amount, source=source, actor_email=actor_email, reference_type=reference_type, reference_id=reference_id, metadata=metadata)

    def deduct_points_by_supabase_email(
        self,
        supabase_email: str,
        amount: int,
        *,
        source: str = "points_redemption",
        actor_email: str = "",
        reference_type: str = "",
        reference_id: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return self._user_repo.deduct_points_by_supabase_email(supabase_email, amount, source=source, actor_email=actor_email, reference_type=reference_type, reference_id=reference_id, metadata=metadata)

    def transfer_points_by_email(
        self,
        from_email: str,
        to_email: str,
        amount: int,
    ) -> Dict[str, Any]:
        """Transfer points from one user to another within a single transaction."""
        return self._user_repo.transfer_points_by_email(from_email, to_email, amount)

    def upsert_user(self, telegram_id: int, username: str):
        return self._user_repo.upsert_user(telegram_id, username)

    def bind_supabase_identity(
        self,
        telegram_id: int,
        supabase_user_id: str,
        supabase_email: str = "",
    ) -> Dict[str, Any]:
        return self._binding_repo.bind_supabase_identity(telegram_id, supabase_user_id, supabase_email)

    def unbind_supabase_identity(self, telegram_id: int) -> Dict[str, Any]:
        return self._binding_repo.unbind_supabase_identity(telegram_id)

    def create_bind_token(self, telegram_id: int, ttl_minutes: int = 10) -> str:
        return self._binding_repo.create_bind_token(telegram_id, ttl_minutes)

    def consume_bind_token(self, token: str) -> Optional[int]:
        return self._binding_repo.consume_bind_token(token)

    def peek_web_bind_token(self, token: str) -> Optional[Dict[str, str]]:
        return self._binding_repo.peek_web_bind_token(token)

    def create_web_bind_token(
        self,
        supabase_user_id: str,
        supabase_email: str = "",
        ttl_minutes: int = 10,
    ) -> str:
        return self._binding_repo.create_web_bind_token(supabase_user_id, supabase_email, ttl_minutes)

    def consume_web_bind_token(self, token: str) -> Optional[Dict[str, str]]:
        return self._binding_repo.consume_web_bind_token(token)

    def add_message_activity(
        self,
        telegram_id: int,
        text: str,
        points_to_add: int = 1,
        cooldown_sec: int = 30,
        daily_cap: int = 20,
        min_text_length: int = 4,
    ) -> Dict[str, Any]:
        return self._user_repo.add_message_activity(telegram_id, text, points_to_add, cooldown_sec, daily_cap, min_text_length)

    def track_query_usage(self, telegram_id: int, query_type: str) -> Dict[str, Any]:
        return self._user_repo.track_query_usage(telegram_id, query_type)

    def spend_points(self, telegram_id: int, amount: int) -> Dict[str, Any]:
        return self._user_repo.spend_points(telegram_id, amount)

    def spend_points_by_supabase_user_id(self, supabase_user_id: str, amount: int) -> Dict[str, Any]:
        return self._user_repo.spend_points_by_supabase_user_id(supabase_user_id, amount)

    def set_premium(self, telegram_id: int, plan: str, months: int = 1):
        self._user_repo.set_premium(telegram_id, plan, months)

    def get_leaderboard(self, limit: int = 10):
        return self._user_repo.get_leaderboard(limit)

    def get_weekly_leaderboard(self, limit: int = 10):
        return self._user_repo.get_weekly_leaderboard(limit)

    def get_weekly_profile(self, telegram_id: int) -> Dict[str, Any]:
        return self._user_repo.get_weekly_profile(telegram_id)

    def get_weekly_profile_by_supabase_user_id(self, supabase_user_id: str) -> Dict[str, Any]:
        return self._user_repo.get_weekly_profile_by_supabase_user_id(supabase_user_id)

    def get_weekly_reward_candidates(self, week_key: str, limit: int = 10):
        return self._user_repo.get_weekly_reward_candidates(week_key, limit)

    def get_weekly_participation_candidates(self, week_key: str, exclude_ids: set):
        return self._user_repo.get_weekly_participation_candidates(week_key, exclude_ids)

    def is_weekly_reward_settled(self, week_key: str) -> bool:
        return self._user_repo.is_weekly_reward_settled(week_key)

    def mark_weekly_reward_settled(
        self,
        week_key: str,
        winners_count: int,
        summary: Optional[Dict[str, Any]] = None,
    ) -> None:
        self._user_repo.mark_weekly_reward_settled(week_key, winners_count, summary)

    def apply_weekly_reward_payout(
        self,
        week_key: str,
        telegram_id: int,
        rank: int,
        username: str,
        points_bonus: int,
        pro_days: int,
        supabase_user_id: str = "",
        pro_granted: bool = False,
        pro_error: str = "",
    ) -> bool:
        return self._user_repo.apply_weekly_reward_payout(week_key, telegram_id, rank, username, points_bonus, pro_days, supabase_user_id, pro_granted, pro_error)

    def record_user_growth_snapshot(
        self,
        *,
        snapshot_date: str,
        total_registered: int,
        verified_users: int,
        ever_signed_in: int,
        source: str = "supabase_auth_admin",
    ) -> None:
        return self._user_repo.record_user_growth_snapshot(snapshot_date=snapshot_date, total_registered=total_registered, verified_users=verified_users, ever_signed_in=ever_signed_in, source=source)

    def list_user_growth_snapshots(self, limit: int = 90) -> List[Dict[str, Any]]:
        return self._user_repo.list_user_growth_snapshots(limit)

    def is_growth_milestone_settled(self, milestone: int) -> bool:
        return self._user_repo.is_growth_milestone_settled(milestone)

    def has_growth_milestone_payout(self, milestone: int, supabase_user_id: str) -> bool:
        return self._user_repo.has_growth_milestone_payout(milestone, supabase_user_id)

    def list_growth_milestone_payouts(self, milestone: int) -> List[Dict[str, Any]]:
        return self._user_repo.list_growth_milestone_payouts(milestone)

    def record_growth_milestone_payout(
        self,
        milestone: int,
        supabase_user_id: str,
        reward_days: int,
        status: str,
        error: str,
        *,
        expires_at: str = "",
    ) -> bool:
        return self._user_repo.record_growth_milestone_payout(milestone, supabase_user_id, reward_days, status, error, expires_at=expires_at)

    def mark_growth_milestone_settled(
        self,
        milestone: int,
        verified_users: int,
        reward_days: int,
        rewarded_count: int,
        failed_count: int,
        summary: Optional[Dict[str, Any]] = None,
    ) -> None:
        return self._user_repo.mark_growth_milestone_settled(milestone, verified_users, reward_days, rewarded_count, failed_count, summary)

    def append_airport_obs(
        self,
        *,
        icao: str,
        city: str,
        temp_c: Optional[float] = None,
        wind_kt: Optional[float] = None,
        pressure_hpa: Optional[float] = None,
        obs_time: str,
    ) -> None:
        self.append_airport_obs_batch(
            [
                {
                    "icao": icao,
                    "city": city,
                    "temp_c": temp_c,
                    "wind_kt": wind_kt,
                    "pressure_hpa": pressure_hpa,
                    "obs_time": obs_time,
                }
            ]
        )

    def append_airport_obs_batch(self, rows: List[Dict[str, Any]]) -> None:
        normalized_rows: List[Tuple[str, str, Optional[float], Optional[float], Optional[float], str]] = []
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            safe_icao = str(row.get("icao") or "").strip().upper()
            safe_city = str(row.get("city") or "").strip().lower()
            safe_obs_time = str(row.get("obs_time") or "").strip()
            if not safe_icao or not safe_city or not safe_obs_time:
                continue
            normalized_rows.append(
                (
                    safe_icao,
                    safe_city,
                    row.get("temp_c"),
                    row.get("wind_kt"),
                    row.get("pressure_hpa"),
                    safe_obs_time,
                )
            )
        if not normalized_rows:
            return
        first_icao, first_city = normalized_rows[0][0], normalized_rows[0][1]
        try:
            with self._get_connection() as conn:
                conn.executemany(
                    """
                    INSERT INTO airport_obs_log (icao, city, temp_c, wind_kt, pressure_hpa, obs_time)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    normalized_rows,
                )
                conn.execute(
                    "DELETE FROM airport_obs_log WHERE created_at < datetime('now', '-2 hours')"
                )
                conn.commit()
        except sqlite3.OperationalError as exc:
            if self._is_sqlite_locked_error(exc):
                logger.warning(
                    "airport obs log skipped because sqlite is locked icao={} city={}",
                    first_icao,
                    first_city,
                )
                return
            raise

    def get_airport_obs_recent(
        self, icao: str, minutes: int = 30
    ) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT icao, city, temp_c, wind_kt, pressure_hpa, obs_time, created_at
                FROM airport_obs_log
                WHERE icao = ? AND created_at >= datetime('now', ? || ' minutes')
                ORDER BY created_at ASC
                """,
                (str(icao).strip().upper(), str(-int(minutes))),
            ).fetchall()
            return [dict(r) for r in rows]
