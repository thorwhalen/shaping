/**
 * The font path, offline: a tiny variable font is embedded (`fixtures/tiny-font.ts`), and the
 * provider is tested with a mocked `fetch`. Nothing here touches the network.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { figureArea, manifoldKernel, polygonsBounds, sourceToFigure, TextSourceSchema, PrepareSchema, type Kernel, type Figure } from '../core.js';
import { fontFileCandidates, fontsourceProvider, isWoff2, mergeCatalog, parseFont, CAP_HEIGHT_EM, TRACKING_UNIT_EM } from '../fonts/index.js';
import type { FontEntry } from '../fonts/index.js';
import { tinyFontBytes } from './fixtures/tiny-font.js';

const TINY = 'tiny';
const EM_TOLERANCE = 1e-3;
const RING_AREA_REGULAR = 0.22; // O at wght 400: (600 x 700) - (400 x 500) font units, over 1000 squared
const RING_AREA_LIGHT = 0.12; // wght 100
const RING_AREA_HEAVY = 0.36; // wght 900
const KERN_AV_EM = -0.1;
const ADVANCE_EM = 0.7;

let kernel: Kernel;
const bytes = tinyFontBytes();
const loadFont = async (id: string) => {
  if (id !== TINY) throw new Error(`unexpected font ${id}`);
  return bytes;
};
beforeAll(async () => {
  kernel = await manifoldKernel();
});

const prepare = PrepareSchema.parse({});
const text = (over: Record<string, unknown>) => TextSourceSchema.parse({ kind: 'text', text: 'IOB', font: TINY, spacing: 0, ...over });
const figureOf = (over: Record<string, unknown>): Promise<Figure> => sourceToFigure(text(over), prepare, { kernel, resolvers: { loadFont } });
const part = (f: Figure, id: string) => f.parts.find((p) => p.id === id)!;

describe('outline text', () => {
  it('makes one part per visible glyph, ids by character and index, spaces skipped but counted', async () => {
    const f = await figureOf({ text: 'I O B' });
    expect(f.parts.map((p) => p.id)).toEqual(['I0', 'O2', 'B4']);
  });

  it('keeps the holes of O and B, y up, in ems', async () => {
    const f = await figureOf({});
    expect(part(f, 'O1').polygons).toHaveLength(1);
    expect(part(f, 'O1').polygons[0].holes).toHaveLength(1);
    expect(part(f, 'B2').polygons[0].holes).toHaveLength(2);
    const b = polygonsBounds(part(f, 'O1').polygons)!;
    expect(b.min[1]).toBeCloseTo(0, 3);
    expect(b.max[1]).toBeCloseTo(0.7, 3);
    expect(b.min[0]).toBeCloseTo(ADVANCE_EM, 3);
  });

  it('flattens curves adaptively: a rounded glyph gets more points than a square one, and few', async () => {
    const f = await figureOf({ text: 'o' });
    const n = f.parts[0].polygons[0].outer.length;
    expect(n).toBeGreaterThan(8);
    expect(n).toBeLessThan(200);
  });

  it('applies variable-font axes: the ring gets heavier with wght, and values are clamped', async () => {
    const area = async (wght: number) => figureArea(await figureOf({ text: 'O', axes: { wght } }));
    expect(await area(400)).toBeCloseTo(RING_AREA_REGULAR, 2);
    expect(await area(100)).toBeCloseTo(RING_AREA_LIGHT, 2);
    expect(await area(900)).toBeCloseTo(RING_AREA_HEAVY, 2);
    expect(await area(5000)).toBeCloseTo(RING_AREA_HEAVY, 2);
  });

  it('adds spacing as tenths of an em, and kerns inside a run', async () => {
    const tight = await figureOf({ text: 'II' });
    const loose = await figureOf({ text: 'II', spacing: 2 });
    const dx = polygonsBounds(part(loose, 'I1').polygons)!.min[0] - polygonsBounds(part(tight, 'I1').polygons)!.min[0];
    expect(dx).toBeCloseTo(2 * TRACKING_UNIT_EM, 3);
    const av = await figureOf({ text: 'AV' });
    expect(polygonsBounds(part(av, 'V1').polygons)!.min[0]).toBeCloseTo(ADVANCE_EM + KERN_AV_EM, 3);
    const va = await figureOf({ text: 'VA' });
    expect(polygonsBounds(part(va, 'A1').polygons)!.min[0]).toBeCloseTo(ADVANCE_EM, 3);
  });

  it('mixes the block font and an outline font in runs, and a run may carry its own axes', async () => {
    const f = await figureOf({
      text: 'IO',
      runs: [{ text: 'I', font: 'block' }, { text: 'O', axes: { wght: 900 } }],
    });
    expect(f.parts.map((p) => p.id)).toEqual(['I0', 'O1']);
    const block = polygonsBounds(part(f, 'I0').polygons)!;
    expect(block.max[1] - block.min[1]).toBeCloseTo(CAP_HEIGHT_EM, 2);
    expect(figureArea({ units: 'unit', parts: [part(f, 'O1')] })).toBeCloseTo(RING_AREA_HEAVY, 2);
    expect(polygonsBounds(part(f, 'O1').polygons)!.min[0]).toBeGreaterThan(block.max[0] - EM_TOLERANCE);
  });

  it('keeps the part count and the holes when rounded, at every round value', async () => {
    for (const round of [0.3, 1]) {
      const f = await figureOf({ round });
      expect(f.parts.map((p) => p.id)).toEqual(['I0', 'O1', 'B2']);
      expect(part(f, 'B2').polygons[0].holes).toHaveLength(2);
    }
    const sharp = part(await figureOf({}), 'I0').polygons[0].outer.length;
    const round = part(await figureOf({ round: 1 }), 'I0').polygons[0].outer.length;
    expect(round).toBeGreaterThan(sharp);
  });

  it('rounds block runs among outline fonts as well', async () => {
    const f = await figureOf({ text: 'IO', runs: [{ text: 'I', font: 'block' }, { text: 'O' }], round: 1 });
    expect(f.parts).toHaveLength(2);
  });

  it('leaves block-only text in cells, without needing a font loader', async () => {
    const f = await sourceToFigure(TextSourceSchema.parse({ kind: 'text', text: 'A' }), prepare, { kernel, resolvers: {} });
    const b = polygonsBounds(f.parts[0].polygons)!;
    expect(b.max[0] - b.min[0]).toBeCloseTo(5, 1);
  });

  it('says what to pass when an outline font has no loader', async () => {
    await expect(sourceToFigure(text({}), prepare, { kernel, resolvers: {} })).rejects.toThrow(/loadFont/);
  });

  it('refuses text with nothing visible', async () => {
    await expect(figureOf({ text: '  ' })).rejects.toThrow(/no visible/);
  });
});

describe('the parsed font', () => {
  it('reports its axes with their real ranges', async () => {
    const font = await parseFont(bytes);
    expect(font.axes).toMatchObject([{ tag: 'wght', min: 100, default: 400, max: 900 }]);
    expect(font.unitsPerEm).toBe(1000);
    expect(font.has('O')).toBe(true);
    expect(font.has('Z')).toBe(false);
    expect(isWoff2(bytes)).toBe(false);
  });

  it('rejects bytes that are no font, in words', async () => {
    await expect(parseFont(new Uint8Array(64))).rejects.toThrow(/Could not read the font/);
  });
});

describe('kernel.contours', () => {
  const sq = (x0: number, x1: number, ccw = true) => {
    const r: Array<[number, number]> = [[x0, x0], [x1, x0], [x1, x1], [x0, x1]];
    return ccw ? r : [...r].reverse();
  };
  const area = (rings: Array<Array<[number, number]>>, rule?: 'nonzero' | 'evenodd') => kernel.scope(() => kernel.area(kernel.contours(rings, rule)));

  it('non-zero: opposite winding makes a hole, the same winding fills it', () => {
    expect(area([sq(0, 4), sq(1, 3, false)])).toBeCloseTo(16 - 4, 6);
    expect(area([sq(0, 4), sq(1, 3, true)])).toBeCloseTo(16, 6);
  });

  it('even-odd: any nesting makes a hole', () => {
    expect(area([sq(0, 4), sq(1, 3, true)], 'evenodd')).toBeCloseTo(12, 6);
  });
});

describe('the Fontsource provider (mocked fetch)', () => {
  const family = { id: 'demo', family: 'Demo', category: 'sans-serif', variable: true, weights: [300, 700], styles: ['normal'], subsets: ['latin', 'cyrillic'], defSubset: 'latin', license: 'OFL-1.1', type: 'google' };
  const icons = { ...family, id: 'symbols', family: 'Symbols', category: 'icons', variable: false };
  const variable = { demo: { family: 'Demo', axes: { wght: { default: '400', min: '300', max: '700', step: '1' }, ital: { default: '0', min: '0', max: '1', step: '1' } } } };
  const calls: string[] = [];
  const mockFetch = (async (url: string) => {
    calls.push(url);
    const json = (x: unknown) => new Response(JSON.stringify(x));
    if (url.endsWith('/fonts')) return json([family, icons]);
    if (url.endsWith('/variable')) return json(variable);
    if (url.includes(':vf@latest/latin-standard-normal.woff2')) return new Response(bytes.slice().buffer);
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;

  it('merges the two documents and leaves out icon fonts', () => {
    const entries = mergeCatalog([family, icons], variable);
    expect(entries.map((e) => e.id)).toEqual(['demo']);
    expect(entries[0].axes).toEqual([
      { tag: 'wght', min: 300, default: 400, max: 700, step: 1 },
      { tag: 'ital', min: 0, default: 0, max: 1, step: 1 },
    ]);
  });

  it('lists variable files first (never one named for an italic axis), then the static file nearest regular', () => {
    const [entry] = mergeCatalog([family], variable) as [FontEntry];
    const urls = fontFileCandidates(entry, 'https://cdn.test');
    expect(urls[0]).toBe('https://cdn.test/demo:vf@latest/latin-full-normal.woff2');
    expect(urls.some((u) => u.includes('ital'))).toBe(false);
    expect(urls.at(-2)).toBe('https://cdn.test/demo@latest/latin-300-normal.ttf');
  });

  it('loads the first candidate that exists, fetching the catalogue once, and names unknown fonts', async () => {
    const provider = fontsourceProvider({ fetch: mockFetch, apiBase: 'https://api.test', cdnBase: 'https://cdn.test' });
    const got = await provider.load('demo');
    expect(got.byteLength).toBe(bytes.byteLength);
    await provider.load('demo');
    expect(calls.filter((u) => u.endsWith('/fonts'))).toHaveLength(1);
    await expect(provider.load('nope')).rejects.toThrow(/Unknown font "nope"/);
    expect((await provider.catalog()).map((e) => e.family)).toEqual(['Demo']);
  });
});
