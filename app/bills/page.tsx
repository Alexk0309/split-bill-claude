import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Money, EmptyState } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import type { BillRow } from '@/lib/supabase/types';

import { createBill } from './actions';

/**
 * Never prerendered. Every one of these pages is a function of who is signed in,
 * so a build-time render is both meaningless and, without env vars present at
 * build time, fatal -- which is how this surfaced: the first Vercel build died
 * trying to prerender the landing page.
 */
export const dynamic = 'force-dynamic';


function whenLabel(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_LABEL: Record<BillRow['status'], string> = {
  draft: 'Draft',
  open: 'Open',
  settled: 'Settled',
};

export default async function BillsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data } = await supabase
    .from('bills')
    .select('*')
    .order('created_at', { ascending: false });
  const bills = (data ?? []) as BillRow[];

  return (
    <main className="mx-auto max-w-md px-5 pt-6 pb-28">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Your bills</h1>
        <span className="flex items-center gap-1">
          <Link href="/profile" className="btn btn-ghost tap px-2 text-[14px]">
            Payment details
          </Link>
          <form action="/auth/signout" method="post">
            <button type="submit" className="btn btn-ghost tap px-2 text-[14px]">
              Sign out
            </button>
          </form>
        </span>
      </header>

      <div className="mt-5 space-y-2">
        {bills.length === 0 ? (
          <EmptyState
            title="No bills yet"
            hint="Start one when the receipt lands on the table."
          />
        ) : (
          bills.map((bill) => (
            <Link
              key={bill.id}
              href={`/bills/${bill.id}`}
              className="card tap flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold">
                  {bill.title || bill.venue || 'Untitled bill'}
                </span>
                <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                  {STATUS_LABEL[bill.status]} · {whenLabel(bill.created_at)}
                </span>
              </span>
              <Money sen={bill.subtotal_sen} className="shrink-0 font-semibold" />
            </Link>
          ))
        )}
      </div>

      <div
        className="fixed inset-x-0 bottom-0 border-t px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
      >
        <form action={createBill} className="mx-auto max-w-md">
          <button type="submit" className="btn btn-primary w-full">
            New bill
          </button>
        </form>
      </div>
    </main>
  );
}
