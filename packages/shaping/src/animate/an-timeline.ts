/**
 * Export an animation track as `an`'s authored flat timeline (`an.timeline`, version 1).
 *
 * shaping stores tracks in the older, IR-shaped flat actions of `an` (`{start, end, action: {kind,
 * target, property, ...}}` inside `{fps, duration, loop, actions}`). `an`'s timing contract now
 * reads `{format: "an.timeline", version: 1, duration?, actions: [{start, end, address, change}]}`,
 * described by `timeline.schema.json` in the `@thorwhalen/an-contract` package. The stored format
 * is unchanged (saved designs keep loading); `toAnTimeline` converts on the way out. A test
 * validates its output against the package's schema and checks every easing against its
 * `easing.json`; this module itself reads nothing from the package at run time.
 *
 * ```ts
 * import { toAnTimeline, turntable } from 'shaping/animate';
 * const doc = toAnTimeline(turntable(design));   // {format: 'an.timeline', version: 1, ...}
 * ```
 *
 * What maps to what:
 *
 * - **Address.** `<target>:<property>`, the same lowering `an` applies to its own flat actions:
 *   `view:azimuthDeg`, `params:placement.front.scale` (a dotted property stays a dotted field),
 *   `design:sizeMm`. With `entity`, the design is that entity and its sections are nodes of it:
 *   `vase/view:azimuthDeg`. A name the grammar cannot hold (empty, or containing `:`, `/`, `@`,
 *   or leading or trailing whitespace) is refused, naming the action.
 * - **set.** `{kind: "set", value}` from `start`. The stored `at` is dropped (`designAt` ignores it).
 * - **tween.** `{kind: "tween", from?, to, easing}` over `[start, end]`. The stored `duration` is
 *   dropped (it repeats `end - start`, which is what `designAt` uses).
 * - **from.** A stored `from_value` is written. A null one means, in shaping, "the value in the
 *   input design"; in `an` an absent `from` means "the value the property has at `start`". Pass
 *   `design` and the exporter reads the value from it (the same rule as `designAt`) and writes it,
 *   so the timeline means exactly what the track means. Without `design`, `from` is left out, which
 *   means the same unless an earlier action changed that property before the tween starts.
 * - **easing.** Always written, as the `an` easing that draws the same curve (`AN_EASING_PIECES`).
 *   shaping's easings are cubic; `an`'s `ease_in`, `ease_out` and `ease_in_out` are quadratic, so
 *   the names are not reused. `linear` (and null) is `an`'s `linear`; `ease_in` (u^3) and `ease_out`
 *   (1 - (1 - u)^3) are exact cubic Béziers; `ease_in_out` (cubic, in two halves) is written as two
 *   tweens, the cubic ease-in over the first half of the time and of the change, the cubic ease-out
 *   over the second. Splitting needs the starting value, so an `ease_in_out` tween with a null
 *   `from_value` needs `design`, and is refused without it.
 * - **duration** is written as the timeline's `duration`.
 * - **fps** is dropped: it is how often frames are sampled when rendering, not timing. `an`'s
 *   timeline is continuous in seconds and whoever renders it picks the frame rate.
 * - **loop** is dropped: `an`'s timeline has no loop flag. A looping track says that frame
 *   `round(duration * fps)` would equal frame 0 (shaping writes frames at `i / fps` and never the one
 *   at `duration`); the exported timeline plays once over `[0, duration]`, and repeating it is the
 *   player's choice. Both are on the track for a caller that needs to pass them along.
 *
 * Actions are written in the order `designAt` applies the track's actions (by start time, stable);
 * the two halves of a split tween stay together, in place of their action.
 */
import type { Animation, Design, EASINGS, FlatAction } from '../design.js';
import { readNumber } from './address.js';

export const AN_TIMELINE_FORMAT = 'an.timeline' as const;
export const AN_TIMELINE_VERSION = 1 as const;

/** An easing in `an`'s timeline: null (linear), a name or spec from `easing.json`, or a Bézier list. */
export type AnEasing = string | null | readonly [number, number, number, number];

export type AnChange = { kind: 'set'; value: unknown } | { kind: 'tween'; from?: unknown; to: unknown; easing: AnEasing };

/** One row of the authored flat timeline: a change to one address over `[start, end]` seconds. */
export interface AnAction {
  start: number;
  end: number;
  /** `<entity>[/<node>…]:<field>[@<qualifier>]`, the field possibly dotted. */
  address: string;
  change: AnChange;
}

/** `an`'s authored flat timeline (`timeline.schema.json` in `@thorwhalen/an-contract`). */
export interface AnTimeline {
  format: typeof AN_TIMELINE_FORMAT;
  version: typeof AN_TIMELINE_VERSION;
  duration?: number;
  actions: AnAction[];
}

type ShapingEasing = (typeof EASINGS)[number];
type TweenAction = Extract<FlatAction['action'], { kind: 'tween' }>;

/**
 * One piece of a shaping easing drawn in `an`: over the share `[t0, t1]` of the tween's time, the
 * value goes from the share `v0` to `v1` of its change, through `an`'s `easing`.
 */
export interface AnEasingPiece {
  t0: number;
  t1: number;
  v0: number;
  v1: number;
  easing: string;
}

const HALF = 0.5;
/** A CSS cubic Bézier, which `an` solves to well below 1e-9 (`css-bezier-newton-bisection`). */
const bezier = (x1: number, y1: number, x2: number, y2: number) => `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
/**
 * With x controls 1/3 and 2/3 a cubic Bézier has x(s) = s, so its y controls are the Bernstein
 * coefficients of the curve: u^3 is (0, 0, 0, 1) and 1 - (1 - u)^3 is (0, 1, 1, 1).
 */
const CUBIC_IN = bezier(1 / 3, 0, 2 / 3, 0);
const CUBIC_OUT = bezier(1 / 3, 1, 2 / 3, 1);
const whole = (easing: string): AnEasingPiece[] => [{ t0: 0, t1: 1, v0: 0, v1: 1, easing }];

/** Each shaping easing as the `an` easings that draw exactly its curve (see the module docstring). */
export const AN_EASING_PIECES: Readonly<Record<ShapingEasing, readonly AnEasingPiece[]>> = {
  linear: whole('linear'),
  ease_in: whole(CUBIC_IN),
  ease_out: whole(CUBIC_OUT),
  ease_in_out: [
    { t0: 0, t1: HALF, v0: 0, v1: HALF, easing: CUBIC_IN },
    { t0: HALF, t1: 1, v0: HALF, v1: 1, easing: CUBIC_OUT },
  ],
};

export interface ToAnTimelineOptions {
  /** The design the track animates: resolves null `from_value`s exactly (see the module docstring). */
  design?: Design;
  /** Name of the entity the design is in an `an` scene: its sections become nodes (`vase/view:azimuthDeg`). */
  entity?: string;
}

const RESERVED = [':', '/', '@'];

function nameProblem(name: string): string | null {
  if (!name) return 'is empty';
  if (name !== name.trim()) return 'has leading or trailing whitespace';
  const bad = RESERVED.find((c) => name.includes(c));
  return bad ? `contains "${bad}"` : null;
}

function anAddress(target: string, property: string, entity: string | undefined, where: string): string {
  const names: Array<[string, string]> = [
    ...(entity === undefined ? [] : ([['entity', entity]] as Array<[string, string]>)),
    ['target', target],
    ...property.split('.').map((p): [string, string] => ['property segment', p]),
  ];
  for (const [what, name] of names) {
    const problem = nameProblem(name);
    if (problem) throw new Error(`${where}: cannot write an address for "${target}.${property}": the ${what} "${name}" ${problem}`);
  }
  return `${entity === undefined ? '' : `${entity}/`}${target}:${property}`;
}

function tweenRows(a: TweenAction, start: number, end: number, address: string, design: Design | undefined, where: string): AnAction[] {
  const pieces = AN_EASING_PIECES[a.easing ?? 'linear'];
  if (!pieces) throw new Error(`${where}: unknown easing "${a.easing}". Known: ${Object.keys(AN_EASING_PIECES).join(', ')}`);
  const from = a.from_value ?? (design ? readNumber(design, a.target, a.property) : null);
  if (from === null && pieces.length > 1) {
    throw new Error(`${where}: a "${a.easing}" tween of "${a.target}.${a.property}" without from_value is split in two, which needs its start value: pass { design }`);
  }
  const span = end - start;
  const valueAt = (v: number) => (v === 1 ? a.to_value : (from as number) + (a.to_value - (from as number)) * v);
  return pieces.map((p) => ({
    start: p.t0 === 0 ? start : start + span * p.t0,
    end: p.t1 === 1 ? end : start + span * p.t1,
    address,
    change: { kind: 'tween', ...(from === null && p.v0 === 0 ? {} : { from: p.v0 === 0 ? from : valueAt(p.v0) }), to: valueAt(p.v1), easing: p.easing },
  }));
}

/**
 * The track as `an`'s authored flat timeline, ready for `timeline.schema.json`. Pure: the track
 * and the design are never mutated. See the module docstring for how each field maps, and what
 * happens to `fps` and `loop`.
 */
export function toAnTimeline(track: Animation, options: ToAnTimelineOptions = {}): AnTimeline {
  const { design, entity } = options;
  const ordered = track.actions.map((fa, i) => ({ fa, i })).sort((x, y) => x.fa.start - y.fa.start || x.i - y.i);
  const actions = ordered.flatMap(({ fa, i }): AnAction[] => {
    const where = `animation action ${i}`;
    const a = fa.action;
    const address = anAddress(a.target, a.property, entity, where);
    if (a.kind === 'set') return [{ start: fa.start, end: fa.end, address, change: { kind: 'set', value: structuredClone(a.value) } }];
    return tweenRows(a, fa.start, fa.end, address, design, where);
  });
  return { format: AN_TIMELINE_FORMAT, version: AN_TIMELINE_VERSION, duration: track.duration, actions };
}
