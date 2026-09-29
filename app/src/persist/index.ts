/**
 * The persistence seam, wired with its defaults: designs in the browser (`state/designs.ts`),
 * images in IndexedDB (`lib/blobs.ts`), links in the query string, files as JSON, the app
 * installable. The UI imports `persistence` and `installer` from here.
 *
 * To replace the default, implement `Persistence` / `Installer` (see `types.ts`) and export your
 * object under these names.
 */
import type { Design } from 'shaping';
import { getBlob, isBlobRef, putBlob } from '../lib/blobs';
import { designs } from '../state/designs';
import { blobRefs } from './files';
import { createInstaller } from './install';
import { createPersistence } from './service';
import type { BlobStore } from './types';

export * from './types';
export { sharedParam, SHARE_PARAM } from './link';
export { DEFAULT_RENAME_PREFIX, DEFAULT_RESOLUTION } from './conflicts';
export { registerServiceWorker } from './install';

export const blobStore: BlobStore = {
  get: getBlob,
  put: putBlob,
  has: (ref) => getBlob(ref).then(() => true, () => false),
  isRef: isBlobRef,
};

export const persistence = createPersistence({ blobs: blobStore, repo: designs });
export const installer = createInstaller();

/** Does the design use images kept in this browser (which only a file can carry)? */
export const hasLocalImages = (design: Design) => blobRefs(design, blobStore).length > 0;
