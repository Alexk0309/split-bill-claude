'use client';

import { useEffect } from 'react';

/**
 * Press feedback for the whole app, from one pointer listener.
 *
 * The moment lag appears between a touch and a response, the sense of touching
 * the thing directly falls away -- and waiting for the release to acknowledge a
 * press is lag, however fast the release then is. So the highlight goes on at
 * pointer-*down*, and the action still happens at pointer-up.
 *
 * A press is also revocable. Put a thumb on a button, think better of it, slide
 * away and lift: nothing should happen, and the highlight should have come off
 * the moment the thumb left. Slide back and it should come on again. That is
 * why this is a pointer listener with a threshold rather than `:active`, which
 * cannot express any of it -- and which Safari on iOS withholds from elements
 * it has decided are not interactive.
 *
 * Opt in by putting `data-press` on an element: `button` for controls, `row`
 * for full-width rows, `plain` for links and text targets. The styling lives in
 * globals.css.
 */

/**
 * How far a thumb may wander and still count as pressing.
 *
 * Fingers are imprecise and screens move; zero tolerance would flicker the
 * highlight off under a perfectly still thumb. Beyond this it is a drag or a
 * scroll, not a press.
 */
const SLOP = 10;

export function PressFeedback() {
  useEffect(() => {
    let pressed: HTMLElement | null = null;
    let pointerId: number | null = null;
    let originX = 0;
    let originY = 0;

    const clear = () => {
      if (pressed) pressed.removeAttribute('data-pressed');
      pressed = null;
      pointerId = null;
    };

    const onPointerDown = (event: PointerEvent) => {
      // Secondary buttons open menus; they are not presses.
      if (event.button !== 0) return;
      const target = event.target as Element | null;
      const element = target?.closest?.('[data-press]') as HTMLElement | null;
      if (!element) return;
      if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') {
        return;
      }

      clear();
      pressed = element;
      pointerId = event.pointerId;
      originX = event.clientX;
      originY = event.clientY;
      element.setAttribute('data-pressed', '');
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pressed || event.pointerId !== pointerId) return;
      const far =
        Math.abs(event.clientX - originX) > SLOP || Math.abs(event.clientY - originY) > SLOP;
      // Re-arms on the way back in, so a wobble does not cost the press.
      if (far) pressed.removeAttribute('data-pressed');
      else pressed.setAttribute('data-pressed', '');
    };

    const onEnd = (event: PointerEvent) => {
      if (pointerId !== null && event.pointerId !== pointerId) return;
      clear();
    };

    // A scroll means the touch was always going to be a scroll. The press is
    // over, whatever the pointer does next.
    const onScroll = () => clear();

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onEnd, true);
    document.addEventListener('pointercancel', onEnd, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', clear);

    return () => {
      clear();
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onEnd, true);
      document.removeEventListener('pointercancel', onEnd, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', clear);
    };
  }, []);

  return null;
}
