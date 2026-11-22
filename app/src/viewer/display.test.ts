import { describe, expect, it } from 'vitest';
import { recolor, type Model } from 'shaping';
import { creasedDisplay, displayBuffers, displayGeometry, displayOf, modelDisplays, rememberDisplays } from './display';

/** A unit cube, indexed: 8 corners, 12 triangles. */
function cube(): { positions: Float32Array; indices: Uint32Array } {
  const p = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
  const f = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  return { positions: new Float32Array(p), indices: new Uint32Array(f) };
}

const model = (): Model => ({ bodies: [{ partId: 'a', color: '#000000', ...cube() }] }) as unknown as Model;

describe('display data', () => {
  it('creases a cube: every corner splits into one vertex per face, normals axis-aligned', () => {
    const d = creasedDisplay(cube().positions, cube().indices);
    expect(d.positions.length).toBe(36 * 3);
    expect(d.normals.length).toBe(36 * 3);
    for (let i = 0; i < d.normals.length; i += 3) {
      const n = [...d.normals.slice(i, i + 3)].map(Math.abs).sort();
      expect(n[2]).toBeCloseTo(1);
    }
  });

  it('a recoloured body finds the display the worker sent; a body from elsewhere is creased here', () => {
    const m = model();
    const sent = modelDisplays(m);
    rememberDisplays(m, sent);
    const coloured = recolor(m, { color: '#ff0000', partColors: {}, palette: 'single' } as never);
    expect(coloured.bodies[0]).not.toBe(m.bodies[0]); // a new body object, same arrays
    expect(displayOf(coloured.bodies[0])).toBe(sent[0]);
    const other = model();
    expect(displayOf(other.bodies[0])).not.toBe(sent[0]);
    expect(displayOf(other.bodies[0]).normals.length).toBe(sent[0].normals.length);
  });

  it('wraps the arrays without copying, and lists every buffer to transfer', () => {
    const [d] = modelDisplays(model());
    const g = displayGeometry(d);
    expect(g.getAttribute('normal').array).toBe(d.normals);
    expect(displayBuffers([d])).toEqual([d.positions.buffer, d.normals.buffer]);
  });

  it('ignores displays that do not match the model', () => {
    const m = model();
    rememberDisplays(m, []);
    rememberDisplays(m, undefined);
    expect(displayOf(m.bodies[0]).positions.length).toBe(108);
  });
});
