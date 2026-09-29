/**
 * Pure stroke and shape helpers for the drawing canvas.
 *
 * One definition of how a drawn object becomes geometry, shared by the canvas renderer and by the
 * conversion of a drawing into a figure: `PEN_OPTIONS` and `strokeOutline` for freehand strokes,
 * `shapePoints` and `shapePolygon` for lines, rectangles and ellipses. No DOM, no React.
 */
import { getStroke } from 'perfect-freehand';
import type { DrawObject } from 'shaping';

/** A point in drawing coordinates (y down): x, y and an optional pen pressure in 0..1. */
export type Point = number[];

/** Tools that create objects. The eraser is a pen with `erase: true`, so it is not listed here. */
export type ShapeTool = 'pen' | 'line' | 'rect' | 'ellipse';

export type { DrawObject, DrawingSource } from 'shaping';

/** Pressure assumed when the device reports none (mouse, or a pen that reports 0 on contact). */
export const DEFAULT_PRESSURE = 0.5;

/** Line snap step for shift-constrained lines, in degrees. */
export const LINE_SNAP_DEGREES = 45;

/** Segments used to approximate an ellipse as a polygon. */
export const ELLIPSE_SEGMENTS = 64;

/** Options passed to perfect-freehand. The figure conversion must use this same constant. */
export const PEN_OPTIONS = {
  thinning: 0.5,
  smoothing: 0.5,
  streamline: 0.5,
  simulatePressure: false,
  last: true,
} as const;

/** The outline polygon of a freehand stroke: `size` is the nominal width in drawing units. */
export function strokeOutline(points: Point[], size: number): Point[] {
  const input = points.map((p) => [p[0], p[1], p[2] ?? DEFAULT_PRESSURE]);
  return getStroke(input, { ...PEN_OPTIONS, size });
}

/**
 * The two stored points of a line, rectangle or ellipse dragged from `a` to `b`.
 * With `constrain`: lines snap to 45 degree steps; rectangles become squares and ellipses circles.
 */
export function shapePoints(
  tool: Exclude<ShapeTool, 'pen'>,
  a: Point,
  b: Point,
  constrain = false,
): [Point, Point] {
  const start: Point = [a[0], a[1]];
  if (!constrain) return [start, [b[0], b[1]]];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (tool === 'line') {
    const step = (LINE_SNAP_DEGREES * Math.PI) / 180;
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    const length = Math.hypot(dx, dy);
    return [start, [a[0] + length * Math.cos(angle), a[1] + length * Math.sin(angle)]];
  }
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return [start, [a[0] + Math.sign(dx || 1) * side, a[1] + Math.sign(dy || 1) * side]];
}

/** Bounding box of two corner points, normalised so width and height are non-negative. */
export function cornersToBox(a: Point, b: Point) {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return { x, y, w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
}

/** A closed polygon for a filled rectangle or ellipse given its two stored corners. */
export function shapePolygon(
  tool: 'rect' | 'ellipse',
  a: Point,
  b: Point,
  segments = ELLIPSE_SEGMENTS,
): Point[] {
  const { x, y, w, h } = cornersToBox(a, b);
  if (tool === 'rect') return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const cx = x + w / 2;
  const cy = y + h / 2;
  return Array.from({ length: segments }, (_, i) => {
    const t = (2 * Math.PI * i) / segments;
    return [cx + (w / 2) * Math.cos(t), cy + (h / 2) * Math.sin(t)];
  });
}
