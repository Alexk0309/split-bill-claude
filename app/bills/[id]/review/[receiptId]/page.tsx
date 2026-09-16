import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Banner } from '@/components/ui';
import { parseReceiptJson } from '@/lib/ocr/parse';
import { deriveRates } from '@/lib/ocr/reconcile';
import { createClient } from '@/lib/supabase/server';

import { ReceiptReview } from './receipt-review';

/**
 * Never prerendered. Every one of these pages is a function of who is signed in,
 * so a build-time render is both meaningless and, without env vars present at
 * build time, fatal -- which is how this surfaced: the first Vercel build died
 * trying to prerender the landing page.
 */
export const dynamic = 'force-dynamic';


export default async function ReceiptReviewPage({
  params,
}: {
  params: Promise<{ id: string; receiptId: string }>;
}) {
  const { id: billId, receiptId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Row level security scopes this to the payer's own bills, so a receipt id
  // from somebody else's bill simply is not here.
  const { data } = await supabase
    .from('receipts')
    .select('id, status, parsed, error')
    .eq('id', receiptId)
    .eq('bill_id', billId)
    .maybeSingle();

  if (!data) notFound();

  const failed = (message: string) => (
    <main className="mx-auto max-w-md px-5 pt-6 pb-16">
      <h1 className="type-title">That scan did not work</h1>
      <div className="mt-4">
        <Banner tone="warn">{message}</Banner>
      </div>
      <Link href={`/bills/${billId}`} data-press="button" className="btn btn-primary mt-6 w-full">
        Enter the items by hand
      </Link>
    </main>
  );

  if (data.status !== 'parsed' || !data.parsed) {
    return failed(
      (data.error as string | null) ?? 'The receipt could not be read. Enter the items by hand.',
    );
  }

  // Re-validated on the way out as well as on the way in: the row is JSON, and
  // the review screen must never be handed a price the engine would reject.
  const parsed = parseReceiptJson(JSON.stringify(data.parsed));
  if (!parsed.ok) return failed('The saved scan could not be read. Enter the items by hand.');

  return (
    <ReceiptReview
      billId={billId}
      receiptId={receiptId}
      receipt={parsed.receipt}
      rates={deriveRates(parsed.receipt)}
    />
  );
}
