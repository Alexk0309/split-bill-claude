-- Usage quotas.
--
-- Two things are metered: how many bills an account may ever create, and how
-- many images each bill may send to the vision API. Both cost real money, and
-- both were previously unbounded per account.
--
-- The bill count is deliberately a monotonic counter rather than
-- `count(*) from bills`. Deleting a bill must not hand the allowance back, or
-- the limit is one delete away from meaningless. What is metered is bills ever
-- created, which is also what actually consumed the resource.
--
-- Everything here is shaped for a paid tier arriving later: the ceiling lives on
-- the profile as `bill_quota`, so raising it for one account is an UPDATE rather
-- than a migration, and `plan` is there to hang that off.

alter table public.profiles
  -- Monotonic. Never decremented, including when a bill is deleted.
  add column bills_created integer not null default 0,
  add column bill_quota integer not null default 3,
  add column plan text not null default 'free' check (plan in ('free', 'paid'));

alter table public.bills
  -- Also monotonic, for the same reason: re-scanning is what costs money,
  -- whether or not the result was kept.
  add column receipt_scans_used integer not null default 0,
  add column proof_scans_used integer not null default 0;

-- ---------------------------------------------------------------------------
-- Every account has a profile
-- ---------------------------------------------------------------------------
-- Until now a profile row appeared only when the payer saved their DuitNow
-- details, which made "where is this account's quota" ambiguous. One row per
-- account from signup onwards.

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

-- Accounts that predate the trigger.
insert into public.profiles (id)
select u.id from auth.users u
on conflict (id) do nothing;

-- Existing bills should count against their owner's allowance rather than being
-- free, so the counter starts from what each account has already made.
update public.profiles p
   set bills_created = coalesce(counted.n, 0)
  from (select owner_id, count(*)::int as n from public.bills group by owner_id) counted
 where counted.owner_id = p.id;

-- ---------------------------------------------------------------------------
-- Enforcing the bill quota
-- ---------------------------------------------------------------------------
-- In the database rather than only in the action, so it holds however the row
-- is inserted. `for update` locks the profile so two simultaneous creations
-- cannot both read the same count and both pass.

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

  if v_created >= v_quota then
    raise exception 'BILL_QUOTA_REACHED'
      using hint = 'This account has used all of its bills.';
  end if;

  update public.profiles
     set bills_created = bills_created + 1
   where id = new.owner_id;

  return new;
end;
$$;

create trigger bills_enforce_quota
before insert on public.bills
for each row execute function public.enforce_bill_quota();

-- ---------------------------------------------------------------------------
-- Spending a scan
-- ---------------------------------------------------------------------------
-- One statement, so the check and the increment cannot be separated by a second
-- request: the `where ... < p_limit` is the check, and a row comes back only if
-- it passed. Returns the new count, or null when the allowance is gone.
--
-- The limit is passed in rather than stored here so that the number the user is
-- shown and the number enforced come from the same constant in lib/limits.ts.

create or replace function public.consume_scan(
  p_bill_id uuid,
  p_kind text,
  p_limit integer
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_used integer;
begin
  if p_kind = 'receipt' then
    update public.bills
       set receipt_scans_used = receipt_scans_used + 1
     where id = p_bill_id
       and receipt_scans_used < p_limit
    returning receipt_scans_used into v_used;
  elsif p_kind = 'proof' then
    update public.bills
       set proof_scans_used = proof_scans_used + 1
     where id = p_bill_id
       and proof_scans_used < p_limit
    returning proof_scans_used into v_used;
  else
    raise exception 'Unknown scan kind: %', p_kind;
  end if;

  return v_used;
end;
$$;

revoke all on function public.consume_scan(uuid, text, integer) from public, anon;
-- The payer scans receipts with their own session. Guest proof uploads go
-- through the server's service role, which needs no grant.
grant execute on function public.consume_scan(uuid, text, integer) to authenticated;

revoke all on function public.enforce_bill_quota() from public, anon, authenticated;
revoke all on function public.create_profile_for_new_user() from public, anon, authenticated;
