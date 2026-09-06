import { type NextRequest, NextResponse } from 'next/server';

import { deriveRates, reconcile } from '@/lib/ocr/reconcile';
import { consumeScan } from '@/lib/ai/consume-scan';
import { isSupportedMediaType, scanReceipt } from '@/lib/ocr/scan';
import { createClient } from '@/lib/supabase/server';

/**
 * Scans an uploaded receipt photo.
 *
 * The image is already in Storage under the payer's own folder; this reads it
 * back, sends it to the vision model, and records the result so the review
 * screen survives a reload.
 *
 * Every failure path returns 200 with `ok: false` and a sentence the payer can
 * act on. A scan that does not work is an ordinary outcome here, not an
 * exception -- the fallback is always the manual entry form that is already on
 * the screen behind it.
 */

/** Backstop only; the client downscales to a few hundred KB before uploading. */
const MAX_IMAGE_BYTES = 3_500_000;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: billId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: 'Sign in again to scan a receipt.' }, { status: 401 });
  }

  let storagePath: unknown;
  try {
    ({ storagePath } = (await request.json()) as { storagePath?: unknown });
  } catch {
    return NextResponse.json({ ok: false, message: 'Bad request.' }, { status: 400 });
  }

  // Storage policies already scope reads to the payer's own folder. Checking the
  // prefix as well means a forged path is rejected outright rather than relying
  // on one layer.
  const expectedPrefix = `${user.id}/${billId}/`;
  if (typeof storagePath !== 'string' || !storagePath.startsWith(expectedPrefix)) {
    return NextResponse.json({ ok: false, message: 'Bad request.' }, { status: 400 });
  }

  // Row level security would reject the insert below anyway; this gives a clean
  // 404 instead of a policy error.
  const { data: bill } = await supabase.from('bills').select('id').eq('id', billId).maybeSingle();
  if (!bill) {
    return NextResponse.json({ ok: false, message: 'Bill not found.' }, { status: 404 });
  }

  // Spent before the row is created and before the image is sent anywhere, so
  // a refused scan costs nothing.
  const allowance = await consumeScan(supabase, billId, 'receipt');
  if (!allowance.allowed) {
    return NextResponse.json({ ok: false, message: allowance.message });
  }

  const { data: receiptRow, error: insertError } = await supabase
    .from('receipts')
    .insert({ bill_id: billId, storage_path: storagePath, status: 'pending' })
    .select('id')
    .single();

  if (insertError || !receiptRow) {
    return NextResponse.json(
      { ok: false, message: 'Could not start the scan. Enter the items by hand.' },
      { status: 500 },
    );
  }
  const receiptId = receiptRow.id as string;

  async function recordFailure(message: string) {
    await supabase
      .from('receipts')
      .update({ status: 'failed', error: message })
      .eq('id', receiptId);
    return NextResponse.json({ ok: false, receiptId, message });
  }

  const { data: blob, error: downloadError } = await supabase.storage
    .from('receipts')
    .download(storagePath);

  if (downloadError || !blob) {
    return recordFailure('That photo could not be read back. Try uploading it again.');
  }
  if (blob.size > MAX_IMAGE_BYTES) {
    return recordFailure('That photo is too large. Try again, or enter the items by hand.');
  }

  const mediaType = blob.type || 'image/jpeg';
  if (!isSupportedMediaType(mediaType)) {
    return recordFailure('That image format is not supported. Take a photo instead.');
  }

  const base64 = Buffer.from(await blob.arrayBuffer()).toString('base64');
  const outcome = await scanReceipt(base64, mediaType);

  if (!outcome.ok) {
    return recordFailure(outcome.message);
  }

  await supabase
    .from('receipts')
    .update({
      status: 'parsed',
      parsed: outcome.receipt,
      confidence: outcome.receipt.confidence,
      error: null,
    })
    .eq('id', receiptId);

  return NextResponse.json({
    ok: true,
    receiptId,
    receipt: outcome.receipt,
    reconciliation: reconcile(outcome.receipt),
    rates: deriveRates(outcome.receipt),
  });
}
