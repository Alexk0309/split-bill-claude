'use client';

import { useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

/**
 * Buttons that show they are working.
 *
 * There was one shape of bug behind all of this: a form posts to a server
 * action, the action takes a few hundred milliseconds, and nothing on screen
 * changes. On a phone that reads as a missed tap, so the reasonable thing to do
 * is tap again -- and every tap is another request. One account created three
 * bills in three seconds that way and used up its entire allowance.
 *
 * So `disabled` is the fix and the spinner is the explanation. Neither is
 * enough alone: without disabling, the taps still land; without the spinner,
 * the button looks broken rather than busy.
 *
 * This does mean the guard is client-side, and there is a window before
 * hydration where it does not exist. Anything whose double-submit actually
 * costs something is also made idempotent on the server -- see
 * `public.create_bill`.
 */

/** Reads the enclosing <form>'s status, so it must be rendered inside one. */
export function SubmitButton({
  children,
  className = 'btn btn-primary',
  /** Shown in place of the label while the action runs. */
  pendingLabel,
}: {
  children: React.ReactNode;
  className?: string | undefined;
  pendingLabel?: string | undefined;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      data-press="button"
      className={className}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? (
        <>
          <span className="spinner" aria-hidden="true" />
          {/* Icon-only buttons pass no pending label; the spinner stands in for
              the icon rather than crowding in beside it. */}
          {pendingLabel ?? <span className="sr-only">Working…</span>}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/**
 * A destructive submit that takes two taps.
 *
 * Deleting a bill cannot be undone and does not give the allowance back, which
 * makes it the most expensive thing on the screen to hit by accident -- and it
 * sat directly below a row of ordinary buttons with nothing in between. The
 * confirmation is inline rather than a `confirm()` dialog: some in-app browsers
 * suppress those outright, and a native dialog on a phone is easier to dismiss
 * by reflex than to read.
 */
export function ConfirmButton({
  children,
  confirmLabel,
  className = 'btn btn-ghost type-subhead w-full',
  confirmClassName = 'btn btn-primary type-subhead w-full',
  pendingLabel,
}: {
  children: React.ReactNode;
  confirmLabel: string;
  className?: string | undefined;
  confirmClassName?: string | undefined;
  pendingLabel?: string | undefined;
}) {
  const [armed, setArmed] = useState(false);
  const { pending } = useFormStatus();

  // Disarms itself, so a tap left armed and forgotten is not still waiting to
  // fire the next time the screen is touched.
  useEffect(() => {
    if (!armed || pending) return;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed, pending]);

  if (!armed) {
    return (
      <button type="button" data-press="button" className={className} onClick={() => setArmed(true)}>
        {children}
      </button>
    );
  }

  return (
    <span className="flex gap-2">
      <SubmitButton className={`${confirmClassName} flex-1`} pendingLabel={pendingLabel}>
        {confirmLabel}
      </SubmitButton>
      <button
        type="button"
        data-press="button"
        className="btn btn-secondary type-subhead shrink-0"
        onClick={() => setArmed(false)}
        disabled={pending}
      >
        Cancel
      </button>
    </span>
  );
}
