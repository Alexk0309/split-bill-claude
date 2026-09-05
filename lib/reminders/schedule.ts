/**
 * When a nudge is due, and what it says.
 *
 * Pure, and separate from the database, because the two things that matter
 * here are both judgements rather than mechanics: how long to leave someone
 * alone, and how to ask without making it awkward. Both are easier to argue
 * about when they are twenty lines you can read.
 *
 * Nothing in this file sends anything. It decides who is due and writes the
 * words; a person still has to press send.
 */

import { formatRM } from '@/lib/money';

export type CadenceName = 'gentle' | 'brisk';

export interface ReminderPolicy {
  firstAfterDays: number;
  repeatEveryDays: number;
  maxTotal: number;
}

export const CADENCES: Record<CadenceName, ReminderPolicy> = {
  /** The default: leave it three days, then every three, and stop after three. */
  gentle: { firstAfterDays: 3, repeatEveryDays: 3, maxTotal: 3 },
  /** For a bill somebody actually needs settled, still capped at three. */
  brisk: { firstAfterDays: 1, repeatEveryDays: 2, maxTotal: 3 },
};

export const CADENCE_LABELS: Record<CadenceName, string> = {
  gentle: 'After 3 days, then every 3 days',
  brisk: 'After 1 day, then every 2 days',
};

export function cadenceOf(name: string | null | undefined): ReminderPolicy {
  return CADENCES[(name as CadenceName) in CADENCES ? (name as CadenceName) : 'gentle'];
}

const DAY_MS = 86_400_000;

export interface ReminderInput {
  amountDueSen: number;
  settledAt: string | null;
  muted: boolean;
  snoozedUntil: string | null;
  remindersSent: number;
  lastRemindedAt: string | null;
  /** When reminders were switched on for this bill. */
  startedAt: string | null;
}

export type ReminderStatus =
  | { kind: 'settled' }
  | { kind: 'nothing-owed' }
  | { kind: 'muted' }
  | { kind: 'done' }
  | { kind: 'snoozed'; until: Date }
  | { kind: 'waiting'; dueAt: Date }
  | { kind: 'due'; stage: number };

/**
 * The order of these checks is the policy.
 *
 * Settled and nothing-owed come first because there is no debt to chase.
 * Muted comes before the schedule so that a person who asked to be left alone
 * is, whatever the clock says. The cap comes before the snooze because it is
 * terminal: three nudges is the end of it either way.
 */
export function reminderStatus(
  input: ReminderInput,
  policy: ReminderPolicy,
  now: Date,
): ReminderStatus {
  if (input.settledAt) return { kind: 'settled' };
  if (input.amountDueSen <= 0) return { kind: 'nothing-owed' };
  if (input.muted) return { kind: 'muted' };
  if (input.remindersSent >= policy.maxTotal) return { kind: 'done' };

  if (input.snoozedUntil) {
    const until = new Date(input.snoozedUntil);
    if (until.getTime() > now.getTime()) return { kind: 'snoozed', until };
  }

  // Never started, so nothing is due yet.
  if (!input.startedAt) return { kind: 'waiting', dueAt: new Date(now.getTime() + DAY_MS) };

  const since = input.lastRemindedAt
    ? new Date(input.lastRemindedAt).getTime() + policy.repeatEveryDays * DAY_MS
    : new Date(input.startedAt).getTime() + policy.firstAfterDays * DAY_MS;

  const dueAt = new Date(since);
  if (now.getTime() >= since) return { kind: 'due', stage: input.remindersSent + 1 };
  return { kind: 'waiting', dueAt };
}

/* -------------------------------------------------------------------------- */
/* The words                                                                   */
/* -------------------------------------------------------------------------- */

export interface ReminderMessageInput {
  name: string;
  amountSen: number;
  billTitle: string;
  venue: string | null;
  shareUrl: string;
  /** 1, 2 or 3. Later nudges are a little more direct, never colder. */
  stage: number;
}

/** "Sunday breakfast at Village Park", or whichever half of that exists. */
function occasion(billTitle: string, venue: string | null): string {
  const title = billTitle.trim();
  const place = venue?.trim();
  if (title && place) return `${title} at ${place}`;
  if (title) return title;
  if (place) return `the bill at ${place}`;
  return 'the bill';
}

/**
 * Friendly and blameless, on purpose.
 *
 * The whole reason someone would use this instead of typing it themselves is
 * that a neutral third party can ask without it costing the friendship. That
 * only holds if the words never imply the person has done something wrong, so
 * there is no "owe", no "overdue", and no "please pay" anywhere in here -- and
 * a test enforces it.
 */
export function reminderMessage({
  name,
  amountSen,
  billTitle,
  venue,
  shareUrl,
  stage,
}: ReminderMessageInput): string {
  const who = name.trim().split(/\s+/)[0] ?? name.trim();
  const amount = formatRM(amountSen);
  const what = occasion(billTitle, venue);

  if (stage <= 1) {
    return (
      `Hi ${who}! Just a nudge on the ${amount} for ${what} 🙂 ` +
      `No rush — everything's here if you want to check it: ${shareUrl}`
    );
  }
  if (stage === 2) {
    return (
      `Hi ${who}! Sorry to bring it up again — still ${amount} for ${what}, ` +
      `whenever you get a chance 🙂 ${shareUrl}`
    );
  }
  return (
    `Hi ${who}! Last nudge from me on the ${amount} for ${what}. ` +
    `If it's easier to sort it another way, just say 🙂 ${shareUrl}`
  );
}

/**
 * `wa.me` with no number opens the contact picker, so the payer chooses who it
 * goes to. The app never holds a guest's phone number, and the message names
 * one person and one amount -- so there is no version of this that reaches the
 * group chat.
 */
export function whatsappLink(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/** Plain English for the payer's screen. */
export function statusLabel(status: ReminderStatus, now: Date): string {
  switch (status.kind) {
    case 'settled':
      return 'Paid';
    case 'nothing-owed':
      return 'Nothing owed';
    case 'muted':
      return 'Muted';
    case 'done':
      return 'Nudged 3 times — that is enough';
    case 'snoozed':
      return `Snoozed until ${status.until.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}`;
    case 'waiting': {
      const days = Math.max(1, Math.ceil((status.dueAt.getTime() - now.getTime()) / DAY_MS));
      return `Next nudge in ${days} ${days === 1 ? 'day' : 'days'}`;
    }
    case 'due':
      return status.stage === 1 ? 'Ready to nudge' : `Ready for nudge ${status.stage}`;
  }
}
