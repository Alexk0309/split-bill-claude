/**
 * Whether what somebody paid still matches what they owe.
 *
 * Shares move while a bill is open: an item is divided by however many people
 * have claimed it so far, so two people sharing a RM200 steamboat are each told
 * RM100 until the other two tap it and the figure halves. That is not a
 * miscalculation -- it is correct at every instant -- but anyone who paid at the
 * wrong instant is now out of pocket, and nothing recomputes their transfer.
 *
 * Pure, like the engine, and deliberately says nothing about *why* the figure
 * moved: a payer correcting a price after somebody paid drifts identically, and
 * both cases need the same sentence said out loud.
 */

export type DriftKind =
  /** Paid exactly what is owed. */
  | 'square'
  /** Paid more than is owed now -- money to give back. */
  | 'overpaid'
  /** Paid less than is owed now -- still short. */
  | 'underpaid'
  /** Settled before the amount was recorded, so there is nothing to compare. */
  | 'unknown';

export interface SettlementDrift {
  kind: DriftKind;
  /** paid − owed. Positive means money to return. Zero when unknown. */
  deltaSen: number;
}

const SQUARE: SettlementDrift = { kind: 'square', deltaSen: 0 };
const UNKNOWN: SettlementDrift = { kind: 'unknown', deltaSen: 0 };

/**
 * @param settledAmountSen What they actually paid, or null if never recorded.
 * @param amountDueSen What the engine says they owe right now.
 */
export function settlementDrift(
  settledAmountSen: number | null | undefined,
  amountDueSen: number,
): SettlementDrift {
  // Rows settled before the column existed. Saying nothing is right here: a
  // guess would be indistinguishable from a fact on screen.
  if (typeof settledAmountSen !== 'number' || !Number.isSafeInteger(settledAmountSen)) {
    return UNKNOWN;
  }
  if (!Number.isSafeInteger(amountDueSen)) return UNKNOWN;

  const deltaSen = settledAmountSen - amountDueSen;
  if (deltaSen === 0) return SQUARE;
  return { kind: deltaSen > 0 ? 'overpaid' : 'underpaid', deltaSen };
}

/** True when this is worth interrupting somebody about. */
export function needsAttention(drift: SettlementDrift): boolean {
  return drift.kind === 'overpaid' || drift.kind === 'underpaid';
}
