/**
 * Exact rational arithmetic over bigint.
 *
 * Currency in this app is integer sen everywhere it is stored or displayed, but
 * the *intermediate* per-person share of a split is genuinely fractional
 * (RM32.00 across 3 people is 1066.666... sen). Doing that in floating point
 * leaks sen. So intermediates are held as exact fractions and only collapse to
 * integers once, in the largest-remainder pass at the end of the engine.
 *
 * Invariants: `d > 0n`, and `gcd(|n|, d) === 1n`.
 */

export interface Rational {
  readonly n: bigint;
  readonly d: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

export function rational(n: bigint, d: bigint = 1n): Rational {
  if (d === 0n) throw new RangeError('Rational denominator must not be zero');
  let nn = n;
  let dd = d;
  if (dd < 0n) {
    nn = -nn;
    dd = -dd;
  }
  const g = gcd(nn, dd);
  if (g > 1n) {
    nn /= g;
    dd /= g;
  }
  return { n: nn, d: dd };
}

export const ZERO: Rational = { n: 0n, d: 1n };
export const ONE: Rational = { n: 1n, d: 1n };
export const HALF: Rational = { n: 1n, d: 2n };

export function fromInt(v: number | bigint): Rational {
  if (typeof v === 'number' && !Number.isInteger(v)) {
    throw new RangeError(`fromInt requires an integer, received ${v}`);
  }
  return { n: BigInt(v), d: 1n };
}

export const add = (a: Rational, b: Rational): Rational =>
  rational(a.n * b.d + b.n * a.d, a.d * b.d);

export const sub = (a: Rational, b: Rational): Rational =>
  rational(a.n * b.d - b.n * a.d, a.d * b.d);

export const mul = (a: Rational, b: Rational): Rational => rational(a.n * b.n, a.d * b.d);

export function div(a: Rational, b: Rational): Rational {
  if (b.n === 0n) throw new RangeError('Rational division by zero');
  return rational(a.n * b.d, a.d * b.n);
}

export const neg = (a: Rational): Rational => ({ n: -a.n, d: a.d });

/** -1 when a < b, 0 when equal, 1 when a > b. Both denominators are positive. */
export function cmp(a: Rational, b: Rational): -1 | 0 | 1 {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
}

export const isZero = (a: Rational): boolean => a.n === 0n;
export const isNegative = (a: Rational): boolean => a.n < 0n;
export const isPositive = (a: Rational): boolean => a.n > 0n;

export const sum = (values: readonly Rational[]): Rational =>
  values.reduce<Rational>((acc, v) => add(acc, v), ZERO);

/** Largest integer <= a. Floors toward negative infinity, unlike bigint `/`. */
export function floorToBigInt(a: Rational): bigint {
  const q = a.n / a.d;
  return a.n % a.d !== 0n && a.n < 0n ? q - 1n : q;
}

/** floor(a + 1/2). Half-way values go up, which is what a Malaysian receipt does. */
export function roundHalfUpToBigInt(a: Rational): bigint {
  return floorToBigInt(add(a, HALF));
}

/**
 * Exact decimal -> Rational. Accepts `-12.345`, `.5`, `1e-7`, `+3`.
 *
 * This exists so that a rate written as `0.06` becomes exactly 6/100 rather than
 * the binary double 0.059999999999999997779..., which can tip a half-way
 * rounding the wrong way.
 */
export function fromDecimalString(s: string): Rational {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s.trim());
  const intPart = m?.[2] ?? '';
  const fracPart = m?.[3] ?? '';
  if (!m || (intPart === '' && fracPart === '')) {
    throw new RangeError(`Not a decimal number: ${JSON.stringify(s)}`);
  }
  const sign = m[1] === '-' ? -1n : 1n;
  const exp = m[4] ? Number.parseInt(m[4], 10) : 0;
  let n = BigInt((intPart || '0') + fracPart) * sign;
  let d = 10n ** BigInt(fracPart.length);
  if (exp > 0) n *= 10n ** BigInt(exp);
  else if (exp < 0) d *= 10n ** BigInt(-exp);
  return rational(n, d);
}

/**
 * Number -> Rational via its shortest round-trip decimal form, so `0.1` means
 * one tenth (what the author wrote) and not the double nearest to it.
 */
export function fromNumber(v: number): Rational {
  if (!Number.isFinite(v)) throw new RangeError(`Not a finite number: ${v}`);
  return fromDecimalString(String(v));
}

/** Lossy: for display and debugging only, never for money. */
export const toNumber = (a: Rational): number => Number(a.n) / Number(a.d);

/** Fixed-point decimal string, rounded half up. Display only. */
export function toFixed(a: Rational, dp: number): string {
  if (!Number.isInteger(dp) || dp < 0) throw new RangeError(`Bad decimal places: ${dp}`);
  const scaled = mul(a, { n: 10n ** BigInt(dp), d: 1n });
  const q = roundHalfUpToBigInt(scaled);
  const negative = q < 0n;
  const digits = (negative ? -q : q).toString().padStart(dp + 1, '0');
  const cut = digits.length - dp;
  const out = dp === 0 ? digits : `${digits.slice(0, cut)}.${digits.slice(cut)}`;
  return negative ? `-${out}` : out;
}
