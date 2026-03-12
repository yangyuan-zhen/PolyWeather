-- PolyWeather minimal commerce/auth schema (P0)
-- Run in Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  telegram_user_id bigint,
  telegram_username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_code text not null,
  status text not null check (status in ('active', 'paused', 'expired', 'cancelled')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_user_status_expiry
  on public.subscriptions(user_id, status, expires_at desc);

create table if not exists public.payments (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(18, 6) not null,
  currency text not null default 'USDC',
  chain text not null default 'polygon',
  tx_hash text unique,
  status text not null check (status in ('pending', 'confirmed', 'failed', 'refunded')),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.entitlement_events (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  reason text not null default '',
  actor text not null default 'system',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.user_wallets (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  chain_id integer not null default 137,
  address text not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  is_primary boolean not null default false,
  verified_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(chain_id, address)
);

create index if not exists idx_user_wallets_user_chain
  on public.user_wallets(user_id, chain_id, status, is_primary desc, verified_at desc);

create table if not exists public.wallet_link_challenges (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  chain_id integer not null default 137,
  address text not null,
  nonce text not null unique,
  message text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_wallet_link_challenges_lookup
  on public.wallet_link_challenges(user_id, chain_id, address, nonce, created_at desc);

create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_code text not null,
  plan_id bigint not null,
  chain_id integer not null default 137,
  token_address text not null,
  receiver_address text not null,
  amount_units numeric(78,0) not null,
  payment_mode text not null default 'strict' check (payment_mode in ('strict', 'flex')),
  allowed_wallet text,
  order_id_hex text not null unique,
  status text not null default 'created' check (status in ('created', 'submitted', 'confirmed', 'expired', 'failed', 'cancelled')),
  tx_hash text,
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payment_intents_user_status
  on public.payment_intents(user_id, status, created_at desc);

create index if not exists idx_payment_intents_tx_hash
  on public.payment_intents(tx_hash);

create table if not exists public.payment_transactions (
  id bigserial primary key,
  intent_id uuid not null references public.payment_intents(id) on delete cascade,
  tx_hash text not null unique,
  chain_id integer not null default 137,
  from_address text not null,
  to_address text not null,
  block_number bigint,
  status text not null default 'submitted' check (status in ('submitted', 'confirmed', 'failed')),
  raw_receipt jsonb not null default '{}'::jsonb,
  raw_tx jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payment_transactions_intent
  on public.payment_transactions(intent_id, created_at desc);

create or replace function public.sync_profile_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update
  set email = excluded.email,
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_polyweather on auth.users;
create trigger on_auth_user_created_polyweather
  after insert on auth.users
  for each row execute function public.sync_profile_from_auth();
