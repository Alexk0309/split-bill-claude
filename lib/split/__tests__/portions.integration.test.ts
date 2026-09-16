/**
 * Live check of the two rules that cannot live in the client.
 *
 * Guests write claims directly under row level security, so "no more claimants
 * than portions" is only real if the database enforces it -- and the hard case
 * is two people tapping the last portion at the same moment, which no amount of
 * client-side checking can catch. Opt-in, because it needs network and writes
 * rows:
 *
 *   RUN_PORTIONS_INTEGRATION=1 npx vitest run lib/split/__tests__/portions.integration.test.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { loadOwnerBill } from '@/lib/bill/load';
import { toBillInput } from '@/lib/bill/to-engine-input';
import { createAdminClient } from '@/lib/supabase/admin';
import { computeSplit } from '@/lib/split';

function loadEnv(): void {
  for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) process.env[match[1]!] = match[2]!.trim();
  }
}

const RUN = process.env.RUN_PORTIONS_INTEGRATION === '1';
const ADMIN_ID = '979e2038-76de-4506-84c4-f8d64017c46d';

let admin: ReturnType<typeof createAdminClient>;
const created: string[] = [];

afterAll(async () => {
  for (const id of created) await admin.from('bills').delete().eq('id', id);
});

describe.skipIf(!RUN)('portions, enforced by the database', () => {
  it('lets exactly four of five simultaneous claims through', async () => {
    loadEnv();
    admin = createAdminClient();

    const { data: bill } = await admin
      .from('bills')
      .insert({ owner_id: ADMIN_ID, title: 'Portions check', service_charge_rate: 0, service_tax_rate: 0 })
      .select('id')
      .single();
    const billId = String((bill as { id: string }).id);
    created.push(billId);

    const { data: item } = await admin
      .from('bill_items')
      .insert({ bill_id: billId, name: 'Steamboat set', price_sen: 20000, position: 0, portions: 4 })
      .select('id')
      .single();
    const itemId = String((item as { id: string }).id);

    const { data: people } = await admin
      .from('participants')
      .insert(
        ['Ali', 'Siti', 'Chong', 'Devi', 'Eli'].map((display_name) => ({ bill_id: billId, display_name })),
      )
      .select('id, display_name');
    const rows = people as { id: string; display_name: string }[];

    // All five at once. Four portions, so one must lose -- and which one is
    // nobody's business, only that the count is right.
    const results = await Promise.all(
      rows.map((p) =>
        admin.from('claims').insert({ bill_id: billId, item_id: itemId, participant_id: p.id }),
      ),
    );

    const ok = results.filter((r) => !r.error).length;
    const refused = results.filter((r) => String(r.error?.message ?? '').includes('ITEM_PORTIONS_FULL'));
    expect(ok).toBe(4);
    expect(refused).toHaveLength(1);

    const { count } = await admin
      .from('claims')
      .select('*', { count: 'exact', head: true })
      .eq('item_id', itemId);
    expect(count).toBe(4);

    // And the engine agrees: four quarters, nothing held back, nothing leaked.
    const bundle = await loadOwnerBill(admin, billId);
    const split = computeSplit(toBillInput(bundle!));
    expect(split.unallocatedSen).toBe(0);
    for (const person of split.people) {
      expect([0, 5000]).toContain(person.amountDueSen);
    }
    expect(split.people.reduce((acc, p) => acc + p.amountDueSen, 0)).toBe(20000);
  });

  it('holds a partly claimed line back rather than charging it to the fast', async () => {
    const billId = created[0]!;
    const { data: item } = await admin
      .from('bill_items')
      .insert({ bill_id: billId, name: 'Fish head curry', price_sen: 9000, position: 1, portions: 3 })
      .select('id')
      .single();
    const itemId = String((item as { id: string }).id);

    const { data: people } = await admin.from('participants').select('id').eq('bill_id', billId).limit(1);
    await admin
      .from('claims')
      .insert({ bill_id: billId, item_id: itemId, participant_id: String((people as { id: string }[])[0]!.id) });

    const bundle = await loadOwnerBill(admin, billId);
    const split = computeSplit(toBillInput(bundle!));

    // One of three portions taken, so two thirds of RM90 is nobody's yet.
    expect(split.unallocatedSen).toBe(6000);
    const short = split.unclaimedItems.find((u) => u.name === 'Fish head curry');
    expect(short).toMatchObject({ portions: 3, claimedPortions: 1, unclaimedSen: 6000 });
  });

  it('refuses to cut the portion count below the claims already made', async () => {
    const billId = created[0]!;
    const { data: items } = await admin
      .from('bill_items')
      .select('id')
      .eq('bill_id', billId)
      .eq('name', 'Steamboat set')
      .single();

    // Four people have claimed it; two would leave the engine unable to compute
    // the bill at all, so it is stopped here where it can still be explained.
    const { error } = await admin
      .from('bill_items')
      .update({ portions: 2 })
      .eq('id', String((items as { id: string }).id));

    expect(String(error?.message ?? '')).toContain('PORTIONS_BELOW_CLAIMS');
  });

  it('allows raising the count, which is how the payer makes room', async () => {
    const billId = created[0]!;
    const { data: item } = await admin
      .from('bill_items')
      .select('id')
      .eq('bill_id', billId)
      .eq('name', 'Steamboat set')
      .single();
    const itemId = String((item as { id: string }).id);

    const { error } = await admin.from('bill_items').update({ portions: 5 }).eq('id', itemId);
    expect(error).toBeNull();

    // Whoever lost the race can now take the portion they were refused. Which
    // one that was is not fixed -- five simultaneous inserts, four winners --
    // so it is looked up rather than assumed.
    const { data: people } = await admin.from('participants').select('id').eq('bill_id', billId);
    const { data: claims } = await admin.from('claims').select('participant_id').eq('item_id', itemId);
    const taken = new Set((claims as { participant_id: string }[]).map((c) => c.participant_id));
    const loser = (people as { id: string }[]).find((p) => !taken.has(p.id));
    expect(loser, 'exactly one of the five should still be without a portion').toBeDefined();

    const { error: claimError } = await admin.from('claims').insert({
      bill_id: billId,
      item_id: itemId,
      participant_id: loser!.id,
    });
    expect(claimError).toBeNull();
  });

  it('lets an ordinary line with no fixed divisor take any number of claimants', async () => {
    const billId = created[0]!;
    const { data: item } = await admin
      .from('bill_items')
      .insert({ bill_id: billId, name: 'Rice', price_sen: 500, position: 2 })
      .select('id')
      .single();
    const itemId = String((item as { id: string }).id);

    const { data: people } = await admin.from('participants').select('id').eq('bill_id', billId);
    const results = await Promise.all(
      (people as { id: string }[]).map((p) =>
        admin.from('claims').insert({ bill_id: billId, item_id: itemId, participant_id: p.id }),
      ),
    );
    expect(results.every((r) => !r.error)).toBe(true);
  });
});
