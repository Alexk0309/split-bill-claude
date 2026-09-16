import { SubmitButton } from '@/components/pending';
import { Avatar, Banner, Money } from '@/components/ui';
import {
  CADENCE_LABELS,
  cadenceOf,
  reminderStatus,
  statusLabel,
  type CadenceName,
} from '@/lib/reminders/schedule';
import type { SplitResult } from '@/lib/split';
import type { BillRow, ParticipantReminderRow, ParticipantRow } from '@/lib/supabase/types';

import {
  sendNudge,
  setParticipantMuted,
  setReminders,
  snoozeReminder,
} from '../../settlement-actions';

/**
 * Asking a friend for money is socially expensive. This screen exists so a
 * neutral third party can do the asking, which only works if it never turns
 * into a debt collection console: no totals of who is worst, no history of
 * chasing, and an easy way to stop.
 *
 * Nothing is sent from here. The app decides who is due and writes the words;
 * the payer taps once and their own WhatsApp sends it.
 */
export function RemindersPanel({
  bill,
  split,
  participants,
  reminderState,
}: {
  bill: BillRow;
  split: SplitResult | null;
  participants: ParticipantRow[];
  reminderState: Map<string, ParticipantReminderRow>;
}) {
  if (!split || participants.length === 0) return null;

  const now = new Date();
  const policy = cadenceOf(bill.reminder_cadence);
  const dueById = new Map(split.people.map((person) => [person.personId, person.amountDueSen]));

  const rows = participants.map((person) => {
    const state = reminderState.get(person.id);
    const amountDueSen = dueById.get(person.id) ?? 0;
    return {
      person,
      amountDueSen,
      status: reminderStatus(
        {
          amountDueSen,
          settledAt: person.settled_at,
          muted: Boolean(state?.reminders_muted),
          snoozedUntil: state?.reminder_snoozed_until ?? null,
          remindersSent: state?.reminders_sent ?? 0,
          lastRemindedAt: state?.last_reminded_at ?? null,
          startedAt: bill.reminders_started_at,
        },
        policy,
        now,
      ),
      muted: Boolean(state?.reminders_muted),
    };
  });

  // Only people who still owe something are worth showing at all.
  const chaseable = rows.filter(
    (row) => row.status.kind !== 'settled' && row.status.kind !== 'nothing-owed',
  );

  return (
    <section>
      <h2 className="group-label">Nudges</h2>

      <form action={setReminders} className="card p-4">
        <input type="hidden" name="billId" value={bill.id} />

        <label className="tap flex items-center gap-3">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={bill.reminders_enabled}
            className="h-5 w-5 shrink-0"
            style={{ accentColor: 'var(--accent)' }}
          />
          <span className="type-callout font-medium">Remind me who to nudge</span>
        </label>
        <p className="type-footnote mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
          Nothing is sent automatically. We work out who is due and write the message; you tap
          once to send it from your own WhatsApp.
        </p>

        <label className="label" htmlFor="cadence">
          How often
        </label>
        <select
          id="cadence"
          name="cadence"
          className="field"
          defaultValue={bill.reminder_cadence}
        >
          {(Object.keys(CADENCE_LABELS) as CadenceName[]).map((name) => (
            <option key={name} value={name}>
              {CADENCE_LABELS[name]}
            </option>
          ))}
        </select>
        <p className="type-footnote mt-1.5" style={{ color: 'var(--text-muted)' }}>
          Three nudges at most, ever. After that we stop asking.
        </p>

        <SubmitButton className="btn btn-secondary mt-3 w-full" pendingLabel="Saving…">
          Save
        </SubmitButton>
      </form>

      {bill.reminders_enabled ? (
        chaseable.length === 0 ? (
          <div className="mt-2">
            <Banner tone="good">Everyone has settled up. Nothing to chase.</Banner>
          </div>
        ) : (
          <div className="list mt-2">
            {chaseable.map(({ person, amountDueSen, status, muted }) => (
              <div key={person.id} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <Avatar name={person.display_name} seed={person.id} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="type-callout block truncate font-medium">
                      {person.display_name}
                    </span>
                    <span className="type-footnote" style={{ color: 'var(--text-muted)' }}>
                      {statusLabel(status, now)}
                    </span>
                  </span>
                  <Money sen={amountDueSen} className="type-headline shrink-0" />
                </div>

                <div className="mt-2.5 flex flex-wrap gap-2">
                  {status.kind === 'due' ? (
                    <form action={sendNudge}>
                      <input type="hidden" name="billId" value={bill.id} />
                      <input type="hidden" name="participantId" value={person.id} />
                      <SubmitButton
                        className="btn btn-primary tap type-subhead min-h-0 px-3 py-1.5"
                        pendingLabel="Opening WhatsApp…"
                      >
                        Send on WhatsApp
                      </SubmitButton>
                    </form>
                  ) : null}

                  {status.kind === 'due' || status.kind === 'waiting' ? (
                    <form action={snoozeReminder}>
                      <input type="hidden" name="billId" value={bill.id} />
                      <input type="hidden" name="participantId" value={person.id} />
                      <SubmitButton
                        className="btn btn-secondary tap type-subhead min-h-0 px-3 py-1.5"
                        pendingLabel="Snoozing…"
                      >
                        Snooze 3 days
                      </SubmitButton>
                    </form>
                  ) : null}

                  <form action={setParticipantMuted}>
                    <input type="hidden" name="billId" value={bill.id} />
                    <input type="hidden" name="participantId" value={person.id} />
                    <input type="hidden" name="muted" value={muted ? 'false' : 'true'} />
                    <SubmitButton className="btn btn-ghost tap type-subhead min-h-0 px-2 py-1.5">
                      {muted ? 'Unmute' : 'Never nudge'}
                    </SubmitButton>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )
      ) : null}
    </section>
  );
}
