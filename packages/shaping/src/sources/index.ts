/**
 * From a `Source` (as stored in a Design) to a `Figure`.
 *
 * Shapes, block text and inline polygons are resolved here. Images, SVG and drawings are resolved
 * by `SourceResolvers`, a seam whose default implementation is the `imaging` module (the threshold
 * cascade, marching-squares tracing, the SVG path parser and the stroke outliner).
 */
import type { DrawingSource, ImageSource, PrepareParams, ShapeSource, Source, SvgSource, TextSource } from '../design.js';
import type { Kernel } from '../kernel/types.js';
import type { Figure, Polygon, Ring, Vec2 } from '../types.js';
import { roundRegion } from '../figure.js';
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphCells } from './blockfont.js';

/** What a resolver may use. `kernel` handles are valid only inside `kernel.scope`. */
export interface ResolverContext {
  kernel: Kernel;
}

export interface SourceResolvers {
  /** Decode, threshold and trace a raster image. */
  image?: (source: ImageSource, prepare: PrepareParams, ctx: ResolverContext) => Promise<Figure>;
  /** Parse an SVG document to polygons. */
  svg?: (source: SvgSource, prepare: PrepareParams, ctx: ResolverContext) => Promise<Figure> | Figure;
  /** Turn a drawing's objects into polygons (black objects unioned, erasers subtracted, in order). */
  drawing?: (source: DrawingSource, prepare: PrepareParams, ctx: ResolverContext) => Promise<Figure> | Figure;
}

const TAU = Math.PI * 2;
/** Half the width of a block-font stroke, in cells. */
const BLOCK_STROKE_HALF_WIDTH = 0.5;
/** Keeps the largest rounding just under half a stroke, so a stroke never vanishes when shrunk. */
const ROUND_SAFETY = 0.98;

/** Points of a circle, counter-clockwise. */
export function circleRing(r: number, n = 96, cx = 0, cy = 0): Ring {
  return Array.from({ length: n }, (_, i): Vec2 => [cx + r * Math.cos((TAU * i) / n), cy + r * Math.sin((TAU * i) / n)]);
}

const rectRing = (w: number, h: number, cx = 0, cy = 0): Ring => [
  [cx - w / 2, cy - h / 2],
  [cx + w / 2, cy - h / 2],
  [cx + w / 2, cy + h / 2],
  [cx - w / 2, cy + h / 2],
];

export function shapeFigure(s: Pick<ShapeSource, 'shape' | 'n' | 'ratio'>): Figure {
  const one = (polygons: Polygon[]): Figure => ({ units: 'unit', parts: [{ id: s.shape, polygons }] });
  switch (s.shape) {
    case 'circle':
      return one([{ outer: circleRing(1), holes: [] }]);
    case 'rect':
      return one([{ outer: rectRing(2 * Math.min(1, s.ratio), 2 * Math.min(1, 1 / s.ratio)), holes: [] }]);
    case 'ring':
      return one([{ outer: circleRing(1), holes: [[...circleRing(Math.min(0.95, s.ratio))].reverse()] }]);
    case 'polygon':
      return one([{ outer: Array.from({ length: s.n }, (_, i): Vec2 => [Math.cos(TAU * i / s.n + Math.PI / 2), Math.sin(TAU * i / s.n + Math.PI / 2)]), holes: [] }]);
    case 'star': {
      const inner = Math.min(0.95, s.ratio);
      const pts: Ring = [];
      for (let i = 0; i < 2 * s.n; i++) {
        const r = i % 2 ? inner : 1;
        const a = (Math.PI * i) / s.n + Math.PI / 2;
        pts.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      return one([{ outer: pts, holes: [] }]);
    }
    case 'cross': {
      const w = Math.min(0.95, s.ratio);
      return one([
        { outer: rectRing(2, w), holes: [] },
        { outer: rectRing(w, 2), holes: [] },
      ]);
    }
    case 'heart': {
      const pts: Ring = [];
      for (let i = 0; i < 96; i++) {
        const t = (TAU * i) / 96;
        pts.push([(16 * Math.sin(t) ** 3) / 17, (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17]);
      }
      return one([{ outer: pts, holes: [] }]);
    }
  }
}

/** Text in the block font: one part per glyph (spaces skipped), in cell units, y up. */
export function textFigure(s: Pick<TextSource, 'text' | 'spacing'>, kernel?: Kernel, round = 0): Figure {
  const parts: Figure['parts'] = [];
  const pitch = GLYPH_WIDTH + s.spacing;
  [...s.text].forEach((ch, i) => {
    if (ch === ' ') return;
    // Cells overlap by a hair so that the union welds them into one outline.
    const e = 1e-3;
    const cells = glyphCells(ch);
    let polygons: Polygon[] = cells.map(([c, r]) => ({
      outer: [
        [i * pitch + c - e, r - e],
        [i * pitch + c + 1 + e, r - e],
        [i * pitch + c + 1 + e, r + 1 + e],
        [i * pitch + c - e, r + 1 + e],
      ],
      holes: [],
    }));
    polygons.push(...diagonalBridges(cells, i * pitch));
    if (kernel && round > 0) {
      // A stroke is one cell wide, so round = 1 means a radius of half a cell: a fully round tip.
      const radius = round * BLOCK_STROKE_HALF_WIDTH * ROUND_SAFETY;
      polygons = kernel.scope(() => kernel.polygons(roundRegion(kernel, kernel.region(polygons), radius)));
    }
    parts.push({ id: `${ch}${i}`, polygons });
  });
  if (parts.length === 0) throw new Error('Text source has no visible characters.');
  return { units: 'unit', parts };
}

/**
 * Cells that touch only at a corner meet in a single point, which is no solid at all. Where that
 * happens, a diamond centred on the corner fills the two empty half-cells, drawing a 45° stroke.
 */
function diagonalBridges(cells: Array<[number, number]>, x0: number): Polygon[] {
  const on = new Set(cells.map(([c, r]) => `${c},${r}`));
  const has = (c: number, r: number) => on.has(`${c},${r}`);
  const out: Polygon[] = [];
  for (let c = -1; c < GLYPH_WIDTH; c++)
    for (let r = -1; r < GLYPH_HEIGHT; r++) {
      const a = has(c, r), b = has(c + 1, r + 1), d = has(c + 1, r), e = has(c, r + 1);
      if ((a && b && !d && !e) || (d && e && !a && !b)) {
        const x = x0 + c + 1, y = r + 1;
        out.push({ outer: [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]], holes: [] });
      }
    }
  return out;
}

export interface ResolveContext {
  kernel: Kernel;
  resolvers: SourceResolvers;
}

/** Resolve any source to a figure. Image, SVG and drawing sources need a resolver. */
export async function sourceToFigure(source: Source, prepare: PrepareParams, ctx: ResolveContext): Promise<Figure> {
  const need = <K extends keyof SourceResolvers>(k: K): NonNullable<SourceResolvers[K]> => {
    const r = ctx.resolvers[k];
    if (!r) throw new Error(`No resolver for "${k}" sources. Pass one in \`resolvers.${k}\` (the imaging module provides the default).`);
    return r as NonNullable<SourceResolvers[K]>;
  };
  switch (source.kind) {
    case 'shape':
      return shapeFigure(source);
    case 'text':
      return textFigure(source, ctx.kernel, source.round);
    case 'polygons':
      return { units: source.figure.units, parts: source.figure.parts.map((p) => ({ ...p, polygons: p.polygons.map((g) => ({ outer: g.outer, holes: g.holes ?? [] })) })) };
    case 'image':
      return need('image')(source, prepare, { kernel: ctx.kernel });
    case 'svg':
      return need('svg')(source, prepare, { kernel: ctx.kernel });
    case 'drawing':
      return need('drawing')(source, prepare, { kernel: ctx.kernel });
  }
}
