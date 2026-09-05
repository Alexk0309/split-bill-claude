/**
 * Validation of the model's output.
 *
 * `output_config.format` already constrains the response to the schema, so in
 * the normal case this only has to parse JSON. It validates anyway: this is the
 * boundary where untrusted text becomes money, and a number that is somehow a
 * float or negative must not reach the engine, which would throw and take the
 * whole page down instead of showing the payer a fixable review screen.
 *
 * Pure, so every malformed shape can be tested without an API key.
 */

import type { ParsedReceipt, ParsedReceiptItem, ReceiptConfidence } from './schema';

export type ReceiptParseFailure =
  | 'not-json'
  | 'not-an-object'
  | 'bad-field'
  | 'no-items';

export type ReceiptParseResult =
  | { ok: true; receipt: ParsedReceipt }
  | { ok: false; reason: ReceiptParseFailure; detail: string };

const CONFIDENCES: ReceiptConfidence[] = ['high', 'medium', 'low'];

const fail = (reason: ReceiptParseFailure, detail: string): ReceiptParseResult => ({
  ok: false,
  reason,
  detail,
});

/**
 * Strips a markdown fence if the model wrapped its JSON in one.
 *
 * Structured outputs should make this impossible. It costs three lines to
 * survive it anyway, and the alternative is a scan that fails for a reason the
 * payer cannot act on.
 */
export function stripFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
}

function isSen(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseItem(value: unknown, index: number): ParsedReceiptItem | string {
  if (typeof value !== 'object' || value === null) return `item ${index} is not an object`;
  const record = value as Record<string, unknown>;

  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (name === '') return `item ${index} has no name`;

  if (!isSen(record.price_sen)) return `item ${index} ("${name}") has a bad price`;

  // Quantity is presentational here -- the engine only ever sees the line total --
  // so a missing or silly value is corrected rather than rejected.
  const rawQuantity = record.quantity;
  const quantity =
    typeof rawQuantity === 'number' && Number.isSafeInteger(rawQuantity) && rawQuantity > 0
      ? rawQuantity
      : 1;

  return { name, quantity, price_sen: record.price_sen };
}

export function parseReceiptJson(raw: string): ReceiptParseResult {
  let value: unknown;
  try {
    value = JSON.parse(stripFence(raw));
  } catch {
    return fail('not-json', 'The model did not return JSON.');
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('not-an-object', 'The model returned JSON, but not a receipt object.');
  }
  const record = value as Record<string, unknown>;

  for (const field of [
    'subtotal_sen',
    'service_charge_sen',
    'service_tax_sen',
    'total_sen',
  ] as const) {
    if (!isSen(record[field])) {
      return fail('bad-field', `${field} is not a whole number of sen.`);
    }
  }

  if (!Array.isArray(record.items)) {
    return fail('bad-field', 'items is not a list.');
  }

  const items: ParsedReceiptItem[] = [];
  for (const [index, entry] of record.items.entries()) {
    const parsed = parseItem(entry, index);
    if (typeof parsed === 'string') return fail('bad-field', parsed);
    items.push(parsed);
  }

  if (items.length === 0) {
    // The prompt asks for this explicitly when the image is not a receipt, so it
    // is an expected answer rather than a malfunction.
    return fail('no-items', 'No line items could be read from this photo.');
  }

  const confidence = CONFIDENCES.includes(record.confidence as ReceiptConfidence)
    ? (record.confidence as ReceiptConfidence)
    : 'low';

  const venue =
    typeof record.venue === 'string' && record.venue.trim() !== '' ? record.venue.trim() : null;

  return {
    ok: true,
    receipt: {
      venue,
      items,
      subtotal_sen: record.subtotal_sen as number,
      service_charge_sen: record.service_charge_sen as number,
      service_tax_sen: record.service_tax_sen as number,
      total_sen: record.total_sen as number,
      confidence,
    },
  };
}

/** Wording the payer sees when a scan does not work out. Always offers the way forward. */
export function failureMessage(reason: ReceiptParseFailure): string {
  switch (reason) {
    case 'no-items':
      return 'No items could be read from that photo. Try again with the whole receipt in frame, or type the items in below.';
    case 'not-json':
    case 'not-an-object':
    case 'bad-field':
      return 'That photo could not be read. Try another shot, or type the items in below.';
  }
}
