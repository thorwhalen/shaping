/**
 * Canvas 2D rendering of a drawing: black objects on white, erasers painted white, in list order.
 *
 * Always redrawn from the object list; the canvas holds no truth. Coordinates are drawing
 * coordinates; the caller sets the transform (scale and devicePixelRatio) before calling.
 */
import { objectPolygons } from 'shaping/imaging';
import type { DrawObject } from './strokes';
import { gridStep, type Size, type View } from './view';

export const INK = '#000000';
export const PAPER = '#ffffff';

/**
 * Paint one object onto `ctx`, as the exact polygons the library turns it into (`objectPolygons`),
 * so what the canvas shows is what becomes the figure. The library's polygons are y-up; the
 * canvas is y-down, so y is flipped back with the drawing's height.
 */
export function drawObject(
  ctx: CanvasRenderingContext2D,
  o: DrawObject,
  height: number,
  colors: { ink: string; paper: string } = { ink: INK, paper: PAPER },
) {
  ctx.fillStyle = o.erase ? colors.paper : colors.ink;
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

/** Colours of the scene outside and on top of the frame. */
export const OUTSIDE_GROUND = '#e4e0d6';
export const OUTSIDE_INK = '#8a857b';
export const FRAME_BORDER = '#d4763b';
export const GRID_COLOR = 'rgba(31, 29, 26, 0.12)';
export const FRAME_BORDER_PX = 2;
/** Extent of the "everything" rectangle used to clip to the outside of the frame. */
const HUGE = 1e7;

export interface SceneOptions {
  view: View;
  /** Canvas size in CSS pixels. */
  viewport: Size;
  /** Frame (the drawing's width x height) in drawing units. */
  frame: Size;
  grid: boolean;
  /** Device pixel ratio the backing store was sized with. */
  dpr: number;
}

/**
 * Paint the whole scene under a view: muted ground, the white frame with a border, and the objects.
 * Parts of objects outside the frame are drawn dimmed on the muted ground (an eraser there paints
 * the ground colour); inside the frame they are drawn in full ink on white, with an optional grid.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  { view, viewport, frame, grid, dpr }: SceneOptions,
  objects: readonly DrawObject[],
  preview?: DrawObject | null,
) {
  const all = preview ? [...objects, preview] : objects;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = OUTSIDE_GROUND;
  ctx.fillRect(0, 0, viewport.w, viewport.h);
  ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.tx, dpr * view.ty);

  ctx.save();
  ctx.beginPath();
  ctx.rect(-HUGE, -HUGE, 2 * HUGE, 2 * HUGE);
  ctx.rect(0, 0, frame.w, frame.h);
  ctx.clip('evenodd');
  const dim = { ink: OUTSIDE_INK, paper: OUTSIDE_GROUND };
  for (const o of all) drawObject(ctx, o, frame.h, dim);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, frame.w, frame.h);
  ctx.clip();
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, frame.w, frame.h);
  for (const o of all) drawObject(ctx, o, frame.h);
  if (grid) drawGrid(ctx, frame, view.zoom);
  ctx.restore();

  ctx.strokeStyle = FRAME_BORDER;
  ctx.lineWidth = FRAME_BORDER_PX / view.zoom;
  ctx.strokeRect(0, 0, frame.w, frame.h);
}

function drawGrid(ctx: CanvasRenderingContext2D, frame: Size, zoom: number) {
  const step = gridStep(zoom);
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  for (let x = step; x < frame.w; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, frame.h);
  }
  for (let y = step; y < frame.h; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(frame.w, y);
  }
  ctx.stroke();
}
