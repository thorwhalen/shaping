/**
 * Paced updates: a stream of values (a slider being dragged) drives expensive work (a rebuild, a
 * re-render), and the device may not keep up. Three rules, in order of importance:
 *
 * 1. **The last value always lands.** `commit` (release, key up, blur) is applied no matter what.
 * 2. **Never queue stale work.** At most one value is being applied; while it is, newer values
 *    replace each other and only the newest is applied next (latest-wins backpressure). So the
 *    screen follows the hand as fast as the work allows, and never replays a backlog after release.
 * 3. **Under load, skip the in-between.** Each apply is timed from the call until its result is on
 *    screen (`settled`). When that is over budget, intermediate values are held and only applied
 *    when the stream pauses (`settleMs`) or ends: the live preview is dropped, the final result is
 *    not. The estimate is shared by default, so every control on the page learns from the others.
 *
 * Framework-free and host-free (the React binding is `./react`). Every clock and timer is
 * injectable, for tests. extraction candidate: zodal-dials sliders (i2mint/zodal-dials#16).
 */

/** Above this many ms from apply to screen, the live preview is dropped. Past the Doherty threshold's half. */
export const DEFAULT_BUDGET_MS = 250;
/** While held, a pause this long in the stream applies the latest value anyway. */
export const DEFAULT_SETTLE_MS = 180;
/** A `settled` slower than this releases the pacer anyway (a stuck build must not freeze the control). */
export const DEFAULT_MAX_WAIT_MS = 8000;

/** A running estimate of how long one apply takes to reach the screen, and whether that is too slow. */
export interface Load {
  sample(ms: number): void;
  readonly slow: boolean;
  readonly estimateMs: number;
}

export interface LoadOptions {
  budgetMs?: number;
  /** Once slow, the estimate must fall below `budgetMs * recoverRatio` to count as fast again (no flapping). */
  recoverRatio?: number;
  /** Weight of the newest sample in the moving average. */
  weight?: number;
}

export function createLoad({ budgetMs = DEFAULT_BUDGET_MS, recoverRatio = 0.6, weight = 0.4 }: LoadOptions = {}): Load {
  let estimate = 0;
  let samples = 0;
  let slow = false;
  return {
    sample(ms) {
      estimate = samples++ === 0 ? ms : estimate + weight * (ms - estimate);
      if (estimate > budgetMs) slow = true;
      else if (estimate < budgetMs * recoverRatio) slow = false;
    },
    get slow() {
      return slow;
    },
    get estimateMs() {
      return estimate;
    },
  };
}

/** The estimate every pacer uses unless given its own. */
export const sharedLoad: Load = createLoad();

/** Resolves after the next frame has been painted (or soon, where there are no frames). */
export function nextPaint(): Promise<void> {
  if (typeof requestAnimationFrame === 'undefined') return new Promise((r) => setTimeout(r, 0));
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export interface PacerOptions {
  /** Resolves when the effect of the last apply is on screen. Default: the next painted frame. */
  settled?: () => Promise<void>;
  load?: Load;
  settleMs?: number;
  maxWaitMs?: number;
  /** Called whenever nothing is pending or being applied. */
  onIdle?: () => void;
  now?: () => number;
  timers?: Timers;
}

export interface Pacer<T> {
  /** An intermediate value: applied now, next, or (under load) when the stream pauses. */
  push(value: T): void;
  /** The final value (default: the last pushed one): always applied, after anything in flight. */
  commit(value?: T): void;
  readonly busy: boolean;
  dispose(): void;
}

export function createPacer<T>(apply: (value: T, final: boolean) => void, options: PacerOptions = {}): Pacer<T> {
  const {
    settled = nextPaint,
    load = sharedLoad,
    settleMs = DEFAULT_SETTLE_MS,
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
    onIdle,
    now = () => performance.now(),
    timers = realTimers,
  } = options;
  /** `due`: apply even under load (a commit, or a pause in the stream). */
  let pending: { value: T; final: boolean; due: boolean } | null = null;
  let last: { value: T } | null = null;
  let applied: { value: T } | null = null;
  let inFlight = false;
  let pause: unknown = null;
  let disposed = false;

  const waitAtMost = (p: Promise<void>) =>
    new Promise<void>((resolve) => {
      const t = timers.set(resolve, maxWaitMs);
      p.then(
        () => (timers.clear(t), resolve()),
        () => (timers.clear(t), resolve()),
      );
    });

  function holdUntilPause() {
    timers.clear(pause);
    pause = timers.set(() => {
      pause = null;
      if (pending) pending.due = true;
      void pump();
    }, settleMs);
  }

  async function pump(): Promise<void> {
    if (disposed || inFlight) return;
    if (!pending) return onIdle?.();
    if (!pending.due && load.slow) return holdUntilPause();
    const { value, final } = pending;
    pending = null;
    if (final) last = null;
    if (applied && Object.is(applied.value, value)) return pump();
    inFlight = true;
    applied = { value };
    const t0 = now();
    try {
      apply(value, final);
      await waitAtMost(settled());
    } finally {
      load.sample(now() - t0);
      inFlight = false;
    }
    return pump();
  }

  return {
    push(value) {
      last = { value };
      pending = { value, final: false, due: false };
      void pump();
    },
    commit(value) {
      const v = value !== undefined ? { value } : last;
      last = null;
      if (!v) return;
      timers.clear(pause);
      pending = { value: v.value, final: true, due: true };
      void pump();
    },
    get busy() {
      return inFlight || pending !== null;
    },
    dispose() {
      disposed = true;
      timers.clear(pause);
      pending = null;
    },
  };
}
