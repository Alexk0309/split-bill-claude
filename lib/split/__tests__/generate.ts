/**
 * Deterministic bill generator for the property tests.
 *
 * Hand-rolled rather than pulled from fast-check, because the agreed stack does
 * not include a property-testing library and this needs no more than a seeded
 * PRNG. Every case is reproducible from its seed: when a property fails, the
 * failure message carries the seed and `generateBill(seed)` replays it exactly.
 */

import type { Adjustment, Belanja, BillInput, LineItem, Person, RoundingMode } from '../types';

/** mulberry32: small, fast, and stable across Node versions. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RATES = [0, 0.05, 0.06, 0.08, 0.1, 0.12, 0.15, 0.0625, 0.1234];

export interface GenerateOptions {
  /** Allow items nobody has claimed. Off by default so shares must total the bill. */
  allowUnclaimed?: boolean;
  maxPeople?: number;
  maxItems?: number;
}

export function generateBill(seed: number, options: GenerateOptions = {}): BillInput {
  const rng = makeRng(seed);
  const int = (min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]!;

  const allowUnclaimed = options.allowUnclaimed ?? false;
  const peopleCount = int(1, options.maxPeople ?? 8);
  const people: Person[] = Array.from({ length: peopleCount }, (_, i) => ({
    // Ids are deliberately not in sorted order relative to index, so tie-breaks
    // by id are exercised rather than coinciding with array position.
    id: `p${String((i * 7 + 3) % 100).padStart(2, '0')}-${i}`,
    name: `Person ${i}`,
  }));

  const itemCount = int(0, options.maxItems ?? 12);
  const items: LineItem[] = Array.from({ length: itemCount }, (_, i) => {
    // A fair share of free items and odd prices, since those are where rounding
    // goes wrong.
    const priceSen = rng() < 0.08 ? 0 : int(1, 20000);
    const claimantIds: string[] = [];
    for (const p of people) {
      if (rng() < 0.35) claimantIds.push(p.id);
    }
    if (claimantIds.length === 0 && !allowUnclaimed) {
      claimantIds.push(pick(people).id);
    }
    return { id: `i${i}`, name: `Item ${i}`, priceSen, claimantIds };
  });

  const serviceChargeRate = pick(RATES);
  const serviceTaxRate = pick(RATES);

  const subtotalSen = items.reduce((acc, it) => acc + it.priceSen, 0);
  const serviceChargeSen = Math.floor(subtotalSen * serviceChargeRate + 0.5);
  const serviceTaxSen = Math.floor((subtotalSen + serviceChargeSen) * serviceTaxRate + 0.5);
  // Stay inside what the engine accepts: adjustments may not exceed the bill.
  let budget = subtotalSen + serviceChargeSen + serviceTaxSen;

  const adjustmentCount = int(0, 3);
  const adjustments: Adjustment[] = [];
  for (let i = 0; i < adjustmentCount; i += 1) {
    if (budget <= 0) break;
    // Sometimes deliberately oversized for one person, to exercise clamping.
    const cap = rng() < 0.25 ? budget : Math.floor(budget / (adjustmentCount + 1));
    const amountSen = int(0, Math.max(0, cap));
    budget -= amountSen;

    const personScoped = rng() < 0.5 && people.length > 0;
    const scope: Adjustment['scope'] = personScoped
      ? { personIds: people.filter(() => rng() < 0.5).map((p) => p.id).slice(0, 3) }
      : 'proportional';
    if (scope !== 'proportional' && scope.personIds.length === 0) {
      scope.personIds.push(pick(people).id);
    }
    adjustments.push({ id: `adj${i}`, label: `Adjustment ${i}`, amountSen, scope });
  }

  // Belanja: acyclic by construction, each beneficiary sponsored at most once.
  const belanja: Belanja[] = [];
  const covered = new Set<string>();
  const belanjaCount = int(0, Math.min(2, Math.max(0, people.length - 1)));
  for (let i = 0; i < belanjaCount; i += 1) {
    // Only ever point from a later person to an earlier one, so no cycle exists.
    const bIndex = int(1, people.length - 1);
    const sIndex = int(0, bIndex - 1);
    const beneficiaryId = people[bIndex]!.id;
    if (covered.has(beneficiaryId)) continue;
    covered.add(beneficiaryId);
    belanja.push({ sponsorId: people[sIndex]!.id, beneficiaryId });
  }

  const roundingMode: RoundingMode = rng() < 0.25 ? 'nearest5sen' : 'sen';

  return {
    people,
    items,
    serviceChargeRate,
    serviceTaxRate,
    adjustments,
    belanja,
    roundingMode,
  };
}
