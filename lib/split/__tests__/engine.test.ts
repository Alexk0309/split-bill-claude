import { describe, expect, it } from 'vitest';

import { computeSplit } from '../engine';
import { SplitEngineError } from '../errors';
import type { BillInput, LineItem, Person } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bill(partial: Partial<BillInput>): BillInput {
  return {
    people: [],
    items: [],
    serviceChargeRate: 0,
    serviceTaxRate: 0,
    adjustments: [],
    belanja: [],
    roundingMode: 'sen',
    ...partial,
  };
}

const person = (id: string, name = id): Person => ({ id, name });

const item = (id: string, name: string, priceSen: number, claimantIds: string[]): LineItem => ({
  id,
  name,
  priceSen,
  claimantIds,
});

function due(result: ReturnType<typeof computeSplit>, personId: string): number {
  const p = result.people.find((x) => x.personId === personId);
  if (!p) throw new Error(`No such person in result: ${personId}`);
  return p.amountDueSen;
}

function shareOf(result: ReturnType<typeof computeSplit>, personId: string) {
  const p = result.people.find((x) => x.personId === personId);
  if (!p) throw new Error(`No such person in result: ${personId}`);
  return p;
}

// ---------------------------------------------------------------------------
// The specified acceptance vector
// ---------------------------------------------------------------------------

describe('spec test vector: Aina, Ben, Chong at 10% service charge and 6% service tax', () => {
  const input = bill({
    people: [person('aina', 'Aina'), person('ben', 'Ben'), person('chong', 'Chong')],
    items: [
      item('i1', 'Nasi lemak ayam', 1800, ['aina']),
      item('i2', 'Ribeye', 7500, ['ben']),
      item('i3', 'Kopi ais', 650, ['chong']),
      item('i4', 'Sotong goreng', 3200, ['aina', 'ben', 'chong']),
    ],
    serviceChargeRate: 0.1,
    serviceTaxRate: 0.06,
  });

  const result = computeSplit(input);

  it('computes the bill totals in the Malaysian order', () => {
    expect(result.subtotalSen).toBe(13150);
    expect(result.serviceChargeSen).toBe(1315);
    // 6% of (13150 + 1315) = 867.9, rounded half up.
    expect(result.serviceTaxSen).toBe(868);
    expect(result.billTotalSen).toBe(15333);
  });

  it('levies service tax on subtotal plus service charge, not on subtotal alone', () => {
    // 6% of the subtotal alone would be 789 sen. The extra 79 sen is the tax on
    // the service charge, and getting this wrong understates every share.
    expect(result.serviceTaxSen).not.toBe(789);
    expect(result.serviceTaxSen).toBe(868);
  });

  it('produces the exact expected per-person amounts', () => {
    expect(due(result, 'aina')).toBe(3342);
    expect(due(result, 'ben')).toBe(9989);
    expect(due(result, 'chong')).toBe(2002);
  });

  it('sums to the bill total with no sen leaked', () => {
    const total = result.people.reduce((acc, p) => acc + p.amountDueSen, 0);
    expect(total).toBe(15333);
    expect(total).toBe(result.billTotalSen);
    expect(result.unallocatedSen).toBe(0);
  });

  it('gives the leftover sen to Ben and Chong, who have the largest remainders', () => {
    // Exact shares are 3342.5551 / 9988.7985 / 2001.6464; floors sum to 15331,
    // so two sen go to the two largest fractional parts.
    expect(shareOf(result, 'aina').exactShareSen).toBe('3342.555133');
    expect(shareOf(result, 'ben').exactShareSen).toBe('9988.798479');
    expect(shareOf(result, 'chong').exactShareSen).toBe('2001.646388');

    expect(shareOf(result, 'aina').roundingDeltaSen).toBe(0);
    expect(shareOf(result, 'ben').roundingDeltaSen).toBe(1);
    expect(shareOf(result, 'chong').roundingDeltaSen).toBe(1);
  });

  it('explains every sen: the breakdown components sum to the final share', () => {
    for (const p of result.people) {
      const sum =
        p.baseShareSen +
        p.serviceChargeShareSen +
        p.serviceTaxShareSen +
        p.adjustmentShareSen +
        p.clampRedistributionSen +
        p.cashRoundingShareSen;
      expect(sum).toBe(p.finalShareSen);
    }
  });

  it('reports the per-item lines a guest sees on their receipt', () => {
    const ben = shareOf(result, 'ben');
    expect(ben.itemLines).toHaveLength(2);
    const sotong = ben.itemLines.find((l) => l.name === 'Sotong goreng');
    expect(sotong).toMatchObject({
      itemPriceSen: 3200,
      claimantCount: 3,
      displayShareSen: 1067,
      exactShareSen: '1066.666667',
    });
  });

  it('reports no unclaimed items', () => {
    expect(result.unclaimedItems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Ordering of the calculation
// ---------------------------------------------------------------------------

describe('calculation order', () => {
  it('rounds the service charge half up before taxing it', () => {
    // subtotal 1005 sen at 10% is 100.5 -> 101, and tax applies to 1106, not 1105.5
    const result = computeSplit(
      bill({
        people: [person('a')],
        items: [item('i1', 'Thing', 1005, ['a'])],
        serviceChargeRate: 0.1,
        serviceTaxRate: 0.06,
      }),
    );
    expect(result.serviceChargeSen).toBe(101);
    expect(result.serviceTaxSen).toBe(66); // 6% of 1106 = 66.36 -> 66
    expect(result.billTotalSen).toBe(1172);
  });

  it('treats rates as inputs, including zero for a mamak with no charges', () => {
    const result = computeSplit(
      bill({
        people: [person('a'), person('b')],
        items: [item('i1', 'Roti canai', 250, ['a']), item('i2', 'Teh tarik', 320, ['b'])],
        serviceChargeRate: 0,
        serviceTaxRate: 0,
      }),
    );
    expect(result.serviceChargeSen).toBe(0);
    expect(result.serviceTaxSen).toBe(0);
    expect(result.billTotalSen).toBe(570);
    expect(due(result, 'a')).toBe(250);
    expect(due(result, 'b')).toBe(320);
  });

  it('handles a rate whose decimal form would be lossy as a float', () => {
    // 0.07 as a double is 0.070000000000000006661338147750939242541790008544921875.
    // Read as a decimal it is exactly 7/100, so 10050 sen gives exactly 703.5 -> 704.
    const result = computeSplit(
      bill({
        people: [person('a')],
        items: [item('i1', 'Thing', 10050, ['a'])],
        serviceChargeRate: 0.07,
        serviceTaxRate: 0,
      }),
    );
    expect(result.serviceChargeSen).toBe(704);
  });
});

// ---------------------------------------------------------------------------
// Unclaimed items
// ---------------------------------------------------------------------------

describe('unclaimed items', () => {
  const result = computeSplit(
    bill({
      people: [person('a'), person('b')],
      items: [
        item('i1', 'Claimed', 1000, ['a']),
        item('i2', 'Nobody ordered this', 500, []),
        item('i3', 'Shared', 600, ['a', 'b']),
      ],
      serviceChargeRate: 0.1,
      serviceTaxRate: 0.06,
    }),
  );

  it('never silently splits them', () => {
    expect(result.unclaimedItems).toEqual([
      { id: 'i2', name: 'Nobody ordered this', priceSen: 500 },
    ]);
  });

  it('holds their value back as unallocated rather than charging it to claimants', () => {
    expect(result.unallocatedSen).toBeGreaterThan(0);
    const shares = result.people.reduce((acc, p) => acc + p.amountDueSen, 0);
    expect(shares + result.unallocatedSen).toBe(result.billTotalSen);
  });

  it('charges nobody for the unclaimed item, including its share of tax', () => {
    // a claimed 1000 + 300, b claimed 300, and neither carries any part of the 500.
    expect(shareOf(result, 'a').baseShareSen).toBe(1300);
    expect(shareOf(result, 'b').baseShareSen).toBe(300);
  });

  it('allocates everything once the last item is claimed', () => {
    const claimed = computeSplit(
      bill({
        people: [person('a'), person('b')],
        items: [
          item('i1', 'Claimed', 1000, ['a']),
          item('i2', 'Nobody ordered this', 500, ['b']),
          item('i3', 'Shared', 600, ['a', 'b']),
        ],
        serviceChargeRate: 0.1,
        serviceTaxRate: 0.06,
      }),
    );
    expect(claimed.unclaimedItems).toEqual([]);
    expect(claimed.unallocatedSen).toBe(0);
    const shares = claimed.people.reduce((acc, p) => acc + p.amountDueSen, 0);
    expect(shares).toBe(claimed.billTotalSen);
  });
});

// ---------------------------------------------------------------------------
// Edge cases called out in the spec
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('single person pays the whole bill', () => {
    const result = computeSplit(
      bill({
        people: [person('a')],
        items: [item('i1', 'Set lunch', 2350, ['a'])],
        serviceChargeRate: 0.1,
        serviceTaxRate: 0.06,
      }),
    );
    expect(due(result, 'a')).toBe(result.billTotalSen);
    expect(result.billTotalSen).toBe(2350 + 235 + 155);
  });

  it('one item claimed by everyone splits evenly, leftover sen distributed once', () => {
    const result = computeSplit(
      bill({
        people: [person('a'), person('b'), person('c')],
        items: [item('i1', 'Steamboat', 10000, ['a', 'b', 'c'])],
        serviceChargeRate: 0,
        serviceTaxRate: 0,
      }),
    );
    // 10000 / 3 = 3333.33; one leftover sen goes to the largest remainder, ties
    // broken by person id, so 'a' takes it.
    expect(result.people.map((p) => p.amountDueSen)).toEqual([3334, 3333, 3333]);
    expect(result.people.reduce((acc, p) => acc + p.amountDueSen, 0)).toBe(10000);
  });

  it('zero-value item is claimable and costs nothing', () => {
    const result = computeSplit(
      bill({
        people: [person('a'), person('b')],
        items: [item('i1', 'Paid', 1000, ['a']), item('i2', 'Free ice cream', 0, ['b'])],
        serviceChargeRate: 0.1,
        serviceTaxRate: 0.06,
      }),
    );
    expect(due(result, 'b')).toBe(0);
    expect(due(result, 'a')).toBe(result.billTotalSen);
  });

  it('a bill of entirely zero-value items totals zero', () => {
    const result = computeSplit(
      bill({
        people: [person('a'), person('b')],
        items: [item('i1', 'Free', 0, ['a']), item('i2', 'Also free', 0, ['b'])],
        serviceChargeRate: 0.1,
        serviceTaxRate: 0.06,
      }),
    );
    expect(result.billTotalSen).toBe(0);
    expect(result.people.map((p) => p.amountDueSen)).toEqual([0, 0]);
  });

  it('a person who claims nothing owes exactly zero, and no tax', () => {
    const result = computeSplit(
      bill({
        people: [person('a'), person('spectator')],
        items: [item('i1', 'Ribeye', 7500, ['a'])],
        serviceChargeRate: 0.1,
        serviceTaxRate: 0.06,
      }),
    );
    const spectator = shareOf(result, 'spectator');
    expect(spectator.amountDueSen).toBe(0);
    expect(spectator.baseShareSen).toBe(0);
    expect(spectator.serviceChargeShareSen).toBe(0);
    expect(spectator.serviceTaxShareSen).toBe(0);
    expect(due(result, 'a')).toBe(result.billTotalSen);
  });

  it('a bill with no people at all is allowed while nothing is claimed', () => {
    const result = computeSplit(
      bill({
        people: [],
        items: [item('i1', 'Nasi lemak', 1800, [])],
        serviceChargeRate: 0.1,
        serviceTaxRate: 0.06,
      }),
    );
    expect(result.people).toEqual([]);
    expect(result.unallocatedSen).toBe(result.billTotalSen);
  });
});

// ---------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------

describe('adjustments', () => {
  it('applies a proportional promo by ratio of what each person ate', () => {
    const result = computeSplit(
      bill({
        people: [person('a'), person('b')],
        items: [item('i1', 'Big', 7500, ['a']), item('i2', 'Small', 2500, ['b'])],
        serviceChargeRate: 0,
        serviceTaxRate: 0,
        adjustments: [
          { id: 'adj1', label: 'Grab promo', amountSen: 1000, scope: 'proportional' },
        ],
      }),
    );
    expect(result.billTotalSen).toBe(9000);
    // 75% / 25% of the bill, so 750 / 250 off.
    expect(due(result, 'a')).toBe(6750);
    expect(due(result, 'b')).toBe(2250);
  });

  it('applies a person-scoped adjustment to that person only', () => {
    const result = computeSplit(
      bill({
        people: [person('a'), person('b')],
        items: [item('i1', 'Big', 7500, ['a']), item('i2', 'Small', 2500, ['b'])],
        serviceChargeRate: 0,
        serviceTaxRate: 0,
        adjustments: [
          { id: 'adj1', label: 'Birthday voucher', amountSen: 1000, scope: { personIds: ['b'] } },
        ],
      }),
    );
    expect(result.billTotalSen).toBe(9000);
    expect(due(result, 'a')).toBe(7500);
    expect(due(result, 'b')).toBe(1500);
  });

  it('splits a person-scoped adjustment equally between the people it names', () => {
    const result = computeSplit(
      bill({
        people: [person('a'), person('b'), person('c')],
        items: [
          item('i1', 'One', 5000, ['a']),
          item('i2', 'Two', 3000, ['b']),
          item('i3', 'Three', 2000, ['c']),
        ],
        serviceChargeRate: 0,
        serviceTaxRate: 0,
        adjustments: [
          { id: 'adj1', label: 'Student discount', amountSen: 1000, scope: { personIds: ['a', 'b'] } },
        ],
      }),
    );
    expect(due(result, 'a')).toBe(4500);
    expect(due(result, 'b')).toBe(2500);
    expect(due(result, 'c')).toBe(2000);
  });

  it('clamps an over-sized personal adjustment at zero and redistributes the rest', () => {
    const result = computeSplit(
      bill({
        people: [person('a'), person('b'), person('c')],
        items: [
          item('i1', 'Cheap', 500, ['a']),
          item('i2', 'Mid', 3000, ['b']),
          item('i3', 'Mid', 3000, ['c']),
        ],
        serviceChargeRate: 0,
        serviceTaxRate: 0,
        adjustments: [
          // More than a's 500 sen share.
          { id: 'adj1', label: 'Staff comp', amountSen: 2000, scope: { personIds: ['a'] } },
        ],
      }),
    );
    expect(result.billTotalSen).toBe(4500);
    // a cannot go below zero, so the unabsorbed 1500 moves to b and c by ratio.
    expect(due(result, 'a')).toBe(0);
    expect(due(result, 'b')).toBe(2250);
    expect(due(result, 'c')).toBe(2250);
    expect(result.people.reduce((acc, p) => acc + p.amountDueSen, 0)).toBe(4500);

    expect(shareOf(result, 'a').clampRedistributionSen).toBe(1500);
    expect(shareOf(result, 'b').clampRedistributionSen).toBe(-750);
    expect(shareOf(result, 'c').clampRedistributionSen).toBe(-750);
  });

  it('never lets anyone go negative even when clamping cascades', () => {
    const result = computeSplit(
      bill({
        people: [person('a'), person('b'), person('c')],
        items: [
          item('i1', 'Tiny', 100, ['a']),
          item('i2', 'Tiny', 200, ['b']),
          item('i3', 'Big', 9700, ['c']),
        ],
        serviceChargeRate: 0,
        serviceTaxRate: 0,
        adjustments: [
          { id: 'adj1', label: 'Comp a', amountSen: 3000, scope: { personIds: ['a'] } },
          { id: 'adj2', label: 'Comp b', amountSen: 3000, scope: { personIds: ['b'] } },
        ],
      }),
    );
    expect(result.billTotalSen).toBe(4000);
    expect(due(result, 'a')).toBe(0);
    expect(due(result, 'b')).toBe(0);
    expect(due(result, 'c')).toBe(4000);
    for (const p of result.people) expect(p.amountDueSen).toBeGreaterThanOrEqual(0);
  });

  it('reports each adjustment as its own line, summing to the adjustment total', () => {
    const result = computeSplit(
      bill({
        people: [person('a'), person('b')],
        items: [item('i1', 'Big', 7500, ['a']), item('i2', 'Small', 2500, ['b'])],
        serviceChargeRate: 0,
        serviceTaxRate: 0,
        adjustments: [
          { id: 'adj1', label: 'Grab promo', amountSen: 1000, scope: 'proportional' },
          { id: 'adj2', label: 'Voucher', amountSen: 500, scope: { personIds: ['b'] } },
        ],
      }),
    );
    const b = shareOf(result, 'b');
    expect(b.adjustmentLines.map((l) => [l.label, l.amountSen])).toEqual([
      ['Grab promo', -250],
      ['Voucher', -500],
    ]);
    expect(b.adjustmentShareSen).toBe(-750);
  });

  it('rejects adjustments larger than the whole bill', () => {
    expect(() =>
      computeSplit(
        bill({
          people: [person('a')],
          items: [item('i1', 'Thing', 1000, ['a'])],
          adjustments: [{ id: 'adj1', label: 'Absurd', amountSen: 5000, scope: 'proportional' }],
        }),
      ),
    ).toThrow(SplitEngineError);
  });
});

// ---------------------------------------------------------------------------
// Belanja
// ---------------------------------------------------------------------------

describe('belanja', () => {
  const base = {
    people: [person('a', 'Aina'), person('b', 'Ben'), person('c', 'Chong')],
    items: [
      item('i1', 'One', 3000, ['a']),
      item('i2', 'Two', 2000, ['b']),
      item('i3', 'Three', 1000, ['c']),
    ],
    serviceChargeRate: 0,
    serviceTaxRate: 0,
  };

  it('moves the beneficiary entire share onto the sponsor', () => {
    const result = computeSplit(bill({ ...base, belanja: [{ sponsorId: 'a', beneficiaryId: 'c' }] }));
    expect(due(result, 'a')).toBe(4000);
    expect(due(result, 'b')).toBe(2000);
    expect(due(result, 'c')).toBe(0);
    expect(shareOf(result, 'a').belanjaAbsorbedSen).toBe(1000);
    expect(shareOf(result, 'c').belanjaCoveredBySponsorId).toBe('a');
  });

  it('never changes the bill total', () => {
    const without = computeSplit(bill(base));
    const withBelanja = computeSplit(
      bill({ ...base, belanja: [{ sponsorId: 'a', beneficiaryId: 'c' }] }),
    );
    expect(withBelanja.billTotalSen).toBe(without.billTotalSen);
    expect(withBelanja.people.reduce((acc, p) => acc + p.amountDueSen, 0)).toBe(
      without.people.reduce((acc, p) => acc + p.amountDueSen, 0),
    );
  });

  it('keeps the beneficiary own share visible so they can see what was covered', () => {
    const result = computeSplit(bill({ ...base, belanja: [{ sponsorId: 'a', beneficiaryId: 'c' }] }));
    expect(shareOf(result, 'c').finalShareSen).toBe(1000);
    expect(shareOf(result, 'c').amountDueSen).toBe(0);
  });

  it('collapses a chain onto the person who actually pays', () => {
    // a covers b, b covers c: a ends up paying for all three.
    const result = computeSplit(
      bill({
        ...base,
        belanja: [
          { sponsorId: 'a', beneficiaryId: 'b' },
          { sponsorId: 'b', beneficiaryId: 'c' },
        ],
      }),
    );
    expect(due(result, 'a')).toBe(6000);
    expect(due(result, 'b')).toBe(0);
    expect(due(result, 'c')).toBe(0);
  });

  it('rejects self-belanja, double sponsorship and cycles', () => {
    expect(() =>
      computeSplit(bill({ ...base, belanja: [{ sponsorId: 'a', beneficiaryId: 'a' }] })),
    ).toThrow(/cannot belanja themselves/);

    expect(() =>
      computeSplit(
        bill({
          ...base,
          belanja: [
            { sponsorId: 'a', beneficiaryId: 'c' },
            { sponsorId: 'b', beneficiaryId: 'c' },
          ],
        }),
      ),
    ).toThrow(/more than one sponsor/);

    expect(() =>
      computeSplit(
        bill({
          ...base,
          belanja: [
            { sponsorId: 'a', beneficiaryId: 'b' },
            { sponsorId: 'b', beneficiaryId: 'a' },
          ],
        }),
      ),
    ).toThrow(/cycle/);
  });
});

// ---------------------------------------------------------------------------
// Cash rounding
// ---------------------------------------------------------------------------

describe('nearest5sen rounding for cash settlement', () => {
  it('rounds the payable total to the nearest 5 sen and every share to 5 sen', () => {
    const result = computeSplit(
      bill({
        people: [person('a'), person('b')],
        items: [item('i1', 'One', 1801, ['a']), item('i2', 'Two', 1200, ['b'])],
        serviceChargeRate: 0,
        serviceTaxRate: 0,
        roundingMode: 'nearest5sen',
      }),
    );
    expect(result.billTotalSen).toBe(3001);
    expect(result.settlementTotalSen).toBe(3000);
    expect(result.cashRoundingDeltaSen).toBe(-1);
    for (const p of result.people) expect(p.amountDueSen % 5).toBe(0);
    expect(result.people.reduce((acc, p) => acc + p.amountDueSen, 0)).toBe(3000);
  });

  it('shows the cash rounding as its own line rather than hiding it in a component', () => {
    const result = computeSplit(
      bill({
        people: [person('a'), person('b')],
        items: [item('i1', 'One', 1801, ['a']), item('i2', 'Two', 1200, ['b'])],
        roundingMode: 'nearest5sen',
      }),
    );
    const a = shareOf(result, 'a');
    expect(a.baseShareSen).toBe(1801);
    expect(a.clampRedistributionSen).toBe(0);
    expect(a.cashRoundingShareSen).toBe(-1);
    expect(a.finalShareSen).toBe(1800);

    const cashLines = result.people.reduce((acc, p) => acc + p.cashRoundingShareSen, 0);
    expect(cashLines).toBe(result.cashRoundingDeltaSen);
  });

  it('rounds a total ending in 3 sen up', () => {
    const result = computeSplit(
      bill({
        people: [person('a')],
        items: [item('i1', 'One', 1003, ['a'])],
        roundingMode: 'nearest5sen',
      }),
    );
    expect(result.settlementTotalSen).toBe(1005);
    expect(due(result, 'a')).toBe(1005);
  });

  it('leaves the total alone in sen mode', () => {
    const result = computeSplit(
      bill({
        people: [person('a')],
        items: [item('i1', 'One', 1003, ['a'])],
        roundingMode: 'sen',
      }),
    );
    expect(result.settlementTotalSen).toBe(1003);
    expect(result.cashRoundingDeltaSen).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism and validation
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('does not depend on the order people or claimants are listed in', () => {
    const forward = computeSplit(
      bill({
        people: [person('a'), person('b'), person('c')],
        items: [item('i1', 'Shared', 1000, ['a', 'b', 'c'])],
      }),
    );
    const reversed = computeSplit(
      bill({
        people: [person('c'), person('b'), person('a')],
        items: [item('i1', 'Shared', 1000, ['c', 'b', 'a'])],
      }),
    );
    const asMap = (r: typeof forward) =>
      Object.fromEntries(r.people.map((p) => [p.personId, p.amountDueSen]));
    expect(asMap(reversed)).toEqual(asMap(forward));
  });
});

describe('input validation', () => {
  it('rejects non-integer sen', () => {
    expect(() =>
      computeSplit(bill({ people: [person('a')], items: [item('i1', 'Thing', 10.5, ['a'])] })),
    ).toThrow(/integer number of sen/);
  });

  it('rejects negative prices', () => {
    expect(() =>
      computeSplit(bill({ people: [person('a')], items: [item('i1', 'Thing', -100, ['a'])] })),
    ).toThrow(/must not be negative/);
  });

  it('rejects a claim by someone who is not on the bill', () => {
    expect(() =>
      computeSplit(bill({ people: [person('a')], items: [item('i1', 'Thing', 100, ['ghost'])] })),
    ).toThrow(/unknown person/);
  });

  it('rejects duplicate ids', () => {
    expect(() => computeSplit(bill({ people: [person('a'), person('a')] }))).toThrow(
      /Duplicate person id/,
    );
    expect(() =>
      computeSplit(
        bill({
          people: [person('a')],
          items: [item('i1', 'One', 100, ['a']), item('i1', 'Two', 100, ['a'])],
        }),
      ),
    ).toThrow(/Duplicate item id/);
  });

  it('rejects an out-of-range rate', () => {
    expect(() =>
      computeSplit(
        bill({
          people: [person('a')],
          items: [item('i1', 'Thing', 100, ['a'])],
          serviceChargeRate: 1.5,
        }),
      ),
    ).toThrow(/between 0 and 1/);
  });

  it('charges a double-claimed item once', () => {
    const result = computeSplit(
      bill({
        people: [person('a'), person('b')],
        items: [item('i1', 'Shared', 1000, ['a', 'b', 'a'])],
      }),
    );
    expect(due(result, 'a')).toBe(500);
    expect(due(result, 'b')).toBe(500);
  });
});
