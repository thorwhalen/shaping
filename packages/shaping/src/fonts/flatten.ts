/**
 * Turn a glyph's path (lines, quadratic and cubic Béziers) into closed polygons, y up, in ems.
 *
 * Curves are flattened adaptively: each curve gets as many segments as its own flatness needs to
 * stay within `tolerance` of the true curve, so a straight-ish curve costs two points and a tight
 * one costs many.
 */
import type { PathCommand } from 'opentype.js';
import type { Ring, Vec2 } from '../types.js';

/** Largest distance between a flattened curve and the true one, in ems. */
export const FLATNESS_EM = 0.0004;
/** No curve is split into more segments than this, however tight. */
const MAX_SEGMENTS = 48;
/** Contours with fewer points than this are not areas. */
const MIN_RING_POINTS = 3;
/** Cubic flatness bound: segments = ceil(sqrt(3 * d / (4 * tolerance))) for second difference d. */
const CUBIC_FACTOR = 3 / 4;
/** Quadratic flatness bound: segments = ceil(sqrt(d / (4 * tolerance))) for second difference d. */
const QUADRATIC_FACTOR = 1 / 4;

const segmentsFor = (secondDifference: number, factor: number, tolerance: number): number =>
  Math.min(MAX_SEGMENTS, Math.max(1, Math.ceil(Math.sqrt((secondDifference * factor) / tolerance))));

const norm = (x: number, y: number) => Math.hypot(x, y);

function quadratic(from: Vec2, c: Vec2, to: Vec2, tolerance: number): Vec2[] {
  const n = segmentsFor(norm(from[0] - 2 * c[0] + to[0], from[1] - 2 * c[1] + to[1]), QUADRATIC_FACTOR, tolerance);
  const out: Vec2[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * from[0] + 2 * u * t * c[0] + t * t * to[0], u * u * from[1] + 2 * u * t * c[1] + t * t * to[1]]);
  }
  return out;
}

function cubic(from: Vec2, c1: Vec2, c2: Vec2, to: Vec2, tolerance: number): Vec2[] {
  const d1 = norm(from[0] - 2 * c1[0] + c2[0], from[1] - 2 * c1[1] + c2[1]);
  const d2 = norm(c1[0] - 2 * c2[0] + to[0], c1[1] - 2 * c2[1] + to[1]);
  const n = segmentsFor(Math.max(d1, d2), CUBIC_FACTOR, tolerance);
  const out: Vec2[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push([a * from[0] + b * c1[0] + c * c2[0] + d * to[0], a * from[1] + b * c1[1] + c * c2[1] + d * to[1]]);
  }
  return out;
}

/**
 * Flatten a path (font units, y up) into rings scaled by `scale` (em per unit) and moved by
 * `offset` ems. Rings with fewer than three points are dropped.
 */
export function flattenPath(commands: PathCommand[], scale: number, offset: Vec2 = [0, 0], tolerance = FLATNESS_EM): Ring[] {
  const rings: Ring[] = [];
  let ring: Ring = [];
  let cur: Vec2 = [0, 0];
  const pt = (x: number, y: number): Vec2 => [x * scale + offset[0], y * scale + offset[1]];
  const close = () => {
    if (ring.length >= MIN_RING_POINTS) rings.push(ring);
    ring = [];
  };
  for (const c of commands) {
    switch (c.type) {
      case 'M':
        close();
        cur = pt(c.x!, c.y!);
        ring = [cur];
        break;
      case 'L':
        cur = pt(c.x!, c.y!);
        ring.push(cur);
        break;
      case 'Q': {
        const pts = quadratic(cur, pt(c.x1!, c.y1!), pt(c.x!, c.y!), tolerance);
        ring.push(...pts);
        cur = pts[pts.length - 1];
        break;
      }
      case 'C': {
        const pts = cubic(cur, pt(c.x1!, c.y1!), pt(c.x2!, c.y2!), pt(c.x!, c.y!), tolerance);
        ring.push(...pts);
        cur = pts[pts.length - 1];
        break;
      }
      case 'Z':
        close();
        break;
    }
  }
  close();
  return rings;
}
