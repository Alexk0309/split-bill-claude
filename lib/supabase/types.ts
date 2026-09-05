/**
 * Database row shapes, matching supabase/migrations/0001_init.sql.
 *
 * Hand-written rather than generated, because `supabase gen types` needs a
 * running project. Regenerate over this file once the CLI is set up:
 *
 *   supabase gen types typescript --local > lib/supabase/types.ts
 */

export type BillStatus = 'draft' | 'open' | 'settled';
export type RoundingModeRow = 'sen' | 'nearest5sen';
export type AdjustmentScopeRow = 'proportional' | 'person';
export type SettledMethod = 'duitnow' | 'cash' | 'other';

export interface ProfileRow {
  id: string;
  display_name: string | null;
  duitnow_mobile: string | null;
  duitnow_qr_path: string | null;
  created_at: string;
}

export interface BillRow {
  id: string;
  owner_id: string;
  title: string;
  venue: string | null;
  currency: string;
  subtotal_sen: number;
  /** numeric(6,5); PostgREST returns it as a JSON number. */
  service_charge_rate: number;
  service_tax_rate: number;
  rounding_mode: RoundingModeRow;
  status: BillStatus;
  share_token: string;
  created_at: string;
}

export interface BillItemRow {
  id: string;
  bill_id: string;
  name: string;
  price_sen: number;
  position: number;
  created_at: string;
}

export interface ParticipantRow {
  id: string;
  bill_id: string;
  display_name: string;
  settled_at: string | null;
  settled_method: SettledMethod | null;
  created_at: string;
}

/** Only ever visible to the payer; guests are not granted the column. */
export interface ParticipantRowWithToken extends ParticipantRow {
  claim_token: string;
}

export interface ClaimRow {
  item_id: string;
  participant_id: string;
  bill_id: string;
  created_at: string;
}

export interface AdjustmentRow {
  id: string;
  bill_id: string;
  label: string;
  amount_sen: number;
  scope: AdjustmentScopeRow;
  scope_person_ids: string[];
  created_at: string;
}

export interface BelanjaRow {
  id: string;
  bill_id: string;
  sponsor_id: string;
  beneficiary_id: string;
  created_at: string;
}

/** Everything needed to compute a split, as loaded from the database. */
export interface BillBundle {
  bill: BillRow;
  items: BillItemRow[];
  participants: ParticipantRow[];
  claims: ClaimRow[];
  adjustments: AdjustmentRow[];
  belanja: BelanjaRow[];
}

export interface GuestIdentity {
  participantId: string;
  claimToken: string;
}

export interface PaymentProofRow {
  id: string;
  bill_id: string;
  participant_id: string;
  amount_sen: number | null;
  reference: string | null;
  paid_at: string | null;
  recipient: string | null;
  bank: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  expected_sen: number;
  matched: boolean;
  mismatch_reason: string | null;
  created_at: string;
}

/** What a guest is allowed to know about the person they are paying. */
export interface PayeeInfo {
  display_name: string | null;
  duitnow_mobile: string | null;
  /** A short-lived signed URL, generated server-side; never the storage path. */
  qr_url: string | null;
}
