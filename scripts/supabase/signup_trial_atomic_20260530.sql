-- Atomic signup-trial claim and subscription grant.
-- Run after subscription_referral_20260529.sql.

-- Keep the first real signup trial row per user and neutralize duplicate rows
-- before adding the one-trial-per-user index.
with ranked_signup_trials as (
  select
    id,
    row_number() over (
      partition by user_id
      order by created_at asc, id asc
    ) as rn
  from public.subscriptions
  where plan_code = 'signup_trial_3d'
    and source = 'signup_trial'
)
update public.subscriptions s
set
  status = case when s.status = 'active' then 'expired' else s.status end,
  source = 'signup_trial_duplicate',
  updated_at = now()
from ranked_signup_trials r
where s.id = r.id
  and r.rn > 1;

create unique index if not exists uq_subscriptions_signup_trial_user
  on public.subscriptions(user_id)
  where plan_code = 'signup_trial_3d'
    and source = 'signup_trial';

create or replace function public.claim_signup_trial(
  p_user_id uuid,
  p_email text default '',
  p_telegram_user_id bigint default null,
  p_wallet_addresses text[] default array[]::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_wallets text[] := (
    select coalesce(array_agg(distinct lower(trim(input_wallet.value))), array[]::text[])
    from unnest(coalesce(p_wallet_addresses, array[]::text[])) as input_wallet(value)
    where trim(input_wallet.value) <> ''
  );
  v_now timestamptz := now();
  v_expires timestamptz := v_now + interval '3 days';
  v_claim public.trial_claims%rowtype;
  v_claim_id bigint;
  v_rows integer := 0;
begin
  if p_user_id is null then
    return jsonb_build_object('created', false, 'reason', 'missing_user_id');
  end if;

  select tc.*
    into v_claim
  from public.trial_claims tc
  where tc.user_id = p_user_id
     or (v_email <> '' and lower(tc.email) = v_email)
     or (p_telegram_user_id is not null and tc.telegram_user_id = p_telegram_user_id)
     or exists (
        select 1
        from public.trial_claim_wallets tcw
        where tcw.trial_claim_id = tc.id
          and lower(tcw.wallet_address) = any(v_wallets)
     )
  order by
    case when tc.user_id = p_user_id then 0 else 1 end,
    tc.created_at asc,
    tc.id asc
  limit 1;

  if found then
    if v_claim.user_id <> p_user_id then
      return jsonb_build_object('created', false, 'reason', 'already_claimed');
    end if;

    insert into public.subscriptions (
      user_id,
      plan_code,
      status,
      starts_at,
      expires_at,
      source,
      created_at,
      updated_at
    )
    values (
      p_user_id,
      'signup_trial_3d',
      'active',
      coalesce(v_claim.claimed_at, v_now),
      coalesce(v_claim.claimed_at, v_now) + interval '3 days',
      'signup_trial',
      v_now,
      v_now
    )
    on conflict (user_id)
      where plan_code = 'signup_trial_3d'
        and source = 'signup_trial'
      do nothing;
    get diagnostics v_rows = row_count;

    if v_rows > 0 then
      insert into public.entitlement_events (
        user_id,
        action,
        reason,
        actor,
        payload,
        created_at
      )
      values (
        p_user_id,
        'signup_trial_granted',
        'claim_repaired',
        'supabase_auth',
        jsonb_build_object(
          'plan_code', 'signup_trial_3d',
          'expires_at', coalesce(v_claim.claimed_at, v_now) + interval '3 days'
        ),
        v_now
      );
      return jsonb_build_object(
        'created', true,
        'repaired', true,
        'plan_code', 'signup_trial_3d',
        'expires_at', coalesce(v_claim.claimed_at, v_now) + interval '3 days'
      );
    end if;

    return jsonb_build_object('created', false, 'reason', 'already_claimed');
  end if;

  insert into public.trial_claims (
    user_id,
    email,
    telegram_user_id,
    primary_wallet_address,
    metadata,
    claimed_at,
    created_at
  )
  values (
    p_user_id,
    v_email,
    p_telegram_user_id,
    nullif(v_wallets[1], ''),
    jsonb_build_object('wallet_addresses', v_wallets),
    v_now,
    v_now
  )
  returning id into v_claim_id;

  insert into public.trial_claim_wallets (trial_claim_id, wallet_address, created_at)
  select v_claim_id, wallet.value, v_now
  from unnest(v_wallets) as wallet(value)
  on conflict do nothing;

  insert into public.subscriptions (
    user_id,
    plan_code,
    status,
    starts_at,
    expires_at,
    source,
    created_at,
    updated_at
  )
  values (
    p_user_id,
    'signup_trial_3d',
    'active',
    v_now,
    v_expires,
    'signup_trial',
    v_now,
    v_now
  )
  on conflict (user_id)
    where plan_code = 'signup_trial_3d'
      and source = 'signup_trial'
    do nothing;
  get diagnostics v_rows = row_count;

  insert into public.entitlement_events (
    user_id,
    action,
    reason,
    actor,
    payload,
    created_at
  )
  values
    (
      p_user_id,
      'signup_trial_claimed',
      'trial_dedupe',
      'supabase_auth',
      jsonb_build_object(
        'user_id', p_user_id,
        'email', v_email,
        'telegram_user_id', p_telegram_user_id,
        'wallet_addresses', v_wallets,
        'claimed_at', v_now,
        'storage', 'trial_claims'
      ),
      v_now
    ),
    (
      p_user_id,
      'signup_trial_granted',
      'first_auth',
      'supabase_auth',
      jsonb_build_object(
        'plan_code', 'signup_trial_3d',
        'expires_at', v_expires
      ),
      v_now
    );

  if v_rows = 0 then
    return jsonb_build_object('created', false, 'reason', 'already_claimed');
  end if;

  return jsonb_build_object(
    'created', true,
    'plan_code', 'signup_trial_3d',
    'expires_at', v_expires
  );
exception
  when unique_violation then
    return jsonb_build_object('created', false, 'reason', 'already_claimed');
end;
$$;

revoke all on function public.claim_signup_trial(uuid, text, bigint, text[]) from public;
revoke all on function public.claim_signup_trial(uuid, text, bigint, text[]) from anon;
revoke all on function public.claim_signup_trial(uuid, text, bigint, text[]) from authenticated;
grant execute on function public.claim_signup_trial(uuid, text, bigint, text[]) to service_role;

analyze public.trial_claims;
analyze public.trial_claim_wallets;
analyze public.subscriptions;
