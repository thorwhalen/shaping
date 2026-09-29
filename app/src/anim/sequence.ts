/**
 * Editing a keyframe sequence: pure functions `(sequence, ...) => sequence`, never mutating.
 * Captured keyframes hold the whole state, so a sequence reads the same whatever the design does
 * next; transitions default to an eased move with a short dwell.
 */
import type { Keyframe, Sequence, Space } from 'previz';
import type { ShapingState } from './state';

export const DEFAULT_TRANSITION_SECONDS = 1.5;
export const DEFAULT_TIMING = 'ease-in-out';
export const DEFAULT_DWELL_SECONDS = 0.5;
/** The CSS timings offered in the list (previz accepts any CSS timing, and cubic-bezier). */
export const TIMINGS = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'] as const;

export type ShapingSequence = Sequence<ShapingState>;

export function emptySequence(space: Space): ShapingSequence {
  return {
    format: 'previz.sequence',
    version: 1,
    space,
    defaults: { transition: { duration: DEFAULT_TRANSITION_SECONDS, timing: DEFAULT_TIMING }, dwell: DEFAULT_DWELL_SECONDS },
    keyframes: [],
  };
}

const freshId = (seq: ShapingSequence) => {
  const taken = new Set(seq.keyframes.map((k) => k.id));
  for (let i = seq.keyframes.length + 1; ; i++) if (!taken.has(`view-${i}`)) return `view-${i}`;
};

export function captureKeyframe(seq: ShapingSequence, state: ShapingState, space: Space): ShapingSequence {
  const id = freshId(seq);
  const kf: Keyframe<ShapingState> = { id, label: `View ${seq.keyframes.length + 1}`, state: structuredClone(state) };
  return { ...seq, space, keyframes: [...seq.keyframes, kf] };
}

export const removeKeyframe = (seq: ShapingSequence, i: number): ShapingSequence => ({ ...seq, keyframes: seq.keyframes.filter((_, j) => j !== i) });

export function moveKeyframe(seq: ShapingSequence, i: number, by: -1 | 1): ShapingSequence {
  const j = i + by;
  if (j < 0 || j >= seq.keyframes.length) return seq;
  const ks = [...seq.keyframes];
  [ks[i], ks[j]] = [ks[j], ks[i]];
  return { ...seq, keyframes: ks };
}

export function updateKeyframe(seq: ShapingSequence, i: number, patch: Partial<Keyframe<ShapingState>>): ShapingSequence {
  return { ...seq, keyframes: seq.keyframes.map((k, j) => (j === i ? { ...k, ...patch, enter: patch.enter ? { ...k.enter, ...patch.enter } : k.enter } : k)) };
}
