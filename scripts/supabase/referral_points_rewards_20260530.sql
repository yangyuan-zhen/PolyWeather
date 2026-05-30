-- PolyWeather balanced referral points program.
-- Run once before deploying referral point rewards.

alter table public.referral_rewards
  add column if not exists reward_points integer not null default 0;

alter table public.referral_rewards
  alter column reward_days set default 0;

alter table public.referral_rewards
  drop constraint if exists referral_rewards_reward_days_check;

alter table public.referral_rewards
  add constraint referral_rewards_reward_days_check
  check (reward_days >= 0 and reward_days <= 30);

alter table public.referral_rewards
  drop constraint if exists referral_rewards_reward_points_check;

alter table public.referral_rewards
  add constraint referral_rewards_reward_points_check
  check (reward_points >= 0 and reward_points <= 100000);

create index if not exists idx_referral_rewards_referrer_month_points
  on public.referral_rewards(referrer_user_id, created_at desc)
  include (id, reward_points);

create table if not exists public.points_ledger (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null check (delta <> 0),
  source text not null,
  reason text not null,
  payment_intent_id text,
  referral_attribution_id bigint references public.referral_attributions(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_points_ledger_user_created
  on public.points_ledger(user_id, created_at desc);

create index if not exists idx_points_ledger_referral
  on public.points_ledger(referral_attribution_id)
  where referral_attribution_id is not null;

alter table public.points_ledger enable row level security;

drop policy if exists points_ledger_select_own on public.points_ledger;
create policy points_ledger_select_own
  on public.points_ledger
  for select
  to authenticated
  using (auth.uid() = user_id);

analyze public.referral_rewards;
analyze public.points_ledger;
