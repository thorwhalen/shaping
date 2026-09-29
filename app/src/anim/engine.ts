/**
 * shaping as a previz engine: the adapter between the animation library and this app.
 *
 * - `read` gives the state on screen (the camera pose is written back into the design as the user
 *   orbits, so the design is the screen).
 * - `apply` shows a state through the preview channel (the viewer's override), never through the
 *   store, so autosave and undo never see intermediate frames.
 * - `render` draws a state off-screen at any size through the viewer's capture: the same camera
 *   function, lights and environment as the screen, so an exported frame is what the screen shows.
 *
 * A state that changes geometry (a genre dial, the size) is rebuilt in the geometry worker on its
 * own channel ('frame'), so it never cancels the interactive build; models are cached by build key.
 */
import type { Engine, Frame } from 'previz';
import { buildKey, type Design, type Figure, type Genre, type Model } from 'shaping';
import { geometry } from '../worker/client';
import type { CaptureRequest } from '../viewer/Viewer';
import { designWithState, shapingSpace, stateFromDesign, type ShapingState } from './state';

/** Models kept for states whose geometry repeats (a sweep there and back, a looping sequence). */
const MODEL_CACHE_SIZE = 24;

export interface ShapingEngineDeps {
  /** The open design (the base every state is laid over) and its current model and figures. */
  current: () => { design: Design; model: Model; figures: Record<string, Figure> };
  genre: Genre<any>;
  /** Show a design and model on screen without touching the store; null returns to the live view. */
  setOverride: (o: { design: Design; model: Model } | null) => void;
  /** The viewer's offscreen capture. */
  capture: () => ((r: CaptureRequest) => Promise<ImageData>) | null;
}

const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

export function shapingEngine(deps: ShapingEngineDeps): Engine<ShapingState> & { release(): void } {
  const cache = new Map<string, Model>();

  async function modelFor(d: Design, signal?: AbortSignal): Promise<Model> {
    const { design, model, figures } = deps.current();
    const key = buildKey(d);
    if (key === buildKey(design)) return model;
    const hit = cache.get(key);
    if (hit) return hit;
    const built = await geometry().build(d, figures, 'frame');
    if (signal?.aborted) throw signal.reason ?? new Error('aborted');
    if (!built) throw new Error('A frame could not be built (a newer frame replaced it).');
    cache.set(key, built);
    if (cache.size > MODEL_CACHE_SIZE) cache.delete(cache.keys().next().value!);
    return built;
  }

  const designOf = (s: ShapingState) => designWithState(deps.current().design, s);

  return {
    space: shapingSpace(deps.genre),
    traits: { pure: true, alpha: true },

    read: () => stateFromDesign(deps.current().design, deps.genre),

    async apply(state, opts) {
      const design = designOf(state);
      const model = await modelFor(design, opts?.signal);
      if (opts?.signal?.aborted) return;
      deps.setOverride({ design, model });
      await nextPaint();
    },

    async render(state, { width, height, transparent, signal }): Promise<Frame> {
      const capture = deps.capture();
      if (!capture) throw new Error('The viewer is not ready to capture.');
      const design = designOf(state);
      const model = await modelFor(design, signal);
      const img = await capture({ design, model, width, height, transparent });
      return { width: img.width, height: img.height, data: img.data };
    },

    /** Back to the live view, and forget cached models. */
    release() {
      deps.setOverride(null);
      cache.clear();
    },
  };
}
