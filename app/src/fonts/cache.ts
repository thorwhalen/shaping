/**
 * The browser cache of font files: what stays on this device so a font used once loads instantly
 * the next time, without letting the cache grow without bound.
 *
 * - `FontStore` is the storage seam: IndexedDB in the browser (`indexedDbFontStore`, usable from
 *   the page and from the geometry worker), a `Map` in tests (`memoryFontStore`).
 * - Eviction is least-recently-used within a bound on bytes and on entries, and families in the
 *   `keep` set (the common ones) are evicted last, only when nothing else is left to evict.
 * - Nothing is prefetched: a file enters the cache the first time it is used.
 */
import type { FontEntry, FontLoader } from 'shaping/fonts';

/** What is known about a cached file, without its bytes. */
export interface CacheRecord {
  id: string;
  size: number;
  /** When the file was last used, in ms since the epoch. */
  lastUsed: number;
}

export interface CacheBounds {
  maxBytes: number;
  maxEntries: number;
}

const BYTES_PER_MB = 1024 * 1024;
export const DEFAULT_CACHE_BOUNDS: CacheBounds = { maxBytes: 64 * BYTES_PER_MB, maxEntries: 150 };

/** The ids to evict so that what remains is within the bounds: oldest first, `keep` ids last. */
export function planEviction(records: readonly CacheRecord[], bounds: CacheBounds, keep: ReadonlySet<string> = new Set()): string[] {
  const order = [...records].sort((a, b) => Number(keep.has(a.id)) - Number(keep.has(b.id)) || a.lastUsed - b.lastUsed);
  let bytes = records.reduce((s, r) => s + r.size, 0);
  let count = records.length;
  const out: string[] = [];
  for (const r of order) {
    if (bytes <= bounds.maxBytes && count <= bounds.maxEntries) break;
    out.push(r.id);
    bytes -= r.size;
    count--;
  }
  return out;
}

/** Where cached files (and one small piece of metadata, the catalogue) are kept. */
export interface FontStore {
  get(id: string): Promise<Uint8Array | undefined>;
  put(id: string, bytes: Uint8Array, lastUsed: number): Promise<void>;
  touch(id: string, lastUsed: number): Promise<void>;
  records(): Promise<CacheRecord[]>;
  remove(ids: string[]): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  putMeta<T>(key: string, value: T): Promise<void>;
}

export function memoryFontStore(): FontStore {
  const files = new Map<string, { bytes: Uint8Array; lastUsed: number }>();
  const meta = new Map<string, unknown>();
  return {
    get: async (id) => files.get(id)?.bytes,
    put: async (id, bytes, lastUsed) => void files.set(id, { bytes, lastUsed }),
    touch: async (id, lastUsed) => {
      const f = files.get(id);
      if (f) f.lastUsed = lastUsed;
    },
    records: async () => [...files].map(([id, f]) => ({ id, size: f.bytes.byteLength, lastUsed: f.lastUsed })),
    remove: async (ids) => ids.forEach((id) => files.delete(id)),
    getMeta: async <T>(key: string) => meta.get(key) as T | undefined,
    putMeta: async (key, value) => void meta.set(key, value),
  };
}

const DB_NAME = 'shaping-fonts';
const FILES = 'files';
const META = 'meta';

/** The IndexedDB store. Opens the database on first use. */
export function indexedDbFontStore(): FontStore {
  let db: Promise<IDBDatabase> | null = null;
  const open = () =>
    (db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(FILES, { keyPath: 'id' });
        req.result.createObjectStore(META);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  const run = async <T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const s = (await open()).transaction(store, mode).objectStore(store);
    return new Promise((resolve, reject) => {
      const r = fn(s);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  };
  return {
    get: async (id) => (await run<{ bytes: Uint8Array } | undefined>(FILES, 'readonly', (s) => s.get(id)))?.bytes,
    put: async (id, bytes, lastUsed) => void (await run(FILES, 'readwrite', (s) => s.put({ id, bytes, size: bytes.byteLength, lastUsed }))),
    touch: async (id, lastUsed) => {
      const row = await run<Record<string, unknown> | undefined>(FILES, 'readonly', (s) => s.get(id));
      if (row) await run(FILES, 'readwrite', (s) => s.put({ ...row, lastUsed }));
    },
    records: async () => (await run<CacheRecord[]>(FILES, 'readonly', (s) => s.getAll())).map(({ id, size, lastUsed }) => ({ id, size, lastUsed })),
    remove: async (ids) => {
      for (const id of ids) await run(FILES, 'readwrite', (s) => s.delete(id));
    },
    getMeta: (key) => run(META, 'readonly', (s) => s.get(key)),
    putMeta: async (key, value) => void (await run(META, 'readwrite', (s) => s.put(value, key))),
  };
}

/** Font files kept in memory for the session (the rest are read from the store). */
const SESSION_ENTRIES = 16;

export interface CachedLoaderOptions {
  bounds?: CacheBounds;
  /** Ids evicted last (the common families). */
  keep?: ReadonlySet<string>;
  /** The clock, for tests. */
  now?: () => number;
}

/**
 * Wrap a font loader with the cache: a hit is returned (and marked used), a miss is loaded, stored,
 * and the cache pruned to its bounds. Bytes are also kept in memory for the session, so asking for
 * the same font twice gives the same array (which lets the parser recognise it).
 */
export function cachedLoader(load: FontLoader, store: FontStore, opts: CachedLoaderOptions = {}): FontLoader {
  const bounds = opts.bounds ?? DEFAULT_CACHE_BOUNDS;
  const now = opts.now ?? Date.now;
  const session = new Map<string, Promise<Uint8Array>>();
  const fetchOne = async (id: string): Promise<Uint8Array> => {
    const hit = await store.get(id).catch(() => undefined);
    if (hit) {
      void store.touch(id, now()).catch(() => undefined);
      return hit;
    }
    const bytes = await load(id);
    try {
      await store.put(id, bytes, now());
      await store.remove(planEviction(await store.records(), bounds, opts.keep));
    } catch {
      // A full or unavailable store must not stop the font from being used.
    }
    return bytes;
  };
  return (id) => {
    let p = session.get(id);
    if (!p) {
      session.set(id, (p = fetchOne(id).catch((e) => (session.delete(id), Promise.reject(e)))));
      if (session.size > SESSION_ENTRIES) session.delete(session.keys().next().value!);
    }
    return p;
  };
}

const CATALOG_KEY = 'catalog';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** How long a cached catalogue is used before it is fetched again. */
export const CATALOG_TTL_MS = 7 * MS_PER_DAY;

/** Wrap the catalogue fetch with the store: a fresh saved copy is used, else it is fetched and saved (a stale copy stands in when offline). */
export function cachedCatalog(fetchCatalog: () => Promise<FontEntry[]>, store: FontStore, opts: { ttlMs?: number; now?: () => number } = {}): () => Promise<FontEntry[]> {
  const ttl = opts.ttlMs ?? CATALOG_TTL_MS;
  const now = opts.now ?? Date.now;
  let memo: Promise<FontEntry[]> | null = null;
  const resolve = async (): Promise<FontEntry[]> => {
    const saved = await store.getMeta<{ savedAt: number; entries: FontEntry[] }>(CATALOG_KEY).catch(() => undefined);
    if (saved && now() - saved.savedAt < ttl) return saved.entries;
    try {
      const entries = await fetchCatalog();
      await store.putMeta(CATALOG_KEY, { savedAt: now(), entries }).catch(() => undefined);
      return entries;
    } catch (e) {
      if (saved) return saved.entries;
      throw e;
    }
  };
  return () => (memo ??= resolve().catch((e) => ((memo = null), Promise.reject(e))));
}
