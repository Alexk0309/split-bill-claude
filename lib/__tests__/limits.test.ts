import { describe, expect, it } from 'vitest';

import {
  FREE_BILL_QUOTA,
  LIMIT_MESSAGES,
  PROOF_SCANS_PER_BILL,
  RECEIPT_SCANS_PER_BILL,
  SCAN_LIMITS,
  allowance,
} from '../limits';

describe('allowance', () => {
  it('reports what is left', () => {
    expect(allowance(0, 3)).toEqual({ used: 0, limit: 3, remaining: 3, exhausted: false });
    expect(allowance(2, 3)).toEqual({ used: 2, limit: 3, remaining: 1, exhausted: false });
    expect(allowance(3, 3)).toEqual({ used: 3, limit: 3, remaining: 0, exhausted: true });
  });

  it('never reports a negative remainder', () => {
    // A quota lowered after the fact, or a counter ahead of the limit, must not
    // render as "-2 bills left".
    expect(allowance(5, 3)).toEqual({ used: 3, limit: 3, remaining: 0, exhausted: true });
  });

  it('treats a nonsense count as zero rather than propagating it', () => {
    expect(allowance(-4, 3).used).toBe(0);
    expect(allowance(-4, 3).remaining).toBe(3);
  });

  it('handles a quota of zero', () => {
    expect(allowance(0, 0)).toEqual({ used: 0, limit: 0, remaining: 0, exhausted: true });
  });
});

describe('the limits themselves', () => {
  it('matches what the database function is asked to enforce', () => {
    // The routes pass SCAN_LIMITS[kind] to consume_scan, so these two must not
    // drift: the number shown and the number enforced are the same constant.
    expect(SCAN_LIMITS.receipt).toBe(RECEIPT_SCANS_PER_BILL);
    expect(SCAN_LIMITS.proof).toBe(PROOF_SCANS_PER_BILL);
  });

  it('leaves room for a real table', () => {
    // One proof per person for a table of seven, plus retries.
    expect(PROOF_SCANS_PER_BILL).toBeGreaterThanOrEqual(14);
    // A bad first photo and a reshoot, plus spare.
    expect(RECEIPT_SCANS_PER_BILL).toBeGreaterThanOrEqual(3);
  });

  it('keeps the free tier bounded', () => {
    // Roughly five sen a scan, so this is the worst case a free account costs.
    const worstCaseCalls = FREE_BILL_QUOTA * (RECEIPT_SCANS_PER_BILL + PROOF_SCANS_PER_BILL);
    expect(worstCaseCalls).toBeLessThanOrEqual(100);
  });

  it('never leaves somebody without a way forward', () => {
    // Both metered features have a manual fallback that costs nothing, and the
    // message has to say so.
    expect(LIMIT_MESSAGES.receipt).toMatch(/by hand/i);
    expect(LIMIT_MESSAGES.proof).toMatch(/mark you as paid/i);
    // And the bill message has to explain why deleting does not help, because
    // that is the first thing somebody will try.
    expect(LIMIT_MESSAGES.bills).toMatch(/deleting/i);
  });
});
