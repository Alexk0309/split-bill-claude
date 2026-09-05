/**
 * Row level security, checked against a real project.
 *
 *   RUN_DB_INTEGRATION=1 npx vitest run lib/supabase/__tests__/rls.integration.test.ts
 *
 * The pgTAP suite in supabase/tests covers the same ground and needs Docker.
 * This one needs only the keys in .env.local, and it exercises the policies
 * through the same client library the app uses -- which is how it caught a bug
 * pgTAP could not have: `select('*')` on a table with column-level grants is
 * refused outright, so the app has to name its columns.
 *
 * It creates two bills, does its work, and deletes them in a finally block.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Columns a guest is granted on `participants`; the app must ask for these. */
const GUEST_PARTICIPANT_COLUMNS = 'id, bill_id, display_name, settled_at, settled_method, created_at';

function envLocal(): Record<string, string> {
  const path = resolve(process.cwd(), '.env.local');
  const env: Record<string, string> = {};
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = { ...envLocal(), ...process.env };
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = process.env.RUN_DB_INTEGRATION === '1' && Boolean(URL_ && ANON && SERVICE);

const guestClient = (shareToken: string, claimToken?: string): SupabaseClient =>
  createClient(URL_!, ANON!, {
    auth: { persistSession: false },
    global: {
      headers: {
        'x-share-token': shareToken,
        ...(claimToken ? { 'x-claim-token': claimToken } : {}),
      },
    },
  });

describe.runIf(enabled)('row level security against a live project', () => {
  let admin: SupabaseClient;
  let billA: { id: string; share_token: string };
  let billB: { id: string; share_token: string };
  let items: { id: string }[];
  let aina: { id: string; claim_token: string };
  let ben: { id: string };

  beforeAll(async () => {
    admin = createClient(URL_!, SERVICE!, { auth: { persistSession: false } });

    const { data: users } = await admin.auth.admin.listUsers();
    const owner = users?.users[0];
    if (!owner) throw new Error('No user in this project; sign in through the app once first.');

    const { data: billRows } = await admin
      .from('bills')
      .insert([
        { owner_id: owner.id, title: 'RLS check A' },
        { owner_id: owner.id, title: 'RLS check B' },
      ])
      .select('id, share_token');
    const bills = (billRows ?? []) as { id: string; share_token: string }[];
    if (bills.length !== 2) throw new Error('could not create the two test bills');
    [billA, billB] = [bills[0]!, bills[1]!];

    const { data: itemRows } = await admin
      .from('bill_items')
      .insert([
        { bill_id: billA.id, name: 'Nasi lemak', price_sen: 1800, position: 0 },
        { bill_id: billA.id, name: 'Sotong', price_sen: 3200, position: 1 },
      ])
      .select('id');
    items = itemRows as { id: string }[];

    await admin
      .from('bill_items')
      .insert({ bill_id: billB.id, name: 'Another table', price_sen: 9999, position: 0 });

    const { data: peopleRows } = await admin
      .from('participants')
      .insert([
        { bill_id: billA.id, display_name: 'Aina' },
        { bill_id: billA.id, display_name: 'Ben' },
      ])
      .select('id, claim_token');
    const people = (peopleRows ?? []) as { id: string; claim_token: string }[];
    if (people.length !== 2) throw new Error('could not create the two test participants');
    [aina, ben] = [people[0]!, people[1]!];
  }, 60_000);

  afterAll(async () => {
    if (admin) {
      if (billA) await admin.from('bills').delete().eq('id', billA.id);
      if (billB) await admin.from('bills').delete().eq('id', billB.id);
    }
  }, 60_000);

  it('maintains the cached subtotal by trigger', async () => {
    const { data } = await admin.from('bills').select('subtotal_sen').eq('id', billA.id).single();
    expect(data?.subtotal_sen).toBe(5000);
  });

  it('shows a guest their own bill and no other', async () => {
    const guest = guestClient(billA.share_token);

    const { data: mine } = await guest.from('bills').select('id, title');
    expect(mine).toHaveLength(1);
    expect(mine?.[0]?.title).toBe('RLS check A');

    // The headline claim of the whole security model.
    const { data: theirs } = await guest.from('bills').select('id').eq('id', billB.id);
    expect(theirs ?? []).toHaveLength(0);
  });

  it('scopes items to the bill the link points at', async () => {
    const guest = guestClient(billA.share_token);
    const { data, error } = await guest.from('bill_items').select('*');
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });

  it('refuses select(*) on participants, which is what protects claim_token', async () => {
    const guest = guestClient(billA.share_token);
    const { error } = await guest.from('participants').select('*');
    expect(error?.code).toBe('42501');
  });

  it('serves the columns a guest is actually granted', async () => {
    // The bug this pins: the app used select('*') here, so every guest page
    // silently loaded zero participants.
    const guest = guestClient(billA.share_token);
    const { data, error } = await guest.from('participants').select(GUEST_PARTICIPANT_COLUMNS);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data?.[0]).not.toHaveProperty('claim_token');
  });

  it('lets a guest claim and unclaim as themselves', async () => {
    const guest = guestClient(billA.share_token, aina.claim_token);

    const { error: claimError } = await guest
      .from('claims')
      .upsert(
        { item_id: items[0]!.id, participant_id: aina.id, bill_id: billA.id },
        { onConflict: 'item_id,participant_id', ignoreDuplicates: true },
      );
    expect(claimError).toBeNull();

    const { data: visible } = await guestClient(billA.share_token).from('claims').select('*');
    expect(visible).toHaveLength(1);

    const { error: deleteError } = await guest
      .from('claims')
      .delete()
      .eq('item_id', items[0]!.id)
      .eq('participant_id', aina.id);
    expect(deleteError).toBeNull();
  });

  it('stops a guest claiming as somebody else at the same table', async () => {
    const guest = guestClient(billA.share_token, aina.claim_token);
    const { error } = await guest
      .from('claims')
      .insert({ item_id: items[0]!.id, participant_id: ben.id, bill_id: billA.id });
    expect(error?.code).toBe('42501');
  });

  it('lets a guest join under a new name without minting their own token', async () => {
    const guest = guestClient(billA.share_token);
    const { data, error } = await guest.rpc('join_bill', {
      p_share_token: billA.share_token,
      p_display_name: 'Walk-in',
    });
    const row = Array.isArray(data) ? data[0] : data;
    expect(error).toBeNull();
    expect(row?.claim_token).toBeTruthy();

    const { error: forged } = await guest
      .from('participants')
      .insert({ bill_id: billA.id, display_name: 'Impostor', claim_token: 'chosen-by-me' });
    expect(forged?.code).toBe('42501');
  });

  it('never lets a guest write their own payment proof', async () => {
    // The whole reason the server holds the service role key.
    const guest = guestClient(billA.share_token, aina.claim_token);
    const { error } = await guest
      .from('payment_proofs')
      .insert({ bill_id: billA.id, participant_id: aina.id, expected_sen: 100, matched: true });
    expect(error?.code).toBe('42501');
  });

  it('keeps receipts and profiles away from guests entirely', async () => {
    const guest = guestClient(billA.share_token);
    const { error: receiptError } = await guest.from('receipts').select('*');
    expect(receiptError?.code).toBe('42501');

    const { data: profiles } = await guest.from('profiles').select('*');
    expect(profiles ?? []).toHaveLength(0);
  });

  it('closes everything to a guest with no token at all', async () => {
    const stranger = createClient(URL_!, ANON!, { auth: { persistSession: false } });
    const { data: bills } = await stranger.from('bills').select('id');
    expect(bills ?? []).toHaveLength(0);
    const { data: claims } = await stranger.from('claims').select('*');
    expect(claims ?? []).toHaveLength(0);
  });
});
