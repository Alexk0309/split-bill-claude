/**
 * Checking the parsed receipt against itself, and recovering the rates.
 *
 * Two jobs, both pure:
 *
 *   1. Does the transcription add up? If the items do not sum to the subtotal,
 *      or subtotal plus charges does not reach the printed total, something was
 *      misread and the payer has to see it before anybody claims anything.
 *
 *   2. What rates was this restaurant actually charging? Deriving them from the
 *      printed amounts means an unusual rate is handled without anybody having
 *      to notice it, which is the whole point of rates being inputs.
 */

import * as R from '@/lib/split/rational';

import type { ParsedReceipt } from './schema';

export interface Reconciliation {
  /** Sum of the parsed line items. */
  itemsSumSen: number;
  /** Printed subtotal. */
  subtotalSen: number;
  /** itemsSum - subtotal. Positive means the items overshoot. */
  itemsDeltaSen: number;
  itemsMatchSubtotal: boolean;

  /** subtotal + service charge + service tax, from the printed figures. */
  computedTotalSen: number;
  /** Printed total. */
  totalSen: number;
  /** computedTotal - total. */
  totalDeltaSen: number;
  totalMatches: boolean;

  /** True only when both checks pass, so the payer can be left alone. */
  ok: boolean;
}

export function reconcile(receipt: ParsedReceipt): Reconciliation {
  let itemsSumSen = 0;
  for (const item of receipt.items) itemsSumSen += item.price_sen;

  const computedTotalSen =
    receipt.subtotal_sen + receipt.service_charge_sen + receipt.service_tax_sen;

  const itemsDeltaSen = itemsSumSen - receipt.subtotal_sen;
  const totalDeltaSen = computedTotalSen - receipt.total_sen;

  const itemsMatchSubtotal = itemsDeltaSen === 0;
  const totalMatches = totalDeltaSen === 0;

  return {
    itemsSumSen,
    subtotalSen: receipt.subtotal_sen,
    itemsDeltaSen,
    itemsMatchSubtotal,
    computedTotalSen,
    totalSen: receipt.total_sen,
    totalDeltaSen,
    totalMatches,
    ok: itemsMatchSubtotal && totalMatches,
  };
}

/* -------------------------------------------------------------------------- */
/* Rate recovery                                                              */
/* -------------------------------------------------------------------------- */

/** Grids tried in order: half a percent covers almost every real rate, then tenths. */
const RATE_GRIDS = [0.005, 0.001];

/** The engine's rounding, so a candidate is tested the way the bill was computed. */
function chargeFor(baseSen: number, rate: number): number {
  return Number(R.roundHalfUpToBigInt(R.mul(R.fromInt(baseSen), R.fromNumber(rate))));
}

/**
 * Recovers the rate that produced a printed charge.
 *
 * The printed amount is a rounded number, so dividing gives a rate with a tail
 * on it: RM13.15 on RM131.50 divides cleanly, but RM0.51 on RM5.05 gives
 * 0.100990... rather than 0.1. Instead of dividing and hoping, candidate rates
 * from a round grid are tested by recomputing the charge: the nicest rate that
 * reproduces the printed amount exactly is the one the restaurant used.
 *
 * Falls back to the plain quotient when nothing round fits, which is exactly the
 * case the spec cares about -- a restaurant charging something unusual.
 */
export function deriveRate(chargeSen: number, baseSen: number): number | null {
  if (baseSen <= 0) return chargeSen === 0 ? 0 : null;
  if (chargeSen === 0) return 0;

  const exact = chargeSen / baseSen;
  if (exact > 1) return null;

  for (const grid of RATE_GRIDS) {
    const steps = Math.round(exact / grid);
    // Nearest grid point first, then its neighbours, so the closest match wins.
    for (const candidate of [steps, steps - 1, steps + 1]) {
      if (candidate < 0) continue;
      const rate = Number((candidate * grid).toFixed(5));
      if (rate > 1) continue;
      if (chargeFor(baseSen, rate) === chargeSen) return rate;
    }
  }

  // numeric(6,5) in the database, so five places is all that survives anyway.
  return Number(exact.toFixed(5));
}

export interface DerivedRates {
  serviceChargeRate: number | null;
  serviceTaxRate: number | null;
}

/**
 * Both rates, in the order a Malaysian bill computes them: the service charge on
 * the subtotal, the tax on the subtotal *plus* the service charge.
 */
export function deriveRates(receipt: ParsedReceipt): DerivedRates {
  const serviceChargeRate = deriveRate(receipt.service_charge_sen, receipt.subtotal_sen);
  const taxableSen = receipt.subtotal_sen + receipt.service_charge_sen;
  const serviceTaxRate = deriveRate(receipt.service_tax_sen, taxableSen);
  return { serviceChargeRate, serviceTaxRate };
}
