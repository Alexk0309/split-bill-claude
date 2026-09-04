import { describe, expect, it } from 'vitest';

import * as R from '../rational';

const r = (n: number, d = 1) => R.rational(BigInt(n), BigInt(d));

describe('construction', () => {
  it('normalises sign and common factors', () => {
    expect(r(2, 4)).toEqual({ n: 1n, d: 2n });
    expect(r(-2, 4)).toEqual({ n: -1n, d: 2n });
    expect(r(2, -4)).toEqual({ n: -1n, d: 2n });
    expect(r(0, 5)).toEqual({ n: 0n, d: 1n });
  });

  it('rejects a zero denominator', () => {
    expect(() => r(1, 0)).toThrow(RangeError);
    expect(() => R.div(r(1), r(0))).toThrow(RangeError);
  });
});

describe('arithmetic is exact', () => {
  it('adds thirds back to a whole', () => {
    const third = R.div(r(1), r(3));
    expect(R.add(R.add(third, third), third)).toEqual({ n: 1n, d: 1n });
  });

  it('splits 3200 sen three ways without loss', () => {
    const perHead = R.div(r(3200), r(3));
    const total = R.add(R.add(perHead, perHead), perHead);
    expect(total).toEqual({ n: 3200n, d: 1n });
    // The float version of the same sum is 3199.9999999999995.
    expect(R.toFixed(perHead, 6)).toBe('1066.666667');
  });

  it('compares without converting to float', () => {
    expect(R.cmp(r(1, 3), r(1, 2))).toBe(-1);
    expect(R.cmp(r(1, 2), r(1, 3))).toBe(1);
    expect(R.cmp(r(2, 4), r(1, 2))).toBe(0);
  });
});

describe('floor and round', () => {
  it('floors toward negative infinity, unlike bigint division', () => {
    expect(R.floorToBigInt(r(7, 2))).toBe(3n);
    expect(R.floorToBigInt(r(-7, 2))).toBe(-4n);
    expect(R.floorToBigInt(r(-4, 2))).toBe(-2n);
    expect(R.floorToBigInt(r(0))).toBe(0n);
  });

  it('rounds half up', () => {
    expect(R.roundHalfUpToBigInt(r(1, 2))).toBe(1n);
    expect(R.roundHalfUpToBigInt(r(3, 2))).toBe(2n);
    expect(R.roundHalfUpToBigInt(r(-1, 2))).toBe(0n);
    expect(R.roundHalfUpToBigInt(r(8679, 10))).toBe(868n);
  });
});

describe('decimal conversion', () => {
  it('reads a rate as the decimal that was written, not the nearest double', () => {
    expect(R.fromNumber(0.06)).toEqual({ n: 3n, d: 50n }); // exactly 6/100
    expect(R.fromNumber(0.1)).toEqual({ n: 1n, d: 10n });
    expect(R.fromNumber(0)).toEqual({ n: 0n, d: 1n });
  });

  it('handles exponent notation', () => {
    expect(R.fromDecimalString('1e-2')).toEqual({ n: 1n, d: 100n });
    expect(R.fromDecimalString('1.5e2')).toEqual({ n: 150n, d: 1n });
    expect(R.fromNumber(1e-7)).toEqual({ n: 1n, d: 10000000n });
  });

  it('rejects junk', () => {
    for (const bad of ['', 'abc', '1.2.3', '--1']) {
      expect(() => R.fromDecimalString(bad), bad).toThrow(RangeError);
    }
    expect(() => R.fromNumber(Number.NaN)).toThrow(RangeError);
    expect(() => R.fromNumber(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('formats to fixed decimals, rounding half up', () => {
    expect(R.toFixed(r(1, 3), 6)).toBe('0.333333');
    expect(R.toFixed(r(2, 3), 6)).toBe('0.666667');
    expect(R.toFixed(r(-2, 3), 6)).toBe('-0.666667');
    expect(R.toFixed(r(5, 2), 0)).toBe('3');
    expect(R.toFixed(r(1, 8), 2)).toBe('0.13');
    expect(R.toFixed(r(0), 2)).toBe('0.00');
  });
});

describe('sum', () => {
  it('is zero over an empty list', () => {
    expect(R.sum([])).toEqual({ n: 0n, d: 1n });
  });

  it('accumulates exactly over many fractions', () => {
    const sevenths = Array.from({ length: 7 }, () => R.div(r(1), r(7)));
    expect(R.sum(sevenths)).toEqual({ n: 1n, d: 1n });
  });
});
