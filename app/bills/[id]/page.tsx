import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Avatar, Banner, Money } from '@/components/ui';
import { loadOwnerBill } from '@/lib/bill/load';
import { toBillInput } from '@/lib/bill/to-engine-input';
import { computeSplit, type SplitResult } from '@/lib/split';
import { siteUrl } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';
import type { ParticipantRow } from '@/lib/supabase/types';

import { deleteBill, openBill } from '../actions';
import { BillSettingsForm, ItemsEditor, PeopleEditor } from './editor-forms';
import { SharePanel } from './share-panel';

export default async function BillEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const bundle = await loadOwnerBill(supabase, id);
  if (!bundle) notFound();

  const { bill, items, participants, claims } = bundle;

  const byId = new Map(participants.map((p) => [p.id, p]));
  const claimantsByItem = new Map<string, ParticipantRow[]>();
  for (const claim of claims) {
    const person = byId.get(claim.participant_id);
    if (!person) continue;
    const list = claimantsByItem.get(claim.item_id);
    if (list) list.push(person);
    else claimantsByItem.set(claim.item_id, [person]);
  }

  // The engine validates its own input, so a half-built bill can still throw
  // here (a stale adjustment, say). Showing the editor without totals beats
  // showing an error page over a bill the payer is still typing.
  let split: SplitResult | null = null;
  let splitError: string | null = null;
  try {
    split = computeSplit(toBillInput(bundle));
  } catch (error) {
    splitError = error instanceof Error ? error.message : 'Could not work out the totals';
  }

  const shareUrl = `${siteUrl()}/b/${bill.share_token}`;
  const heading = bill.title || bill.venue || 'Untitled bill';

  return (
    <main className="mx-auto max-w-md px-5 pt-4 pb-16">
      <Link
        href="/bills"
        className="tap inline-flex items-center text-[14px]"
        style={{ color: 'var(--text-muted)' }}
      >
        ← All bills
      </Link>

      <h1 className="mt-2 text-2xl font-bold tracking-tight text-balance">{heading}</h1>

      <div className="mt-5 space-y-6">
        <BillSettingsForm bill={bill} />

        <ItemsEditor billId={bill.id} items={items} claimantsByItem={claimantsByItem} />

        <PeopleEditor billId={bill.id} participants={participants} />

        <section>
          <h2 className="mb-2 text-[15px] font-semibold">Totals</h2>

          {splitError ? (
            <Banner tone="warn">{splitError}</Banner>
          ) : split ? (
            <div className="card divide-y" style={{ borderColor: 'var(--border)' }}>
              <dl className="space-y-1.5 px-4 py-3 text-[15px]">
                <div className="flex justify-between">
                  <dt style={{ color: 'var(--text-muted)' }}>Subtotal</dt>
                  <dd>
                    <Money sen={split.subtotalSen} />
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt style={{ color: 'var(--text-muted)' }}>Service charge</dt>
                  <dd>
                    <Money sen={split.serviceChargeSen} />
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt style={{ color: 'var(--text-muted)' }}>Service tax</dt>
                  <dd>
                    <Money sen={split.serviceTaxSen} />
                  </dd>
                </div>
                <div className="flex justify-between pt-1.5 font-semibold">
                  <dt>Total</dt>
                  <dd>
                    <Money sen={split.billTotalSen} />
                  </dd>
                </div>
              </dl>

              {split.people.length > 0 ? (
                <ul className="px-4 py-3">
                  {split.people.map((person) => (
                    <li key={person.personId} className="flex items-center gap-2 py-1 text-[15px]">
                      <Avatar name={person.name} seed={person.personId} size={24} />
                      <span className="min-w-0 flex-1 truncate">{person.name}</span>
                      <Money sen={person.amountDueSen} className="font-semibold" />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {split && split.unclaimedItems.length > 0 ? (
            <div className="mt-2">
              <Banner tone="warn">
                {split.unclaimedItems.length}{' '}
                {split.unclaimedItems.length === 1 ? 'item is' : 'items are'} still unclaimed, worth{' '}
                <Money sen={split.unallocatedSen} /> with charges. Nobody is being billed for{' '}
                {split.unclaimedItems.length === 1 ? 'it' : 'them'} yet.
              </Banner>
            </div>
          ) : null}
        </section>

        <SharePanel
          shareUrl={shareUrl}
          title={bill.title}
          venue={bill.venue}
          totalSen={split?.billTotalSen ?? 0}
        />

        {bill.status === 'draft' ? (
          <form action={openBill}>
            <input type="hidden" name="billId" value={bill.id} />
            <button type="submit" className="btn btn-secondary w-full">
              Mark as open for claiming
            </button>
          </form>
        ) : null}

        <form action={deleteBill} className="pt-2">
          <input type="hidden" name="billId" value={bill.id} />
          <button type="submit" className="btn btn-ghost w-full text-[14px]">
            Delete this bill
          </button>
        </form>
      </div>
    </main>
  );
}
