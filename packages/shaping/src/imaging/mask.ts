/**
 * From pixels to a mask: the threshold cascade.
 *
 * Default ("auto"): if the image has meaningful transparency, threshold the alpha channel at half;
 * otherwise blur slightly and split luminance at Otsu's value. The background is the class that
 * dominates the border pixels, and `invert` overrides that. The other modes are explicit:
 * "alpha", "luminance" (manual threshold, or Otsu when it is null), "color" (distance to a key
 * colour) and "adaptive" (local mean over a window, for line art and photographed paper).
 *
 * Every function reads the image and returns new arrays; the original is never modified.
 */
import type { PrepareParams } from '../design.js';
import type { Mask } from '../types.js';
import type { RGBAImage } from './decode.js';
import { gaussianBlur } from './morphology.js';

/** Alpha at or above this value is foreground ("threshold alpha at half"). */
export const ALPHA_HALF = 128;
/** Share of pixels that must be transparent (and, separately, opaque) for alpha to count as meaningful. */
export const ALPHA_MEANINGFUL_SHARE = 0.005;
/** Standard deviation, in pixels, of the slight blur applied before Otsu. */
export const LUMINANCE_BLUR_SIGMA = 1;

const LEVELS = 256;
const MAX_LEVEL = LEVELS - 1;
/** Rec. 709 luma weights. */
const LUMA = [0.2126, 0.7152, 0.0722] as const;
/** Length of the RGB diagonal, which normalises a colour distance to [0, 1]. */
const RGB_DIAGONAL = MAX_LEVEL * Math.sqrt(3);

/** A mask and the luminance threshold that is (or would be) used, for the UI to display. */
export interface MaskResult {
  mask: Mask;
  /** Luminance threshold 0-255: pixels at or below it are "dark". Otsu's value unless set manually. */
  threshold: number;
}

/** True when both transparent and opaque pixels are common enough for the alpha channel to carry the shape. */
export function hasMeaningfulAlpha(image: RGBAImage, share = ALPHA_MEANINGFUL_SHARE): boolean {
  const { data } = image;
  const n = image.width * image.height;
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < ALPHA_HALF) transparent++;
  return transparent >= share * n && n - transparent >= share * n;
}

/** Luminance per pixel (0-255), composited over white so that transparent pixels read as paper. */
export function luminance(image: RGBAImage): Float32Array {
  const { data } = image;
  const out = new Float32Array(image.width * image.height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const a = data[p + 3] / MAX_LEVEL;
    const lum = LUMA[0] * data[p] + LUMA[1] * data[p + 1] + LUMA[2] * data[p + 2];
    out[i] = lum * a + MAX_LEVEL * (1 - a);
  }
  return out;
}

/** Otsu's threshold of a 256-bin histogram: the level maximising between-class variance. Class 0 is `<= level`. */
export function otsuThreshold(histogram: ArrayLike<number>): number {
  let total = 0;
  let sumAll = 0;
  for (let i = 0; i < LEVELS; i++) {
    total += histogram[i];
    sumAll += i * histogram[i];
  }
  let weightLow = 0;
  let sumLow = 0;
  let best = 0;
  let bestVariance = -1;
  for (let t = 0; t < LEVELS; t++) {
    weightLow += histogram[t];
    if (weightLow === 0) continue;
    const weightHigh = total - weightLow;
    if (weightHigh === 0) break;
    sumLow += t * histogram[t];
    const meanLow = sumLow / weightLow;
    const meanHigh = (sumAll - sumLow) / weightHigh;
    const variance = weightLow * weightHigh * (meanLow - meanHigh) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = t;
    }
  }
  return best;
}

function histogramOf(lum: Float32Array): Uint32Array {
  const h = new Uint32Array(LEVELS);
  for (let i = 0; i < lum.length; i++) h[Math.min(MAX_LEVEL, Math.max(0, Math.round(lum[i])))]++;
  return h;
}

/** Parse `#rgb`, `#rrggbb` (or without the `#`) into 0-255 channels. Throws on anything else. */
export function parseHexColor(color: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) throw new Error(`Invalid colour "${color}": use a hex colour such as #1a2b3c.`);
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Format 0-255 channels as `#rrggbb`. */
export function toHexColor(rgb: ArrayLike<number>): string {
  return '#' + [0, 1, 2].map((i) => Math.round(Math.min(MAX_LEVEL, Math.max(0, rgb[i]))).toString(16).padStart(2, '0')).join('');
}

/** Foreground = pixels of the class that does NOT dominate the border. `dark[i]` is the class per pixel. */
function foregroundAgainstBorder(dark: Uint8Array, width: number, height: number): Uint8Array {
  let darkBorder = 0;
  let total = 0;
  const visit = (i: number) => {
    darkBorder += dark[i];
    total++;
  };
  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  const backgroundIsDark = darkBorder * 2 > total;
  return dark.map((v) => (backgroundIsDark ? 1 - v : v));
}

function alphaMask(image: RGBAImage): Uint8Array {
  const out = new Uint8Array(image.width * image.height);
  for (let i = 0; i < out.length; i++) out[i] = image.data[i * 4 + 3] >= ALPHA_HALF ? 1 : 0;
  return out;
}

function colorMask(image: RGBAImage, key: string, tolerance: number): Uint8Array {
  const [kr, kg, kb] = parseHexColor(key);
  const out = new Uint8Array(image.width * image.height);
  const { data } = image;
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    if (data[p + 3] < ALPHA_HALF) continue;
    const d = Math.hypot(data[p] - kr, data[p + 1] - kg, data[p + 2] - kb) / RGB_DIAGONAL;
    out[i] = d <= tolerance ? 1 : 0;
  }
  return out;
}

/** Local-mean threshold through an integral image: dark features are pixels below (mean - offset). */
function adaptiveMask(lum: Float32Array, width: number, height: number, window: number, offset: number): Uint8Array {
  const stride = width + 1;
  const integral = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += lum[y * width + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
    }
  }
  const r = window >> 1;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height, y + r + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width, x + r + 1);
      const sum = integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      out[y * width + x] = lum[y * width + x] < mean - offset ? 1 : 0;
    }
  }
  return out;
}

/**
 * Threshold an image into a mask following `prepare.mode`, then apply `prepare.invert`.
 * Returns the luminance threshold too (Otsu's value unless set manually), so an interface can
 * show it and start its slider there. No morphology happens here: see `cleanMask`.
 */
export function imageToMask(image: RGBAImage, prepare: Pick<PrepareParams, 'mode' | 'threshold' | 'invert' | 'color' | 'tolerance' | 'window' | 'offset'>): MaskResult {
  const { width, height } = image;
  const blurred = gaussianBlur(luminance(image), width, height, LUMINANCE_BLUR_SIGMA);
  const otsu = otsuThreshold(histogramOf(blurred));
  const threshold = prepare.threshold ?? otsu;
  const luminanceMask = () => {
    const dark = new Uint8Array(blurred.length);
    for (let i = 0; i < dark.length; i++) dark[i] = blurred[i] <= threshold ? 1 : 0;
    return foregroundAgainstBorder(dark, width, height);
  };
  const mode = prepare.mode === 'auto' ? (hasMeaningfulAlpha(image) ? 'alpha' : 'luminance') : prepare.mode;
  let data: Uint8Array;
  switch (mode) {
    case 'alpha':
      data = alphaMask(image);
      break;
    case 'color':
      data = colorMask(image, prepare.color, prepare.tolerance);
      break;
    case 'adaptive':
      data = adaptiveMask(blurred, width, height, prepare.window, prepare.offset);
      break;
    default:
      data = luminanceMask();
  }
  if (prepare.invert) data = data.map((v) => 1 - v);
  return { mask: { width, height, data }, threshold };
}
