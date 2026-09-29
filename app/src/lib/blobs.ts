/**
 * Source images kept in the browser's IndexedDB between visits, addressed as `idb:<key>`.
 * Used from both the page and the geometry worker (IndexedDB is available in both).
 *
 * seam candidate: a blob store — it becomes one the day designs are shared between devices.
 */
const DB_NAME = 'shaping';
const STORE = 'blobs';
const PREFIX = 'idb:';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export interface StoredBlob {
  bytes: Uint8Array;
  mediaType: string;
  name: string;
}

export const isBlobRef = (src: string) => src.startsWith(PREFIX);

/** Store bytes; returns the `idb:` reference to put in a design. The key is a content hash. */
export async function putBlob(bytes: Uint8Array, mediaType: string, name: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  const key = [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
  await tx('readwrite', (s) => s.put({ bytes, mediaType, name } satisfies StoredBlob, key));
  return PREFIX + key;
}

export async function getBlob(ref: string): Promise<StoredBlob> {
  const v = await tx<StoredBlob | undefined>('readonly', (s) => s.get(ref.slice(PREFIX.length)));
  if (!v) throw new Error(`The image ${ref} is not in this browser's storage (it was added on another device, or storage was cleared). Upload it again.`);
  return v;
}
