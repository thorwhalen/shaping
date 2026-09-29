/**
 * A 5 x 7 block font, drawn for this project. Each glyph is a grid of cells, so a letter becomes an
 * exact union of squares: no font file, no tracing, identical in the browser and in Node. It is
 * what the text source uses, and it makes shadow-block letters (the classic use) one line of JSON.
 */
import type { Polygon } from '../types.js';

const G: Record<string, string> = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.####|#....|#....|#....|#....|#....|.####',
  D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####',
  F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.####|#....|#....|#.###|#...#|#...#|.###.',
  H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '#####|..#..|..#..|..#..|..#..|..#..|#####',
  J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#',
  N: '#...#|##..#|#.#.#|#..##|#...#|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',
  R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.',
  T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#',
  X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
  Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.',
  '1': '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  '2': '.###.|#...#|....#|...#.|..#..|.#...|#####',
  '3': '####.|....#|....#|.###.|....#|....#|####.',
  '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.',
  '5': '#####|#....|####.|....#|....#|#...#|.###.',
  '6': '.###.|#....|#....|####.|#...#|#...#|.###.',
  '7': '#####|....#|...#.|..#..|.#...|.#...|.#...',
  '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  '9': '.###.|#...#|#...#|.####|....#|....#|.###.',
  '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
  '-': '.....|.....|.....|#####|.....|.....|.....',
  '.': '.....|.....|.....|.....|.....|.##..|.##..',
  '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..',
  '?': '.###.|#...#|....#|...#.|..#..|.....|..#..',
  '#': '.#.#.|.#.#.|#####|.#.#.|#####|.#.#.|.#.#.',
  '*': '.....|#.#.#|.###.|#####|.###.|#.#.#|.....',
  '♥': '.....|.#.#.|#####|#####|.###.|..#..|.....',
  ' ': '.....|.....|.....|.....|.....|.....|.....',
};

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;

/** Characters the block font can set. */
export const BLOCK_FONT_CHARS = Object.keys(G).join('');

/**
 * The filled cells of a glyph, as [column, row] with row 0 at the BOTTOM (y up).
 * Unknown characters raise, naming the character and the ones available.
 */
export function glyphCells(ch: string): Array<[number, number]> {
  const rows = G[ch.toUpperCase()];
  if (!rows) throw new Error(`The block font has no glyph for "${ch}". Available: ${BLOCK_FONT_CHARS}`);
  const lines = rows.split('|');
  const cells: Array<[number, number]> = [];
  lines.forEach((line, r) => {
    for (let c = 0; c < line.length; c++) if (line[c] === '#') cells.push([c, GLYPH_HEIGHT - 1 - r]);
  });
  return cells;
}

/** Cells overlap by this much (in cells), so that the union welds them into one outline. */
const CELL_OVERLAP = 1e-3;

/**
 * The polygons of one block glyph, its left edge at `x0` (in cells), y up. Cells overlap by a hair
 * so a union welds them; corner-touching cells get a diamond bridge (a 45 degree stroke).
 */
export function blockGlyphPolygons(ch: string, x0: number): Polygon[] {
  const e = CELL_OVERLAP;
  const cells = glyphCells(ch);
  const polygons: Polygon[] = cells.map(([c, r]) => ({
    outer: [
      [x0 + c - e, r - e],
      [x0 + c + 1 + e, r - e],
      [x0 + c + 1 + e, r + 1 + e],
      [x0 + c - e, r + 1 + e],
    ],
    holes: [],
  }));
  polygons.push(...diagonalBridges(cells, x0));
  return polygons;
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
