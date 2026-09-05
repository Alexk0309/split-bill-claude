-- Row level security tests.
--
-- Run with: supabase test db
-- (requires Docker and the Supabase CLI; see README "Database setup".)
--
-- The question these answer: can somebody holding one share link reach anything
-- they should not -- another bill, another person's write capability, or a
-- column they were never granted?

begin;
-- no_plan rather than a hand-maintained count: the suite is linear with no
-- conditional skips, so an explicit plan buys nothing here and has twice failed
-- the whole run over a miscount rather than a real fault. finish() still
-- reports how many assertions ran.
select no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures: two unrelated bills owned by two different payers.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'payer.a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'payer.b@example.test');

insert into public.bills (id, owner_id, title, share_token) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Bill A', 'share-token-a'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Bill B', 'share-token-b');

insert into public.bill_items (id, bill_id, name, price_sen) values
  ('a1111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Nasi lemak', 1800),
  ('b1111111-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'Ribeye', 7500);

insert into public.participants (id, bill_id, display_name, claim_token) values
  ('a2222222-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Aina', 'claim-token-aina'),
  ('a2222222-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Ben', 'claim-token-ben'),
  ('b2222222-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000002', 'Chong', 'claim-token-chong');

-- ---------------------------------------------------------------------------
-- The trigger keeps the cached subtotal honest.
-- ---------------------------------------------------------------------------

select is(
  (select subtotal_sen from public.bills where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1800,
  'subtotal_sen is maintained by trigger on insert'
);

-- ---------------------------------------------------------------------------
-- Guest holding bill A's share token
-- ---------------------------------------------------------------------------

set local role anon;
set local request.headers = '{"x-share-token":"share-token-a"}';

select is(
  (select count(*)::int from public.bills),
  1,
  'guest sees exactly one bill'
);

select is(
  (select title from public.bills),
  'Bill A',
  'guest sees the bill their link points at'
);

select is(
  (select count(*)::int from public.bills where title = 'Bill B'),
  0,
  'GUEST CANNOT READ ANOTHER BILL'
);

select is(
  (select count(*)::int from public.bill_items),
  1,
  'guest sees only their bill''s items'
);

select is(
  (select count(*)::int from public.bill_items where name = 'Ribeye'),
  0,
  'guest cannot read another bill''s items'
);

select is(
  (select count(*)::int from public.participants),
  2,
  'guest sees only their bill''s participants'
);

select is(
  (select count(*)::int from public.participants where display_name = 'Chong'),
  0,
  'guest cannot read another bill''s participants'
);

-- Column grant: display names yes, claim tokens no.
select throws_ok(
  'select claim_token from public.participants',
  '42501',
  null,
  'guest cannot read anyone''s claim_token'
);

-- Reads on a bill they hold no token for stay empty even when the id is known.
select is(
  (select count(*)::int from public.bill_items
    where bill_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0,
  'naming another bill''s id explicitly does not bypass the policy'
);

-- ---------------------------------------------------------------------------
-- Guest writes: only their own claims, only on their own bill
-- ---------------------------------------------------------------------------

set local request.headers = '{"x-share-token":"share-token-a","x-claim-token":"claim-token-aina"}';

select lives_ok(
  $$insert into public.claims (item_id, participant_id, bill_id)
    values ('a1111111-0000-0000-0000-000000000001',
            'a2222222-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001')$$,
  'guest can claim an item as themselves'
);

select is(
  (select count(*)::int from public.claims),
  1,
  'the claim is visible to the guest'
);

select throws_ok(
  $$insert into public.claims (item_id, participant_id, bill_id)
    values ('a1111111-0000-0000-0000-000000000001',
            'a2222222-0000-0000-0000-000000000002',
            'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'guest cannot claim an item as somebody else at the same table'
);

select throws_ok(
  $$insert into public.claims (item_id, participant_id, bill_id)
    values ('b1111111-0000-0000-0000-000000000002',
            'b2222222-0000-0000-0000-000000000003',
            'bbbbbbbb-0000-0000-0000-000000000002')$$,
  '42501',
  null,
  'guest cannot claim anything on another bill'
);

select lives_ok(
  $$delete from public.claims
     where item_id = 'a1111111-0000-0000-0000-000000000001'
       and participant_id = 'a2222222-0000-0000-0000-000000000001'$$,
  'guest can unclaim their own claim'
);

-- Everything else on the bill is read-only to a guest.
select throws_ok(
  $$update public.bills set title = 'Hijacked' where share_token = 'share-token-a'$$,
  '42501',
  null,
  'guest cannot edit the bill'
);

select throws_ok(
  $$insert into public.bill_items (bill_id, name, price_sen)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'Snuck in', 9999)$$,
  '42501',
  null,
  'guest cannot add line items'
);

select throws_ok(
  $$delete from public.bill_items where bill_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'guest cannot delete line items'
);

select throws_ok(
  $$insert into public.participants (bill_id, display_name, claim_token)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'Impostor', 'chosen-by-me')$$,
  '42501',
  null,
  'guest cannot mint a participant with a claim_token of their choosing'
);

-- ---------------------------------------------------------------------------
-- A guest with no token at all sees nothing
-- ---------------------------------------------------------------------------

set local request.headers = '{}';

select is((select count(*)::int from public.bills), 0, 'no share token, no bills');
select is((select count(*)::int from public.bill_items), 0, 'no share token, no items');
select is((select count(*)::int from public.claims), 0, 'no share token, no claims');

-- ---------------------------------------------------------------------------
-- The payer sees their own bills and nobody else's
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local request.headers = '{}';

select is(
  (select count(*)::int from public.bills),
  1,
  'payer sees their own bill'
);

select is(
  (select title from public.bills),
  'Bill A',
  'payer sees the right bill'
);

select is(
  (select count(*)::int from public.bill_items where name = 'Ribeye'),
  0,
  'payer cannot read another payer''s items'
);

-- ---------------------------------------------------------------------------
-- Policies can actually call their own predicates
-- ---------------------------------------------------------------------------
-- Postgres checks EXECUTE on a function called from a policy against the role
-- running the query. Revoking it from anon/authenticated locks everyone out of
-- every table, which is a failure mode that looks like an empty database
-- rather than an error.

select ok(
  has_function_privilege('authenticated', 'public.owns_bill(uuid)', 'execute')
    and has_function_privilege('anon', 'public.bill_is_shared(uuid)', 'execute')
    and has_function_privilege('anon', 'public.is_claim_token_holder(uuid)', 'execute')
    and has_function_privilege('anon', 'public.request_share_token()', 'execute'),
  'policy predicate functions are executable by the roles whose policies call them'
);

-- ---------------------------------------------------------------------------
-- Live claiming: the broadcast trigger is wired, and cannot break a write
-- ---------------------------------------------------------------------------
-- The guest insert above already ran with this trigger installed, which is the
-- assertion that matters: announcing a change must never be able to stop one.

reset role;

select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.claims'::regclass
      and tgname = 'claims_broadcast'),
  1,
  'claims announce changes to the bill channel'
);

select lives_ok(
  $$insert into public.claims (item_id, participant_id, bill_id)
    values ('b1111111-0000-0000-0000-000000000002',
            'b2222222-0000-0000-0000-000000000003',
            'bbbbbbbb-0000-0000-0000-000000000002')$$,
  'a claim still saves even if the realtime layer is unavailable'
);

-- ---------------------------------------------------------------------------
-- The writes each role actually performs
-- ---------------------------------------------------------------------------
-- Asserting privileges in the abstract missed a whole class of bug twice: a
-- column DEFAULT is evaluated as the *inserting* role, so `generate_token`
-- being revoked from `authenticated` made creating a bill fail even though
-- every policy was correct. These do the real inserts instead.

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local request.headers = '{}';

select lives_ok(
  $$insert into public.bills (owner_id, title)
    values ('11111111-1111-1111-1111-111111111111', 'Created by the payer')$$,
  'payer can create a bill, so the share_token default is callable by the inserter'
);

select lives_ok(
  $$insert into public.participants (bill_id, display_name)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'Added by the payer')$$,
  'payer can add a participant, so the claim_token default is callable too'
);

select lives_ok(
  $$insert into public.bill_items (bill_id, name, price_sen)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'Added by the payer', 500)$$,
  'payer can add an item, so neither trigger blocks the write'
);

select is(
  (select subtotal_sen from public.bills where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  2300,
  'the subtotal trigger ran as the payer and updated the bill'
);

-- A guest reaches the same defaults through a SECURITY DEFINER function, which
-- evaluates them as the owner. `anon` is deliberately not granted them.
reset role;
set local role anon;
set local request.jwt.claims = '';
set local request.headers = '{"x-share-token":"share-token-a"}';

select lives_ok(
  $$select public.join_bill('share-token-a', 'Walk-in guest')$$,
  'guest can join without being granted the token function directly'
);

select * from finish();
rollback;
