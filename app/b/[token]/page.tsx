import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { loadGuestBill } from '@/lib/bill/load';
import { createAdminClient, hasServiceRoleKey } from '@/lib/supabase/admin';
import { createGuestClient } from '@/lib/supabase/guest';
import type { PayeeInfo } from '@/lib/supabase/types';

import { ClaimPage } from './claim-page';

export const metadata: Metadata = {
  title: 'Your share',
  // A shared bill is visible only to people holding the link. Keep it out of
  // search results.
  robots: { index: false, follow: false },
};

/**
 * Guests are anonymous, so nothing here is cached across requests: two people
 * on the same link must not see each other's rendering.
 */
export const dynamic = 'force-dynamic';

/**
 * The three facts a guest is allowed to know about the payer.
 *
 * `get_payee` is SECURITY DEFINER and takes the share token, so it returns the
 * payer's payment details to link holders without opening up `profiles`, which
 * stays owner-only.
 */
async function loadPayee(shareToken: string): Promise<PayeeInfo | null> {
  const supabase = createGuestClient(shareToken);
  const { data } = await supabase.rpc('get_payee', { p_share_token: shareToken });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  // The QR bucket is private. A short-lived signed URL is minted here rather
  // than making the bucket public, so the image is not left permanently
  // readable by anyone who once saw the link.
  let qrUrl: string | null = null;
  if (row.duitnow_qr_path && hasServiceRoleKey()) {
    const { data: signed } = await createAdminClient()
      .storage.from('duitnow-qr')
      .createSignedUrl(row.duitnow_qr_path, 3600);
    qrUrl = signed?.signedUrl ?? null;
  }

  return {
    display_name: row.display_name ?? null,
    duitnow_mobile: row.duitnow_mobile ?? null,
    qr_url: qrUrl,
  };
}

export default async function GuestBillPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const bundle = await loadGuestBill(token);
  if (!bundle) notFound();

  return <ClaimPage initialBundle={bundle} shareToken={token} payee={await loadPayee(token)} />;
}
