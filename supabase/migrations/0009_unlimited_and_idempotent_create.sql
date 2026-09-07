-- Two fixes, both about a bill being created when nobody meant to create one.
--
-- 1. A quota with no ceiling, for the account that runs this thing.
-- 2. "New bill" becomes idempotent, because it was not, and that cost real
--    allowance: one account created three bills at 04:09:18, 04:09:20 and
--    04:09:21 -- three taps on an unresponsive button, all three untouched
--    drafts, the whole lifetime quota gone in three seconds. The button gave no
--    feedback, so tapping again was the reasonable thing to do.
--
-- The client-side fix (disabling the button while the action is in flight) is
-- the one people will notice. This is the one that holds when it does not run:
-- before hydration, on a dropped connection that gets retried, or from a
-- resubmitted POST.

-- ---------------------------------------------------------------------------
-- A quota that can be absent
-- ---------------------------------------------------------------------------
-- "Unlimited" is not a large number, it is the absence of a ceiling, so it is
-- spelled null rather than 2147483647 -- which would otherwise have to be
-- special-cased everywhere it is displayed.

alter table public.profiles alter column bill_quota drop not null;

comment on column public.profiles.bill_quota is
  'Bills this account may ever create. Null means no ceiling.';

alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles
  add constraint profiles_plan_check check (plan in ('free', 'paid', 'unlimited'));

-- The quota check now has to tolerate a missing ceiling. Everything else about
-- the trigger is unchanged: still monotonic, still locking the profile row so
-- two simultaneous inserts cannot both pass.
create or replace function public.enforce_bill_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created integer;
  v_quota integer;
begin
  insert into public.profiles (id) values (new.owner_id) on conflict (id) do nothing;

  select bills_created, bill_quota
    into v_created, v_quota
    from public.profiles
   where id = new.owner_id
   for update;

  if v_quota is not null and v_created >= v_quota then
    raise exception 'BILL_QUOTA_REACHED'
      using hint = 'This account has used all of its bills.';
  end if;

  -- Still counted for an unlimited account: the number is worth having, and it
  -- is what a future paid tier would be measured against.
  update public.profiles
     set bills_created = bills_created + 1
   where id = new.owner_id;

  return new;
end;
$$;

revoke all on function public.enforce_bill_quota() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Creating a bill, at most once per intent
-- ---------------------------------------------------------------------------
-- An untouched draft -- no title, no venue, no items, nobody on it -- is
-- indistinguishable from a bill that has just been created. So when one already
-- exists, handing back the same one is not a compromise: there is no observable
-- difference, and it is what somebody tapping "New bill" twice meant to get.
--
-- The advisory lock is what makes it hold under a double tap specifically. Two
-- requests 200ms apart would otherwise both look, both find nothing, and both
-- insert. The lock is per account and released at the end of the transaction,
-- so it serialises one person's taps and nobody else's.
--
-- The owner comes from the JWT, never from an argument, so security definer
-- here cannot be used to create a bill against somebody else's allowance.

create or replace function public.create_bill(
  p_service_charge_rate numeric,
  p_service_tax_rate numeric
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_id uuid;
begin
  if v_owner is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text, 0));

  select b.id
    into v_id
    from public.bills b
   where b.owner_id = v_owner
     and b.status = 'draft'
     and b.title = ''
     and b.venue is null
     and b.subtotal_sen = 0
     -- Recent, so that tapping "New bill" weeks later does not silently reopen
     -- a forgotten draft dated last month. Long enough to cover a tab left open
     -- over lunch.
     and b.created_at > pg_catalog.now() - interval '12 hours'
     and not exists (select 1 from public.bill_items i where i.bill_id = b.id)
     and not exists (select 1 from public.participants p where p.bill_id = b.id)
   order by b.created_at desc
   limit 1;

  if v_id is not null then
    return v_id;
  end if;

  -- The quota trigger fires here, exactly as it does for any other insert.
  insert into public.bills (owner_id, service_charge_rate, service_tax_rate)
  values (v_owner, p_service_charge_rate, p_service_tax_rate)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_bill(numeric, numeric) from public, anon;
grant execute on function public.create_bill(numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- The administrator
-- ---------------------------------------------------------------------------
-- Granted by user id rather than by email: the id is what the rows actually key
-- on, it does not change if the address does, and it does not put a personal
-- address in the repository. This is karshengcheah@gmail.com, who owns the
-- project.

update public.profiles
   set bill_quota = null,
       plan = 'unlimited'
 where id = '979e2038-76de-4506-84c4-f8d64017c46d';
