/**
 * Showing each family's name in its own face, cheaply.
 *
 * For Google-origin families the Google Fonts CSS API is asked for only the letters of the name
 * (`text=`), which returns a font of a few hundred bytes, not the family. For the other families
 * (from other foundries, not on Google Fonts) the Fontsource Latin file is loaded through the
 * FontFace API instead. Either way it happens only for rows that scroll into view, once per family.
 *
 * Privacy: the requests carry only the family name.
 */
import { FONTSOURCE_CDN, type FontEntry } from 'shaping/fonts';

const CSS_API = 'https://fonts.googleapis.com/css2';
const GOOGLE_ORIGIN = 'google';

/** The CSS API URL for the family's name in its own face (pure). */
export function previewCssUrl(family: string): string {
  const name = encodeURIComponent(family).replace(/%20/g, '+');
  return `${CSS_API}?family=${name}&text=${encodeURIComponent(family)}&display=swap`;
}

/** The CSS `font-family` value to draw a family's name with, after `ensurePreview` resolved. */
export const previewFontFamily = (e: FontEntry): string =>
  e.origin === GOOGLE_ORIGIN ? `"${e.family.replace(/"/g, '')}", sans-serif` : `"shaping-preview-${e.id}", sans-serif`;

const started = new Map<string, Promise<void>>();

function loadGoogle(e: FontEntry): Promise<void> {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = previewCssUrl(e.family);
    link.onload = () => void document.fonts.load(`16px ${previewFontFamily(e)}`, e.family).then(() => resolve(), reject);
    link.onerror = () => reject(new Error(`Could not load the preview of ${e.family}`));
    document.head.appendChild(link);
  });
}

async function loadFontsource(e: FontEntry): Promise<void> {
  const subset = e.subsets.includes('latin') ? 'latin' : e.defaultSubset;
  const face = new FontFace(`shaping-preview-${e.id}`, `url(${FONTSOURCE_CDN}/${e.id}@latest/${subset}-400-normal.woff2)`);
  document.fonts.add(await face.load());
}

/** Load a family's name-preview face (once); resolves when the name can be drawn in it. */
export function ensurePreview(e: FontEntry): Promise<void> {
  let p = started.get(e.id);
  if (!p) started.set(e.id, (p = (e.origin === GOOGLE_ORIGIN ? loadGoogle(e) : loadFontsource(e)).catch((err) => (started.delete(e.id), Promise.reject(err)))));
  return p;
}
