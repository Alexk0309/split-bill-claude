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

/**
 * A status told by colour as well as word, but never by colour alone.
 *
 * Open is the one that wants something from you, so it is the only one that
 * gets the accent. Settled is finished and quiet; a draft has not started.
 */
const STATUS_COLOR: Record<BillRow['status'], string> = {
  draft: 'var(--text-faint)',
  open: 'var(--accent-strong)',
  settled: 'var(--good)',
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
    <main className="mx-auto max-w-md px-5 pt-6 pb-32">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="type-title">Your bills</h1>
          <p className="mt-0.5">
            <UsageCount used={bill.used} limit={bill.limit} noun="bill" />
          </p>
        </div>
        {/*
          Named for what is behind it rather than "Settings". A guest paying you
          sees what is on that screen, so the label that predicts it is the one
          that says so.
        */}
        <Link
          href="/profile"
          data-press="plain"
          className="tap type-subhead -mr-2 inline-flex shrink-0 items-center px-2"
          style={{ color: 'var(--accent)' }}
        >
          Payment details
        </Link>
      </header>

      <div className="mt-6">
        {bills.length === 0 ? (
          <EmptyState
            title="No bills yet"
            hint="Start one when the receipt lands on the table."
          />
        ) : (
          /*
            One container with hairlines between the rows, rather than a stack
            of separate cards. The gap between cards is a claim that the things
            are unrelated, and these are the same thing over and over.
          */
          <div className="list">
            {bills.map((bill) => (
              <Link
                key={bill.id}
                href={`/bills/${bill.id}`}
                data-press="row"
                className="tap flex items-center gap-3 px-4 py-3.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="type-headline block truncate">
                    {bill.title || bill.venue || 'Untitled bill'}
                  </span>
                  <span className="type-footnote mt-0.5 block" style={{ color: 'var(--text-muted)' }}>
                    <span style={{ color: STATUS_COLOR[bill.status] }}>
                      {STATUS_LABEL[bill.status]}
                    </span>
                    {' · '}
                    {whenLabel(bill.created_at)}
                  </span>
                </span>
                <Money sen={bill.subtotal_sen} className="type-headline shrink-0" />
                <svg
                  aria-hidden="true"
                  viewBox="0 0 12 20"
                  className="h-3.5 w-2 shrink-0"
                  fill="none"
                  stroke="var(--text-faint)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m2 2 8 8-8 8" />
                </svg>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/*
        Signing out lives at the bottom, away from the row of navigation it used
        to sit inside. Nothing else on this screen logs you out, and a control
        that does should not be a thumb's width from one that opens a page.
      */}
      <form action="/auth/signout" method="post" className="mt-8">
        <SubmitButton className="btn btn-ghost type-subhead w-full" pendingLabel="Signing out…">
          Sign out
        </SubmitButton>
      </form>

      <div className="fixed inset-x-0 bottom-0 z-10">
        {/*
          The list fades out into the floating bar instead of being ruled off by
          a border. A hairline says the content stops there; it does not, and
          seeing it continue underneath is what tells you so.
        */}
        <div className="scroll-edge" aria-hidden="true" />
        <div className="material px-5 pt-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
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
      </div>
    </main>
  );
}
