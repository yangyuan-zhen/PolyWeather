from pathlib import Path


def _schema_sql() -> str:
    root = Path(__file__).resolve().parents[1]
    return (root / "scripts" / "supabase" / "schema.sql").read_text(encoding="utf-8").lower()


def test_supabase_schema_has_io_friendly_indexes_for_hot_ops_queries():
    schema = _schema_sql()

    assert (
        "create index if not exists idx_profiles_email\n"
        "  on public.profiles(email)\n"
        "  include (id)"
    ) in schema
    assert (
        "create index if not exists idx_profiles_id_lookup\n"
        "  on public.profiles(id)\n"
        "  include (email, created_at)"
    ) in schema
    assert "idx_subscriptions_status_expiry" in schema
    assert "on public.subscriptions(expires_at asc)" in schema
    assert "idx_subscriptions_user_status_expiry" in schema
    assert "on public.subscriptions(user_id, expires_at desc)" in schema
    assert "include (id, starts_at, plan_code, source)" in schema
    assert schema.count("where status = 'active'") >= 2
    assert "idx_subscriptions_user_created" in schema
    assert "on public.subscriptions(user_id, created_at desc)" in schema
    assert "include (id, status, plan_code, source, starts_at, expires_at, updated_at)" in schema
    assert "idx_payment_intents_status_updated" in schema
    assert "on public.payment_intents(status, updated_at desc)" in schema
    assert "include (user_id)" in schema
    assert "where status in ('submitted', 'confirmed')" in schema
    assert "idx_payment_intents_user_status_updated" in schema
    assert "on public.payment_intents(user_id, status, updated_at desc)" in schema
    assert "idx_payment_intents_user_status\n" not in schema
    assert "idx_payment_intents_submitted_tx_updated" in schema
    assert "include (id, user_id, tx_hash, chain_id)" in schema
    assert "where status = 'submitted' and tx_hash is not null" in schema
    assert "idx_payment_intents_user_created" in schema
    assert "on public.payment_intents(user_id, created_at desc)" in schema
    assert "idx_payment_intents_tx_hash" in schema
    assert "on public.payment_intents(tx_hash)" in schema
    assert "include (id, user_id)" in schema
    assert "where tx_hash is not null" in schema
    assert "idx_payments_created_at" in schema
    assert "on public.payments(created_at desc)" in schema
    assert "include (id, user_id, amount, currency, chain, tx_hash, status)" in schema
    assert "idx_user_wallets_user_chain" in schema
    assert "on public.user_wallets(user_id, chain_id, is_primary desc, verified_at desc)" in schema
    assert "include (id, address)" in schema
    assert (
        "create index if not exists idx_user_wallets_chain_address_owner\n"
        "  on public.user_wallets(chain_id, address)\n"
        "  include (user_id, status)"
    ) in schema
    assert schema.count("where status = 'active'") >= 3
    assert "idx_wallet_link_challenges_lookup" not in schema
    assert (
        "create index if not exists idx_payment_transactions_tx_hash_intent\n"
        "  on public.payment_transactions(tx_hash)\n"
        "  include (intent_id)"
    ) in schema


def test_supabase_io_budget_scripts_are_production_runnable():
    root = Path(__file__).resolve().parents[1]
    indexes = (root / "scripts" / "supabase" / "io_budget_indexes.sql").read_text(encoding="utf-8").lower()
    diagnostics = (root / "scripts" / "supabase" / "disk_io_diagnostics.sql").read_text(encoding="utf-8").lower()

    assert "drop index if exists public.idx_profiles_email" in indexes
    assert (
        "create index if not exists idx_profiles_email\n"
        "  on public.profiles(email)\n"
        "  include (id)"
    ) in indexes
    assert "drop index if exists public.idx_profiles_id_lookup" in indexes
    assert (
        "create index if not exists idx_profiles_id_lookup\n"
        "  on public.profiles(id)\n"
        "  include (email, created_at)"
    ) in indexes
    assert "idx_subscriptions_user_created" in indexes
    assert "drop index if exists public.idx_subscriptions_user_status_expiry" in indexes
    assert "drop index if exists public.idx_subscriptions_status_expiry" in indexes
    assert "on public.subscriptions(user_id, expires_at desc)" in indexes
    assert "on public.subscriptions(expires_at asc)" in indexes
    assert "include (id, starts_at, plan_code, source)" in indexes
    assert "include (user_id, starts_at, plan_code)" in indexes
    assert "include (id, status, plan_code, source, starts_at, expires_at, updated_at)" in indexes
    assert "drop index if exists public.idx_payment_intents_user_status" in indexes
    assert "drop index if exists public.idx_payment_intents_status_updated" in indexes
    assert "include (user_id)" in indexes
    assert "where status in ('submitted', 'confirmed')" in indexes
    assert "drop index if exists public.idx_payment_intents_submitted_tx_updated" in indexes
    assert "include (id, user_id, tx_hash, chain_id)" in indexes
    assert "drop index if exists public.idx_payment_intents_tx_hash" in indexes
    assert "include (id, user_id)" in indexes
    assert "where tx_hash is not null" in indexes
    assert "drop index if exists public.idx_payments_created_at" in indexes
    assert "include (id, user_id, amount, currency, chain, tx_hash, status)" in indexes
    assert "drop index if exists public.idx_user_wallets_user_chain" in indexes
    assert "on public.user_wallets(user_id, chain_id, is_primary desc, verified_at desc)" in indexes
    assert "include (id, address)" in indexes
    assert "drop index if exists public.idx_user_wallets_chain_address_owner" in indexes
    assert (
        "create index if not exists idx_user_wallets_chain_address_owner\n"
        "  on public.user_wallets(chain_id, address)\n"
        "  include (user_id, status)"
    ) in indexes
    assert "drop index if exists public.idx_wallet_link_challenges_lookup" in indexes
    assert "create index if not exists idx_wallet_link_challenges_lookup" not in indexes
    assert "drop index if exists public.idx_payment_transactions_tx_hash_intent" in indexes
    assert (
        "create index if not exists idx_payment_transactions_tx_hash_intent\n"
        "  on public.payment_transactions(tx_hash)\n"
        "  include (intent_id)"
    ) in indexes
    assert "analyze public.payment_intents" in indexes
    assert "pg_stat_user_tables" in diagnostics
    assert "pg_stat_statements" in diagnostics
    assert "shared_blks_read" in diagnostics
    assert "pg_stat_user_indexes" in diagnostics
    assert "pg_statio_user_indexes" in diagnostics
    assert "indexrelname" in diagnostics
    assert "idx_blks_read" in diagnostics
    assert "idx_scan = 0" in diagnostics


def test_supabase_setup_doc_includes_io_budget_runbook():
    root = Path(__file__).resolve().parents[1]
    doc = (root / "docs" / "SUPABASE_SETUP_ZH.md").read_text(encoding="utf-8")

    assert "scripts/supabase/io_budget_indexes.sql" in doc
    assert "scripts/supabase/disk_io_diagnostics.sql" in doc
    assert "Disk IO" in doc
