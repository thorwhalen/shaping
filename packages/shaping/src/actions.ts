/**
 * User actions: plain functions `(design, ...args) => design`, never mutating their input.
 * This is the shape a command registry (a palette, hotkeys, an AI tool surface) wraps, so adding
 * one later is an addition, not a rewrite.
 */
import type { GenreTable } from './build.js';
import { DESIGN_VERSION, parseDesign, type Design, type Source, type SourceInput } from './design.js';

const randomId = () => Math.random().toString(36).slice(2, 10);

/** A new design for a genre, with starter sources and default parameters. */
export function newDesign(genreId: string, genres: GenreTable, { id = randomId(), title }: { id?: string; title?: string } = {}): Design {
  const genre = genres[genreId];
  if (!genre) throw new Error(`Unknown genre "${genreId}". Available: ${Object.keys(genres).join(', ')}`);
  const fallback: SourceInput = { kind: 'shape', shape: 'circle' };
  const sources = Object.fromEntries(genre.slots.map((s) => [s.id, genre.starter?.[s.id] ?? fallback]));
  return parseDesign({ version: DESIGN_VERSION, id, title: title ?? genre.title, genre: genreId, sources, params: {} });
}

/** Copy a design under a new id (opening a gallery entry makes a copy). */
export function copyDesign(design: Design, { id = randomId(), title }: { id?: string; title?: string } = {}): Design {
  return { ...structuredClone(design), id, title: title ?? design.title };
}

/** Immutably set a value at a dotted path inside an object; missing objects on the way are created. */
export function setPath<T extends object>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.');
  const o = (obj ?? {}) as Record<string, unknown>;
  return { ...o, [head]: rest.length ? setPath((o[head] ?? {}) as object, rest.join('.'), value) : value } as T;
}

/** Read the value at a dotted path, or undefined. */
export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** Set a genre parameter by dotted path, e.g. `placement.front.scale`. */
export const setParam = (d: Design, path: string, value: unknown): Design => ({ ...d, params: setPath(d.params, path, value) });

/** Replace the source of one slot. Preparation parameters are kept. */
export const setSource = (d: Design, slot: string, source: Source): Design => ({ ...d, sources: { ...d.sources, [slot]: source } });

/** Set one preparation parameter of a slot. */
export const setPrepare = (d: Design, slot: string, key: string, value: unknown): Design => ({ ...d, prepare: { ...d.prepare, [slot]: { ...(d.prepare[slot] ?? {}), [key]: value } } });

/**
 * Switch to another genre, losing nothing: the current genre's sources, preparation and parameters
 * are kept in `genreState`, and the target genre's come back from there if it was used before (else
 * slots with the same id keep their source, and the others get starters).
 */
export function switchGenre(d: Design, genreId: string, genres: GenreTable): Design {
  if (genreId === d.genre) return d;
  const fresh = newDesign(genreId, genres, { id: d.id, title: d.title });
  const kept = { ...(d.genreState ?? {}), [d.genre]: { sources: d.sources, prepare: d.prepare, params: d.params } };
  const back = kept[genreId];
  const sources = back ? back.sources : Object.fromEntries(Object.entries(fresh.sources).map(([slot, s]) => [slot, d.sources[slot] ?? s]));
  const { [genreId]: _restored, ...others } = kept;
  void _restored;
  // The sequence stays: its views keep their camera and light; dials of another genre are dropped when shown.
  return {
    ...fresh,
    sources,
    prepare: back ? back.prepare : {},
    params: back ? back.params : fresh.params,
    genreState: { ...others, [d.genre]: kept[d.genre] },
    style: d.style,
    view: d.view,
    sizeMm: d.sizeMm,
    ...(d.sequence ? { sequence: d.sequence } : {}),
  };
}
