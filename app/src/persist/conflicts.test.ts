/** Merging a collection: identical, different, and renaming that avoids new collisions. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_RENAME_PREFIX, RENAMED_TITLE_SUFFIX, planMerge, renamedKey, resolveMerge, sameValue } from './conflicts';
import { makeDesign } from './testing';
import type { ImportDecision } from './types';

const rename: ImportDecision = { perKey: {}, fallback: 'rename', prefix: DEFAULT_RENAME_PREFIX };
const byKey = (...ds: ReturnType<typeof makeDesign>[]) => Object.fromEntries(ds.map((d) => [d.id, d]));

describe('planMerge', () => {
  const a = makeDesign('a');
  const b = makeDesign('b');

  it('sorts items into added, identical and conflicting', () => {
    const changed = makeDesign('a', { title: 'Changed' });
    const plan = planMerge(byKey(a, b), byKey(changed, b, makeDesign('c')));
    expect(Object.keys(plan.added)).toEqual(['c']);
    expect(plan.identical).toEqual(['b']);
    expect(plan.conflicts.map((c) => c.key)).toEqual(['a']);
  });

  it('treats equal values as identical whatever their key order', () => {
    const reordered = JSON.parse(JSON.stringify(a), (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v));
    expect(sameValue(a, reordered)).toBe(true);
    expect(planMerge(byKey(a), byKey(reordered)).identical).toEqual(['a']);
  });
});

describe('resolveMerge', () => {
  const mine = makeDesign('a', { title: 'Mine' });
  const theirs = makeDesign('a', { title: 'Theirs' });
  const plan = () => planMerge(byKey(mine), byKey(theirs, makeDesign('n')));

  it('renames by default: both kept, the incoming one under a prefixed key and id', () => {
    const { writes, summary } = resolveMerge(plan(), rename);
    expect(Object.keys(writes).sort()).toEqual(['imported-a', 'n']);
    expect(writes['imported-a'].id).toBe('imported-a');
    expect(writes['imported-a'].title).toBe('Theirs' + RENAMED_TITLE_SUFFIX);
    expect(summary.renamed).toEqual([{ from: 'a', to: 'imported-a' }]);
  });

  it('replaces or skips when asked, for all or per item', () => {
    expect(resolveMerge(plan(), { ...rename, fallback: 'replace' }).writes.a.title).toBe('Theirs');
    const skipped = resolveMerge(plan(), { ...rename, fallback: 'skip' });
    expect(skipped.writes.a).toBeUndefined();
    expect(skipped.summary.skipped).toEqual(['a']);
    const p = planMerge(byKey(mine, makeDesign('b')), byKey(theirs, makeDesign('b', { title: 'B2' })));
    const r = resolveMerge(p, { perKey: { b: 'replace' }, fallback: 'skip', prefix: 'x-' });
    expect(r.summary.replaced).toEqual(['b']);
    expect(r.summary.skipped).toEqual(['a']);
  });

  it('never renames onto an existing key: the prefix is extended with a counter', () => {
    const existing = byKey(mine, makeDesign('imported-a', { title: 'Unrelated' }));
    const { writes } = resolveMerge(planMerge(existing, byKey(theirs)), rename);
    expect(Object.keys(writes)).toEqual(['imported-2-a']);
  });

  it('never renames onto a key that arrives in the same file', () => {
    const existing = byKey(mine);
    const incoming = byKey(theirs, makeDesign('imported-a', { title: 'Also incoming' }));
    const { writes } = resolveMerge(planMerge(existing, incoming), rename);
    expect(Object.keys(writes).sort()).toEqual(['imported-2-a', 'imported-a']);
  });

  it('gives distinct keys to several renamed items', () => {
    const existing = byKey(makeDesign('a'), makeDesign('imported-a', { title: 'x' }), makeDesign('imported-2-a', { title: 'y' }));
    const incoming = byKey(makeDesign('a', { title: 'new' }));
    const { writes } = resolveMerge(planMerge(existing, incoming), rename);
    expect(Object.keys(writes)).toEqual(['imported-3-a']);
  });

  it('importing the same file twice changes nothing the second time', () => {
    const first = resolveMerge(plan(), rename);
    const after = { ...byKey(mine), ...first.writes };
    const second = resolveMerge(planMerge(after, byKey(theirs)), rename);
    expect(second.writes).toEqual({});
    expect(second.summary.identical).toEqual(['a']);
  });

  it('renamedKey reports null for an already-imported copy', () => {
    const copy = { ...theirs, id: 'imported-a', title: theirs.title + RENAMED_TITLE_SUFFIX };
    const key = renamedKey('a', theirs, { prefix: 'imported-', taken: new Set(['a', 'imported-a']), existing: byKey(mine, copy) });
    expect(key).toBeNull();
  });
});
