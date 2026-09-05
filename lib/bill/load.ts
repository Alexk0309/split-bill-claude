import type { SupabaseClient } from '@supabase/supabase-js';

import { createGuestClient } from '@/lib/supabase/guest';
import type {
  AdjustmentRow,
  BelanjaRow,
  BillBundle,
  BillItemRow,
  BillRow,
  ClaimRow,
  ParticipantRow,
} from '@/lib/supabase/types';

/**
 * `participants` is the one table with column-level grants: guests may read the
 * names but not the claim tokens. Postgres refuses `select *` outright when a
 * role lacks any column, so the columns have to be named -- and naming them is
 * what keeps a future column from silently breaking every guest page.
 *
 * The payer holds full privileges and reads any extra columns separately.
 */
const GUEST_PARTICIPANT_COLUMNS = 'id, bill_id, display_name, settled_at, settled_method, created_at';

/**
 * Loads everything a bill needs in one round trip per table.
 *
 * The queries are deliberately identical for the payer and for a guest: row
 * level security decides what comes back, not the query. That way there is no
 * second code path where a scoping mistake could hide.
 */
async function loadChildren(
  supabase: SupabaseClient,
  billId: string,
): Promise<Omit<BillBundle, 'bill'>> {
  const [items, participants, claims, adjustments, belanja] = await Promise.all([
    supabase.from('bill_items').select('*').eq('bill_id', billId).order('position'),
    supabase.from('participants').select(GUEST_PARTICIPANT_COLUMNS).eq('bill_id', billId).order('created_at'),
    supabase.from('claims').select('*').eq('bill_id', billId),
    supabase.from('adjustments').select('*').eq('bill_id', billId).order('created_at'),
    supabase.from('belanja').select('*').eq('bill_id', billId),
  ]);

  return {
    items: (items.data ?? []) as BillItemRow[],
    participants: (participants.data ?? []) as ParticipantRow[],
    claims: (claims.data ?? []) as ClaimRow[],
    adjustments: (adjustments.data ?? []) as AdjustmentRow[],
    belanja: (belanja.data ?? []) as BelanjaRow[],
  };
}

/** For the payer. Returns null when the bill does not exist or is not theirs. */
export async function loadOwnerBill(
  supabase: SupabaseClient,
  billId: string,
): Promise<BillBundle | null> {
  const { data } = await supabase.from('bills').select('*').eq('id', billId).maybeSingle();
  if (!data) return null;
  const bill = data as BillRow;
  return { bill, ...(await loadChildren(supabase, bill.id)) };
}

/**
 * For a guest holding a share link. Returns null for an unknown or revoked
 * token -- which is also what an attacker probing bill ids gets, since the
 * token is the only thing that opens the door.
 */
export async function loadGuestBill(shareToken: string): Promise<BillBundle | null> {
  const supabase = createGuestClient(shareToken);
  const { data } = await supabase
    .from('bills')
    .select('*')
    .eq('share_token', shareToken)
    .maybeSingle();
  if (!data) return null;
  const bill = data as BillRow;
  return { bill, ...(await loadChildren(supabase, bill.id)) };
}
