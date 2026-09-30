/**
 * Paced updates: a stream of values (a slider being dragged) drives expensive work (a rebuild, a
 * re-render), and the device may not keep up. Three rules, in order of importance:
 *
 * 1. **The last value always lands, at once.** `commit` (release, key up, blur) is applied immediately,
 *    without waiting for work in flight, so an undo or a switch that follows it acts on it.
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
  /** Samples are capped here (default 4 × budget), so one cold start cannot keep the estimate slow for long. */
  maxSampleMs?: number;
}

export function createLoad({ budgetMs = DEFAULT_BUDGET_MS, recoverRatio = 0.6, weight = 0.4, maxSampleMs = 4 * budgetMs }: LoadOptions = {}): Load {
  let estimate = 0;
  let samples = 0;
  let slow = false;
  return {
    sample(ms) {
      const x = Math.min(ms, maxSampleMs);
      estimate = samples++ === 0 ? x : estimate + weight * (x - estimate);
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

/** A hidden page paints nothing, so its round trips say nothing about the device. */
const pageHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

export interface PacerOptions {
  /** Resolves when the effect of the last apply is on screen. Default: the next painted frame. */
  settled?: () => Promise<void>;
  load?: Load;
  settleMs?: number;
  maxWaitMs?: number;
  /** Called whenever nothing is pending or being applied. */
  onIdle?: () => void;
  /** A gesture starts with the first value pushed and ends when its committed value is on screen (or it is cancelled). */
  onGesture?: (active: boolean) => void;
  /** Called when `apply` throws; the pacer carries on. Default: `console.error`. */
  onError?: (error: unknown) => void;
  now?: () => number;
  timers?: Timers;
}

export interface Pacer<T> {
  /** An intermediate value: applied now, next, or (under load) when the stream pauses. */
  push(value: T): void;
  /** The final value (default: the last pushed one, if not already applied): applied at once. */
  commit(value?: T): void;
  readonly busy: boolean;
  /** Drop anything pending and end the gesture. The pacer stays usable. */
  cancel(): void;
}

export function createPacer<T>(apply: (value: T, final: boolean) => void, options: PacerOptions = {}): Pacer<T> {
  const {
    settled = nextPaint,
    load = sharedLoad,
    settleMs = DEFAULT_SETTLE_MS,
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
    onIdle,
    onGesture,
    onError = (e: unknown) => console.error(e),
    now = () => performance.now(),
    timers = realTimers,
  } = options;
  type Entry = { value: T; applied: boolean; due: boolean };
  /** The newest pushed value, until committed. */
  let last: Entry | null = null;
  /** The value waiting to be applied (always `last`, when set). */
  let pending: Entry | null = null;
  /** Token of the newest apply still waiting for its result; older ones finishing are ignored. */
  let inFlight = 0;
  let seq = 0;
  let pause: unknown = null;
  let gesture = false;
  /** The gesture was committed; it ends when the work in flight lands. */
  let closing = false;

  const setGesture = (active: boolean) => {
    if (gesture === active) return;
    gesture = active;
    onGesture?.(active);
  };

  /** Resolves `true` if the result reached the screen, `false` if we stopped waiting. */
  const waitAtMost = (p: Promise<void>) =>
    new Promise<boolean>((resolve) => {
      const t = timers.set(() => resolve(false), maxWaitMs);
      const done = () => (timers.clear(t), resolve(true));
      p.then(done, done);
    });

  function holdUntilPause() {
    timers.clear(pause);
    pause = timers.set(() => {
      pause = null;
      if (pending) pending.due = true;
      pump();
    }, settleMs);
  }

  async function run(value: T, final: boolean) {
    const token = (inFlight = ++seq);
    const t0 = now();
    try {
      apply(value, final);
    } catch (e) {
      onError(e);
    }
    const reached = await waitAtMost(settled());
    if (reached && !pageHidden()) load.sample(now() - t0);
    if (token !== inFlight) return; // a newer apply (a commit) overtook this one
    inFlight = 0;
    if ((final || closing) && !pending) (closing = false, setGesture(false));
    pump();
  }

  function pump() {
    if (inFlight) return;
    if (!pending) return onIdle?.();
    if (!pending.due && load.slow) return holdUntilPause();
    const entry = pending;
    pending = null;
    entry.applied = true;
    void run(entry.value, false);
  }

  return {
    push(value) {
      closing = false;
      setGesture(true);
      last = pending = { value, applied: false, due: false };
      pump();
    },
    commit(value) {
      const entry = value !== undefined ? { value } : last && !last.applied ? last : null;
      last = pending = null;
      timers.clear(pause);
      if (entry) return void run(entry.value, true);
      if (inFlight) closing = true;
      else (setGesture(false), onIdle?.());
    },
    get busy() {
      return inFlight !== 0 || pending !== null;
    },
    cancel() {
      closing = false;
      timers.clear(pause);
      last = pending = null;
      setGesture(false);
    },
  };
}
