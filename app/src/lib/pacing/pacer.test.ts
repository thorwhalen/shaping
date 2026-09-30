import { describe, expect, it } from 'vitest';
import { createLoad, createPacer, type Timers } from './pacer';

/** A hand-driven clock, timers and `settled`, so each test says exactly when work lands. */
function harness({ budgetMs = 100 } = {}) {
  let t = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const fake: Timers = {
    set: (fn, ms) => (timers.push({ at: t + ms, fn, id: nextId }), nextId++),
    clear: (id) => void (timers = timers.filter((x) => x.id !== id)),
  };
  const landings: (() => void)[] = [];
  const applied: [number, boolean][] = [];
  const load = createLoad({ budgetMs });
  const pacer = createPacer<number>((v, final) => applied.push([v, final]), {
    load,
    settleMs: 50,
    now: () => t,
    timers: fake,
    settled: () => new Promise<void>((r) => landings.push(r)),
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return {
    pacer,
    applied,
    load,
    /** Let `ms` pass, firing due timers. */
    async advance(ms: number) {
      t += ms;
      for (const x of timers.filter((x) => x.at <= t)) (fake.clear(x.id), x.fn());
      await flush();
    },
    /** The work in flight reaches the screen after `ms`. */
    async land(ms = 0) {
      t += ms;
      landings.shift()?.();
      await flush();
    },
  };
}

describe('pacer', () => {
  it('applies the first value at once and only the newest of those that came while it worked', async () => {
    const h = harness();
    h.pacer.push(1);
    [2, 3, 4].forEach((v) => h.pacer.push(v));
    expect(h.applied).toEqual([[1, false]]);
    await h.land(10);
    expect(h.applied).toEqual([[1, false], [4, false]]);
  });

  it('always lands the committed value last, after the work in flight', async () => {
    const h = harness();
    h.pacer.push(1);
    h.pacer.push(2);
    h.pacer.commit();
    await h.land(10);
    expect(h.applied.at(-1)).toEqual([2, true]);
    expect(h.pacer.busy).toBe(true);
    await h.land(10);
    expect(h.pacer.busy).toBe(false);
  });

  it('does not apply a committed value that is already on screen', async () => {
    const h = harness();
    h.pacer.push(1);
    await h.land(10);
    h.pacer.commit();
    expect(h.applied).toEqual([[1, false]]);
  });

  it('under load, holds intermediate values until the hand pauses or lets go', async () => {
    const h = harness({ budgetMs: 100 });
    h.pacer.push(1);
    await h.land(400); // one slow round trip: the device cannot keep up
    expect(h.load.slow).toBe(true);
    h.pacer.push(2);
    await h.advance(20);
    h.pacer.push(3);
    await h.advance(20);
    expect(h.applied).toEqual([[1, false]]); // nothing in between
    await h.advance(60); // a pause longer than settleMs
    expect(h.applied.at(-1)).toEqual([3, false]);
    await h.land(400);
    h.pacer.push(4);
    h.pacer.commit(); // released before any pause
    expect(h.applied.at(-1)).toEqual([4, true]);
  });

  it('recovers the live preview once round trips are fast again', async () => {
    const h = harness({ budgetMs: 100 });
    h.pacer.push(1);
    await h.land(400);
    for (let v = 2; v < 12; v++) {
      h.pacer.commit(v);
      await h.land(5);
    }
    expect(h.load.slow).toBe(false);
    h.pacer.push(99);
    expect(h.applied.at(-1)).toEqual([99, false]);
  });

  it('forgets the last pushed value once committed, so a later blur does not re-apply it', async () => {
    const h = harness();
    h.pacer.push(1);
    h.pacer.commit();
    await h.land(10);
    const n = h.applied.length;
    h.pacer.commit();
    expect(h.applied.length).toBe(n);
  });
});
