/**
 * Where designs are kept: the `store` seam. The default is zodal's localStorage provider; a
 * replacement (zodal's S3 or Supabase providers) has the same `DataProvider` interface.
 */
import type { DataProvider } from '@zodal/store';
import { createLocalStorageProvider } from '@zodal/store-localstorage';
import { DesignSchema, type Design } from 'shaping';

export interface SavedDesign {
  id: string;
  title: string;
  genre: string;
  updated: string;
  design: Design;
}

const STORAGE_KEY = 'shaping.designs.v1';

export function designStore(provider: DataProvider<SavedDesign> = createLocalStorageProvider<SavedDesign>({ storageKey: STORAGE_KEY, idField: 'id' })) {
  return {
    async list(): Promise<SavedDesign[]> {
      const { data } = await provider.getList({ sort: [{ id: 'updated', desc: true }], pagination: { page: 1, pageSize: 500 } });
      return data;
    },
    async get(id: string): Promise<Design | null> {
      try {
        const s = await provider.getOne(id);
        const r = DesignSchema.safeParse(s.design);
        return r.success ? r.data : null;
      } catch {
        return null;
      }
    },
    async save(design: Design): Promise<void> {
      const item: SavedDesign = { id: design.id, title: design.title, genre: design.genre, updated: new Date().toISOString(), design };
      if (provider.upsert) await provider.upsert(item);
      else {
        try {
          await provider.update(design.id, item);
        } catch {
          await provider.create(item);
        }
      }
    },
    async remove(id: string): Promise<void> {
      await provider.delete(id);
    },
  };
}

export const designs = designStore();
