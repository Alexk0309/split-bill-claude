/**
 * What a free account gets.
 *
 * Three things cost money per use: creating a bill (cheap, but it is the unit
 * the product is sold in), reading a receipt, and reading a transfer
 * confirmation. The last two are vision calls.
 *
 * Rough cost of one vision call, on claude-sonnet-4-6 at $3/$15 per MTok:
 * a downscaled photo is about 1,700 image tokens (Anthropic bills roughly
 * width x height / 750, and the client caps the long edge at 1568px), plus
 * ~400 tokens of prompt and ~400 of JSON back. That is around US$0.012, call it
 * five sen. This is an estimate from the pricing table, not a measurement.
 *
 * So a free account's worst case is:
 *
 *   3 bills x (5 receipt scans + 15 proof scans) = 60 calls, about RM3.
 *
 * Which is the number to have in mind when the paid tier gets priced.
 *
 * Raising a limit for one account is an UPDATE on `profiles.bill_quota`, not a
 * migration, and a null there means no ceiling at all. The per-bill scan limits are here rather than in the database so
 * that the number shown to the user and the number enforced are the same
 * constant; `consume_scan` takes the limit as an argument for exactly that
 * reason.
 */

/** Bills an account may ever create. Deleting one does not give it back. */
export const FREE_BILL_QUOTA = 3;

/**
 * One good photo is usually enough; this leaves room for a bad first shot, a
 * reshoot in better light, and a couple of spare.
 */
export const RECEIPT_SCANS_PER_BILL = 5;

/**
 * One per person at the table, plus retries. Comfortable for a table of seven;
 * a very large group may run out, and the payer can still mark people paid by
 * hand, which costs nothing.
 */
export const PROOF_SCANS_PER_BILL = 15;

export type ScanKind = 'receipt' | 'proof';

export const SCAN_LIMITS: Record<ScanKind, number> = {
  receipt: RECEIPT_SCANS_PER_BILL,
  proof: PROOF_SCANS_PER_BILL,
};

export interface Allowance {
  used: number;
  /** Null when there is no ceiling. */
  limit: number | null;
  /** Null when there is no ceiling -- not Infinity, which formats badly. */
  remaining: number | null;
  exhausted: boolean;
  unlimited: boolean;
}

/**
 * A null limit is unlimited rather than zero. That distinction matters: read the
 * other way round, an account with no ceiling would be told it had none left.
 */
export function allowance(used: number, limit: number | null): Allowance {
  const counted = Math.max(0, used);

  if (limit === null) {
    return { used: counted, limit: null, remaining: null, exhausted: false, unlimited: true };
  }

  const clamped = Math.min(counted, limit);
  return {
    used: clamped,
    limit,
    remaining: limit - clamped,
    exhausted: clamped >= limit,
    unlimited: false,
  };
}

/**
 * What a person is told when they run out. Never a dead end: each one names the
 * thing they can still do, because both features have a manual fallback that
 * costs nothing.
 */
export const LIMIT_MESSAGES = {
  bills:
    'You have used all 3 of your bills. Deleting one does not free it up — the count is of bills created.',
  receipt:
    'This bill has used all of its receipt scans. You can still add and edit items by hand.',
  proof:
    'This bill has used all of its proof checks. Ask the payer to mark you as paid instead.',
} as const;
