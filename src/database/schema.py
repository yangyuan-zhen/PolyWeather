"""Database schema initialization — all CREATE TABLE / INDEX DDL."""

from __future__ import annotations

import os
from typing import Any

from loguru import logger


def init_db(conn: Any, db_path: str) -> None:
    """Create all tables and indexes if they don't exist."""
    db_dir = os.path.dirname(db_path)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)

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
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_canonical_temperature_latest_updated
        ON canonical_temperature_latest(updated_at_ts DESC)
    """)
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
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_raw_observation_store_source_city_time
        ON raw_observation_store(source, city, observed_at DESC, fetched_at DESC)
    """)
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
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_raw_observation_latest_city_source
        ON raw_observation_latest(city, source, updated_at_ts DESC)
    """)
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
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_observation_refresh_requests_status
        ON observation_refresh_requests(status, priority, requested_at_ts)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_observation_refresh_requests_city
        ON observation_refresh_requests(city, kind, status)
    """)
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
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ops_audit_events_created_at
        ON ops_audit_events(created_at DESC)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ops_audit_events_action_created_at
        ON ops_audit_events(action, created_at DESC)
    """)
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
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_points_ledger_user_created_at
        ON points_ledger(supabase_user_id, supabase_email, created_at DESC)
    """)
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
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_payment_refund_cases_status_created_at
        ON payment_refund_cases(status, created_at DESC)
    """)
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
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_observation_patch_events_city_revision
        ON observation_patch_events(city, revision)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_observation_patch_events_created_at
        ON observation_patch_events(created_at)
    """)
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

    # Column migrations (ensure columns exist on legacy tables)
    _ensure_column(conn, "users", "daily_points", "INTEGER DEFAULT 0")
    _ensure_column(conn, "users", "daily_points_date", "TEXT")
    _ensure_column(conn, "users", "weekly_points", "INTEGER DEFAULT 0")
    _ensure_column(conn, "users", "weekly_points_week", "TEXT")
    _ensure_column(conn, "users", "supabase_user_id", "TEXT")
    _ensure_column(conn, "users", "supabase_email", "TEXT")
    _ensure_column(conn, "users", "welcome_bonus_claimed", "INTEGER DEFAULT 0")
    _ensure_column(conn, "users", "daily_city_queries", "INTEGER DEFAULT 0")
    _ensure_column(conn, "users", "daily_deb_queries", "INTEGER DEFAULT 0")
    _ensure_column(conn, "users", "daily_queries_date", "TEXT")
    _ensure_column(conn, "user_feedback", "reward_points", "INTEGER DEFAULT 0")
    _ensure_column(conn, "user_feedback", "reward_reason", "TEXT DEFAULT ''")
    _ensure_column(conn, "user_feedback", "rewarded_at", "TIMESTAMP")
    _ensure_column(conn, "user_feedback", "reward_status", "TEXT DEFAULT ''")

    # Migrate legacy one-to-one binding column into mapping table.
    conn.execute("""
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
    """)
    conn.commit()


def _ensure_column(conn: Any, table: str, column: str, col_type: str) -> None:
    """Add a column if it doesn't already exist (idempotent migration helper)."""
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
    except Exception:
        pass


logger.info("Database schema module loaded")
