/**
 * The one app store (zustand + immer). It holds the open `Design` and the interface state; the
 * `Model` is derived: the geometry worker rebuilds it whenever the design changes, and a newer
 * build supersedes an older one. Figures are cached per slot by their source and preparation, so
 * turning a genre dial never re-traces an image.
 */
import { produce } from 'immer';
import { prepareParams, type Design, type Figure, type Model } from 'shaping';
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
  edit(recipe: (d: Design) => void): void;
  setActiveSlot(slot: string): void;
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
  /** Resolve missing figures, then rebuild. Called after every change of the design. */
  async function refresh() {
    const d = get().design;
    if (!d) return;
    const genre = genres[d.genre];
    if (!genre) return set({ error: `Unknown genre "${d.genre}".` });
    set({ stale: true });
    clearTimeout(busyTimer);
    busyTimer = setTimeout(() => get().stale && set({ busy: true }), BUSY_AFTER_MS);

    const resolving = genre.slots.map(async (slot) => {
      const key = figureKey(d, slot.id);
      const have = get().figures[slot.id];
      if (have && have.key === key && have.figure) return;
      try {
        const figure = await geometry().resolve(slot.id, d.sources[slot.id], prepareParams(d, slot.id));
        if (figure) set((s) => ({ figures: { ...s.figures, [slot.id]: { key, figure, error: null } } }));
      } catch (e) {
        set((s) => ({ figures: { ...s.figures, [slot.id]: { key, figure: null, error: (e as Error).message } } }));
      }
    });
    await Promise.all(resolving);
    if (get().design !== d) return; // superseded while resolving

    const figs = get().figures;
    const missing = genre.slots.filter((s) => !figs[s.id]?.figure || figs[s.id].key !== figureKey(d, s.id));
    if (missing.length) {
      const why = missing.map((s) => figs[s.id]?.error).filter(Boolean).join(' ');
      return set({ stale: false, busy: false, error: why || null });
    }
    try {
      const model = await geometry().build(d, Object.fromEntries(genre.slots.map((s) => [s.id, figs[s.id].figure!])));
      if (!model || get().design !== d) return;
      set({ model, stale: false, busy: false, error: null });
    } catch (e) {
      if (get().design === d) set({ stale: false, busy: false, error: (e as Error).message });
    }
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
    stale: false,
    busy: false,
    error: null,
    masks: {},
    activeSlot: '',
    open(design) {
      flushSave();
      const slot = design ? (genres[design.genre]?.slots[0]?.id ?? '') : '';
      set({ design, model: null, figures: {}, masks: {}, error: null, activeSlot: slot });
      if (design) changed();
    },
    update(fn) {
      const d = get().design;
      if (!d) return;
      set({ design: fn(d) });
      changed();
    },
    edit(recipe) {
      const d = get().design;
      if (!d) return;
      set({ design: produce(d, recipe) });
      changed();
    },
    setActiveSlot: (slot) => set({ activeSlot: slot }),
  };
});
