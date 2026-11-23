/**
 * When a change to the design is on screen, and when to draw it cheaply.
 *
 * When a change to the design is on screen: the rebuild it started has landed (the store is no
 * longer `stale`) and a frame has been painted. Paced controls (`lib/pacing`) time their work by it,
 * so on a slow device they drop the live preview instead of queueing rebuilds.
 */
import { useEffect, useState } from 'react';
import { nextPaint, paintLoad, sharedLoad, type Load } from '../lib/pacing';
import { useApp } from './store';

export function modelOnScreen(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => void nextPaint().then(resolve);
    if (!useApp.getState().stale) return done();
    const off = useApp.subscribe((s) => {
      if (s.stale) return;
      off();
      done();
    });
  });
}

/** What every paced control in the app shares: see `PacingProvider`. A drag is one undo step. */
export const appPacing = { settled: modelOnScreen, onGesture: (active: boolean) => useApp.getState().setGesture(active) };

/** The loads whose slowness turns drafting on. */
const DRAFT_LOADS: readonly Load[] = [sharedLoad, paintLoad];

/**
 * Draw drafts while a drag runs on a device that cannot keep up: true while a paced gesture is under
 * way and a pacing load estimate is slow (the app's, for controls that rebuild, or the paint-only
 * controls' own). The same estimates that drop the live preview decide that what is shown is drawn
 * cheaply; when the gesture ends the final model is drawn in full. Re-renders its host only when
 * that answer flips.
 */
export function useDrafting(loads: readonly Load[] = DRAFT_LOADS): boolean {
  const [slow, setSlow] = useState(() => loads.some((l) => l.slow));
  useEffect(() => {
    const update = () => setSlow(loads.some((l) => l.slow));
    update();
    const offs = loads.map((l) => l.subscribe(update));
    return () => offs.forEach((off) => off());
  }, [loads]);
  return useApp((s) => s.gesturing && slow);
}
