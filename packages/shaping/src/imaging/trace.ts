/**
 * From a mask to polygons: one contour extraction on one smoothed signed distance field.
 *
 * Grow, shrink and smooth are not three algorithms. The mask becomes a signed distance field
 * (positive inside), the field is blurred (`smooth`), and marching squares extracts the contour
 * at level `-grow`: a lower level thickens the shape, a higher one thins it. Contours are
 * interpolated to sub-pixel positions, saddles are resolved by the cell's mean, rings are
 * simplified with Ramer-Douglas-Peucker, holes are nested under the outer ring that contains them,
 * and the result goes through a 2D union in the kernel because simplified contours can touch.
 *
 * Output coordinates are pixels with y pointing UP (y = height - row); outer rings are
 * counter-clockwise and holes clockwise.
 */
import type { Kernel } from '../kernel/types.js';
import type { Mask, Polygon, Ring, Vec2 } from '../types.js';
import { gaussianBlur, signedDistanceField } from './morphology.js';

/** Dials of the contour extraction, in pixels of the working image. */
export interface TraceOptions {
  /** Thicken (> 0) or thin (< 0) the shape by this many pixels. */
  grow: number;
  /** Standard deviation of the Gaussian blur of the distance field. */
  smooth: number;
  /** Ramer-Douglas-Peucker tolerance. */
  simplify: number;
}

/** Empty margin around the mask so contours close, however far the shape is grown. */
const PAD_BASE = 2;
/** Blur radius in standard deviations, which the margin must also cover. */
const PAD_SIGMAS = 3;
/** Pixel centres sit half a pixel in from the pixel's corner. */
const HALF_PIXEL = 0.5;
/** A ring needs at least this many vertices to enclose an area. */
const MIN_RING_POINTS = 3;

/**
 * Contours of `field` at `level`, as closed rings in grid coordinates (x = column, y = row, at
 * pixel centres, y down). Inside is where `field > level`, and lies on the left of each ring as
 * seen on screen, so a ring around a shape is counter-clockwise once y is flipped up.
 * The field's outermost samples must be outside, so that every contour closes.
 */
export function marchingSquares(field: Float32Array, w: number, h: number, level: number): Ring[] {
  const horizontal = (w - 1) * h; // edge ids: horizontal edges first, then vertical ones
  const next = new Int32Array(horizontal + w * (h - 1)).fill(-1);
  const edgeTop = (i: number, j: number) => j * (w - 1) + i;
  const edgeBottom = (i: number, j: number) => (j + 1) * (w - 1) + i;
  const edgeLeft = (i: number, j: number) => horizontal + j * w + i;
  const edgeRight = (i: number, j: number) => horizontal + j * w + i + 1;

  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const a = field[j * w + i];
      const b = field[j * w + i + 1];
      const c = field[(j + 1) * w + i + 1];
      const d = field[(j + 1) * w + i];
      const bits = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
      if (bits === 0 || bits === 15) continue;
      const T = edgeTop(i, j), R = edgeRight(i, j), B = edgeBottom(i, j), L = edgeLeft(i, j);
      // The table below lists each segment with the inside on its right; rings run the other way
      // round, so that once y is flipped up the outer rings are counter-clockwise.
      const link = (from: number, to: number) => (next[to] = from);
      const connected = (a + b + c + d) / 4 > level; // saddles: is the centre inside?
      switch (bits) {
        case 1: link(T, L); break;
        case 2: link(R, T); break;
        case 3: link(R, L); break;
        case 4: link(B, R); break;
        case 5: connected ? (link(T, R), link(B, L)) : (link(T, L), link(B, R)); break;
        case 6: link(B, T); break;
        case 7: link(B, L); break;
        case 8: link(L, B); break;
        case 9: link(T, B); break;
        case 10: connected ? (link(L, T), link(R, B)) : (link(R, T), link(L, B)); break;
        case 11: link(R, B); break;
        case 12: link(L, R); break;
        case 13: link(T, R); break;
        case 14: link(L, T); break;
      }
    }
  }

  const crossing = (e: number): Vec2 => {
    if (e < horizontal) {
      const j = Math.floor(e / (w - 1));
      const i = e - j * (w - 1);
      const v0 = field[j * w + i];
      return [i + (level - v0) / (field[j * w + i + 1] - v0), j];
    }
    const k = e - horizontal;
    const j = Math.floor(k / w);
    const i = k - j * w;
    const v0 = field[j * w + i];
    return [i, j + (level - v0) / (field[(j + 1) * w + i] - v0)];
  };

  const rings: Ring[] = [];
  const seen = new Uint8Array(next.length);
  for (let start = 0; start < next.length; start++) {
    if (next[start] < 0 || seen[start]) continue;
    const ring: Ring = [];
    for (let e = start; e >= 0 && !seen[e]; e = next[e]) {
      seen[e] = 1;
      ring.push(crossing(e));
    }
    if (ring.length >= MIN_RING_POINTS) rings.push(ring);
  }
  return rings;
}

/** Signed area of a ring (positive when counter-clockwise, in y-up coordinates). */
export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2;
}

/** Area of a polygon: its outer ring minus its holes. */
export function polygonArea(p: Polygon): number {
  return Math.abs(signedArea(p.outer)) - p.holes.reduce((s, r) => s + Math.abs(signedArea(r)), 0);
}

function pointToLine(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0])) / len;
}

/** Ramer-Douglas-Peucker on a closed ring, anchored at vertex 0 and the vertex farthest from it. */
export function simplifyRing(ring: Ring, tolerance: number): Ring {
  const n = ring.length;
  if (tolerance <= 0 || n <= MIN_RING_POINTS) return ring;
  let far = 0;
  let best = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > best) [best, far] = [d, i];
  }
  const keep = new Uint8Array(n);
  keep[0] = keep[far] = 1;
  const at = (i: number) => ring[i % n];
  const stack: Array<[number, number]> = [[0, far], [far, n]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    let worst = -1;
    let index = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = pointToLine(at(i), at(lo), at(hi));
      if (d > worst) [worst, index] = [d, i];
    }
    if (worst > tolerance) {
      keep[index % n] = 1;
      stack.push([lo, index], [index, hi]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

function inRing(p: Vec2, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Group rings into polygons: counter-clockwise rings are outlines, clockwise rings are holes of the smallest outline containing them. */
export function nestRings(rings: Ring[]): Polygon[] {
  const outers = rings.filter((r) => signedArea(r) > 0).map((outer) => ({ outer, area: signedArea(outer), holes: [] as Ring[] }));
  outers.sort((a, b) => a.area - b.area); // smallest first: the first container found is the tightest
  for (const hole of rings.filter((r) => signedArea(r) < 0)) {
    const owner = outers.find((o) => o.area > -signedArea(hole) && inRing(hole[0], o.outer));
    if (owner) owner.holes.push(hole);
  }
  return outers.map(({ outer, holes }) => ({ outer, holes }));
}

/**
 * Trace a mask into polygons (pixel units, y up), before any 2D union. Holes are nested under
 * their outlines. Use `traceMask` for the finished, self-intersection-free result.
 */
export function traceRings(mask: Mask, opts: TraceOptions): Polygon[] {
  const { width: w, height: h } = mask;
  const pad = PAD_BASE + Math.ceil(Math.max(0, opts.grow) + PAD_SIGMAS * opts.smooth);
  const W = w + 2 * pad;
  const H = h + 2 * pad;
  const data = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) data.set(mask.data.subarray(y * w, (y + 1) * w), (y + pad) * W + pad);
  const field = gaussianBlur(signedDistanceField({ width: W, height: H, data }), W, H, opts.smooth);
  const toPlane = ([gx, gy]: Vec2): Vec2 => [gx - pad + HALF_PIXEL, h - (gy - pad + HALF_PIXEL)];
  const rings = marchingSquares(field, W, H, -opts.grow)
    .map((ring) => simplifyRing(ring.map(toPlane), opts.simplify))
    .filter((ring) => ring.length >= MIN_RING_POINTS);
  return nestRings(rings);
}

/** Trace a mask into clean polygons: contours, simplification, nesting, then a 2D union in the kernel. */
export function traceMask(mask: Mask, opts: TraceOptions, kernel: Kernel): Polygon[] {
  const polygons = traceRings(mask, opts);
  if (polygons.length === 0) return [];
  return kernel.scope(() => kernel.polygons(kernel.region(polygons)));
}
