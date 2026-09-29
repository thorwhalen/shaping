/**
 * Colour clustering for `split: 'colors'`: k-means over the foreground pixels' RGB values.
 *
 * Deterministic: the first centre is drawn with a fixed-seed generator, the others by
 * farthest-point selection, and Lloyd's iterations run on a bounded sample. The same image and
 * `k` always give the same clusters.
 */
import type { Mask } from '../types.js';
import type { RGBAImage } from './decode.js';

export interface ClusterOptions {
  seed?: number;
  maxIterations?: number;
  /** Most pixels used to fit the centres (all pixels are assigned afterwards). */
  sampleLimit?: number;
}

/** The fixed seed that makes clustering reproducible. */
export const CLUSTER_SEED = 0x5eed;
const MAX_ITERATIONS = 20;
const SAMPLE_LIMIT = 20000;
const RGB = 3;
/** Iteration stops when no centre moves by more than this many colour levels. */
const CONVERGED = 1e-6;

export interface ColorClusters {
  /** Cluster index per pixel, or -1 for pixels outside the mask. */
  labels: Int16Array;
  /** Mean colour of each cluster over its interior pixels; `counts[c]` is 0 for an empty cluster. */
  centers: Array<[number, number, number]>;
  counts: number[];
}

/** mulberry32: a tiny seeded generator returning floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dist2 = (r: number, g: number, b: number, c: ArrayLike<number>, o: number) => (r - c[o]) ** 2 + (g - c[o + 1]) ** 2 + (b - c[o + 2]) ** 2;

/** Cluster the mask's foreground pixels by colour into (at most) `k` groups. */
export function clusterColors(image: RGBAImage, mask: Mask, k: number, opts: ClusterOptions = {}): ColorClusters {
  const { seed = CLUSTER_SEED, maxIterations = MAX_ITERATIONS, sampleLimit = SAMPLE_LIMIT } = opts;
  const pixels: number[] = [];
  const interior: number[] = [];
  const { width: w, height: h, data: on } = mask;
  for (let i = 0; i < on.length; i++) {
    if (!on[i]) continue;
    pixels.push(i);
    const [x, y] = [i % w, Math.floor(i / w)];
    if (x > 0 && y > 0 && x < w - 1 && y < h - 1 && on[i - 1] && on[i + 1] && on[i - w] && on[i + w]) interior.push(i);
  }
  // Edge pixels are blends with the background, so the centres are fitted on interior pixels only.
  const fit = interior.length > 0 ? interior : pixels;
  const labels = new Int16Array(mask.data.length).fill(-1);
  const rgb = (i: number) => [image.data[i * 4], image.data[i * 4 + 1], image.data[i * 4 + 2]] as const;
  if (pixels.length === 0) return { labels, centers: [], counts: [] };

  const stride = Math.max(1, Math.ceil(fit.length / sampleLimit));
  const sample = fit.filter((_, i) => i % stride === 0);
  const rand = mulberry32(seed);
  const centers = new Float64Array(k * RGB);
  const first = rgb(sample[Math.floor(rand() * sample.length)]);
  centers.set(first, 0);
  const nearest = new Float64Array(sample.length).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let far = 0;
    for (let s = 0; s < sample.length; s++) {
      const [r, g, b] = rgb(sample[s]);
      nearest[s] = Math.min(nearest[s], dist2(r, g, b, centers, (c - 1) * RGB));
      if (nearest[s] > nearest[far]) far = s;
    }
    centers.set(rgb(sample[far]), c * RGB);
  }

  const assign = (i: number): number => {
    const [r, g, b] = rgb(i);
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < k; c++) {
      const d = dist2(r, g, b, centers, c * RGB);
      if (d < bestD) [bestD, best] = [d, c];
    }
    return best;
  };
  const recenter = (indices: number[], move = true): number[] => {
    const sums = new Float64Array(k * RGB);
    const counts = new Array<number>(k).fill(0);
    for (const i of indices) {
      const c = assign(i);
      const [r, g, b] = rgb(i);
      sums[c * RGB] += r;
      sums[c * RGB + 1] += g;
      sums[c * RGB + 2] += b;
      counts[c]++;
      labels[i] = c;
    }
    if (move) for (let c = 0; c < k; c++) if (counts[c]) for (let j = 0; j < RGB; j++) centers[c * RGB + j] = sums[c * RGB + j] / counts[c];
    return counts;
  };

  for (let it = 0; it < maxIterations; it++) {
    const before = Float64Array.from(centers);
    recenter(sample);
    if (before.every((v, j) => Math.abs(v - centers[j]) < CONVERGED)) break;
  }
  recenter(fit); // centres are the means of the interior pixels of each cluster
  const counts = recenter(pixels, false); // every pixel of the mask gets a label
  return { labels, centers: Array.from({ length: k }, (_, c) => [centers[c * RGB], centers[c * RGB + 1], centers[c * RGB + 2]] as [number, number, number]), counts };
}
