/** Tests for the undo/redo reducer and the pure shape helpers (no DOM needed). */
import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, historyReducer, initHistory, MAX_HISTORY } from './history';
import { cornersToBox, shapePoints, shapePolygon, strokeOutline, PEN_OPTIONS, type DrawObject } from './strokes';

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
