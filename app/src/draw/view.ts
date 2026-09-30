/**
 * Pure view-transform helpers for the drawing canvas (no DOM, no React).
 *
 * A `View` maps drawing units (y down) to CSS pixels of the canvas element:
 * `screen = drawing * zoom + (tx, ty)`. Zoom limits are relative to the "fit" zoom (the zoom that
 * shows the whole frame), so 1x always means "whole frame visible" whatever the frame's size.
 */

export interface View {
  /** CSS pixels per drawing unit. */
  zoom: number;
  /** CSS-pixel offset of the drawing origin. */
  tx: number;
  ty: number;
}

export interface Size {
  w: number;
  h: number;
}

/** Zoom limits, relative to the fit zoom. */
export const MIN_REL_ZOOM = 0.25;
export const MAX_REL_ZOOM = 16;
/** Multiplier for the zoom buttons and the +/- keys. */
export const ZOOM_STEP = 1.25;
/** Wheel sensitivity: zoom factor is exp(-deltaY * this). Pinch gestures (ctrl+wheel) use the larger one. */
export const WHEEL_ZOOM_RATE = 0.0015;
export const PINCH_ZOOM_RATE = 0.01;
/** Muted margin around the frame at fit, in CSS pixels. */
export const FIT_MARGIN_PX = 24;
/** Bounds on the canvas element's height, in CSS pixels. */
export const MIN_VIEW_HEIGHT = 200;
export const MAX_VIEW_HEIGHT = 640;
/** Grid lines are never closer than this many CSS pixels. */
export const GRID_MIN_SPACING_PX = 16;

export function screenToDrawing(view: View, sx: number, sy: number): [number, number] {
  return [(sx - view.tx) / view.zoom, (sy - view.ty) / view.zoom];
}

export function drawingToScreen(view: View, x: number, y: number): [number, number] {
  return [x * view.zoom + view.tx, y * view.zoom + view.ty];
}

/** Zoom that shows the whole `frame` inside `viewport` with `margin` pixels to spare. */
export function fitZoom(frame: Size, viewport: Size, margin = FIT_MARGIN_PX): number {
  const zx = (viewport.w - 2 * margin) / frame.w;
  const zy = (viewport.h - 2 * margin) / frame.h;
  return Math.max(Math.min(zx, zy), Number.EPSILON);
}

/** The view that centres the whole frame in the viewport. */
export function fitView(frame: Size, viewport: Size, margin = FIT_MARGIN_PX): View {
  const zoom = fitZoom(frame, viewport, margin);
  return { zoom, tx: (viewport.w - frame.w * zoom) / 2, ty: (viewport.h - frame.h * zoom) / 2 };
}

/** Clamp an absolute zoom to the allowed range around `fit`. */
export function clampZoom(zoom: number, fit: number): number {
  return Math.min(Math.max(zoom, fit * MIN_REL_ZOOM), fit * MAX_REL_ZOOM);
}

/** Multiply the zoom by `factor`, keeping the drawing point under screen point (sx, sy) fixed. */
export function zoomAround(view: View, factor: number, sx: number, sy: number, fit: number): View {
  const zoom = clampZoom(view.zoom * factor, fit);
  const k = zoom / view.zoom;
  return { zoom, tx: sx - (sx - view.tx) * k, ty: sy - (sy - view.ty) * k };
}

export function panBy(view: View, dx: number, dy: number): View {
  return { ...view, tx: view.tx + dx, ty: view.ty + dy };
}

/** Height of the canvas element: shows the whole frame at fit for a given width, within bounds. */
export function viewportHeight(
  width: number,
  frame: Size,
  { margin = FIT_MARGIN_PX, min = MIN_VIEW_HEIGHT, max = MAX_VIEW_HEIGHT } = {},
): number {
  const natural = (width - 2 * margin) * (frame.h / frame.w) + 2 * margin;
  return Math.round(Math.min(Math.max(natural, min), max));
}

/** Smallest 1/2/5 x 10^n drawing-unit step whose on-screen spacing is at least `minPx`. */
export function gridStep(zoom: number, minPx = GRID_MIN_SPACING_PX): number {
  const raw = minPx / zoom;
  const base = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 5, 10].find((m) => m * base >= raw) ?? 10) * base;
}
