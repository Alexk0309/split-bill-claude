'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  applyConfirmed,
  enqueueIntent,
  isClaimQueue,
  projectClaims,
  queueStorageKey,
  removeIntent,
  toggleIntent,
  type ClaimIntent,
} from '@/lib/bill/claim-queue';
import { loadGuestBill } from '@/lib/bill/load';
import { readJson, writeJson } from '@/lib/bill/storage';
import { createGuestClient } from '@/lib/supabase/guest';
import type { BillBundle, GuestIdentity } from '@/lib/supabase/types';

export type SyncStatus = 'live' | 'connecting' | 'offline';

/** Coalesces the burst of events you get when a table of seven is all tapping. */
const REFETCH_DEBOUNCE_MS = 180;

/**
 * Distinguishes "the network is down, keep the tap and retry" from "the server
 * refused this, stop asking".
 *
 * A refusal carries a PostgREST or Postgres code. A dropped connection does
 * not, so an error with no code -- or an outright offline browser -- is treated
 * as retriable.
 */
function isRetriable(error: { code?: string; message?: string } | null): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (!error) return false;
  if (error.code) return false;
  return true;
}

export interface ClaimSync {
  /** The bundle as it should be drawn: server truth with pending taps laid over. */
  bundle: BillBundle;
  status: SyncStatus;
  /** Items with a tap the server has not confirmed yet. */
  pendingItems: ReadonlySet<string>;
  toggle: (itemId: string) => void;
  error: string | null;
  /** Adds a participant the guest just created, before the next refetch. */
  addParticipant: (participant: BillBundle['participants'][number]) => void;
  /** Pulls fresh server state now, for changes this page made outside the queue. */
  refresh: () => void;
}

export function useClaimSync({
  initialBundle,
  shareToken,
  identity,
}: {
  initialBundle: BillBundle;
  shareToken: string;
  identity: GuestIdentity | null;
}): ClaimSync {
  const billId = initialBundle.bill.id;
  const participantId = identity?.participantId ?? null;

  const [serverBundle, setServerBundle] = useState(initialBundle);
  const [queue, setQueue] = useState<ClaimIntent[]>([]);
  const [status, setStatus] = useState<SyncStatus>('connecting');
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(
    () => createGuestClient(shareToken, identity?.claimToken),
    [shareToken, identity?.claimToken],
  );

  const queueRef = useRef<ClaimIntent[]>(queue);
  queueRef.current = queue;
  const serverClaimsRef = useRef(serverBundle.claims);
  serverClaimsRef.current = serverBundle.claims;
  const flushingRef = useRef(false);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* --- persisted queue ---------------------------------------------------- */
  // Restored per participant, so pending taps survive a reload on a flaky
  // connection rather than quietly disappearing.
  const storageKey = participantId ? queueStorageKey(billId, participantId) : null;

  useEffect(() => {
    if (!storageKey) return;
    const restored = readJson(storageKey, isClaimQueue);
    if (restored && restored.length > 0) setQueue(restored);
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    writeJson(storageKey, queue);
  }, [storageKey, queue]);

  /* --- reading -------------------------------------------------------------- */

  const refetch = useCallback(async () => {
    const fresh = await loadGuestBill(shareToken);
    if (!fresh) return;
    // The queue is left alone: a refetch is only ever new information about
    // everybody else, never a verdict on taps we have not sent yet.
    setServerBundle(fresh);
  }, [shareToken]);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => void refetch(), REFETCH_DEBOUNCE_MS);
  }, [refetch]);

  /* --- writing -------------------------------------------------------------- */

  const flush = useCallback(async () => {
    if (flushingRef.current || !participantId) return;
    const pending = [...queueRef.current].sort((a, b) => a.seq - b.seq);
    if (pending.length === 0) return;

    flushingRef.current = true;
    try {
      for (const intent of pending) {
        const result = intent.claimed
          ? await supabase.from('claims').upsert(
              { item_id: intent.itemId, participant_id: participantId, bill_id: billId },
              // Idempotent, so a retry after a timeout cannot collide with the
              // write that actually landed.
              { onConflict: 'item_id,participant_id', ignoreDuplicates: true },
            )
          : await supabase
              .from('claims')
              .delete()
              .eq('item_id', intent.itemId)
              .eq('participant_id', participantId);

        if (result.error) {
          if (isRetriable(result.error)) {
            setStatus('offline');
            return; // Keep the queue; the next reconnect retries it.
          }
          // A refusal will never succeed on retry, so drop it and say so rather
          // than leaving a tap stuck on screen forever. Dropping the intent is
          // also what reverts the optimistic tap, which is right: the claim did
          // not happen.
          setQueue((current) => removeIntent(current, intent));
          setError(
            // Losing a race for the last portion is ordinary, not a fault, and
            // saying "reopen the link" for it would send somebody off to fix
            // nothing.
            String(result.error.message ?? '').includes('ITEM_PORTIONS_FULL')
              ? 'Somebody took the last portion of that just before you. Nothing has changed.'
              : 'That change was not allowed. Reopen the link and try again.',
          );
          continue;
        }

        setServerBundle((current) => ({
          ...current,
          claims: applyConfirmed(current.claims, intent, participantId, billId),
        }));
        setQueue((current) => removeIntent(current, intent));
        setError(null);
      }
      if (typeof navigator === 'undefined' || navigator.onLine) setStatus('live');
    } finally {
      flushingRef.current = false;
    }
  }, [billId, participantId, supabase]);

  // Drains whenever there is something to send. Every path that could make a
  // send possible again -- a tap, coming back online, resubscribing -- just
  // changes state and lets this run.
  useEffect(() => {
    if (queue.length > 0) void flush();
  }, [queue, flush]);

  const toggle = useCallback(
    (itemId: string) => {
      if (!participantId) return;
      // The timestamp is taken outside the updater to keep the updater pure;
      // the decision itself is made inside it, against the queue React holds
      // right now, so a burst of taps alternates instead of repeating.
      const at = new Date().toISOString();
      setQueue((current) =>
        enqueueIntent(
          current,
          toggleIntent(serverClaimsRef.current, current, itemId, participantId, billId, at),
        ),
      );
    },
    [billId, participantId],
  );

  /* --- realtime ------------------------------------------------------------- */

  useEffect(() => {
    // The topic is derived from the share token, which is already the only
    // credential a guest holds. The payload is ignored on purpose: an event is
    // treated as "something moved", and the refetch below goes back through row
    // level security for the actual data.
    const channel = supabase
      .channel(`bill:${shareToken}`, { config: { private: false } })
      .on('broadcast', { event: 'bill_change' }, () => scheduleRefetch())
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') {
          setStatus(typeof navigator === 'undefined' || navigator.onLine ? 'live' : 'offline');
          // Catch up on anything missed while the socket was down.
          void refetch();
          void flush();
        } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
          setStatus('offline');
        } else if (state === 'CLOSED') {
          setStatus('connecting');
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
    // `flush` changes identity with the queue; subscribing again on every tap
    // would be wasteful, so it is read at call time instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, shareToken, scheduleRefetch, refetch]);

  useEffect(() => {
    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    };
  }, []);

  /* --- connectivity --------------------------------------------------------- */

  useEffect(() => {
    function onOnline() {
      setStatus('connecting');
      void refetch();
      void flush();
    }
    function onOffline() {
      setStatus('offline');
    }
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if (!navigator.onLine) setStatus('offline');
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [flush, refetch]);

  /* --- what the screen draws ------------------------------------------------ */

  const bundle = useMemo<BillBundle>(() => {
    if (!participantId) return serverBundle;
    return {
      ...serverBundle,
      claims: projectClaims(serverBundle.claims, queue, participantId, billId),
    };
  }, [serverBundle, queue, participantId, billId]);

  const pendingItems = useMemo(() => new Set(queue.map((i) => i.itemId)), [queue]);

  const addParticipant = useCallback((participant: BillBundle['participants'][number]) => {
    setServerBundle((current) =>
      current.participants.some((p) => p.id === participant.id)
        ? current
        : { ...current, participants: [...current.participants, participant] },
    );
  }, []);

  return {
    bundle,
    status,
    pendingItems,
    toggle,
    error,
    addParticipant,
    refresh: () => void refetch(),
  };
}
