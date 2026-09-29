/**
 * Text set in outline fonts, as a figure: the counterpart of the block font's `textFigure`.
 *
 * Runs (stretches of text, each with a font and variable-font axis values) are laid out on one
 * baseline. Each character becomes one part (id `${char}${index}`, the index counting every
 * character of the text, spaces included), filled with the NON-ZERO rule so that a glyph's
 * winding, not its nesting, decides what is a hole; the kernel's union sorts out the overlaps that
 * variable fonts draw on purpose. Kerning is applied inside a run.
 *
 * Units and dials, all in ems (y up, baseline at 0):
 * - `spacing` is extra tracking in tenths of an em, added after every character.
 * - `round` in 0..1 rounds every corner with radius `round * ROUND_EM_FRACTION` em, the kernel's
 *   opening-then-closing (`roundRegion`), so the dial works for every font. 0.05 em is half the
 *   stem of a regular-weight face, so `round = 1` rounds a regular stroke's tip completely; a
 *   heavier face is rounded less. The radius is kept just under that (`ROUND_SAFETY`), and when a
 *   glyph would vanish or fall into more pieces (strokes thinner than the radius) it is halved
 *   until it does not.
 * - Block-font runs mixed with outline fonts are drawn `CAP_HEIGHT_EM` tall, so they sit with the
 *   letters around them; their `round` radius is `round` half-strokes as in the block font.
 */
import type { TextSource } from '../design.js';
import { BLOCK_FONT } from '../design.js';
import { roundRegion } from '../figure.js';
import type { Kernel } from '../kernel/types.js';
import { blockGlyphPolygons, GLYPH_HEIGHT, GLYPH_WIDTH } from '../sources/blockfont.js';
import type { Figure, Part, Polygon, Ring, Vec2 } from '../types.js';
import { parseFontCached, type OutlineFont } from './outline.js';
import type { FontLoader } from './types.js';

/** Height of a block-font letter, in ems, when it is set among outline fonts. */
export const CAP_HEIGHT_EM = 0.7;
/** One unit of `spacing`, in ems, for text that has outline fonts in it. */
export const TRACKING_UNIT_EM = 0.1;
/** The corner radius of `round = 1`, in ems (see the module note). */
export const ROUND_EM_FRACTION = 0.05;
/** Advance of a space (or of a character the font lacks), in ems, when the font gives none. */
const FALLBACK_SPACE_EM = 0.3;
/** Half the width of a block-font stroke, in cells. */
const BLOCK_STROKE_HALF_WIDTH = 0.5;
/** Keeps the largest rounding just under half a stroke, so a stroke never vanishes when shrunk. */
const ROUND_SAFETY = 0.98;
/** How many times the rounding radius is halved when a glyph would vanish or fall apart. */
const ROUND_RETRIES = 5;

/** A run with everything filled in. */
export interface ResolvedRun {
  text: string;
  font: string;
  axes: Record<string, number>;
}

type TextLike = Pick<TextSource, 'text' | 'font' | 'axes' | 'runs'>;

/** The runs of a text source: its `runs`, or the whole text as one run. A run without its own font or axes uses the source's. */
export function resolveRuns(source: TextLike): ResolvedRun[] {
  if (!source.runs?.length) return [{ text: source.text, font: source.font, axes: source.axes }];
  return source.runs.map((r) => ({ text: r.text, font: r.font ?? source.font, axes: r.axes ?? (r.font === undefined ? source.axes : {}) }));
}

/** True when every run is in the block font, so the block path (cell units) applies. */
export const isBlockOnly = (source: TextLike): boolean => resolveRuns(source).every((r) => r.font === BLOCK_FONT);

export interface OutlineTextContext {
  kernel: Kernel;
  loadFont: FontLoader;
}

const shift = (rings: Ring[], dx: number): Ring[] => rings.map((r) => r.map(([x, y]): Vec2 => [x + dx, y]));

/**
 * Round a region. A radius that empties it or breaks it into more pieces (a stroke thinner than
 * twice the radius) is halved until it does not; the unrounded polygons if nothing works.
 */
function roundedPolygons(kernel: Kernel, polygons: Polygon[], radius: number): Polygon[] {
  return kernel.scope(() => {
    const region = kernel.region(polygons);
    const before = kernel.polygons(region);
    for (let r = radius, i = 0; i < ROUND_RETRIES; i++, r /= 2) {
      const after = kernel.polygons(roundRegion(kernel, region, r));
      if (after.length > 0 && after.length <= before.length) return after;
    }
    return before;
  });
}

function outlinePolygons(kernel: Kernel, contours: Ring[], round: number): Polygon[] {
  if (round > 0) {
    const cleaned = kernel.scope(() => kernel.polygons(kernel.contours(contours)));
    return roundedPolygons(kernel, cleaned, round * ROUND_EM_FRACTION * ROUND_SAFETY);
  }
  return kernel.scope(() => kernel.polygons(kernel.contours(contours)));
}

function blockPolygons(kernel: Kernel, ch: string, dx: number, round: number): Polygon[] {
  const scale = CAP_HEIGHT_EM / GLYPH_HEIGHT;
  const placed = blockGlyphPolygons(ch, 0).map((p) => ({
    outer: p.outer.map(([x, y]): Vec2 => [x * scale + dx, y * scale]),
    holes: [],
  }));
  if (round <= 0) return kernel.scope(() => kernel.polygons(kernel.region(placed)));
  return roundedPolygons(kernel, placed, round * BLOCK_STROKE_HALF_WIDTH * ROUND_SAFETY * scale);
}

/** Load and parse every outline font the runs use, once each. */
async function loadFonts(runs: ResolvedRun[], loadFont: FontLoader): Promise<Map<string, OutlineFont>> {
  const ids = [...new Set(runs.map((r) => r.font).filter((f) => f !== BLOCK_FONT))];
  const fonts = await Promise.all(ids.map(async (id) => parseFontCached(await loadFont(id))));
  return new Map(ids.map((id, i) => [id, fonts[i]]));
}

/** Text in outline fonts (and block runs among them): one part per visible character, in ems, y up. */
export async function outlineTextFigure(source: TextLike & Pick<TextSource, 'spacing' | 'round'>, ctx: OutlineTextContext): Promise<Figure> {
  const runs = resolveRuns(source);
  const fonts = await loadFonts(runs, ctx.loadFont);
  const tracking = source.spacing * TRACKING_UNIT_EM;
  const parts: Part[] = [];
  let pen = 0;
  let index = 0;
  for (const run of runs) {
    const font = run.font === BLOCK_FONT ? null : fonts.get(run.font)!;
    let prev: string | null = null;
    for (const ch of run.text) {
      if (font && prev !== null) pen += font.kerning(prev, ch);
      let advance: number;
      let polygons: Polygon[] = [];
      if (font) {
        const g = font.has(ch) ? font.glyph(ch, run.axes) : null;
        advance = g?.advance ?? FALLBACK_SPACE_EM;
        if (g?.contours.length) polygons = outlinePolygons(ctx.kernel, shift(g.contours, pen), source.round);
      } else {
        advance = (GLYPH_WIDTH * CAP_HEIGHT_EM) / GLYPH_HEIGHT;
        if (ch !== ' ') polygons = blockPolygons(ctx.kernel, ch, pen, source.round);
      }
      if (polygons.length) parts.push({ id: `${ch}${index}`, polygons });
      pen += advance + tracking;
      prev = ch;
      index++;
    }
  }
  if (parts.length === 0) throw new Error('Text source has no visible characters.');
  return { units: 'unit', parts };
}
