/**
 * Ambient types for the two untyped packages the font module loads lazily: `opentype.js` (parser)
 * and `wawoff2` (WOFF2 decoder). Only the parts the module uses are declared, and none of these
 * types appears in the public API of `shaping/fonts`.
 */
declare module 'opentype.js' {
  export interface PathCommand {
    type: 'M' | 'L' | 'Q' | 'C' | 'Z';
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }
  export interface Glyph {
    index: number;
    advanceWidth: number;
    path: { commands: PathCommand[] };
  }
  export interface FvarAxis {
    tag: string;
    minValue: number;
    defaultValue: number;
    maxValue: number;
    name?: Record<string, string>;
  }
  export interface Font {
    unitsPerEm: number;
    names: Record<string, Record<string, string> | undefined>;
    tables: { fvar?: { axes: FvarAxis[] } };
    charToGlyphIndex(ch: string): number;
    glyphs: { get(index: number): Glyph };
    getKerningValue(left: Glyph | number, right: Glyph | number): number;
    /** Absent in static fonts. */
    variation?: { process: { getTransform(glyph: Glyph, coords: Record<string, number>): Glyph } };
  }
  export function parse(buffer: ArrayBuffer): Font;
}

declare module 'wawoff2/decompress.js' {
  const decompress: (bytes: Uint8Array) => Promise<Uint8Array>;
  export default decompress;
}
