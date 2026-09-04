import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { loadGuestBill } from '@/lib/bill/load';

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

export default async function GuestBillPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const bundle = await loadGuestBill(token);
  if (!bundle) notFound();

  return <ClaimPage initialBundle={bundle} shareToken={token} />;
}
