-- PolyWeather Supabase Disk IO mitigation indexes.
-- Run this in the Supabase SQL Editor for an existing production project.

drop index if exists public.idx_subscriptions_user_status_expiry;
create index if not exists idx_subscriptions_user_status_expiry
  on public.subscriptions(user_id, expires_at desc)
  include (id, starts_at, plan_code, source)
  where status = 'active';

drop index if exists public.idx_profiles_email;
create index if not exists idx_profiles_email
  on public.profiles(email)
  include (id);

drop index if exists public.idx_profiles_id_lookup;
create index if not exists idx_profiles_id_lookup
  on public.profiles(id)
  include (email, created_at);

drop index if exists public.idx_subscriptions_status_expiry;
create index if not exists idx_subscriptions_status_expiry
  on public.subscriptions(expires_at asc)
  include (user_id, starts_at, plan_code)
  where status = 'active';

drop index if exists public.idx_subscriptions_user_created;
create index if not exists idx_subscriptions_user_created
  on public.subscriptions(user_id, created_at desc)
  include (id, status, plan_code, source, starts_at, expires_at, updated_at);

drop index if exists public.idx_payments_created_at;
create index if not exists idx_payments_created_at
  on public.payments(created_at desc)
  include (id, user_id, amount, currency, chain, tx_hash, status);

drop index if exists public.idx_user_wallets_user_chain;
create index if not exists idx_user_wallets_user_chain
  on public.user_wallets(user_id, chain_id, is_primary desc, verified_at desc)
  include (id, address)
  where status = 'active';

drop index if exists public.idx_user_wallets_chain_address_owner;
create index if not exists idx_user_wallets_chain_address_owner
  on public.user_wallets(chain_id, address)
  include (user_id, status);

drop index if exists public.idx_wallet_link_challenges_lookup;

drop index if exists public.idx_payment_intents_user_status;

drop index if exists public.idx_payment_intents_status_updated;
create index if not exists idx_payment_intents_status_updated
  on public.payment_intents(status, updated_at desc)
  include (user_id)
  where status in ('submitted', 'confirmed');

create index if not exists idx_payment_intents_user_status_updated
  on public.payment_intents(user_id, status, updated_at desc);

drop index if exists public.idx_payment_intents_submitted_tx_updated;
create index if not exists idx_payment_intents_submitted_tx_updated
  on public.payment_intents(updated_at asc)
  include (id, user_id, tx_hash, chain_id)
  where status = 'submitted' and tx_hash is not null;

create index if not exists idx_payment_intents_user_created
  on public.payment_intents(user_id, created_at desc);

drop index if exists public.idx_payment_intents_tx_hash;
create index if not exists idx_payment_intents_tx_hash
  on public.payment_intents(tx_hash)
  include (id, user_id)
  where tx_hash is not null;

create index if not exists idx_payment_transactions_intent
  on public.payment_transactions(intent_id, created_at desc);

drop index if exists public.idx_payment_transactions_tx_hash_intent;
create index if not exists idx_payment_transactions_tx_hash_intent
  on public.payment_transactions(tx_hash)
  include (intent_id);

analyze public.subscriptions;
analyze public.profiles;
analyze public.payments;
analyze public.user_wallets;
analyze public.wallet_link_challenges;
analyze public.payment_intents;
analyze public.payment_transactions;
