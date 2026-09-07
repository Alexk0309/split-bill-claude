import Link from 'next/link';
import { redirect } from 'next/navigation';

import { SubmitButton } from '@/components/pending';
import { Banner, Money, EmptyState, UsageCount } from '@/components/ui';
import { FREE_BILL_QUOTA, LIMIT_MESSAGES, allowance } from '@/lib/limits';
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

  const [{ data }, { data: profile }] = await Promise.all([
    supabase.from('bills').select('*').order('created_at', { ascending: false }),
    supabase.from('profiles').select('bills_created, bill_quota').eq('id', user.id).maybeSingle(),
  ]);
  const bills = (data ?? []) as BillRow[];

  // Counted from bills ever created, not from how many still exist: deleting
  // one does not give the allowance back.
  //
  // A null `bill_quota` means no ceiling, which has to be told apart from a
  // missing profile row -- `?? FREE_BILL_QUOTA` alone would read an unlimited
  // account as a free one that has already run out.
  const quota =
    profile == null ? FREE_BILL_QUOTA : profile.bill_quota === null ? null : Number(profile.bill_quota);
  const bill = allowance(Number(profile?.bills_created ?? bills.length), quota);

  return (
    <main className="mx-auto max-w-md px-5 pt-6 pb-28">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Your bills</h1>
        <span className="flex items-center gap-1">
          <Link href="/profile" className="btn btn-ghost tap px-2 text-[14px]">
            Payment details
          </Link>
          <form action="/auth/signout" method="post">
            <SubmitButton className="btn btn-ghost tap px-2 text-[14px]" pendingLabel="Signing out…">
              Sign out
            </SubmitButton>
          </form>
        </span>
      </header>

      <p className="mt-1">
        <UsageCount used={bill.used} limit={bill.limit} noun="bill" />
      </p>

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
        {bill.exhausted ? (
          <div className="mx-auto max-w-md">
            <Banner tone="warn">{LIMIT_MESSAGES.bills}</Banner>
          </div>
        ) : (
          <form action={createBill} className="mx-auto max-w-md">
            {/*
              This button is why the whole pending-state pass happened. It used
              to sit there unchanged while the action ran, so a slow response
              looked like a missed tap, and every retry was another bill off a
              quota that does not refund.
            */}
            <SubmitButton className="btn btn-primary w-full" pendingLabel="Starting a bill…">
              New bill
            </SubmitButton>
          </form>
        )}
      </div>
    </main>
  );
}
