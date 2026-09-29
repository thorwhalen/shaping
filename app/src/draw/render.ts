/**
 * Canvas 2D rendering of a drawing: black objects on white, erasers painted white, in list order.
 *
 * Always redrawn from the object list; the canvas holds no truth. Coordinates are drawing
 * coordinates; the caller sets the transform (scale and devicePixelRatio) before calling.
 */
import { cornersToBox, strokeOutline, type DrawObject, type Point } from './strokes';

export const INK = '#000000';
export const PAPER = '#ffffff';

function fillPolygon(ctx: CanvasRenderingContext2D, pts: Point[]) {
  if (pts.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();
}

/** Paint one object onto `ctx`. */
export function drawObject(ctx: CanvasRenderingContext2D, o: DrawObject) {
  const colour = o.erase ? PAPER : INK;
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  ctx.lineWidth = o.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (o.tool === 'pen') return fillPolygon(ctx, strokeOutline(o.points, o.size));
  if (o.points.length < 2) return;
  const [a, b] = o.points;
  if (o.tool === 'line') {
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    return ctx.stroke();
  }
  const { x, y, w, h } = cornersToBox(a, b);
  ctx.beginPath();
  if (o.tool === 'rect') ctx.rect(x, y, w, h);
  else ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, 2 * Math.PI);
  if (o.filled) ctx.fill();
  else ctx.stroke();
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
  for (const o of objects) drawObject(ctx, o);
  if (preview) drawObject(ctx, preview);
}
