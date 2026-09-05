import { describe, expect, it } from 'vitest';

import { failureMessage, parseReceiptJson, stripFence } from '../parse';

const good = {
  venue: 'Village Park',
  items: [
    { name: 'Nasi lemak ayam', quantity: 1, price_sen: 1800 },
    { name: 'Teh tarik', quantity: 2, price_sen: 700 },
  ],
  subtotal_sen: 2500,
  service_charge_sen: 250,
  service_tax_sen: 165,
  total_sen: 2915,
  confidence: 'high',
};

const json = (value: unknown) => JSON.stringify(value);

describe('parseReceiptJson', () => {
  it('accepts a well-formed receipt', () => {
    const result = parseReceiptJson(json(good));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.venue).toBe('Village Park');
    expect(result.receipt.items).toHaveLength(2);
    expect(result.receipt.total_sen).toBe(2915);
    expect(result.receipt.confidence).toBe('high');
  });

  it('survives a markdown fence the schema should have prevented', () => {
    const result = parseReceiptJson('```json\n' + json(good) + '\n```');
    expect(result.ok).toBe(true);
  });

  it('rejects prose', () => {
    const result = parseReceiptJson('Here is the receipt you asked for!');
    expect(result).toMatchObject({ ok: false, reason: 'not-json' });
  });

  it('rejects JSON that is not a receipt object', () => {
    expect(parseReceiptJson('[]')).toMatchObject({ ok: false, reason: 'not-an-object' });
    expect(parseReceiptJson('"hello"')).toMatchObject({ ok: false, reason: 'not-an-object' });
    expect(parseReceiptJson('null')).toMatchObject({ ok: false, reason: 'not-an-object' });
  });

  it('rejects money that is not a whole number of sen', () => {
    // The engine would throw on these, taking the page down instead of showing
    // the payer something they can fix.
    for (const bad of [18.5, -100, '1800', null, undefined, Number.NaN]) {
      const result = parseReceiptJson(json({ ...good, subtotal_sen: bad }));
      expect(result, String(bad)).toMatchObject({ ok: false, reason: 'bad-field' });
    }
  });

  it('rejects an item with a bad price or no name', () => {
    expect(
      parseReceiptJson(json({ ...good, items: [{ name: 'X', quantity: 1, price_sen: 1.5 }] })),
    ).toMatchObject({ ok: false, reason: 'bad-field' });

    expect(
      parseReceiptJson(json({ ...good, items: [{ name: '   ', quantity: 1, price_sen: 100 }] })),
    ).toMatchObject({ ok: false, reason: 'bad-field' });
  });

  it('names the offending item so the failure is actionable', () => {
    const result = parseReceiptJson(
      json({
        ...good,
        items: [
          { name: 'Fine', quantity: 1, price_sen: 100 },
          { name: 'Broken', quantity: 1, price_sen: -5 },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain('Broken');
  });

  it('corrects a silly quantity rather than failing the whole scan', () => {
    // Quantity is presentational; the engine only ever sees the line total.
    const result = parseReceiptJson(
      json({ ...good, items: [{ name: 'Kopi', quantity: 0, price_sen: 300 }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.items[0]?.quantity).toBe(1);
  });

  it('treats an empty item list as an unreadable photo', () => {
    const result = parseReceiptJson(json({ ...good, items: [], confidence: 'low' }));
    expect(result).toMatchObject({ ok: false, reason: 'no-items' });
  });

  it('falls back to low confidence rather than trusting an unknown value', () => {
    const result = parseReceiptJson(json({ ...good, confidence: 'very sure' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.confidence).toBe('low');
  });

  it('normalises a missing or blank venue to null', () => {
    for (const venue of [null, '', '   ', 42]) {
      const result = parseReceiptJson(json({ ...good, venue }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.receipt.venue).toBeNull();
    }
  });

  it('trims whitespace off names', () => {
    const result = parseReceiptJson(
      json({ ...good, venue: '  Village Park  ', items: [{ name: '  Kopi  ', quantity: 1, price_sen: 300 }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.venue).toBe('Village Park');
    expect(result.receipt.items[0]?.name).toBe('Kopi');
  });
});

describe('stripFence', () => {
  it('leaves bare JSON alone', () => {
    expect(stripFence('{"a":1}')).toBe('{"a":1}');
  });

  it('removes both fence styles', () => {
    expect(stripFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
});

describe('failureMessage', () => {
  it('always offers the way forward', () => {
    for (const reason of ['not-json', 'not-an-object', 'bad-field', 'no-items'] as const) {
      expect(failureMessage(reason)).toMatch(/type the items in below/);
    }
  });
});
