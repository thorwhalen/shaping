import { beforeAll, describe, expect, it } from 'vitest';
import { manifoldKernel, type Kernel } from '../core.js';

let k: Kernel;
beforeAll(async () => {
  k = await manifoldKernel();
});

const rect = (w: number, h: number) => [{ outer: [[0, 0], [w, 0], [w, h], [0, h]] as [number, number][], holes: [] }];

describe('kernel', () => {
  it('extrudes a 1 x 2 rectangle by 3 to volume 6, and frees everything', () => {
    const before = k.liveCount();
    const v = k.scope(() => k.volume(k.extrude(k.region(rect(1, 2)), 3)));
    expect(v).toBeCloseTo(6, 6);
    expect(k.liveCount()).toBe(before);
  });

  it('keeps holes and nests contours back into outer + holes', () => {
    const polys = k.scope(() =>
      k.polygons(k.region([{ outer: [[-2, -2], [2, -2], [2, 2], [-2, 2]], holes: [[[-1, -1], [-1, 1], [1, 1], [1, -1]]] }])),
    );
    expect(polys).toHaveLength(1);
    expect(polys[0].holes).toHaveLength(1);
  });

  it('passes the top scale as an array (a plain number gave a wedge)', () => {
    const v = k.scope(() => k.volume(k.extrude(k.region(rect(2, 2)), 1, { scaleTop: [0.5, 0.5] })));
    // A frustum of a square pyramid: h/3 (A1 + A2 + sqrt(A1 A2)) = 1/3 (4 + 1 + 2).
    expect(v).toBeCloseTo(7 / 3, 3);
  });

  it('revolves by Pappus: volume = angle x area x centroid distance', () => {
    const v = k.scope(() => k.volume(k.revolve(k.region([{ outer: [[1, 0], [2, 0], [2, 1], [1, 1]], holes: [] }]), { segments: 256 })));
    expect(v).toBeCloseTo(2 * Math.PI * 1 * 1.5, 1);
  });

  it('refuses operations outside a scope', () => {
    expect(() => k.region(rect(1, 1))).toThrow(/scope/);
  });
});
