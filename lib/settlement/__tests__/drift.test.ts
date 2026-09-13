import { describe, expect, it } from 'vitest';

import { needsAttention, settlementDrift } from '../drift';

describe('settlementDrift', () => {
  it('says nothing when the transfer still matches the debt', () => {
    expect(settlementDrift(5000, 5000)).toEqual({ kind: 'square', deltaSen: 0 });
  });

  it('catches the case this was written for', () => {
    // A RM200 steamboat, claimed by two people. Each is told RM100 and one of
    // them pays. The other two then claim it and every share halves.
    const paidWhenTwoHadClaimed = 10000;
    const owedOnceFourHadClaimed = 5000;
    expect(settlementDrift(paidWhenTwoHadClaimed, owedOnceFourHadClaimed)).toEqual({
      kind: 'overpaid',
      deltaSen: 5000,
    });
  });

  it('catches the drift in the other direction too', () => {
    // Same mechanism, opposite sign: somebody pays, then claims another item,
    // or the payer corrects a price upwards.
    expect(settlementDrift(5000, 7500)).toEqual({ kind: 'underpaid', deltaSen: -2500 });
  });

  it('reports one sen of drift rather than rounding it away', () => {
    // Cash-mode shares move in five sen steps and proof matching is exact, so a
    // single sen here is a real discrepancy, not noise.
    expect(settlementDrift(5001, 5000).kind).toBe('overpaid');
    expect(settlementDrift(4999, 5000).kind).toBe('underpaid');
  });

  describe('when the amount was never recorded', () => {
    // Rows settled before the column existed. The figure at the time cannot be
    // recomputed, and a guess on screen is indistinguishable from a fact.
    it('says unknown rather than assuming they paid nothing', () => {
      expect(settlementDrift(null, 5000)).toEqual({ kind: 'unknown', deltaSen: 0 });
      expect(settlementDrift(undefined, 5000)).toEqual({ kind: 'unknown', deltaSen: 0 });
    });

    it('does not report zero-owed rows as square', () => {
      // The trap: null paid against 0 owed subtracts to 0, which would read as
      // "settled exactly" for a row we know nothing about.
      expect(settlementDrift(null, 0).kind).toBe('unknown');
    });
  });

  it('refuses to compare nonsense', () => {
    expect(settlementDrift(5000, Number.NaN).kind).toBe('unknown');
    expect(settlementDrift(1.5, 5000).kind).toBe('unknown');
  });
});

describe('needsAttention', () => {
  it('is true only when somebody has to do something about it', () => {
    expect(needsAttention(settlementDrift(10000, 5000))).toBe(true);
    expect(needsAttention(settlementDrift(5000, 7500))).toBe(true);
    expect(needsAttention(settlementDrift(5000, 5000))).toBe(false);
    // An unknown row is not an alarm: nothing is known to be wrong.
    expect(needsAttention(settlementDrift(null, 5000))).toBe(false);
  });
});
