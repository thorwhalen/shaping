/**
 * Morphology over masks and float fields, hand-written over typed arrays.
 *
 * Connected components (with a stated connectivity), despeckling, hole filling, the exact
 * Euclidean distance transform (Felzenszwalb and Huttenlocher, 2012), the signed distance field
 * and separable blurs of a float field. Every function returns new arrays; none mutates its input.
 */
import type { Mask } from '../types.js';

/** Pixel connectivity: 4 = edge neighbours only, 8 = edge and corner neighbours. */
export type Connectivity = 4 | 8;

/** Foreground components are 8-connected by default; background (holes) is then 4-connected. */
export const FOREGROUND_CONNECTIVITY: Connectivity = 8;
export const BACKGROUND_CONNECTIVITY: Connectivity = 4;

/** Stand-in for "no feature here" in the squared-distance passes (large, but sums stay finite). */
const FAR = 1e20;

/** The boundary lies half a pixel from the centres of the nearest inside and outside pixels. */
const HALF_PIXEL = 0.5;

/** Kernel radius of a Gaussian blur, in standard deviations. */
const GAUSSIAN_RADIUS_SIGMAS = 3;

const NEIGHBOURS_4: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const NEIGHBOURS_8: ReadonlyArray<readonly [number, number]> = [...NEIGHBOURS_4, [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** The result of labelling: `labels[i]` is 0 for background, else the component number 1..count. */
export interface Labeling {
  labels: Int32Array;
  count: number;
  /** Pixel count per label, indexed by label. `areas[0]` is the number of background pixels. */
  areas: Int32Array;
}

/** A new empty (all background) mask. */
export function emptyMask(width: number, height: number): Mask {
  return { width, height, data: new Uint8Array(width * height) };
}

/** Number of foreground pixels. */
export function maskArea(mask: Mask): number {
  let n = 0;
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i]) n++;
  return n;
}

/** Label the connected components of the foreground (flood fill with an explicit stack). */
export function labelComponents(mask: Mask, connectivity: Connectivity = FOREGROUND_CONNECTIVITY): Labeling {
  const { width: w, height: h, data } = mask;
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const nb = connectivity === 8 ? NEIGHBOURS_8 : NEIGHBOURS_4;
  const areas: number[] = [0];
  let count = 0;
  let foreground = 0;
  for (let start = 0; start < data.length; start++) {
    if (!data[start] || labels[start]) continue;
    const label = ++count;
    let sp = 0;
    let area = 0;
    stack[sp++] = start;
    labels[start] = label;
    while (sp > 0) {
      const p = stack[--sp];
      area++;
      const x = p % w;
      const y = (p - x) / w;
      for (const [dx, dy] of nb) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (data[q] && !labels[q]) {
          labels[q] = label;
          stack[sp++] = q;
        }
      }
    }
    areas.push(area);
    foreground += area;
  }
  areas[0] = w * h - foreground;
  return { labels, count, areas: Int32Array.from(areas) };
}

/**
 * Drop foreground components smaller than `minShare` of the image area (8-connected by default).
 * The largest component is always kept, so a mask never becomes empty by despeckling alone.
 */
export function removeSmallComponents(mask: Mask, minShare: number, connectivity: Connectivity = FOREGROUND_CONNECTIVITY): Mask {
  const { labels, count, areas } = labelComponents(mask, connectivity);
  const minPixels = minShare * mask.width * mask.height;
  let largest = 0;
  for (let l = 1; l <= count; l++) if (areas[l] > areas[largest]) largest = l;
  const keep = new Uint8Array(count + 1);
  for (let l = 1; l <= count; l++) keep[l] = areas[l] >= minPixels || l === largest ? 1 : 0;
  const data = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i++) data[i] = keep[labels[i]];
  return { width: mask.width, height: mask.height, data };
}

/** Fill holes: background regions (4-connected) that do not touch the image border become foreground. */
export function fillHoles(mask: Mask): Mask {
  const { width: w, height: h, data } = mask;
  const inverted: Mask = { width: w, height: h, data: data.map((v) => (v ? 0 : 1)) };
  const { labels, count } = labelComponents(inverted, BACKGROUND_CONNECTIVITY);
  const open = new Uint8Array(count + 1);
  for (let x = 0; x < w; x++) open[labels[x]] = open[labels[(h - 1) * w + x]] = 1;
  for (let y = 0; y < h; y++) open[labels[y * w]] = open[labels[y * w + w - 1]] = 1;
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] || (labels[i] && !open[labels[i]]) ? 1 : 0;
  return { width: w, height: h, data: out };
}

/** One-dimensional squared distance transform of `f` (length n) into `d`; scratch arrays are reused. */
function squaredDistance1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}

/**
 * Exact Euclidean distance from every pixel to the nearest pixel whose `feature` byte is non-zero
 * (Felzenszwalb and Huttenlocher). Feature pixels get 0. With no features every distance is
 * `width + height`, a finite stand-in for infinity.
 */
export function distanceTransform(feature: Uint8Array, width: number, height: number): Float32Array {
  const n = Math.max(width, height);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const sq = new Float64Array(width * height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = feature[y * width + x] ? 0 : FAR;
    squaredDistance1d(f, height, d, v, z);
    for (let y = 0; y < height; y++) sq[y * width + x] = d[y];
  }
  const out = new Float32Array(width * height);
  const cap = width + height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = sq[y * width + x];
    squaredDistance1d(f, width, d, v, z);
    for (let x = 0; x < width; x++) out[y * width + x] = Math.min(Math.sqrt(d[x]), cap);
  }
  return out;
}

/**
 * Signed distance field of a mask, in pixels: positive inside, negative outside, zero on the
 * boundary, which lies half a pixel from the centres of the nearest inside and outside pixels.
 */
export function signedDistanceField(mask: Mask): Float32Array {
  const { width: w, height: h, data } = mask;
  const inside = data.map((v) => (v ? 1 : 0));
  const outside = data.map((v) => (v ? 0 : 1));
  const toOutside = distanceTransform(outside, w, h);
  const toInside = distanceTransform(inside, w, h);
  const sdf = new Float32Array(w * h);
  for (let i = 0; i < sdf.length; i++) sdf[i] = data[i] ? toOutside[i] - HALF_PIXEL : -(toInside[i] - HALF_PIXEL);
  return sdf;
}

/** Gaussian blur of a float field (separable, edge values repeated). `sigma <= 0` returns a copy. */
export function gaussianBlur(field: Float32Array, width: number, height: number, sigma: number): Float32Array {
  if (sigma <= 0) return field.slice();
  const r = Math.max(1, Math.ceil(GAUSSIAN_RADIUS_SIGMAS * sigma));
  const kernel = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += kernel[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  return convolveSeparable(field, width, height, kernel, r);
}

/** Box blur of a float field with the given radius in pixels (window 2r + 1), edge values repeated. */
export function boxBlur(field: Float32Array, width: number, height: number, radius: number): Float32Array {
  const r = Math.floor(radius);
  if (r <= 0) return field.slice();
  const kernel = new Float32Array(2 * r + 1).fill(1 / (2 * r + 1));
  return convolveSeparable(field, width, height, kernel, r);
}

function convolveSeparable(field: Float32Array, w: number, h: number, kernel: Float32Array, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += kernel[i + r] * field[row + Math.min(w - 1, Math.max(0, x + i))];
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += kernel[i + r] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x];
      out[y * w + x] = s;
    }
  }
  return out;
}
