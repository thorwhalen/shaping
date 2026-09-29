/**
 * Canvas 2D rendering of a drawing: black objects on white, erasers painted white, in list order.
 *
 * Always redrawn from the object list; the canvas holds no truth. Coordinates are drawing
 * coordinates; the caller sets the transform (scale and devicePixelRatio) before calling.
 */
import { objectPolygons } from 'shaping/imaging';
import type { DrawObject } from './strokes';

export const INK = '#000000';
export const PAPER = '#ffffff';

/**
 * Paint one object onto `ctx`, as the exact polygons the library turns it into (`objectPolygons`),
 * so what the canvas shows is what becomes the figure. The library's polygons are y-up; the
 * canvas is y-down, so y is flipped back with the drawing's height.
 */
export function drawObject(ctx: CanvasRenderingContext2D, o: DrawObject, height: number) {
  ctx.fillStyle = o.erase ? PAPER : INK;
  // One fill per polygon: overlapping pieces of a stroke add up instead of cancelling.
  for (const p of objectPolygons(o, height)) {
    ctx.beginPath();
    for (const ring of [p.outer, ...p.holes]) {
      ring.forEach(([x, y], i) => (i ? ctx.lineTo(x, height - y) : ctx.moveTo(x, height - y)));
      ctx.closePath();
    }
    ctx.fill('evenodd');
  }
}

/** Clear to white and paint every object, then the optional in-progress one. */
export function drawAll(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  objects: readonly DrawObject[],
  preview?: DrawObject | null,
) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  for (const o of objects) drawObject(ctx, o, height);
  if (preview) drawObject(ctx, preview, height);
}
