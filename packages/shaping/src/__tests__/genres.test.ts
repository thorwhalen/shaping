import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { build, manifoldKernel, type Kernel } from '../index.js';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await manifoldKernel();
});

const example = (name: string) => JSON.parse(readFileSync(new URL(`../../../../examples/${name}.json`, import.meta.url), 'utf8'));
const design = (genre: string, sources: object, params: object = {}) => ({ version: 1, id: 't', genre, sources, params });
const shape = (shape: string, extra: object = {}) => ({ kind: 'shape', shape, ...extra });

describe('shadow blocks', () => {
  it('three convex figures give one piece and cast exactly their figures', async () => {
    const m = await build(design('shadow-blocks', { front: shape('circle'), side: shape('rect'), top: shape('polygon', { n: 6 }) }, { fit: 'stretch' }), { kernel });
    expect(m.diagnostics.pieces).toBe(1);
    expect(m.diagnostics.shadows).toHaveLength(3);
    for (const s of m.diagnostics.shadows!) {
      expect(s.extraArea / s.targetArea).toBeLessThan(1e-3);
      expect(s.missingShare).toBeLessThan(1e-3);
    }
    expect(Math.max(...[0, 1, 2].map((i) => m.diagnostics.bbox.max[i] - m.diagnostics.bbox.min[i]))).toBeCloseTo(50, 3);
    expect(kernel.liveCount()).toBe(0);
  });

  it('figures at different heights report the missing rows; a base bar does not fix a gap, a frame reports nothing extra', async () => {
    // Front: a bar in the upper half only. Side: full square. The top view (x, y) is a full square.
    const upper = { kind: 'polygons', figure: { units: 'unit', parts: [{ id: 'u', polygons: [{ outer: [[-1, 0], [1, 0], [1, 1], [-1, 1]], holes: [] }, { outer: [[-1, -1], [-0.9, -1], [-0.9, -0.9], [-1, -0.9]], holes: [] }] }] } };
    const lower = { kind: 'polygons', figure: { units: 'unit', parts: [{ id: 'l', polygons: [{ outer: [[-1, -1], [1, -1], [1, 0], [-1, 0]], holes: [] }, { outer: [[0.9, 0.9], [1, 0.9], [1, 1], [0.9, 1]], holes: [] }] }] } };
    const m = await build(design('shadow-blocks', { front: upper, side: lower, top: shape('rect') }, { fit: 'stretch', dropDust: 0 }), { kernel });
    const byslot = Object.fromEntries(m.diagnostics.shadows!.map((s) => [s.slot, s]));
    expect(byslot.front.missingShare).toBeGreaterThan(0.3);
    expect(byslot.side.missingShare).toBeGreaterThan(0.3);
    for (const s of m.diagnostics.shadows!) expect(s.extraArea / s.targetArea).toBeLessThan(1e-3);
    expect(m.diagnostics.regions.some((r) => r.role === 'missing')).toBe(true);
  });

  it('the example trip-let builds and every shadow is checked', async () => {
    const m = await build(example('triplet'), { kernel });
    expect(m.bodies.length).toBeGreaterThan(0);
    expect(m.diagnostics.shadows).toHaveLength(3);
    for (const s of m.diagnostics.shadows!) expect(s.extraArea / s.targetArea).toBeLessThan(1e-3);
    console.log('triplet', m.diagnostics.pieces, m.diagnostics.shadows!.map((s) => `${s.slot} ${(100 * s.missingShare).toFixed(1)}%`), m.diagnostics.warnings, m.diagnostics.buildMs);
  });
});

describe('turned components', () => {
  for (const kind of ['revolve', 'extrude', 'radial'] as const) {
    it(`${kind}: the kernel's cut on the declared plane gives back the figure`, async () => {
      const m = await build(design('turned', { figure: shape('star', { n: 5, ratio: 0.5 }) }, { axis: -1.2, transform: { kind } }), { kernel });
      expect(m.bodies).toHaveLength(1);
      expect(m.diagnostics.warnings.filter((w) => /differs/.test(w))).toEqual([]);
      expect(m.diagnostics.regions.some((r) => r.role === 'slice')).toBe(true);
      // Off the axis, a radial array is three separate slabs.
      expect(m.diagnostics.pieces).toBe(kind === 'radial' ? 3 : 1);
    });
  }

  it('a figure crossing the axis is clipped by default and refused on request', async () => {
    const clipped = await build(design('turned', { figure: shape('heart') }), { kernel });
    expect(clipped.bodies).toHaveLength(1);
    const refused = await build(design('turned', { figure: shape('heart') }, { transform: { kind: 'revolve', policy: 'refuse' } }), { kernel });
    expect(refused.bodies).toHaveLength(0);
    expect(refused.diagnostics.warnings.join(' ')).toMatch(/crosses the revolve axis/);
  });

  it('several parts become several coloured bodies; a base joins them', async () => {
    const text = { kind: 'text', text: 'HI' };
    const loose = await build(design('turned', { figure: text }, { transform: { kind: 'extrude' } }), { kernel });
    expect(loose.bodies).toHaveLength(2);
    expect(new Set(loose.bodies.map((b) => b.color)).size).toBe(2);
    expect(loose.diagnostics.pieces).toBe(2);
    const joined = await build(design('turned', { figure: text }, { transform: { kind: 'extrude' }, base: 'plate' }), { kernel });
    expect(joined.diagnostics.pieces).toBe(1);
  });
});

describe('design validation', () => {
  it('names the offending field', async () => {
    await expect(build({ version: 1, id: 'x', genre: 'turned', sources: { figure: { kind: 'nope' } } }, { kernel })).rejects.toThrow(/sources\.figure/);
    await expect(build(design('turned', { figure: shape('circle') }, { axis: 'left' }), { kernel })).rejects.toThrow(/axis/);
    await expect(build(design('no-such-genre', {}), { kernel })).rejects.toThrow(/Available: turned, shadow-blocks/);
  });
});

describe('gallery', () => {
  it('every example is a valid design that builds to something non-empty', async () => {
    const { readdirSync } = await import('node:fs');
    const dir = new URL('../../../../examples/', import.meta.url);
    const names = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(names.length).toBeGreaterThanOrEqual(5);
    for (const n of names) {
      const m = await build(JSON.parse(readFileSync(new URL(n, dir), 'utf8')), { kernel });
      expect(m.bodies.length, n).toBeGreaterThan(0);
      console.log(n, m.diagnostics.pieces, m.diagnostics.shadows?.map((s) => (100 * s.missingShare).toFixed(1)).join('/'), m.diagnostics.warnings.join(' | '), m.diagnostics.buildMs?.toFixed(0), 'ms');
    }
  });
});

describe('review regressions', () => {
  it('multi-body models write STL and PLY as one closed mesh', async () => {
    const { exportModel } = await import('../export/index.js');
    const { readStl, readPly, checkClosedMesh } = await import('../export/read.js');
    for (const name of ['framed-shapes', 'nested-rings']) {
      const m = await build(example(name), { kernel });
      expect(m.bodies.length, name).toBeGreaterThan(1);
      expect(checkClosedMesh(readStl(exportModel(m, 'stl'))).closed, `${name} stl`).toBe(true);
      expect(checkClosedMesh(readPly(exportModel(m, 'ply'))).closed, `${name} ply`).toBe(true);
    }
  });

  it('a base sunk into the parts is not reported as an overlap', async () => {
    const m = await build(example('nested-rings'), { kernel });
    expect(m.diagnostics.warnings.filter((w) => /overlaps/.test(w))).toEqual([]);
  });

  it('policy "both" on a part left of the axis keeps it on its own side (not mirrored)', async () => {
    const left = { kind: 'polygons', figure: { units: 'unit', parts: [{ id: 'L', polygons: [{ outer: [[-2, 0], [-1, 0], [-1, 1], [-1.5, 2]], holes: [] }] }] } };
    const both = await build(design('turned', { figure: left }, { axis: 1.2, transform: { kind: 'revolve', policy: 'both', angleDeg: 180 } }), { kernel });
    const clip = await build(design('turned', { figure: left }, { axis: 1.2, transform: { kind: 'revolve', policy: 'clip', angleDeg: 180 } }), { kernel });
    const slice = (m: typeof both) => m.diagnostics.regions.find((r) => r.role === 'slice')!;
    expect(slice(both).origin).toEqual(slice(clip).origin);
    expect(both.diagnostics.warnings.filter((w) => /differs/.test(w))).toEqual([]);
  });

  it('an empty model is refused by the 3D exporters', async () => {
    const { exportModel } = await import('../export/index.js');
    const empty = await build(design('turned', { figure: shape('heart') }, { transform: { kind: 'revolve', policy: 'refuse' } }), { kernel });
    expect(() => exportModel(empty, 'glb')).toThrow(/empty/);
  });
});

describe('buildKey', () => {
  it('ignores display-only fields and sees the ones the build reads', async () => {
    const { buildKey, parseDesign } = await import('../index.js');
    const d = parseDesign(example('triplet'));
    const k = buildKey(d);
    expect(buildKey({ ...d, view: { ...d.view, lightAzimuthDeg: 120, azimuthDeg: 200, camera: 'orthographic' } })).toBe(k);
    expect(buildKey({ ...d, style: { ...d.style, material: 'glass', opacity: 0.5 } })).toBe(k);
    expect(buildKey({ ...d, view: { ...d.view, wallGap: 1.5 } })).not.toBe(k);
    // Colours are display fields since the camera-pose change: the viewer and exporters recolour.
    expect(buildKey({ ...d, style: { ...d.style, color: '#000000', partColors: { x: '#fff' } } })).toBe(k);
    expect(buildKey({ ...d, view: { ...d.view, distance: 9, panX: 1, fovDeg: 20, zoom: 3 } })).toBe(k);
  });

  it('the build really ignores every field tagged render (guards the tags)', async () => {
    const { parseDesign } = await import('../index.js');
    const d = parseDesign(example('nested-rings'));
    const base = await build(d, { kernel });
    const changed = await build(
      { ...d, view: { ...d.view, camera: 'orthographic', azimuthDeg: 99, elevationDeg: -10, walls: false, ground: false, lightAzimuthDeg: 3, lightElevationDeg: 7, lightIntensity: 0.1, lightColor: '#ff0000', fillIntensity: 1, environmentIntensity: 1 }, style: { ...d.style, material: 'glass', opacity: 0.3, roughness: 0.9, metalness: 0.9, background: '#000000' } },
      { kernel },
    );
    expect(changed.bodies.map((b) => [b.color, b.positions.length])).toEqual(base.bodies.map((b) => [b.color, b.positions.length]));
    expect(changed.diagnostics.regions).toEqual(base.diagnostics.regions);
  });
});

describe('design migration', () => {
  it('a version-1 design keeps its shape: round is converted to the new meaning', async () => {
    const { parseDesign } = await import('../index.js');
    const v1 = { version: 1, id: 'm', genre: 'turned', sources: { figure: { kind: 'text', text: 'KO', round: 0.2 } } };
    const d = parseDesign(v1);
    expect(d.version).toBe(2);
    expect((d.sources.figure as { round: number }).round).toBeCloseTo(0.2 / 0.49, 6);
    const again = parseDesign(d);
    expect(again).toEqual(d);
  });
});

describe('recolor', () => {
  it('recolouring a model gives exactly the colours a build with that style gives', async () => {
    const { parseDesign, recolor } = await import('../index.js');
    const d = parseDesign(example('nested-rings'));
    const base = await build(d, { kernel });
    const style = { ...d.style, color: '#123456', partColors: { K1: '#abcdef' }, palette: false };
    const rebuilt = await build({ ...d, style }, { kernel });
    expect(recolor(base, style).bodies.map((b) => b.color)).toEqual(rebuilt.bodies.map((b) => b.color));
    expect(recolor(base, d.style)).toBe(base);
  });
});

describe('frames and blocks', () => {
  const small = { kind: 'drawing', width: 100, height: 100, objects: [{ tool: 'rect', points: [[0, 0], [20, 20]], size: 1, filled: true, erase: false }] };
  it('a small shape drawn in a corner stays small and in the corner (the page is the frame)', async () => {
    const { defaultResolvers } = await import('../imaging/index.js');
    const m = await build(design('shadow-blocks', { front: small, side: shape('rect'), top: shape('rect') }, { fit: 'stretch' }), { kernel, resolvers: defaultResolvers });
    const front = m.diagnostics.regions.find((r) => r.id === 'front:target')!;
    const xs = front.polygons.flatMap((p) => p.outer.map(([x]) => x));
    const ys = front.polygons.flatMap((p) => p.outer.map(([, y]) => y));
    const span = Math.max(...xs) - Math.min(...xs);
    // 20 of 100 drawing units: a fifth of the block's 50 mm, near its top-left corner.
    expect(span).toBeCloseTo(10, 0);
    expect(Math.min(...xs)).toBeCloseTo(-25, 0);
    expect(Math.max(...ys)).toBeCloseTo(25, 0);
  });

  it('"fit: content" fits the shape itself instead', async () => {
    const { defaultResolvers } = await import('../imaging/index.js');
    const d = { ...design('shadow-blocks', { front: small, side: shape('rect'), top: shape('rect') }, { fit: 'stretch' }), prepare: { front: { fit: 'content' } } };
    const m = await build(d, { kernel, resolvers: defaultResolvers });
    const xs = m.diagnostics.regions.find((r) => r.id === 'front:target')!.polygons.flatMap((p) => p.outer.map(([x]) => x));
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(50, 0);
  });

  it('box, cylinder and sphere blocks build with their proportions; slot frames follow them', async () => {
    const { shadowBlocks } = await import('../index.js');
    for (const blockShape of ['box', 'cylinder', 'sphere']) {
      const block = { shape: blockShape, width: 2, depth: 1, height: 1 };
      const m = await build(design('shadow-blocks', { front: shape('rect'), side: shape('rect'), top: shape('rect') }, { fit: 'stretch', block }), { kernel });
      const e = [0, 1, 2].map((i) => m.diagnostics.bbox.max[i] - m.diagnostics.bbox.min[i]);
      expect(e[0] / e[1], blockShape).toBeCloseTo(2, 1);
      expect(m.diagnostics.pieces, blockShape).toBe(1);
    }
    const params = shadowBlocks.params.parse({ block: { width: 2, depth: 1, height: 1 } });
    expect(shadowBlocks.slotFrame!(params, 'front')).toEqual([2, 1]);
    expect(shadowBlocks.slotFrame!(params, 'side')).toEqual([1, 1]);
  });
});

describe('switching genre', () => {
  it('switching away and back restores sources, preparation and dials', async () => {
    const { parseDesign, switchGenre, builtInGenres } = await import('../index.js');
    const d0 = parseDesign({ ...design('shadow-blocks', { front: { kind: 'text', text: 'X' }, side: shape('star'), top: shape('heart') }, { thicken: 0.1, frame: 'border' }), prepare: { front: { fit: 'content' } } });
    const turned = switchGenre(d0, 'turned', builtInGenres);
    expect(turned.genre).toBe('turned');
    const back = switchGenre(turned, 'shadow-blocks', builtInGenres);
    expect(back.sources).toEqual(d0.sources);
    expect(back.params).toEqual(d0.params);
    expect(back.prepare).toEqual(d0.prepare);
    expect(parseDesign(back).genreState?.turned).toBeDefined();
  });
});
