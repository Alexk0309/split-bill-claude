/**
 * Haptics, and the one rule that decides whether they help.
 *
 * Feedback across senses only works when it is caused, harmonious and useful.
 * Caused: it fires on the event that actually happened -- the claim landing,
 * the proof matching -- not on a timer afterwards, or the taps stop meaning
 * anything. Harmonious: it fires on the same frame as the visual, because a
 * buzz that trails the animation reads as a second, unrelated event. Useful:
 * it is spent only on moments worth marking. A phone that buzzes at everything
 * teaches the hand to stop listening, and then it cannot buzz for the one
 * thing that mattered.
 *
 * So: claiming and unclaiming an item, and a settlement being confirmed. Not
 * navigation, not typing, not a panel opening.
 *
 * Only Android Chrome implements this; iOS Safari has no web haptics at all,
 * which is fine because nothing here depends on it. The visual always carries
 * the meaning on its own.
 */

type Pattern = 'select' | 'commit' | 'warn';

const PATTERNS: Record<Pattern, number | number[]> = {
  /** A claim toggling. Short enough to feel like the tap itself. */
  select: 8,
  /** Something finished and is now true. */
  commit: [12, 40, 18],
  /** Something needs a look before it is trusted. */
  warn: [20, 60, 20],
};

export function haptic(pattern: Pattern): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  // Motion sensitivity and vibration sensitivity travel together often enough
  // that the reduced-motion setting is the best signal available here.
  if (prefersReducedMotion()) return;
  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    // Blocked by a permissions policy in some embedded browsers. Nothing here
    // depends on it landing.
  }
}

/**
 * Whether to use the gentler, non-vestibular version of a transition.
 *
 * Reduced motion does not mean no feedback -- a screen that simply stops
 * responding is worse, not kinder. It means trading travel and overshoot for a
 * cross-fade, and keeping everything that aids comprehension.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Whether blurred chrome should be frosted over into something solid.
 *
 * Asked for by people who find text over a shifting, blurred background hard to
 * read. The CSS handles this for anything styled in a stylesheet; this is for
 * the few places a blur is driven frame by frame from JavaScript.
 */
export function prefersReducedTransparency(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
}
