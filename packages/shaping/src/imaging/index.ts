/**
 * `shaping/imaging`: from images, SVG documents and drawings to figures.
 *
 * ```ts
 * import { imageToFigure, decodeImage, prepareMask } from 'shaping/imaging';
 * ```
 *
 * Pure functions over typed arrays: they run in a Web Worker and in Node. `makeResolvers` builds
 * the `SourceResolvers` that `build()` uses for image, SVG and drawing sources; `defaultResolvers`
 * is `makeResolvers({})`. Pipeline: decode -> mask (threshold cascade) -> morphology -> signed
 * distance field -> contour -> figure. Vector sources skip the raster stages.
 */
import type { DrawingSource, ImageSource, PrepareParams, SvgSource } from '../design.js';
import type { Kernel } from '../kernel/types.js';
import type { SourceResolvers } from '../sources/index.js';
import type { Figure } from '../types.js';
import { decodeImage } from './decode.js';
import { drawingToFigure } from './drawing.js';
import { imageToFigure, type ImagingContext } from './figure.js';
import { svgToFigure } from './svg.js';

export * from './decode.js';
export * from './mask.js';
export * from './morphology.js';
export * from './trace.js';
export * from './cluster.js';
export * from './figure.js';
export * from './thin.js';
export { svgToFigure, parseXml, parseTransform, parsePathData, arcToCubics, cssColor } from './svg.js';
export { drawingToFigure, objectPolygons, capsuleRing, PEN_OPTIONS } from './drawing.js';

/** Bytes of a source, with the media type when the loader knows it. */
export interface LoadedBytes {
  bytes: Uint8Array;
  mediaType?: string;
}

export interface MakeResolversOptions {
  /** Fetch the bytes behind `ImageSource.src`. The default handles `data:` URLs and `http(s):` URLs. */
  loadBytes?: (src: string) => Promise<LoadedBytes>;
  /** Supplies the kernel when the caller does not pass one; defaults to loading Manifold once. */
  kernel?: () => Promise<Kernel>;
}

const DATA_URL = /^data:([^,;]*)((?:;[^,;]*)*),(.*)$/s;

/** The default loader: `data:` URLs and `http(s):` URLs. `idb:` keys belong to the app, which must pass its own loader. */
export async function defaultLoadBytes(src: string): Promise<LoadedBytes> {
  const data = DATA_URL.exec(src);
  if (data) {
    const [, mediaType, params, payload] = data;
    if (params.includes(';base64')) return { bytes: Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)), mediaType: mediaType || undefined };
    return { bytes: new TextEncoder().encode(decodeURIComponent(payload)), mediaType: mediaType || undefined };
  }
  if (/^https?:/i.test(src)) {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`Could not fetch the image (${response.status} ${response.statusText}): ${src}`);
    return { bytes: new Uint8Array(await response.arrayBuffer()), mediaType: response.headers.get('content-type') ?? undefined };
  }
  if (/^idb:/i.test(src)) {
    throw new Error(`Image "${src}" is kept in the browser's IndexedDB: the app must pass \`loadBytes\` to makeResolvers to read it.`);
  }
  throw new Error(`Cannot load image "${src}": the default loader reads data: and http(s): URLs. Pass \`loadBytes\` to makeResolvers to read other kinds of source (for example files).`);
}

let sharedKernel: Promise<Kernel> | undefined;
/** Loads Manifold once per process or worker, and only when a resolver needs it. */
function defaultKernel(): Promise<Kernel> {
  sharedKernel ??= import('../kernel/manifold.js').then((m) => m.manifoldKernel());
  return sharedKernel;
}

/**
 * Build the resolvers for image, SVG and drawing sources. Each resolver takes the kernel from an
 * optional third argument `{ kernel }` (when the caller supplies it), else from `options.kernel`,
 * else loads the default kernel.
 */
export function makeResolvers(options: MakeResolversOptions = {}): SourceResolvers {
  const { loadBytes = defaultLoadBytes, kernel: getKernel = defaultKernel } = options;
  const contextOf = async (ctx?: Partial<ImagingContext>): Promise<ImagingContext> => ({ kernel: ctx?.kernel ?? (await getKernel()) });
  return {
    image: async (source: ImageSource, prepare: PrepareParams, ctx?: Partial<ImagingContext>): Promise<Figure> => {
      const { bytes, mediaType } = await loadBytes(source.src);
      const image = await decodeImage(bytes, mediaType, prepare.maxSize);
      return imageToFigure(image, prepare, await contextOf(ctx));
    },
    svg: async (source: SvgSource, _prepare: PrepareParams, ctx?: Partial<ImagingContext>): Promise<Figure> => svgToFigure(source.svg, await contextOf(ctx)),
    drawing: async (source: DrawingSource, _prepare: PrepareParams, ctx?: Partial<ImagingContext>): Promise<Figure> => drawingToFigure(source, await contextOf(ctx)),
  };
}

/** The resolvers `build()` uses unless told otherwise. */
export const defaultResolvers: SourceResolvers = makeResolvers({});
