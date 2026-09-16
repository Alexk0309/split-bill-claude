'use client';

import { useEffect, useMemo, useState } from 'react';

import { Sheet, SheetClose } from '@/components/sheet';
import { Avatar, AvatarRow, Banner, Money, Skeleton } from '@/components/ui';
import { readIdentity, writeIdentity } from '@/lib/bill/guest-identity';
import { toBillInput } from '@/lib/bill/to-engine-input';
import { formatRM } from '@/lib/money';
import { haptic } from '@/lib/motion/feedback';
import { needsAttention, settlementDrift } from '@/lib/settlement/drift';
import { computeSplit, type PersonBreakdown, type SplitResult } from '@/lib/split';
import { createGuestClient } from '@/lib/supabase/guest';
import type { BillBundle, GuestIdentity, ParticipantRow, PayeeInfo } from '@/lib/supabase/types';

import { SettleSheet } from './settle-sheet';
import { useClaimSync, type SyncStatus } from './use-claim-sync';

/* -------------------------------------------------------------------------- */
/* Name picker                                                                 */
/* -------------------------------------------------------------------------- */

function NamePicker({
  bundle,
  shareToken,
  onIdentity,
}: {
  bundle: BillBundle;
  shareToken: string;
  onIdentity: (identity: GuestIdentity, participant: ParticipantRow) => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  // Which chip was tapped, so the spinner lands on that name rather than on all
  // of them. This is the first thing every guest does and it is a round trip;
  // with no feedback at all, tapping again is the obvious move.
  const [taking, setTaking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => createGuestClient(shareToken), [shareToken]);

  async function take(participant: ParticipantRow) {
    setBusy(true);
    setTaking(participant.id);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('claim_participant', {
      p_share_token: shareToken,
      p_participant_id: participant.id,
    });
    setBusy(false);
    setTaking(null);

    const row = Array.isArray(data) ? data[0] : data;
    if (rpcError || !row) {
      setError('Could not pick that name. Try again.');
      return;
    }
    onIdentity({ participantId: row.participant_id, claimToken: row.claim_token }, participant);
  }

  async function join(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('join_bill', {
      p_share_token: shareToken,
      p_display_name: trimmed,
    });
    setBusy(false);

    const row = Array.isArray(data) ? data[0] : data;
    if (rpcError || !row) {
      setError('Could not add your name. Try again.');
      return;
    }
    onIdentity(
      { participantId: row.participant_id, claimToken: row.claim_token },
      {
        id: row.participant_id,
        bill_id: bundle.bill.id,
        display_name: trimmed,
        settled_at: null,
        settled_method: null,
        settled_amount_sen: null,
        created_at: new Date().toISOString(),
      },
    );
  }

  return (
    <main className="mx-auto max-w-md px-5 pt-10 pb-10">
      <h1 className="type-title text-balance">
        {bundle.bill.venue ? `Bill from ${bundle.bill.venue}` : 'Split this bill'}
      </h1>
      <p className="type-body mt-2" style={{ color: 'var(--text-muted)' }}>
        Who are you? This stays on your phone — no sign-up, no app.
      </p>

      {bundle.participants.length > 0 ? (
        <div className="mt-8">
          <h2 className="group-label">Tap your name</h2>
          <div className="flex flex-wrap gap-2">
            {bundle.participants.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={busy}
                aria-busy={taking === p.id}
                onClick={() => void take(p)}
                data-press="button"
                className="card tap flex items-center gap-2 py-2 pr-4 pl-2.5"
                // These are cards, not .btn, so the disabled styling that
                // buttons get elsewhere does not apply to them.
                style={busy ? { opacity: taking === p.id ? 1 : 0.4 } : undefined}
              >
                {taking === p.id ? (
                  <span
                    className="spinner"
                    aria-hidden="true"
                    style={{ width: 24, height: 24, color: 'var(--accent)' }}
                  />
                ) : (
                  <Avatar name={p.display_name} seed={p.id} size={24} />
                )}
                <span className="type-callout font-medium">{p.display_name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <form onSubmit={join} className="mt-8">
        <label className="label" htmlFor="guest-name">
          {bundle.participants.length > 0 ? 'Not listed? Add yourself' : 'Your name'}
        </label>
        <div className="flex gap-2">
          <input
            id="guest-name"
            className="field flex-1"
            placeholder="Your name"
            autoComplete="given-name"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <button
            type="submit"
            data-press="button"
            className="btn btn-primary shrink-0"
            disabled={busy || !name.trim()}
            aria-busy={busy && taking === null}
          >
            {busy && taking === null ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Joining…
              </>
            ) : (
              'Continue'
            )}
          </button>
        </div>
      </form>

      {error ? (
        <p className="type-subhead mt-3" style={{ color: 'var(--accent-strong)' }} role="alert">
          {error}
        </p>
      ) : null}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Connection state                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Deliberately quiet. When everything works there is nothing to say, and when
 * it does not the message is that the taps are safe, not that something broke.
 */
function ConnectionNote({ status, queued }: { status: SyncStatus; queued: number }) {
  if (status === 'live') return null;

  const label =
    status === 'offline'
      ? queued > 0
        ? `Offline — ${queued} ${queued === 1 ? 'tap' : 'taps'} saved, will sync`
        : 'Offline — you can keep tapping'
      : 'Reconnecting…';

  return (
    <p
      className="type-footnote mt-2 flex items-center gap-2"
      style={{ color: 'var(--text-muted)' }}
      role="status"
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: status === 'offline' ? 'var(--accent)' : 'var(--text-faint)' }}
      />
      {label}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Breakdown sheet                                                             */
/* -------------------------------------------------------------------------- */

function BreakdownSheet({
  person,
  split,
  onClose,
}: {
  person: PersonBreakdown;
  split: SplitResult;
  onClose: () => void;
}) {
  const rows: { label: string; sen: number }[] = [
    { label: 'What you had', sen: person.baseShareSen },
    { label: 'Service charge', sen: person.serviceChargeShareSen },
    { label: 'Service tax', sen: person.serviceTaxShareSen },
  ];
  if (person.adjustmentShareSen !== 0) {
    rows.push({ label: 'Discounts', sen: person.adjustmentShareSen });
  }
  if (person.clampRedistributionSen !== 0) {
    rows.push({ label: 'Discount spread from the table', sen: person.clampRedistributionSen });
  }
  if (person.cashRoundingShareSen !== 0) {
    rows.push({ label: 'Cash rounding', sen: person.cashRoundingShareSen });
  }

  return (
    <Sheet
      label="Your breakdown"
      onClose={onClose}
      heading={
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="type-title-2">Your share</h2>
          <Money sen={person.amountDueSen} className="type-title-2" />
        </div>
      }
    >
      {person.itemLines.length > 0 ? (
        <ul className="type-callout mt-3 space-y-2">
          {person.itemLines.map((line) => (
            <li key={line.itemId} className="flex justify-between gap-3">
              <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text-muted)' }}>
                {line.name}
                {line.claimantCount > 1 ? (
                  <span className="type-footnote"> ÷ {line.claimantCount}</span>
                ) : null}
              </span>
              <Money sen={line.displayShareSen} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="type-callout mt-3" style={{ color: 'var(--text-muted)' }}>
          You have not claimed anything yet.
        </p>
      )}

      <dl
        className="type-callout mt-4 space-y-2 border-t pt-4"
        style={{ borderColor: 'var(--separator)' }}
      >
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-3">
            <dt style={{ color: 'var(--text-muted)' }}>{row.label}</dt>
            <dd>
              <Money sen={row.sen} />
            </dd>
          </div>
        ))}
        <div
          className="type-headline flex justify-between border-t pt-2.5"
          style={{ borderColor: 'var(--separator)' }}
        >
          <dt>You owe</dt>
          <dd>
            <Money sen={person.amountDueSen} />
          </dd>
        </div>
      </dl>

      {person.belanjaCoveredBySponsorId ? (
        <p className="type-subhead mt-3" style={{ color: 'var(--good)' }}>
          Someone is belanja-ing you — you owe nothing.
        </p>
      ) : null}

      {person.roundingDeltaSen > 0 ? (
        <p className="type-footnote mt-3" style={{ color: 'var(--text-muted)' }}>
          Includes {person.roundingDeltaSen} sen from rounding. The bill splits to{' '}
          {person.exactShareSen} sen exactly, and the leftover sen go to the largest fractions so
          the shares add up to {formatRM(split.settlementTotalSen)}.
        </p>
      ) : null}

      <SheetClose />
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Claim page                                                                  */
/* -------------------------------------------------------------------------- */

export function ClaimPage({
  initialBundle,
  shareToken,
  payee,
}: {
  initialBundle: BillBundle;
  shareToken: string;
  payee: PayeeInfo | null;
}) {
  const [identity, setIdentity] = useState<GuestIdentity | null>(null);
  const [ready, setReady] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showSettle, setShowSettle] = useState(false);

  const billId = initialBundle.bill.id;

  // localStorage is not available during server rendering, so identity resolves
  // on the client and the page holds still until it does.
  useEffect(() => {
    setIdentity(readIdentity(billId));
    setReady(true);
  }, [billId]);

  const { bundle, status, pendingItems, toggle, error, addParticipant, refresh } = useClaimSync({
    initialBundle,
    shareToken,
    identity,
  });

  const split = useMemo(() => {
    try {
      return computeSplit(toBillInput(bundle));
    } catch {
      return null;
    }
  }, [bundle]);

  const me = split?.people.find((p) => p.personId === identity?.participantId) ?? null;

  const participantsById = useMemo(
    () => new Map(bundle.participants.map((p) => [p.id, p])),
    [bundle.participants],
  );

  const claimantsByItem = useMemo(() => {
    const map = new Map<string, ParticipantRow[]>();
    for (const claim of bundle.claims) {
      const person = participantsById.get(claim.participant_id);
      if (!person) continue;
      const list = map.get(claim.item_id);
      if (list) list.push(person);
      else map.set(claim.item_id, [person]);
    }
    return map;
  }, [bundle.claims, participantsById]);

  // Identity lives in localStorage, which does not exist during server
  // rendering, so there is always a beat before this page knows whether it is
  // showing the name picker or the item list. It used to be blank -- on a slow
  // phone that reads as a link that did not work.
  if (!ready) {
    return (
      <main className="mx-auto max-w-md px-5 pt-6 pb-10" aria-busy="true">
        <span className="sr-only">Loading the bill…</span>
        <Skeleton width="70%" height={28} />
        <Skeleton className="mt-3" width="90%" height={15} />
        <div className="mt-8 space-y-2">
          <Skeleton height={68} className="rounded-2xl" />
          <Skeleton height={68} className="rounded-2xl" />
          <Skeleton height={68} className="rounded-2xl" />
        </div>
      </main>
    );
  }

  if (!identity) {
    return (
      <NamePicker
        bundle={bundle}
        shareToken={shareToken}
        onIdentity={(next, participant) => {
          writeIdentity(billId, next);
          addParticipant(participant);
          setIdentity(next);
        }}
      />
    );
  }

  const myName = participantsById.get(identity.participantId)?.display_name ?? 'You';
  const unclaimedCount = split?.unclaimedItems.length ?? 0;
  const myRow = participantsById.get(identity.participantId) ?? null;
  const isSettled = Boolean(myRow?.settled_at);
  // A share keeps moving while other people are still claiming, so "Paid" can
  // stop being the whole truth after it is earned.
  const settlementIsOff =
    isSettled && needsAttention(settlementDrift(myRow?.settled_amount_sen, me?.amountDueSen ?? 0));

  return (
    <>
      <main className="mx-auto max-w-md px-5 pt-6 pb-36">
        <header>
          <h1 className="type-title-2 text-balance">
            {bundle.bill.title || bundle.bill.venue || 'Split this bill'}
          </h1>
          <p className="type-subhead mt-1" style={{ color: 'var(--text-muted)' }}>
            {bundle.bill.venue && bundle.bill.title ? `${bundle.bill.venue} · ` : ''}
            You are <strong style={{ color: 'var(--text)' }}>{myName}</strong>
          </p>
          <ConnectionNote status={status} queued={pendingItems.size} />
        </header>

        <div className="mt-5">
          {unclaimedCount > 0 ? (
            <Banner tone="warn">
              {unclaimedCount} {unclaimedCount === 1 ? 'item is' : 'items are'} still unclaimed.
            </Banner>
          ) : (
            <Banner tone="good">Everything is claimed.</Banner>
          )}
        </div>

        {error ? (
          <p className="type-subhead mt-3" style={{ color: 'var(--accent-strong)' }} role="alert">
            {error}
          </p>
        ) : null}

        <ul className="mt-4 space-y-2">
          {bundle.items.map((item) => {
            const claimants = claimantsByItem.get(item.id) ?? [];
            const mine = claimants.some((p) => p.id === identity.participantId);
            const unclaimed = claimants.length === 0;

            // A line with a fixed divisor is always divided that many ways, so
            // the figure here is final from the first tap. Without one it is
            // divided by whoever has claimed so far and will keep moving.
            const divisor = item.portions ?? claimants.length;
            const perHead = divisor > 1 ? Math.round(item.price_sen / divisor) : null;
            // Every portion spoken for, and none of them yours.
            const full = item.portions !== null && !mine && claimants.length >= item.portions;
            // Only dim while a write is genuinely in flight. Offline, the taps
            // are queued and the note in the header explains it; dimming the
            // whole list would read as broken.
            const inFlight = status === 'live' && pendingItems.has(item.id);

            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    // On the claim itself, on the frame it lands, and nowhere
                    // else in the app. It is the one action here repeated
                    // dozens of times in a row, which is exactly what a hand
                    // can learn -- and exactly what stops meaning anything if
                    // everything else buzzes too.
                    haptic('select');
                    toggle(item.id);
                  }}
                  aria-pressed={mine}
                  disabled={full}
                  data-press="row"
                  className="tap flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left"
                  style={{
                    background: mine ? 'var(--accent-wash)' : 'var(--surface)',
                    borderColor: mine || unclaimed ? 'var(--accent)' : 'var(--separator)',
                    // Dashed reads as "still open" at a glance, and stays
                    // distinct from the solid, filled state of your own claims
                    // without relying on colour alone.
                    borderStyle: unclaimed ? 'dashed' : 'solid',
                    boxShadow: mine ? 'none' : 'var(--shadow-card)',
                    // A full line is dimmed rather than hidden: it is still part
                    // of the bill and somebody needs to see who took it.
                    opacity: inFlight ? 0.6 : full ? 0.5 : 1,
                    cursor: full ? 'default' : undefined,
                  }}
                >
                  <span
                    // Keyed on the state so the tick is re-mounted, and so
                    // replays its entrance, every time the claim flips. It
                    // answers the tap on the same frame the row changes colour.
                    key={mine ? 'claimed' : 'open'}
                    aria-hidden="true"
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                      mine ? 'tick-in' : ''
                    }`}
                    style={{
                      borderColor: mine ? 'var(--accent)' : 'var(--border)',
                      background: mine ? 'var(--accent)' : 'transparent',
                    }}
                  >
                    {mine ? (
                      <svg
                        viewBox="0 0 16 16"
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="#fff"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m3 8.5 3.5 3.5L13 4.5" />
                      </svg>
                    ) : null}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="type-callout block font-medium">{item.name}</span>
                    <span
                      className="type-footnote mt-0.5 block"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {item.portions !== null ? (
                        <>
                          {claimants.length} of {item.portions} taken ·{' '}
                          <Money sen={perHead ?? item.price_sen} /> each
                          {full ? <span style={{ color: 'var(--accent-strong)' }}> · full</span> : null}
                        </>
                      ) : perHead !== null ? (
                        <>
                          {claimants.length} people · <Money sen={perHead} /> each
                        </>
                      ) : unclaimed ? (
                        <span style={{ color: 'var(--accent-strong)' }}>Nobody yet</span>
                      ) : (
                        <AvatarRow
                          people={claimants.map((p) => ({ id: p.id, name: p.display_name }))}
                        />
                      )}
                    </span>
                    {perHead !== null || item.portions !== null ? (
                      <span className="mt-1.5 block">
                        <AvatarRow
                          people={claimants.map((p) => ({ id: p.id, name: p.display_name }))}
                        />
                      </span>
                    ) : null}
                  </span>

                  <Money sen={item.price_sen} className="type-headline shrink-0" />
                </button>
              </li>
            );
          })}
        </ul>

        {bundle.items.length === 0 ? (
          <p className="type-callout mt-6 text-center" style={{ color: 'var(--text-muted)' }}>
            Nothing has been added to this bill yet.
          </p>
        ) : null}
      </main>

      {/*
        The running total, floating over the list rather than sitting on a shelf
        below it. Seeing the items carry on under the glass is what says there
        is more list; a solid bar with a rule above it says the list ended.
      */}
      <div className="fixed inset-x-0 bottom-0 z-10">
        <div className="scroll-edge" aria-hidden="true" />
        <div className="material">
          <div className="mx-auto flex w-full max-w-md items-center gap-3 px-5 pt-3 pb-[calc(0.875rem+env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={() => setShowBreakdown(true)}
              disabled={!me}
              data-press="plain"
              className="tap min-w-0 flex-1 text-left"
            >
              <span
                className="on-material type-footnote block"
                style={{ color: 'var(--text-muted)' }}
              >
                Your share {me ? '· tap for details' : ''}
              </span>
              <Money sen={me?.amountDueSen ?? 0} className="type-amount mt-0.5 block" />
            </button>

            {isSettled ? (
              // A button rather than a label: once settled there was previously no
              // way back into the sheet at all, so somebody whose share had moved
              // could not read why.
              <button
                type="button"
                onClick={() => setShowSettle(true)}
                data-press="button"
                className="tap type-subhead shrink-0 rounded-xl px-3.5 py-2 font-semibold"
                style={
                  settlementIsOff
                    ? { background: 'var(--accent-wash-strong)', color: 'var(--accent-strong)' }
                    : { background: 'var(--good-wash)', color: 'var(--good)' }
                }
              >
                {settlementIsOff ? 'Check this' : 'Paid'}
              </button>
            ) : (
              <button
                type="button"
                data-press="button"
                className="btn btn-primary shrink-0"
                disabled={!me}
                onClick={() => setShowSettle(true)}
              >
                Settle up
              </button>
            )}
          </div>
        </div>
      </div>

      {showBreakdown && me && split ? (
        <BreakdownSheet person={me} split={split} onClose={() => setShowBreakdown(false)} />
      ) : null}

      {showSettle && me ? (
        <SettleSheet
          shareToken={shareToken}
          claimToken={identity.claimToken}
          amountSen={me.amountDueSen}
          payee={payee}
          settledAt={myRow?.settled_at ?? null}
          settledMethod={myRow?.settled_method ?? null}
          settledAmountSen={myRow?.settled_amount_sen ?? null}
          proofScansUsed={bundle.bill.proof_scans_used}
          onClose={() => setShowSettle(false)}
          onSettled={refresh}
        />
      ) : null}
    </>
  );
}
