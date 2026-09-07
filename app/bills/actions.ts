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

/**
 * Goes through an RPC rather than a plain insert so that tapping twice cannot
 * produce two bills: `create_bill` hands back the untouched draft it already
 * made instead of making another, under a per-account lock.
 *
 * That guard is on the server on purpose. The button disables itself while this
 * runs, but that only works once the page has hydrated, and a bill spent by
 * accident is not refundable.
 */
export async function createBill(): Promise<never> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc('create_bill', {
    p_service_charge_rate: DEFAULT_SERVICE_CHARGE_RATE,
    p_service_tax_rate: DEFAULT_SERVICE_TAX_RATE,
  });

  if (error || !data) {
    // The quota is enforced by a trigger so it holds however the row is
    // inserted; this turns its exception into something readable. The page
    // normally hides the button before anyone gets here.
    if (error?.message?.includes('BILL_QUOTA_REACHED')) {
      redirect('/bills?limit=bills');
    }
    throw new Error(error?.message ?? 'Could not create the bill');
  }
  revalidatePath('/bills');
  redirect(`/bills/${data as string}`);
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

/* -------------------------------------------------------------------------- */
/* Receipt review                                                             */
/* -------------------------------------------------------------------------- */

interface ReviewedItem {
  name: string;
  price: string;
}

function parseReviewedItems(raw: string): ReviewedItem[] | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return null;
    return value.map((entry) => ({
      name: String((entry as ReviewedItem)?.name ?? ''),
      price: String((entry as ReviewedItem)?.price ?? ''),
    }));
  } catch {
    return null;
  }
}

/**
 * Writes the payer's reviewed items onto the bill.
 *
 * What arrives here is what was on the screen, not what the model said: the
 * review step is between the two, and this action has no access to the parsed
 * receipt at all. Prices are re-parsed server-side, so an edited field is
 * validated the same way a hand-typed one is.
 */
export async function applyReceipt(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const billId = text(formData, 'billId');
  const receiptId = text(formData, 'receiptId');
  if (!billId) return fail('Missing bill');

  const rows = parseReviewedItems(text(formData, 'items'));
  if (!rows) return fail('Could not read the edited items');

  const items: { name: string; price_sen: number }[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    if (name === '') return fail('Every item needs a name');
    try {
      items.push({ name, price_sen: parsePositiveAmountToSen(row.price) });
    } catch {
      return fail(
        row.price.trim() === ''
          ? `"${name}" has no price`
          : `"${row.price}" is not a price (${name})`,
      );
    }
  }
  if (items.length === 0) return fail('Add at least one item');

  let serviceChargeRate: number;
  let serviceTaxRate: number;
  try {
    serviceChargeRate = parsePercentToRate(text(formData, 'serviceChargePercent'));
    serviceTaxRate = parsePercentToRate(text(formData, 'serviceTaxPercent'));
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Check the rates');
  }

  // One transaction, so the bill is never briefly half-empty while somebody is
  // claiming from it.
  const { error } = await supabase.rpc('replace_bill_items', {
    p_bill_id: billId,
    p_items: items,
    p_service_charge_rate: serviceChargeRate,
    p_service_tax_rate: serviceTaxRate,
    p_venue: text(formData, 'venue') || null,
  });
  if (error) return fail(error.message);

  if (receiptId) {
    await supabase
      .from('receipts')
      .update({ applied_at: new Date().toISOString() })
      .eq('id', receiptId)
      .eq('bill_id', billId);
  }

  refresh(billId);
  redirect(`/bills/${billId}`);
}
