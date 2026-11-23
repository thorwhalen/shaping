/**
 * Where designs are kept: the `store` seam. The default is zodal's localStorage provider; a
 * replacement (zodal's S3 or Supabase providers) has the same `DataProvider` interface.
 *
 * Delete means Move to Trash: a trashed design keeps everything and gets a `deleted` time; it is
 * left out of `list` and shown by `listTrash`, from where it is restored or deleted for good
 * (`purge`, the only call that removes a record).
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
  /** When it was moved to the Trash (absent: not in the Trash). */
  deleted?: string;
}

const STORAGE_KEY = 'shaping.designs.v1';
const LIST_PAGE_SIZE = 200;

export function designStore(provider: DataProvider<SavedDesign> = createLocalStorageProvider<SavedDesign>({ storageKey: STORAGE_KEY, idField: 'id' })) {
  /** Every record, newest first (paged through, so nothing is left out). */
  async function all(): Promise<SavedDesign[]> {
    const out: SavedDesign[] = [];
    for (let page = 1; ; page++) {
      const { data, total } = await provider.getList({ sort: [{ id: 'updated', desc: true }], pagination: { page, pageSize: LIST_PAGE_SIZE } });
      out.push(...data);
      if (data.length < LIST_PAGE_SIZE || out.length >= total) return out;
    }
  }
  async function put(item: SavedDesign): Promise<void> {
    if (provider.upsert) await provider.upsert(item);
    else {
      try {
        await provider.update(item.id, item);
      } catch {
        await provider.create(item);
      }
    }
  }
  /** Set or clear `deleted` on these records; the ids it changed. */
  async function mark(ids: readonly string[], deleted: string | undefined): Promise<string[]> {
    const wanted = new Set(ids);
    const done: string[] = [];
    for (const item of await all()) {
      if (!wanted.has(item.id) || Boolean(item.deleted) === Boolean(deleted)) continue;
      const { deleted: _gone, ...rest } = item;
      await put(deleted ? { ...rest, deleted } : rest);
      done.push(item.id);
    }
    return done;
  }

  return {
    /** Every saved design not in the Trash, newest first. */
    async list(): Promise<SavedDesign[]> {
      return (await all()).filter((d) => !d.deleted);
    },
    /** What is in the Trash, most recently moved there first. */
    async listTrash(): Promise<SavedDesign[]> {
      return (await all()).filter((d) => d.deleted).sort((a, b) => (b.deleted ?? '').localeCompare(a.deleted ?? ''));
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
      await put({ id: design.id, title: design.title, genre: design.genre, updated: new Date().toISOString(), design });
    },
    /** Move designs to the Trash (kept whole); the ids moved. */
    trash(ids: readonly string[]): Promise<string[]> {
      return mark(ids, new Date().toISOString());
    },
    /** Put designs back from the Trash; the ids restored. */
    restore(ids: readonly string[]): Promise<string[]> {
      return mark(ids, undefined);
    },
    /** Delete designs for good (only from the Trash); the ids deleted. */
    async purge(ids: readonly string[]): Promise<string[]> {
      const inTrash = new Set((await all()).filter((d) => d.deleted).map((d) => d.id));
      const done = ids.filter((id) => inTrash.has(id));
      for (const id of done) await provider.delete(id);
      return done;
    },
    /** Move to the Trash (the old name: delete is a move now). */
    async remove(id: string): Promise<void> {
      await this.trash([id]);
    },
  };
}

export const designs = designStore();
