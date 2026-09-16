-- Items that divide a fixed number of ways, and a payer who exists on their
-- own bill.
--
-- Until now an item was divided by whoever had claimed it so far, which makes a
-- share provisional: two people claiming a set for four are each charged half
-- until the other two tap it. Correct at every instant, wrong to act on, and
-- people act on it -- see 0010, which exists to catch the damage after the
-- fact. Pinning the divisor removes the cause: the figure somebody is shown at
-- the moment they tap is the figure they owe.
--
-- Two rules follow from that and both have to live here, not only in the UI:
-- no more claimants than portions, and no lowering the portion count below the
-- claims already made. Guests write claims directly under row level security,
-- so a check that only exists in the client is not a check.

alter table public.bill_items
  add column portions integer check (portions is null or (portions >= 1 and portions <= 99));

comment on column public.bill_items.portions is
  'How many ways this line divides, when known up front. Null means divide by '
  'whoever claims it. Set, it pins the divisor: each claimant pays price/portions '
  'and portions nobody takes stay unallocated rather than landing on whoever was '
  'fastest.';

-- ---------------------------------------------------------------------------
-- No more claimants than portions
-- ---------------------------------------------------------------------------
-- `for update` on the line is what makes this hold for the last portion: two
-- guests tapping at once would otherwise both count four taken out of five and
-- both insert.
--
-- Security definer because the guest role can read bill_items but cannot lock a
-- row in it, and the lock is the point.

create or replace function public.enforce_item_portions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_portions integer;
  v_taken integer;
begin
  select portions
    into v_portions
    from public.bill_items
   where id = new.item_id
   for update;

  -- No fixed divisor: any number of people may share it, as before.
  if v_portions is null then
    return new;
  end if;

  select count(*) into v_taken from public.claims where item_id = new.item_id;

  if v_taken >= v_portions then
    raise exception 'ITEM_PORTIONS_FULL'
      using hint = 'Every portion of this item has already been claimed.';
  end if;

  return new;
end;
$$;

create trigger claims_enforce_portions
before insert on public.claims
for each row execute function public.enforce_item_portions();

revoke all on function public.enforce_item_portions() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Nor fewer portions than claimants
-- ---------------------------------------------------------------------------
-- The other direction: a payer editing "for 4" down to "for 2" after three
-- people have claimed would leave the engine unable to compute the bill at all,
-- because it refuses to re-divide behind people's backs. Caught at the source
-- instead, where it can still be explained.

create or replace function public.enforce_portions_cover_claims()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_taken integer;
begin
  if new.portions is null then
    return new;
  end if;

  select count(*) into v_taken from public.claims where item_id = new.id;

  if v_taken > new.portions then
    raise exception 'PORTIONS_BELOW_CLAIMS'
      using hint = 'More people have already claimed this item than that.';
  end if;

  return new;
end;
$$;

create trigger bill_items_enforce_portions_cover_claims
before update on public.bill_items
for each row execute function public.enforce_portions_cover_claims();

revoke all on function public.enforce_portions_cover_claims() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The payer, on their own bill
-- ---------------------------------------------------------------------------
-- The payer ate too. They could always add their own name under "Who was
-- there", but nothing let them claim an item, so their portion of a shared dish
-- had no way to be taken -- which is precisely the portion that would otherwise
-- sit unallocated forever once the divisor is pinned.
--
-- Not granted to anon: which participant is the account holder is nobody else's
-- business, and the guest column allowlist deliberately does not name it.

alter table public.participants
  add column user_id uuid references auth.users (id) on delete set null;

create unique index participants_bill_user_idx
  on public.participants (bill_id, user_id)
  where user_id is not null;

comment on column public.participants.user_id is
  'Set on the row representing the bill owner themselves. At most one per bill. '
  'Never exposed to guests.';
