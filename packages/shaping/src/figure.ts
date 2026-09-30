/**
 * Plain-data operations on figures (no kernel needed), and the one place a figure is cleaned by
 * the kernel before a genre sees it.
 */
import type { Kernel, Region } from './kernel/types.js';
import { ringArea } from './geometry/ring.js';
import type { Figure, Part, Polygon, Ring, Vec2 } from './types.js';

export interface Bounds2 {
  min: Vec2;
  max: Vec2;
}

export function polygonsBounds(polys: Polygon[]): Bounds2 | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys)
    for (const [x, y] of p.outer) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  return x0 === Infinity ? null : { min: [x0, y0], max: [x1, y1] };
}

export function figureBounds(f: Figure): Bounds2 | null {
  return polygonsBounds(f.parts.flatMap((p) => p.polygons));
}

/** Apply `p -> p * s + t` to every point of a figure. */
export function mapFigure(f: Figure, fn: (p: Vec2) => Vec2): Figure {
  const ringMap = (r: Ring): Ring => r.map(fn);
  const frame = f.frame ? cornersBounds(fn(f.frame.min), fn(f.frame.max)) : undefined;
  return {
    units: f.units,
    ...(frame ? { frame } : {}),
    parts: f.parts.map((part) => ({
      ...part,
      polygons: part.polygons.map((pg) => ({ outer: ringMap(pg.outer), holes: pg.holes.map(ringMap) })),
    })),
  };
}

const cornersBounds = (a: Vec2, b: Vec2): Bounds2 => ({ min: [Math.min(a[0], b[0]), Math.min(a[1], b[1])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1])] });

/** What a figure is fitted by: its frame when it has one, else its parts' bounding box. */
export function fitBounds(f: Figure): Bounds2 | null {
  return f.frame ?? figureBounds(f);
}

/**
 * Centre a figure's frame (or, without one, its bounding box) on the origin and scale it into a
 * rectangle of `size` (a number for a square): `contain` keeps proportions, `stretch` fills it.
 */
export function fitFigure(f: Figure, size: number | Vec2 = 2, mode: 'contain' | 'stretch' = 'contain'): Figure {
  const b = fitBounds(f);
  if (!b) return f;
  const [tw, th] = typeof size === 'number' ? [size, size] : size;
  const w = b.max[0] - b.min[0] || 1;
  const h = b.max[1] - b.min[1] || 1;
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  const s = Math.min(tw / w, th / h);
  const sx = mode === 'stretch' ? tw / w : s;
  const sy = mode === 'stretch' ? th / h : s;
  return { ...mapFigure(f, ([x, y]) => [(x - cx) * sx, (y - cy) * sy]), units: 'unit' };
}

/** Make outer rings counter-clockwise and holes clockwise. */
export function orientPolygon(p: Polygon): Polygon {
  const ccw = (r: Ring) => (ringArea(r) < 0 ? [...r].reverse() : r);
  const cw = (r: Ring) => (ringArea(r) > 0 ? [...r].reverse() : r);
  return { outer: ccw(p.outer), holes: p.holes.map(cw) };
}

/** Area of a figure's polygons, holes subtracted (assumes no overlaps). */
export function figureArea(f: Figure): number {
  let a = 0;
  for (const part of f.parts)
    for (const p of part.polygons) a += Math.abs(ringArea(p.outer)) - p.holes.reduce((s, h) => s + Math.abs(ringArea(h)), 0);
  return a;
}

/**
 * Round every corner of a region with radius `radius`: convex corners by an opening (shrink, then
 * grow) and concave corners by a closing (grow, then shrink). A radius of half a stroke's width
 * rounds its tip completely. Must run inside a kernel scope.
 */
export function roundRegion(kernel: Kernel, r: Region, radius: number): Region {
  if (radius <= 0) return r;
  const opened = kernel.offset2(kernel.offset2(r, -radius, 'round'), radius, 'round');
  return kernel.offset2(kernel.offset2(opened, radius, 'round'), -radius, 'round');
}

/** The union of all parts as one region. Must run inside a kernel scope. */
export function figureRegion(kernel: Kernel, f: Figure): Region {
  return kernel.region(f.parts.flatMap((p) => p.polygons));
}

/**
 * Clean every part with a 2D union (tracing and smoothing can make contours cross themselves), drop
 * empty parts, and make parts disjoint (earlier parts win). Must run inside a kernel scope.
 */
export function cleanFigure(kernel: Kernel, f: Figure): Figure {
  let taken: Region | null = null;
  const parts: Part[] = [];
  for (const part of f.parts) {
    let r = kernel.region(part.polygons);
    if (taken) r = kernel.subtract2(r, taken);
    if (kernel.isEmpty2(r)) continue;
    taken = taken ? kernel.union2([taken, r]) : r;
    parts.push({ ...part, polygons: kernel.polygons(r) });
  }
  return { units: f.units, parts, ...(f.frame ? { frame: f.frame } : {}) };
}
