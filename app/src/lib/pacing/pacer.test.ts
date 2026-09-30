import { describe, expect, it } from 'vitest';
import { createLoad, createPacer, type PacerOptions, type Timers } from './pacer';

/** A hand-driven clock, timers and `settled`, so each test says exactly when work lands. */
function harness({ budgetMs = 100, apply }: { budgetMs?: number; apply?: (v: number) => void } = {}, extra: PacerOptions = {}) {
  let t = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const fake: Timers = {
    set: (fn, ms) => (timers.push({ at: t + ms, fn, id: nextId }), nextId++),
    clear: (id) => void (timers = timers.filter((x) => x.id !== id)),
  };
  const landings: (() => void)[] = [];
  const applied: [number, boolean][] = [];
  const gestures: boolean[] = [];
  const load = createLoad({ budgetMs });
  const pacer = createPacer<number>(
    (v, final) => (applied.push([v, final]), apply?.(v)),
    { load, settleMs: 50, maxWaitMs: 1000, now: () => t, timers: fake, settled: () => new Promise<void>((r) => landings.push(r)), onGesture: (a) => gestures.push(a), ...extra },
  );
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return {
    pacer,
    applied,
    gestures,
    load,
    /** Let `ms` pass, firing due timers. */
    async advance(ms: number) {
      t += ms;
      for (const x of timers.filter((x) => x.at <= t)) (fake.clear(x.id), x.fn());
      await flush();
    },
    /** The oldest work in flight reaches the screen after `ms`. */
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

  it('applies the committed value at once, without waiting for the work in flight', () => {
    const h = harness();
    h.pacer.push(1);
    h.pacer.push(2);
    h.pacer.commit();
    expect(h.applied).toEqual([[1, false], [2, true]]);
  });

  it('does not re-apply a committed value that was already applied, but applies a repeat after an outside change', async () => {
    const h = harness();
    h.pacer.push(4);
    await h.land(10);
    h.pacer.commit(); // 4 is on screen already
    expect(h.applied).toEqual([[4, false]]);
    // Undo takes the model back to 3 elsewhere; the person moves to 4 again.
    h.pacer.push(4);
    expect(h.applied).toEqual([[4, false], [4, false]]);
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
    h.pacer.push(4);
    h.pacer.commit(); // released before any pause, while 3 is still in flight
    expect(h.applied.at(-1)).toEqual([4, true]);
  });

  it('recovers the live preview once round trips are fast again', async () => {
    const h = harness({ budgetMs: 100 });
    h.pacer.push(1);
    await h.land(400);
    for (let v = 2; v < 8; v++) {
      h.pacer.commit(v);
      await h.land(5);
    }
    expect(h.load.slow).toBe(false);
    h.pacer.push(99);
    expect(h.applied.at(-1)).toEqual([99, false]);
  });

  it('does not learn from a result that never arrived (a hidden tab, a stuck build)', async () => {
    const h = harness({ budgetMs: 100 });
    h.pacer.push(1);
    await h.advance(1000); // maxWaitMs: the pacer lets go without a sample
    expect(h.load.estimateMs).toBe(0);
    h.pacer.push(2);
    expect(h.applied.at(-1)).toEqual([2, false]);
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

  it('keeps going when apply throws', async () => {
    const errors: unknown[] = [];
    const h = harness({ apply: (v) => { if (v === 1) throw new Error('boom'); } }, { onError: (e) => errors.push(e) });
    h.pacer.push(1);
    h.pacer.push(2);
    await h.land(10);
    expect(errors).toHaveLength(1);
    expect(h.applied.at(-1)).toEqual([2, false]);
  });

  it('reports one gesture from the first push until the committed value is on screen', async () => {
    const h = harness();
    h.pacer.push(1);
    h.pacer.push(2);
    expect(h.gestures).toEqual([true]);
    h.pacer.commit();
    expect(h.gestures).toEqual([true]);
    await h.land(10); // 1 lands: overtaken by the commit, ignored
    await h.land(10); // the committed 2 lands
    expect(h.gestures).toEqual([true, false]);
  });

  it('ends a gesture whose last value already landed when committed', async () => {
    const h = harness();
    h.pacer.push(1);
    await h.land(10);
    h.pacer.commit();
    expect(h.gestures).toEqual([true, false]);
  });

  it('cancel drops what is held and ends the gesture', async () => {
    const h = harness({ budgetMs: 100 });
    h.pacer.push(1);
    await h.land(400);
    h.pacer.push(2); // held: the device is slow
    h.pacer.cancel();
    await h.advance(100);
    expect(h.applied).toEqual([[1, false]]);
    expect(h.gestures.at(-1)).toBe(false);
  });
});
