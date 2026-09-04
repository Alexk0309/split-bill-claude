-- Live claiming.
--
-- Why broadcast rather than postgres_changes
-- ------------------------------------------
-- A guest's read access is granted by an `x-share-token` request header, which
-- PostgREST exposes to row level security as `request.headers`. Realtime does
-- not set that setting, so `public.bill_is_shared()` is false inside a Realtime
-- connection and `postgres_changes` would deliver a guest nothing at all.
--
-- So changes are announced over a broadcast channel instead. The topic is
-- derived from the bill's share token, which is already the only credential a
-- guest has: knowing the topic and knowing the link are the same thing.
--
-- The payload deliberately carries no row data -- only which table changed.
-- Clients treat an event purely as "something moved, go and look", and refetch
-- through PostgREST where row level security still applies. That means a forged
-- broadcast can cost a client one wasted request and nothing else: it can never
-- put data on someone's screen, and it can never read any.

create or replace function public.broadcast_bill_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_bill_id uuid;
  v_token text;
begin
  v_row := to_jsonb(case when tg_op = 'DELETE' then old else new end);

  -- Child tables carry bill_id; `bills` itself is identified by its own id.
  v_bill_id := coalesce((v_row ->> 'bill_id')::uuid, (v_row ->> 'id')::uuid);
  if v_bill_id is null then
    return null;
  end if;

  select b.share_token into v_token from public.bills b where b.id = v_bill_id;
  if v_token is null then
    return null;
  end if;

  -- Best effort, always. A bill must never fail to save because the realtime
  -- layer is unavailable, mid-upgrade, or missing the function entirely.
  begin
    perform realtime.send(
      jsonb_build_object('table', tg_table_name, 'op', tg_op),
      'bill_change',
      'bill:' || v_token,
      false
    );
  exception
    when others then null;
  end;

  return null;
end;
$$;

revoke all on function public.broadcast_bill_change() from public, anon, authenticated;

-- Claims are the reason this exists: seven people tapping at once.
create trigger claims_broadcast
after insert or update or delete on public.claims
for each row execute function public.broadcast_bill_change();

-- The payer edits the bill while everyone is claiming it, so those move too.
create trigger bill_items_broadcast
after insert or update or delete on public.bill_items
for each row execute function public.broadcast_bill_change();

create trigger participants_broadcast
after insert or update or delete on public.participants
for each row execute function public.broadcast_bill_change();

create trigger adjustments_broadcast
after insert or update or delete on public.adjustments
for each row execute function public.broadcast_bill_change();

create trigger belanja_broadcast
after insert or update or delete on public.belanja
for each row execute function public.broadcast_bill_change();

-- Rate and title changes reprice everyone's share, so they are worth announcing.
create trigger bills_broadcast
after update on public.bills
for each row execute function public.broadcast_bill_change();
