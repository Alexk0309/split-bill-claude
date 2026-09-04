/**
 * The currency boundary.
 *
 * Money is integer sen everywhere inside the app. This module is the only place
 * a human-typed string becomes sen, and the only place sen becomes a string for
 * display. Nothing here uses `parseFloat` or floating point arithmetic -- the
 * digits are read directly, so `19.99` cannot arrive as 1998.9999999999998.
 */

export const SEN_PER_RINGGIT = 100;

export class MoneyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyParseError';
  }
}

/**
 * Parse a human-typed ringgit amount into integer sen.
 *
 * Accepts `18`, `18.5`, `18.50`, `RM18.50`, `rm 18.50`, `1,234.56`, `.50`.
 * More than two decimal places rounds half up rather than erroring, because a
 * receipt occasionally prints three and rejecting it mid-typing is hostile.
 */
export function parseAmountToSen(input: string): number {
  if (typeof input !== 'string') {
    throw new MoneyParseError(`Expected a string amount, received ${typeof input}`);
  }

  // Only the RM prefix and thousands separators are stripped. Internal spaces are
  // left in so that "1 2" fails loudly instead of silently becoming RM12.00.
  const cleaned = input
    .trim()
    .replace(/^rm\s*/i, '')
    .replace(/,/g, '');

  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
  const intPart = match?.[2] ?? '';
  const fracPart = match?.[3] ?? '';
  if (!match || (intPart === '' && fracPart === '')) {
    throw new MoneyParseError(`Not an amount: ${JSON.stringify(input)}`);
  }

  const negative = match[1] === '-';
  const whole = BigInt(intPart || '0');

  // Read exactly two decimal digits, then round half up on the third.
  const padded = fracPart.padEnd(3, '0');
  let sen = whole * 100n + BigInt(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) sen += 1n;

  const result = Number(negative ? -sen : sen);
  if (!Number.isSafeInteger(result)) {
    throw new MoneyParseError(`Amount is too large: ${JSON.stringify(input)}`);
  }
  return result;
}

/** As `parseAmountToSen`, but rejects negatives. Use for prices and discounts. */
export function parsePositiveAmountToSen(input: string): number {
  const sen = parseAmountToSen(input);
  if (sen < 0) throw new MoneyParseError(`Amount must not be negative: ${JSON.stringify(input)}`);
  return sen;
}

/** `1234` -> `"12.34"`. Always two decimal places, no currency symbol. */
export function formatSen(sen: number, options: { grouped?: boolean } = {}): string {
  if (!Number.isSafeInteger(sen)) {
    throw new MoneyParseError(`Expected integer sen, received ${sen}`);
  }
  const negative = sen < 0;
  const abs = Math.abs(sen);
  const whole = Math.floor(abs / SEN_PER_RINGGIT);
  const cents = abs % SEN_PER_RINGGIT;
  const grouped = options.grouped ?? true;
  // Grouped by hand rather than via toLocaleString, so the output cannot shift
  // with the host's ICU data.
  const wholeText = grouped
    ? String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    : String(whole);
  return `${negative ? '-' : ''}${wholeText}.${String(cents).padStart(2, '0')}`;
}

/** `1234` -> `"RM12.34"`. The form shown to guests. */
export function formatRM(sen: number, options: { grouped?: boolean } = {}): string {
  const text = formatSen(Math.abs(sen), options);
  return `${sen < 0 ? '-' : ''}RM${text}`;
}

/** `-250` -> `"-RM2.50"`, `250` -> `"+RM2.50"`. For adjustment lines. */
export function formatRMSigned(sen: number): string {
  if (sen === 0) return formatRM(0);
  return `${sen > 0 ? '+' : ''}${formatRM(sen)}`;
}
