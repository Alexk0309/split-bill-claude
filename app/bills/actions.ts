'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { parsePercentToRate } from '@/lib/bill/rates';
import { MoneyParseError, parsePositiveAmountToSen } from '@/lib/money';
import { DEFAULT_SERVICE_CHARGE_RATE, DEFAULT_SERVICE_TAX_RATE } from '@/lib/split';
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
 * Every mutation below is scoped by `bill_id` and then re-checked by row level
 * security, so a forged id in a form post cannot touch somebody else's bill.
 */
function refresh(billId: string) {
  revalidatePath(`/bills/${billId}`);
  revalidatePath('/bills');
}

export async function createBill(): Promise<never> {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from('bills')
    .insert({
      owner_id: user.id,
      title: '',
      service_charge_rate: DEFAULT_SERVICE_CHARGE_RATE,
      service_tax_rate: DEFAULT_SERVICE_TAX_RATE,
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(error?.message ?? 'Could not create the bill');
  revalidatePath('/bills');
  redirect(`/bills/${data.id}`);
}

export async function updateBillDetails(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const billId = text(formData, 'billId');
  if (!billId) return fail('Missing bill');

  let serviceChargeRate: number;
  let serviceTaxRate: number;
  try {
    serviceChargeRate = parsePercentToRate(text(formData, 'serviceChargePercent'));
    serviceTaxRate = parsePercentToRate(text(formData, 'serviceTaxPercent'));
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Check the rates');
  }

  const roundingMode = text(formData, 'roundingMode') === 'nearest5sen' ? 'nearest5sen' : 'sen';

  const { error } = await supabase
    .from('bills')
    .update({
      title: text(formData, 'title'),
      venue: text(formData, 'venue') || null,
      service_charge_rate: serviceChargeRate,
      service_tax_rate: serviceTaxRate,
      rounding_mode: roundingMode,
    })
    .eq('id', billId);

  if (error) return fail(error.message);
  refresh(billId);
  return OK;
}

export async function addItem(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const billId = text(formData, 'billId');
  const name = text(formData, 'name');
  const priceInput = text(formData, 'price');

  if (!billId) return fail('Missing bill');
  if (!name) return fail('Give the item a name');

  let priceSen: number;
  try {
    priceSen = parsePositiveAmountToSen(priceInput);
  } catch (error) {
    return fail(error instanceof MoneyParseError ? `"${priceInput}" is not a price` : 'Bad price');
  }

  const { data: last } = await supabase
    .from('bill_items')
    .select('position')
    .eq('bill_id', billId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from('bill_items').insert({
    bill_id: billId,
    name,
    price_sen: priceSen,
    position: (last?.position ?? -1) + 1,
  });

  if (error) return fail(error.message);
  refresh(billId);
  return OK;
}

export async function deleteItem(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const billId = text(formData, 'billId');
  const itemId = text(formData, 'itemId');
  if (!billId || !itemId) return;

  await supabase.from('bill_items').delete().eq('id', itemId).eq('bill_id', billId);
  refresh(billId);
}

export async function addParticipant(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const billId = text(formData, 'billId');
  const name = text(formData, 'name');

  if (!billId) return fail('Missing bill');
  if (!name) return fail('Enter a name');
  if (name.length > 60) return fail('That name is too long');

  const { error } = await supabase
    .from('participants')
    .insert({ bill_id: billId, display_name: name });

  if (error) return fail(error.message);
  refresh(billId);
  return OK;
}

export async function deleteParticipant(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const billId = text(formData, 'billId');
  const participantId = text(formData, 'participantId');
  if (!billId || !participantId) return;

  await supabase.from('participants').delete().eq('id', participantId).eq('bill_id', billId);
  refresh(billId);
}

/** Moves a draft to open, which is what makes the share link meaningful. */
export async function openBill(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const billId = text(formData, 'billId');
  if (!billId) return;

  await supabase.from('bills').update({ status: 'open' }).eq('id', billId);
  refresh(billId);
}

export async function deleteBill(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const billId = text(formData, 'billId');
  if (!billId) return;

  await supabase.from('bills').delete().eq('id', billId);
  revalidatePath('/bills');
  redirect('/bills');
}
