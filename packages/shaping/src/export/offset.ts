/**
 * Polygon offset for laser kerf: a miter offset of simple polygons.
 *
 * Every edge moves sideways by the offset; adjacent offset edges are joined at their
 * intersection (a miter). Where a corner is so sharp that the miter would be longer than
 * `MITER_LIMIT` times the offset, the corner is bevelled instead.
 *
 * Limits: the input must be simple (no self-intersection). The offset is exact for convex
 * corners and for small offsets. It does not resolve collisions between distant parts of the
 * outline, so an offset larger than half the thinnest feature can self-intersect; a ring whose
 * orientation flips (it collapsed) is dropped, and so is a polygon whose outer ring collapses.
 * Kerf is a fraction of a millimetre in practice, well inside these limits.
 */
import type { Polygon, Ring } from '../types.js';

/** Longest miter, as a multiple of the offset distance, before a corner is bevelled. */
export const MITER_LIMIT = 4;

/** Signed area of a ring (positive when counter-clockwise). */
export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** The ring with the requested orientation (reversed when needed). */
export function orient(ring: Ring, counterClockwise: boolean): Ring {
  return signedArea(ring) > 0 === counterClockwise ? ring : [...ring].reverse();
}

/**
 * Move a ring to the right of its direction of travel by `dist` (negative: to the left).
 * For a counter-clockwise outer ring that is outward; for a clockwise hole it is towards the
 * hole's centre, which is what growing the material means. Null when an edge reverses direction
 * (the ring collapsed through itself).
 */
function shiftRight(ring: Ring, dist: number): Ring | null {
  const n = ring.length;
  const normals = ring.map((p, i) => {
    const q = ring[(i + 1) % n];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    return [dy / len, -dx / len] as const;
  });
  const atVertex: Ring[] = ring.map(([x, y], i) => {
    const n0 = normals[(i + n - 1) % n];
    const n1 = normals[i];
    const dot = n0[0] * n1[0] + n0[1] * n1[1];
    const miterRatio = Math.sqrt(2 / Math.max(1 + dot, 1e-12));
    if (miterRatio > MITER_LIMIT) return [[x + dist * n0[0], y + dist * n0[1]], [x + dist * n1[0], y + dist * n1[1]]];
    const k = dist / (1 + dot);
    return [[x + k * (n0[0] + n1[0]), y + k * (n0[1] + n1[1])]];
  });
  for (let i = 0; i < n; i++) {
    const from = atVertex[i][atVertex[i].length - 1];
    const to = atVertex[(i + 1) % n][0];
    const along = (to[0] - from[0]) * (ring[(i + 1) % n][0] - ring[i][0]) + (to[1] - from[1]) * (ring[(i + 1) % n][1] - ring[i][1]);
    if (along <= 0) return null;
  }
  return atVertex.flat();
}

/** Grow the material of a polygon by `dist` mm (outer out, holes in). Negative shrinks it. Null if it collapses. */
export function offsetPolygon(polygon: Polygon, dist: number): Polygon | null {
  if (dist === 0) return polygon;
  const outer = orient(polygon.outer, true);
  const grown = shiftRight(outer, dist);
  if (!grown || grown.length < 3 || signedArea(grown) * signedArea(outer) <= 0) return null;
  const holes: Ring[] = [];
  for (const hole of polygon.holes) {
    const h = orient(hole, false);
    const moved = shiftRight(h, dist);
    // A hole that shrank through its own centre has flipped orientation: it closed up, drop it.
    if (moved && moved.length >= 3 && signedArea(moved) * signedArea(h) > 0) holes.push(moved);
  }
  return { outer: grown, holes };
}
