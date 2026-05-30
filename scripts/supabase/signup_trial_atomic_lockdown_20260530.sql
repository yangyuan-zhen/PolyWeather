-- Restrict atomic signup-trial RPC to backend service-role calls only.

revoke all on function public.claim_signup_trial(uuid, text, bigint, text[]) from public;
revoke all on function public.claim_signup_trial(uuid, text, bigint, text[]) from anon;
revoke all on function public.claim_signup_trial(uuid, text, bigint, text[]) from authenticated;
grant execute on function public.claim_signup_trial(uuid, text, bigint, text[]) to service_role;

select
  has_function_privilege('anon', 'public.claim_signup_trial(uuid,text,bigint,text[])', 'execute') as anon_can_execute,
  has_function_privilege('authenticated', 'public.claim_signup_trial(uuid,text,bigint,text[])', 'execute') as authenticated_can_execute,
  has_function_privilege('service_role', 'public.claim_signup_trial(uuid,text,bigint,text[])', 'execute') as service_role_can_execute;
