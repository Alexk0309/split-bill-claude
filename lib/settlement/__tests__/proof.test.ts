import { describe, expect, it } from 'vitest';

import { assessProof, normaliseMobile, type ParsedProof } from '../proof';

function proof(overrides: Partial<ParsedProof> = {}): ParsedProof {
  return {
    amount_sen: 9989,
    reference: 'MB2609061432001',
    paid_at: '2026-09-06T14:32:00+08:00',
    recipient: '0123456789',
    bank: 'Maybank',
    looks_like_transfer: true,
    confidence: 'high',
    ...overrides,
  };
}

describe('assessProof', () => {
  it('settles a transfer for the exact amount', () => {
    const result = assessProof({ parsed: proof(), expectedSen: 9989 });
    expect(result.matched).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('refuses anything that is not a transfer confirmation', () => {
    const result = assessProof({
      parsed: proof({ looks_like_transfer: false }),
      expectedSen: 9989,
    });
    expect(result).toMatchObject({ matched: false, reason: 'not-a-transfer' });
  });

  it('refuses a proof it could not read, rather than assuming', () => {
    expect(
      assessProof({ parsed: proof({ amount_sen: null }), expectedSen: 9989 }),
    ).toMatchObject({ matched: false, reason: 'unreadable' });

    // Right amount, but the model said it was guessing.
    expect(
      assessProof({ parsed: proof({ confidence: 'low' }), expectedSen: 9989 }),
    ).toMatchObject({ matched: false, reason: 'unreadable' });
  });

  it('refuses a non-integer amount', () => {
    expect(
      assessProof({ parsed: proof({ amount_sen: 99.89 }), expectedSen: 9989 }),
    ).toMatchObject({ matched: false, reason: 'unreadable' });
  });

  it('refuses the wrong amount, over or under', () => {
    expect(assessProof({ parsed: proof(), expectedSen: 10000 })).toMatchObject({
      matched: false,
      reason: 'amount',
    });
    expect(
      assessProof({ parsed: proof({ amount_sen: 20000 }), expectedSen: 9989 }),
    ).toMatchObject({ matched: false, reason: 'amount' });
  });

  it('refuses the same transfer submitted twice', () => {
    const result = assessProof({
      parsed: proof(),
      expectedSen: 9989,
      usedReferences: ['MB2609061432001'],
    });
    expect(result).toMatchObject({ matched: false, reason: 'duplicate-reference' });
  });

  it('catches a reused reference before the amount check', () => {
    // A screenshot lifted from another debt has the right amount by
    // construction, so checking the amount first would wave it through.
    const result = assessProof({
      parsed: proof(),
      expectedSen: 9989,
      usedReferences: ['mb2609061432001'],
    });
    expect(result.reason).toBe('duplicate-reference');
  });

  it('ignores case and padding when comparing references', () => {
    expect(
      assessProof({
        parsed: proof({ reference: '  mb2609061432001  ' }),
        expectedSen: 9989,
        usedReferences: ['MB2609061432001'],
      }).reason,
    ).toBe('duplicate-reference');
  });

  it('settles when the reference is new', () => {
    expect(
      assessProof({
        parsed: proof(),
        expectedSen: 9989,
        usedReferences: ['SOMETHING-ELSE'],
      }).matched,
    ).toBe(true);
  });

  it('catches a transfer that went to somebody else', () => {
    const result = assessProof({
      parsed: proof({ recipient: '0198887777' }),
      expectedSen: 9989,
      payeeMobile: '012-345 6789',
    });
    expect(result).toMatchObject({ matched: false, reason: 'wrong-recipient' });
  });

  it('accepts the payer number written in any of the usual ways', () => {
    for (const recipient of ['0123456789', '012-345 6789', '+60123456789', '60123456789']) {
      expect(
        assessProof({ parsed: proof({ recipient }), expectedSen: 9989, payeeMobile: '0123456789' })
          .matched,
        recipient,
      ).toBe(true);
    }
  });

  it('does not judge the recipient when either side is unknown', () => {
    // A confirmation showing a name rather than a number must not be rejected.
    expect(
      assessProof({
        parsed: proof({ recipient: 'AINA BINTI HASSAN' }),
        expectedSen: 9989,
        payeeMobile: '0123456789',
      }).matched,
    ).toBe(true);

    expect(
      assessProof({ parsed: proof(), expectedSen: 9989, payeeMobile: null }).matched,
    ).toBe(true);
  });

  it('never says a guest is lying', () => {
    // Every mismatch routes to the payer rather than accusing anyone.
    const reasons = [
      proof({ looks_like_transfer: false }),
      proof({ amount_sen: null }),
      proof({ amount_sen: 100 }),
      proof(),
    ];
    for (const parsed of reasons) {
      const result = assessProof({
        parsed,
        expectedSen: 9989,
        usedReferences: ['MB2609061432001'],
        payeeMobile: '0123456789',
      });
      expect(result.message).not.toMatch(/fraud|lying|fake|refus/i);
    }
  });

  it('settles a zero balance', () => {
    expect(
      assessProof({ parsed: proof({ amount_sen: 0 }), expectedSen: 0 }).matched,
    ).toBe(true);
  });
});

describe('normaliseMobile', () => {
  it('reduces the usual Malaysian formats to the same nine digits', () => {
    expect(normaliseMobile('0123456789')).toBe('123456789');
    expect(normaliseMobile('012-345 6789')).toBe('123456789');
    expect(normaliseMobile('+60 12 345 6789')).toBe('123456789');
    expect(normaliseMobile('60123456789')).toBe('123456789');
  });

  it('gives up rather than guessing at something too short', () => {
    expect(normaliseMobile('12345')).toBeNull();
    expect(normaliseMobile('')).toBeNull();
    expect(normaliseMobile(null)).toBeNull();
    expect(normaliseMobile('AINA BINTI HASSAN')).toBeNull();
  });
});
