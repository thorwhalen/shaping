/**
 * A tiny undo/redo reducer over the drawing's object list.
 *
 * Pure and framework-free: the state holds the present list plus past and future stacks of whole
 * lists (structural sharing makes that cheap). Clear is an ordinary commit, so it is undoable.
 */
import type { DrawObject } from './strokes';

export type Objects = readonly DrawObject[];

export interface History {
  past: Objects[];
  present: Objects;
  future: Objects[];
}

export type HistoryAction =
  | { type: 'commit'; object: DrawObject }
  | { type: 'clear' }
  | { type: 'undo' }
  | { type: 'redo' }
  /** Replace the present from outside (a new document); drops the history. */
  | { type: 'reset'; objects: Objects };

/** Upper bound on remembered steps, so a long session cannot grow without limit. */
export const MAX_HISTORY = 200;

export const initHistory = (objects: Objects = []): History => ({ past: [], present: objects, future: [] });

export const canUndo = (h: History) => h.past.length > 0;
export const canRedo = (h: History) => h.future.length > 0;

function push(h: History, next: Objects): History {
  return { past: [...h.past, h.present].slice(-MAX_HISTORY), present: next, future: [] };
}

export function historyReducer(h: History, action: HistoryAction): History {
  switch (action.type) {
    case 'commit':
      return push(h, [...h.present, action.object]);
    case 'clear':
      return h.present.length === 0 ? h : push(h, []);
    case 'undo':
      if (!canUndo(h)) return h;
      return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
    case 'redo':
      if (!canRedo(h)) return h;
      return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
    case 'reset':
      return initHistory(action.objects);
  }
}
