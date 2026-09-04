import { describe, expect, it } from 'vitest';

import { RateParseError, formatRateAsPercent, parsePercentToRate } from '../rates';

describe('parsePercentToRate', () => {
  it('reads the percentages printed on Malaysian receipts', () => {
    expect(parsePercentToRate('10')).toBe(0.1);
    expect(parsePercentToRate('6')).toBe(0.06);
    expect(parsePercentToRate('8.5')).toBe(0.085);
    expect(parsePercentToRate('0')).toBe(0);
  });

  it('tolerates a percent sign and surrounding space', () => {
    expect(parsePercentToRate(' 10% ')).toBe(0.1);
    expect(parsePercentToRate('6 %')).toBe(0.06);
  });

  it('treats an empty field as no charge', () => {
    expect(parsePercentToRate('')).toBe(0);
    expect(parsePercentToRate('   ')).toBe(0);
  });

  it('does not leave a floating point tail on the stored rate', () => {
    // 8.5 / 100 in plain float is 0.085 exactly, but 7.3 / 100 is not.
    expect(parsePercentToRate('7.3')).toBe(0.073);
    expect(String(parsePercentToRate('7.3'))).toBe('0.073');
  });

  it('rejects nonsense and impossible rates', () => {
    for (const bad of ['abc', '1.2.3', '-5', '.', '10a']) {
      expect(() => parsePercentToRate(bad), bad).toThrow(RateParseError);
    }
    expect(() => parsePercentToRate('150')).toThrow(/above 100%/);
  });
});

describe('formatRateAsPercent', () => {
  it('renders a stored rate back into the field the payer typed', () => {
    expect(formatRateAsPercent(0.1)).toBe('10');
    expect(formatRateAsPercent(0.06)).toBe('6');
    expect(formatRateAsPercent(0.085)).toBe('8.5');
    expect(formatRateAsPercent(0)).toBe('0');
  });

  it('accepts the string form numeric columns sometimes arrive as', () => {
    expect(formatRateAsPercent('0.10000')).toBe('10');
    expect(formatRateAsPercent('0.06000')).toBe('6');
  });

  it('round trips', () => {
    for (const percent of ['0', '5', '6', '8.5', '10', '12.75', '100']) {
      expect(formatRateAsPercent(parsePercentToRate(percent))).toBe(percent);
    }
  });
});
