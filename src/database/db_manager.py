import sqlite3
import os
import hashlib
import json
import secrets
import threading
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List, Set, Tuple
from urllib.parse import urlparse

from loguru import logger

from src.database.sqlite_connection import connect_sqlite
from src.auth.supabase_admin_client import get_supabase_admin_client


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
        # Ensure directory exists
        db_dir = os.path.dirname(self.db_path)
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)
        with self._get_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    telegram_id INTEGER PRIMARY KEY,
                    username TEXT,
                    is_web_premium BOOLEAN DEFAULT 0,
                    web_expiry TIMESTAMP,
                    is_group_premium BOOLEAN DEFAULT 0,
                    group_expiry TIMESTAMP,
                    points INTEGER DEFAULT 0,
                    daily_points INTEGER DEFAULT 0,
                    daily_points_date TEXT,
                    message_count INTEGER DEFAULT 0,
                    last_message_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS activity_fingerprints (
                    telegram_id INTEGER NOT NULL,
                    activity_date TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (telegram_id, activity_date, fingerprint)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS weekly_points_archive (
                    telegram_id INTEGER NOT NULL,
                    week_key TEXT NOT NULL,
                    points INTEGER DEFAULT 0,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (telegram_id, week_key)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS weekly_reward_runs (
                    week_key TEXT PRIMARY KEY,
                    settled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    winners_count INTEGER DEFAULT 0,
                    summary_json TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS weekly_reward_payouts (
                    week_key TEXT NOT NULL,
                    telegram_id INTEGER NOT NULL,
                    rank INTEGER DEFAULT 0,
                    username TEXT,
                    points_bonus INTEGER DEFAULT 0,
                    pro_days INTEGER DEFAULT 0,
                    supabase_user_id TEXT,
                    pro_granted INTEGER DEFAULT 0,
                    pro_error TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (week_key, telegram_id)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS user_growth_snapshots (
                    snapshot_date TEXT PRIMARY KEY,
                    total_registered INTEGER NOT NULL DEFAULT 0,
                    verified_users INTEGER NOT NULL DEFAULT 0,
                    ever_signed_in INTEGER NOT NULL DEFAULT 0,
                    source TEXT NOT NULL DEFAULT 'supabase_auth_admin',
                    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS growth_milestone_runs (
                    milestone INTEGER PRIMARY KEY,
                    verified_users INTEGER NOT NULL DEFAULT 0,
                    reward_days INTEGER NOT NULL DEFAULT 0,
                    rewarded_count INTEGER NOT NULL DEFAULT 0,
                    failed_count INTEGER NOT NULL DEFAULT 0,
                    summary_json TEXT,
                    settled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS growth_milestone_payouts (
                    milestone INTEGER NOT NULL,
                    supabase_user_id TEXT NOT NULL,
                    reward_days INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT '',
                    error TEXT NOT NULL DEFAULT '',
                    expires_at TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (milestone, supabase_user_id)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS payment_runtime_state (
                    state_key TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS runtime_secrets (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    updated_by TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS city_summary_cache (
                    city TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    updated_at_ts REAL NOT NULL,
                    version TEXT,
                    source_fingerprint TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS city_panel_cache (
                    city TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    updated_at_ts REAL NOT NULL,
                    version TEXT,
                    source_fingerprint TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS city_nearby_cache (
                    city TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    updated_at_ts REAL NOT NULL,
                    version TEXT,
                    source_fingerprint TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS city_market_cache (
                    city TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    updated_at_ts REAL NOT NULL,
                    version TEXT,
                    source_fingerprint TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS city_full_cache (
                    city TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    updated_at_ts REAL NOT NULL,
                    version TEXT,
                    source_fingerprint TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS canonical_temperature_latest (
                    city TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    value REAL,
                    source TEXT,
                    source_role TEXT,
                    observed_at TEXT,
                    fetched_at TEXT,
                    freshness_sec INTEGER,
                    freshness_status TEXT,
                    confidence REAL,
                    explanation TEXT,
                    updated_at TEXT NOT NULL,
                    updated_at_ts REAL NOT NULL
                )
            """)
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_canonical_temperature_latest_updated
                ON canonical_temperature_latest(updated_at_ts DESC)
                """
            )
            conn.execute("""
                CREATE TABLE IF NOT EXISTS raw_observation_store (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source TEXT NOT NULL,
                    city TEXT NOT NULL,
                    station_code TEXT NOT NULL DEFAULT '',
                    station_name TEXT NOT NULL DEFAULT '',
                    runway TEXT NOT NULL DEFAULT '',
                    value REAL,
                    value_unit TEXT NOT NULL DEFAULT '',
                    observed_at TEXT,
                    fetched_at TEXT NOT NULL,
                    source_latency_sec REAL,
                    status TEXT NOT NULL DEFAULT 'ok',
                    error_count INTEGER NOT NULL DEFAULT 0,
                    last_success_at TEXT,
                    payload_json TEXT NOT NULL,
                    created_at_ts REAL NOT NULL
                )
            """)
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_raw_observation_store_source_city_time
                ON raw_observation_store(source, city, observed_at DESC, fetched_at DESC)
                """
            )
            conn.execute("""
                CREATE TABLE IF NOT EXISTS raw_observation_latest (
                    source TEXT NOT NULL,
                    city TEXT NOT NULL,
                    station_code TEXT NOT NULL DEFAULT '',
                    station_name TEXT NOT NULL DEFAULT '',
                    runway TEXT NOT NULL DEFAULT '',
                    value REAL,
                    value_unit TEXT NOT NULL DEFAULT '',
                    observed_at TEXT,
                    fetched_at TEXT NOT NULL,
                    source_latency_sec REAL,
                    status TEXT NOT NULL DEFAULT 'ok',
                    error_count INTEGER NOT NULL DEFAULT 0,
                    last_success_at TEXT,
                    payload_json TEXT NOT NULL,
                    updated_at_ts REAL NOT NULL,
                    PRIMARY KEY (source, city, station_code, runway)
                )
            """)
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_raw_observation_latest_city_source
                ON raw_observation_latest(city, source, updated_at_ts DESC)
                """
            )
            conn.execute("""
                CREATE TABLE IF NOT EXISTS observation_refresh_requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    city TEXT NOT NULL,
                    kind TEXT NOT NULL DEFAULT '',
                    source TEXT NOT NULL DEFAULT '',
                    priority TEXT NOT NULL DEFAULT 'normal',
                    reason TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'pending',
                    attempts INTEGER NOT NULL DEFAULT 0,
                    owner TEXT NOT NULL DEFAULT '',
                    requested_at TEXT NOT NULL,
                    requested_at_ts REAL NOT NULL,
                    claimed_at_ts REAL,
                    completed_at_ts REAL,
                    last_error TEXT NOT NULL DEFAULT ''
                )
            """)
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_observation_refresh_requests_status
                ON observation_refresh_requests(status, priority, requested_at_ts)
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_observation_refresh_requests_city
                ON observation_refresh_requests(city, kind, status)
                """
            )
            conn.execute("""
                CREATE TABLE IF NOT EXISTS cache_refresh_locks (
                    cache_key TEXT PRIMARY KEY,
                    locked_until_ts REAL NOT NULL,
                    owner TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS payment_audit_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_payment_audit_events_created_at ON payment_audit_events(created_at DESC)"
            )
            conn.execute("""
                CREATE TABLE IF NOT EXISTS ops_audit_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    action TEXT NOT NULL,
                    actor_email TEXT NOT NULL DEFAULT '',
                    target_user_id TEXT NOT NULL DEFAULT '',
                    target_email TEXT NOT NULL DEFAULT '',
                    target_type TEXT NOT NULL DEFAULT '',
                    target_id TEXT NOT NULL DEFAULT '',
                    payload_json TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_ops_audit_events_created_at
                ON ops_audit_events(created_at DESC)
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_ops_audit_events_action_created_at
                ON ops_audit_events(action, created_at DESC)
                """
            )
            conn.execute("""
                CREATE TABLE IF NOT EXISTS points_ledger (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    telegram_id INTEGER,
                    supabase_user_id TEXT NOT NULL DEFAULT '',
                    supabase_email TEXT NOT NULL DEFAULT '',
                    source TEXT NOT NULL,
                    delta_points INTEGER NOT NULL,
                    balance_after INTEGER NOT NULL,
                    actor_email TEXT NOT NULL DEFAULT '',
                    reference_type TEXT NOT NULL DEFAULT '',
                    reference_id TEXT NOT NULL DEFAULT '',
                    metadata_json TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_points_ledger_user_created_at
                ON points_ledger(supabase_user_id, supabase_email, created_at DESC)
                """
            )
            conn.execute("""
                CREATE TABLE IF NOT EXISTS payment_refund_cases (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    status TEXT NOT NULL DEFAULT 'open',
                    reason TEXT NOT NULL,
                    intent_id TEXT NOT NULL DEFAULT '',
                    tx_hash TEXT NOT NULL DEFAULT '',
                    user_id TEXT NOT NULL DEFAULT '',
                    amount_usdc TEXT NOT NULL DEFAULT '',
                    created_by TEXT NOT NULL DEFAULT '',
                    handled_by TEXT NOT NULL DEFAULT '',
                    notes_json TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_payment_refund_cases_status_created_at
                ON payment_refund_cases(status, created_at DESC)
                """
            )
            conn.execute("""
                CREATE TABLE IF NOT EXISTS observation_patch_events (
                    revision INTEGER PRIMARY KEY AUTOINCREMENT,
                    schema_type TEXT NOT NULL,
                    schema_version INTEGER NOT NULL,
                    city TEXT NOT NULL,
                    source TEXT NOT NULL,
                    obs_time TEXT,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            """)
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_observation_patch_events_city_revision
                ON observation_patch_events(city, revision)
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_observation_patch_events_created_at
                ON observation_patch_events(created_at)
                """
            )
            conn.execute("""
                CREATE TABLE IF NOT EXISTS app_analytics_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    user_id TEXT,
                    client_id TEXT,
                    session_id TEXT,
                    payload_json TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_app_analytics_events_created_at ON app_analytics_events(created_at DESC)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_app_analytics_events_type_created_at ON app_analytics_events(event_type, created_at DESC)"
            )
            conn.execute("""
                CREATE TABLE IF NOT EXISTS user_feedback (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    category TEXT NOT NULL,
                    message TEXT NOT NULL,
                    source TEXT NOT NULL DEFAULT 'terminal',
                    status TEXT NOT NULL DEFAULT 'open',
                    contact TEXT,
                    user_id TEXT,
                    user_email TEXT,
                    context_json TEXT NOT NULL,
                    reward_points INTEGER DEFAULT 0,
                    reward_reason TEXT DEFAULT '',
                    rewarded_at TIMESTAMP,
                    reward_status TEXT DEFAULT '',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_user_feedback_status_created_at ON user_feedback(status, created_at DESC)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_user_feedback_created_at ON user_feedback(created_at DESC)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_user_feedback_user_created_at ON user_feedback(user_id, created_at DESC)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_user_feedback_email_created_at ON user_feedback(user_email, created_at DESC)"
            )
            conn.execute("""
                CREATE TABLE IF NOT EXISTS supabase_bindings (
                    supabase_user_id TEXT PRIMARY KEY,
                    telegram_id INTEGER NOT NULL,
                    supabase_email TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_supabase_bindings_telegram_id ON supabase_bindings(telegram_id)"
            )
            conn.execute("""
                CREATE TABLE IF NOT EXISTS telegram_bind_tokens (
                    token TEXT PRIMARY KEY,
                    telegram_id INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP NOT NULL
                )
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_telegram_bind_tokens_expires ON telegram_bind_tokens(expires_at)"
            )
            conn.execute("""
                CREATE TABLE IF NOT EXISTS web_telegram_bind_tokens (
                    token TEXT PRIMARY KEY,
                    supabase_user_id TEXT NOT NULL,
                    supabase_email TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP NOT NULL
                )
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_web_telegram_bind_tokens_expires ON web_telegram_bind_tokens(expires_at)"
            )
            conn.execute("""
                CREATE TABLE IF NOT EXISTS airport_obs_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    icao TEXT NOT NULL,
                    city TEXT NOT NULL,
                    temp_c REAL,
                    wind_kt REAL,
                    pressure_hpa REAL,
                    obs_time TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_airport_obs_log_icao_time ON airport_obs_log(icao, created_at DESC)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS runway_obs_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    icao TEXT NOT NULL,
                    city TEXT NOT NULL,
                    runway TEXT NOT NULL,
                    tdz_temp REAL,
                    mid_temp REAL,
                    end_temp REAL,
                    target_runway_max REAL,
                    wind_dir INTEGER,
                    wind_speed REAL,
                    rvr INTEGER,
                    mor REAL,
                    humidity REAL,
                    otime_utc TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_runway_obs_log_icao_otime "
                "ON runway_obs_log(icao, otime_utc DESC)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_runway_obs_log_city_time "
                "ON runway_obs_log(city, created_at DESC)"
            )
            self._ensure_column(conn, "users", "daily_points", "INTEGER DEFAULT 0")
            self._ensure_column(conn, "users", "daily_points_date", "TEXT")
            self._ensure_column(conn, "users", "weekly_points", "INTEGER DEFAULT 0")
            self._ensure_column(conn, "users", "weekly_points_week", "TEXT")
            self._ensure_column(conn, "users", "supabase_user_id", "TEXT")
            self._ensure_column(conn, "users", "supabase_email", "TEXT")
            self._ensure_column(conn, "users", "welcome_bonus_claimed", "INTEGER DEFAULT 0")
            self._ensure_column(conn, "users", "daily_city_queries", "INTEGER DEFAULT 0")
            self._ensure_column(conn, "users", "daily_deb_queries", "INTEGER DEFAULT 0")
            self._ensure_column(conn, "users", "daily_queries_date", "TEXT")
            self._ensure_column(conn, "user_feedback", "reward_points", "INTEGER DEFAULT 0")
            self._ensure_column(conn, "user_feedback", "reward_reason", "TEXT DEFAULT ''")
            self._ensure_column(conn, "user_feedback", "rewarded_at", "TIMESTAMP")
            self._ensure_column(conn, "user_feedback", "reward_status", "TEXT DEFAULT ''")
            # Migrate legacy one-to-one binding column into mapping table.
            conn.execute(
                """
                INSERT OR IGNORE INTO supabase_bindings (
                    supabase_user_id, telegram_id, supabase_email, created_at, updated_at
                )
                SELECT
                    lower(trim(COALESCE(supabase_user_id, ''))),
                    telegram_id,
                    COALESCE(supabase_email, ''),
                    CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP
                FROM users
                WHERE trim(COALESCE(supabase_user_id, '')) <> ''
                """
            )
            conn.commit()
            logger.info(f"Database initialized successfully path={self.db_path}")

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
        table = self._cache_table_name(kind)
        normalized_city = str(city or "").strip().lower()
        if not table or not normalized_city:
            return None
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                f"""
                SELECT city, payload_json, updated_at, updated_at_ts, version, source_fingerprint
                FROM {table}
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
            "updated_at": str(row["updated_at"] or ""),
            "updated_at_ts": float(row["updated_at_ts"] or 0.0),
            "version": str(row["version"] or ""),
            "source_fingerprint": str(row["source_fingerprint"] or ""),
        }

    def set_city_cache(
        self,
        kind: str,
        city: str,
        payload: Dict[str, Any],
        *,
        version: str = "v1",
        source_fingerprint: Optional[str] = None,
    ) -> None:
        table = self._cache_table_name(kind)
        normalized_city = str(city or "").strip().lower()
        if not table or not normalized_city or not isinstance(payload, dict):
            return
        now = datetime.now().isoformat()
        now_ts = datetime.now().timestamp()
        with self._get_connection() as conn:
            conn.execute(
                f"""
                INSERT INTO {table} (
                    city,
                    payload_json,
                    updated_at,
                    updated_at_ts,
                    version,
                    source_fingerprint
                )
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(city) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    updated_at = excluded.updated_at,
                    updated_at_ts = excluded.updated_at_ts,
                    version = excluded.version,
                    source_fingerprint = excluded.source_fingerprint
                """,
                (
                    normalized_city,
                    json.dumps(payload, ensure_ascii=False),
                    now,
                    now_ts,
                    str(version or "v1"),
                    str(source_fingerprint or ""),
                ),
            )
            conn.commit()

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

    def acquire_cache_refresh_lock(
        self,
        cache_key: str,
        *,
        ttl_sec: int = 120,
        owner: Optional[str] = None,
    ) -> Optional[str]:
        normalized_key = str(cache_key or "").strip().lower()
        if not normalized_key:
            return None
        lock_owner = str(owner or "").strip() or hashlib.sha1(
            f"{normalized_key}:{datetime.now().timestamp()}".encode("utf-8")
        ).hexdigest()[:12]
        now_ts = datetime.now().timestamp()
        locked_until_ts = now_ts + max(15, int(ttl_sec or 120))
        updated_at = datetime.now().isoformat()
        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO cache_refresh_locks (cache_key, locked_until_ts, owner, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(cache_key) DO UPDATE SET
                    locked_until_ts = excluded.locked_until_ts,
                    owner = excluded.owner,
                    updated_at = excluded.updated_at
                WHERE cache_refresh_locks.locked_until_ts < ?
                """,
                (
                    normalized_key,
                    locked_until_ts,
                    lock_owner,
                    updated_at,
                    now_ts,
                ),
            )
            conn.commit()
        return lock_owner if int(cursor.rowcount or 0) > 0 else None

    def release_cache_refresh_lock(self, cache_key: str, owner: str) -> None:
        normalized_key = str(cache_key or "").strip().lower()
        normalized_owner = str(owner or "").strip()
        if not normalized_key or not normalized_owner:
            return
        with self._get_connection() as conn:
            conn.execute(
                """
                DELETE FROM cache_refresh_locks
                WHERE cache_key = ? AND owner = ?
                """,
                (normalized_key, normalized_owner),
            )
            conn.commit()

    def get_payment_runtime_state(self, state_key: str) -> Optional[Dict[str, Any]]:
        key = str(state_key or "").strip()
        if not key:
            return None
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT payload_json
                FROM payment_runtime_state
                WHERE state_key = ?
                LIMIT 1
                """,
                (key,),
            ).fetchone()
            if not row:
                return None
            try:
                payload = json.loads(str(row["payload_json"] or "{}"))
            except Exception:
                return None
            return payload if isinstance(payload, dict) else None

    def set_payment_runtime_state(self, state_key: str, payload: Dict[str, Any]) -> None:
        key = str(state_key or "").strip()
        if not key:
            return
        body = payload if isinstance(payload, dict) else {}
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO payment_runtime_state (state_key, payload_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(state_key) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    updated_at = excluded.updated_at
                """,
                (key, json.dumps(body, ensure_ascii=False), datetime.now().isoformat()),
            )
            conn.commit()

    @staticmethod
    def _mask_secret_value(value: str) -> str:
        text = str(value or "")
        if not text:
            return ""
        if len(text) <= 8:
            return "***"
        return f"{text[:4]}...{text[-4:]}"

    def get_runtime_secret(self, key: str) -> Optional[str]:
        normalized_key = str(key or "").strip()
        if not normalized_key:
            return None
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT value
                FROM runtime_secrets
                WHERE key = ?
                LIMIT 1
                """,
                (normalized_key,),
            ).fetchone()
        if not row:
            return None
        value = str(row["value"] or "")
        return value if value else None

    def get_runtime_secret_metadata(self, key: str) -> Dict[str, Any]:
        normalized_key = str(key or "").strip()
        if not normalized_key:
            return {
                "key": "",
                "configured": False,
                "masked": "",
                "updated_at": "",
                "updated_by": "",
                "source": "runtime_store",
            }
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT key, value, updated_at, updated_by
                FROM runtime_secrets
                WHERE key = ?
                LIMIT 1
                """,
                (normalized_key,),
            ).fetchone()
        if not row:
            return {
                "key": normalized_key,
                "configured": False,
                "masked": "",
                "updated_at": "",
                "updated_by": "",
                "source": "runtime_store",
            }
        value = str(row["value"] or "")
        return {
            "key": normalized_key,
            "configured": bool(value),
            "masked": self._mask_secret_value(value),
            "length": len(value),
            "updated_at": str(row["updated_at"] or ""),
            "updated_by": str(row["updated_by"] or ""),
            "source": "runtime_store",
        }

    def set_runtime_secret(
        self,
        key: str,
        value: str,
        *,
        updated_by: Optional[str] = None,
    ) -> Dict[str, Any]:
        normalized_key = str(key or "").strip()
        secret_value = str(value or "").strip()
        if not normalized_key:
            raise ValueError("runtime secret key is required")
        if not secret_value:
            raise ValueError("runtime secret value is required")
        now = datetime.now().isoformat()
        operator = str(updated_by or "").strip()
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO runtime_secrets (key, value, updated_at, updated_by)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at,
                    updated_by = excluded.updated_by
                """,
                (normalized_key, secret_value, now, operator),
            )
            conn.commit()
        return self.get_runtime_secret_metadata(normalized_key)

    def append_payment_audit_event(self, event_type: str, payload: Dict[str, Any]) -> None:
        kind = str(event_type or "").strip().lower()
        if not kind:
            return
        body = payload if isinstance(payload, dict) else {}
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO payment_audit_events (event_type, payload_json, created_at)
                VALUES (?, ?, ?)
                """,
                (kind, json.dumps(body, ensure_ascii=False), datetime.now().isoformat()),
            )
            conn.commit()

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
        with self._get_connection() as conn:
            self._append_points_ledger_entry_conn(
                conn,
                telegram_id=telegram_id,
                supabase_user_id=supabase_user_id,
                supabase_email=supabase_email,
                source=source,
                delta_points=delta_points,
                balance_after=balance_after,
                actor_email=actor_email,
                reference_type=reference_type,
                reference_id=reference_id,
                metadata=metadata,
            )
            conn.commit()

    def list_points_ledger_entries(
        self,
        *,
        limit: int = 20,
        supabase_user_id: str = "",
        supabase_email: str = "",
    ) -> List[Dict[str, Any]]:
        safe_limit = max(1, min(int(limit or 20), 200))
        normalized_user_id = str(supabase_user_id or "").strip().lower()
        normalized_email = str(supabase_email or "").strip().lower()
        if not normalized_user_id and not normalized_email:
            return []
        clauses: List[str] = []
        params: List[Any] = []
        if normalized_user_id:
            clauses.append("supabase_user_id = ?")
            params.append(normalized_user_id)
        if normalized_email:
            clauses.append("supabase_email = ?")
            params.append(normalized_email)
        where_sql = f"WHERE {' OR '.join(clauses)}" if clauses else ""
        params.append(safe_limit)
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                f"""
                SELECT id, telegram_id, supabase_user_id, supabase_email, source,
                       delta_points, balance_after, actor_email, reference_type,
                       reference_id, metadata_json, created_at
                FROM points_ledger
                {where_sql}
                ORDER BY id DESC
                LIMIT ?
                """,
                tuple(params),
            ).fetchall()
        out: List[Dict[str, Any]] = []
        for row in rows:
            try:
                metadata = json.loads(str(row["metadata_json"] or "{}"))
            except Exception:
                metadata = {}
            out.append(
                {
                    "id": int(row["id"]),
                    "telegram_id": row["telegram_id"],
                    "supabase_user_id": str(row["supabase_user_id"] or ""),
                    "supabase_email": str(row["supabase_email"] or ""),
                    "source": str(row["source"] or ""),
                    "delta_points": int(row["delta_points"] or 0),
                    "balance_after": int(row["balance_after"] or 0),
                    "actor_email": str(row["actor_email"] or ""),
                    "reference_type": str(row["reference_type"] or ""),
                    "reference_id": str(row["reference_id"] or ""),
                    "metadata": metadata if isinstance(metadata, dict) else {},
                    "created_at": row["created_at"],
                }
            )
        return out

    def get_points_ledger_summary(
        self,
        *,
        supabase_user_id: str = "",
        supabase_email: str = "",
        limit: int = 20,
    ) -> Dict[str, Any]:
        recent = self.list_points_ledger_entries(
            limit=limit,
            supabase_user_id=supabase_user_id,
            supabase_email=supabase_email,
        )
        by_source: Dict[str, Dict[str, int]] = {}
        for row in recent:
            source = str(row.get("source") or "unknown")
            bucket = by_source.setdefault(source, {"points": 0, "count": 0})
            bucket["points"] += int(row.get("delta_points") or 0)
            bucket["count"] += 1
        balance = int(recent[0]["balance_after"]) if recent else (
            self.get_points_by_supabase_user_id(supabase_user_id)
            if supabase_user_id
            else self.get_points_by_supabase_email(supabase_email)
        )
        return {
            "balance": max(0, balance),
            "recent": recent,
            "by_source": by_source,
        }

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
        normalized_reason = str(reason or "").strip().lower()
        if not normalized_reason:
            return {"ok": False, "reason": "invalid_refund_reason"}
        now = datetime.now().isoformat()
        notes = []
        note_text = str(note or "").strip()
        if note_text:
            notes.append(
                {
                    "note": note_text,
                    "by": str(created_by or "").strip().lower(),
                    "at": now,
                }
            )
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                """
                INSERT INTO payment_refund_cases (
                    status,
                    reason,
                    intent_id,
                    tx_hash,
                    user_id,
                    amount_usdc,
                    created_by,
                    handled_by,
                    notes_json,
                    created_at,
                    updated_at
                )
                VALUES ('open', ?, ?, ?, ?, ?, ?, '', ?, ?, ?)
                """,
                (
                    normalized_reason,
                    str(intent_id or "").strip(),
                    str(tx_hash or "").strip().lower(),
                    str(user_id or "").strip().lower(),
                    str(amount_usdc or "").strip(),
                    str(created_by or "").strip().lower(),
                    json.dumps(notes, ensure_ascii=False, default=str),
                    now,
                    now,
                ),
            )
            case_id = int(cursor.lastrowid)
            row = conn.execute(
                """
                SELECT id, status, reason, intent_id, tx_hash, user_id,
                       amount_usdc, created_by, handled_by, notes_json,
                       created_at, updated_at
                FROM payment_refund_cases
                WHERE id = ?
                """,
                (case_id,),
            ).fetchone()
            conn.commit()
        return self._refund_case_row_to_dict(row)

    def update_refund_case(
        self,
        case_id: int,
        *,
        status: str,
        handled_by: str = "",
        note: str = "",
    ) -> Optional[Dict[str, Any]]:
        safe_id = int(case_id or 0)
        normalized_status = str(status or "").strip().lower()
        allowed = {"open", "processing", "refunded", "rejected", "closed"}
        if safe_id <= 0 or normalized_status not in allowed:
            return None
        now = datetime.now().isoformat()
        actor = str(handled_by or "").strip().lower()
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT notes_json
                FROM payment_refund_cases
                WHERE id = ?
                LIMIT 1
                """,
                (safe_id,),
            ).fetchone()
            if not row:
                return None
            try:
                notes = json.loads(str(row["notes_json"] or "[]"))
            except Exception:
                notes = []
            if not isinstance(notes, list):
                notes = []
            note_text = str(note or "").strip()
            if note_text:
                notes.append({"note": note_text, "by": actor, "at": now})
            conn.execute(
                """
                UPDATE payment_refund_cases
                SET status = ?,
                    handled_by = ?,
                    notes_json = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    normalized_status,
                    actor,
                    json.dumps(notes, ensure_ascii=False, default=str),
                    now,
                    safe_id,
                ),
            )
            updated = conn.execute(
                """
                SELECT id, status, reason, intent_id, tx_hash, user_id,
                       amount_usdc, created_by, handled_by, notes_json,
                       created_at, updated_at
                FROM payment_refund_cases
                WHERE id = ?
                """,
                (safe_id,),
            ).fetchone()
            conn.commit()
        return self._refund_case_row_to_dict(updated)

    def list_refund_cases(
        self,
        *,
        limit: int = 50,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        safe_limit = max(1, min(int(limit or 50), 200))
        normalized_status = str(status or "").strip().lower()
        params: List[Any] = []
        where_sql = ""
        if normalized_status:
            where_sql = "WHERE status = ?"
            params.append(normalized_status)
        params.append(safe_limit)
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                f"""
                SELECT id, status, reason, intent_id, tx_hash, user_id,
                       amount_usdc, created_by, handled_by, notes_json,
                       created_at, updated_at
                FROM payment_refund_cases
                {where_sql}
                ORDER BY id DESC
                LIMIT ?
                """,
                tuple(params),
            ).fetchall()
        return [self._refund_case_row_to_dict(row) for row in rows]

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
        safe_limit = max(1, min(int(limit or 50), 500))
        kind = str(event_type or "").strip().lower()
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            if kind:
                rows = conn.execute(
                    """
                    SELECT id, event_type, payload_json, created_at
                    FROM payment_audit_events
                    WHERE event_type = ?
                    ORDER BY id DESC
                    LIMIT ?
                    """,
                    (kind, safe_limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT id, event_type, payload_json, created_at
                    FROM payment_audit_events
                    ORDER BY id DESC
                    LIMIT ?
                    """,
                    (safe_limit,),
                ).fetchall()
            out = []
            for row in rows:
                try:
                    payload = json.loads(str(row["payload_json"] or "{}"))
                except Exception:
                    payload = {}
                out.append(
                    {
                        "id": int(row["id"]),
                        "event_type": str(row["event_type"] or ""),
                        "payload": payload if isinstance(payload, dict) else {},
                        "created_at": row["created_at"],
                    }
                )
            return out

    def mark_payment_audit_event_resolved(
        self,
        event_id: int,
        resolved_by: str,
    ) -> Optional[Dict[str, Any]]:
        safe_id = int(event_id or 0)
        actor = str(resolved_by or "").strip().lower()
        if safe_id <= 0 or not actor:
            return None
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT id, event_type, payload_json, created_at
                FROM payment_audit_events
                WHERE id = ?
                LIMIT 1
                """,
                (safe_id,),
            ).fetchone()
            if not row:
                return None
            try:
                payload = json.loads(str(row["payload_json"] or "{}"))
            except Exception:
                payload = {}
            if not isinstance(payload, dict):
                payload = {}
            payload["resolved_at"] = datetime.now().isoformat()
            payload["resolved_by"] = actor
            conn.execute(
                """
                UPDATE payment_audit_events
                SET payload_json = ?
                WHERE id = ?
                """,
                (json.dumps(payload, ensure_ascii=False), safe_id),
            )
            conn.commit()
            return {
                "id": int(row["id"]),
                "event_type": str(row["event_type"] or ""),
                "payload": payload,
                "created_at": row["created_at"],
            }

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
        safe_id = int(event_id or 0)
        actor = str(resolved_by or "").strip().lower()
        if safe_id <= 0 or not actor:
            return []

        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            target = conn.execute(
                """
                SELECT id, event_type, payload_json, created_at
                FROM payment_audit_events
                WHERE id = ?
                LIMIT 1
                """,
                (safe_id,),
            ).fetchone()
            if not target:
                return []

            try:
                target_payload = json.loads(str(target["payload_json"] or "{}"))
            except Exception:
                target_payload = {}
            if not isinstance(target_payload, dict):
                target_payload = {}

            target_key = self._payment_audit_resolution_key(
                str(target["event_type"] or ""),
                target_payload,
            )
            if not (target_key[3] or target_key[4]):
                single = self.mark_payment_audit_event_resolved(safe_id, actor)
                return [single] if single else []

            rows = conn.execute(
                """
                SELECT id, event_type, payload_json, created_at
                FROM payment_audit_events
                WHERE event_type = ?
                ORDER BY id DESC
                """,
                (str(target["event_type"] or ""),),
            ).fetchall()

            resolved_at = datetime.now().isoformat()
            resolved_rows: List[Dict[str, Any]] = []
            for row in rows:
                try:
                    payload = json.loads(str(row["payload_json"] or "{}"))
                except Exception:
                    payload = {}
                if not isinstance(payload, dict):
                    payload = {}
                if str(payload.get("resolved_at") or "").strip():
                    continue
                if self._payment_audit_resolution_key(
                    str(row["event_type"] or ""),
                    payload,
                ) != target_key:
                    continue

                payload["resolved_at"] = resolved_at
                payload["resolved_by"] = actor
                conn.execute(
                    """
                    UPDATE payment_audit_events
                    SET payload_json = ?
                    WHERE id = ?
                    """,
                    (json.dumps(payload, ensure_ascii=False), int(row["id"])),
                )
                resolved_rows.append(
                    {
                        "id": int(row["id"]),
                        "event_type": str(row["event_type"] or ""),
                        "payload": payload,
                        "created_at": row["created_at"],
                    }
                )

            conn.commit()
            return resolved_rows

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
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute("SELECT * FROM users WHERE telegram_id = ?", (telegram_id,))
            row = cursor.fetchone()
            if row:
                user = dict(row)
                now = datetime.now()
                if user['web_expiry']:
                    expiry = datetime.fromisoformat(user['web_expiry'])
                    if expiry < now:
                        user['is_web_premium'] = False
                if user['group_expiry']:
                    expiry = datetime.fromisoformat(user['group_expiry'])
                    if expiry < now:
                        user['is_group_premium'] = False
                return user
        return None

    def get_user_by_supabase_user_id(self, supabase_user_id: str) -> Optional[Dict[str, Any]]:
        key = str(supabase_user_id or "").strip().lower()
        if not key:
            return None
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            telegram_id = self._find_telegram_id_by_supabase_user_id(conn, key)
            if telegram_id is None:
                return None
            row = conn.execute(
                """
                SELECT *
                FROM users
                WHERE telegram_id = ?
                LIMIT 1
                """,
                (int(telegram_id),),
            ).fetchone()
            if row:
                return dict(row)
        return None

    def list_supabase_user_ids_for_telegram(self, telegram_id: int) -> List[str]:
        """Return all Supabase accounts currently bound to a Telegram user."""
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT supabase_user_id
                FROM supabase_bindings
                WHERE telegram_id = ?
                ORDER BY updated_at DESC, supabase_user_id ASC
                """,
                (int(telegram_id),),
            ).fetchall()
            ids = {
                str(row["supabase_user_id"] or "").strip().lower()
                for row in rows
                if str(row["supabase_user_id"] or "").strip()
            }
            legacy = conn.execute(
                """
                SELECT supabase_user_id
                FROM users
                WHERE telegram_id = ?
                LIMIT 1
                """,
                (int(telegram_id),),
            ).fetchone()
            legacy_id = str((legacy["supabase_user_id"] if legacy else "") or "").strip().lower()
            if legacy_id:
                ids.add(legacy_id)
            return sorted(ids)

    def search_users(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        text = str(query or "").strip()
        safe_limit = max(1, min(int(limit or 20), 100))
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            if not text:
                rows = conn.execute(
                    """
                    SELECT
                        telegram_id,
                        username,
                        points,
                        daily_points,
                        daily_points_date,
                        weekly_points,
                        weekly_points_week,
                        message_count,
                        supabase_user_id,
                        supabase_email,
                        created_at,
                        last_message_at
                    FROM users
                    ORDER BY points DESC, message_count DESC, telegram_id ASC
                    LIMIT ?
                    """,
                    (safe_limit,),
                ).fetchall()
                return [dict(row) for row in rows]

            rows = conn.execute(
                """
                SELECT
                    telegram_id,
                    username,
                    points,
                    daily_points,
                    daily_points_date,
                    weekly_points,
                    weekly_points_week,
                    message_count,
                    supabase_user_id,
                    supabase_email,
                    created_at,
                    last_message_at
                FROM users
                WHERE
                    CAST(telegram_id AS TEXT) = ?
                    OR lower(trim(COALESCE(username, ''))) LIKE ?
                    OR lower(trim(COALESCE(supabase_email, ''))) LIKE ?
                ORDER BY points DESC, message_count DESC, telegram_id ASC
                LIMIT ?
                """,
                (
                    text,
                    f"%{text.lower()}%",
                    f"%{text.lower()}%",
                    safe_limit,
                ),
            ).fetchall()
            return [dict(row) for row in rows]

    def get_users_by_supabase_user_ids(
        self,
        supabase_user_ids: List[str],
    ) -> Dict[str, Dict[str, Any]]:
        keys = [
            str(item or "").strip().lower()
            for item in (supabase_user_ids or [])
            if str(item or "").strip()
        ]
        if not keys:
            return {}
        placeholders = ",".join("?" for _ in keys)
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                f"""
                SELECT
                    lower(trim(COALESCE(supabase_user_id, ''))) AS supabase_user_id,
                    telegram_id,
                    username,
                    supabase_email,
                    created_at,
                    points,
                    weekly_points,
                    message_count
                FROM users
                WHERE lower(trim(COALESCE(supabase_user_id, ''))) IN ({placeholders})
                """,
                tuple(keys),
            ).fetchall()
            return {
                str(row["supabase_user_id"] or "").strip().lower(): dict(row)
                for row in rows
                if str(row["supabase_user_id"] or "").strip()
            }

    def get_points_by_supabase_user_id(self, supabase_user_id: str) -> int:
        user = self.get_user_by_supabase_user_id(supabase_user_id)
        if not user:
            return 0
        try:
            return max(0, int(user.get("points") or 0))
        except Exception:
            return 0

    def get_points_by_supabase_email(self, supabase_email: str) -> int:
        email = str(supabase_email or "").strip().lower()
        if not email:
            return 0
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT points
                FROM users
                WHERE lower(trim(COALESCE(supabase_email, ''))) = ?
                LIMIT 1
                """,
                (email,),
            ).fetchone()
            if not row:
                row = conn.execute(
                    """
                    SELECT u.points
                    FROM users u
                    JOIN supabase_bindings b ON b.telegram_id = u.telegram_id
                    WHERE lower(trim(COALESCE(b.supabase_email, ''))) = ?
                    LIMIT 1
                    """,
                    (email,),
                ).fetchone()
            if row:
                return max(0, int(row["points"] or 0))
        return 0

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
        email = str(supabase_email or "").strip().lower()
        points = int(amount or 0)
        if not email:
            return {"ok": False, "reason": "invalid_supabase_email"}
        if points <= 0:
            return {"ok": False, "reason": "invalid_amount"}

        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT telegram_id, username, points, supabase_email, supabase_user_id
                FROM users
                WHERE lower(trim(COALESCE(supabase_email, ''))) = ?
                LIMIT 1
                """,
                (email,),
            ).fetchone()
            if not row:
                return {"ok": False, "reason": "user_not_found", "supabase_email": email}

            telegram_id = int(row["telegram_id"] or 0)
            before = int(row["points"] or 0)
            after = before + points
            conn.execute(
                """
                UPDATE users
                SET points = ?
                WHERE telegram_id = ?
                """,
                (after, telegram_id),
            )
            self._append_points_ledger_entry_conn(
                conn,
                telegram_id=telegram_id,
                supabase_user_id=str(row["supabase_user_id"] or "").strip().lower(),
                supabase_email=str(row["supabase_email"] or email),
                source=source,
                delta_points=points,
                balance_after=after,
                actor_email=actor_email,
                reference_type=reference_type,
                reference_id=reference_id,
                metadata=metadata,
            )
            conn.commit()
            self._sync_points_to_supabase_user_metadata(telegram_id, force=True)
            return {
                "ok": True,
                "telegram_id": telegram_id,
                "username": str(row["username"] or ""),
                "supabase_email": str(row["supabase_email"] or email),
                "points_before": before,
                "points_added": points,
                "points_after": after,
            }

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
        key = str(supabase_user_id or "").strip().lower()
        points = int(amount or 0)
        if not key:
            return {"ok": False, "reason": "invalid_supabase_user_id"}
        if points <= 0:
            return {"ok": False, "reason": "invalid_amount"}

        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            telegram_id = self._find_telegram_id_by_supabase_user_id(conn, key)
            if telegram_id is None:
                return {"ok": False, "reason": "user_not_found", "supabase_user_id": key}
            row = conn.execute(
                """
                SELECT telegram_id, username, points, supabase_email
                FROM users
                WHERE telegram_id = ?
                LIMIT 1
                """,
                (int(telegram_id),),
            ).fetchone()
            if not row:
                return {"ok": False, "reason": "user_not_found", "supabase_user_id": key}

            telegram_id = int(row["telegram_id"] or 0)
            before = int(row["points"] or 0)
            after = before + points
            conn.execute(
                """
                UPDATE users
                SET points = ?
                WHERE telegram_id = ?
                """,
                (after, telegram_id),
            )
            self._append_points_ledger_entry_conn(
                conn,
                telegram_id=telegram_id,
                supabase_user_id=key,
                supabase_email=str(row["supabase_email"] or ""),
                source=source,
                delta_points=points,
                balance_after=after,
                actor_email=actor_email,
                reference_type=reference_type,
                reference_id=reference_id,
                metadata=metadata,
            )
            conn.commit()
            self._sync_points_to_supabase_user_metadata(telegram_id, force=True)
            return {
                "ok": True,
                "telegram_id": telegram_id,
                "username": str(row["username"] or ""),
                "supabase_user_id": key,
                "supabase_email": str(row["supabase_email"] or ""),
                "points_before": before,
                "points_added": points,
                "points_after": after,
            }

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
        email = str(supabase_email or "").strip().lower()
        points = int(amount or 0)
        if not email:
            return {"ok": False, "reason": "invalid_supabase_email"}
        if points <= 0:
            return {"ok": False, "reason": "invalid_amount"}

        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT telegram_id, username, points, supabase_email, supabase_user_id
                FROM users
                WHERE lower(trim(COALESCE(supabase_email, ''))) = ?
                LIMIT 1
                """,
                (email,),
            ).fetchone()
            if not row:
                return {"ok": False, "reason": "user_not_found", "supabase_email": email}

            telegram_id = int(row["telegram_id"] or 0)
            before = int(row["points"] or 0)
            if before < points:
                return {
                    "ok": False,
                    "reason": "insufficient_points",
                    "points_available": before,
                    "points_needed": points,
                }
            after = before - points
            conn.execute(
                "UPDATE users SET points = ? WHERE telegram_id = ?",
                (after, telegram_id),
            )
            self._append_points_ledger_entry_conn(
                conn,
                telegram_id=telegram_id,
                supabase_user_id=str(row["supabase_user_id"] or "").strip().lower(),
                supabase_email=str(row["supabase_email"] or email),
                source=source,
                delta_points=-points,
                balance_after=after,
                actor_email=actor_email,
                reference_type=reference_type,
                reference_id=reference_id,
                metadata=metadata,
            )
            conn.commit()
            self._sync_points_to_supabase_user_metadata(telegram_id, force=True)
            return {
                "ok": True,
                "telegram_id": telegram_id,
                "username": str(row["username"] or ""),
                "supabase_email": str(row["supabase_email"] or email),
                "points_before": before,
                "points_deducted": points,
                "points_after": after,
            }

    def transfer_points_by_email(
        self,
        from_email: str,
        to_email: str,
        amount: int,
    ) -> Dict[str, Any]:
        """Transfer points from one user to another within a single transaction."""
        r_from = self.deduct_points_by_supabase_email(from_email, amount)
        if not r_from.get("ok"):
            return {"ok": False, "reason": f"deduct_failed: {r_from.get('reason')}", "from": r_from}
        r_to = self.grant_points_by_supabase_email(to_email, amount)
        if not r_to.get("ok"):
            # Rollback: grant back to source
            self.grant_points_by_supabase_email(from_email, amount)
            return {"ok": False, "reason": f"grant_failed: {r_to.get('reason')}", "to": r_to}
        return {
            "ok": True,
            "from": r_from,
            "to": r_to,
            "amount": amount,
        }

    def upsert_user(self, telegram_id: int, username: str):
        with self._get_connection() as conn:
            conn.execute("""
                INSERT INTO users (telegram_id, username)
                VALUES (?, ?)
                ON CONFLICT(telegram_id) DO UPDATE SET
                username = excluded.username
            """, (telegram_id, username))
            conn.commit()
        self._sync_bound_supabase_profiles_for_telegram(
            telegram_id=int(telegram_id),
            telegram_username=username,
        )

    def bind_supabase_identity(
        self,
        telegram_id: int,
        supabase_user_id: str,
        supabase_email: str = "",
    ) -> Dict[str, Any]:
        """
        Bind Supabase account to Telegram account.

        Rules:
        - One supabase_user_id can only belong to one telegram_id.
        - One telegram_id can bind multiple supabase_user_id (shared points/profile).
        """
        normalized_uid = str(supabase_user_id or "").strip().lower()
        normalized_email = str(supabase_email or "").strip()
        if not normalized_uid:
            return {"ok": False, "reason": "invalid_supabase_user_id"}

        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row

            # Ensure current telegram user row exists.
            conn.execute(
                """
                INSERT INTO users (telegram_id, username)
                VALUES (?, COALESCE((SELECT username FROM users WHERE telegram_id = ?), ''))
                ON CONFLICT(telegram_id) DO NOTHING
                """,
                (telegram_id, telegram_id),
            )

            current_row = conn.execute(
                """
                SELECT telegram_id, supabase_user_id, supabase_email
                FROM users
                WHERE telegram_id = ?
                LIMIT 1
                """,
                (telegram_id,),
            ).fetchone()
            current_uid = str(
                (current_row["supabase_user_id"] if current_row else "") or ""
            ).strip().lower()

            owner_row = conn.execute(
                """
                SELECT telegram_id
                FROM supabase_bindings
                WHERE lower(trim(COALESCE(supabase_user_id, ''))) = ?
                LIMIT 1
                """,
                (normalized_uid,),
            ).fetchone()
            owner_telegram_id = int(owner_row["telegram_id"]) if owner_row else None

            if owner_telegram_id is not None and owner_telegram_id != int(telegram_id):
                return {
                    "ok": False,
                    "reason": "supabase_already_bound_other",
                    "owner_telegram_id": owner_telegram_id,
                }

            conn.execute(
                """
                INSERT INTO supabase_bindings (supabase_user_id, telegram_id, supabase_email, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(supabase_user_id) DO UPDATE SET
                    telegram_id = excluded.telegram_id,
                    supabase_email = excluded.supabase_email,
                    updated_at = excluded.updated_at
                """,
                (normalized_uid, int(telegram_id), normalized_email, datetime.now().isoformat()),
            )

            if current_uid == normalized_uid:
                # Keep idempotent bind behavior while allowing email refresh.
                conn.execute(
                    """
                    UPDATE users
                    SET supabase_email = ?
                    WHERE telegram_id = ?
                    """,
                    (normalized_email, telegram_id),
                )
                user_row = conn.execute(
                    """
                    SELECT username
                    FROM users
                    WHERE telegram_id = ?
                    LIMIT 1
                    """,
                    (telegram_id,),
                ).fetchone()
                conn.commit()
                self._sync_supabase_profile_telegram_fields(
                    supabase_user_id=normalized_uid,
                    telegram_id=int(telegram_id),
                    telegram_username=str((user_row["username"] if user_row else "") or "").strip(),
                    force=True,
                )
                return {"ok": True, "reason": "already_bound_same"}

            conn.execute(
                """
                UPDATE users
                SET supabase_user_id = ?, supabase_email = ?
                WHERE telegram_id = ?
                """,
                (normalized_uid, normalized_email, telegram_id),
            )
            user_row = conn.execute(
                """
                SELECT username
                FROM users
                WHERE telegram_id = ?
                LIMIT 1
                """,
                (telegram_id,),
            ).fetchone()
            conn.commit()
            self._sync_supabase_profile_telegram_fields(
                supabase_user_id=normalized_uid,
                telegram_id=int(telegram_id),
                telegram_username=str((user_row["username"] if user_row else "") or "").strip(),
                force=True,
            )
            return {"ok": True, "reason": "bound"}

    def unbind_supabase_identity(self, telegram_id: int) -> Dict[str, Any]:
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            current = conn.execute(
                """
                SELECT supabase_user_id
                FROM users
                WHERE telegram_id = ?
                LIMIT 1
                """,
                (telegram_id,),
            ).fetchone()
            current_uid = str((current["supabase_user_id"] if current else "") or "").strip()
            links = conn.execute(
                """
                SELECT supabase_user_id
                FROM supabase_bindings
                WHERE telegram_id = ?
                """,
                (int(telegram_id),),
            ).fetchall()
            linked_user_ids = {
                str((row["supabase_user_id"] if row else "") or "").strip().lower()
                for row in links
            }
            if current_uid:
                linked_user_ids.add(current_uid.lower())
            linked_user_ids = {item for item in linked_user_ids if item}
            if not current_uid and not linked_user_ids:
                return {"ok": True, "reason": "not_bound"}

            conn.execute(
                """
                DELETE FROM supabase_bindings
                WHERE telegram_id = ?
                """,
                (int(telegram_id),),
            )
            conn.execute(
                """
                UPDATE users
                SET supabase_user_id = '', supabase_email = ''
                WHERE telegram_id = ?
                """,
                (telegram_id,),
            )
            conn.commit()
            for user_id in linked_user_ids:
                self._sync_supabase_profile_telegram_fields(
                    supabase_user_id=user_id,
                    telegram_id=None,
                    telegram_username=None,
                    force=True,
                )
            return {"ok": True, "reason": "unbound", "previous_supabase_user_id": current_uid}

    def create_bind_token(self, telegram_id: int, ttl_minutes: int = 10) -> str:
        token = secrets.token_urlsafe(16)
        now = datetime.now()
        expires_at = now + timedelta(minutes=max(1, int(ttl_minutes)))
        with self._get_connection() as conn:
            conn.execute(
                """
                DELETE FROM telegram_bind_tokens
                WHERE telegram_id = ? OR expires_at < ?
                """,
                (int(telegram_id), now.isoformat()),
            )
            conn.execute(
                """
                INSERT INTO telegram_bind_tokens (token, telegram_id, expires_at)
                VALUES (?, ?, ?)
                """,
                (token, int(telegram_id), expires_at.isoformat()),
            )
            conn.commit()
        return token

    def consume_bind_token(self, token: str) -> Optional[int]:
        token = str(token or "").strip()
        if not token:
            return None
        now = datetime.now()
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT telegram_id, expires_at
                FROM telegram_bind_tokens
                WHERE token = ?
                LIMIT 1
                """,
                (token,),
            ).fetchone()
            if not row:
                return None
            try:
                expires_at = datetime.fromisoformat(row["expires_at"])
            except Exception:
                expires_at = now
            if now > expires_at:
                conn.execute("DELETE FROM telegram_bind_tokens WHERE token = ?", (token,))
                conn.commit()
                return None
            conn.execute("DELETE FROM telegram_bind_tokens WHERE token = ?", (token,))
            conn.commit()
            return int(row["telegram_id"])

    def peek_web_bind_token(self, token: str) -> Optional[Dict[str, str]]:
        token = str(token or "").strip()
        if not token:
            return None
        now = datetime.now()
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT supabase_user_id, supabase_email, expires_at
                FROM web_telegram_bind_tokens
                WHERE token = ?
                LIMIT 1
                """,
                (token,),
            ).fetchone()
            if not row:
                return None
            try:
                expires_at = datetime.fromisoformat(row["expires_at"])
            except Exception:
                expires_at = now
            if now > expires_at:
                conn.execute("DELETE FROM web_telegram_bind_tokens WHERE token = ?", (token,))
                conn.commit()
                return None
            return {
                "supabase_user_id": str(row["supabase_user_id"] or "").strip().lower(),
                "supabase_email": str(row["supabase_email"] or "").strip(),
            }

    def create_web_bind_token(
        self,
        supabase_user_id: str,
        supabase_email: str = "",
        ttl_minutes: int = 10,
    ) -> str:
        normalized_uid = str(supabase_user_id or "").strip().lower()
        if not normalized_uid:
            raise ValueError("supabase_user_id is required")
        token = secrets.token_urlsafe(16)
        now = datetime.now()
        expires_at = now + timedelta(minutes=max(1, int(ttl_minutes)))
        with self._get_connection() as conn:
            conn.execute(
                """
                DELETE FROM web_telegram_bind_tokens
                WHERE supabase_user_id = ? OR expires_at < ?
                """,
                (normalized_uid, now.isoformat()),
            )
            conn.execute(
                """
                INSERT INTO web_telegram_bind_tokens (
                    token, supabase_user_id, supabase_email, expires_at
                )
                VALUES (?, ?, ?, ?)
                """,
                (token, normalized_uid, str(supabase_email or "").strip(), expires_at.isoformat()),
            )
            conn.commit()
        return token

    def consume_web_bind_token(self, token: str) -> Optional[Dict[str, str]]:
        token = str(token or "").strip()
        if not token:
            return None
        now = datetime.now()
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT supabase_user_id, supabase_email, expires_at
                FROM web_telegram_bind_tokens
                WHERE token = ?
                LIMIT 1
                """,
                (token,),
            ).fetchone()
            if not row:
                return None
            try:
                expires_at = datetime.fromisoformat(row["expires_at"])
            except Exception:
                expires_at = now
            conn.execute("DELETE FROM web_telegram_bind_tokens WHERE token = ?", (token,))
            conn.commit()
            if now > expires_at:
                return None
            return {
                "supabase_user_id": str(row["supabase_user_id"] or "").strip().lower(),
                "supabase_email": str(row["supabase_email"] or "").strip(),
            }

    def add_message_activity(
        self,
        telegram_id: int,
        text: str,
        points_to_add: int = 1,
        cooldown_sec: int = 30,
        daily_cap: int = 20,
        min_text_length: int = 4,
    ) -> Dict[str, Any]:
        """Award points for valid group activity with cooldown and daily cap."""
        now = datetime.now()
        normalized = "".join((text or "").split()).lower()
        if len(normalized) < min_text_length:
            return {"awarded": False, "reason": "too_short"}
        fingerprint = hashlib.sha256(normalized.encode("utf-8")).hexdigest()

        today_str = now.strftime("%Y-%m-%d")
        iso_year, iso_week, _ = now.isocalendar()
        week_key = f"{iso_year}-W{iso_week:02d}"
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            # Keep dedupe table bounded.
            stale_day = (now - timedelta(days=14)).strftime("%Y-%m-%d")
            conn.execute(
                "DELETE FROM activity_fingerprints WHERE activity_date < ?",
                (stale_day,),
            )
            cursor = conn.execute(
                """
                SELECT points, daily_points, daily_points_date, weekly_points, weekly_points_week, last_message_at,
                       message_count, welcome_bonus_claimed
                FROM users WHERE telegram_id = ?
                """,
                (telegram_id,),
            )
            row = cursor.fetchone()
            if not row:
                return {"awarded": False, "reason": "user_missing"}

            duplicated = conn.execute(
                """
                SELECT 1
                FROM activity_fingerprints
                WHERE telegram_id = ? AND activity_date = ? AND fingerprint = ?
                LIMIT 1
                """,
                (telegram_id, today_str, fingerprint),
            ).fetchone()
            if duplicated:
                return {"awarded": False, "reason": "duplicate_content"}

            last_message_at = row["last_message_at"]
            if last_message_at:
                last_at = datetime.fromisoformat(last_message_at)
                if (now - last_at).total_seconds() < cooldown_sec:
                    return {"awarded": False, "reason": "cooldown"}

            daily_points = int(row["daily_points"] or 0)
            daily_points_date = row["daily_points_date"] or ""
            if daily_points_date != today_str:
                daily_points = 0
            # Guard against historical overflow values (legacy bug).
            if daily_points > daily_cap:
                daily_points = daily_cap

            weekly_points = int(row["weekly_points"] or 0)
            weekly_points_week = row["weekly_points_week"] or ""
            if weekly_points_week != week_key:
                if weekly_points_week and weekly_points > 0:
                    self._upsert_weekly_archive(
                        conn,
                        telegram_id=telegram_id,
                        week_key=weekly_points_week,
                        points=weekly_points,
                    )
                weekly_points = 0

            if daily_points >= daily_cap:
                conn.execute(
                    """
                    UPDATE users
                    SET last_message_at = ?, daily_points = ?, daily_points_date = ?,
                        weekly_points = ?, weekly_points_week = ?
                    WHERE telegram_id = ?
                    """,
                    (
                        now.isoformat(),
                        daily_points,
                        today_str,
                        weekly_points,
                        week_key,
                        telegram_id,
                    ),
                )
                self._upsert_weekly_archive(
                    conn,
                    telegram_id=telegram_id,
                    week_key=week_key,
                    points=weekly_points,
                )
                conn.commit()
                return {
                    "awarded": False,
                    "reason": "daily_cap",
                    "daily_points": daily_points,
                    "weekly_points": weekly_points,
                }

            remaining = max(0, daily_cap - daily_points)
            points_added = min(max(0, points_to_add), remaining)
            if points_added <= 0:
                conn.commit()
                return {
                    "awarded": False,
                    "reason": "daily_cap",
                    "daily_points": daily_points,
                    "weekly_points": weekly_points,
                }

            welcome_bonus = 0
            first_message_bonus = 0

            is_first_message_of_day = daily_points == 0
            is_new_user = int(row["message_count"] or 0) == 0 and not int(row["welcome_bonus_claimed"] or 0)

            if is_new_user:
                welcome_bonus = self._read_bonus_config("POLYWEATHER_BOT_WELCOME_BONUS", 20)
            if is_first_message_of_day:
                first_message_bonus = self._read_bonus_config("POLYWEATHER_BOT_FIRST_MESSAGE_BONUS", 2)

            total_added = points_added + welcome_bonus + first_message_bonus

            conn.execute("""
                UPDATE users
                SET message_count = message_count + 1,
                    points = points + ?,
                    daily_points = ?,
                    daily_points_date = ?,
                    weekly_points = ?,
                    weekly_points_week = ?,
                    last_message_at = ?,
                    welcome_bonus_claimed = MAX(welcome_bonus_claimed, ?)
                WHERE telegram_id = ?
            """, (
                total_added,
                daily_points + total_added,
                today_str,
                weekly_points + total_added,
                week_key,
                now.isoformat(),
                1 if welcome_bonus > 0 else 0,
                telegram_id,
            ))
            conn.execute(
                """
                INSERT OR IGNORE INTO activity_fingerprints
                (telegram_id, activity_date, fingerprint)
                VALUES (?, ?, ?)
                """,
                (telegram_id, today_str, fingerprint),
            )
            self._upsert_weekly_archive(
                conn,
                telegram_id=telegram_id,
                week_key=week_key,
                points=weekly_points + total_added,
            )
            conn.commit()
            self._sync_points_to_supabase_user_metadata(telegram_id)
            return {
                "awarded": True,
                "reason": "ok",
                "points_added": points_added,
                "welcome_bonus": welcome_bonus,
                "first_message_bonus": first_message_bonus,
                "total_added": total_added,
                "daily_points": daily_points + total_added,
                "weekly_points": weekly_points + total_added,
                "weekly_week": week_key,
            }

    def track_query_usage(self, telegram_id: int, query_type: str) -> Dict[str, Any]:
        today_str = datetime.now().strftime("%Y-%m-%d")
        column = "daily_city_queries" if query_type == "city" else "daily_deb_queries"
        limit = (
            self._read_bonus_config("POLYWEATHER_BOT_CITY_DAILY_FREE_LIMIT", 10)
            if query_type == "city"
            else self._read_bonus_config("POLYWEATHER_BOT_DEB_DAILY_FREE_LIMIT", 10)
        )
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                f"SELECT {column}, daily_queries_date FROM users WHERE telegram_id = ?",
                (telegram_id,),
            ).fetchone()
            if not row:
                return {"allowed": False, "reason": "user_missing", "used": 0, "limit": limit}

            date = row["daily_queries_date"] or ""
            used = int(row[column] or 0) if date == today_str else 0

            if used >= limit:
                return {"allowed": False, "reason": "daily_limit", "used": used, "limit": limit}

            new_used = used + 1
            conn.execute(
                f"""
                UPDATE users
                SET {column} = ?, daily_queries_date = ?
                WHERE telegram_id = ?
                """,
                (new_used, today_str, telegram_id),
            )
            conn.commit()
            return {"allowed": True, "used": new_used, "limit": limit}

    def spend_points(self, telegram_id: int, amount: int) -> Dict[str, Any]:
        if amount <= 0:
            user = self.get_user(telegram_id)
            return {"ok": True, "balance": int((user or {}).get("points") or 0)}

        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT points FROM users WHERE telegram_id = ?",
                (telegram_id,),
            ).fetchone()
            if not row:
                return {"ok": False, "reason": "user_missing", "balance": 0, "required": amount}

            balance = int(row["points"] or 0)
            if balance < amount:
                return {"ok": False, "reason": "insufficient_points", "balance": balance, "required": amount}

            new_balance = balance - amount
            conn.execute(
                "UPDATE users SET points = ? WHERE telegram_id = ?",
                (new_balance, telegram_id),
            )
            conn.commit()
            self._sync_points_to_supabase_user_metadata(telegram_id, force=True)
            return {"ok": True, "balance": new_balance, "spent": amount}

    def spend_points_by_supabase_user_id(self, supabase_user_id: str, amount: int) -> Dict[str, Any]:
        key = str(supabase_user_id or "").strip().lower()
        if not key:
            return {"ok": False, "reason": "invalid_supabase_user_id", "balance": 0, "required": amount}
        if amount <= 0:
            return {"ok": True, "balance": self.get_points_by_supabase_user_id(key)}

        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            telegram_id = self._find_telegram_id_by_supabase_user_id(conn, key)
            if telegram_id is None:
                return {"ok": False, "reason": "user_missing", "balance": 0, "required": amount}
            row = conn.execute(
                """
                SELECT telegram_id, points
                FROM users
                WHERE telegram_id = ?
                LIMIT 1
                """,
                (int(telegram_id),),
            ).fetchone()
            if not row:
                return {"ok": False, "reason": "user_missing", "balance": 0, "required": amount}

            telegram_id = int(row["telegram_id"])
            balance = int(row["points"] or 0)
            if balance < amount:
                return {"ok": False, "reason": "insufficient_points", "balance": balance, "required": amount}

            new_balance = balance - amount
            conn.execute(
                "UPDATE users SET points = ? WHERE telegram_id = ?",
                (new_balance, telegram_id),
            )
            conn.commit()
            self._sync_points_to_supabase_user_metadata(telegram_id, force=True)
            return {"ok": True, "balance": new_balance, "spent": amount}

    def set_premium(self, telegram_id: int, plan: str, months: int = 1):
        expiry = datetime.now() + timedelta(days=30 * months)
        col_is = f"is_{plan}_premium"
        col_expiry = f"{plan}_expiry"
        with self._get_connection() as conn:
            conn.execute(f"""
                UPDATE users 
                SET {col_is} = 1, {col_expiry} = ?
                WHERE telegram_id = ?
            """, (expiry.isoformat(), telegram_id))
            conn.commit()
            logger.info(f"User {telegram_id} upgraded to {plan} premium until {expiry}")

    def get_leaderboard(self, limit: int = 10):
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute("""
                SELECT username, points, message_count 
                FROM users 
                ORDER BY points DESC 
                LIMIT ?
            """, (limit,))
            return [dict(row) for row in cursor.fetchall()]

    def get_weekly_leaderboard(self, limit: int = 10):
        now = datetime.now()
        iso_year, iso_week, _ = now.isocalendar()
        week_key = f"{iso_year}-W{iso_week:02d}"
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                """
                SELECT *
                FROM (
                    SELECT
                        username,
                        u.points AS points,
                        u.message_count AS message_count,
                        u.telegram_id AS telegram_id,
                        COALESCE(a.points,
                            CASE
                                WHEN u.weekly_points_week = ? THEN COALESCE(u.weekly_points, 0)
                                ELSE 0
                            END
                        ) AS weekly_points
                    FROM users u
                    LEFT JOIN weekly_points_archive a
                        ON a.telegram_id = u.telegram_id
                        AND a.week_key = ?
                ) ranked
                WHERE weekly_points > 0
                ORDER BY weekly_points DESC, points DESC, message_count DESC, telegram_id ASC
                LIMIT ?
                """,
                (week_key, week_key, limit),
            )
            return [dict(row) for row in cursor.fetchall()]

    def get_weekly_profile(self, telegram_id: int) -> Dict[str, Any]:
        now = datetime.now()
        iso_year, iso_week, _ = now.isocalendar()
        week_key = f"{iso_year}-W{iso_week:02d}"
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT
                    u.telegram_id,
                    COALESCE(u.points, 0) AS points,
                    COALESCE(u.message_count, 0) AS message_count,
                    COALESCE(a.points,
                        CASE
                            WHEN u.weekly_points_week = ? THEN COALESCE(u.weekly_points, 0)
                            ELSE 0
                        END
                    ) AS weekly_points
                FROM users u
                LEFT JOIN weekly_points_archive a
                    ON a.telegram_id = u.telegram_id
                    AND a.week_key = ?
                ORDER BY weekly_points DESC, points DESC, message_count DESC, u.telegram_id ASC
                """,
                (week_key, week_key),
            ).fetchall()

        weekly_rank: Optional[int] = None
        weekly_points = 0
        total_ranked = 0
        for idx, row in enumerate(rows, start=1):
            row_weekly_points = int(row["weekly_points"] or 0)
            if row_weekly_points > 0:
                total_ranked += 1
            if int(row["telegram_id"] or 0) == int(telegram_id):
                weekly_rank = idx if row_weekly_points > 0 else None
                weekly_points = row_weekly_points
        return {
            "week_key": week_key,
            "weekly_points": max(0, int(weekly_points or 0)),
            "weekly_rank": weekly_rank,
            "total_ranked": total_ranked,
        }

    def get_weekly_profile_by_supabase_user_id(self, supabase_user_id: str) -> Dict[str, Any]:
        key = str(supabase_user_id or "").strip().lower()
        if not key:
            return {"weekly_points": 0, "weekly_rank": None, "total_ranked": 0}

        now = datetime.now()
        iso_year, iso_week, _ = now.isocalendar()
        week_key = f"{iso_year}-W{iso_week:02d}"
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            target_telegram_id = self._find_telegram_id_by_supabase_user_id(conn, key)
            if target_telegram_id is None:
                return {"weekly_points": 0, "weekly_rank": None, "total_ranked": 0}
            rows = conn.execute(
                """
                SELECT
                    telegram_id,
                    COALESCE(points, 0) AS points,
                    COALESCE(message_count, 0) AS message_count,
                    CASE
                        WHEN weekly_points_week = ? THEN COALESCE(weekly_points, 0)
                        ELSE 0
                    END AS weekly_points
                FROM users
                ORDER BY weekly_points DESC, points DESC, message_count DESC, telegram_id ASC
                """,
                (week_key,),
            ).fetchall()

        weekly_rank: Optional[int] = None
        weekly_points = 0
        for idx, row in enumerate(rows, start=1):
            if int(row["telegram_id"] or 0) == int(target_telegram_id):
                weekly_rank = idx
                weekly_points = int(row["weekly_points"] or 0)
                break
        return {
            "weekly_points": max(0, int(weekly_points or 0)),
            "weekly_rank": weekly_rank,
            "total_ranked": len(rows),
        }

    def get_weekly_reward_candidates(self, week_key: str, limit: int = 10):
        wk = self._safe_week_key(week_key)
        if not wk:
            return []
        top_n = max(1, int(limit or 10))
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT *
                FROM (
                    SELECT
                        u.telegram_id,
                        u.username,
                        lower(trim(COALESCE(u.supabase_user_id, ''))) AS supabase_user_id,
                        COALESCE(u.supabase_email, '') AS supabase_email,
                        COALESCE(u.points, 0) AS points,
                        COALESCE(u.message_count, 0) AS message_count,
                        COALESCE(a.points,
                            CASE
                                WHEN u.weekly_points_week = ? THEN COALESCE(u.weekly_points, 0)
                                ELSE 0
                            END
                        ) AS weekly_points
                    FROM users u
                    LEFT JOIN weekly_points_archive a
                        ON a.telegram_id = u.telegram_id
                        AND a.week_key = ?
                ) ranked
                WHERE weekly_points > 0
                ORDER BY weekly_points DESC, points DESC, message_count DESC, telegram_id ASC
                LIMIT ?
                """,
                (wk, wk, top_n),
            ).fetchall()
            return [dict(row) for row in rows]

    def get_weekly_participation_candidates(self, week_key: str, exclude_ids: set):
        wk = self._safe_week_key(week_key)
        if not wk:
            return []
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT *
                FROM (
                    SELECT
                        u.telegram_id,
                        u.username,
                        COALESCE(a.points,
                            CASE
                                WHEN u.weekly_points_week = ? THEN COALESCE(u.weekly_points, 0)
                                ELSE 0
                            END
                        ) AS weekly_points
                    FROM users u
                    LEFT JOIN weekly_points_archive a
                        ON a.telegram_id = u.telegram_id
                        AND a.week_key = ?
                ) ranked
                WHERE weekly_points > 0
                """,
                (wk, wk),
            ).fetchall()
            return [dict(row) for row in rows if int(row["telegram_id"] or 0) not in exclude_ids]

    def is_weekly_reward_settled(self, week_key: str) -> bool:
        wk = self._safe_week_key(week_key)
        if not wk:
            return False
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT 1 FROM weekly_reward_runs WHERE week_key = ? LIMIT 1",
                (wk,),
            ).fetchone()
            return bool(row)

    def mark_weekly_reward_settled(
        self,
        week_key: str,
        winners_count: int,
        summary: Optional[Dict[str, Any]] = None,
    ) -> None:
        wk = self._safe_week_key(week_key)
        if not wk:
            return
        summary_json = None
        if isinstance(summary, dict):
            try:
                summary_json = json.dumps(summary, ensure_ascii=False)
            except Exception:
                summary_json = None
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO weekly_reward_runs (week_key, settled_at, winners_count, summary_json)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(week_key) DO UPDATE SET
                    settled_at = excluded.settled_at,
                    winners_count = excluded.winners_count,
                    summary_json = excluded.summary_json
                """,
                (
                    wk,
                    datetime.now().isoformat(),
                    max(0, int(winners_count or 0)),
                    summary_json,
                ),
            )
            conn.commit()

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
        wk = self._safe_week_key(week_key)
        if not wk:
            return False
        bonus = max(0, int(points_bonus or 0))
        with self._get_connection() as conn:
            exists = conn.execute(
                """
                SELECT 1
                FROM weekly_reward_payouts
                WHERE week_key = ? AND telegram_id = ?
                LIMIT 1
                """,
                (wk, int(telegram_id)),
            ).fetchone()
            if exists:
                return False

            if bonus > 0:
                conn.execute(
                    "UPDATE users SET points = COALESCE(points, 0) + ? WHERE telegram_id = ?",
                    (bonus, int(telegram_id)),
                )
            conn.execute(
                """
                INSERT INTO weekly_reward_payouts (
                    week_key, telegram_id, rank, username, points_bonus, pro_days,
                    supabase_user_id, pro_granted, pro_error, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    wk,
                    int(telegram_id),
                    int(rank or 0),
                    str(username or ""),
                    bonus,
                    max(0, int(pro_days or 0)),
                    str(supabase_user_id or "").strip().lower(),
                    1 if pro_granted else 0,
                    str(pro_error or ""),
                    datetime.now().isoformat(),
                ),
            )
            conn.commit()
            if bonus > 0:
                self._sync_points_to_supabase_user_metadata(
                    int(telegram_id),
                    force=True,
                )
            return True

    def record_user_growth_snapshot(
        self,
        *,
        snapshot_date: str,
        total_registered: int,
        verified_users: int,
        ever_signed_in: int,
        source: str = "supabase_auth_admin",
    ) -> None:
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO user_growth_snapshots (
                    snapshot_date, total_registered, verified_users,
                    ever_signed_in, source, recorded_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(snapshot_date) DO UPDATE SET
                    total_registered = excluded.total_registered,
                    verified_users = excluded.verified_users,
                    ever_signed_in = excluded.ever_signed_in,
                    source = excluded.source,
                    recorded_at = excluded.recorded_at
                """,
                (
                    str(snapshot_date or "").strip(),
                    max(0, int(total_registered or 0)),
                    max(0, int(verified_users or 0)),
                    max(0, int(ever_signed_in or 0)),
                    str(source or "supabase_auth_admin"),
                    datetime.now().isoformat(),
                ),
            )
            conn.commit()

    def list_user_growth_snapshots(self, limit: int = 90) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT snapshot_date, total_registered, verified_users,
                       ever_signed_in, source, recorded_at
                FROM user_growth_snapshots
                ORDER BY snapshot_date DESC
                LIMIT ?
                """,
                (max(1, min(int(limit or 90), 1000)),),
            ).fetchall()
            return [dict(row) for row in rows]

    def is_growth_milestone_settled(self, milestone: int) -> bool:
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT 1 FROM growth_milestone_runs WHERE milestone = ? LIMIT 1",
                (int(milestone),),
            ).fetchone()
            return bool(row)

    def has_growth_milestone_payout(self, milestone: int, supabase_user_id: str) -> bool:
        with self._get_connection() as conn:
            row = conn.execute(
                """
                SELECT 1 FROM growth_milestone_payouts
                WHERE milestone = ? AND supabase_user_id = ? AND status = 'granted'
                LIMIT 1
                """,
                (int(milestone), str(supabase_user_id or "").strip().lower()),
            ).fetchone()
            return bool(row)

    def list_growth_milestone_payouts(self, milestone: int) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT milestone, supabase_user_id, reward_days, status,
                       error, expires_at, updated_at
                FROM growth_milestone_payouts
                WHERE milestone = ?
                ORDER BY supabase_user_id ASC
                """,
                (int(milestone),),
            ).fetchall()
            return [dict(row) for row in rows]

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
        user_id = str(supabase_user_id or "").strip().lower()
        if not user_id:
            return False
        with self._get_connection() as conn:
            existing = conn.execute(
                """
                SELECT status FROM growth_milestone_payouts
                WHERE milestone = ? AND supabase_user_id = ?
                LIMIT 1
                """,
                (int(milestone), user_id),
            ).fetchone()
            if existing and str(existing[0] or "").strip().lower() == "granted":
                return False
            conn.execute(
                """
                INSERT INTO growth_milestone_payouts (
                    milestone, supabase_user_id, reward_days, status,
                    error, expires_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(milestone, supabase_user_id) DO UPDATE SET
                    reward_days = excluded.reward_days,
                    status = excluded.status,
                    error = excluded.error,
                    expires_at = excluded.expires_at,
                    updated_at = excluded.updated_at
                """,
                (
                    int(milestone),
                    user_id,
                    max(0, int(reward_days or 0)),
                    str(status or ""),
                    str(error or ""),
                    str(expires_at or ""),
                    datetime.now().isoformat(),
                ),
            )
            conn.commit()
            return True

    def mark_growth_milestone_settled(
        self,
        milestone: int,
        verified_users: int,
        reward_days: int,
        rewarded_count: int,
        failed_count: int,
        summary: Optional[Dict[str, Any]] = None,
    ) -> None:
        summary_json = json.dumps(summary or {}, ensure_ascii=False)
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO growth_milestone_runs (
                    milestone, verified_users, reward_days, rewarded_count,
                    failed_count, summary_json, settled_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(milestone) DO NOTHING
                """,
                (
                    int(milestone),
                    max(0, int(verified_users or 0)),
                    max(0, int(reward_days or 0)),
                    max(0, int(rewarded_count or 0)),
                    max(0, int(failed_count or 0)),
                    summary_json,
                    datetime.now().isoformat(),
                ),
            )
            conn.commit()

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

    def append_runway_obs(
        self,
        icao: str,
        city: str,
        runway: str,
        tdz_temp: Optional[float] = None,
        mid_temp: Optional[float] = None,
        end_temp: Optional[float] = None,
        target_runway_max: Optional[float] = None,
        wind_dir: Optional[int] = None,
        wind_speed: Optional[float] = None,
        rvr: Optional[int] = None,
        mor: Optional[float] = None,
        humidity: Optional[float] = None,
        otime_utc: str = "",
    ) -> None:
        """Insert one runway observation row (deduplicated by icao+runway+otime_utc)."""
        safe_icao = str(icao or "").strip().upper()
        safe_city = str(city or "").strip().lower()
        safe_runway = str(runway or "").strip().upper()
        safe_otime = str(otime_utc or "").strip()
        if not safe_icao or not safe_runway or not safe_otime:
            return
        try:
            with self._get_connection() as conn:
                existing = conn.execute(
                    "SELECT id FROM runway_obs_log WHERE icao=? AND runway=? AND otime_utc=? LIMIT 1",
                    (safe_icao, safe_runway, safe_otime),
                ).fetchone()
                if existing:
                    return
                conn.execute(
                    """
                    INSERT INTO runway_obs_log (
                        icao, city, runway,
                        tdz_temp, mid_temp, end_temp, target_runway_max,
                        wind_dir, wind_speed, rvr, mor, humidity,
                        otime_utc
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        safe_icao, safe_city, safe_runway,
                        tdz_temp, mid_temp, end_temp, target_runway_max,
                        wind_dir, wind_speed, rvr, mor, humidity,
                        safe_otime,
                    ),
                )
                conn.commit()
        except sqlite3.OperationalError as exc:
            if self._is_sqlite_locked_error(exc):
                logger.warning(
                    "runway obs log skipped because sqlite is locked icao={} city={} runway={}",
                    safe_icao,
                    safe_city,
                    safe_runway,
                )
                return
            raise

    def get_runway_obs_recent(
        self, icao: str, minutes: int = 60
    ) -> List[Dict[str, Any]]:
        """Get recent runway observations for trend analysis."""
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT icao, city, runway,
                       tdz_temp, mid_temp, end_temp, target_runway_max,
                       wind_dir, wind_speed, rvr, mor, humidity,
                       otime_utc, created_at
                FROM runway_obs_log
                WHERE icao = ?
                  AND datetime(COALESCE(NULLIF(otime_utc, ''), created_at))
                      >= datetime('now', ? || ' minutes')
                ORDER BY datetime(COALESCE(NULLIF(otime_utc, ''), created_at)) ASC,
                         created_at ASC
                """,
                (str(icao).strip().upper(), str(-int(minutes))),
            ).fetchall()
            return [dict(r) for r in rows]
