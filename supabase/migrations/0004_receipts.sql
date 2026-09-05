-- Receipt photos and their parsed contents.
--
-- Receipts are payer-only, with no guest access of any kind. A receipt photo
-- routinely shows the last four digits of a card, a table number, and a staff
-- name, none of which belong on a link that gets forwarded around a WhatsApp
-- group. The parsed line items reach guests only once the payer has reviewed
-- them and they have become `bill_items`.

create type public.receipt_status as enum ('pending', 'parsed', 'failed');

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete cascade,
  -- Path within the private `receipts` storage bucket.
  storage_path text not null,
  status public.receipt_status not null default 'pending',
  -- The model's output, exactly as parsed and validated. Kept so the review
  -- screen survives a reload, and so a bad parse can be looked at afterwards.
  parsed jsonb,
  confidence text check (confidence in ('high', 'medium', 'low')),
  -- Set when status = 'failed': a bad photo, a non-receipt image, or an API error.
  error text,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

create index receipts_bill_id_idx on public.receipts (bill_id, created_at desc);

alter table public.receipts enable row level security;

create policy "receipts: owner all" on public.receipts
  for all to authenticated
  using (public.owns_bill(bill_id))
  with check (public.owns_bill(bill_id));

-- Deliberately no anon policy. A guest holding the share link cannot read
-- receipts, and `bill_is_shared` is not referenced anywhere in this file.

revoke all on public.receipts from anon;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
-- Private bucket. Objects are keyed `<owner id>/<bill id>/<uuid>.<ext>`, so the
-- first path segment is the only thing the policies need to check.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,
  10485760, -- 10 MB; the client downscales before upload, so this is a backstop
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

create policy "receipts bucket: owner reads own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "receipts bucket: owner uploads own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "receipts bucket: owner deletes own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- Replacing a bill's items from a reviewed receipt
-- ---------------------------------------------------------------------------
-- Done in one transaction so a bill is never briefly half-empty while somebody
-- is claiming from it. `p_items` is the payer's *edited* list, not the model's
-- output: nothing reaches this function without having been on screen first.

create or replace function public.replace_bill_items(
  p_bill_id uuid,
  p_items jsonb,
  p_service_charge_rate numeric default null,
  p_service_tax_rate numeric default null,
  p_venue text default null
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_item jsonb;
  v_position integer := 0;
begin
  -- security invoker, so the caller's row level security decides whether they
  -- may touch this bill at all. A forged bill id gets zero rows updated.
  if not public.owns_bill(p_bill_id) then
    raise exception 'Not your bill';
  end if;

  delete from public.bill_items where bill_id = p_bill_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.bill_items (bill_id, name, price_sen, "position")
    values (
      p_bill_id,
      btrim(v_item ->> 'name'),
      (v_item ->> 'price_sen')::integer,
      v_position
    );
    v_position := v_position + 1;
  end loop;

  update public.bills
     set service_charge_rate = coalesce(p_service_charge_rate, service_charge_rate),
         service_tax_rate = coalesce(p_service_tax_rate, service_tax_rate),
         venue = coalesce(nullif(btrim(p_venue), ''), venue)
   where id = p_bill_id;
end;
$$;

revoke all on function public.replace_bill_items(uuid, jsonb, numeric, numeric, text) from public, anon;
grant execute on function public.replace_bill_items(uuid, jsonb, numeric, numeric, text) to authenticated;
