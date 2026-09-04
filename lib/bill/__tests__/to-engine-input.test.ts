import { describe, expect, it } from 'vitest';

import { computeSplit } from '@/lib/split';
import type { BillBundle } from '@/lib/supabase/types';

import { toBillInput } from '../to-engine-input';

const AT = '2026-01-01T00:00:00Z';

function bundle(overrides: Partial<BillBundle> = {}): BillBundle {
  return {
    bill: {
      id: 'bill-1',
      owner_id: 'owner-1',
      title: 'Dinner',
      venue: 'Village Park',
      currency: 'MYR',
      subtotal_sen: 0,
      service_charge_rate: 0.1,
      service_tax_rate: 0.06,
      rounding_mode: 'sen',
      status: 'open',
      share_token: 'tok',
      created_at: AT,
    },
    items: [],
    participants: [],
    claims: [],
    adjustments: [],
    belanja: [],
    ...overrides,
  };
}

const participant = (id: string, name: string) => ({
  id,
  bill_id: 'bill-1',
  display_name: name,
  settled_at: null,
  settled_method: null,
  created_at: AT,
});

const itemRow = (id: string, name: string, price_sen: number, position: number) => ({
  id,
  bill_id: 'bill-1',
  name,
  price_sen,
  position,
  created_at: AT,
});

const claimRow = (item_id: string, participant_id: string) => ({
  item_id,
  participant_id,
  bill_id: 'bill-1',
  created_at: AT,
});

describe('toBillInput', () => {
  it('reproduces the spec vector end to end from database rows', () => {
    const input = toBillInput(
      bundle({
        participants: [
          participant('aina', 'Aina'),
          participant('ben', 'Ben'),
          participant('chong', 'Chong'),
        ],
        items: [
          itemRow('i1', 'Nasi lemak ayam', 1800, 0),
          itemRow('i2', 'Ribeye', 7500, 1),
          itemRow('i3', 'Kopi ais', 650, 2),
          itemRow('i4', 'Sotong goreng', 3200, 3),
        ],
        claims: [
          claimRow('i1', 'aina'),
          claimRow('i2', 'ben'),
          claimRow('i3', 'chong'),
          claimRow('i4', 'aina'),
          claimRow('i4', 'ben'),
          claimRow('i4', 'chong'),
        ],
      }),
    );

    const result = computeSplit(input);
    expect(result.billTotalSen).toBe(15333);
    expect(result.people.map((p) => p.amountDueSen)).toEqual([3342, 9989, 2002]);
  });

  it('orders items by position, then by creation time as a tiebreak', () => {
    const input = toBillInput(
      bundle({
        items: [
          { ...itemRow('c', 'Third', 100, 1), created_at: '2026-01-01T00:00:02Z' },
          { ...itemRow('a', 'First', 100, 0), created_at: '2026-01-01T00:00:00Z' },
          { ...itemRow('b', 'Second', 100, 1), created_at: '2026-01-01T00:00:01Z' },
        ],
      }),
    );
    expect(input.items.map((i) => i.name)).toEqual(['First', 'Second', 'Third']);
  });

  it('sorts claimants so the same data always produces the same input', () => {
    const forward = toBillInput(
      bundle({
        participants: [participant('p2', 'Two'), participant('p1', 'One')],
        items: [itemRow('i1', 'Shared', 1000, 0)],
        claims: [claimRow('i1', 'p2'), claimRow('i1', 'p1')],
      }),
    );
    expect(forward.items[0]?.claimantIds).toEqual(['p1', 'p2']);
  });

  it('leaves an item with no claims unclaimed rather than inventing a claimant', () => {
    const input = toBillInput(
      bundle({
        participants: [participant('p1', 'One')],
        items: [itemRow('i1', 'Nobody ordered this', 500, 0)],
      }),
    );
    expect(input.items[0]?.claimantIds).toEqual([]);
    expect(computeSplit(input).unclaimedItems).toHaveLength(1);
  });

  it('maps both adjustment scopes', () => {
    const input = toBillInput(
      bundle({
        participants: [participant('p1', 'One'), participant('p2', 'Two')],
        adjustments: [
          {
            id: 'a1',
            bill_id: 'bill-1',
            label: 'Grab promo',
            amount_sen: 500,
            scope: 'proportional',
            scope_person_ids: [],
            created_at: AT,
          },
          {
            id: 'a2',
            bill_id: 'bill-1',
            label: 'Voucher',
            amount_sen: 300,
            scope: 'person',
            scope_person_ids: ['p2'],
            created_at: AT,
          },
        ],
      }),
    );
    expect(input.adjustments).toEqual([
      { id: 'a1', label: 'Grab promo', amountSen: 500, scope: 'proportional' },
      { id: 'a2', label: 'Voucher', amountSen: 300, scope: { personIds: ['p2'] } },
    ]);
  });

  it('drops references to people who are no longer on the bill', () => {
    // The database prunes these on delete; this is the belt to that braces, so
    // one stale row cannot stop a guest's page from rendering.
    const input = toBillInput(
      bundle({
        participants: [participant('p1', 'One')],
        items: [itemRow('i1', 'Thing', 1000, 0)],
        claims: [claimRow('i1', 'p1'), claimRow('i1', 'ghost')],
        adjustments: [
          {
            id: 'a1',
            bill_id: 'bill-1',
            label: 'Stale voucher',
            amount_sen: 300,
            scope: 'person',
            scope_person_ids: ['ghost'],
            created_at: AT,
          },
        ],
        belanja: [
          { id: 'b1', bill_id: 'bill-1', sponsor_id: 'p1', beneficiary_id: 'ghost', created_at: AT },
        ],
      }),
    );

    expect(input.items[0]?.claimantIds).toEqual(['p1']);
    expect(input.adjustments).toEqual([]);
    expect(input.belanja).toEqual([]);
    // And the result is still computable, which is the point.
    expect(() => computeSplit(input)).not.toThrow();
  });

  it('keeps a person-scoped adjustment that still names somebody real', () => {
    const input = toBillInput(
      bundle({
        participants: [participant('p1', 'One')],
        adjustments: [
          {
            id: 'a1',
            bill_id: 'bill-1',
            label: 'Voucher',
            amount_sen: 300,
            scope: 'person',
            scope_person_ids: ['ghost', 'p1'],
            created_at: AT,
          },
        ],
      }),
    );
    expect(input.adjustments[0]?.scope).toEqual({ personIds: ['p1'] });
  });

  it('accepts a numeric rate that arrives as a string', () => {
    const input = toBillInput(
      bundle({
        bill: {
          ...bundle().bill,
          service_charge_rate: '0.10000' as unknown as number,
          service_tax_rate: '0.06000' as unknown as number,
        },
      }),
    );
    expect(input.serviceChargeRate).toBe(0.1);
    expect(input.serviceTaxRate).toBe(0.06);
  });

  it('falls back to a zero rate rather than sending NaN to the engine', () => {
    const input = toBillInput(
      bundle({
        bill: { ...bundle().bill, service_charge_rate: 'not a number' as unknown as number },
      }),
    );
    expect(input.serviceChargeRate).toBe(0);
  });

  it('carries the rounding mode through', () => {
    const input = toBillInput(
      bundle({ bill: { ...bundle().bill, rounding_mode: 'nearest5sen' } }),
    );
    expect(input.roundingMode).toBe('nearest5sen');
  });
});
