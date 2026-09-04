import { describe, expect, it } from 'vitest';

import { computeSplit } from '../engine';
import type { SplitResult } from '../types';
import { generateBill } from './generate';

/** Enough cases to cover the rounding tails; deterministic, so CI cannot flake. */
const CASES = 2000;

function context(seed: number, result: SplitResult): string {
  return [
    `seed ${seed} (replay with generateBill(${seed}))`,
    `subtotal=${result.subtotalSen} charge=${result.serviceChargeSen} tax=${result.serviceTaxSen}`,
    `adjustments=${result.totalAdjustmentsSen} total=${result.billTotalSen}`,
    `settlement=${result.settlementTotalSen} unallocated=${result.unallocatedSen}`,
    `shares=[${result.people.map((p) => p.finalShareSen).join(', ')}]`,
  ].join('\n  ');
}

describe('property: the shares always sum to the bill total', () => {
  it(`holds for ${CASES} generated fully-claimed bills`, () => {
    for (let seed = 1; seed <= CASES; seed += 1) {
      const input = generateBill(seed);
      const result = computeSplit(input);

      // Fully claimed, so nothing is held back.
      expect(result.unclaimedItems, context(seed, result)).toEqual([]);
      expect(result.unallocatedSen, context(seed, result)).toBe(0);

      const shares = result.people.reduce((acc, p) => acc + p.finalShareSen, 0);
      expect(shares, context(seed, result)).toBe(result.settlementTotalSen);

      // In the default mode the settlement total is the bill total, which is the
      // hard constraint: no sen may leak.
      if (result.roundingMode === 'sen') {
        expect(shares, context(seed, result)).toBe(result.billTotalSen);
      }
    }
  });

  it(`holds for ${CASES} generated bills that still have unclaimed items`, () => {
    let sawUnclaimed = 0;
    for (let seed = 1; seed <= CASES; seed += 1) {
      const input = generateBill(seed + 1_000_000, { allowUnclaimed: true });
      const result = computeSplit(input);
      if (result.unclaimedItems.length > 0) sawUnclaimed += 1;

      const shares = result.people.reduce((acc, p) => acc + p.finalShareSen, 0);
      expect(shares + result.unallocatedSen, context(seed, result)).toBe(
        result.settlementTotalSen,
      );
    }
    // The generator would be useless if it never produced the case under test.
    expect(sawUnclaimed).toBeGreaterThan(CASES / 10);
  });
});

describe('property: belanja moves money without creating or destroying it', () => {
  it(`holds for ${CASES} generated bills`, () => {
    let sawBelanja = 0;
    for (let seed = 1; seed <= CASES; seed += 1) {
      const input = generateBill(seed);
      const result = computeSplit(input);
      if (input.belanja.length > 0) sawBelanja += 1;

      const shares = result.people.reduce((acc, p) => acc + p.finalShareSen, 0);
      const due = result.people.reduce((acc, p) => acc + p.amountDueSen, 0);
      expect(due, context(seed, result)).toBe(shares);
    }
    expect(sawBelanja).toBeGreaterThan(CASES / 10);
  });
});

describe('property: nobody is ever charged a negative amount', () => {
  it(`holds for ${CASES} generated bills`, () => {
    for (let seed = 1; seed <= CASES; seed += 1) {
      const result = computeSplit(generateBill(seed));
      for (const p of result.people) {
        expect(p.finalShareSen, `${context(seed, result)}\n  person ${p.personId}`).toBeGreaterThanOrEqual(0);
        expect(p.amountDueSen, `${context(seed, result)}\n  person ${p.personId}`).toBeGreaterThanOrEqual(0);
      }
      expect(result.unallocatedSen, context(seed, result)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('property: every sen of every share is explainable', () => {
  it(`holds for ${CASES} generated bills`, () => {
    for (let seed = 1; seed <= CASES; seed += 1) {
      const result = computeSplit(generateBill(seed));
      for (const p of result.people) {
        const components =
          p.baseShareSen +
          p.serviceChargeShareSen +
          p.serviceTaxShareSen +
          p.adjustmentShareSen +
          p.clampRedistributionSen +
          p.cashRoundingShareSen;
        expect(components, `${context(seed, result)}\n  person ${p.personId}`).toBe(
          p.finalShareSen,
        );

        const lines = p.adjustmentLines.reduce((acc, l) => acc + l.amountSen, 0);
        expect(lines, `${context(seed, result)}\n  person ${p.personId}`).toBe(
          p.adjustmentShareSen,
        );
      }
    }
  });
});

describe('property: the result does not depend on input ordering', () => {
  it(`holds for ${CASES} generated bills`, () => {
    for (let seed = 1; seed <= CASES; seed += 1) {
      const input = generateBill(seed);
      const forward = computeSplit(input);
      const reversed = computeSplit({
        ...input,
        people: [...input.people].reverse(),
        items: [...input.items]
          .reverse()
          .map((item) => ({ ...item, claimantIds: [...item.claimantIds].reverse() })),
      });

      const asMap = (r: SplitResult) =>
        Object.fromEntries(r.people.map((p) => [p.personId, p.amountDueSen]));
      expect(asMap(reversed), context(seed, forward)).toEqual(asMap(forward));
    }
  });
});

describe('property: claiming a previously unclaimed item never lowers the table total', () => {
  it(`holds for ${CASES} generated bills`, () => {
    for (let seed = 1; seed <= CASES; seed += 1) {
      const input = generateBill(seed + 2_000_000, { allowUnclaimed: true });
      const before = computeSplit(input);
      if (before.unclaimedItems.length === 0 || input.people.length === 0) continue;

      // Assign every unclaimed item to the first person and re-run.
      const claimant = input.people[0]!.id;
      const after = computeSplit({
        ...input,
        items: input.items.map((item) =>
          item.claimantIds.length === 0 ? { ...item, claimantIds: [claimant] } : item,
        ),
      });

      expect(after.billTotalSen, context(seed, before)).toBe(before.billTotalSen);
      expect(after.unallocatedSen, context(seed, after)).toBe(0);
      const collected = after.people.reduce((acc, p) => acc + p.amountDueSen, 0);
      expect(collected, context(seed, after)).toBe(after.settlementTotalSen);
    }
  });
});
