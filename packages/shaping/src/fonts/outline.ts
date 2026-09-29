/// <reference path="./opentype.d.ts" />
/**
 * A parsed font, as far as shaping needs it: axes with their real ranges, and for a character its
 * advance and outline (curves flattened, y up, in ems) at given variable-font axis values.
 *
 * Parser: opentype.js 2 (MIT). It reads TrueType and CFF outlines, applies `gvar` variations (and
 * `HVAR` advance changes), and reads kerning from `GPOS` or `kern`. Not supported: ligatures and
 * other substitutions (`GSUB`), contextual kerning, colour glyphs, `CFF2` blends in some fonts.
 */
import type { Font } from 'opentype.js';
import type { Ring } from '../types.js';
import { toSfnt } from './decode.js';
import { flattenPath } from './flatten.js';
import type { FontAxis } from './types.js';

/** What a character looks like in a font at some axis values. */
export interface GlyphOutline {
  /** Horizontal advance, in ems. */
  advance: number;
  /** Closed contours, y up, baseline at 0, in ems. Fill them with the non-zero rule. */
  contours: Ring[];
}

export interface OutlineFont {
  /** Family name from the font's name table (may be empty). */
  readonly family: string;
  readonly unitsPerEm: number;
  /** The font's own variable axes (empty for a static font). */
  readonly axes: FontAxis[];
  /** True when the font has a glyph for the character. */
  has(ch: string): boolean;
  /** Outline and advance of a character. Axis values are clamped to each axis's range. */
  glyph(ch: string, axes?: Record<string, number>): GlyphOutline;
  /** Kerning between two characters, in ems (0 when the font has none). */
  kerning(left: string, right: string): number;
}

const ENGLISH = 'en';

const nameOf = (font: Font): string => font.names?.fontFamily?.[ENGLISH] ?? Object.values(font.names?.fontFamily ?? {})[0] ?? '';

/** Keep only the axes the font has, each within its range. */
export function clampAxes(axes: FontAxis[], values: Record<string, number> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of axes) {
    const v = values[a.tag];
    if (v !== undefined && Number.isFinite(v)) out[a.tag] = Math.min(a.max, Math.max(a.min, v));
  }
  return out;
}

type Parser = typeof import('opentype.js');

/** The parser module: named exports in ESM builds, `default` when Node hands over CommonJS. */
async function loadParser(): Promise<Parser> {
  const mod = (await import('opentype.js')) as unknown as Partial<Parser> & { default?: Parser };
  return (mod.parse ? mod : mod.default) as Parser;
}

/** Parse font bytes (TTF, OTF, WOFF or WOFF2). Throws a readable error for anything else. */
export async function parseFont(bytes: Uint8Array): Promise<OutlineFont> {
  const sfnt = await toSfnt(bytes);
  const parser = await loadParser();
  let font: Font;
  try {
    font = parser.parse(sfnt.buffer.slice(sfnt.byteOffset, sfnt.byteOffset + sfnt.byteLength) as ArrayBuffer);
  } catch (e) {
    throw new Error(`Could not read the font file: ${(e as Error).message}`);
  }
  return wrap(font);
}

function wrap(font: Font): OutlineFont {
  const upm = font.unitsPerEm;
  const scale = 1 / upm;
  const axes: FontAxis[] = (font.tables.fvar?.axes ?? []).map((a) => ({ tag: a.tag, name: a.name?.[ENGLISH], min: a.minValue, default: a.defaultValue, max: a.maxValue }));
  const index = (ch: string) => font.charToGlyphIndex(ch);
  const glyphOf = (ch: string) => font.glyphs.get(index(ch));
  return {
    family: nameOf(font),
    unitsPerEm: upm,
    axes,
    has: (ch) => index(ch) > 0,
    glyph(ch, values) {
      const base = glyphOf(ch);
      const g = font.variation ? font.variation.process.getTransform(base, clampAxes(axes, values)) : base;
      // Read the advance right away: the parser keeps one mutable advance per glyph.
      return { advance: g.advanceWidth * scale, contours: flattenPath(g.path.commands, scale) };
    },
    kerning: (left, right) => (index(left) > 0 && index(right) > 0 ? font.getKerningValue(index(left), index(right)) * scale : 0),
  };
}

const cache = new WeakMap<Uint8Array, Promise<OutlineFont>>();

/** `parseFont`, remembered per byte array (a loader that returns the same array pays for parsing once). */
export function parseFontCached(bytes: Uint8Array): Promise<OutlineFont> {
  let p = cache.get(bytes);
  if (!p) cache.set(bytes, (p = parseFont(bytes)));
  return p;
}
