/**
 * The persistence seam: what the app needs from "keeping, sharing and restoring work", stated as
 * interfaces. The UI (`ShareMenu`, `CollectionTools`, `InstallNotice`) and `App.tsx` depend on
 * these and on nothing below them.
 *
 * A replacement (for example a general client-side persistence tool that syncs to a cloud drive,
 * or a share service that stores designs behind short links) implements `Persistence` and
 * `Installer` and is wired in `index.ts`; no caller changes. What a replacement must honour:
 *
 * - A `Design` is validated with `DesignSchema` on every way in (link, file, collection).
 * - Opening a link or a file yields a copy under a new id; a collection import keeps ids (keys)
 *   and resolves clashes with the user's decision (see `conflicts.ts`).
 * - Nothing leaves the browser except inside a link or a file the user chose to make.
 * - Failures are `PersistError`s with a message that can be shown to the user as it is.
 *
 * The defaults are in `link.ts` (query string), `files.ts` (JSON files), `conflicts.ts` (merge
 * rules), `install.ts` (installable app) and `service.ts` (the wiring).
 */
import type { Design } from 'shaping';

/** An error whose message is meant to be shown to the user unchanged. */
export class PersistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistError';
  }
}

// ---------------------------------------------------------------- images

export interface StoredBlob {
  bytes: Uint8Array;
  mediaType: string;
  name: string;
}

/** Where source images that are not URLs are kept (the default is IndexedDB, `lib/blobs.ts`). */
export interface BlobStore {
  get(ref: string): Promise<StoredBlob>;
  /** Store bytes; returns the reference to put in a design. */
  put(bytes: Uint8Array, mediaType: string, name: string): Promise<string>;
  has(ref: string): Promise<boolean>;
  /** Is this source string a reference into this store? */
  isRef(src: string): boolean;
}

/** An image carried inside a file: a data URL plus what is needed to store it again. */
export interface EmbeddedImage {
  dataUrl: string;
  name: string;
}

// ---------------------------------------------------------------- designs kept

/** Where designs are kept (the default is `state/designs.ts`). */
export interface DesignRepository {
  list(): Promise<{ id: string; design: Design }[]>;
  save(design: Design): Promise<void>;
}

// ---------------------------------------------------------------- share by link

/** Why a design cannot travel in a link. */
export type LinkRefusal = 'local-image' | 'too-large';

export type ShareResult =
  | { ok: true; url: string; chars: number }
  | { ok: false; reason: LinkRefusal; message: string };

// ---------------------------------------------------------------- files

export interface FileOut {
  filename: string;
  mediaType: string;
  text: string;
  /** Things the user should know about the file (for example an image that could not be included). */
  warnings: string[];
}

export interface ExportOptions {
  /** Put the images kept in this browser inside the file, so it is self-contained. */
  embedImages: boolean;
}

export interface RejectedItem {
  key: string;
  reason: string;
}

export type DesignFile = { kind: 'design'; design: Design; images: Record<string, EmbeddedImage> };
export type CollectionFile = { kind: 'collection'; items: Record<string, Design>; images: Record<string, EmbeddedImage>; rejected: RejectedItem[] };

/** What a file turned out to be, validated but not yet applied. */
export type ParsedFile = DesignFile | CollectionFile;

// ---------------------------------------------------------------- import

/** What to do with an incoming item whose key exists here with a different value. */
export type Resolution = 'rename' | 'replace' | 'skip';

export interface Conflict {
  key: string;
  existing: Design;
  incoming: Design;
}

export interface ImportPlan {
  /** Items whose key is new here. */
  added: Record<string, Design>;
  /** Items already here with an equal value: nothing to do. */
  identical: string[];
  /** Items whose key exists here with a different value: the user decides. */
  conflicts: Conflict[];
  /** Items in the file that were not valid designs. */
  rejected: RejectedItem[];
  /** Images carried by the file. */
  images: Record<string, EmbeddedImage>;
  /** The keys that exist here now (needed to make renamed keys unique). */
  existing: Record<string, Design>;
}

export interface ImportDecision {
  /** The resolution per conflicting key; a key not listed uses `fallback`. */
  perKey: Record<string, Resolution>;
  fallback: Resolution;
  /** Prepended to the key of a renamed item. */
  prefix: string;
}

export interface ImportSummary {
  added: string[];
  replaced: string[];
  renamed: { from: string; to: string }[];
  skipped: string[];
  identical: string[];
  rejected: RejectedItem[];
  /** Referenced images that are neither in the file nor in this browser. */
  missingImages: string[];
}

/** Keeping, sharing and restoring work. */
export interface Persistence {
  /** A link to `design` when it is small enough; otherwise a reason and a message for the user. */
  shareLink(design: Design, base?: string): ShareResult;
  /** The design in a `?s=` value, as a copy under a new id. Throws `PersistError`. */
  designFromLink(param: string): Design;
  /** The design as a file; with `embedImages`, the file carries its images. */
  exportDesign(design: Design, options: ExportOptions): Promise<FileOut>;
  /** Every saved design as one file. */
  exportCollection(options: ExportOptions): Promise<FileOut>;
  /** Read and validate a file's text (a design or a collection, told apart by content). Throws `PersistError`. */
  parseFile(text: string): ParsedFile;
  /** A design file as a copy under a new id, its images restored. */
  openDesignFile(file: DesignFile): Promise<Design>;
  /** Compare a file with what is kept, without changing anything. */
  planImport(file: ParsedFile): Promise<ImportPlan>;
  /** Apply a plan with the user's decisions. */
  applyImport(plan: ImportPlan, decision: ImportDecision): Promise<ImportSummary>;
}

// ---------------------------------------------------------------- install

/** What the page can offer about installing it as an app. */
export interface InstallState {
  /** Already running as an installed app. */
  installed: boolean;
  /** One-click install is available (the browser offered it). */
  canPrompt: boolean;
  /** Which instructions apply when there is no one-click install. */
  platform: 'ios' | 'android' | 'desktop';
  /** Storage is protected from eviction (`navigator.storage.persist()` was granted); null until asked. */
  persisted: boolean | null;
}

export interface Installer {
  getState(): InstallState;
  subscribe(listener: () => void): () => void;
  /** Show the browser's install dialog; resolves to whether the user accepted. */
  prompt(): Promise<boolean>;
  /** Ask the browser not to evict this site's storage; resolves to whether it agreed. */
  protectStorage(): Promise<boolean>;
}
