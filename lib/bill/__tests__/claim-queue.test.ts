import { describe, expect, it } from 'vitest';

import {
  applyConfirmed,
  enqueueIntent,
  hasClaim,
  isClaimQueue,
  nextSeq,
  projectClaims,
  removeIntent,
  toggleIntent,
  type ClaimIntent,
} from '../claim-queue';
import type { ClaimRow } from '@/lib/supabase/types';

const AT = '2026-01-01T00:00:00Z';

const claim = (item_id: string, participant_id: string): ClaimRow => ({
  item_id,
  participant_id,
  bill_id: 'bill-1',
  created_at: AT,
});

const intent = (itemId: string, claimed: boolean, seq: number): ClaimIntent => ({
  itemId,
  claimed,
  at: AT,
  seq,
});

const key = (c: ClaimRow) => `${c.item_id}:${c.participant_id}`;
const keys = (claims: ClaimRow[]) => claims.map(key).sort();

describe('queue bookkeeping', () => {
  it('keeps one intent per item, the latest winning', () => {
    let queue = enqueueIntent([], intent('i1', true, 1));
    queue = enqueueIntent(queue, intent('i1', false, 2));
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ itemId: 'i1', claimed: false, seq: 2 });
  });

  it('keeps intents for different items side by side', () => {
    let queue = enqueueIntent([], intent('i1', true, 1));
    queue = enqueueIntent(queue, intent('i2', true, 2));
    expect(queue.map((i) => i.itemId)).toEqual(['i1', 'i2']);
  });

  it('hands out increasing sequence numbers, including after a reload', () => {
    expect(nextSeq([])).toBe(1);
    expect(nextSeq([intent('i1', true, 7), intent('i2', true, 3)])).toBe(8);
  });

  it('removes a confirmed intent', () => {
    const queue = [intent('i1', true, 1), intent('i2', true, 2)];
    expect(removeIntent(queue, intent('i1', true, 1)).map((i) => i.itemId)).toEqual(['i2']);
  });

  it('does not drop a tap made while the previous write was in flight', () => {
    // Tap on, write starts. Tap off before it returns. The write's success must
    // not delete the newer intent, or the item would silently re-appear.
    const queue = enqueueIntent(enqueueIntent([], intent('i1', true, 1)), intent('i1', false, 2));
    const after = removeIntent(queue, intent('i1', true, 1));
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ claimed: false, seq: 2 });
  });
});

describe('projection', () => {
  it('is the server state when nothing is pending', () => {
    const server = [claim('i1', 'me'), claim('i2', 'ben')];
    expect(projectClaims(server, [], 'me', 'bill-1')).toEqual(server);
  });

  it('shows a pending claim before the server knows about it', () => {
    const projected = projectClaims([], [intent('i1', true, 1)], 'me', 'bill-1');
    expect(keys(projected)).toEqual(['i1:me']);
  });

  it('hides a pending unclaim before the server knows about it', () => {
    const projected = projectClaims([claim('i1', 'me')], [intent('i1', false, 1)], 'me', 'bill-1');
    expect(projected).toEqual([]);
  });

  it('never touches anybody else claims', () => {
    // Ben claimed the same item while we were offline. Our pending intent for
    // that item must not remove his row.
    const server = [claim('i1', 'ben'), claim('i1', 'me')];
    const projected = projectClaims(server, [intent('i1', false, 1)], 'me', 'bill-1');
    expect(keys(projected)).toEqual(['i1:ben']);
  });

  it('lets two people hold the same item at once', () => {
    const server = [claim('i1', 'ben')];
    const projected = projectClaims(server, [intent('i1', true, 1)], 'me', 'bill-1');
    expect(keys(projected)).toEqual(['i1:ben', 'i1:me']);
  });

  it('converges on the server once the queue drains', () => {
    const server = [claim('i1', 'me'), claim('i1', 'ben')];
    expect(projectClaims(server, [], 'me', 'bill-1')).toEqual(server);
  });

  it('projects a whole offline session of taps', () => {
    let queue = enqueueIntent([], intent('i1', true, 1));
    queue = enqueueIntent(queue, intent('i2', true, 2));
    queue = enqueueIntent(queue, intent('i1', false, 3));
    queue = enqueueIntent(queue, intent('i3', true, 4));

    const projected = projectClaims([claim('i9', 'chong')], queue, 'me', 'bill-1');
    expect(keys(projected)).toEqual(['i2:me', 'i3:me', 'i9:chong']);
  });
});

describe('confirmation', () => {
  it('folds a confirmed claim into the mirror without duplicating it', () => {
    const after = applyConfirmed([claim('i1', 'ben')], intent('i1', true, 1), 'me', 'bill-1');
    expect(keys(after)).toEqual(['i1:ben', 'i1:me']);

    const again = applyConfirmed(after, intent('i1', true, 2), 'me', 'bill-1');
    expect(keys(again)).toEqual(['i1:ben', 'i1:me']);
  });

  it('folds a confirmed unclaim into the mirror', () => {
    const after = applyConfirmed(
      [claim('i1', 'me'), claim('i1', 'ben')],
      intent('i1', false, 1),
      'me',
      'bill-1',
    );
    expect(keys(after)).toEqual(['i1:ben']);
  });

  it('leaves the projection unchanged across confirm-then-dequeue', () => {
    // The moment a write returns, the row moves from the queue into the mirror.
    // If those two steps disagreed the item would flicker under the guest's thumb.
    const server: ClaimRow[] = [];
    const pending = intent('i1', true, 1);
    const queue = enqueueIntent([], pending);

    const before = keys(projectClaims(server, queue, 'me', 'bill-1'));
    const after = keys(
      projectClaims(
        applyConfirmed(server, pending, 'me', 'bill-1'),
        removeIntent(queue, pending),
        'me',
        'bill-1',
      ),
    );
    expect(after).toEqual(before);
  });
});

describe('hasClaim', () => {
  it('answers for the person asking, not for the item', () => {
    const claims = [claim('i1', 'ben')];
    expect(hasClaim(claims, 'i1', 'ben')).toBe(true);
    expect(hasClaim(claims, 'i1', 'me')).toBe(false);
  });
});

describe('persisted queue validation', () => {
  it('accepts a well-formed queue', () => {
    expect(isClaimQueue([])).toBe(true);
    expect(isClaimQueue([intent('i1', true, 1)])).toBe(true);
  });

  it('rejects anything else, so a corrupt value cannot replay as claims', () => {
    expect(isClaimQueue(null)).toBe(false);
    expect(isClaimQueue({})).toBe(false);
    expect(isClaimQueue([{ itemId: 'i1' }])).toBe(false);
    expect(isClaimQueue([{ itemId: 'i1', claimed: 'yes', at: AT, seq: 1 }])).toBe(false);
  });
});

describe('toggleIntent', () => {
  /** Taps land faster than React re-renders, so each one must read the live queue. */
  function tapRepeatedly(
    server: ClaimRow[],
    itemId: string,
    times: number,
  ): { queue: ClaimIntent[]; claimed: boolean } {
    let queue: ClaimIntent[] = [];
    for (let i = 0; i < times; i += 1) {
      queue = enqueueIntent(queue, toggleIntent(server, queue, itemId, 'me', 'bill-1', AT));
    }
    return {
      queue,
      claimed: hasClaim(projectClaims(server, queue, 'me', 'bill-1'), itemId, 'me'),
    };
  }

  it('claims an item that is not yet claimed', () => {
    expect(toggleIntent([], [], 'i1', 'me', 'bill-1', AT)).toMatchObject({ claimed: true, seq: 1 });
  });

  it('unclaims an item the server already has', () => {
    expect(toggleIntent([claim('i1', 'me')], [], 'i1', 'me', 'bill-1', AT)).toMatchObject({
      claimed: false,
    });
  });

  it('alternates across a burst of taps rather than repeating', () => {
    // The bug this pins: deciding from a stale queue made every tap in a burst
    // say "claim it", so a quick double tap left the item on.
    expect(tapRepeatedly([], 'i1', 1).claimed).toBe(true);
    expect(tapRepeatedly([], 'i1', 2).claimed).toBe(false);
    expect(tapRepeatedly([], 'i1', 3).claimed).toBe(true);
    expect(tapRepeatedly([], 'i1', 4).claimed).toBe(false);
  });

  it('alternates from an already-claimed starting point too', () => {
    const server = [claim('i1', 'me')];
    expect(tapRepeatedly(server, 'i1', 1).claimed).toBe(false);
    expect(tapRepeatedly(server, 'i1', 2).claimed).toBe(true);
    expect(tapRepeatedly(server, 'i1', 3).claimed).toBe(false);
  });

  it('collapses a burst to a single intent, so only one write is sent', () => {
    const { queue } = tapRepeatedly([], 'i1', 5);
    expect(queue).toHaveLength(1);
  });

  it('advances the sequence number with each tap', () => {
    const { queue } = tapRepeatedly([], 'i1', 3);
    expect(queue[0]!.seq).toBe(3);
  });

  it('is unaffected by what other people have claimed', () => {
    const server = [claim('i1', 'ben'), claim('i1', 'chong')];
    expect(toggleIntent(server, [], 'i1', 'me', 'bill-1', AT).claimed).toBe(true);
  });
});
