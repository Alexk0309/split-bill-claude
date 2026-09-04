/**
 * Rate parsing at the UI boundary.
 *
 * The payer types a percentage because that is what the receipt prints ("10%"),
 * but the engine and the database both want a fraction. Converting in one place
 * keeps the two from drifting.
 */

export class RateParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateParseError';
  }
}

/** The column is numeric(6,5), so a rate carries at most five decimal places. */
const RATE_DECIMALS = 5;

/** `"10"` -> `0.1`, `"6"` -> `0.06`, `"8.5"` -> `0.085`. */
export function parsePercentToRate(input: string): number {
  const cleaned = input.trim().replace(/%$/, '').trim();
  if (cleaned === '') return 0;

  if (!/^\d*(?:\.\d*)?$/.test(cleaned) || cleaned === '.') {
    throw new RateParseError(`Not a percentage: ${JSON.stringify(input)}`);
  }

  const percent = Number.parseFloat(cleaned);
  if (!Number.isFinite(percent)) {
    throw new RateParseError(`Not a percentage: ${JSON.stringify(input)}`);
  }
  if (percent > 100) {
    throw new RateParseError('A rate above 100% is not a rate');
  }

  // toFixed then re-parse, so 8.5% becomes exactly 0.085 rather than a value
  // whose shortest decimal form has a trailing tail.
  return Number.parseFloat((percent / 100).toFixed(RATE_DECIMALS));
}

/** `0.1` -> `"10"`, `0.06` -> `"6"`, `0.085` -> `"8.5"`. Trailing zeros trimmed. */
export function formatRateAsPercent(rate: number | string): string {
  const value = typeof rate === 'number' ? rate : Number.parseFloat(rate);
  if (!Number.isFinite(value)) return '0';
  const percent = (value * 100).toFixed(3);
  return percent.replace(/\.?0+$/, '') || '0';
}
