/**
 * A ceiling on how often one person can make the server call a paid vision API.
 *
 * Both image endpoints cost real money per request. The receipt scan is behind
 * a sign-in, so it is bounded by who has an account; the proof upload is
 * reachable by anyone holding a share link, which is a link that gets forwarded
 * around a WhatsApp group. Neither should be able to run up a bill.
 *
 * The counter is the rows the endpoint already writes -- `receipts` per bill,
 * `payment_proofs` per participant -- so there is nothing extra to store and no
 * new dependency. It resets on a rolling hour.
 *
 * This is a cost guard, not a security control: it limits spend by an honest
 * user with a stuck finger and by a bored link-holder. Anything more determined
 * belongs behind a WAF or Vercel's own rate limiting.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ThrottleVerdict {
  allowed: boolean;
  message: string;
}

const ALLOWED = { allowed: true, message: '' } as const;

const HOUR_MS = 3_600_000;

async function countSince(
  supabase: SupabaseClient,
  table: string,
  column: string,
  value: string,
  sinceMs: number,
): Promise<number | null> {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq(column, value)
    .gte('created_at', new Date(Date.now() - sinceMs).toISOString());
  // A failed count must not block a legitimate upload; spending a little is
  // better than refusing somebody who is trying to pay.
  return error ? null : (count ?? 0);
}

/** One person, one bill: enough for a retry or two, not enough to be a problem. */
const MAX_PROOFS_PER_HOUR = 6;

export async function throttleProofUpload(
  supabase: SupabaseClient,
  participantId: string,
): Promise<ThrottleVerdict> {
  const recent = await countSince(supabase, 'payment_proofs', 'participant_id', participantId, HOUR_MS);
  if (recent !== null && recent >= MAX_PROOFS_PER_HOUR) {
    return {
      allowed: false,
      message:
        'That is a lot of attempts in a short time. Wait a little, or ask the payer to mark you as paid.',
    };
  }
  return ALLOWED;
}

/** A long receipt might be re-shot a few times; twelve an hour is plenty. */
const MAX_SCANS_PER_HOUR = 12;

export async function throttleReceiptScan(
  supabase: SupabaseClient,
  billId: string,
): Promise<ThrottleVerdict> {
  const recent = await countSince(supabase, 'receipts', 'bill_id', billId, HOUR_MS);
  if (recent !== null && recent >= MAX_SCANS_PER_HOUR) {
    return {
      allowed: false,
      message: 'That is a lot of scans in a short time. Wait a little, or enter the items by hand.',
    };
  }
  return ALLOWED;
}
