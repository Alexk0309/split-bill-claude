-- Fix: row level security policies need EXECUTE on the functions they call.
--
-- 0001 revoked EXECUTE on the predicate functions from `anon` and
-- `authenticated`, on the reasoning that they are internal machinery rather
-- than API surface. That is wrong. Postgres evaluates a policy expression as
-- the role running the query, and the EXECUTE check applies there like anywhere
-- else -- SECURITY DEFINER changes the execution context only *after* the
-- caller has been allowed to call at all. With EXECUTE revoked, every policy
-- that calls one of these fails with "permission denied for function", which
-- means nobody can read a bill: not the payer, not a guest.
--
-- Granting them back is safe. Each takes an id the caller already holds and
-- compares it against a token only the caller can supply, so the boolean it
-- returns tells the caller nothing the policy would not have told them anyway.
-- They remain undiscoverable as an API in the sense that matters: none of them
-- returns data, and none can be used to enumerate anything.

grant execute on function public.owns_bill(uuid) to anon, authenticated;
grant execute on function public.bill_is_shared(uuid) to anon, authenticated;
grant execute on function public.is_claim_token_holder(uuid) to anon, authenticated;
grant execute on function public.request_share_token() to anon, authenticated;
grant execute on function public.request_claim_token() to anon, authenticated;

-- `generate_token` stays revoked: it is only ever called from column defaults
-- and from SECURITY DEFINER functions, both of which run as the owner.
