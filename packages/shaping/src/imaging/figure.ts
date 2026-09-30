/**
 * From a mask (or an image) to a `Figure`: cleanup, tracing and splitting into parts.
 *
 * Order of operations: threshold, drop small components, fill holes (optional), then the traced
 * contour of the smoothed distance field (see `trace.ts`). Parts are the connected components of
 * the traced shape (`split: 'components'`), the whole shape (`'none'`), or one per colour cluster
 * (`'colors'`, each cluster going through the same stages). Ids are `c1`, `c2`, ... by area,
 * largest first. Figures are in pixels of the working image, y up.
 */
import type { PrepareParams } from '../design.js';
import type { Kernel } from '../kernel/types.js';
import type { Figure, Mask, Part, Polygon } from '../types.js';
import { clusterColors } from './cluster.js';
import { resizeImage, type RGBAImage } from './decode.js';
import { imageToMask, toHexColor } from './mask.js';
import { fillHoles, maskArea, removeSmallComponents } from './morphology.js';
import { thinFeatures } from './thin.js';
import { polygonArea, traceMask, traceRings, type TraceOptions } from './trace.js';

/** What the imaging functions need from their caller: the kernel that does the 2D booleans. */
export interface ImagingContext {
  kernel: Kernel;
}

/** Prefix of generated part ids: `c1`, `c2`, ... */
const PART_ID_PREFIX = 'c';

/** The id of the n-th part (0-based), by area, largest first: `c1`, `c2`, ... */
export const partId = (index: number): string => `${PART_ID_PREFIX}${index + 1}`;

const traceOptionsOf = (p: Pick<PrepareParams, 'grow' | 'smooth' | 'simplify'>): TraceOptions => ({ grow: p.grow, smooth: p.smooth, simplify: p.simplify });

/** Despeckle and (optionally) fill holes: the mask stages between thresholding and tracing. */
export function cleanMask(mask: Mask, prepare: Pick<PrepareParams, 'minArea' | 'fillHoles'>): Mask {
  const despeckled = removeSmallComponents(mask, prepare.minArea);
  return prepare.fillHoles ? fillHoles(despeckled) : despeckled;
}

/** The result of `prepareMask`, for a live mask preview. */
export interface PreparedMask {
  /** The cleaned mask that tracing would consume. */
  mask: Mask;
  /** Luminance threshold in use (Otsu's value unless set manually). */
  threshold: number;
  /** Regions thinner than `minWidthPx`, when that was asked for. */
  thin?: Mask;
}

/** Everything before tracing: resize, threshold, despeckle, fill. `minWidthPx` adds the thin-feature overlay. */
export function prepareMask(image: RGBAImage, prepare: PrepareParams, opts: { minWidthPx?: number } = {}): PreparedMask {
  const { mask, threshold } = imageToMask(resizeImage(image, prepare.maxSize), prepare);
  const cleaned = cleanMask(mask, prepare);
  return opts.minWidthPx ? { mask: cleaned, threshold, thin: thinFeatures(cleaned, opts.minWidthPx) } : { mask: cleaned, threshold };
}

const EMPTY_MASK_HELP = 'The mask is empty: nothing in the image was picked as the shape. Try "Invert", another threshold, or another mask mode.';

/**
 * Trace a mask into a figure. `image` (the same size as the mask) is needed only for
 * `split: 'colors'`, which clusters the foreground pixels by colour.
 */
export function maskToFigure(mask: Mask, prepare: PrepareParams, ctx: ImagingContext, image?: RGBAImage): Figure {
  const cleaned = cleanMask(mask, prepare);
  if (maskArea(cleaned) === 0) throw new Error(EMPTY_MASK_HELP);
  const trace = traceOptionsOf(prepare);
  let parts: Array<Omit<Part, 'id'>>;
  if (prepare.split === 'colors') parts = colorParts(cleaned, prepare, ctx, image);
  else if (prepare.split === 'none') parts = [{ polygons: traceMask(cleaned, trace, ctx.kernel) }];
  else parts = componentParts(cleaned, trace, ctx.kernel);
  parts = parts.filter((p) => p.polygons.length > 0);
  if (parts.length === 0) throw new Error(`${EMPTY_MASK_HELP} (Tracing found no contour: check "Thicken" and "Smooth".)`);
  const areaOf = (p: Omit<Part, 'id'>) => p.polygons.reduce((s, g) => s + polygonArea(g), 0);
  parts.sort((a, b) => areaOf(b) - areaOf(a));
  // The image is the frame (y up, as traced).
  return { units: 'px', frame: { min: [0, 0], max: [cleaned.width, cleaned.height] }, parts: parts.map((p, i) => ({ id: partId(i), ...p })) };
}

/** Parts = connected components of the traced, unioned shape (so grown shapes that merge become one part). */
function componentParts(mask: Mask, trace: TraceOptions, kernel: Kernel): Array<Omit<Part, 'id'>> {
  const polygons = traceRings(mask, trace);
  if (polygons.length === 0) return [];
  return kernel.scope(() => kernel.components2(kernel.region(polygons)).map((r) => ({ polygons: kernel.polygons(r) })));
}

function colorParts(mask: Mask, prepare: PrepareParams, ctx: ImagingContext, image?: RGBAImage): Array<Omit<Part, 'id'>> {
  if (!image) throw new Error('split "colors" needs the source image: pass it as the fourth argument.');
  if (image.width !== mask.width || image.height !== mask.height) {
    throw new Error(`The image (${image.width}x${image.height}) and the mask (${mask.width}x${mask.height}) differ in size: resize the image to the working size first.`);
  }
  const { labels, centers, counts } = clusterColors(image, mask, prepare.colors);
  const trace = traceOptionsOf(prepare);
  const parts: Array<Omit<Part, 'id'>> = [];
  centers.forEach((center, c) => {
    if (!counts[c]) return;
    const clusterMask: Mask = { width: mask.width, height: mask.height, data: Uint8Array.from(labels, (l) => (l === c ? 1 : 0)) };
    const cleaned = cleanMask(clusterMask, prepare);
    if (maskArea(cleaned) === 0) return;
    const polygons: Polygon[] = traceMask(cleaned, trace, ctx.kernel);
    parts.push({ polygons, color: toHexColor(center) });
  });
  return parts;
}

/** The whole raster chain: resize to the working size, threshold, clean, trace, split. */
export function imageToFigure(image: RGBAImage, prepare: PrepareParams, ctx: ImagingContext): Figure {
  const working = resizeImage(image, prepare.maxSize);
  const { mask } = imageToMask(working, prepare);
  return maskToFigure(mask, prepare, ctx, working);
}
