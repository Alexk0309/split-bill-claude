import { describe, expect, it } from 'vitest';

import {
  CADENCES,
  cadenceOf,
  reminderMessage,
  reminderStatus,
  statusLabel,
  whatsappLink,
  type ReminderInput,
} from '../schedule';

const DAY = 86_400_000;
const NOW = new Date('2026-09-10T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();

function input(overrides: Partial<ReminderInput> = {}): ReminderInput {
  return {
    amountDueSen: 9989,
    settledAt: null,
    muted: false,
    snoozedUntil: null,
    remindersSent: 0,
    lastRemindedAt: null,
    startedAt: daysAgo(5),
    ...overrides,
  };
}

const gentle = CADENCES.gentle;

describe('when a nudge is due', () => {
  it('says nothing for the first three days', () => {
    expect(reminderStatus(input({ startedAt: daysAgo(0) }), gentle, NOW).kind).toBe('waiting');
    expect(reminderStatus(input({ startedAt: daysAgo(2) }), gentle, NOW).kind).toBe('waiting');
  });

  it('becomes due on the third day', () => {
    const status = reminderStatus(input({ startedAt: daysAgo(3) }), gentle, NOW);
    expect(status).toMatchObject({ kind: 'due', stage: 1 });
  });

  it('waits another three days after each nudge', () => {
    const justNudged = input({ remindersSent: 1, lastRemindedAt: daysAgo(1) });
    expect(reminderStatus(justNudged, gentle, NOW).kind).toBe('waiting');

    const readyAgain = input({ remindersSent: 1, lastRemindedAt: daysAgo(3) });
    expect(reminderStatus(readyAgain, gentle, NOW)).toMatchObject({ kind: 'due', stage: 2 });
  });

  it('stops after three, however long it has been', () => {
    const status = reminderStatus(
      input({ remindersSent: 3, lastRemindedAt: daysAgo(60) }),
      gentle,
      NOW,
    );
    expect(status.kind).toBe('done');
  });

  it('never chases somebody who has paid', () => {
    expect(
      reminderStatus(input({ settledAt: daysAgo(1), startedAt: daysAgo(30) }), gentle, NOW).kind,
    ).toBe('settled');
  });

  it('never chases somebody who owes nothing', () => {
    expect(reminderStatus(input({ amountDueSen: 0 }), gentle, NOW).kind).toBe('nothing-owed');
  });

  it('leaves a muted person alone whatever the clock says', () => {
    const status = reminderStatus(
      input({ muted: true, startedAt: daysAgo(30) }),
      gentle,
      NOW,
    );
    expect(status.kind).toBe('muted');
  });

  it('respects a snooze, then picks up again once it lapses', () => {
    const snoozed = input({ snoozedUntil: new Date(NOW.getTime() + 2 * DAY).toISOString() });
    expect(reminderStatus(snoozed, gentle, NOW).kind).toBe('snoozed');

    const lapsed = input({ snoozedUntil: daysAgo(1) });
    expect(reminderStatus(lapsed, gentle, NOW).kind).toBe('due');
  });

  it('waits when reminders have not been switched on', () => {
    expect(reminderStatus(input({ startedAt: null }), gentle, NOW).kind).toBe('waiting');
  });

  it('does not fire a backlog when switched on late', () => {
    // Turning reminders on for a three-week-old bill starts the clock now, so
    // the first nudge is still three days away rather than three at once.
    const status = reminderStatus(input({ startedAt: NOW.toISOString() }), gentle, NOW);
    expect(status.kind).toBe('waiting');
  });

  it('follows the brisk cadence when chosen, still capped at three', () => {
    const brisk = CADENCES.brisk;
    expect(reminderStatus(input({ startedAt: daysAgo(1) }), brisk, NOW).kind).toBe('due');
    expect(
      reminderStatus(input({ remindersSent: 3, lastRemindedAt: daysAgo(30) }), brisk, NOW).kind,
    ).toBe('done');
  });

  it('falls back to gentle for an unknown cadence', () => {
    expect(cadenceOf(null)).toEqual(CADENCES.gentle);
    expect(cadenceOf('whatever')).toEqual(CADENCES.gentle);
    expect(cadenceOf('brisk')).toEqual(CADENCES.brisk);
  });

  it('never sends more than three over a bill\'s whole life', () => {
    let state = input({ startedAt: daysAgo(0), remindersSent: 0, lastRemindedAt: null });
    let sent = 0;
    for (let day = 0; day <= 60; day += 1) {
      const now = new Date(NOW.getTime() + day * DAY);
      const status = reminderStatus(state, gentle, now);
      if (status.kind === 'due') {
        sent += 1;
        state = { ...state, remindersSent: sent, lastRemindedAt: now.toISOString() };
      }
    }
    expect(sent).toBe(3);
  });
});

describe('the words', () => {
  const base = {
    name: 'Ben Tan',
    amountSen: 9989,
    billTitle: 'Sunday breakfast',
    venue: 'Village Park',
    shareUrl: 'https://example.test/b/tok',
  };

  it('names the person, the amount and the occasion', () => {
    const message = reminderMessage({ ...base, stage: 1 });
    expect(message).toContain('Ben');
    expect(message).toContain('RM99.89');
    expect(message).toContain('Sunday breakfast at Village Park');
    expect(message).toContain(base.shareUrl);
  });

  it('uses the first name only, the way a person would', () => {
    expect(reminderMessage({ ...base, stage: 1 })).not.toContain('Ben Tan');
  });

  it('never blames anyone, at any stage', () => {
    // The reason a neutral third party can ask at all is that it does not
    // sound like a demand.
    const forbidden = /\b(owes?|owing|overdue|unpaid|outstanding|debt|must|immediately|failure|reminder notice)\b/i;
    for (const stage of [1, 2, 3]) {
      const message = reminderMessage({ ...base, stage });
      expect(message, `stage ${stage}`).not.toMatch(forbidden);
      expect(message, `stage ${stage}`).toMatch(/🙂/);
    }
  });

  it('gets gradually more direct without getting colder', () => {
    const [one, two, three] = [1, 2, 3].map((stage) => reminderMessage({ ...base, stage }));
    expect(one).toContain('No rush');
    expect(two).toContain('Sorry to bring it up again');
    expect(three).toContain('Last nudge');
    // Still an out, right to the end.
    expect(three).toContain('another way');
  });

  it('copes with a bill that has no title or no venue', () => {
    expect(reminderMessage({ ...base, billTitle: '', stage: 1 })).toContain(
      'the bill at Village Park',
    );
    expect(reminderMessage({ ...base, venue: null, stage: 1 })).toContain('Sunday breakfast');
    expect(reminderMessage({ ...base, billTitle: '', venue: null, stage: 1 })).toContain('the bill');
  });

  it('mentions nobody except the person it is addressed to', () => {
    // No group shaming: a nudge carries one name and one amount, never a list
    // of who else has not paid.
    const others = ['Aina', 'Chong', 'Dee'];
    const message = reminderMessage({ ...base, stage: 2 });
    for (const other of others) expect(message).not.toContain(other);
    expect(message.match(/RM/g)).toHaveLength(1);
  });

  it('builds a WhatsApp link that carries the message and no recipient', () => {
    // No number: the payer picks the contact, so the app never holds a guest's
    // phone number and cannot send anything on its own.
    const link = whatsappLink(reminderMessage({ ...base, stage: 1 }));
    expect(link.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(link.split('text=')[1]!)).toContain('RM99.89');
  });
});

describe('statusLabel', () => {
  it('says something plain for each state', () => {
    expect(statusLabel({ kind: 'settled' }, NOW)).toBe('Paid');
    expect(statusLabel({ kind: 'muted' }, NOW)).toBe('Muted');
    expect(statusLabel({ kind: 'done' }, NOW)).toMatch(/enough/);
    expect(statusLabel({ kind: 'due', stage: 1 }, NOW)).toBe('Ready to nudge');
    expect(statusLabel({ kind: 'due', stage: 2 }, NOW)).toBe('Ready for nudge 2');
    expect(
      statusLabel({ kind: 'waiting', dueAt: new Date(NOW.getTime() + 2 * DAY) }, NOW),
    ).toBe('Next nudge in 2 days');
    expect(
      statusLabel({ kind: 'waiting', dueAt: new Date(NOW.getTime() + DAY) }, NOW),
    ).toBe('Next nudge in 1 day');
  });
});
