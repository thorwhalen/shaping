/**
 * The one app store (zustand + immer). It holds the open `Design` and the interface state; the
 * `Model` is derived: the geometry worker rebuilds it whenever the design changes, and a newer
 * build supersedes an older one. Figures are cached per slot by their source and preparation, so
 * turning a genre dial never re-traces an image.
 */
import { produce } from 'immer';
import { flushPose } from '../viewer/Viewer';
import { emptyHistory, record, redo, undo, type History } from './history';
import { buildKey, prepareParams, type Design, type Figure, type Model } from 'shaping';
import { genres } from '../genres';
import { create } from 'zustand';
import type { MaskPreview } from '../worker/protocol';
import { geometry } from '../worker/client';
import { designs } from './designs';

/** How long a rebuild may take before the viewer shows a busy state. */
export const BUSY_AFTER_MS = 100;
/** Pause between the last change and the autosave. */
export const AUTOSAVE_AFTER_MS = 400;

interface FigureEntry {
  key: string;
  figure: Figure | null;
  error: string | null;
}

export interface AppState {
  design: Design | null;
  figures: Record<string, FigureEntry>;
  model: Model | null;
  /** Build key of the design the model was built for (its geometry). */
  modelKey: string;
  /** The model on screen is older than the design (a rebuild is running). */
  stale: boolean;
  /** A rebuild has been running for longer than BUSY_AFTER_MS. */
  busy: boolean;
  error: string | null;
  masks: Record<string, MaskPreview | null>;
  activeSlot: string;
  /** Replace the open design (null closes it). */
  open(design: Design | null): void;
  /** Change the open design with a function `(design) => design` (the shape of every user action). */
  update(fn: (d: Design) => Design): void;
  /** Change the open design in place with an immer recipe. */
  edit(recipe: (d: Design) => void, kind?: string): void;
  setActiveSlot(slot: string): void;
  /** A paced gesture (a slider drag) starts or ends: its changes form one undo step, however slowly they land. */
  setGesture(active: boolean): void;
  /** Undo and redo (every change to the design, grouped by pauses). */
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
}

const figureKey = (d: Design, slot: string) => JSON.stringify([d.sources[slot], prepareParams(d, slot)]);

let busyTimer: ReturnType<typeof setTimeout> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** The design edited last and not yet saved: saved when the timer fires, the design changes, or the page hides. */
let pendingSave: Design | null = null;

export function flushSave() {
  clearTimeout(saveTimer);
  const d = pendingSave;
  pendingSave = null;
  if (d) void designs.save(d);
}
if (typeof addEventListener !== 'undefined') addEventListener('pagehide', flushSave);

export const useApp = create<AppState>()((set, get) => {
  let refreshSeq = 0;
  let appliedSeq = 0;
  let builtKey = '';
  /** Key of the build in flight, if any: a display-only edit during a build must not start another. */
  let buildingKey = '';

  /**
   * Resolve missing figures, then rebuild. Called after every change of the design. Every call gets
   * a sequence number; a result is applied when it is newer than the one on screen, so while a dial
   * is dragged each finished intermediate model shows (live feedback) and the last one wins.
   * Changes that do not touch geometry (camera, light, material) skip the rebuild entirely.
   */
  async function refresh() {
    const d = get().design;
    if (!d) return;
    const genre = genres[d.genre];
    if (!genre) return set({ error: `Unknown genre "${d.genre}".` });
    const key = buildKey(d);
    if (key === builtKey && get().model) {
      // Back to what is on screen (e.g. the ghost thumb): nothing to build, and any build still
      // running for an intermediate value must not land on top of it.
      appliedSeq = ++refreshSeq;
      clearTimeout(busyTimer);
      set({ stale: false, busy: false });
      return;
    }
    if (key === buildingKey) return; // the build in flight already makes this model
    const seq = ++refreshSeq;
    buildingKey = key;
    set({ stale: true });
    clearTimeout(busyTimer);
    busyTimer = setTimeout(() => get().stale && set({ busy: true }), BUSY_AFTER_MS);

    await Promise.all(
      genre.slots.map(async (slot) => {
        const fkey = figureKey(d, slot.id);
        const have = get().figures[slot.id];
        if (have && have.key === fkey && have.figure) return;
        try {
          const figure = await geometry().resolve(slot.id, d.sources[slot.id], prepareParams(d, slot.id));
          if (figure) set((s) => ({ figures: { ...s.figures, [slot.id]: { key: fkey, figure, error: null } } }));
        } catch (e) {
          set((s) => ({ figures: { ...s.figures, [slot.id]: { key: fkey, figure: null, error: (e as Error).message } } }));
        }
      }),
    );
    const latest = () => seq === refreshSeq;
    const finished = () => void (buildingKey === key && (buildingKey = ''));
    const done = () => latest() && set({ stale: false, busy: false });
    const figs = get().figures;
    const missing = genre.slots.filter((s) => !figs[s.id]?.figure || figs[s.id].key !== figureKey(d, s.id));
    if (missing.length) {
      // A newer figure replaced this one: the newer refresh will build. Report errors only when latest.
      finished();
      if (latest()) set({ stale: false, busy: false, error: missing.map((s) => figs[s.id]?.error).filter(Boolean).join(' ') || null });
      return;
    }
    try {
      const model = await geometry().build(d, Object.fromEntries(genre.slots.map((s) => [s.id, figs[s.id].figure!])));
      finished();
      // Only a result for the open design, and newer than the one on screen, is applied.
      if (!model || seq < appliedSeq || get().design?.id !== d.id) return;
      appliedSeq = seq;
      builtKey = key;
      set({ model, modelKey: key, error: null });
      done();
    } catch (e) {
      finished();
      if (latest()) set({ stale: false, busy: false, error: (e as Error).message });
    }
  }

  let history: History<Design> = emptyHistory();
  /** `open`: a gesture is on and has not changed the design yet; `recorded`: its undo step exists. */
  let gesture: 'off' | 'open' | 'recorded' = 'off';

  /** Replace the design, remembering the old one for undo. */
  function commit(before: Design, after: Design, kind = 'edit') {
    if (after === before) return;
    history = record(history, before, Date.now(), kind, gesture === 'recorded');
    if (gesture === 'open') gesture = 'recorded';
    set({ design: after, canUndo: true, canRedo: false });
    changed();
  }

  function changed() {
    void refresh();
    const d = get().design;
    if (!d) return;
    clearTimeout(saveTimer);
    pendingSave = d;
    saveTimer = setTimeout(flushSave, AUTOSAVE_AFTER_MS);
  }

  return {
    design: null,
    figures: {},
    model: null,
    modelKey: '',
    stale: false,
    busy: false,
    error: null,
    masks: {},
    activeSlot: '',
    open(design) {
      flushSave();
      const slot = design ? (genres[design.genre]?.slots[0]?.id ?? '') : '';
      builtKey = '';
      buildingKey = '';
      history = emptyHistory();
      if (gesture !== 'off') gesture = 'open';
      // Anything still running for the previous design is now older than what is on screen.
      appliedSeq = ++refreshSeq;
      clearTimeout(busyTimer);
      set({ design, model: null, modelKey: '', figures: {}, masks: {}, error: null, stale: false, busy: false, activeSlot: slot, canUndo: false, canRedo: false });
      if (design) changed();
    },
    update(fn) {
      const d = get().design;
      if (!d) return;
      commit(d, fn(d));
    },
    edit(recipe, kind) {
      const d = get().design;
      if (!d) return;
      commit(d, produce(d, recipe), kind);
    },
    undo() {
      flushPose.current(); // an orbit still settling is part of what is undone
      const d = get().design;
      const r = d && undo(history, d);
      if (!r) return;
      history = r.history;
      if (gesture !== 'off') gesture = 'open';
      set({ design: r.value, canUndo: history.past.length > 0, canRedo: history.future.length > 0 });
      changed();
    },
    redo() {
      flushPose.current();
      const d = get().design;
      const r = d && redo(history, d);
      if (!r) return;
      history = r.history;
      if (gesture !== 'off') gesture = 'open';
      set({ design: r.value, canUndo: history.past.length > 0, canRedo: history.future.length > 0 });
      changed();
    },
    canUndo: false,
    canRedo: false,
    setActiveSlot: (slot) => set({ activeSlot: slot }),
    setGesture: (active) => void (gesture = active ? 'open' : 'off'),
  };
});
