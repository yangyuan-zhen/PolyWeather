-- Direct/manual transfer checkout support.
-- Run once in Supabase SQL editor before enabling payment_mode=direct in production.

alter table public.payment_transactions
  alter column from_address drop not null;

alter table public.payment_transactions
  add column if not exists payment_method text not null default 'wallet';

do $$
begin
  alter table public.payment_intents
    drop constraint if exists payment_intents_payment_mode_check;
  alter table public.payment_intents
    add constraint payment_intents_payment_mode_check
    check (payment_mode in ('strict', 'flex', 'direct'));

  alter table public.payment_transactions
    drop constraint if exists payment_transactions_status_check;
  alter table public.payment_transactions
    add constraint payment_transactions_status_check
    check (status in ('submitted', 'confirmed', 'failed', 'duplicate', 'refund_required'));

  alter table public.payment_transactions
    drop constraint if exists payment_transactions_payment_method_check;
  alter table public.payment_transactions
    add constraint payment_transactions_payment_method_check
    check (payment_method in ('wallet', 'manual', 'direct'));
end $$;
