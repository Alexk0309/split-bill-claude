'use client';

import { useEffect, useMemo, useState } from 'react';

import { Avatar, AvatarRow, Banner, Money } from '@/components/ui';
import { readIdentity, writeIdentity } from '@/lib/bill/guest-identity';
import { toBillInput } from '@/lib/bill/to-engine-input';
import { formatRM } from '@/lib/money';
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
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => createGuestClient(shareToken), [shareToken]);

  async function take(participant: ParticipantRow) {
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('claim_participant', {
      p_share_token: shareToken,
      p_participant_id: participant.id,
    });
    setBusy(false);

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
        created_at: new Date().toISOString(),
      },
    );
  }

  return (
    <main className="mx-auto max-w-md px-5 pt-8 pb-10">
      <h1 className="text-2xl font-bold tracking-tight text-balance">
        {bundle.bill.venue ? `Bill from ${bundle.bill.venue}` : 'Split this bill'}
      </h1>
      <p className="mt-2 text-[15px]" style={{ color: 'var(--text-muted)' }}>
        Who are you? This stays on your phone — no sign-up, no app.
      </p>

      {bundle.participants.length > 0 ? (
        <div className="mt-6">
          <h2 className="label">Tap your name</h2>
          <div className="flex flex-wrap gap-2">
            {bundle.participants.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={busy}
                onClick={() => void take(p)}
                className="card tap flex items-center gap-2 py-2 pr-3.5 pl-2.5"
              >
                <Avatar name={p.display_name} seed={p.id} size={24} />
                <span className="text-[15px] font-medium">{p.display_name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <form onSubmit={join} className="mt-6">
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
          <button type="submit" className="btn btn-primary shrink-0" disabled={busy || !name.trim()}>
            Continue
          </button>
        </div>
      </form>

      {error ? (
        <p className="mt-3 text-[14px]" style={{ color: 'var(--accent-strong)' }} role="alert">
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
      className="mt-3 flex items-center gap-2 text-[13px]"
      style={{ color: 'var(--text-muted)' }}
      role="status"
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: status === 'offline' ? 'var(--accent)' : 'var(--text-muted)' }}
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
    <div className="fixed inset-0 z-20 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close breakdown"
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: 'rgb(0 0 0 / 0.4)' }}
      />
      <div
        className="relative max-h-[80dvh] overflow-y-auto rounded-t-2xl px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
        style={{ background: 'var(--surface)' }}
        role="dialog"
        aria-label="Your breakdown"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold">Your share</h2>
          <Money sen={person.amountDueSen} className="text-lg font-bold" />
        </div>

        {person.itemLines.length > 0 ? (
          <ul className="mt-4 space-y-1.5 text-[15px]">
            {person.itemLines.map((line) => (
              <li key={line.itemId} className="flex justify-between gap-3">
                <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text-muted)' }}>
                  {line.name}
                  {line.claimantCount > 1 ? (
                    <span className="text-[13px]"> ÷ {line.claimantCount}</span>
                  ) : null}
                </span>
                <Money sen={line.displayShareSen} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-[15px]" style={{ color: 'var(--text-muted)' }}>
            You have not claimed anything yet.
          </p>
        )}

        <dl
          className="mt-4 space-y-1.5 border-t pt-4 text-[15px]"
          style={{ borderColor: 'var(--border)' }}
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
            className="flex justify-between border-t pt-2 font-semibold"
            style={{ borderColor: 'var(--border)' }}
          >
            <dt>You owe</dt>
            <dd>
              <Money sen={person.amountDueSen} />
            </dd>
          </div>
        </dl>

        {person.belanjaCoveredBySponsorId ? (
          <p className="mt-3 text-[14px]" style={{ color: 'var(--good)' }}>
            Someone is belanja-ing you — you owe nothing.
          </p>
        ) : null}

        {person.roundingDeltaSen > 0 ? (
          <p className="mt-3 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            Includes {person.roundingDeltaSen} sen from rounding. The bill splits to{' '}
            {person.exactShareSen} sen exactly, and the leftover sen go to the largest fractions so
            the shares add up to {formatRM(split.settlementTotalSen)}.
          </p>
        ) : null}

        <button type="button" onClick={onClose} className="btn btn-secondary mt-5 w-full">
          Close
        </button>
      </div>
    </div>
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

  if (!ready) {
    return <main className="mx-auto max-w-md px-5 py-10" aria-busy="true" />;
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

  return (
    <>
      <main className="mx-auto max-w-md px-5 pt-5 pb-32">
        <header>
          <h1 className="text-xl font-bold tracking-tight text-balance">
            {bundle.bill.title || bundle.bill.venue || 'Split this bill'}
          </h1>
          <p className="mt-1 text-[14px]" style={{ color: 'var(--text-muted)' }}>
            {bundle.bill.venue && bundle.bill.title ? `${bundle.bill.venue} · ` : ''}
            You are <strong style={{ color: 'var(--text)' }}>{myName}</strong>
          </p>
          <ConnectionNote status={status} queued={pendingItems.size} />
        </header>

        {unclaimedCount > 0 ? (
          <div className="mt-4">
            <Banner tone="warn">
              {unclaimedCount} {unclaimedCount === 1 ? 'item is' : 'items are'} still unclaimed.
            </Banner>
          </div>
        ) : (
          <div className="mt-4">
            <Banner tone="good">Everything is claimed.</Banner>
          </div>
        )}

        {error ? (
          <p className="mt-3 text-[14px]" style={{ color: 'var(--accent-strong)' }} role="alert">
            {error}
          </p>
        ) : null}

        <ul className="mt-4 space-y-2">
          {bundle.items.map((item) => {
            const claimants = claimantsByItem.get(item.id) ?? [];
            const mine = claimants.some((p) => p.id === identity.participantId);
            const unclaimed = claimants.length === 0;
            const perHead =
              claimants.length > 1 ? Math.round(item.price_sen / claimants.length) : null;
            // Only dim while a write is genuinely in flight. Offline, the taps
            // are queued and the note in the header explains it; dimming the
            // whole list would read as broken.
            const inFlight = status === 'live' && pendingItems.has(item.id);

            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => toggle(item.id)}
                  aria-pressed={mine}
                  className="tap flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left"
                  style={{
                    background: mine ? 'var(--accent-wash)' : 'var(--surface)',
                    borderColor: mine || unclaimed ? 'var(--accent)' : 'var(--border)',
                    // Dashed reads as "still open" at a glance, and stays
                    // distinct from the solid, filled state of your own claims
                    // without relying on colour alone.
                    borderStyle: unclaimed ? 'dashed' : 'solid',
                    opacity: inFlight ? 0.6 : 1,
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[13px] font-bold"
                    style={{
                      borderColor: mine ? 'var(--accent)' : 'var(--border)',
                      background: mine ? 'var(--accent)' : 'transparent',
                      color: '#fff',
                    }}
                  >
                    {mine ? '✓' : ''}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{item.name}</span>
                    <span
                      className="mt-0.5 block text-[13px]"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {perHead !== null ? (
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
                    {perHead !== null ? (
                      <span className="mt-1 block">
                        <AvatarRow
                          people={claimants.map((p) => ({ id: p.id, name: p.display_name }))}
                        />
                      </span>
                    ) : null}
                  </span>

                  <Money sen={item.price_sen} className="shrink-0 font-semibold" />
                </button>
              </li>
            );
          })}
        </ul>

        {bundle.items.length === 0 ? (
          <p className="mt-6 text-center text-[15px]" style={{ color: 'var(--text-muted)' }}>
            Nothing has been added to this bill yet.
          </p>
        ) : null}
      </main>

      {/* Pinned running total. Always visible, tap for the full breakdown. */}
      <div
        className="fixed inset-x-0 bottom-0 z-10 border-t"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="mx-auto flex w-full max-w-md items-center gap-3 px-5 pt-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => setShowBreakdown(true)}
            disabled={!me}
            className="tap min-w-0 flex-1 text-left"
          >
            <span className="block text-[13px]" style={{ color: 'var(--text-muted)' }}>
              Your share {me ? '· tap for details' : ''}
            </span>
            <span className="block text-2xl font-bold">
              <Money sen={me?.amountDueSen ?? 0} />
            </span>
          </button>

          {isSettled ? (
            <span
              className="shrink-0 rounded-xl px-3 py-2 text-[14px] font-semibold"
              style={{ background: 'var(--good-wash)', color: 'var(--good)' }}
            >
              Paid
            </span>
          ) : (
            <button
              type="button"
              className="btn btn-primary shrink-0"
              disabled={!me}
              onClick={() => setShowSettle(true)}
            >
              Settle up
            </button>
          )}
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
          proofScansUsed={bundle.bill.proof_scans_used}
          onClose={() => setShowSettle(false)}
          onSettled={refresh}
        />
      ) : null}
    </>
  );
}
