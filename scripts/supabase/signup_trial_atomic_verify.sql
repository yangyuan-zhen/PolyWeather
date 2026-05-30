-- Read-only verification for signup_trial_atomic_20260530.sql.

select
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'subscriptions'
      and indexname = 'uq_subscriptions_signup_trial_user'
  ) as has_trial_unique_index,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'claim_signup_trial'
  ) as has_claim_signup_trial_rpc;

select
  count(*) as users_with_duplicate_signup_trials,
  coalesce(sum(trial_count), 0) as total_trial_rows_in_duplicate_users
from (
  select user_id, count(*) as trial_count
  from public.subscriptions
  where plan_code = 'signup_trial_3d'
    and source = 'signup_trial'
  group by user_id
  having count(*) > 1
) d;

select
  count(*) filter (where s.id is null) as trial_claims_without_trial_subscription,
  count(*) as total_trial_claims
from public.trial_claims tc
left join public.subscriptions s
  on s.user_id = tc.user_id
 and s.plan_code = 'signup_trial_3d'
 and s.source = 'signup_trial';
