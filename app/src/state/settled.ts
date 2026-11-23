/**
 * When a change to the design is on screen, and when to draw it cheaply.
 *
 * When a change to the design is on screen: the rebuild it started has landed (the store is no
 * longer `stale`) and a frame has been painted. Paced controls (`lib/pacing`) time their work by it,
 * so on a slow device they drop the live preview instead of queueing rebuilds.
 */
import { useEffect, useState } from 'react';
import { nextPaint, sharedLoad, type Load } from '../lib/pacing';
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

/**
 * Draw drafts while a drag runs on a device that cannot keep up: true while a paced gesture is under
 * way and the pacing load estimate is slow. The same estimate that drops the live preview decides
 * that what is shown is drawn cheaply; when the gesture ends the final model is drawn in full.
 */
export function useDrafting(load: Load = sharedLoad): boolean {
  const gesturing = useApp((s) => s.gesturing);
  const [slow, setSlow] = useState(load.slow);
  useEffect(() => {
    setSlow(load.slow);
    return load.subscribe(setSlow);
  }, [load]);
  return gesturing && slow;
}
