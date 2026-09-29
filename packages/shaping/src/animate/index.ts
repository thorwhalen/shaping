/**
 * Animation: a function from a time to a `Design`.
 *
 * Pure and DOM-free. An `Animation` is a flat list of actions in the shape used by the `an` package
 * (`set` and `tween`, absolute start and end times). `designAt(design, t)` applies every action at
 * time `t` to a copy of the design; the caller then renders (view/style changes) or rebuilds the
 * Model (anything else, see `rebuildsGeometry`). The viewer never fakes geometry.
 *
 * Easings use the standard cubic curves: `ease_in` = t^3, `ease_out` = 1 - (1 - t)^3, and
 * `ease_in_out` = 4t^3 below one half, 1 - (-2t + 2)^3 / 2 above. Names follow `an`.
 *
 * Looping: frame N equals frame 0, so an animation writes `frameCount` = round(duration * fps)
 * frames at times i / fps and never the frame at `duration`.
 */
import type { Animation, Design, FlatAction } from '../design.js';

export type EasingName = 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out';
export type Easing = (t: number) => number;
type TweenAction = Extract<FlatAction['action'], { kind: 'tween' }>;

const CUBIC = 3;
const HALF = 0.5;
const FULL_TURN_DEG = 360;
const DEFAULT_FPS = 24;
const DEFAULT_SECONDS = 4;
/** Targets whose actions never change geometry. */
const RENDER_ONLY_TARGETS: ReadonlySet<string> = new Set(['view', 'style']);
/** The pseudo-target addressing top-level keys of the Design itself (e.g. `sizeMm`). */
const DESIGN_TARGET = 'design';
/** Only this section may gain new keys (genre parameters have defaults absent from the document). */
const OPEN_TARGET = 'params';

const EASING_TABLE: Record<EasingName, Easing> = {
  linear: (t) => t,
  ease_in: (t) => t ** CUBIC,
  ease_out: (t) => 1 - (1 - t) ** CUBIC,
  ease_in_out: (t) => (t < HALF ? 4 * t ** CUBIC : 1 - (-2 * t + 2) ** CUBIC / 2),
};

/** The easing function for a name (null means linear), exactly 0 at t <= 0 and 1 at t >= 1. */
export function ease(name: EasingName | null | undefined = 'ease_in_out'): Easing {
  const fn = EASING_TABLE[name ?? 'linear'];
  if (!fn) throw new Error(`Unknown easing "${name}". Known: ${Object.keys(EASING_TABLE).join(', ')}`);
  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : fn(t));
}

/** Number of frames to write: round(duration * fps), at least 1. */
export function frameCount(animation: Pick<Animation, 'duration' | 'fps'>): number {
  return Math.max(1, Math.round(animation.duration * animation.fps));
}

/** Time in seconds of frame `i`: exactly i / fps. */
export function frameTime(i: number, animation: Pick<Animation, 'fps'>): number {
  return i / animation.fps;
}

/** True when any action targets something other than `view` or `style`, so frames need a rebuild. */
export function rebuildsGeometry(animation: Pick<Animation, 'actions'>): boolean {
  return animation.actions.some((a) => !RENDER_ONLY_TARGETS.has(a.action.target));
}

// ------------------------------------------------------------------ addressing

type Bag = Record<string, unknown>;

function isBag(x: unknown): x is Bag {
  return typeof x === 'object' && x !== null;
}

function rootOf(design: Design, target: string): Bag {
  const root: unknown = target === DESIGN_TARGET ? design : (design as unknown as Bag)[target];
  if (!isBag(root)) {
    throw new Error(`Unknown animation target "${target}": expected "${DESIGN_TARGET}" or a section of the design such as params, view, style`);
  }
  return root;
}

/** Find the container and key addressed by `property`. Throws naming the target and path. */
function locate(design: Design, target: string, property: string): { parent: Bag; key: string } {
  const path = property.split('.');
  let node = rootOf(design, target);
  path.slice(0, -1).forEach((segment, depth) => {
    const next = node[segment];
    if (!isBag(next)) {
      throw new Error(`Unknown property path "${property}" in target "${target}": no "${path.slice(0, depth + 1).join('.')}"`);
    }
    node = next;
  });
  const key = path[path.length - 1];
  if (!(key in node) && target !== OPEN_TARGET) {
    throw new Error(`Unknown property path "${property}" in target "${target}"`);
  }
  return { parent: node, key };
}

function readNumber(design: Design, target: string, property: string): number {
  const { parent, key } = locate(design, target, property);
  const value = parent[key];
  if (typeof value !== 'number') throw new Error(`Cannot tween "${target}.${property}": its value is not a number`);
  return value;
}

// ------------------------------------------------------------------ evaluation

function tweenValue(a: TweenAction, start: number, end: number, from: number, t: number): number {
  const span = end - start;
  const u = span > 0 ? (t - start) / span : t >= end ? 1 : 0;
  return from + (a.to_value - from) * ease(a.easing)(u);
}

/**
 * A new Design with every action applied at time `t` (seconds). The input is never mutated.
 * `set` holds from its start; `tween` interpolates between its start and end from `from_value`
 * (or the value in the input design when null) to `to_value`, and holds after. Actions that have
 * not started change nothing, but their addressing is still validated. Actions apply in order of
 * start time (stable), so later ones win on the same property.
 */
export function designAt(design: Design, t: number): Design {
  const out = structuredClone(design);
  const ordered = (design.animation?.actions ?? [])
    .map((fa, i) => ({ fa, i }))
    .sort((x, y) => x.fa.start - y.fa.start || x.i - y.i);
  for (const { fa } of ordered) {
    const a = fa.action;
    const { parent, key } = locate(out, a.target, a.property);
    if (a.kind === 'tween') {
      const from = a.from_value ?? readNumber(design, a.target, a.property);
      if (t >= fa.start) parent[key] = tweenValue(a, fa.start, fa.end, from, t);
    } else if (t >= fa.start) {
      parent[key] = structuredClone(a.value);
    }
  }
  return out;
}

// ------------------------------------------------------------------ builders

export interface TurntableOptions {
  seconds?: number;
  fps?: number;
  /** Full turns of the camera around the object. */
  turns?: number;
}

/** A looping animation that turns `view.azimuthDeg` by 360 * turns, linearly. */
export function turntable(design: Design, options: TurntableOptions = {}): Animation {
  const { seconds = DEFAULT_SECONDS, fps = DEFAULT_FPS, turns = 1 } = options;
  const from = design.view.azimuthDeg;
  return {
    fps,
    duration: seconds,
    loop: true,
    actions: [
      {
        start: 0,
        end: seconds,
        action: { kind: 'tween', target: 'view', property: 'azimuthDeg', from_value: from, to_value: from + FULL_TURN_DEG * turns, duration: seconds, easing: 'linear' },
      },
    ],
  };
}

export interface SweepOptions {
  /** Section of the design: `params`, `view`, `style` or `design`. */
  target: string;
  /** Dotted path inside the target. */
  property: string;
  from: number;
  to: number;
  seconds?: number;
  fps?: number;
  easing?: EasingName;
  /** Go there and back, so the loop has no jump. `seconds` is the whole round trip. */
  pingPong?: boolean;
}

function legTween(o: SweepOptions, start: number, end: number, from: number, to: number, easing: EasingName): FlatAction {
  return {
    start,
    end,
    action: { kind: 'tween', target: o.target, property: o.property, from_value: from, to_value: to, duration: end - start, easing },
  };
}

/** An animation sweeping one property from `from` to `to` (and back when `pingPong`). */
export function sweep(_design: Design, options: SweepOptions): Animation {
  const { seconds = DEFAULT_SECONDS, fps = DEFAULT_FPS, easing = 'ease_in_out', pingPong = false, from, to } = options;
  const mid = seconds * HALF;
  const actions = pingPong
    ? [legTween(options, 0, mid, from, to, easing), legTween(options, mid, seconds, to, from, easing)]
    : [legTween(options, 0, seconds, from, to, easing)];
  return { fps, duration: seconds, loop: true, actions };
}
