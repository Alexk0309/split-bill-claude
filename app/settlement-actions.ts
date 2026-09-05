'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

export type ActionResult = { ok: true } | { ok: false; error: string };

const OK: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return { supabase, user };
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The payer's own payment details.
 *
 * A DuitNow mobile number is not validated beyond having enough digits to be
 * one: it is shown to guests to type into their banking app, and their bank
 * does the real checking. Rejecting an unusual format here would only stop
 * somebody using a number that works.
 */
export async function saveProfile(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();

  const mobile = text(formData, 'duitnowMobile');
  if (mobile !== '' && mobile.replace(/\D/g, '').length < 9) {
    return fail('That does not look like a mobile number');
  }

  const qrPath = text(formData, 'duitnowQrPath');

  const { error } = await supabase.from('profiles').upsert(
    {
      id: user.id,
      display_name: text(formData, 'displayName') || null,
      duitnow_mobile: mobile || null,
      // Only overwritten when a new QR was uploaded in this submission.
      ...(qrPath ? { duitnow_qr_path: qrPath } : {}),
    },
    { onConflict: 'id' },
  );

  if (error) return fail(error.message);
  revalidatePath('/profile');
  revalidatePath('/bills');
  return OK;
}

export async function removeQr(): Promise<void> {
  const { supabase, user } = await requireUser();
  const { data } = await supabase
    .from('profiles')
    .select('duitnow_qr_path')
    .eq('id', user.id)
    .maybeSingle();

  const path = data?.duitnow_qr_path as string | null | undefined;
  if (path) await supabase.storage.from('duitnow-qr').remove([path]);

  await supabase.from('profiles').update({ duitnow_qr_path: null }).eq('id', user.id);
  revalidatePath('/profile');
}

/**
 * The payer's word, which is the other honest source of "this is paid".
 *
 * Blunt on purpose: the app cannot see anyone's bank account, so when there is
 * no proof to read, the person who is owed the money decides.
 */
export async function markSettled(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const billId = text(formData, 'billId');
  const participantId = text(formData, 'participantId');
  const method = text(formData, 'method');
  if (!billId || !participantId) return;

  await supabase
    .from('participants')
    .update({
      settled_at: new Date().toISOString(),
      settled_method: method === 'cash' ? 'cash' : method === 'duitnow' ? 'duitnow' : 'other',
    })
    .eq('id', participantId)
    .eq('bill_id', billId);

  revalidatePath(`/bills/${billId}`);
}

/** Undo, because a mistaken "settled" has to be reversible to be trustworthy. */
export async function unmarkSettled(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const billId = text(formData, 'billId');
  const participantId = text(formData, 'participantId');
  if (!billId || !participantId) return;

  await supabase
    .from('participants')
    .update({ settled_at: null, settled_method: null })
    .eq('id', participantId)
    .eq('bill_id', billId);

  revalidatePath(`/bills/${billId}`);
}
