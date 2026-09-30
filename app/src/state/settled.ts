/**
 * When a change to the design is on screen: the rebuild it started has landed (the store is no
 * longer `stale`) and a frame has been painted. Paced controls (`lib/pacing`) time their work by it,
 * so on a slow device they drop the live preview instead of queueing rebuilds.
 */
import { nextPaint } from '../lib/pacing';
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

/** What every paced control in the app shares: see `PacingProvider`. */
export const appPacing = { settled: modelOnScreen };
