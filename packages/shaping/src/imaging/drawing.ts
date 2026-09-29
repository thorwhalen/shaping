/**
 * From a drawing (a list of objects) to a `Figure`, without rasterising.
 *
 * Pen strokes follow `perfect-freehand`'s stroke model (smoothing, streamlining and pressure, the
 * optional third number of a point). Its own outline can cross itself, and the kernel would read
 * the crossings as holes, so each stroke is built as a union of discs and tapered quads along the
 * smoothed points, which is simple by construction. A line is a chain of capsules of width `size`; rectangles and ellipses are
 * filled or outlined with width `size`, given by two opposite corners. Objects apply in order:
 * everything that is not an eraser is unioned, erasers are subtracted. Drawing coordinates are y
 * down and are flipped up using the drawing's height. The parts are the connected components of
 * the result, largest first, in `unit` units.
 */
import { getStrokePoints } from 'perfect-freehand';
import type { DrawingSource, DrawObject } from '../design.js';
import type { Kernel, Region } from '../kernel/types.js';
import type { Figure, Polygon, Ring, Vec2 } from '../types.js';
import { partId, type ImagingContext } from './figure.js';
import { polygonArea } from './trace.js';

/** Vertices per half circle of a capsule end. */
const CAP_SEGMENTS = 12;
/** Vertices of an ellipse outline. */
const ELLIPSE_SEGMENTS = 96;
/** Pen behaviour handed to `perfect-freehand` (its own defaults, made explicit). */
export const PEN_OPTIONS = { thinning: 0.5, smoothing: 0.5, streamline: 0.5, last: true } as const;
/** Pressure of a point that has none: with it, the stroke has the constant width `size`. */
const NEUTRAL_PRESSURE = 0.5;
/** No pen point is thinner than this share of `size`. */
const MIN_RADIUS_SHARE = 0.05;

type Point = readonly number[];

/** A capsule (a segment thickened to `width`) as a counter-clockwise ring. */
export function capsuleRing(a: Vec2, b: Vec2, width: number): Ring {
  const r = width / 2;
  const theta = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const ring: Ring = [];
  for (let i = 0; i <= CAP_SEGMENTS; i++) {
    const t = theta - Math.PI / 2 + (Math.PI * i) / CAP_SEGMENTS;
    ring.push([b[0] + r * Math.cos(t), b[1] + r * Math.sin(t)]);
  }
  for (let i = 0; i <= CAP_SEGMENTS; i++) {
    const t = theta + Math.PI / 2 + (Math.PI * i) / CAP_SEGMENTS;
    ring.push([a[0] + r * Math.cos(t), a[1] + r * Math.sin(t)]);
  }
  return ring;
}

const ellipseRing = (cx: number, cy: number, rx: number, ry: number): Ring =>
  Array.from({ length: ELLIPSE_SEGMENTS }, (_, i): Vec2 => {
    const t = (2 * Math.PI * i) / ELLIPSE_SEGMENTS;
    return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];
  });

const rectRing = (x0: number, y0: number, x1: number, y1: number): Ring => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** A filled shape, or its outline of the given width as an outer ring with a hole. */
function shapePolygons(outer: Ring, inner: Ring | null): Polygon[] {
  return [{ outer, holes: inner ? [[...inner].reverse()] : [] }];
}

const discRing = (c: Vec2, r: number): Ring => ellipseRing(c[0], c[1], r, r);

/** A pen stroke as discs at the smoothed points and quads between them, radius following pressure. */
export function penPolygons(points: number[][], size: number): Polygon[] {
  const withPressure = points.map((p) => [p[0], p[1], p[2] ?? NEUTRAL_PRESSURE]);
  const stroke = getStrokePoints(withPressure, { ...PEN_OPTIONS, size, simulatePressure: false });
  const radius = (pressure: number) => Math.max(MIN_RADIUS_SHARE * size, size * (0.5 - PEN_OPTIONS.thinning * (0.5 - pressure)));
  const out: Polygon[] = stroke.map((s) => ({ outer: discRing(s.point as Vec2, radius(s.pressure)), holes: [] }));
  for (let i = 1; i < stroke.length; i++) {
    const [a, b] = [stroke[i - 1], stroke[i]];
    const [ra, rb] = [radius(a.pressure), radius(b.pressure)];
    const theta = Math.atan2(b.point[1] - a.point[1], b.point[0] - a.point[0]) + Math.PI / 2;
    const [nx, ny] = [Math.cos(theta), Math.sin(theta)];
    out.push({
      outer: [
        [a.point[0] + nx * ra, a.point[1] + ny * ra],
        [b.point[0] + nx * rb, b.point[1] + ny * rb],
        [b.point[0] - nx * rb, b.point[1] - ny * rb],
        [a.point[0] - nx * ra, a.point[1] - ny * ra],
      ],
      holes: [],
    });
  }
  return out;
}

/** Polygons of one object, in y-up coordinates. */
export function objectPolygons(obj: DrawObject, height: number): Polygon[] {
  const pts: Point[] = obj.points.map((p) => (p.length > 2 ? [p[0], height - p[1], p[2]] : [p[0], height - p[1]]));
  const xy = (p: Point): Vec2 => [p[0], p[1]];
  const half = obj.size / 2;
  switch (obj.tool) {
    case 'pen':
      return penPolygons(pts as number[][], obj.size);
    case 'line': {
      if (pts.length === 1) return [{ outer: capsuleRing(xy(pts[0]), xy(pts[0]), obj.size), holes: [] }];
      return pts.slice(1).map((p, i) => ({ outer: capsuleRing(xy(pts[i]), xy(p), obj.size), holes: [] }));
    }
    case 'rect': {
      const [a, b] = [pts[0], pts[pts.length - 1]];
      const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
      const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
      if (obj.filled) return shapePolygons(rectRing(x0, y0, x1, y1), null);
      const inner = x1 - x0 > obj.size && y1 - y0 > obj.size ? rectRing(x0 + half, y0 + half, x1 - half, y1 - half) : null;
      return shapePolygons(rectRing(x0 - half, y0 - half, x1 + half, y1 + half), inner);
    }
    case 'ellipse': {
      const [a, b] = [pts[0], pts[pts.length - 1]];
      const [cx, cy] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const [rx, ry] = [Math.abs(a[0] - b[0]) / 2, Math.abs(a[1] - b[1]) / 2];
      if (obj.filled) return shapePolygons(ellipseRing(cx, cy, rx, ry), null);
      const inner = rx > half && ry > half ? ellipseRing(cx, cy, rx - half, ry - half) : null;
      return shapePolygons(ellipseRing(cx, cy, rx + half, ry + half), inner);
    }
  }
}

/** Apply the objects in order (unions, then erasers subtracted) inside a kernel scope. */
function compose(kernel: Kernel, objects: DrawObject[], height: number): Polygon[][] {
  return kernel.scope(() => {
    let acc: Region | null = null;
    for (const obj of objects) {
      const polygons = objectPolygons(obj, height);
      if (polygons.length === 0) continue;
      const region = kernel.region(polygons);
      if (obj.erase) acc = acc ? kernel.subtract2(acc, region) : acc;
      else acc = acc ? kernel.union2([acc, region]) : region;
    }
    if (!acc || kernel.isEmpty2(acc)) return [];
    return kernel.components2(acc).map((r) => kernel.polygons(r));
  });
}

/** Turn a drawing into a figure: one part per connected component, ordered by area, largest first. */
export function drawingToFigure(drawing: DrawingSource, ctx: ImagingContext): Figure {
  const components = compose(ctx.kernel, drawing.objects, drawing.height);
  if (components.length === 0) throw new Error('The drawing is empty: nothing is left to shape (an eraser may have removed everything).');
  const areaOf = (ps: Polygon[]) => ps.reduce((s, p) => s + polygonArea(p), 0);
  components.sort((a, b) => areaOf(b) - areaOf(a));
  return { units: 'unit', parts: components.map((polygons, i) => ({ id: partId(i), polygons })) };
}
