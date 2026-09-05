import { describe, expect, it } from 'vitest';

import { computeSplit } from '@/lib/split';

import { deriveRate, deriveRates, reconcile } from '../reconcile';
import type { ParsedReceipt } from '../schema';

function receipt(overrides: Partial<ParsedReceipt> = {}): ParsedReceipt {
  return {
    venue: 'Village Park',
    items: [
      { name: 'Nasi lemak ayam', quantity: 1, price_sen: 1800 },
      { name: 'Ribeye', quantity: 1, price_sen: 7500 },
      { name: 'Kopi ais', quantity: 1, price_sen: 650 },
      { name: 'Sotong goreng', quantity: 1, price_sen: 3200 },
    ],
    subtotal_sen: 13150,
    service_charge_sen: 1315,
    service_tax_sen: 868,
    total_sen: 15333,
    confidence: 'high',
    ...overrides,
  };
}

describe('reconcile', () => {
  it('passes a receipt that adds up', () => {
    const result = reconcile(receipt());
    expect(result.ok).toBe(true);
    expect(result.itemsDeltaSen).toBe(0);
    expect(result.totalDeltaSen).toBe(0);
  });

  it('catches items that do not sum to the printed subtotal', () => {
    // A misread digit: 650 read as 550.
    const result = reconcile(
      receipt({
        items: [
          { name: 'Nasi lemak ayam', quantity: 1, price_sen: 1800 },
          { name: 'Ribeye', quantity: 1, price_sen: 7500 },
          { name: 'Kopi ais', quantity: 1, price_sen: 550 },
          { name: 'Sotong goreng', quantity: 1, price_sen: 3200 },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.itemsMatchSubtotal).toBe(false);
    expect(result.itemsDeltaSen).toBe(-100);
    expect(result.totalMatches).toBe(true);
  });

  it('catches a whole missed line item', () => {
    const result = reconcile(receipt({ items: receipt().items.slice(0, 3) }));
    expect(result.itemsDeltaSen).toBe(-3200);
    expect(result.ok).toBe(false);
  });

  it('catches charges that do not reach the printed total', () => {
    const result = reconcile(receipt({ total_sen: 15533 }));
    expect(result.totalMatches).toBe(false);
    expect(result.totalDeltaSen).toBe(-200);
    expect(result.itemsMatchSubtotal).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('reports both failures at once', () => {
    const result = reconcile(receipt({ subtotal_sen: 13000, total_sen: 15000 }));
    expect(result.itemsMatchSubtotal).toBe(false);
    expect(result.totalMatches).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('is happy with a mamak receipt that has no charges at all', () => {
    const result = reconcile(
      receipt({
        items: [{ name: 'Roti canai', quantity: 2, price_sen: 500 }],
        subtotal_sen: 500,
        service_charge_sen: 0,
        service_tax_sen: 0,
        total_sen: 500,
      }),
    );
    expect(result.ok).toBe(true);
  });
});

describe('deriveRate', () => {
  it('recovers the common Malaysian rates', () => {
    expect(deriveRate(1315, 13150)).toBe(0.1);
    expect(deriveRate(868, 14465)).toBe(0.06);
  });

  it('recovers a rate through the rounding of a small bill', () => {
    // 10% of RM5.05 is 50.5 sen, printed as 51. Dividing gives 0.10099...;
    // recomputing shows that a flat 10% produces exactly 51.
    expect(deriveRate(51, 505)).toBe(0.1);
  });

  it('recovers an unusual rate rather than forcing it to a round one', () => {
    // 8.4% is not on the half-percent grid, so the tenths grid catches it.
    const baseSen = 12345;
    const charge = Math.floor(baseSen * 0.084 + 0.5);
    expect(deriveRate(charge, baseSen)).toBe(0.084);
  });

  it('falls back to the plain quotient when nothing round fits', () => {
    // A charge no sensible rate produces: the derived value still reproduces the
    // right ballpark, and the payer sees it on the review screen.
    const rate = deriveRate(1000, 13150);
    expect(rate).toBeCloseTo(0.076, 3);
  });

  it('returns zero when nothing was charged', () => {
    expect(deriveRate(0, 13150)).toBe(0);
    expect(deriveRate(0, 0)).toBe(0);
  });

  it('gives up rather than dividing by zero or exceeding 100%', () => {
    expect(deriveRate(500, 0)).toBeNull();
    expect(deriveRate(20000, 13150)).toBeNull();
  });

  it('round trips every common rate at a range of bill sizes', () => {
    for (const rate of [0, 0.05, 0.06, 0.08, 0.1, 0.15]) {
      for (const baseSen of [500, 1234, 5000, 13150, 98765]) {
        const charge = Math.floor(baseSen * rate + 0.5);
        expect(deriveRate(charge, baseSen), `${rate} of ${baseSen}`).toBe(rate);
      }
    }
  });
});

describe('deriveRates', () => {
  it('derives the tax off subtotal plus service charge, not off subtotal', () => {
    const rates = deriveRates(receipt());
    expect(rates.serviceChargeRate).toBe(0.1);
    expect(rates.serviceTaxRate).toBe(0.06);
    // 868 / 13150 would be 6.6%, which is what deriving off the subtotal alone
    // would have produced.
    expect(rates.serviceTaxRate).not.toBeCloseTo(0.066, 3);
  });

  it('derives zeroes for a receipt with no charges', () => {
    const rates = deriveRates(
      receipt({ service_charge_sen: 0, service_tax_sen: 0, total_sen: 13150 }),
    );
    expect(rates).toEqual({ serviceChargeRate: 0, serviceTaxRate: 0 });
  });

  it('feeds the engine rates that reproduce the printed bill', () => {
    // The point of deriving rather than assuming: the totals the guests see must
    // match the paper on the table.
    const parsed = receipt();
    const rates = deriveRates(parsed);

    const result = computeSplit({
      people: [{ id: 'p1', name: 'Payer' }],
      items: parsed.items.map((item, i) => ({
        id: `i${i}`,
        name: item.name,
        priceSen: item.price_sen,
        claimantIds: ['p1'],
      })),
      serviceChargeRate: rates.serviceChargeRate ?? 0,
      serviceTaxRate: rates.serviceTaxRate ?? 0,
      adjustments: [],
      belanja: [],
      roundingMode: 'sen',
    });

    expect(result.subtotalSen).toBe(parsed.subtotal_sen);
    expect(result.serviceChargeSen).toBe(parsed.service_charge_sen);
    expect(result.serviceTaxSen).toBe(parsed.service_tax_sen);
    expect(result.billTotalSen).toBe(parsed.total_sen);
  });

  it('reproduces the printed bill for an unusual rate too', () => {
    const parsed = receipt({
      items: [{ name: 'Set', quantity: 1, price_sen: 10000 }],
      subtotal_sen: 10000,
      service_charge_sen: 500, // 5%
      service_tax_sen: 840, // 8% of 10500
      total_sen: 11340,
    });
    const rates = deriveRates(parsed);
    expect(rates.serviceChargeRate).toBe(0.05);
    expect(rates.serviceTaxRate).toBe(0.08);

    const result = computeSplit({
      people: [{ id: 'p1', name: 'Payer' }],
      items: [{ id: 'i0', name: 'Set', priceSen: 10000, claimantIds: ['p1'] }],
      serviceChargeRate: rates.serviceChargeRate ?? 0,
      serviceTaxRate: rates.serviceTaxRate ?? 0,
      adjustments: [],
      belanja: [],
      roundingMode: 'sen',
    });
    expect(result.billTotalSen).toBe(11340);
  });
});
