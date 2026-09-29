/**
 * shaping — turn 2D figures into parametrized 3D solids.
 *
 * ```ts
 * import { build } from 'shaping';
 * const model = await build(design);          // a Design (JSON) in, a Model (meshes + checks) out
 * ```
 *
 * `build` is the facade: it validates the design, loads the default kernel (Manifold), resolves
 * sources with the default imaging resolvers, and runs the design's genre from the built-in table.
 * Every one of those is a keyword you can replace: `kernel`, `resolvers`, `genres`.
 */
import { buildFromFigures, resolveFigures, type GenreTable } from './build.js';
import { parseDesign, type Design } from './design.js';
import { builtInGenres } from './genres/index.js';
import { defaultResolvers } from './imaging/index.js';
import { manifoldKernel } from './kernel/manifold.js';
import type { Kernel } from './kernel/types.js';
import type { SourceResolvers } from './sources/index.js';
import type { Figure, Model } from './types.js';

export * from './core.js';
export * from './genres/index.js';

export interface BuildOptions {
  /** The solid modeller. Default: Manifold. */
  kernel?: Kernel;
  /** The table of genres. Default: the built-in genres. */
  genres?: GenreTable;
  /** How image, SVG and drawing sources become figures. Default: the imaging module. */
  resolvers?: SourceResolvers;
  /** Figures already resolved, by slot id (skips resolving those slots). */
  figures?: Record<string, Figure>;
}

/** Validate a design and build its model. */
export async function build(design: unknown, opts: BuildOptions = {}): Promise<Model> {
  const d: Design = parseDesign(design);
  const kernel = opts.kernel ?? (await manifoldKernel());
  const genres = opts.genres ?? builtInGenres;
  const figures = { ...(await resolveMissing(d, kernel, genres, opts)), ...(opts.figures ?? {}) };
  return buildFromFigures(d, figures, { kernel, genres });
}

async function resolveMissing(d: Design, kernel: Kernel, genres: GenreTable, opts: BuildOptions) {
  if (opts.figures && Object.keys(opts.figures).length >= Object.keys(d.sources).length) return {};
  return resolveFigures(d, { kernel, genres, resolvers: opts.resolvers ?? defaultResolvers });
}
