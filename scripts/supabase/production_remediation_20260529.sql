-- PolyWeather production remediation from Supabase MCP diagnostics.
-- Intended for Supabase SQL Editor or a privileged database session.
-- The Supabase MCP session available to Codex was read-only, so this file
-- contains the exact write-side changes to run with project write access.

-- 1) Restrict SECURITY DEFINER functions from public RPC execution.
-- These functions are used as event/row triggers and should not be callable
-- directly by anon/authenticated clients unless intentionally exposed.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.sync_profile_from_auth() from public, anon, authenticated;

-- 2) Remove broad direct public-table privileges from client roles.
-- RLS currently blocks row access because no policies exist, but these grants
-- create a large blast radius if a permissive policy is added later.
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;

-- Keep future objects created by this role from inheriting broad access.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- 3) Add missing foreign-key helper indexes reported by Supabase advisor.
create index if not exists idx_entitlement_events_user_id
  on public.entitlement_events(user_id);

create index if not exists idx_payments_user_id
  on public.payments(user_id);

create index if not exists idx_wallet_link_challenges_user_id
  on public.wallet_link_challenges(user_id);

-- 4) Normalize stale business state observed in read-only diagnostics.
update public.subscriptions
set status = 'expired',
    updated_at = now()
where status = 'active'
  and expires_at <= now();

update public.payment_intents
set status = 'expired',
    updated_at = now()
where status in ('created', 'submitted')
  and expires_at <= now();

delete from public.wallet_link_challenges
where consumed_at is null
  and expires_at <= now();

-- Backfill profiles for auth users created while the auth trigger was absent
-- or failed. Existing profiles are not modified.
insert into public.profiles (id, email)
select u.id, coalesce(u.email, '')
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

analyze public.entitlement_events;
analyze public.payments;
analyze public.wallet_link_challenges;
analyze public.subscriptions;
analyze public.payment_intents;
analyze public.profiles;

-- 5) Verification queries. Expected after this script:
-- - exposed_security_definer_functions = 0
-- - public_client_table_grants = 0
-- - missing_public_fk_indexes = 0
-- - active_expired_subscriptions = 0
-- - open_expired_payment_intents = 0
-- - expired_unconsumed_wallet_challenges = 0
-- - auth_users_without_profile = 0
select 'exposed_security_definer_functions' as check_name,
       count(*)::bigint as count
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('rls_auto_enable', 'sync_profile_from_auth')
  and p.prosecdef
  and (
    has_function_privilege('anon', p.oid, 'execute')
    or has_function_privilege('authenticated', p.oid, 'execute')
  )
union all
select 'public_client_table_grants',
       count(*)::bigint
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
left join pg_roles grantee on grantee.oid = a.grantee
where n.nspname = 'public'
  and c.relkind = 'r'
  and coalesce(grantee.rolname, 'PUBLIC') in ('anon', 'authenticated')
union all
select 'missing_public_fk_indexes',
       count(*)::bigint
from (
  select con.conrelid, con.conkey
  from pg_constraint con
  join pg_namespace n on n.oid = con.connamespace
  where con.contype = 'f'
    and n.nspname = 'public'
    and not exists (
      select 1
      from pg_index i
      where i.indrelid = con.conrelid
        and i.indisvalid
        and i.indisready
        and (
          select array_agg(k order by ord)
          from unnest(i.indkey) with ordinality as x(k, ord)
          where ord <= array_length(con.conkey, 1)
        ) = con.conkey
    )
) missing_fks
union all
select 'active_expired_subscriptions',
       count(*)::bigint
from public.subscriptions
where status = 'active'
  and expires_at <= now()
union all
select 'open_expired_payment_intents',
       count(*)::bigint
from public.payment_intents
where status in ('created', 'submitted')
  and expires_at <= now()
union all
select 'expired_unconsumed_wallet_challenges',
       count(*)::bigint
from public.wallet_link_challenges
where consumed_at is null
  and expires_at <= now()
union all
select 'auth_users_without_profile',
       count(*)::bigint
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;
