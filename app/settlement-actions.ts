'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { loadOwnerBill } from '@/lib/bill/load';
import { toBillInput } from '@/lib/bill/to-engine-input';
import { cadenceOf, reminderMessage, reminderStatus, whatsappLink } from '@/lib/reminders/schedule';
import { computeSplit } from '@/lib/split';
import { siteUrl } from '@/lib/supabase/env';
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

/* -------------------------------------------------------------------------- */
/* Reminders                                                                  */
/* -------------------------------------------------------------------------- */

export async function setReminders(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const billId = text(formData, 'billId');
  if (!billId) return;

  const enabled = text(formData, 'enabled') === 'on';
  const cadence = text(formData, 'cadence') === 'brisk' ? 'brisk' : 'gentle';

  const { data: current } = await supabase
    .from('bills')
    .select('reminders_started_at')
    .eq('id', billId)
    .maybeSingle();

  await supabase
    .from('bills')
    .update({
      reminders_enabled: enabled,
      reminder_cadence: cadence,
      // The clock starts the first time they are switched on, so turning them
      // on for an old bill does not fire a backlog of nudges at once.
      reminders_started_at:
        enabled && !current?.reminders_started_at
          ? new Date().toISOString()
          : (current?.reminders_started_at ?? null),
    })
    .eq('id', billId);

  revalidatePath(`/bills/${billId}`);
}

/** Three days, which is the same gap the gentle cadence leaves anyway. */
const SNOOZE_DAYS = 3;

export async function snoozeReminder(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const billId = text(formData, 'billId');
  const participantId = text(formData, 'participantId');
  if (!billId || !participantId) return;

  await supabase
    .from('participants')
    .update({
      reminder_snoozed_until: new Date(Date.now() + SNOOZE_DAYS * 86_400_000).toISOString(),
    })
    .eq('id', participantId)
    .eq('bill_id', billId);

  revalidatePath(`/bills/${billId}`);
}

export async function setParticipantMuted(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const billId = text(formData, 'billId');
  const participantId = text(formData, 'participantId');
  if (!billId || !participantId) return;

  await supabase
    .from('participants')
    .update({ reminders_muted: text(formData, 'muted') === 'true' })
    .eq('id', participantId)
    .eq('bill_id', billId);

  revalidatePath(`/bills/${billId}`);
}

/**
 * Records a nudge and hands off to WhatsApp.
 *
 * The message is composed here rather than posted from the page, so what gets
 * sent is always the wording in `lib/reminders/schedule.ts` that the tests hold
 * to being blameless. The count is incremented first: an accidental double tap
 * should cost a nudge from the allowance of three, not slip past the cap.
 */
export async function sendNudge(formData: FormData): Promise<never> {
  const { supabase } = await requireUser();
  const billId = text(formData, 'billId');
  const participantId = text(formData, 'participantId');
  if (!billId || !participantId) redirect('/bills');

  const bundle = await loadOwnerBill(supabase, billId);
  if (!bundle) redirect('/bills');

  const { data: person } = await supabase
    .from('participants')
    .select('id, display_name, reminders_sent, last_reminded_at, reminders_muted, reminder_snoozed_until, settled_at')
    .eq('id', participantId)
    .eq('bill_id', billId)
    .maybeSingle();
  if (!person) redirect(`/bills/${billId}`);

  let amountDueSen = 0;
  try {
    const split = computeSplit(toBillInput(bundle));
    amountDueSen = split.people.find((p) => p.personId === participantId)?.amountDueSen ?? 0;
  } catch {
    redirect(`/bills/${billId}`);
  }

  const policy = cadenceOf(bundle.bill.reminder_cadence);
  const status = reminderStatus(
    {
      amountDueSen,
      settledAt: person.settled_at as string | null,
      muted: Boolean(person.reminders_muted),
      snoozedUntil: person.reminder_snoozed_until as string | null,
      remindersSent: Number(person.reminders_sent ?? 0),
      lastRemindedAt: person.last_reminded_at as string | null,
      startedAt: bundle.bill.reminders_started_at,
    },
    policy,
    new Date(),
  );

  // The cap and the mute are enforced here as well as in the UI, so a stale
  // page cannot send a fourth nudge to somebody who asked to be left alone.
  if (status.kind !== 'due') redirect(`/bills/${billId}`);

  const sentCount = Number(person.reminders_sent ?? 0) + 1;
  await supabase
    .from('participants')
    .update({ reminders_sent: sentCount, last_reminded_at: new Date().toISOString() })
    .eq('id', participantId)
    .eq('bill_id', billId);

  revalidatePath(`/bills/${billId}`);

  redirect(
    whatsappLink(
      reminderMessage({
        name: String(person.display_name),
        amountSen: amountDueSen,
        billTitle: bundle.bill.title,
        venue: bundle.bill.venue,
        shareUrl: `${siteUrl()}/b/${bundle.bill.share_token}`,
        stage: status.stage,
      }),
    ),
  );
}
