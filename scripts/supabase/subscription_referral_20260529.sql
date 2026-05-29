-- PolyWeather trial and referral program.
-- Run in Supabase SQL editor before enabling signup trials/referral checkout.

create table if not exists public.trial_claims (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null default '',
  telegram_user_id bigint,
  primary_wallet_address text,
  metadata jsonb not null default '{}'::jsonb,
  claimed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists uq_trial_claims_user
  on public.trial_claims(user_id);

create unique index if not exists uq_trial_claims_email
  on public.trial_claims(lower(email))
  where email <> '';

create unique index if not exists uq_trial_claims_telegram
  on public.trial_claims(telegram_user_id)
  where telegram_user_id is not null;

create table if not exists public.trial_claim_wallets (
  id bigserial primary key,
  trial_claim_id bigint not null references public.trial_claims(id) on delete cascade,
  wallet_address text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_trial_claim_wallets_address
  on public.trial_claim_wallets(lower(wallet_address));

create table if not exists public.referral_codes (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_referral_codes_user
  on public.referral_codes(user_id);

create unique index if not exists uq_referral_codes_code
  on public.referral_codes(upper(code));

create table if not exists public.referral_attributions (
  id bigserial primary key,
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  referred_user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  status text not null default 'pending' check (status in ('pending', 'converted', 'capped', 'cancelled')),
  converted_payment_intent_id text,
  converted_tx_hash text,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (referrer_user_id <> referred_user_id)
);

create unique index if not exists uq_referral_attributions_referred
  on public.referral_attributions(referred_user_id);

create index if not exists idx_referral_attributions_pending
  on public.referral_attributions(referred_user_id, created_at desc)
  include (id, code, referrer_user_id)
  where status = 'pending';

create table if not exists public.referral_rewards (
  id bigserial primary key,
  referral_attribution_id bigint not null references public.referral_attributions(id) on delete cascade,
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  referred_user_id uuid not null references auth.users(id) on delete cascade,
  payment_intent_id text not null,
  tx_hash text,
  reward_days integer not null default 3 check (reward_days > 0 and reward_days <= 30),
  created_at timestamptz not null default now()
);

create unique index if not exists uq_referral_rewards_attribution
  on public.referral_rewards(referral_attribution_id);

create index if not exists idx_referral_rewards_referrer_month
  on public.referral_rewards(referrer_user_id, created_at desc)
  include (id, reward_days);

analyze public.trial_claims;
analyze public.trial_claim_wallets;
analyze public.referral_codes;
analyze public.referral_attributions;
analyze public.referral_rewards;
