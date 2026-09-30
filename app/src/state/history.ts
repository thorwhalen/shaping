/**
 * Undo and redo for the open design: a list of earlier designs and a list of undone ones. Changes
 * closer together than GROUP_MS form one step, so dragging a slider or orbiting undoes as one.
 * Pure functions over plain data; the store holds the value.
 */
export const HISTORY_LIMIT = 200;
export const GROUP_MS = 500;

export interface History<T> {
  past: T[];
  future: T[];
  /** When the last change was recorded (ms), and its kind, for grouping. */
  lastAt: number;
  lastKind?: string;
}

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [], lastAt: 0 });

/**
 * Record that `before` is being replaced at time `now`. Changes of the same kind in quick
 * succession form one step (a slider drag, an orbit); a different kind always starts a new step.
 * `continuing`: the change belongs to a step already open (one gesture, however slowly it lands).
 * A new change clears what was undone.
 */
export function record<T>(h: History<T>, before: T, now: number, kind = 'edit', continuing = false): History<T> {
  const grouped = continuing || (kind === h.lastKind && now - h.lastAt <= GROUP_MS);
  const past = grouped ? h.past : [...h.past, before].slice(-HISTORY_LIMIT);
  return { past, future: [], lastAt: now, lastKind: kind };
}

export function undo<T>(h: History<T>, current: T): { value: T; history: History<T> } | null {
  if (!h.past.length) return null;
  return { value: h.past[h.past.length - 1], history: { past: h.past.slice(0, -1), future: [current, ...h.future], lastAt: 0 } };
}

export function redo<T>(h: History<T>, current: T): { value: T; history: History<T> } | null {
  if (!h.future.length) return null;
  return { value: h.future[0], history: { past: [...h.past, current], future: h.future.slice(1), lastAt: 0 } };
}
