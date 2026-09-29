/** Tests for the pure parts of the app's font module: search ranking, cache eviction and loading, recents, edits of a text source. No DOM, no network. */
import { describe, expect, it } from 'vitest';
import { TextSourceSchema } from 'shaping';
import type { FontAxis, FontEntry } from 'shaping/fonts';
import { cachedCatalog, cachedLoader, memoryFontStore, planEviction, type CacheRecord } from './cache';
import { addRun, filterBlockText, fromRuns, patchRun, removeRun, toRuns, withAxis, withFont, withRunFont, DEFAULT_SPACING, MAX_TEXT_LENGTH } from './editing';
import { previewCssUrl } from './previews';
import { pushRecent } from './recent';
import { categoriesOf, matchRank, MATCH, searchFonts } from './search';

const entry = (id: string, family: string, category = 'sans-serif', variable = false): FontEntry => ({
  id, family, category, variable, axes: [], weights: [400], subsets: ['latin'], defaultSubset: 'latin', license: 'OFL-1.1', origin: 'google',
});
const CATALOG = [
  entry('roboto', 'Roboto', 'sans-serif', true),
  entry('roboto-mono', 'Roboto Mono', 'monospace', true),
  entry('slab', 'Roboto Slab', 'serif'),
  entry('bebas-neue', 'Bebas Neue', 'display'),
  entry('lobster', 'Lobster', 'display'),
  entry('aleo', 'Aleo', 'serif'),
  entry('playfair-display', 'Playfair Display', 'serif', true),
];
const ids = (q: string, o = {}) => searchFonts(CATALOG, q, o).map((h) => h.entry.id);

describe('search ranking', () => {
  it('ranks exact, then prefix, then word prefix, then substring, then category', () => {
    expect(matchRank(CATALOG[0], 'roboto')).toBe(MATCH.exact);
    expect(matchRank(CATALOG[1], 'roboto')).toBe(MATCH.prefix);
    expect(matchRank(CATALOG[6], 'display')).toBe(MATCH.wordPrefix);
    expect(matchRank(CATALOG[6], 'layfair')).toBe(MATCH.substring);
    expect(matchRank(CATALOG[3], 'display')).toBe(MATCH.category);
    expect(matchRank(CATALOG[0], 'zzz')).toBeNull();
  });

  it('puts the exact name first and breaks ties by recent, then common, then alphabet', () => {
    expect(ids('roboto')[0]).toBe('roboto');
    expect(ids('roboto', { recent: ['slab'] })).toEqual(['roboto', 'slab', 'roboto-mono']);
    expect(ids('roboto', { common: ['roboto-mono'] })).toEqual(['roboto', 'roboto-mono', 'slab']);
  });

  it('with no query: recent first, then common in their order, then the rest alphabetically', () => {
    const hits = searchFonts(CATALOG, '', { recent: ['lobster'], common: ['roboto', 'aleo'] });
    expect(hits.map((h) => h.entry.id)).toEqual(['lobster', 'roboto', 'aleo', 'bebas-neue', 'playfair-display', 'roboto-mono', 'slab']);
    expect(hits.map((h) => h.group).slice(0, 4)).toEqual(['recent', 'common', 'common', 'all']);
  });

  it('ignores case, spaces and punctuation, and filters by category and variable axes', () => {
    expect(ids('  BEBAS-neue ')).toEqual(['bebas-neue']);
    expect(ids('', { category: 'serif' })).toEqual(['aleo', 'playfair-display', 'slab']);
    expect(ids('roboto', { variableOnly: true })).toEqual(['roboto', 'roboto-mono']);
  });

  it('lists categories by how many families they hold', () => {
    expect(categoriesOf(CATALOG)).toEqual(['serif', 'display', 'monospace', 'sans-serif']);
  });
});

describe('cache eviction', () => {
  const rec = (id: string, size: number, lastUsed: number): CacheRecord => ({ id, size, lastUsed });
  const bounds = { maxBytes: 100, maxEntries: 10 };

  it('evicts nothing within bounds', () => {
    expect(planEviction([rec('a', 50, 1), rec('b', 50, 2)], bounds)).toEqual([]);
  });

  it('evicts the least recently used first, until within the byte bound', () => {
    expect(planEviction([rec('a', 60, 3), rec('b', 60, 1), rec('c', 60, 2)], bounds)).toEqual(['b', 'c']);
  });

  it('bounds the number of entries too', () => {
    expect(planEviction([rec('a', 1, 3), rec('b', 1, 1), rec('c', 1, 2)], { maxBytes: 100, maxEntries: 2 })).toEqual(['b']);
  });

  it('keeps the protected (common) ids until nothing else is left', () => {
    const records = [rec('common-old', 60, 1), rec('user-new', 60, 9)];
    expect(planEviction(records, bounds, new Set(['common-old']))).toEqual(['user-new']);
    expect(planEviction([rec('c1', 80, 1), rec('c2', 80, 2)], bounds, new Set(['c1', 'c2']))).toEqual(['c1']);
  });
});

describe('the cached loader', () => {
  const bytes = (n: number, fill = 1) => new Uint8Array(n).fill(fill);

  it('loads once, then serves from the cache, and gives the same array within a session', async () => {
    const store = memoryFontStore();
    let calls = 0;
    const load = cachedLoader(async () => (calls++, bytes(10)), store);
    const a = await load('x');
    const b = await load('x');
    expect(calls).toBe(1);
    expect(a).toBe(b);
    // A new session (a fresh loader on the same store) reads the store, not the network.
    const again = cachedLoader(async () => (calls++, bytes(10)), store);
    expect((await again('x')).byteLength).toBe(10);
    expect(calls).toBe(1);
  });

  it('prunes to its bounds, evicting the least recently used', async () => {
    const store = memoryFontStore();
    let clock = 0;
    const load = cachedLoader(async (id) => bytes(40, id.charCodeAt(0)), store, { bounds: { maxBytes: 100, maxEntries: 10 }, now: () => ++clock });
    await load('a');
    await load('b');
    await load('c');
    expect((await store.records()).map((r) => r.id).sort()).toEqual(['b', 'c']);
  });

  it('does not cache failures', async () => {
    const store = memoryFontStore();
    let fail = true;
    const load = cachedLoader(async () => { if (fail) throw new Error('offline'); return bytes(4); }, store);
    await expect(load('x')).rejects.toThrow('offline');
    fail = false;
    expect((await load('x')).byteLength).toBe(4);
  });
});

describe('the cached catalogue', () => {
  it('is fetched once while fresh, refetched when stale, and a stale copy serves when offline', async () => {
    const store = memoryFontStore();
    let now = 0;
    let calls = 0;
    let offline = false;
    const fetchCatalog = async () => {
      calls++;
      if (offline) throw new Error('offline');
      return CATALOG;
    };
    const ttlMs = 1000;
    await cachedCatalog(fetchCatalog, store, { ttlMs, now: () => now })();
    await cachedCatalog(fetchCatalog, store, { ttlMs, now: () => now })();
    expect(calls).toBe(1);
    now = 5000;
    offline = true;
    expect(await cachedCatalog(fetchCatalog, store, { ttlMs, now: () => now })()).toHaveLength(CATALOG.length);
    expect(calls).toBe(2);
  });
});

describe('recent fonts and previews', () => {
  it('moves a repeat to the front and keeps the list bounded', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(pushRecent(['a', 'b'], 'c', 2)).toEqual(['c', 'a']);
  });

  it('asks the CSS API for the letters of the name only', () => {
    expect(previewCssUrl('Playfair Display')).toBe('https://fonts.googleapis.com/css2?family=Playfair+Display&text=Playfair%20Display&display=swap');
  });
});

describe('editing a text source', () => {
  const base = TextSourceSchema.parse({ kind: 'text', text: 'HELLO' });
  const wght: FontAxis = { tag: 'wght', min: 100, default: 400, max: 900 };

  it('switching font resets axes and moves the spacing default with the kind of font', () => {
    const outline = withFont({ ...base, axes: { wght: 700 } }, 'roboto');
    expect(outline).toMatchObject({ font: 'roboto', axes: {}, spacing: DEFAULT_SPACING.outline });
    expect(withFont(outline, 'block').spacing).toBe(DEFAULT_SPACING.block);
    expect(withFont({ ...base, spacing: 2 }, 'roboto').spacing).toBe(2);
  });

  it('stores an axis only when it differs from the default', () => {
    expect(withAxis({}, wght, 700)).toEqual({ wght: 700 });
    expect(withAxis({ wght: 700 }, wght, 400)).toEqual({});
  });

  it('filters block text to the block font and bounds any text', () => {
    expect(filterBlockText('a b€')).toBe('A B');
    expect(withFont({ ...base, text: '€€' }, 'block').text).toBe('A');
  });

  it('splits into runs and merges back, keeping the text and the font', () => {
    const split = toRuns(base);
    expect(split.runs).toEqual([{ text: 'HELLO' }]);
    const two = addRun(patchRun(split, 0, { font: 'roboto' }), 'WORLD');
    expect(two.runs).toEqual([{ text: 'HELLO', font: 'roboto' }, { text: 'WORLD', font: 'roboto' }]);
    expect(two.text).toBe('HELLOWORLD');
    const merged = fromRuns(two);
    expect(merged.runs).toBeUndefined();
    expect(merged.text).toBe('HELLOWORLD');
  });

  it('keeps `text` equal to the runs joined through edits, never empty, and never over the bound', () => {
    let s = addRun(toRuns(base), 'ABC');
    s = patchRun(s, 1, { text: 'XY' });
    expect(s.text).toBe('HELLOXY');
    expect(patchRun(s, 1, { text: '' })).toBe(s);
    expect(removeRun(s, 0).text).toBe('XY');
    expect(removeRun(removeRun(s, 0), 0).text).toBe('XY');
    const long = addRun(toRuns({ ...base, text: 'A'.repeat(MAX_TEXT_LENGTH) }), 'B');
    expect(long.text.length).toBe(MAX_TEXT_LENGTH);
  });

  it('gives a run its own font and drops its axes', () => {
    const s = withRunFont(patchRun(toRuns(base), 0, { axes: { wght: 700 } }), 0, 'lobster');
    expect(s.runs?.[0]).toMatchObject({ font: 'lobster' });
    expect(s.runs?.[0].axes).toBeUndefined();
  });

  it('produces sources the schema accepts', () => {
    const s = addRun(withRunFont(toRuns(base), 0, 'roboto'), 'BLOCK');
    expect(TextSourceSchema.safeParse(s).success).toBe(true);
  });
});
