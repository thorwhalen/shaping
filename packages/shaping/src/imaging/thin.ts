/**
 * Printability overlay: where is the shape thinner than a given width?
 *
 * A morphological opening tested through the distance field. A pixel survives the opening when a
 * disc of radius `minWidth / 2` fits inside the shape and covers it; the regions that do not
 * survive are thinner than `minWidth`. Widths are measured to within one pixel. Sharp convex
 * corners are also flagged, as an opening always rounds them.
 */
import type { Mask } from '../types.js';
import { distanceTransform } from './morphology.js';

/** Regions of `mask` thinner than `minWidthPx` pixels, as a mask of the same size. */
export function thinFeatures(mask: Mask, minWidthPx: number): Mask {
  const { width: w, height: h, data } = mask;
  const out = new Uint8Array(w * h);
  if (minWidthPx <= 0) return { width: w, height: h, data: out };
  const radius = minWidthPx / 2;
  const background = data.map((v) => (v ? 0 : 1));
  // Distance to the nearest background pixel, with the image border counted as background.
  const inside = distanceTransform(padWithBackground(background, w, h), w + 2, h + 2);
  const core = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) core[y * w + x] = data[y * w + x] && inside[(y + 1) * (w + 2) + x + 1] >= radius ? 1 : 0;
  const toCore = distanceTransform(core, w, h);
  for (let i = 0; i < out.length; i++) out[i] = data[i] && toCore[i] > radius ? 1 : 0;
  return { width: w, height: h, data: out };
}

/** Surround a feature map with a one-pixel frame of features (the outside counts as background). */
function padWithBackground(feature: Uint8Array, w: number, h: number): Uint8Array {
  const W = w + 2;
  const out = new Uint8Array(W * (h + 2)).fill(1);
  for (let y = 0; y < h; y++) out.set(feature.subarray(y * w, (y + 1) * w), (y + 1) * W + 1);
  return out;
}
