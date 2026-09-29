/**
 * The default kernel: Manifold (`manifold-3d`), a WebAssembly solid modeller whose every result is
 * a closed manifold by construction.
 *
 * This module owns three things callers must never see:
 * - memory: Manifold objects are not garbage-collected, so every object is tracked in the current
 *   scope and deleted when the scope ends;
 * - the top-scale gotcha: `extrude` must receive its top scale as a two-element array (a plain
 *   number gave a wedge in 3.5.4);
 * - polygon nesting: Manifold returns flat contour lists; they are regrouped into outer + holes.
 */
import type { Box3, Polygon, Ring, Vec2, Vec3 } from '../types.js';
import { ringArea } from '../geometry/ring.js';
import type { Affine3, ExtrudeOptions, JoinType, Kernel, MeshData, Region, RevolveOptions, Solid } from './types.js';

/* Minimal structural types for the parts of the Manifold module we use. */
interface MCrossSection {
  add(o: MCrossSection): MCrossSection;
  subtract(o: MCrossSection): MCrossSection;
  intersect(o: MCrossSection): MCrossSection;
  offset(delta: number, join?: string, miterLimit?: number, segs?: number): MCrossSection;
  translate(v: Vec2): MCrossSection;
  scale(v: Vec2 | number): MCrossSection;
  rotate(deg: number): MCrossSection;
  mirror(ax: Vec2): MCrossSection;
  simplify(eps?: number): MCrossSection;
  decompose(): MCrossSection[];
  toPolygons(): Vec2[][];
  area(): number;
  isEmpty(): boolean;
  bounds(): { min: Vec2 | { x: number; y: number }; max: Vec2 | { x: number; y: number } };
  extrude(h: number, n?: number, twist?: number, scaleTop?: Vec2, center?: boolean): MManifold;
  revolve(segs?: number, deg?: number): MManifold;
  delete(): void;
}
interface MManifold {
  add(o: MManifold): MManifold;
  subtract(o: MManifold): MManifold;
  intersect(o: MManifold): MManifold;
  translate(v: Vec3): MManifold;
  rotate(v: Vec3): MManifold;
  scale(v: Vec3 | number): MManifold;
  mirror(n: Vec3): MManifold;
  transform(m: number[]): MManifold;
  project(): MCrossSection;
  slice(z: number): MCrossSection;
  decompose(): MManifold[];
  isEmpty(): boolean;
  volume(): number;
  genus(): number;
  status(): unknown;
  boundingBox(): { min: Vec3 | { x: number; y: number; z: number }; max: Vec3 | { x: number; y: number; z: number } };
  getMesh(): { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array };
  delete(): void;
}
interface ManifoldModule {
  setup(): void;
  CrossSection: {
    new (contours: Vec2[][], fillRule?: string): MCrossSection;
    union(xs: MCrossSection[]): MCrossSection;
  };
  Manifold: {
    new (mesh: unknown): MManifold;
    union(xs: MManifold[]): MManifold;
    intersection(xs: MManifold[]): MManifold;
    cube(size: Vec3, center?: boolean): MManifold;
    compose(xs: MManifold[]): MManifold;
  };
  Mesh: new (opts: { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array }) => { merge(): boolean };
}

export interface LoadManifoldOptions {
  /**
   * Where the browser should fetch `manifold.wasm` from. In Node the file next to the module is
   * found on its own; in a bundled app pass the URL the bundler gives for the wasm asset.
   */
  wasmUrl?: string;
}

let modulePromise: Promise<ManifoldModule> | null = null;

async function loadModule(opts: LoadManifoldOptions): Promise<ManifoldModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const mod = (await import('manifold-3d')) as unknown as { default: (cfg?: object) => Promise<ManifoldModule> };
      const cfg = opts.wasmUrl ? { locateFile: () => opts.wasmUrl } : undefined;
      const wasm = await mod.default(cfg);
      wasm.setup();
      return wasm;
    })();
  }
  return modulePromise;
}

const xy = (p: Vec2 | { x: number; y: number }): Vec2 => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y]);
const xyz = (p: Vec3 | { x: number; y: number; z: number }): Vec3 => (Array.isArray(p) ? [p[0], p[1], p[2]] : [p.x, p.y, p.z]);

/** Regroup a flat list of contours of ONE connected component into an outer ring and holes. */
function nestComponent(contours: Vec2[][]): Polygon | null {
  if (contours.length === 0) return null;
  let outerIdx = 0;
  let best = -Infinity;
  contours.forEach((c, i) => {
    const a = ringArea(c);
    if (a > best) {
      best = a;
      outerIdx = i;
    }
  });
  const toRing = (c: Vec2[]): Ring => c.map((p) => [p[0], p[1]] as Vec2);
  return {
    outer: toRing(contours[outerIdx]),
    holes: contours.filter((_, i) => i !== outerIdx).map(toRing),
  };
}

/**
 * Create the Manifold kernel. Loads the WebAssembly module once per process (or worker).
 */
export async function manifoldKernel(opts: LoadManifoldOptions = {}): Promise<Kernel> {
  const wasm = await loadModule(opts);
  const { CrossSection, Manifold, Mesh } = wasm;
  const scopes: Array<Array<{ delete(): void }>> = [];
  let live = 0;

  function track<T extends { delete(): void }>(x: T): T {
    const scope = scopes[scopes.length - 1];
    if (!scope) {
      x.delete();
      throw new Error('shaping kernel: geometry operations must run inside kernel.scope(() => ...)');
    }
    scope.push(x);
    live++;
    return x;
  }
  const cs = (r: Region) => r as unknown as MCrossSection;
  const mf = (s: Solid) => s as unknown as MManifold;
  const R = (x: MCrossSection) => track(x) as unknown as Region;
  const S = (x: MManifold) => track(x) as unknown as Solid;

  function polygonToCs(p: Polygon): MCrossSection {
    return track(new CrossSection([p.outer, ...p.holes], 'EvenOdd'));
  }

  const kernel: Kernel = {
    name: 'manifold',

    scope<T>(fn: () => T): T {
      const mine: Array<{ delete(): void }> = [];
      scopes.push(mine);
      try {
        return fn();
      } finally {
        scopes.pop();
        for (const x of mine) x.delete();
        live -= mine.length;
      }
    },

    region(polygons) {
      const valid = polygons.filter((p) => p.outer.length >= 3);
      if (valid.length === 0) return R(new CrossSection([], 'Positive'));
      const parts = valid.map(polygonToCs);
      return (parts.length === 1 ? parts[0] : track(CrossSection.union(parts))) as unknown as Region;
    },
    contours(rings, rule = 'nonzero') {
      const valid = rings.filter((r) => r.length >= 3);
      return R(new CrossSection(valid, rule === 'nonzero' ? 'NonZero' : 'EvenOdd'));
    },
    polygons(r) {
      return cs(r)
        .decompose()
        .map((c) => {
          track(c);
          return nestComponent(c.toPolygons());
        })
        .filter((p): p is Polygon => p !== null);
    },
    area: (r) => cs(r).area(),
    bounds2(r) {
      const b = cs(r).bounds();
      return { min: xy(b.min), max: xy(b.max) };
    },
    isEmpty2: (r) => cs(r).isEmpty(),
    union2: (rs) => (rs.length === 0 ? R(new CrossSection([], 'Positive')) : R(CrossSection.union(rs.map(cs)))),
    intersect2: (a, b) => R(cs(a).intersect(cs(b))),
    subtract2: (a, b) => R(cs(a).subtract(cs(b))),
    offset2(r, delta, join: JoinType = 'round') {
      const joinName = { round: 'Round', miter: 'Miter', square: 'Square' }[join];
      return R(cs(r).offset(delta, joinName, 2));
    },
    transform2(r, m) {
      let x = cs(r);
      const step = (y: MCrossSection) => (x = track(y));
      if (m.mirrorX) step(x.mirror([1, 0]));
      if (m.mirrorY) step(x.mirror([0, 1]));
      if (m.scale !== undefined) step(x.scale(typeof m.scale === 'number' ? [m.scale, m.scale] : m.scale));
      if (m.rotateDeg) step(x.rotate(m.rotateDeg));
      if (m.translate) step(x.translate(m.translate));
      return (x === cs(r) ? R(x.add(x)) : x) as unknown as Region;
    },
    components2: (r) => cs(r).decompose().map(R),
    simplify2: (r, eps) => R(cs(r).simplify(eps)),

    extrude(r, height, o: ExtrudeOptions = {}) {
      const scaleTop: Vec2 = o.scaleTop ?? [1, 1]; // always an array: see the module docstring
      return S(cs(r).extrude(height, o.divisions ?? 0, o.twistDeg ?? 0, [scaleTop[0], scaleTop[1]], o.center ?? false));
    },
    revolve(r, o: RevolveOptions = {}) {
      return S(cs(r).revolve(o.segments ?? 96, o.angleDeg ?? 360));
    },

    empty: () => S(Manifold.union([])),
    union: (ss) => (ss.length === 0 ? kernel.empty() : S(Manifold.union(ss.map(mf)))),
    intersect: (ss) => (ss.length === 0 ? kernel.empty() : S(Manifold.intersection(ss.map(mf)))),
    subtract: (a, b) => S(mf(a).subtract(mf(b))),
    translate: (s, v) => S(mf(s).translate(v)),
    rotate: (s, deg) => S(mf(s).rotate(deg)),
    scale: (s, f) => S(mf(s).scale(f)),
    mirror: (s, n) => S(mf(s).mirror(n)),
    transform: (s, m: Affine3) => S(mf(s).transform([...m.slice(0, 3), 0, ...m.slice(3, 6), 0, ...m.slice(6, 9), 0, ...m.slice(9, 12), 1])),
    box: (size, center = false) => S(Manifold.cube(size, center)),
    project: (s) => R(mf(s).project()),
    slice: (s, z) => R(mf(s).slice(z)),
    decompose: (s) => mf(s).decompose().map(S),
    isEmpty: (s) => mf(s).isEmpty(),
    volume: (s) => mf(s).volume(),
    genus: (s) => mf(s).genus(),
    bbox(s): Box3 {
      if (mf(s).isEmpty()) return { min: [0, 0, 0], max: [0, 0, 0] };
      const b = mf(s).boundingBox();
      return { min: xyz(b.min), max: xyz(b.max) };
    },
    mesh(s): MeshData {
      const m = mf(s).getMesh();
      const n = m.vertProperties.length / m.numProp;
      const positions = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        positions[3 * i] = m.vertProperties[m.numProp * i];
        positions[3 * i + 1] = m.vertProperties[m.numProp * i + 1];
        positions[3 * i + 2] = m.vertProperties[m.numProp * i + 2];
      }
      return { positions, indices: new Uint32Array(m.triVerts) };
    },
    fromMesh(m) {
      const mesh = new Mesh({ numProp: 3, vertProperties: new Float32Array(m.positions), triVerts: new Uint32Array(m.indices) });
      mesh.merge();
      return S(new Manifold(mesh));
    },
    liveCount: () => live,
  };
  return kernel;
}
