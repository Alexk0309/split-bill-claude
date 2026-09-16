import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpringValue, VelocityTracker, project, rubberband } from '../spring';

/* -------------------------------------------------------------------------- */
/* A fake clock                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Springs are driven by the display, which a test does not have. This runs them
 * against a clock the test advances by hand, so what is asserted is the motion
 * itself rather than how fast the machine running the suite happens to be.
 */
function withFakeFrames(): { advance: (ms: number) => void; restore: () => void } {
  let now = 0;
  let pending: ((time: number) => void)[] = [];

  const realRaf = globalThis.requestAnimationFrame;
  const realCancel = globalThis.cancelAnimationFrame;
  const realNow = performance.now;

  const callbacks = new Map<number, (time: number) => void>();
  let nextId = 1;

  globalThis.requestAnimationFrame = ((callback: (time: number) => void) => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  }) as typeof requestAnimationFrame;

  globalThis.cancelAnimationFrame = ((id: number) => {
    callbacks.delete(id);
  }) as typeof cancelAnimationFrame;

  performance.now = () => now;

  return {
    advance(ms: number) {
      // A sixtieth of a second per frame, the rate a spring is written for.
      const frames = Math.max(1, Math.round(ms / 16.67));
      for (let i = 0; i < frames; i += 1) {
        now += 16.67;
        pending = [...callbacks.values()];
        callbacks.clear();
        for (const callback of pending) callback(now);
      }
    },
    restore() {
      globalThis.requestAnimationFrame = realRaf;
      globalThis.cancelAnimationFrame = realCancel;
      performance.now = realNow;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */

describe('project', () => {
  it('is still where it started when nothing was thrown', () => {
    expect(project(0)).toBe(0);
  });

  it('carries further the harder it is thrown', () => {
    expect(project(1000)).toBeGreaterThan(project(500));
    expect(project(500)).toBeGreaterThan(project(100));
  });

  it('projects backwards for a flick the other way', () => {
    expect(project(-800)).toBeLessThan(0);
  });

  it('turns a small flick into a long throw, which is the point', () => {
    // 800px/s is an ordinary phone flick, and it should carry far enough to
    // dismiss a sheet from well above the halfway line.
    expect(project(800)).toBeGreaterThan(300);
  });

  it('settles sooner with a snappier deceleration rate', () => {
    expect(project(800, 0.99)).toBeLessThan(project(800, 0.998));
  });
});

describe('rubberband', () => {
  it('does not resist what has not moved', () => {
    expect(rubberband(0, 400)).toBe(0);
  });

  it('always gives less than was asked for', () => {
    for (const overshoot of [10, 50, 200, 1000]) {
      expect(rubberband(overshoot, 400)).toBeLessThan(overshoot);
    }
  });

  it('resists harder the further it is pulled', () => {
    // Each extra pixel of pull yields less travel than the one before it, which
    // is what "there is nothing more here" feels like.
    const first = rubberband(50, 400) - rubberband(0, 400);
    const later = rubberband(300, 400) - rubberband(250, 400);
    expect(later).toBeLessThan(first);
  });

  it('still moves, so the screen never reads as frozen', () => {
    expect(rubberband(50, 400)).toBeGreaterThan(0);
  });
});

describe('VelocityTracker', () => {
  it('reports nothing from a single sample', () => {
    const tracker = new VelocityTracker();
    tracker.add(0, 0);
    expect(tracker.velocity()).toBe(0);
  });

  it('measures pixels per second', () => {
    const tracker = new VelocityTracker();
    tracker.add(0, 0);
    tracker.add(50, 100);
    expect(tracker.velocity()).toBeCloseTo(500, 5);
  });

  it('reports zero for a pointer that was held still', () => {
    const tracker = new VelocityTracker();
    tracker.add(120, 0);
    tracker.add(120, 60);
    tracker.add(120, 120);
    expect(tracker.velocity()).toBe(0);
  });

  it('forgets samples older than its window, so a pause is not averaged in', () => {
    const tracker = new VelocityTracker(100);
    // Held still for a while, then flicked.
    tracker.add(0, 0);
    tracker.add(0, 500);
    tracker.add(60, 560);
    // Averaging over the whole gesture would read as about 107px/s.
    expect(tracker.velocity()).toBeCloseTo(1000, 0);
  });

  it('starts over when reset', () => {
    const tracker = new VelocityTracker();
    tracker.add(0, 0);
    tracker.add(100, 100);
    tracker.reset();
    tracker.add(5, 200);
    expect(tracker.velocity()).toBe(0);
  });
});

describe('SpringValue', () => {
  it('arrives at the target and stops there', () => {
    const clock = withFakeFrames();
    try {
      const spring = new SpringValue(0);
      spring.animateTo(100, { damping: 1, response: 0.3 });
      clock.advance(2000);
      expect(spring.value).toBe(100);
      expect(spring.velocity).toBe(0);
      expect(spring.isAnimating).toBe(false);
    } finally {
      clock.restore();
    }
  });

  it('calls back once it has come to rest, not when it set off', () => {
    const clock = withFakeFrames();
    try {
      const rested = vi.fn();
      const spring = new SpringValue(0);
      spring.animateTo(100, { damping: 1, response: 0.3 }, rested);
      expect(rested).not.toHaveBeenCalled();
      clock.advance(2000);
      expect(rested).toHaveBeenCalledTimes(1);
    } finally {
      clock.restore();
    }
  });

  it('never passes the target when critically damped', () => {
    const clock = withFakeFrames();
    try {
      const seen: number[] = [];
      const spring = new SpringValue(0);
      spring.subscribe((value) => seen.push(value));
      spring.animateTo(100, { damping: 1, response: 0.3 });
      clock.advance(2000);
      // A menu that merely appeared has no business wobbling.
      expect(Math.max(...seen)).toBeLessThanOrEqual(100);
    } finally {
      clock.restore();
    }
  });

  it('overshoots when under-damped, which is what bounce is', () => {
    const clock = withFakeFrames();
    try {
      const seen: number[] = [];
      const spring = new SpringValue(0);
      spring.subscribe((value) => seen.push(value));
      spring.animateTo(100, { damping: 0.6, response: 0.4 });
      clock.advance(2000);
      expect(Math.max(...seen)).toBeGreaterThan(100);
      expect(spring.value).toBe(100);
    } finally {
      clock.restore();
    }
  });

  it('is thrown further by the velocity it is handed', () => {
    const clock = withFakeFrames();
    try {
      const withThrow: number[] = [];
      const thrown = new SpringValue(0);
      thrown.subscribe((value) => withThrow.push(value));
      thrown.animateTo(100, { damping: 0.8, response: 0.4, velocity: 2000 });

      const gentle: number[] = [];
      const released = new SpringValue(0);
      released.subscribe((value) => gentle.push(value));
      released.animateTo(100, { damping: 0.8, response: 0.4, velocity: 0 });

      clock.advance(2000);
      // The seam between dragging and animating is exactly this: the animation
      // has to leave at the speed the finger was going.
      expect(Math.max(...withThrow)).toBeGreaterThan(Math.max(...gentle));
    } finally {
      clock.restore();
    }
  });

  it('retargets from where it is, without jumping', () => {
    const clock = withFakeFrames();
    try {
      const spring = new SpringValue(0);
      spring.animateTo(400, { damping: 1, response: 0.6 });
      clock.advance(150);

      const caught = spring.value;
      expect(caught).toBeGreaterThan(0);
      expect(caught).toBeLessThan(400);

      const seen: number[] = [];
      spring.subscribe((value) => seen.push(value));
      // Reversed mid-flight, the way a sheet grabbed on its way up is.
      spring.animateTo(0, { damping: 1, response: 0.3 });

      // The first frame after the reversal continues from the position it had,
      // rather than restarting from wherever the old animation was aiming.
      expect(seen[0]).toBeCloseTo(caught, 5);
      clock.advance(2000);
      expect(spring.value).toBe(0);
    } finally {
      clock.restore();
    }
  });

  it('carries its velocity through a retarget rather than cutting to zero', () => {
    const clock = withFakeFrames();
    try {
      const spring = new SpringValue(0);
      spring.animateTo(400, { damping: 1, response: 0.6 });
      clock.advance(150);
      const speed = spring.velocity;
      expect(speed).toBeGreaterThan(0);

      // Same direction, further away: it should still be moving when it takes
      // the new target, not starting again from a standstill.
      spring.animateTo(800, { damping: 1, response: 0.6 });
      clock.advance(17);
      expect(spring.velocity).toBeGreaterThan(speed * 0.5);
    } finally {
      clock.restore();
    }
  });

  it('stops dead when set, because a drag owns the value outright', () => {
    const clock = withFakeFrames();
    try {
      const spring = new SpringValue(0);
      spring.animateTo(400, { damping: 1, response: 0.6 });
      clock.advance(100);

      spring.set(42);
      expect(spring.isAnimating).toBe(false);
      clock.advance(500);
      // Nothing moved it afterwards: the finger is holding it there.
      expect(spring.value).toBe(42);
    } finally {
      clock.restore();
    }
  });

  it('does not animate, or leave a callback owing, when already there', () => {
    const clock = withFakeFrames();
    try {
      const rested = vi.fn();
      const spring = new SpringValue(100);
      spring.animateTo(100, { damping: 1, response: 0.3 }, rested);
      expect(spring.isAnimating).toBe(false);
      expect(rested).toHaveBeenCalledTimes(1);
    } finally {
      clock.restore();
    }
  });

  it('tells every subscriber where it is the moment they subscribe', () => {
    const spring = new SpringValue(37);
    const seen: number[] = [];
    spring.subscribe((value) => seen.push(value));
    expect(seen).toEqual([37]);
  });

  it('stops telling a subscriber that has unsubscribed', () => {
    const clock = withFakeFrames();
    try {
      const spring = new SpringValue(0);
      const seen: number[] = [];
      const unsubscribe = spring.subscribe((value) => seen.push(value));
      unsubscribe();
      spring.animateTo(100, { damping: 1, response: 0.3 });
      clock.advance(500);
      expect(seen).toEqual([0]);
    } finally {
      clock.restore();
    }
  });
});
