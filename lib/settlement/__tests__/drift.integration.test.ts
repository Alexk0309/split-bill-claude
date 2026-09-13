/**
 * Live check that a share moving after somebody has paid is actually detected,
 * against the real database rather than a fixture. Needs network and writes
 * rows, so it is opt-in and never runs as part of `npm test`:
 *
 *   RUN_DRIFT_INTEGRATION=1 npx vitest run lib/settlement/__tests__/drift.integration.test.ts
 *
 * It reproduces the reported case exactly: a dish four people will share, two
 * of them claim it, one pays what they are shown, and then the other two claim.
 * The unit tests prove the arithmetic; this proves the column is written, is
 * readable through the guest's column allowlist, and that the engine's
 * recomputation and the stored figure actually disagree when they should.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

import { loadOwnerBill } from '@/lib/bill/load';
import { toBillInput } from '@/lib/bill/to-engine-input';
import { createAdminClient } from '@/lib/supabase/admin';
import { settlementDrift } from '../drift';
import { computeSplit } from '@/lib/split';

/** Next loads .env.local for the app; vitest does not, so do it by hand. */
function loadEnv(): void {
  for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) process.env[match[1]!] = match[2]!.trim();
  }
}

const RUN = process.env.RUN_DRIFT_INTEGRATION === '1';
const ADMIN_ID = '979e2038-76de-4506-84c4-f8d64017c46d';

const created: string[] = [];
// The app's own service-role client, so this exercises the real thing rather
// than a hand-rolled one that might be configured differently.
let admin: ReturnType<typeof createAdminClient>;

afterAll(async () => {
  for (const id of created) await admin.from('bills').delete().eq('id', id);
});

describe.skipIf(!RUN)('a share that moves after somebody has paid', () => {
  it('is detected, end to end', async () => {
    loadEnv();
    admin = createAdminClient();

    // A bill with one dish that four people will share, and no charges, so the
    // only thing moving is the divisor.
    const { data: bill } = await admin
      .from('bills')
      .insert({ owner_id: ADMIN_ID, title: 'Drift check', service_charge_rate: 0, service_tax_rate: 0 })
      .select('id')
      .single();
    const billId = (bill as { id: string }).id;
    created.push(billId);

    const { data: item } = await admin
      .from('bill_items')
      .insert({ bill_id: billId, name: 'Steamboat set (for 4)', price_sen: 20000, position: 0 })
      .select('id')
      .single();
    const itemId = (item as { id: string }).id;

    const { data: people } = await admin
      .from('participants')
      .insert(['Ali', 'Siti', 'Chong', 'Devi'].map((display_name) => ({ bill_id: billId, display_name })))
      .select('id, display_name');
    const idOf = (name: string) =>
      (people as { id: string; display_name: string }[]).find((p) => p.display_name === name)!.id;

    const claim = (name: string) =>
      admin.from('claims').insert({ bill_id: billId, item_id: itemId, participant_id: idOf(name) });

    const dueFor = async (name: string) => {
      const bundle = await loadOwnerBill(admin, billId);
      const split = computeSplit(toBillInput(bundle!));
      return split.people.find((p) => p.personId === idOf(name))!.amountDueSen;
    };

    // --- Ali and Siti claim it. Ali is shown half and pays that. -----------
    await claim('Ali');
    await claim('Siti');
    const shownToAli = await dueFor('Ali');
    expect(shownToAli).toBe(10000);

    await admin
      .from('participants')
      .update({
        settled_at: new Date().toISOString(),
        settled_method: 'duitnow',
        settled_amount_sen: shownToAli,
      })
      .eq('id', idOf('Ali'));

    // Nothing is wrong yet, and nothing should be claimed to be.
    expect(settlementDrift(shownToAli, await dueFor('Ali')).kind).toBe('square');

    // --- Chong and Devi finally tap the same dish. -------------------------
    await claim('Chong');
    await claim('Devi');

    const owedNow = await dueFor('Ali');
    expect(owedNow).toBe(5000);

    // Read it back the way a screen does, not from the variable we just wrote.
    const { data: aliRow } = await admin
      .from('participants')
      .select('settled_at, settled_amount_sen')
      .eq('id', idOf('Ali'))
      .single();
    const stored = (aliRow as { settled_amount_sen: number | null } | null)?.settled_amount_sen ?? null;
    expect(stored).toBe(10000);

    const drift = settlementDrift(stored, owedNow);
    expect(drift).toEqual({ kind: 'overpaid', deltaSen: 5000 });
  });

  it('lets a guest read their own settled amount through the column allowlist', async () => {
    // The guest client is granted named columns, not `select *`. A column that
    // is not granted comes back as an error, not as null -- which is how the
    // participants list silently loaded zero rows once before.
    const { data: bill } = await admin.from('bills').select('share_token').eq('id', created[0]!).single();
    const shareToken = String((bill as { share_token: string } | null)?.share_token);

    const guest = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
      global: { headers: { 'x-share-token': shareToken } },
    });

    const { data, error } = await guest
      .from('participants')
      .select('id, display_name, settled_at, settled_method, settled_amount_sen, created_at')
      .eq('bill_id', created[0]!);

    expect(error).toBeNull();
    const ali = (data ?? []).find((p) => (p as { display_name: string }).display_name === 'Ali');
    expect((ali as { settled_amount_sen: number | null }).settled_amount_sen).toBe(10000);
  });
});
