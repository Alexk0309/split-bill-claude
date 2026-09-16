import Link from 'next/link';

import { SubmitButton } from '@/components/pending';
import { Avatar, Banner, Money, UsageMeter } from '@/components/ui';
import { PROOF_SCANS_PER_BILL } from '@/lib/limits';
import { needsAttention, settlementDrift, type SettlementDrift } from '@/lib/settlement/drift';
import { mismatchLabel, type MismatchReason } from '@/lib/settlement/proof';
import type { SplitResult } from '@/lib/split';
import type { ParticipantRow, PaymentProofRow } from '@/lib/supabase/types';

import { markSettled, unmarkSettled } from '../../settlement-actions';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-MY', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * What the payer sees about a proof somebody submitted.
 *
 * Every figure here was read from the screenshot on the server, not sent by the
 * guest, which is what makes it worth showing at all. A mismatch is presented
 * as something to look at, never as an accusation.
 */
function ProofNote({ proof }: { proof: PaymentProofRow }) {
  const reason = proof.mismatch_reason as MismatchReason | null;
  return (
    <div
      className="type-footnote mt-2.5 rounded-xl px-3 py-2"
      style={{
        background: proof.matched ? 'var(--good-wash)' : 'var(--accent-wash)',
        color: proof.matched ? 'var(--good)' : 'var(--accent-strong)',
      }}
    >
      <span className="font-semibold">
        {proof.matched ? 'Proof matched' : reason ? mismatchLabel(reason) : 'Needs a look'}
      </span>
      <span className="mt-0.5 block" style={{ color: 'var(--text-muted)' }}>
        {proof.amount_sen === null ? 'Amount unreadable' : <>Sent <Money sen={proof.amount_sen} /></>}
        {' · expected '}
        <Money sen={proof.expected_sen} />
        {proof.bank ? ` · ${proof.bank}` : ''}
        {proof.reference ? ` · ref ${proof.reference}` : ''}
        {proof.paid_at ? ` · ${when(proof.paid_at)}` : ''}
      </span>
    </div>
  );
}

/**
 * A settled person whose share has moved since they paid.
 *
 * Shares are provisional while a bill is open: an item is divided by however
 * many people have claimed it *so far*, so the third and fourth person to tap a
 * shared dish halve what the first two owed. Somebody who paid in between is
 * out of pocket through nobody's mistake.
 *
 * Before this existed the row simply said "Paid" beside a figure that
 * contradicted it, and neither side was told. Stated plainly here, with the
 * amount to hand back, because the payer is the only one holding the money.
 */
function DriftNote({
  drift,
  paidSen,
  dueSen,
}: {
  drift: SettlementDrift;
  paidSen: number;
  dueSen: number;
}) {
  const over = drift.kind === 'overpaid';
  return (
    <div
      className="type-footnote mt-2.5 rounded-xl px-3 py-2"
      style={{ background: 'var(--accent-wash)', color: 'var(--accent-strong)' }}
    >
      <span className="font-semibold">
        {over ? (
          <>Return <Money sen={drift.deltaSen} /></>
        ) : (
          <><Money sen={-drift.deltaSen} /> still short</>
        )}
      </span>
      <span className="mt-0.5 block" style={{ color: 'var(--text-muted)' }}>
        Paid <Money sen={paidSen} />, and their share {over ? 'fell' : 'rose'} to{' '}
        <Money sen={dueSen} /> after the bill changed.
      </span>
    </div>
  );
}

export function SettlementPanel({
  billId,
  split,
  participants,
  proofs,
  hasDuitnowMobile,
  proofScansUsed,
}: {
  billId: string;
  split: SplitResult | null;
  participants: ParticipantRow[];
  proofs: PaymentProofRow[];
  hasDuitnowMobile: boolean;
  proofScansUsed: number;
}) {
  if (!split || participants.length === 0) return null;

  const dueById = new Map(split.people.map((person) => [person.personId, person.amountDueSen]));
  const latestProof = new Map<string, PaymentProofRow>();
  for (const proof of proofs) {
    // Ordered newest first by the query, so the first one seen wins.
    if (!latestProof.has(proof.participant_id)) latestProof.set(proof.participant_id, proof);
  }

  const outstanding = participants.filter((p) => !p.settled_at && (dueById.get(p.id) ?? 0) > 0);
  const outstandingSen = outstanding.reduce((acc, p) => acc + (dueById.get(p.id) ?? 0), 0);

  // People who paid before their share moved. "Everyone has settled up" is not
  // true while somebody is owed money back, so this has to be counted here and
  // not only shown row by row.
  const owedBack = participants
    .filter((p) => p.settled_at)
    .map((p) => settlementDrift(p.settled_amount_sen, dueById.get(p.id) ?? 0))
    .filter((d) => d.kind === 'overpaid');
  const owedBackSen = owedBack.reduce((acc, d) => acc + d.deltaSen, 0);

  return (
    <section>
      <h2 className="group-label">Who has paid</h2>

      {!hasDuitnowMobile ? (
        <div className="mb-2">
          <Banner tone="warn">
            You have not added a DuitNow number, so guests are not told where to send the money.{' '}
            <Link href="/profile" className="underline">
              Add one
            </Link>
            .
          </Banner>
        </div>
      ) : null}

      <div className="list">
        {participants.map((person) => {
          const dueSen = dueById.get(person.id) ?? 0;
          const proof = latestProof.get(person.id);
          const settled = Boolean(person.settled_at);
          // Only meaningful once settled; an unsettled person has not paid
          // anything to be out of step with.
          const drift = settlementDrift(person.settled_amount_sen, dueSen);
          const drifted = settled && needsAttention(drift);

          return (
            <div key={person.id} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <Avatar name={person.display_name} seed={person.id} size={26} dimmed={settled && !drifted} />
                <span className="min-w-0 flex-1">
                  <span className="type-callout block truncate font-medium">
                    {person.display_name}
                  </span>
                  {settled ? (
                    <span
                      className="type-footnote"
                      style={{ color: drifted ? 'var(--accent-strong)' : 'var(--good)' }}
                    >
                      Paid
                      {person.settled_method === 'cash'
                        ? ' in cash'
                        : person.settled_method === 'duitnow'
                          ? ' by DuitNow'
                          : ''}
                    </span>
                  ) : (
                    <span className="type-footnote" style={{ color: 'var(--text-muted)' }}>
                      Owes <Money sen={dueSen} />
                    </span>
                  )}
                </span>
                <Money sen={dueSen} className="type-headline shrink-0" />
              </div>

              {proof ? <ProofNote proof={proof} /> : null}

              {drifted ? (
                <DriftNote
                  drift={drift}
                  paidSen={person.settled_amount_sen ?? 0}
                  dueSen={dueSen}
                />
              ) : null}

              <div className="mt-2.5 flex flex-wrap gap-2">
                {settled ? (
                  <form action={unmarkSettled}>
                    <input type="hidden" name="billId" value={billId} />
                    <input type="hidden" name="participantId" value={person.id} />
                    <SubmitButton
                      className="btn btn-ghost tap type-subhead min-h-0 px-2 py-1.5"
                      pendingLabel="Undoing…"
                    >
                      Undo
                    </SubmitButton>
                  </form>
                ) : (
                  <>
                    <form action={markSettled}>
                      <input type="hidden" name="billId" value={billId} />
                      <input type="hidden" name="participantId" value={person.id} />
                      <input type="hidden" name="method" value="duitnow" />
                      <SubmitButton
                        className="btn btn-secondary tap type-subhead min-h-0 px-3 py-1.5"
                        pendingLabel="Marking…"
                      >
                        Mark paid
                      </SubmitButton>
                    </form>
                    <form action={markSettled}>
                      <input type="hidden" name="billId" value={billId} />
                      <input type="hidden" name="participantId" value={person.id} />
                      <input type="hidden" name="method" value="cash" />
                      <SubmitButton
                        className="btn btn-secondary tap type-subhead min-h-0 px-3 py-1.5"
                        pendingLabel="Marking…"
                      >
                        Paid cash
                      </SubmitButton>
                    </form>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <UsageMeter
        used={proofScansUsed}
        limit={PROOF_SCANS_PER_BILL}
        noun="proof check"
        exhaustedNote={'Mark people paid by hand instead — that always works.'}
      />

      <p className="type-subhead mt-2.5" style={{ color: 'var(--text-muted)' }}>
        {outstanding.length === 0 ? (
          owedBackSen === 0 ? (
            'Everyone has settled up.'
          ) : (
            <>
              Everyone has paid, but <Money sen={owedBackSen} /> needs to go back to{' '}
              {owedBack.length === 1 ? 'somebody' : `${owedBack.length} people`} whose share fell
              after they paid.
            </>
          )
        ) : (
          <>
            {outstanding.length} still to pay, <Money sen={outstandingSen} /> outstanding.
            {owedBackSen > 0 ? (
              <>
                {' '}
                <Money sen={owedBackSen} /> to give back.
              </>
            ) : null}
          </>
        )}
      </p>
    </section>
  );
}
