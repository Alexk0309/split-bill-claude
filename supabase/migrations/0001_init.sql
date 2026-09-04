-- Split bill: initial schema, row level security, and the guest join RPCs.
--
-- Security model
-- --------------
-- Payer: authenticated via Supabase Auth. Owns bills; full access to their own
-- rows and nothing else.
--
-- Guest: never authenticates. Presents the bill's `share_token` in an
-- `x-share-token` request header, which grants read access scoped to that one
-- bill's rows. To write, a guest additionally presents their participant's
-- `claim_token` in `x-claim-token`; that grants insert and delete on their own
-- claims and nothing else.
--
-- Tokens travel in headers rather than query strings so they do not end up in
-- server logs or `Referer`.
--
-- Accepted trade-off: anyone holding the share link can pick any name at the
-- table and claim as that person. This is inherent to "guests never sign up" --
-- there is no identity to check against. The blast radius is one bill, the
-- payer sees every claim live, and the payer remains the source of truth for
-- settlement. `claim_token` is nonetheless withheld from guest reads (see the
-- column grants below) so a shared screen or screenshot does not hand out
-- everyone else's write capability.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- URL-safe random token. base64 translated to base64url, padding dropped.
create or replace function public.generate_token(p_bytes int default 16)
returns text
language sql
volatile
set search_path = ''
as $$
  select translate(encode(extensions.gen_random_bytes(p_bytes), 'base64'), '+/=', '-_');
$$;

-- The share token presented by this request, or null. `current_setting` returns
-- null outside PostgREST and an empty string when the header is absent, so both
-- are normalised away before the cast.
create or replace function public.request_share_token()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(
    coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json ->> 'x-share-token',
    ''
  );
$$;

create or replace function public.request_claim_token()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(
    coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json ->> 'x-claim-token',
    ''
  );
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  duitnow_mobile text,
  duitnow_qr_path text,
  created_at timestamptz not null default now()
);

create type public.bill_status as enum ('draft', 'open', 'settled');

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '',
  venue text,
  currency text not null default 'MYR',
  -- Cached sum of bill_items.price_sen, maintained by trigger so it cannot drift.
  subtotal_sen integer not null default 0,
  -- Rates are per bill, not global constants: they change with budgets and the
  -- payer can override them from what the receipt actually says.
  service_charge_rate numeric(6, 5) not null default 0.10 check (service_charge_rate between 0 and 1),
  service_tax_rate numeric(6, 5) not null default 0.06 check (service_tax_rate between 0 and 1),
  rounding_mode text not null default 'sen' check (rounding_mode in ('sen', 'nearest5sen')),
  status public.bill_status not null default 'draft',
  share_token text not null unique default public.generate_token(),
  created_at timestamptz not null default now()
);

create index bills_owner_id_idx on public.bills (owner_id, created_at desc);

create table public.bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete cascade,
  name text not null,
  price_sen integer not null default 0 check (price_sen >= 0),
  "position" integer not null default 0,
  created_at timestamptz not null default now(),
  -- Lets claims reference (item, bill) as a pair, so a claim can never point at
  -- an item on a different bill.
  unique (id, bill_id)
);

create index bill_items_bill_id_idx on public.bill_items (bill_id, "position");

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 60),
  claim_token text not null unique default public.generate_token(),
  settled_at timestamptz,
  settled_method text check (settled_method in ('duitnow', 'cash', 'other')),
  created_at timestamptz not null default now(),
  unique (id, bill_id)
);

create index participants_bill_id_idx on public.participants (bill_id, created_at);

create table public.claims (
  item_id uuid not null,
  participant_id uuid not null,
  -- Denormalised so RLS can scope a claim to its bill in one predicate, and so
  -- the composite foreign keys below can enforce that both sides agree.
  bill_id uuid not null references public.bills (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, participant_id),
  foreign key (item_id, bill_id) references public.bill_items (id, bill_id) on delete cascade,
  foreign key (participant_id, bill_id) references public.participants (id, bill_id) on delete cascade
);

create index claims_bill_id_idx on public.claims (bill_id);
create index claims_participant_id_idx on public.claims (participant_id);

create table public.adjustments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete cascade,
  label text not null,
  amount_sen integer not null default 0 check (amount_sen >= 0),
  scope text not null default 'proportional' check (scope in ('proportional', 'person')),
  scope_person_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint person_scope_names_people
    check (scope = 'proportional' or coalesce(array_length(scope_person_ids, 1), 0) > 0)
);

create index adjustments_bill_id_idx on public.adjustments (bill_id, created_at);

create table public.belanja (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete cascade,
  sponsor_id uuid not null,
  beneficiary_id uuid not null,
  created_at timestamptz not null default now(),
  -- One sponsor per beneficiary, and both must be on this bill.
  unique (bill_id, beneficiary_id),
  constraint no_self_belanja check (sponsor_id <> beneficiary_id),
  foreign key (sponsor_id, bill_id) references public.participants (id, bill_id) on delete cascade,
  foreign key (beneficiary_id, bill_id) references public.participants (id, bill_id) on delete cascade
);

create index belanja_bill_id_idx on public.belanja (bill_id);

-- ---------------------------------------------------------------------------
-- Keep bills.subtotal_sen honest
-- ---------------------------------------------------------------------------

create or replace function public.refresh_bill_subtotal()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_bill_id uuid := coalesce(new.bill_id, old.bill_id);
begin
  update public.bills b
     set subtotal_sen = coalesce(
       (select sum(i.price_sen) from public.bill_items i where i.bill_id = v_bill_id), 0
     )
   where b.id = v_bill_id;
  return null;
end;
$$;

create trigger bill_items_refresh_subtotal
after insert or update or delete on public.bill_items
for each row execute function public.refresh_bill_subtotal();

-- ---------------------------------------------------------------------------
-- Keep adjustment scopes honest
-- ---------------------------------------------------------------------------
-- `scope_person_ids` is an array, so it cannot carry a foreign key. Removing a
-- participant therefore has to prune it by hand, or the split engine would
-- later reject the bill for naming somebody who is no longer on it.

create or replace function public.prune_adjustment_scopes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.adjustments a
     set scope_person_ids = array_remove(a.scope_person_ids, old.id)
   where a.bill_id = old.bill_id
     and old.id = any (a.scope_person_ids);

  -- An adjustment that named only this person no longer applies to anyone.
  delete from public.adjustments a
   where a.bill_id = old.bill_id
     and a.scope = 'person'
     and coalesce(array_length(a.scope_person_ids, 1), 0) = 0;

  return old;
end;
$$;

create trigger participants_prune_adjustment_scopes
before delete on public.participants
for each row execute function public.prune_adjustment_scopes();

-- ---------------------------------------------------------------------------
-- Access predicates
-- ---------------------------------------------------------------------------
-- Both are SECURITY DEFINER so a policy on a child table does not re-enter the
-- parent's own policies. Neither can be used to enumerate anything: each takes
-- an id the caller already has and compares it against a token only the caller
-- can supply.

create or replace function public.owns_bill(p_bill_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bills b
     where b.id = p_bill_id
       and b.owner_id = (select auth.uid())
  );
$$;

create or replace function public.bill_is_shared(p_bill_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bills b
     where b.id = p_bill_id
       and b.share_token = public.request_share_token()
  );
$$;

-- True when the request carries the claim token belonging to this participant.
create or replace function public.is_claim_token_holder(p_participant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.participants p
     where p.id = p_participant_id
       and p.claim_token = public.request_claim_token()
  );
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.bills enable row level security;
alter table public.bill_items enable row level security;
alter table public.participants enable row level security;
alter table public.claims enable row level security;
alter table public.adjustments enable row level security;
alter table public.belanja enable row level security;

-- profiles: the payer, and only the payer, sees their own profile.
create policy "profiles: owner reads" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles: owner inserts" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy "profiles: owner updates" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- bills
create policy "bills: owner reads" on public.bills
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "bills: owner inserts" on public.bills
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "bills: owner updates" on public.bills
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "bills: owner deletes" on public.bills
  for delete to authenticated using (owner_id = (select auth.uid()));

-- A guest sees exactly the one bill whose share token they hold. Granted to
-- `authenticated` as well so a signed-in payer can open someone else's link.
create policy "bills: shared link reads" on public.bills
  for select to anon, authenticated
  using (share_token = public.request_share_token());

-- bill_items
create policy "bill_items: owner all" on public.bill_items
  for all to authenticated using (public.owns_bill(bill_id)) with check (public.owns_bill(bill_id));
create policy "bill_items: shared link reads" on public.bill_items
  for select to anon, authenticated using (public.bill_is_shared(bill_id));

-- participants
create policy "participants: owner all" on public.participants
  for all to authenticated using (public.owns_bill(bill_id)) with check (public.owns_bill(bill_id));
create policy "participants: shared link reads" on public.participants
  for select to anon, authenticated using (public.bill_is_shared(bill_id));

-- adjustments
create policy "adjustments: owner all" on public.adjustments
  for all to authenticated using (public.owns_bill(bill_id)) with check (public.owns_bill(bill_id));
create policy "adjustments: shared link reads" on public.adjustments
  for select to anon, authenticated using (public.bill_is_shared(bill_id));

-- belanja
create policy "belanja: owner all" on public.belanja
  for all to authenticated using (public.owns_bill(bill_id)) with check (public.owns_bill(bill_id));
create policy "belanja: shared link reads" on public.belanja
  for select to anon, authenticated using (public.bill_is_shared(bill_id));

-- claims: the only table a guest may write.
create policy "claims: owner all" on public.claims
  for all to authenticated using (public.owns_bill(bill_id)) with check (public.owns_bill(bill_id));
create policy "claims: shared link reads" on public.claims
  for select to anon, authenticated using (public.bill_is_shared(bill_id));
create policy "claims: guest inserts own" on public.claims
  for insert to anon, authenticated
  with check (public.bill_is_shared(bill_id) and public.is_claim_token_holder(participant_id));
create policy "claims: guest deletes own" on public.claims
  for delete to anon, authenticated
  using (public.bill_is_shared(bill_id) and public.is_claim_token_holder(participant_id));
-- Deliberately no UPDATE policy: a claim is a composite key with nothing to update.

-- ---------------------------------------------------------------------------
-- Column grants
-- ---------------------------------------------------------------------------
-- RLS decides which rows; these decide which columns. Guests read participants
-- to render the table, but must not read anyone's claim_token.

revoke all on public.participants from anon;
grant select (id, bill_id, display_name, settled_at, settled_method, created_at)
  on public.participants to anon;

revoke all on public.profiles from anon;

-- ---------------------------------------------------------------------------
-- Guest RPCs
-- ---------------------------------------------------------------------------
-- Participant creation is mediated rather than granted directly, so a guest can
-- never choose their own claim_token (which would let them mint one for anybody).

-- Join a bill under a new name. Returns the identity the guest stores locally.
create or replace function public.join_bill(p_share_token text, p_display_name text)
returns table (participant_id uuid, claim_token text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_bill_id uuid;
  v_name text := btrim(p_display_name);
begin
  if v_name = '' or length(v_name) > 60 then
    raise exception 'A name of 1 to 60 characters is required';
  end if;

  select b.id into v_bill_id
    from public.bills b
   where b.share_token = p_share_token;

  if v_bill_id is null then
    raise exception 'Unknown share link';
  end if;

  return query
    insert into public.participants (bill_id, display_name)
    values (v_bill_id, v_name)
    returning participants.id, participants.claim_token;
end;
$$;

-- Take an existing name the payer already added. See the trade-off note at the
-- top of this file: holding the link is the only credential there is.
create or replace function public.claim_participant(p_share_token text, p_participant_id uuid)
returns table (participant_id uuid, claim_token text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
    select p.id, p.claim_token
      from public.participants p
      join public.bills b on b.id = p.bill_id
     where p.id = p_participant_id
       and b.share_token = p_share_token;

  if not found then
    raise exception 'Unknown share link or participant';
  end if;
end;
$$;

revoke all on function public.join_bill(text, text) from public;
revoke all on function public.claim_participant(text, uuid) from public;
grant execute on function public.join_bill(text, text) to anon, authenticated;
grant execute on function public.claim_participant(text, uuid) to anon, authenticated;

-- These are internal predicates, not API surface.
revoke all on function public.owns_bill(uuid) from public, anon, authenticated;
revoke all on function public.bill_is_shared(uuid) from public, anon, authenticated;
revoke all on function public.is_claim_token_holder(uuid) from public, anon, authenticated;
revoke all on function public.request_share_token() from public, anon, authenticated;
revoke all on function public.request_claim_token() from public, anon, authenticated;
revoke all on function public.generate_token(int) from public, anon, authenticated;
