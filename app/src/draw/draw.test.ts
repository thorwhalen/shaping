/** Tests for the undo/redo reducer and the pure shape helpers (no DOM needed). */
import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, historyReducer, initHistory, MAX_HISTORY } from './history';
import { cornersToBox, shapePoints, shapePolygon, strokeOutline, PEN_OPTIONS, type DrawObject } from './strokes';
import {
  MAX_REL_ZOOM, MIN_REL_ZOOM, drawingToScreen, fitView, gridStep, screenToDrawing, viewportHeight, zoomAround, type View,
} from './view';

const obj = (x: number): DrawObject => ({ tool: 'line', points: [[x, 0], [x, 1]], size: 4, filled: true, erase: false });

describe('history', () => {
  it('commits, undoes and redoes', () => {
    let h = initHistory();
    h = historyReducer(h, { type: 'commit', object: obj(1) });
    h = historyReducer(h, { type: 'commit', object: obj(2) });
    expect(h.present).toHaveLength(2);
    h = historyReducer(h, { type: 'undo' });
    expect(h.present).toHaveLength(1);
    expect(canRedo(h)).toBe(true);
    h = historyReducer(h, { type: 'redo' });
    expect(h.present).toHaveLength(2);
    expect(canRedo(h)).toBe(false);
  });

  it('a new commit drops the redo stack', () => {
    let h = historyReducer(initHistory(), { type: 'commit', object: obj(1) });
    h = historyReducer(h, { type: 'undo' });
    h = historyReducer(h, { type: 'commit', object: obj(2) });
    expect(canRedo(h)).toBe(false);
  });

  it('clear is undoable', () => {
    let h = historyReducer(initHistory(), { type: 'commit', object: obj(1) });
    h = historyReducer(h, { type: 'clear' });
    expect(h.present).toHaveLength(0);
    h = historyReducer(h, { type: 'undo' });
    expect(h.present).toHaveLength(1);
  });

  it('undo and redo at the ends are no-ops; clearing nothing is not a step', () => {
    const h = initHistory();
    expect(historyReducer(h, { type: 'undo' })).toBe(h);
    expect(historyReducer(h, { type: 'redo' })).toBe(h);
    expect(canUndo(historyReducer(h, { type: 'clear' }))).toBe(false);
  });

  it('is bounded and reset drops history', () => {
    let h = initHistory();
    for (let i = 0; i < MAX_HISTORY + 20; i++) h = historyReducer(h, { type: 'commit', object: obj(i) });
    expect(h.past).toHaveLength(MAX_HISTORY);
    expect(historyReducer(h, { type: 'reset', objects: [] }).past).toHaveLength(0);
  });
});

describe('shape helpers', () => {
  it('keeps free endpoints unconstrained', () => {
    expect(shapePoints('line', [0, 0], [10, 3])).toEqual([[0, 0], [10, 3]]);
  });

  it('snaps lines to 45 degrees keeping the length', () => {
    const [, end] = shapePoints('line', [0, 0], [10, 1], true);
    expect(end[0]).toBeCloseTo(Math.hypot(10, 1));
    expect(end[1]).toBeCloseTo(0);
    const [, diag] = shapePoints('line', [0, 0], [10, 9], true);
    expect(diag[0]).toBeCloseTo(diag[1]);
  });

  it('constrains rect and ellipse to squares, in the drag direction', () => {
    expect(shapePoints('rect', [5, 5], [15, 8], true)[1]).toEqual([15, 15]);
    expect(shapePoints('ellipse', [5, 5], [2, 20], true)[1]).toEqual([-10, 20]);
  });

  it('normalises boxes and builds polygons', () => {
    expect(cornersToBox([10, 10], [4, 2])).toEqual({ x: 4, y: 2, w: 6, h: 8 });
    expect(shapePolygon('rect', [0, 0], [2, 3])).toHaveLength(4);
    const e = shapePolygon('ellipse', [0, 0], [4, 2], 8);
    expect(e).toHaveLength(8);
    expect(e[0][0]).toBeCloseTo(4);
    expect(e[0][1]).toBeCloseTo(1);
  });

  it('outlines a stroke with the shared pen options', () => {
    expect(PEN_OPTIONS.simulatePressure).toBe(false);
    const out = strokeOutline([[0, 0, 0.5], [20, 0, 0.5], [40, 5]], 10);
    expect(out.length).toBeGreaterThan(3);
    expect(strokeOutline([[5, 5]], 10).length).toBeGreaterThan(2);
  });
});

describe('view transform', () => {
  const views: View[] = [
    { zoom: 1, tx: 0, ty: 0 },
    { zoom: 0.37, tx: 12, ty: -40 },
    { zoom: 4, tx: -300, ty: 75.5 },
    { zoom: 16, tx: 1000, ty: 1000 },
  ];

  it('round-trips screen and drawing coordinates', () => {
    for (const v of views) {
      const [x, y] = screenToDrawing(v, 123.4, 56.7);
      const [sx, sy] = drawingToScreen(v, x, y);
      expect(sx).toBeCloseTo(123.4, 9);
      expect(sy).toBeCloseTo(56.7, 9);
    }
  });

  it('zooming around a point keeps that drawing point under the pointer', () => {
    for (const v of views) {
      const before = screenToDrawing(v, 200, 150);
      const z = zoomAround(v, 1.7, 200, 150, 0.1);
      const after = screenToDrawing(z, 200, 150);
      expect(after[0]).toBeCloseTo(before[0], 9);
      expect(after[1]).toBeCloseTo(before[1], 9);
    }
  });

  it('clamps zoom relative to the fit zoom', () => {
    const fit = 0.5;
    const hi = zoomAround({ zoom: fit, tx: 0, ty: 0 }, 1e6, 0, 0, fit);
    const lo = zoomAround({ zoom: fit, tx: 0, ty: 0 }, 1e-6, 0, 0, fit);
    expect(hi.zoom).toBeCloseTo(fit * MAX_REL_ZOOM);
    expect(lo.zoom).toBeCloseTo(fit * MIN_REL_ZOOM);
  });

  it('fits wide and tall frames, centred, with the margin', () => {
    const viewport = { w: 400, h: 300 };
    for (const frame of [{ w: 800, h: 200 }, { w: 100, h: 900 }, { w: 512, h: 512 }]) {
      const v = fitView(frame, viewport, 20);
      const [x0, y0] = drawingToScreen(v, 0, 0);
      const [x1, y1] = drawingToScreen(v, frame.w, frame.h);
      expect(x0).toBeGreaterThanOrEqual(20 - 1e-9);
      expect(y0).toBeGreaterThanOrEqual(20 - 1e-9);
      expect(x1).toBeLessThanOrEqual(380 + 1e-9);
      expect(y1).toBeLessThanOrEqual(280 + 1e-9);
      expect(x0 + x1).toBeCloseTo(400);
      expect(y0 + y1).toBeCloseTo(300);
      expect(Math.max(x1 - x0 - 360, y1 - y0 - 260)).toBeCloseTo(0);
    }
  });

  it('sizes the canvas to the frame aspect within bounds', () => {
    expect(viewportHeight(448, { w: 100, h: 100 }, { margin: 24, min: 100, max: 1000 })).toBe(448);
    expect(viewportHeight(448, { w: 400, h: 100 }, { margin: 24, min: 100, max: 1000 })).toBe(148);
    expect(viewportHeight(448, { w: 100, h: 1000 }, { margin: 24, min: 100, max: 500 })).toBe(500);
  });

  it('chooses a 1/2/5 grid step that keeps lines apart', () => {
    for (const zoom of [0.1, 0.37, 1, 4, 16]) {
      const step = gridStep(zoom, 16);
      expect(step * zoom).toBeGreaterThanOrEqual(16 - 1e-9);
      const mantissa = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5]).toContain(Math.round(mantissa));
    }
  });
});
