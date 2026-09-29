/**
 * The app's font provider: Fontsource (the library's default) behind the browser cache. One shared
 * instance per context; the page and the geometry worker each make their own and share the
 * IndexedDB store, so a font the page has loaded is already on disk when the worker asks for it.
 *
 * Privacy: the only requests made are for the catalogue and for font files. Nothing of the design,
 * the text or the user leaves the browser.
 */
import { fontsourceProvider, type FontProvider } from 'shaping/fonts';
import { cachedCatalog, cachedLoader, indexedDbFontStore } from './cache';
import { COMMON_FONT_IDS } from './common';

let instance: FontProvider | null = null;

/** The cached provider (created on first use). */
export function fontProvider(): FontProvider {
  if (!instance) {
    const store = indexedDbFontStore();
    const catalog = cachedCatalog(fontsourceProvider().catalog, store);
    const base = fontsourceProvider({ catalog });
    instance = { catalog, load: cachedLoader(base.load, store, { keep: new Set(COMMON_FONT_IDS) }) };
  }
  return instance;
}
