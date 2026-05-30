-- Verify the balanced referral-points migration.
-- Run after scripts/supabase/referral_points_rewards_20260530.sql.

with checks(check_name, ok) as (
  values
    (
      'referral_rewards.reward_points column',
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'referral_rewards'
          and column_name = 'reward_points'
          and is_nullable = 'NO'
      )
    ),
    (
      'referral_rewards.reward_points check',
      exists (
        select 1
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public'
          and t.relname = 'referral_rewards'
          and c.conname = 'referral_rewards_reward_points_check'
      )
    ),
    (
      'referral_rewards monthly reward index includes points',
      exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and tablename = 'referral_rewards'
          and indexname = 'idx_referral_rewards_referrer_month'
          and indexdef ilike '%reward_points%'
      )
    ),
    (
      'points_ledger table',
      exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'points_ledger'
      )
    ),
    (
      'points_ledger user index',
      exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and tablename = 'points_ledger'
          and indexname = 'idx_points_ledger_user_created'
      )
    ),
    (
      'points_ledger referral index',
      exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and tablename = 'points_ledger'
          and indexname = 'idx_points_ledger_referral'
      )
    ),
    (
      'points_ledger RLS enabled',
      exists (
        select 1
        from pg_class t
        join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public'
          and t.relname = 'points_ledger'
          and t.relrowsecurity
      )
    ),
    (
      'points_ledger own-row select policy',
      exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'points_ledger'
          and policyname = 'points_ledger_select_own'
          and cmd = 'SELECT'
      )
    )
)
select check_name, ok
from checks
order by check_name;
