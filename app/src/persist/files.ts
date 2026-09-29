/**
 * Files: one design as `<title>.shaping.json`, or every saved design as one collection file.
 *
 * ```
 * { "format": "shaping.design",     "formatVersion": 1, "design": {...}, "images": {...}? }
 * { "format": "shaping.collection", "formatVersion": 1, "items": { "<id>": {...}, ... }, "images": {...}? }
 * ```
 *
 * `images` maps an `idb:` reference to a data URL, so a file made with "include images" is
 * self-contained; on the way in each image is stored again and the references stay valid (they are
 * content hashes). A bare design JSON (like the files in `examples/`) is also accepted. Every
 * design read is validated with `DesignSchema`; in a collection an invalid item is reported and
 * the others still import. Files are told apart by their content, never by their name.
 */
import { DesignSchema, formatIssues, type Design } from 'shaping';
import { holdRemoteImages } from './incoming';
import { z } from 'zod';
import { bytesToDataUrl, dataUrlToBytes } from './dataurl';
import { PersistError, type BlobStore, type CollectionFile, type DesignFile, type EmbeddedImage, type ExportOptions, type FileOut, type ParsedFile, type RejectedItem } from './types';

export const FILE_FORMAT_VERSION = 1;
export const DESIGN_FORMAT = 'shaping.design';
export const COLLECTION_FORMAT = 'shaping.collection';
export const FILE_SUFFIX = '.shaping.json';
export const FILE_MEDIA_TYPE = 'application/json';

/** Indentation of the JSON written to files, so they can be read and diffed by people. */
const JSON_INDENT = 2;
/** Longest stem of a design file name. */
const MAX_STEM_CHARS = 60;
const FALLBACK_STEM = 'design';

const ImagesSchema = z.record(z.string(), z.object({ dataUrl: z.string(), name: z.string().default('image') }));

// ---------------------------------------------------------------- what a design references

/** The image references of a design that live in the blob store. */
export function blobRefs(design: Design, blobs: BlobStore): string[] {
  return Object.values(design.sources).flatMap((s) => (s.kind === 'image' && blobs.isRef(s.src) ? [s.src] : []));
}

/** Rewrite image references (after they were stored again under other keys). */
export function remapImages(design: Design, map: ReadonlyMap<string, string>): Design {
  const sources = Object.fromEntries(
    Object.entries(design.sources).map(([slot, s]) => [slot, s.kind === 'image' && map.has(s.src) ? { ...s, src: map.get(s.src)! } : s]),
  );
  return { ...design, sources };
}

// ---------------------------------------------------------------- writing

export function slug(title: string): string {
  const s = title.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, MAX_STEM_CHARS);
  return s || FALLBACK_STEM;
}

const localDay = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n, i) => String(n).padStart(i ? 2 : 4, '0')).join('-');

/** Images of the given designs as data URLs; an image missing from the store is reported, not skipped silently. */
export async function embedImages(designs: Design[], blobs: BlobStore): Promise<{ images: Record<string, EmbeddedImage>; warnings: string[] }> {
  const images: Record<string, EmbeddedImage> = {};
  const warnings: string[] = [];
  for (const ref of new Set(designs.flatMap((d) => blobRefs(d, blobs)))) {
    try {
      const b = await blobs.get(ref);
      images[ref] = { dataUrl: bytesToDataUrl(b.bytes, b.mediaType), name: b.name };
    } catch {
      warnings.push(`An image is no longer in this browser's storage, so the file cannot include it (${ref}).`);
    }
  }
  return { images, warnings };
}

const withImages = <T extends object>(body: T, images: Record<string, EmbeddedImage>) => (Object.keys(images).length ? { ...body, images } : body);

export async function exportDesign(design: Design, { embedImages: embed }: ExportOptions, blobs: BlobStore): Promise<FileOut> {
  const { images, warnings } = embed ? await embedImages([design], blobs) : { images: {}, warnings: [] };
  const body = withImages({ format: DESIGN_FORMAT, formatVersion: FILE_FORMAT_VERSION, design }, images);
  return { filename: slug(design.title) + FILE_SUFFIX, mediaType: FILE_MEDIA_TYPE, text: JSON.stringify(body, null, JSON_INDENT), warnings };
}

export async function exportCollection(items: Design[], { embedImages: embed }: ExportOptions, blobs: BlobStore, now: Date = new Date()): Promise<FileOut> {
  const { images, warnings } = embed ? await embedImages(items, blobs) : { images: {}, warnings: [] };
  const body = withImages({ format: COLLECTION_FORMAT, formatVersion: FILE_FORMAT_VERSION, items: Object.fromEntries(items.map((d) => [d.id, d])) }, images);
  return { filename: `shaping-designs-${localDay(now)}${FILE_SUFFIX}`, mediaType: FILE_MEDIA_TYPE, text: JSON.stringify(body, null, JSON_INDENT), warnings };
}

// ---------------------------------------------------------------- reading

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseJson(text: string): Record<string, unknown> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new PersistError('This is not a shaping file: it is not JSON.');
  }
  if (!isObject(json)) throw new PersistError('This is not a shaping file: it holds no design.');
  return json;
}

function readImages(json: Record<string, unknown>): Record<string, EmbeddedImage> {
  if (json.images === undefined) return {};
  const r = ImagesSchema.safeParse(json.images);
  if (!r.success) throw new PersistError(`The images in this file are not valid.\n${formatIssues(r.error)}`);
  return r.data;
}

function checkVersion(json: Record<string, unknown>) {
  const v = json.formatVersion;
  if (typeof v === 'number' && v > FILE_FORMAT_VERSION) throw new PersistError('This file was made by a newer version of shaping. Reload the page to get the latest version, then open it again.');
}

function readDesign(value: unknown): Design {
  const r = DesignSchema.safeParse(value);
  if (!r.success) throw new PersistError(`This file does not hold a valid design.\n${formatIssues(r.error)}`);
  return holdRemoteImages(r.data);
}

function readCollection(json: Record<string, unknown>): CollectionFile {
  if (!isObject(json.items)) throw new PersistError('This collection file has no "items".');
  const items: Record<string, Design> = {};
  const rejected: RejectedItem[] = [];
  for (const [key, value] of Object.entries(json.items)) {
    const r = DesignSchema.safeParse(value);
    if (r.success) items[key] = holdRemoteImages({ ...r.data, id: key });
    else rejected.push({ key, reason: formatIssues(r.error) });
  }
  return { kind: 'collection', items, rejected, images: readImages(json) };
}

/** Read a file's text: a design file, a collection file or a bare design. Throws `PersistError`. */
export function parseFile(text: string): ParsedFile {
  const json = parseJson(text);
  checkVersion(json);
  if (json.format === COLLECTION_FORMAT) return readCollection(json);
  if (json.format === DESIGN_FORMAT) return { kind: 'design', design: readDesign(json.design), images: readImages(json) } satisfies DesignFile;
  if ('genre' in json && 'sources' in json) return { kind: 'design', design: readDesign(json), images: {} };
  throw new PersistError('This is not a shaping file (it is neither a design nor a collection).');
}

// ---------------------------------------------------------------- restoring images

/**
 * Make the images the given designs reference available: store the ones the file carries; the
 * others must already be in this browser. Returns how references changed and which are missing.
 */
export async function restoreImages(designs: Design[], images: Record<string, EmbeddedImage>, blobs: BlobStore): Promise<{ map: Map<string, string>; missing: string[] }> {
  const map = new Map<string, string>();
  const missing: string[] = [];
  for (const ref of new Set(designs.flatMap((d) => blobRefs(d, blobs)))) {
    const carried = images[ref] && dataUrlToBytes(images[ref].dataUrl);
    if (carried) map.set(ref, await blobs.put(carried.bytes, carried.mediaType, images[ref].name));
    else if (!(await blobs.has(ref))) missing.push(ref);
  }
  return { map, missing };
}
