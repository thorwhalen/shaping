import { describe, expect, it } from 'vitest';
import { emptyHistory, GROUP_MS, record, redo, undo } from './history';

describe('history', () => {
  it('groups quick changes, undoes and redoes, and a new change clears the redo list', () => {
    let h = emptyHistory<number>();
    h = record(h, 0, 1000); // 0 -> 1
    h = record(h, 1, 1100); // 1 -> 2, same drag
    h = record(h, 2, 1000 + 10 * GROUP_MS); // 2 -> 3, a new step
    expect(h.past).toEqual([0, 2]);
    const u1 = undo(h, 3)!;
    expect(u1.value).toBe(2);
    const u2 = undo(u1.history, 2)!;
    expect(u2.value).toBe(0);
    const r1 = redo(u2.history, 0)!;
    expect(r1.value).toBe(2);
    const fresh = record(r1.history, 2, 99999);
    expect(fresh.future).toEqual([]);
    expect(undo(emptyHistory<number>(), 1)).toBeNull();
  });
});
