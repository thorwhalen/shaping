/** Files: round trips with and without images, validation of what is read, and the whole import flow. */
import { describe, expect, it } from 'vitest';
import { COLLECTION_FORMAT, DESIGN_FORMAT, FILE_FORMAT_VERSION, FILE_SUFFIX, exportCollection, exportDesign, parseFile, slug } from './files';
import { createPersistence } from './service';
import { imageDesign, makeDesign, memoryBlobs, memoryRepo, textDesign } from './testing';
import { describeSummary } from './summary';
import { DEFAULT_RENAME_PREFIX } from './conflicts';

const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);

describe('design files', () => {
  it('is named after the title', async () => {
    const f = await exportDesign(makeDesign('a', { title: 'My Ring & Things!' }), { embedImages: false }, memoryBlobs());
    expect(f.filename).toBe('my-ring-things' + FILE_SUFFIX);
    expect(slug('???')).toBe('design');
  });

  it('round-trips a design', async () => {
    const d = textDesign('a', 'Hello');
    const f = await exportDesign(d, { embedImages: false }, memoryBlobs());
    const parsed = parseFile(f.text);
    expect(parsed).toEqual({ kind: 'design', design: d, images: {} });
  });

  it('embeds images as data URLs and restores them into the store', async () => {
    const source = memoryBlobs();
    const ref = await source.put(PNG, 'image/png', 'pic.png');
    const d = imageDesign('a', ref);
    const f = await exportDesign(d, { embedImages: true }, source);
    expect(JSON.parse(f.text).images[ref].dataUrl).toMatch(/^data:image\/png;base64,/);

    const fresh = memoryBlobs();
    const p = createPersistence({ blobs: fresh, repo: memoryRepo() });
    const file = p.parseFile(f.text);
    if (file.kind !== 'design') throw new Error('expected a design');
    const opened = await p.openDesignFile(file);
    expect(opened.id).not.toBe('a');
    const src = (opened.sources.profile as { src: string }).src;
    expect((await fresh.get(src)).bytes).toEqual(PNG);
  });

  it('warns when an image cannot be included', async () => {
    const f = await exportDesign(imageDesign('a', 'idb:gone'), { embedImages: true }, memoryBlobs());
    expect(f.warnings[0]).toMatch(/no longer in this browser/);
    expect(JSON.parse(f.text).images).toBeUndefined();
  });

  it('accepts a bare design (like the example files)', () => {
    expect(parseFile(JSON.stringify(makeDesign('a'))).kind).toBe('design');
  });
});

describe('validation of what is read', () => {
  it.each([
    ['not json', /not JSON/],
    ['[1,2]', /holds no design/],
    ['{"hello":1}', /neither a design nor a collection/],
    [JSON.stringify({ format: DESIGN_FORMAT, formatVersion: FILE_FORMAT_VERSION, design: { version: 1, id: 'a' } }), /valid design/],
    [JSON.stringify({ format: DESIGN_FORMAT, formatVersion: FILE_FORMAT_VERSION + 1, design: {} }), /newer version/],
    [JSON.stringify({ format: COLLECTION_FORMAT, formatVersion: 1 }), /no "items"/],
    [JSON.stringify({ format: DESIGN_FORMAT, formatVersion: 1, design: makeDesign('a'), images: { x: 5 } }), /images/],
  ])('rejects %s', (text, message) => {
    expect(() => parseFile(text)).toThrow(message);
  });

  it('reports invalid items of a collection and keeps the valid ones', () => {
    const text = JSON.stringify({ format: COLLECTION_FORMAT, formatVersion: 1, items: { ok: makeDesign('ok'), bad: { version: 1 } } });
    const parsed = parseFile(text);
    if (parsed.kind !== 'collection') throw new Error('expected a collection');
    expect(Object.keys(parsed.items)).toEqual(['ok']);
    expect(parsed.rejected.map((r) => r.key)).toEqual(['bad']);
  });

  it('makes the item id follow its key', () => {
    const text = JSON.stringify({ format: COLLECTION_FORMAT, formatVersion: 1, items: { k: makeDesign('other') } });
    const parsed = parseFile(text);
    if (parsed.kind !== 'collection') throw new Error('expected a collection');
    expect(parsed.items.k.id).toBe('k');
  });
});

describe('collection export and import', () => {
  it('exports every design keyed by id, and dates the file name', async () => {
    const f = await exportCollection([makeDesign('a'), makeDesign('b')], { embedImages: false }, memoryBlobs(), new Date(2026, 8, 5));
    expect(f.filename).toBe('shaping-designs-2026-09-05' + FILE_SUFFIX);
    const json = JSON.parse(f.text);
    expect(Object.keys(json.items)).toEqual(['a', 'b']);
    expect(json.formatVersion).toBe(FILE_FORMAT_VERSION);
  });

  it('imports into another browser: identical skipped, conflicts renamed, images restored', async () => {
    const blobs = memoryBlobs();
    const ref = await blobs.put(PNG, 'image/png', 'pic.png');
    const theirs = [makeDesign('same'), makeDesign('clash', { title: 'Theirs' }), imageDesign('img', ref)];
    const file = await exportCollection(theirs, { embedImages: true }, blobs);

    const targetBlobs = memoryBlobs();
    const repo = memoryRepo([makeDesign('same'), makeDesign('clash', { title: 'Mine' })]);
    const p = createPersistence({ blobs: targetBlobs, repo });
    const plan = await p.planImport(p.parseFile(file.text));
    expect(plan.identical).toEqual(['same']);
    expect(plan.conflicts.map((c) => c.key)).toEqual(['clash']);

    const summary = await p.applyImport(plan, { perKey: {}, fallback: 'rename', prefix: DEFAULT_RENAME_PREFIX });
    expect([...repo.items.keys()].sort()).toEqual(['clash', 'img', 'imported-clash', 'same']);
    expect(repo.items.get('clash')!.title).toBe('Mine');
    expect(await targetBlobs.has(ref)).toBe(true);
    expect(summary.missingImages).toEqual([]);
    expect(describeSummary(summary)).toMatch(/1 design added; 1 design kept alongside yours under a new name; 1 design already here/);
  });

  it('reports images that are neither in the file nor in the browser', async () => {
    const p = createPersistence({ blobs: memoryBlobs(), repo: memoryRepo() });
    const file = await exportCollection([imageDesign('img', 'idb:lost')], { embedImages: false }, memoryBlobs());
    const summary = await p.applyImport(await p.planImport(p.parseFile(file.text)), { perKey: {}, fallback: 'rename', prefix: 'x-' });
    expect(summary.missingImages).toEqual(['idb:lost']);
    expect(describeSummary(summary)).toMatch(/not in this browser/);
  });
});
