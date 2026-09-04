/**
 * The offline claim queue.
 *
 * Pure, so the tricky part -- what the screen should show when the network is
 * halfway through agreeing with you -- can be tested without a browser.
 *
 * There are two pieces of state:
 *
 *   `serverClaims`  what we last heard from the database, for everybody
 *   `queue`         our own taps that the database has not confirmed yet
 *
 * What the guest sees is the projection of one over the other. Because a claim
 * row is keyed by (item, person), a queued intent only ever overrides this
 * guest's own row: two people claiming the same item at the same moment both
 * succeed and it becomes shared, with neither able to clobber the other.
 */

import type { ClaimRow } from '@/lib/supabase/types';

export interface ClaimIntent {
  itemId: string;
  /** true = claim it, false = unclaim it. */
  claimed: boolean;
  /** ISO timestamp, supplied by the caller so this module stays pure. */
  at: string;
  /** Monotonic within a session; a later intent supersedes an earlier one. */
  seq: number;
}

export type ClaimQueue = readonly ClaimIntent[];

export function nextSeq(queue: ClaimQueue): number {
  let max = 0;
  for (const intent of queue) if (intent.seq > max) max = intent.seq;
  return max + 1;
}

/** Adds an intent, replacing any earlier unconfirmed intent for the same item. */
export function enqueueIntent(queue: ClaimQueue, intent: ClaimIntent): ClaimIntent[] {
  return [...queue.filter((i) => i.itemId !== intent.itemId), intent];
}

/**
 * Removes an intent once the database has confirmed it.
 *
 * The sequence number is checked so that a tap made *while* the write was in
 * flight is not thrown away by the write's own success.
 */
export function removeIntent(queue: ClaimQueue, intent: ClaimIntent): ClaimIntent[] {
  return queue.filter((i) => !(i.itemId === intent.itemId && i.seq === intent.seq));
}

/** What the screen shows: server truth, with this guest's pending taps laid over it. */
export function projectClaims(
  serverClaims: readonly ClaimRow[],
  queue: ClaimQueue,
  participantId: string,
  billId: string,
): ClaimRow[] {
  if (queue.length === 0) return [...serverClaims];

  const pending = new Map(queue.map((intent) => [intent.itemId, intent]));
  const projected = serverClaims.filter(
    (claim) => !(claim.participant_id === participantId && pending.has(claim.item_id)),
  );

  for (const intent of queue) {
    if (!intent.claimed) continue;
    projected.push({
      item_id: intent.itemId,
      participant_id: participantId,
      bill_id: billId,
      created_at: intent.at,
    });
  }

  return projected;
}

/**
 * Folds a confirmed write into our mirror of server state, so the row does not
 * flicker out between the write succeeding and the next refetch arriving.
 */
export function applyConfirmed(
  serverClaims: readonly ClaimRow[],
  intent: ClaimIntent,
  participantId: string,
  billId: string,
): ClaimRow[] {
  const without = serverClaims.filter(
    (claim) => !(claim.item_id === intent.itemId && claim.participant_id === participantId),
  );
  if (!intent.claimed) return without;
  return [
    ...without,
    {
      item_id: intent.itemId,
      participant_id: participantId,
      bill_id: billId,
      created_at: intent.at,
    },
  ];
}

/**
 * The intent a tap produces, decided against the projection the guest is
 * actually looking at.
 *
 * This must be computed from the live queue, not a snapshot: taps arrive faster
 * than React re-renders, and two quick taps that both read "not claimed yet"
 * would both say "claim it", leaving the item on when the guest meant to turn
 * it off.
 */
export function toggleIntent(
  serverClaims: readonly ClaimRow[],
  queue: ClaimQueue,
  itemId: string,
  participantId: string,
  billId: string,
  at: string,
): ClaimIntent {
  const projected = projectClaims(serverClaims, queue, participantId, billId);
  return {
    itemId,
    claimed: !hasClaim(projected, itemId, participantId),
    at,
    seq: nextSeq(queue),
  };
}

/** True when this guest currently has the item, taking pending taps into account. */
export function hasClaim(
  claims: readonly ClaimRow[],
  itemId: string,
  participantId: string,
): boolean {
  return claims.some((c) => c.item_id === itemId && c.participant_id === participantId);
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                 */
/* -------------------------------------------------------------------------- */

export function isClaimQueue(value: unknown): value is ClaimIntent[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item: unknown) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as ClaimIntent).itemId === 'string' &&
        typeof (item as ClaimIntent).claimed === 'boolean' &&
        typeof (item as ClaimIntent).at === 'string' &&
        typeof (item as ClaimIntent).seq === 'number',
    )
  );
}

export const queueStorageKey = (billId: string, participantId: string): string =>
  `splitbill:v1:queue:${billId}:${participantId}`;
