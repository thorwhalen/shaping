import { createInMemoryProvider } from '@zodal/store';
import { describe, expect, it } from 'vitest';
import { newDesign } from 'shaping';
import { genres } from '../genres';
import { designStore, type SavedDesign } from './designs';

const make = async (n: number) => {
  const store = designStore(createInMemoryProvider<SavedDesign>([], { idField: 'id' }));
  const ds = Array.from({ length: n }, (_, i) => ({ ...newDesign(Object.keys(genres)[0]!, genres), title: `d${i}` }));
  for (const d of ds) await store.save(d);
  return { store, ids: ds.map((d) => d.id) };
};

describe('designs: delete means Move to Trash', () => {
  it('trash hides designs from the list and keeps them whole; restore brings them back', async () => {
    const { store, ids } = await make(3);
    expect(await store.trash([ids[0]!, ids[1]!])).toEqual(expect.arrayContaining([ids[0], ids[1]]));
    expect((await store.list()).map((d) => d.id)).toEqual([ids[2]]);
    const inTrash = await store.listTrash();
    expect(inTrash.map((d) => d.id).sort()).toEqual([ids[0], ids[1]].sort());
    expect(inTrash[0]!.design.title).toMatch(/^d/);
    await store.restore([ids[0]!, ids[1]!]);
    expect((await store.list()).length).toBe(3);
    expect(await store.listTrash()).toEqual([]);
  });

  it('purge deletes only what is in the Trash', async () => {
    const { store, ids } = await make(2);
    await store.trash([ids[0]!]);
    expect(await store.purge([ids[0]!, ids[1]!])).toEqual([ids[0]]);
    expect((await store.list()).map((d) => d.id)).toEqual([ids[1]]);
    expect(await store.listTrash()).toEqual([]);
  });
});
