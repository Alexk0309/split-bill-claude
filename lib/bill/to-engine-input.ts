/**
 * Maps database rows onto the split engine's input.
 *
 * Pure, so it can be tested without a database. This is the only place the two
 * shapes are allowed to know about each other -- the engine stays free of any
 * Supabase concept, and the schema stays free of the engine's.
 */

import type { Adjustment, Belanja, BillInput, LineItem, Person } from '@/lib/split';
import type { BillBundle } from '@/lib/supabase/types';

/**
 * A rate arrives from PostgREST as a JSON number, but `numeric` can also come
 * back as a string depending on client settings. Normalise, and fall back to 0
 * rather than letting NaN reach the engine.
 */
function toRate(value: number | string): number {
  const rate = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(rate) ? rate : 0;
}

export function toBillInput(bundle: BillBundle): BillInput {
  const { bill, items, participants, claims, adjustments, belanja } = bundle;

  const people: Person[] = participants.map((p) => ({
    id: p.id,
    name: p.display_name,
  }));
  const knownPeople = new Set(people.map((p) => p.id));

  // Claims are grouped once rather than scanned per item, so a long bill with
  // many claimants stays linear.
  const claimantsByItem = new Map<string, string[]>();
  for (const claim of claims) {
    if (!knownPeople.has(claim.participant_id)) continue;
    const list = claimantsByItem.get(claim.item_id);
    if (list) list.push(claim.participant_id);
    else claimantsByItem.set(claim.item_id, [claim.participant_id]);
  }

  const ordered = [...items].sort(
    (a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at),
  );

  const lineItems: LineItem[] = ordered.map((row) => ({
    id: row.id,
    name: row.name,
    priceSen: row.price_sen,
    // Sorted so the same data always produces the same array, which keeps
    // rendered output and engine tie-breaks stable between loads.
    claimantIds: (claimantsByItem.get(row.id) ?? []).sort(),
    // Null and undefined both mean "divide by the claimants"; the database
    // stores null, and rows read before this column existed have neither.
    portions: row.portions ?? null,
  }));

  const mappedAdjustments: Adjustment[] = [];
  for (const row of adjustments) {
    if (row.scope === 'proportional') {
      mappedAdjustments.push({
        id: row.id,
        label: row.label,
        amountSen: row.amount_sen,
        scope: 'proportional',
      });
      continue;
    }
    // A trigger prunes these when a participant is deleted, but filter anyway:
    // one stale id should not stop the whole bill from rendering.
    const personIds = row.scope_person_ids.filter((id) => knownPeople.has(id));
    if (personIds.length === 0) continue;
    mappedAdjustments.push({
      id: row.id,
      label: row.label,
      amountSen: row.amount_sen,
      scope: { personIds },
    });
  }

  const mappedBelanja: Belanja[] = belanja
    .filter((row) => knownPeople.has(row.sponsor_id) && knownPeople.has(row.beneficiary_id))
    .map((row) => ({ sponsorId: row.sponsor_id, beneficiaryId: row.beneficiary_id }));

  return {
    people,
    items: lineItems,
    serviceChargeRate: toRate(bill.service_charge_rate),
    serviceTaxRate: toRate(bill.service_tax_rate),
    adjustments: mappedAdjustments,
    belanja: mappedBelanja,
    roundingMode: bill.rounding_mode,
  };
}
