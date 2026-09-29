/** Tests for `shaping/animate`: easings, evaluation, immutability, looping and addressing errors. */
import { describe, expect, it } from 'vitest';
import { DesignSchema, type Design } from '../design.js';
import { designAt, ease, frameCount, frameTime, rebuildsGeometry, sweep, turntable, type EasingName } from '../animate/index.js';

const NAMES: EasingName[] = ['linear', 'ease_in', 'ease_out', 'ease_in_out'];

function base(): Design {
  return DesignSchema.parse({ version: 1, id: 'd', genre: 'g', sources: {}, params: { placement: { front: { scale: 1 } } } });
}
function withAnim(d: Design, animation: Design['animation']): Design {
  return { ...d, animation };
}

describe('ease', () => {
  it.each(NAMES)('%s hits its endpoints and stays in range', (n) => {
    const f = ease(n);
    expect(f(0)).toBe(0);
    expect(f(1)).toBe(1);
    expect(f(-1)).toBe(0);
    expect(f(2)).toBe(1);
    expect(f(0.5)).toBeGreaterThanOrEqual(0);
  });
  it('ease_in_out is symmetric about the middle', () => {
    expect(ease('ease_in_out')(0.5)).toBeCloseTo(0.5);
    expect(ease('ease_in_out')(0.25) + ease('ease_in_out')(0.75)).toBeCloseTo(1);
  });
});

describe('designAt', () => {
  const b = base();
  const d = withAnim(b, sweep(b, { target: 'view', property: 'azimuthDeg', from: 0, to: 100, seconds: 2, fps: 10, easing: 'linear' }));
  it('start, middle, end and hold', () => {
    expect(designAt(d, 0).view.azimuthDeg).toBe(0);
    expect(designAt(d, 1).view.azimuthDeg).toBeCloseTo(50);
    expect(designAt(d, 2).view.azimuthDeg).toBe(100);
    expect(designAt(d, 9).view.azimuthDeg).toBe(100);
  });
  it('never mutates the input', () => {
    const before = JSON.stringify(d);
    designAt(d, 1);
    expect(JSON.stringify(d)).toBe(before);
  });
  it('null from_value uses the input design value; nested paths and set work', () => {
    const anim = {
      fps: 10, duration: 2, loop: false,
      actions: [
        { start: 0, end: 2, action: { kind: 'tween' as const, target: 'params', property: 'placement.front.scale', to_value: 3, from_value: null, duration: 2, easing: 'linear' as const } },
        { start: 1, end: 1, action: { kind: 'set' as const, target: 'design', property: 'sizeMm', value: 80, at: 0 } },
      ],
    };
    const dd = withAnim(base(), anim);
    expect((designAt(dd, 1).params as any).placement.front.scale).toBeCloseTo(2);
    expect(designAt(dd, 0.5).sizeMm).toBe(50);
    expect(designAt(dd, 1).sizeMm).toBe(80);
  });
  it('names a bad path and a bad target', () => {
    const bad = (target: string, property: string) => withAnim(base(), sweep(base(), { target, property, from: 0, to: 1 }));
    expect(() => designAt(bad('view', 'nope.deep'), 0)).toThrow(/nope\.deep/);
    expect(() => designAt(bad('view', 'nope'), 0)).toThrow(/nope/);
    expect(() => designAt(bad('wat', 'x'), 0)).toThrow(/wat/);
  });
  it('is deterministic', () => {
    expect(designAt(d, 0.7)).toEqual(designAt(d, 0.7));
  });
});

describe('builders', () => {
  it('60-frame turntable: frame 60 would equal frame 0, so there is no jump', () => {
    const b = base();
    const anim = turntable(b, { seconds: 2.5, fps: 24, turns: 1 });
    expect(frameCount(anim)).toBe(60);
    const d = withAnim(b, anim);
    const az = (i: number) => designAt(d, frameTime(i, anim)).view.azimuthDeg;
    expect(az(0)).toBe(b.view.azimuthDeg);
    expect(az(60) - az(0)).toBeCloseTo(360);
    expect(az(59)).toBeLessThan(az(0) + 360);
    expect(turntable(b, { turns: 2 }).actions[0].action).toMatchObject({ to_value: b.view.azimuthDeg + 720 });
  });
  it('pingPong is symmetric and returns to its start', () => {
    const b = base();
    const anim = sweep(b, { target: 'view', property: 'elevationDeg', from: 10, to: 60, seconds: 2, fps: 20, pingPong: true });
    const d = withAnim(b, anim);
    const n = frameCount(anim);
    const v = (i: number) => designAt(d, frameTime(i, anim)).view.elevationDeg;
    expect(v(0)).toBe(10);
    expect(v(n / 2)).toBe(60);
    for (let i = 1; i < n / 2; i++) expect(v(i)).toBeCloseTo(v(n - i));
  });
  it('rebuildsGeometry only for targets other than view/style', () => {
    const b = base();
    expect(rebuildsGeometry(turntable(b))).toBe(false);
    expect(rebuildsGeometry(sweep(b, { target: 'style', property: 'opacity', from: 1, to: 0.5 }))).toBe(false);
    expect(rebuildsGeometry(sweep(b, { target: 'params', property: 'x', from: 0, to: 1 }))).toBe(true);
    expect(rebuildsGeometry(sweep(b, { target: 'design', property: 'sizeMm', from: 1, to: 2 }))).toBe(true);
  });
});
