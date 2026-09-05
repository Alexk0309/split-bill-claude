-- Reminders.
--
-- Asking a friend for RM23.50 is socially expensive. A neutral third party
-- doing the asking is the point of the feature, so what is stored here is a
-- schedule and a count, not a debt collection record.
--
-- Nothing is sent by the server. The app works out who is due and writes the
-- message; the payer taps once and their own WhatsApp sends it. Automated
-- outbound messaging would need WhatsApp Business API approval and drifts
-- toward spam, so it is deliberately not built.

alter table public.bills
  add column reminders_enabled boolean not null default false,
  add column reminder_cadence text not null default 'gentle'
    check (reminder_cadence in ('gentle', 'brisk')),
  -- The clock starts when reminders are switched on, not when the bill was
  -- created: turning them on a week later must not fire three nudges at once.
  add column reminders_started_at timestamptz;

alter table public.participants
  -- Per person, so one friend who has said "next week, promise" can be left
  -- alone without muting everybody.
  add column reminders_muted boolean not null default false,
  add column reminder_snoozed_until timestamptz,
  add column reminders_sent integer not null default 0,
  add column last_reminded_at timestamptz;

-- These columns are deliberately left out of the guest column grant on
-- `participants`: whether somebody has been nudged, and how often, is between
-- them and the payer. Guests continue to read only the six columns granted in
-- 0001, which is why the loader names its columns rather than asking for `*`.
