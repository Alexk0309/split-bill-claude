import { describe, expect, it } from 'vitest';

import {
  MoneyParseError,
  formatRM,
  formatRMSigned,
  formatSen,
  parseAmountToSen,
  parsePositiveAmountToSen,
} from '../money';

describe('parseAmountToSen', () => {
  it('parses the forms a payer actually types', () => {
    expect(parseAmountToSen('18')).toBe(1800);
    expect(parseAmountToSen('18.5')).toBe(1850);
    expect(parseAmountToSen('18.50')).toBe(1850);
    expect(parseAmountToSen('  18.50  ')).toBe(1850);
    expect(parseAmountToSen('RM18.50')).toBe(1850);
    expect(parseAmountToSen('rm 18.50')).toBe(1850);
    expect(parseAmountToSen('1,234.56')).toBe(123456);
    expect(parseAmountToSen('.50')).toBe(50);
    expect(parseAmountToSen('0')).toBe(0);
  });

  it('does not go through floating point', () => {
    // parseFloat('19.99') * 100 is 1998.9999999999998.
    expect(parseAmountToSen('19.99')).toBe(1999);
    expect(parseAmountToSen('0.29')).toBe(29);
    expect(parseAmountToSen('1.005')).toBe(101);
    expect(parseAmountToSen('8.115')).toBe(812);
  });

  it('rounds a third decimal place half up', () => {
    expect(parseAmountToSen('18.504')).toBe(1850);
    expect(parseAmountToSen('18.505')).toBe(1851);
    expect(parseAmountToSen('18.999')).toBe(1900);
  });

  it('rejects things that are not amounts', () => {
    for (const bad of ['', '   ', 'abc', 'RM', '12.34.56', '1 2', '--5']) {
      expect(() => parseAmountToSen(bad), bad).toThrow(MoneyParseError);
    }
  });

  it('rejects negatives only where negatives are meaningless', () => {
    expect(parseAmountToSen('-5.00')).toBe(-500);
    expect(() => parsePositiveAmountToSen('-5.00')).toThrow(/must not be negative/);
    expect(parsePositiveAmountToSen('5.00')).toBe(500);
  });
});

describe('formatSen', () => {
  it('always shows two decimal places', () => {
    expect(formatSen(1850)).toBe('18.50');
    expect(formatSen(1800)).toBe('18.00');
    expect(formatSen(5)).toBe('0.05');
    expect(formatSen(0)).toBe('0.00');
  });

  it('groups thousands, and can be told not to', () => {
    expect(formatSen(123456)).toBe('1,234.56');
    expect(formatSen(123456, { grouped: false })).toBe('1234.56');
  });

  it('handles negatives', () => {
    expect(formatSen(-250)).toBe('-2.50');
  });

  it('rejects non-integer sen rather than silently truncating', () => {
    expect(() => formatSen(18.5)).toThrow(MoneyParseError);
  });
});

describe('formatRM', () => {
  it('renders the form guests see', () => {
    expect(formatRM(1850)).toBe('RM18.50');
    expect(formatRM(2002)).toBe('RM20.02');
    expect(formatRM(-250)).toBe('-RM2.50');
  });

  it('signs adjustment lines', () => {
    expect(formatRMSigned(-250)).toBe('-RM2.50');
    expect(formatRMSigned(250)).toBe('+RM2.50');
    expect(formatRMSigned(0)).toBe('RM0.00');
  });
});

describe('round trip', () => {
  it('parse then format is stable for every sen value in a plausible range', () => {
    for (let sen = 0; sen <= 20000; sen += 1) {
      expect(parseAmountToSen(formatSen(sen))).toBe(sen);
    }
  });
});
