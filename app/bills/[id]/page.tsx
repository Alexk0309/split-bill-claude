import { notFound, redirect } from 'next/navigation';

import { ConfirmButton, SubmitButton } from '@/components/pending';
import { Avatar, BackLink, Banner, Money } from '@/components/ui';
import { loadOwnerBill } from '@/lib/bill/load';
import { toBillInput } from '@/lib/bill/to-engine-input';
import { computeSplit, type SplitResult } from '@/lib/split';
import { siteUrl } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';
import type { ParticipantReminderRow, ParticipantRow, PaymentProofRow } from '@/lib/supabase/types';

import { deleteBill, openBill } from '../actions';
import { BillSettingsForm, ItemsEditor, PeopleEditor } from './editor-forms';
import { LiveRefresh } from './live-refresh';
import { ScanPanel } from './scan-panel';
import { RemindersPanel } from './reminders-panel';
import { SettlementPanel } from './settlement-panel';
import { SharePanel } from './share-panel';

/**
 * Never prerendered. Every one of these pages is a function of who is signed in,
 * so a build-time render is both meaningless and, without env vars present at
 * build time, fatal -- which is how this surfaced: the first Vercel build died
 * trying to prerender the landing page.
 */
export const dynamic = 'force-dynamic';


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

  const [{ data: proofRows }, { data: profile }, { data: reminderRows }, { data: meRow }] =
    await Promise.all([
    supabase
      .from('payment_proofs')
      .select('*')
      .eq('bill_id', bill.id)
      .order('created_at', { ascending: false }),
    supabase.from('profiles').select('duitnow_mobile').eq('id', user.id).maybeSingle(),
    supabase
      .from('participants')
      .select('id, reminders_muted, reminder_snoozed_until, reminders_sent, last_reminded_at')
      .eq('bill_id', bill.id),
    // Asked separately rather than through the shared loader on purpose: that
    // loader reads the same named columns for the payer and for guests so there
    // is only one scoping path to get wrong, and `user_id` is not a column
    // guests may read.
    supabase
      .from('participants')
      .select('id')
      .eq('bill_id', bill.id)
      .eq('user_id', user.id)
      .maybeSingle(),
  ]);
  const proofs = (proofRows ?? []) as PaymentProofRow[];
  const reminderState = new Map(
    ((reminderRows ?? []) as ParticipantReminderRow[]).map((row) => [row.id, row]),
  );

  const shareUrl = `${siteUrl()}/b/${bill.share_token}`;
  const heading = bill.title || bill.venue || 'Untitled bill';

  return (
    <main className="mx-auto max-w-md px-5 pt-4 pb-16">
      <LiveRefresh shareToken={bill.share_token} />

      <BackLink href="/bills">All bills</BackLink>

      <h1 className="type-title mt-2 text-balance">{heading}</h1>

      <div className="mt-6 space-y-7">
        <ScanPanel billId={bill.id} userId={user.id} scansUsed={bill.receipt_scans_used} />

        <BillSettingsForm bill={bill} />

        <ItemsEditor
          billId={bill.id}
          items={items}
          claimantsByItem={claimantsByItem}
          myParticipantId={meRow ? String(meRow.id) : null}
        />

        <PeopleEditor billId={bill.id} participants={participants} />

        <section>
          <h2 className="group-label">Totals</h2>

          {splitError ? (
            <Banner tone="warn">{splitError}</Banner>
          ) : split ? (
            <div className="list">
              <dl className="type-callout space-y-2 px-4 py-3.5">
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
                {/* The one figure somebody is looking for, weighted so it is
                    found without being read for. */}
                <div className="type-headline flex justify-between pt-1.5">
                  <dt>Total</dt>
                  <dd>
                    <Money sen={split.billTotalSen} />
                  </dd>
                </div>
              </dl>

              {split.people.length > 0 ? (
                <ul className="type-callout px-4 py-3">
                  {split.people.map((person) => (
                    <li key={person.personId} className="flex items-center gap-2.5 py-1.5">
                      <Avatar name={person.name} seed={person.personId} size={24} />
                      <span className="min-w-0 flex-1 truncate">{person.name}</span>
                      <Money sen={person.amountDueSen} className="type-emph" />
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

        <SettlementPanel
          billId={bill.id}
          split={split}
          participants={participants}
          proofs={proofs}
          hasDuitnowMobile={Boolean(profile?.duitnow_mobile)}
          proofScansUsed={bill.proof_scans_used}
        />

        <RemindersPanel
          bill={bill}
          split={split}
          participants={participants}
          reminderState={reminderState}
        />

        {bill.status === 'draft' ? (
          <form action={openBill}>
            <input type="hidden" name="billId" value={bill.id} />
            <SubmitButton className="btn btn-secondary w-full" pendingLabel="Opening…">
              Mark as open for claiming
            </SubmitButton>
          </form>
        ) : null}

        {/*
          Two taps, because this one cannot be undone and does not hand the
          allowance back -- and it sits at the bottom of a column of ordinary
          buttons, which is exactly where a thumb ends up.
        */}
        <form action={deleteBill} className="pt-2">
          <input type="hidden" name="billId" value={bill.id} />
          <ConfirmButton confirmLabel="Yes, delete it" pendingLabel="Deleting…">
            Delete this bill
          </ConfirmButton>
        </form>
      </div>
    </main>
  );
}
