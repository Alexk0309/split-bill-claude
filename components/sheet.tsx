'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { prefersReducedMotion, prefersReducedTransparency } from '@/lib/motion/feedback';
import { SpringValue, VelocityTracker, project, rubberband } from '@/lib/motion/spring';

/**
 * A sheet you can throw away.
 *
 * The old ones appeared and vanished: no travel, no grab, a flat scrim. That is
 * a dialog, and a dialog is a thing the app does to you. This is a panel that
 * came up from the bottom of the screen, that you can push back down, that
 * follows your thumb the whole way, and that you can catch halfway and send
 * back. The difference is not decoration -- it is the difference between
 * dismissing something and asking to have it dismissed.
 *
 * Four things make it feel physical, and all four are load-bearing:
 *
 * 1. It tracks the finger exactly, from wherever it was grabbed. Animating
 *    towards the finger, or snapping the sheet's edge to it, both break the
 *    illusion instantly.
 * 2. Letting go hands the finger's speed straight to the spring, so there is no
 *    seam between dragging and animating.
 * 3. Where it lands is decided by projecting the flick forward, not by where
 *    the finger happened to be. A small fast push should throw it.
 * 4. Nothing is ever locked. Grab it while it is animating -- opening, closing,
 *    springing back -- and it is yours from wherever it is at that instant.
 *
 * It leaves the way it arrived, downward, because a panel that comes from the
 * bottom and exits sideways severs the one spatial fact the user had.
 */

/* Tap-driven, so no overshoot: nothing pushed it, so nothing should rebound. */
const ENTER = { damping: 1, response: 0.38 };
/* A flick preceded this one, so a little bounce is the momentum being spent. */
const RETURN = { damping: 0.8, response: 0.32 };
/* On its way out and about to be unmounted; get there and be done. */
const EXIT = { damping: 1, response: 0.28 };

/** Past this projected landing point, the sheet was meant to go. */
const DISMISS_FRACTION = 0.5;

/** How much the page behind is blurred once the sheet is all the way up. */
const SCRIM_BLUR_PX = 6;

/**
 * Closing is the sheet's own business.
 *
 * Anything inside it asks to be dismissed rather than unmounting itself,
 * because the exit is an animation the sheet owns -- and because a close button
 * and a downward flick should be the same event, arriving at the same place,
 * not two code paths that happen to agree today.
 */
const SheetContext = createContext<(() => void) | null>(null);

export function useSheetClose(): () => void {
  const close = useContext(SheetContext);
  if (!close) throw new Error('useSheetClose must be used inside a <Sheet>');
  return close;
}

export function Sheet({
  label,
  heading,
  onClose,
  children,
}: {
  /** Named for screen readers. */
  label: string;
  /** The visible heading, below the grabber. */
  heading?: React.ReactNode;
  /** Called once the sheet has finished leaving, not when it starts. */
  onClose: () => void;
  children: React.ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);

  const offset = useRef(new SpringValue(0));
  const height = useRef(0);
  const tracker = useRef(new VelocityTracker());
  const drag = useRef<{ pointerId: number; grabOffset: number } | null>(null);
  const leaving = useRef(false);

  /* ---------------------------------------------------------------------- */
  /* Painting                                                                */
  /* ---------------------------------------------------------------------- */

  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    const scrim = scrimRef.current;
    if (!sheet || !scrim) return;

    height.current = sheet.offsetHeight;
    const spring = offset.current;
    const reduced = prefersReducedMotion();
    const blurMax = prefersReducedTransparency() ? 0 : SCRIM_BLUR_PX;

    // Everything on screen is written straight to style from the spring rather
    // than through React state. A sheet being dragged changes sixty times a
    // second and none of those are renders.
    const unsubscribe = spring.subscribe((y) => {
      const travel = height.current || 1;
      const progress = Math.max(0, Math.min(1, 1 - y / travel));

      // Reduced motion takes the travel out and leaves the cross-fade. The
      // drag still moves it, because that is the user's own hand, not the
      // interface moving underneath them.
      sheet.style.transform = reduced ? 'none' : `translate3d(0, ${y}px, 0)`;
      if (reduced) sheet.style.opacity = String(progress);

      // The scrim is not a fade; the blur ramping with it is what makes the
      // page behind read as having been pushed away rather than tinted.
      scrim.style.opacity = String(progress);
      if (blurMax > 0) {
        const blur = `blur(${(progress * blurMax).toFixed(2)}px)`;
        scrim.style.backdropFilter = blur;
        scrim.style.setProperty('-webkit-backdrop-filter', blur);
      }
    });

    spring.set(height.current);
    spring.animateTo(0, ENTER);

    return () => {
      unsubscribe();
      spring.cancel();
    };
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Leaving                                                                 */
  /* ---------------------------------------------------------------------- */

  const dismiss = useCallback(
    (velocity = 0) => {
      if (leaving.current) return;
      leaving.current = true;
      offset.current.animateTo(height.current, { ...EXIT, velocity }, onClose);
    },
    [onClose],
  );

  const close = useCallback(() => dismiss(), [dismiss]);

  /* ---------------------------------------------------------------------- */
  /* Dragging                                                                */
  /* ---------------------------------------------------------------------- */

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || leaving.current) return;

    const spring = offset.current;
    // Catching it mid-flight: stop where it is, not where it was going. The
    // spring's value is already the on-screen one, so there is nothing to
    // reconcile and nothing jumps.
    spring.cancel();

    // Capture, so the drag survives the pointer leaving the handle -- which it
    // will, since the handle is travelling downward out from under the finger.
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, grabOffset: event.clientY - spring.value };
    tracker.current.reset();
    tracker.current.add(spring.value);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;

    // Measured from where they took hold of it, so the sheet does not leap to
    // put its edge under the finger the moment it is touched.
    let y = event.clientY - active.grabOffset;

    // Upward, there is nothing above the top of the sheet. Resist rather than
    // refuse: a hard stop under a moving finger reads as the app hanging.
    if (y < 0) y = -rubberband(-y, height.current || 1);

    offset.current.set(y);
    tracker.current.add(y);
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    drag.current = null;

    const spring = offset.current;
    const velocity = tracker.current.velocity();
    // Where the throw would have put it, which is the question actually being
    // asked -- not where the finger stopped. A short, fast flick means gone
    // even though it barely moved, and a slow drag most of the way down does
    // not, because it was never thrown.
    const landing = spring.value + project(velocity);

    if (landing > (height.current || 1) * DISMISS_FRACTION) dismiss(velocity);
    else spring.animateTo(0, { ...RETURN, velocity });
  };

  /* ---------------------------------------------------------------------- */
  /* Keyboard, focus and the page underneath                                 */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const sheet = sheetRef.current;
    sheet?.focus({ preventScroll: true });

    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
        return;
      }
      if (event.key !== 'Tab' || !sheet) return;

      // Keep Tab inside. Behind this sheet is a whole page of controls that
      // cannot be seen and must not be reachable.
      const focusable = sheet.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [dismiss]);

  return createPortal(
    <SheetContext.Provider value={close}>
      <div className="fixed inset-0 z-50 flex flex-col justify-end">
        <div
          ref={scrimRef}
          aria-hidden="true"
          className="absolute inset-0"
          style={{ background: 'var(--scrim)', opacity: 0 }}
          onPointerDown={() => dismiss()}
        />

        <div
          ref={sheetRef}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          className="relative flex max-h-[88dvh] flex-col rounded-t-[1.75rem] outline-none"
          style={{
            background: 'var(--surface)',
            boxShadow: 'var(--shadow-sheet)',
            // Set before the first paint, so the sheet is never briefly on
            // screen at rest before it is told to come up from the bottom.
            transform: 'translate3d(0, 100%, 0)',
            willChange: 'transform',
          }}
        >
          {/*
            The grab area. `touch-action: none` because the browser must not
            decide a downward drag here is a scroll and take the pointer events
            away in the middle of the gesture.
          */}
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="shrink-0 cursor-grab px-5 pt-2.5 pb-1 active:cursor-grabbing"
            style={{ touchAction: 'none' }}
          >
            <span
              aria-hidden="true"
              className="mx-auto block h-1 w-9 rounded-full"
              style={{ background: 'var(--separator)' }}
            />
            {heading ? <div className="mt-3">{heading}</div> : null}
          </div>

          <div
            className="min-h-0 flex-1 overflow-y-auto px-5 pt-1 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
            // Stops a scroll that runs out of sheet from continuing into the
            // page behind it, which would scroll a list nobody can see.
            style={{ overscrollBehavior: 'contain' }}
          >
            {children}
          </div>
        </div>
      </div>
    </SheetContext.Provider>,
    document.body,
  );
}

/**
 * The close button every sheet ends with.
 *
 * Flicking it away is the better gesture and the one most people will reach
 * for, but it is not discoverable on first sight and it does not exist for
 * anyone driving this from a keyboard. Two ways out, always.
 */
export function SheetClose({ label = 'Close' }: { label?: string }) {
  const close = useSheetClose();
  return (
    <button
      type="button"
      onClick={close}
      data-press="button"
      className="btn btn-secondary mt-5 w-full"
    >
      {label}
    </button>
  );
}
