/**
 * Tests for `toAnTimeline`: its output against `an`'s published contract (`@thorwhalen/an-contract`:
 * `timeline.schema.json` and `easing.json`, read from the package, never copied), the curve of
 * every easing it writes, its meaning (evaluated and compared with `designAt`), and what happens to
 * `fps` and `loop`.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { DesignSchema, EASINGS, type Animation, type Design, type FlatAction } from '../design.js';
import { designAt, ease, sweep, toAnTimeline, turntable, type AnAction, type AnTimeline } from '../animate/index.js';
import { EASING_PIECES } from '../animate/an-timeline.js';

const require = createRequire(import.meta.url);
const contract = (file: string) => JSON.parse(readFileSync(require.resolve(`@thorwhalen/an-contract/${file}`), 'utf8'));
const TIMELINE_SCHEMA = contract('timeline.schema.json');
const EASING_TABLE: { sample_u: number[]; entries: Array<{ name: string; samples: number[] }>; parametric: Array<{ spec: string; solver: string; samples: number[] }> } =
  contract('easing.json');
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(TIMELINE_SCHEMA);

const TOL = 1e-9;
const BISECTIONS = 80;

function expectValid(doc: AnTimeline) {
  const ok = validate(doc);
  expect(validate.errors ?? [], JSON.stringify(validate.errors)).toEqual([]);
  expect(ok).toBe(true);
}

// ------------------------------------------------------------------ an's curves, evaluated here

/** A `cubic-bezier(x1, y1, x2, y2)` spec as a curve, solved by bisection on x(s) = u. */
function bezierCurve(spec: string): (u: number) => number {
  const m = /^cubic-bezier\((.*)\)$/.exec(spec);
  if (!m) throw new Error(`not a cubic-bezier spec: ${spec}`);
  const [x1, y1, x2, y2] = m[1].split(',').map(Number);
  expect([x1, y1, x2, y2].every(Number.isFinite)).toBe(true);
  expect(x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1, `${spec}: x controls in [0, 1]`).toBe(true);
  const b = (p1: number, p2: number, s: number) => 3 * (1 - s) ** 2 * s * p1 + 3 * (1 - s) * s ** 2 * p2 + s ** 3;
  return (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < BISECTIONS; i++) {
      const mid = (lo + hi) / 2;
      if (b(x1, x2, mid) < u) lo = mid;
      else hi = mid;
    }
    return b(y1, y2, (lo + hi) / 2);
  };
}

const NAMES = new Set(EASING_TABLE.entries.map((e) => e.name));

/** An easing as `an` reads it: a name of `easing.json` (sampled at `sample_u` only) or a Bézier spec. */
function anCurve(easing: unknown): (u: number) => number {
  if (easing === null || easing === 'linear') return (u) => Math.min(1, Math.max(0, u));
  if (typeof easing === 'string' && easing.startsWith('cubic-bezier(')) return bezierCurve(easing);
  throw new Error(`no evaluator in this test for easing ${JSON.stringify(easing)}`);
}

describe('the easings toAnTimeline writes', () => {
  it('the Bézier evaluator of this test reproduces an\'s own samples', () => {
    const cases = EASING_TABLE.parametric.filter((p) => p.solver === 'css-bezier-newton-bisection');
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      const f = bezierCurve(c.spec);
      // 5 digits: cubic-bezier(1, 0, 0, 1) is vertical at u = 0.5, where any solver's last bit of x moves y by ~1e-6.
      EASING_TABLE.sample_u.forEach((u, i) => expect(f(u), `${c.spec} at ${u}`).toBeCloseTo(c.samples[i], 5));
    }
  });

  it('every name written exists in easing.json, every spec is a cubic-bezier with x in [0, 1]', () => {
    for (const pieces of Object.values(EASING_PIECES))
      for (const p of pieces) {
        if (p.easing.startsWith('cubic-bezier(')) bezierCurve(p.easing);
        else expect(NAMES, p.easing).toContain(p.easing);
      }
  });

  it('a named easing is used whole, so its easing.json samples are its curve; they match shaping', () => {
    for (const [name, pieces] of Object.entries(EASING_PIECES))
      for (const p of pieces.filter((q) => !q.easing.startsWith('cubic-bezier('))) {
        expect(p).toMatchObject({ t0: 0, t1: 1, v0: 0, v1: 1 });
        const entry = EASING_TABLE.entries.find((e) => e.name === p.easing)!;
        EASING_TABLE.sample_u.forEach((u, i) => expect(entry.samples[i]).toBeCloseTo(ease(name as (typeof EASINGS)[number])(u), 9));
      }
  });

  it.each(EASINGS)('%s: the pieces draw exactly shaping\'s curve', (name) => {
    const pieces = EASING_PIECES[name];
    expect(pieces[0].t0).toBe(0);
    expect(pieces[pieces.length - 1].t1).toBe(1);
    const drawn = (u: number) => {
      const p = pieces.find((q) => u <= q.t1) ?? pieces[pieces.length - 1];
      const local = (u - p.t0) / (p.t1 - p.t0);
      return p.v0 + (p.v1 - p.v0) * anCurve(p.easing)(local);
    };
    const us = [...EASING_TABLE.sample_u, ...Array.from({ length: 101 }, (_, i) => i / 100)];
    for (const u of us) expect(Math.abs(drawn(u) - ease(name)(u)), `${name} at ${u}`).toBeLessThan(TOL);
  });

  it('shaping\'s names are not an\'s curves (an\'s ease_in_out is quadratic), so they are never written as names', () => {
    const quad = EASING_TABLE.entries.find((e) => e.name === 'ease_in_out')!;
    const at = EASING_TABLE.sample_u.indexOf(0.25);
    expect(quad.samples[at]).toBeCloseTo(0.125);
    expect(ease('ease_in_out')(0.25)).toBeCloseTo(0.0625);
    const written = Object.values(EASING_PIECES).flatMap((ps) => ps.map((p) => p.easing));
    for (const n of ['ease_in', 'ease_out', 'ease_in_out']) expect(written).not.toContain(n);
  });
});

// ------------------------------------------------------------------ representative tracks

function base(): Design {
  return DesignSchema.parse({ version: 3, id: 'd', genre: 'g', sources: {}, params: { placement: { front: { scale: 1 } } } });
}

const tween = (start: number, end: number, target: string, property: string, to: number, from: number | null, easing: (typeof EASINGS)[number] | null): FlatAction => ({
  start,
  end,
  action: { kind: 'tween', target, property, to_value: to, from_value: from, duration: end - start, easing },
});
const set = (start: number, target: string, property: string, value: unknown): FlatAction => ({ start, end: start, action: { kind: 'set', target, property, value, at: 0 } });

/** Every action kind and easing shaping has, nested paths, sets of numbers and strings, and the design pseudo-target. */
function representative(): Animation {
  return {
    fps: 30,
    duration: 6,
    loop: false,
    actions: [
      tween(0, 2, 'view', 'azimuthDeg', 200, 10, 'linear'),
      tween(0, 3, 'view', 'elevationDeg', 60, 5, 'ease_in_out'),
      tween(1, 4, 'params', 'placement.front.scale', 3, null, 'ease_in'),
      tween(2, 5, 'style', 'opacity', 0.2, 1, 'ease_out'),
      tween(0, 6, 'view', 'distance', 8, null, null),
      tween(3, 6, 'view', 'panX', 2, 0.5, 'ease_in_out'),
      set(1.5, 'design', 'sizeMm', 80),
      set(2.5, 'style', 'color', '#123456'),
      set(2, 'view', 'azimuthDeg', 123), // touches the azimuth tween's end: allowed, and the set wins at t = 2 in both
    ],
  };
}

/** Adds a tween with no from_value after another action moved the same property (needs the design). */
function withRetween(): Animation {
  const t = representative();
  return { ...t, actions: [...t.actions, tween(4, 6, 'view', 'azimuthDeg', 0, null, 'ease_in_out')] };
}

// ------------------------------------------------------------------ evaluating the timeline here

function parseAddress(address: string): { target: string; path: string[] } {
  const [left, field] = address.split(':');
  const target = left.split('/').pop()!;
  return { target, path: field.split('.') };
}

function readIn(design: Design, target: string, path: string[]): unknown {
  const root = target === 'design' ? design : (design as unknown as Record<string, unknown>)[target];
  return path.reduce<unknown>((node, k) => (node as Record<string, unknown>)[k], root);
}

/**
 * The value at `address` and time `t` by an's rule, ported from `evaluate_timeline` in an's
 * `an/timing/timeline.py`: a row playing at `t` (inclusive end) is active, and the later active row
 * wins; otherwise an ended row holds its end value, the latest end winning (a tie to the later
 * row); otherwise the address is at rest (here: its value in the design). An absent `from` is the
 * value the earlier rows give at the row's start.
 */
function evaluate(doc: AnTimeline, design: Design, address: string, t: number): unknown {
  const rows = doc.actions.filter((r) => r.address === address);
  const { target, path } = parseAddress(address);
  const rest = readIn(design, target, path);
  const rowValue = (j: number, time: number): unknown => {
    const r = rows[j];
    if (r.change.kind === 'set') return r.change.value;
    const from = 'from' in r.change ? (r.change.from as number) : (poseAt(j, r.start) as number);
    return from + ((r.change.to as number) - from) * anCurve(r.change.easing)((time - r.start) / (r.end - r.start));
  };
  const poseAt = (k: number, time: number): unknown => {
    let active: { value: unknown } | undefined;
    let held: { end: number; value: unknown } | undefined;
    rows.slice(0, k).forEach((r, j) => {
      if (r.start <= time && time <= r.end) active = { value: rowValue(j, time) };
      else if (time > r.end && (!held || r.end >= held.end)) held = { end: r.end, value: rowValue(j, r.end) };
    });
    return active ? active.value : held ? held.value : rest;
  };
  return poseAt(rows.length, t);
}

function expectSameMeaning(track: Animation, doc: AnTimeline, design: Design) {
  const d = { ...design, animation: track };
  const addresses = [...new Set(doc.actions.map((r) => r.address))];
  for (let i = 0; i <= 120; i++) {
    const t = (track.duration * i) / 120;
    const shaped = designAt(d, t);
    for (const a of addresses) {
      const { target, path } = parseAddress(a);
      const want = readIn(shaped, target, path);
      const got = evaluate(doc, design, a, t);
      if (typeof want === 'number') expect(Math.abs((got as number) - want), `${a} at t=${t}`).toBeLessThan(TOL * 100);
      else expect(got, `${a} at t=${t}`).toEqual(want);
    }
  }
}

describe('toAnTimeline', () => {
  const design = base();
  const track = representative();

  it('validates against timeline.schema.json, with and without the design and an entity', () => {
    expectValid(toAnTimeline(track));
    expectValid(toAnTimeline(withRetween(), { design }));
    expectValid(toAnTimeline(withRetween(), { design, entity: 'vase' }));
    expectValid(toAnTimeline(turntable(design)));
    expectValid(toAnTimeline(sweep(design, { target: 'params', property: 'placement.front.scale', from: 1, to: 2, pingPong: true })));
    expectValid(toAnTimeline({ fps: 24, duration: 1, loop: true, actions: [] }));
  });

  it('on tracks without overlaps, an\'s rule evaluated at 121 times equals designAt', () => {
    expectSameMeaning(track, toAnTimeline(track), design);
    expectSameMeaning(withRetween(), toAnTimeline(withRetween(), { design }), design);
    const looping = sweep(design, { target: 'view', property: 'elevationDeg', from: 10, to: 60, seconds: 2, pingPong: true });
    expectSameMeaning(looping, toAnTimeline(looping), design);
  });

  it('writes set, and tween with and without from', () => {
    const doc = toAnTimeline(track);
    const byAddress = (a: string) => doc.actions.filter((r) => r.address === a);
    expect(byAddress('design:sizeMm')).toEqual([{ start: 1.5, end: 1.5, address: 'design:sizeMm', change: { kind: 'set', value: 80 } }]);
    expect(byAddress('style:color')[0].change).toEqual({ kind: 'set', value: '#123456' });
    expect(byAddress('view:azimuthDeg')[0].change).toEqual({ kind: 'tween', from: 10, to: 200, easing: 'linear' });
    expect(byAddress('params:placement.front.scale')[0].change).toEqual({ kind: 'tween', to: 3, easing: EASING_PIECES.ease_in[0].easing });
    expect(byAddress('view:distance')[0].change).toEqual({ kind: 'tween', to: 8, easing: 'linear' });
  });

  it('with the design, a null from_value is written as the value in the design (shaping\'s rule)', () => {
    const doc = toAnTimeline(track, { design });
    expect(doc.actions.find((r) => r.address === 'params:placement.front.scale')!.change).toMatchObject({ from: 1 });
    expect(doc.actions.find((r) => r.address === 'view:distance')!.change).toMatchObject({ from: design.view.distance });
  });

  it('splits ease_in_out into two halves of the time and of the change', () => {
    const rows = toAnTimeline(track).actions.filter((r) => r.address === 'view:elevationDeg');
    expect(rows).toEqual([
      { start: 0, end: 1.5, address: 'view:elevationDeg', change: { kind: 'tween', from: 5, to: 32.5, easing: EASING_PIECES.ease_in_out[0].easing } },
      { start: 1.5, end: 3, address: 'view:elevationDeg', change: { kind: 'tween', from: 32.5, to: 60, easing: EASING_PIECES.ease_in_out[1].easing } },
    ]);
  });

  it('refuses an ease_in_out tween with no from_value and no design, naming the remedy', () => {
    expect(() => toAnTimeline(withRetween())).toThrow(/action 9.*pass \{ design \}/);
    const bare: Animation = { fps: 24, duration: 1, loop: false, actions: [tween(0, 1, 'view', 'zoom', 2, null, 'ease_in_out')] };
    expect(() => toAnTimeline(bare)).toThrow(/action 0.*pass \{ design \}/);
    expect(toAnTimeline(bare, { design }).actions.map((r) => r.change)).toMatchObject([{ from: 1 }, { from: 1.5, to: 2 }]);
  });

  it('nests the design under an entity: sections become nodes', () => {
    const addresses = toAnTimeline(track, { design, entity: 'vase' }).actions.map((r) => r.address);
    expect(addresses).toContain('vase/params:placement.front.scale');
    expect(addresses).toContain('vase/view:azimuthDeg');
    expect(addresses).toContain('vase/design:sizeMm');
  });

  it('refuses names the address grammar cannot hold, naming the action and the name', () => {
    const one = (target: string, property: string): Animation => ({ fps: 24, duration: 1, loop: false, actions: [set(0, target, property, 1)] });
    expect(() => toAnTimeline(one('params', 'mouth@happy'))).toThrow(/action 0.*"mouth@happy" contains "@"/);
    expect(() => toAnTimeline(one('params', 'a..b'))).toThrow(/property segment "" is empty/);
    expect(() => toAnTimeline(one('vi:ew', 'x'))).toThrow(/target "vi:ew" contains ":"/);
    expect(() => toAnTimeline(one('params', ' x'))).toThrow(/whitespace/);
    expect(() => toAnTimeline(one('params', 'x'), { entity: 'a/b' })).toThrow(/entity "a\/b" contains "\/"/);
  });

  it('carries duration; drops fps and loop (an\'s timeline has no place for them)', () => {
    for (const t of [track, turntable(design, { fps: 12, seconds: 3 })]) {
      const doc = toAnTimeline(t);
      expect(Object.keys(doc).sort()).toEqual(['actions', 'duration', 'format', 'version']);
      expect(doc).toMatchObject({ format: 'an.timeline', version: 1, duration: t.duration });
      expect(doc).not.toHaveProperty('fps');
      expect(doc).not.toHaveProperty('loop');
    }
  });

  it('writes actions in the order designAt applies them (halves of a split tween together), and never mutates its inputs', () => {
    const listed: Animation = {
      fps: 24,
      duration: 4,
      loop: false,
      actions: [tween(2, 4, 'style', 'opacity', 0, 1, 'linear'), tween(0, 2, 'view', 'elevationDeg', 60, 0, 'ease_in_out'), set(1, 'design', 'sizeMm', 70)],
    };
    const reversed: Animation = { ...listed, actions: [...listed.actions].reverse() };
    const before = JSON.stringify([listed, reversed, design]);
    const rows = (a: Animation) => toAnTimeline(a, { design }).actions.map((r: AnAction) => [r.address, r.start, r.end]);
    const want = [['view:elevationDeg', 0, 1], ['view:elevationDeg', 1, 2], ['design:sizeMm', 1, 1], ['style:opacity', 2, 4]];
    expect(rows(listed)).toEqual(want);
    expect(rows(reversed)).toEqual(want);
    expect(JSON.stringify([listed, reversed, design])).toBe(before);
  });

  it('refuses overlapping actions on one address, naming both (an holds active over held, shaping the last started)', () => {
    const two = (a: FlatAction, b: FlatAction): Animation => ({ fps: 24, duration: 4, loop: false, actions: [a, b] });
    const overlaps = /action 1 \((tween|set) over .*\) overlaps animation action 0 .* on "view:zoom"/;
    // an inner tween inside an outer one: at t = 3 shaping shows -50, an 75
    expect(() => toAnTimeline(two(tween(0, 4, 'view', 'zoom', 100, 0, 'linear'), tween(1, 2, 'view', 'zoom', -50, 0, 'linear')))).toThrow(overlaps);
    // a set in the middle of a tween: at t = 2 shaping shows 99, an 20
    expect(() => toAnTimeline(two(tween(0, 3, 'view', 'zoom', 30, 0, 'linear'), set(1.5, 'view', 'zoom', 99)))).toThrow(overlaps);
    // the same start, the shorter one listed later
    expect(() => toAnTimeline(two(tween(0, 4, 'view', 'zoom', 100, 0, 'linear'), tween(0, 2, 'view', 'zoom', 5, 0, 'linear')))).toThrow(overlaps);
    // a set at a tween's start, listed after it (it would win for good in shaping, only at the instant in an)
    expect(() => toAnTimeline(two(tween(0, 2, 'view', 'zoom', 3, 1, 'linear'), set(0, 'view', 'zoom', 9)))).toThrow(overlaps);
    // touching at an instant is fine, in either kind
    expect(() => toAnTimeline(two(tween(0, 2, 'view', 'zoom', 3, 1, 'linear'), tween(2, 4, 'view', 'zoom', 1, 3, 'ease_in_out')))).not.toThrow();
    expect(() => toAnTimeline(two(set(0, 'view', 'zoom', 9), tween(0, 2, 'view', 'zoom', 3, 1, 'linear')))).not.toThrow();
    // other addresses may overlap freely
    expect(() => toAnTimeline(two(tween(0, 4, 'view', 'zoom', 3, 1, 'linear'), tween(1, 2, 'view', 'panX', 1, 0, 'linear')))).not.toThrow();
  });

  it('why: the inner-tween track means different things under the two rules', () => {
    const doc: AnTimeline = {
      format: 'an.timeline',
      version: 1,
      actions: [
        { start: 0, end: 4, address: 'view:zoom', change: { kind: 'tween', from: 0, to: 100, easing: 'linear' } },
        { start: 1, end: 2, address: 'view:zoom', change: { kind: 'tween', from: 0, to: -50, easing: 'linear' } },
      ],
    };
    const track: Animation = { fps: 24, duration: 4, loop: false, actions: [tween(0, 4, 'view', 'zoom', 100, 0, 'linear'), tween(1, 2, 'view', 'zoom', -50, 0, 'linear')] };
    expect(evaluate(doc, design, 'view:zoom', 3)).toBeCloseTo(75);
    expect(designAt({ ...design, animation: track }, 3).view.zoom).toBeCloseTo(-50);
  });

  it('refuses spans an cannot play: a tween needs end > start, a set end >= start', () => {
    const one = (a: FlatAction): Animation => ({ fps: 24, duration: 4, loop: false, actions: [a] });
    expect(() => toAnTimeline(one(tween(1, 1, 'view', 'zoom', 2, 1, 'linear')))).toThrow(/action 0: tween over \[1, 1\]: a tween needs end > start/);
    expect(() => toAnTimeline(one(tween(2, 1, 'view', 'zoom', 2, 1, 'linear')))).toThrow(/end > start/);
    expect(() => toAnTimeline(one({ start: 2, end: 1, action: { kind: 'set', target: 'view', property: 'zoom', value: 1, at: 0 } }))).toThrow(/action 0: set over \[2, 1\]: a set needs end >= start/);
  });
});
