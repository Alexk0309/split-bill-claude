/**
 * Springs, parameterised the way Apple parameterises them.
 *
 * A fixed-duration animation cannot answer new input: it was scripted before
 * the user moved, so when they grab a moving sheet it has to either finish or
 * cut. A spring has no script. It only ever knows where it is, how fast it is
 * going, and where it is heading -- so a new target is not an interruption, it
 * is just a different destination reached from the current position at the
 * current speed. That is the whole reason this file exists.
 *
 * The two parameters are the ones designers can reason about, not the physics
 * triplet:
 *
 *   damping   Overshoot. 1 is critically damped and settles without bouncing;
 *             below 1 it passes the target and comes back. Bounce belongs only
 *             where the gesture itself carried momentum -- a flick, a throw.
 *             A menu that merely appeared should not wobble.
 *
 *   response  Roughly how long it takes to arrive, in seconds. It is not a
 *             duration: a spring has no fixed end, and the settle time falls
 *             out of the parameters. Lower is snappier.
 */

export type SpringConfig = {
  /** Damping ratio in (0, 1]. 1 = no overshoot. */
  damping?: number;
  /** Seconds to approach the target. Not a duration. */
  response?: number;
  /** Units per second at the moment the animation starts. */
  velocity?: number;
};

const DEFAULT_DAMPING = 1;
const DEFAULT_RESPONSE = 0.4;

/** Close enough to the target, and slow enough, to call it arrived. */
const REST_DISTANCE = 0.25;
const REST_VELOCITY = 0.25;

/**
 * Where a flick would come to rest if nothing stopped it.
 *
 * This is the exponential decay scroll views use, taken from Apple's own fluid
 * interfaces sample. It is deliberately not the textbook `v^2 / 2a`: that
 * models constant friction, which feels like dragging something across
 * concrete. Deciding a sheet's fate from the projected resting point rather
 * than the release point is what makes a small flick throw it.
 *
 * @param velocity     Release velocity, units per second.
 * @param deceleration 0.998 is the normal scroll feel; 0.99 is snappier.
 */
export function project(velocity: number, deceleration = 0.998): number {
  return ((velocity / 1000) * deceleration) / (1 - deceleration);
}

/**
 * Progressive resistance past a boundary.
 *
 * A hard stop reads as frozen -- the same thing a dead tap reads as. Resistance
 * that grows with the overshoot says "you can keep pulling, but there is
 * nothing more here", which is a statement about the content rather than about
 * the app.
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/**
 * The closed-form solution, in displacement from the target.
 *
 * Solved rather than integrated so the value at any moment does not depend on
 * how many frames it took to get there -- a spring stepped frame by frame
 * drifts when the browser drops frames, which is exactly when the motion is
 * most visible.
 */
function solve(damping: number, response: number, x0: number, v0: number) {
  const omega = (2 * Math.PI) / response;
  const zeta = Math.min(Math.max(damping, 0.05), 1);

  if (zeta === 1) {
    // Critically damped: the fastest approach with no overshoot at all.
    const b = v0 + omega * x0;
    return (t: number) => {
      const decay = Math.exp(-omega * t);
      return {
        value: decay * (x0 + b * t),
        velocity: decay * (b - omega * (x0 + b * t)),
      };
    };
  }

  const omegaD = omega * Math.sqrt(1 - zeta * zeta);
  const a = x0;
  const b = (v0 + zeta * omega * x0) / omegaD;
  return (t: number) => {
    const decay = Math.exp(-zeta * omega * t);
    const cos = Math.cos(omegaD * t);
    const sin = Math.sin(omegaD * t);
    const value = decay * (a * cos + b * sin);
    return {
      value,
      velocity: decay * (omegaD * (b * cos - a * sin)) - zeta * omega * value,
    };
  };
}

/**
 * A single animatable number that can be grabbed at any instant.
 *
 * Both of the things that make interruption work are properties of this object
 * rather than of any one animation: `value` is always the presentation value --
 * what is actually on screen this frame, not what some animation was aiming at
 * -- and `velocity` survives a retarget. Calling `animateTo` mid-flight starts
 * the new spring from both, so a reversal bends the motion instead of hitting
 * the brick wall you get from swapping one animation for another.
 *
 * Decompose two-dimensional motion into two of these. One spring driving a 2D
 * distance desynchronises the moment the axes have different velocities.
 */
export class SpringValue {
  value: number;
  velocity = 0;

  private target: number;
  private frame: number | null = null;
  private listeners = new Set<(value: number) => void>();
  private onRest: (() => void) | null = null;

  constructor(initial: number) {
    this.value = initial;
    this.target = initial;
  }

  subscribe(listener: (value: number) => void): () => void {
    this.listeners.add(listener);
    listener(this.value);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Put the value somewhere directly, cancelling any animation.
   *
   * This is what a drag uses on every pointer move. Touch and content have to
   * move together; anything that animates towards the finger is by definition
   * behind it.
   */
  set(value: number, velocity = 0): void {
    this.cancel();
    this.value = value;
    this.velocity = velocity;
    this.emit();
  }

  /** Spring to a target, from wherever it is and however fast it is going. */
  animateTo(target: number, config: SpringConfig = {}, onRest?: () => void): void {
    const damping = config.damping ?? DEFAULT_DAMPING;
    const response = config.response ?? DEFAULT_RESPONSE;
    // A velocity given by a gesture wins; otherwise carry the one already in
    // the value, which is what stops a retarget mid-flight from stuttering.
    const velocity = config.velocity ?? this.velocity;

    this.cancel();
    this.target = target;
    this.onRest = onRest ?? null;

    const displacement = this.value - target;
    if (Math.abs(displacement) < REST_DISTANCE && Math.abs(velocity) < REST_VELOCITY) {
      this.value = target;
      this.velocity = 0;
      this.emit();
      this.onRest?.();
      this.onRest = null;
      return;
    }

    const at = solve(damping, response, displacement, velocity);
    const start = performance.now();

    const step = (now: number) => {
      const t = (now - start) / 1000;
      const { value, velocity: v } = at(t);

      if (Math.abs(value) < REST_DISTANCE && Math.abs(v) < REST_VELOCITY) {
        this.value = this.target;
        this.velocity = 0;
        this.frame = null;
        this.emit();
        const rest = this.onRest;
        this.onRest = null;
        rest?.();
        return;
      }

      this.value = this.target + value;
      this.velocity = v;
      this.emit();
      this.frame = requestAnimationFrame(step);
    };

    this.frame = requestAnimationFrame(step);
  }

  /** Stop where it is, keeping the velocity so a grab can inherit it. */
  cancel(): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.onRest = null;
  }

  get isAnimating(): boolean {
    return this.frame !== null;
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.value);
  }
}

/**
 * The last moments of a drag, for the velocity at release.
 *
 * The delta between the final two pointer events is not the velocity: those
 * two can land a millisecond apart, or straddle a stall, and either way the
 * number is noise. A short window smooths it without lagging the finger.
 */
export class VelocityTracker {
  private samples: { value: number; time: number }[] = [];

  constructor(private readonly window = 100) {}

  add(value: number, time = performance.now()): void {
    this.samples.push({ value, time });
    while (this.samples.length > 2 && time - this.samples[0]!.time > this.window) {
      this.samples.shift();
    }
  }

  /** Units per second, or zero if the pointer has been still. */
  velocity(): number {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0]!;
    const last = this.samples[this.samples.length - 1]!;
    const elapsed = last.time - first.time;
    if (elapsed <= 0) return 0;
    return ((last.value - first.value) / elapsed) * 1000;
  }

  reset(): void {
    this.samples = [];
  }
}
