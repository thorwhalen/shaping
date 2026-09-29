/** Test helpers for the persistence tests: designs, an in-memory blob store and an in-memory repository. */
import { DESIGN_VERSION, parseDesign, type Design, type DesignInput } from 'shaping';
import type { BlobStore, DesignRepository, StoredBlob } from './types';

export function makeDesign(id: string, over: Partial<DesignInput> = {}): Design {
  return parseDesign({ version: DESIGN_VERSION, id, title: `Design ${id}`, genre: 'turned', sources: { profile: { kind: 'shape', shape: 'circle' } }, ...over });
}

export const textDesign = (id: string, text: string, font = 'block') =>
  makeDesign(id, { sources: { profile: { kind: 'text', text, font } } });

export const imageDesign = (id: string, src: string) => makeDesign(id, { sources: { profile: { kind: 'image', src, name: 'pic' } } });

/** A blob store in memory; the key is the byte length and first byte, which is enough to tell test images apart. */
export function memoryBlobs(): BlobStore & { data: Map<string, StoredBlob> } {
  const data = new Map<string, StoredBlob>();
  return {
    data,
    isRef: (src) => src.startsWith('idb:'),
    async get(ref) {
      const b = data.get(ref);
      if (!b) throw new Error(`missing ${ref}`);
      return b;
    },
    async put(bytes, mediaType, name) {
      const ref = `idb:${bytes.length}-${bytes[0] ?? 0}`;
      data.set(ref, { bytes, mediaType, name });
      return ref;
    },
    has: async (ref) => data.has(ref),
  };
}

export function memoryRepo(initial: Design[] = []): DesignRepository & { items: Map<string, Design> } {
  const items = new Map(initial.map((d) => [d.id, d]));
  return {
    items,
    list: async () => [...items.values()].map((design) => ({ id: design.id, design })),
    save: async (d) => void items.set(d.id, d),
  };
}
