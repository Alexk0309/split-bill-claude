/**
 * Spending one scan from a bill's allowance.
 *
 * Replaces the earlier rolling-hour throttle. That guarded against a burst but
 * left the total unbounded -- and it was scoped per bill for receipts and per
 * participant for proofs, both of which a determined user could reset by making
 * a new bill or rejoining under a new name. A per-bill lifetime allowance has
 * no such escape hatch, and unlike a rolling window it is a number you can show
 * somebody.
 *
 * The check and the increment happen in one statement inside `consume_scan`, so
 * two requests arriving together cannot both see the last remaining scan.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { LIMIT_MESSAGES, SCAN_LIMITS, type ScanKind } from '@/lib/limits';

export interface ScanVerdict {
  allowed: boolean;
  message: string;
}

export async function consumeScan(
  supabase: SupabaseClient,
  billId: string,
  kind: ScanKind,
): Promise<ScanVerdict> {
  const { data, error } = await supabase.rpc('consume_scan', {
    p_bill_id: billId,
    p_kind: kind,
    p_limit: SCAN_LIMITS[kind],
  });

  if (error) {
    // Refusing somebody mid-payment because a counter misbehaved is worse than
    // the cost of letting one through, and the bill quota still bounds the
    // damage to a handful of calls.
    return { allowed: true, message: '' };
  }

  // Null means the UPDATE matched nothing, which only happens when the
  // allowance was already spent.
  if (data === null) return { allowed: false, message: LIMIT_MESSAGES[kind] };

  return { allowed: true, message: '' };
}
