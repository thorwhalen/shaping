/**
 * The default font provider: Fontsource.
 *
 * - The catalogue is two key-less JSON documents of the Fontsource API: the list of families
 *   (`/v1/fonts`: family, category, weights, subsets, licence) and the table of variable axes
 *   (`/v1/variable`: tag, min, default, max). About 2100 open families, 570 of them variable.
 * - A family's file comes from the jsDelivr mirror of the Fontsource packages: a variable file
 *   (WOFF2, decoded by `decode.ts`) when the family has one, else the static TTF nearest to
 *   regular weight. Which variable file exists differs per family, so candidates are tried in order.
 *
 * Nothing here needs a key, and nothing but font requests leaves the machine. Replace the whole
 * thing by giving `resolvers.loadFont` another function, or by implementing `FontProvider`.
 */
import type { FontAxis, FontEntry, FontLoader, FontProvider, FontsourceOptions } from './types.js';

export const FONTSOURCE_API = 'https://api.fontsource.org/v1';
export const FONTSOURCE_CDN = 'https://cdn.jsdelivr.net/fontsource/fonts';
/** Categories left out of the catalogue: they hold symbols, not letters. */
const EXCLUDED_CATEGORIES = new Set(['icons']);
/** The weight a static family is loaded at, when it has it, else the nearest one. */
const PREFERRED_WEIGHT = 400;
const FALLBACK_SUBSET = 'latin';
/** Names of the variable files of a family, in order of preference: every axis, then the usual ones. */
const VARIABLE_FILE_KINDS = ['full', 'standard', 'wght', 'wdth', 'opsz'];
/** Axes that Fontsource ships as separate files (italic) and so never name a file. */
const NON_FILE_AXES = new Set(['ital', 'slnt']);
const NOT_FOUND = 404;

interface RawFamily {
  id: string;
  family: string;
  category: string;
  variable: boolean;
  weights: number[];
  styles: string[];
  subsets: string[];
  defSubset: string;
  license: string;
  type: string;
}
type RawAxes = Record<string, { family: string; axes: Record<string, { default: string; min: string; max: string; step: string }> }>;

const toAxes = (raw: RawAxes[string] | undefined): FontAxis[] =>
  Object.entries(raw?.axes ?? {}).map(([tag, a]) => ({ tag, min: Number(a.min), default: Number(a.default), max: Number(a.max), step: Number(a.step) }));

/** Merge Fontsource's two documents into catalogue entries (pure). */
export function mergeCatalog(families: RawFamily[], variable: RawAxes): FontEntry[] {
  return families
    .filter((f) => !EXCLUDED_CATEGORIES.has(f.category))
    .map((f) => ({
      id: f.id,
      family: f.family,
      category: f.category,
      variable: f.variable,
      axes: f.variable ? toAxes(variable[f.id]) : [],
      weights: f.weights,
      subsets: f.subsets,
      defaultSubset: f.defSubset,
      license: f.license,
      origin: f.type,
    }));
}

/** The subset that holds the basic letters: Latin when the family has it. */
const subsetOf = (e: FontEntry): string => (e.subsets.includes(FALLBACK_SUBSET) ? FALLBACK_SUBSET : e.defaultSubset);

/** The weight of a static family closest to regular. */
export function nearestWeight(weights: number[], target = PREFERRED_WEIGHT): number {
  return weights.reduce((best, w) => (Math.abs(w - target) < Math.abs(best - target) ? w : best), weights[0] ?? target);
}

/** URLs to try, in order, for a family's font file. The first that exists is used. */
export function fontFileCandidates(entry: FontEntry, cdnBase: string = FONTSOURCE_CDN): string[] {
  const subset = subsetOf(entry);
  const out: string[] = [];
  if (entry.variable) {
    const axisKinds = entry.axes.map((a) => a.tag).filter((t) => !NON_FILE_AXES.has(t));
    for (const kind of new Set([...VARIABLE_FILE_KINDS, ...axisKinds])) out.push(`${cdnBase}/${entry.id}:vf@latest/${subset}-${kind}-normal.woff2`);
  }
  const weight = nearestWeight(entry.weights);
  out.push(`${cdnBase}/${entry.id}@latest/${subset}-${weight}-normal.ttf`, `${cdnBase}/${entry.id}@latest/${subset}-${weight}-normal.woff2`);
  return out;
}

/** The default provider: catalogue and files from Fontsource. The catalogue is fetched once. */
export function fontsourceProvider(opts: FontsourceOptions = {}): FontProvider {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const apiBase = opts.apiBase ?? FONTSOURCE_API;
  const cdnBase = opts.cdnBase ?? FONTSOURCE_CDN;
  let entries: Promise<FontEntry[]> | null = null;

  const getJson = async <T>(url: string): Promise<T> => {
    const res = await doFetch(url);
    if (!res.ok) throw new Error(`Could not load the font catalogue (${url}): ${res.status}`);
    return (await res.json()) as T;
  };
  const fetchCatalog = () =>
    (entries ??= Promise.all([getJson<RawFamily[]>(`${apiBase}/fonts`), getJson<RawAxes>(`${apiBase}/variable`)])
      .then(([f, v]) => mergeCatalog(f, v))
      .catch((e) => {
        entries = null;
        throw e;
      }));
  const catalog = opts.catalog ?? fetchCatalog;

  const load: FontLoader = async (fontId) => {
    const entry = (await catalog()).find((e) => e.id === fontId);
    if (!entry) throw new Error(`Unknown font "${fontId}": it is not in the catalogue.`);
    for (const url of fontFileCandidates(entry, cdnBase)) {
      const res = await doFetch(url);
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
      if (res.status !== NOT_FOUND) throw new Error(`Could not load font "${fontId}" (${url}): ${res.status}`);
    }
    throw new Error(`No font file found for "${fontId}".`);
  };
  return { catalog, load };
}

let shared: FontProvider | null = null;

/** The loader `build()` uses unless told otherwise: one shared Fontsource provider, so the catalogue is fetched once per process. */
export const defaultFontLoader: FontLoader = (fontId) => (shared ??= fontsourceProvider()).load(fontId);
