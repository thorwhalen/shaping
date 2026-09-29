/**
 * Types of the font module: what the catalogue says about a family (`FontEntry`), the seam that
 * supplies both the catalogue and the files (`FontProvider`), and the function the geometry
 * pipeline needs (`FontLoader`).
 */

/** One variable-font axis with its real range, e.g. `{ tag: 'wght', min: 100, default: 400, max: 900 }`. */
export interface FontAxis {
  /** Four-letter OpenType tag: `wght`, `wdth`, `opsz`, `slnt`, or a custom one such as `GRAD`. */
  tag: string;
  /** Human-readable name when the font gives one. */
  name?: string;
  min: number;
  default: number;
  max: number;
  /** Suggested slider step, when the catalogue gives one. */
  step?: number;
}

/** A family of the open-font catalogue. `id` is what a `Design` stores in `font`. */
export interface FontEntry {
  id: string;
  family: string;
  category: string;
  variable: boolean;
  /** Axes announced by the catalogue (the loaded font's own axes are the authority). */
  axes: FontAxis[];
  weights: number[];
  subsets: string[];
  /** The subset used by default (holds the basic Latin letters for most families). */
  defaultSubset: string;
  license: string;
  /** Where the catalogue got the family from, e.g. `google`. */
  origin: string;
}

/** Bytes of a font file (TTF, OTF, WOFF or WOFF2) for a catalogue id. */
export type FontLoader = (fontId: string) => Promise<Uint8Array>;

/** The seam: where the catalogue and the font files come from. The default is Fontsource. */
export interface FontProvider {
  /** Every family of the catalogue, without the icon fonts. */
  catalog(): Promise<FontEntry[]>;
  /** The font file of a family (the variable file when there is one). */
  load: FontLoader;
}

/** Options of the default provider. All optional. */
export interface FontsourceOptions {
  /** A `fetch`-compatible function. Default: the global one. */
  fetch?: typeof fetch;
  /** Base URL of the catalogue API. */
  apiBase?: string;
  /** Base URL of the file CDN. */
  cdnBase?: string;
  /** Supplies the catalogue instead of fetching it (an app that caches it passes its own). */
  catalog?: () => Promise<FontEntry[]>;
}
