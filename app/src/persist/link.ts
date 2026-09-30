/**
 * Share by link: a design in one query parameter, `?s=<version>.<base64url(deflate(json))>`.
 *
 * Nothing is stored anywhere: the link IS the design. The design's id is left out (opening a link
 * makes a copy under a new id) and its JSON is deflated and written in URL-safe base64. Text
 * sources (letters, font ids, axes), shapes, parameters, colours and small drawings fit easily.
 * What cannot travel makes the share refuse, with a plain message, instead of producing a link
 * that does not work:
 *
 * - an image kept in this browser (`idb:` reference): its bytes exist only here;
 * - anything whose encoded size passes `MAX_SHARE_PARAM_CHARS` (large drawings, large SVGs).
 *
 * Image sources that are `http(s)` URLs travel as they are, so an image from the web is shared by
 * its address.
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { allSources, copyDesign, DesignSchema, formatIssues, type Design } from 'shaping';
import { holdRemoteImages, refuseBrowserImages } from './incoming';
import { fromBase64Url, toBase64Url } from './dataurl';
import { PersistError, type BlobStore, type ShareResult } from './types';

/** The query parameter that carries a shared design. */
export const SHARE_PARAM = 's';

/** Version tag written before the payload, so the encoding can change without breaking old links. */
export const SHARE_TAG = '1.';

/**
 * The most characters the `?s=` value may have. Whole links stay under about 4,100 characters:
 * well below the 8 KB request-line limit common web servers apply, and short enough that chat
 * apps, mail clients and social feeds keep a link in one piece instead of cutting it. (Browsers
 * would accept far more; the limit protects the link's journey, not the browser.)
 */
export const MAX_SHARE_PARAM_CHARS = 4000;

/**
 * The most characters an incoming value may have before it is even decoded. Deflate expands at
 * most about 1000 times, so this bounds the memory a hostile link can ask for (about 16 MB).
 */
export const MAX_INCOMING_PARAM_CHARS = 16000;

/** Deflate level: the smallest output, since links are encoded once and read once. */
const DEFLATE_LEVEL = 9;

/** Compression and base64 of a design, without its id. */
export function encodeDesign(design: Design): string {
  const { id: _id, ...rest } = design;
  return SHARE_TAG + toBase64Url(deflateSync(strToU8(JSON.stringify(rest)), { level: DEFLATE_LEVEL }));
}

const isHttp = (src: string) => /^https?:\/\//i.test(src);

/** The slot and kind of the part that makes a design biggest, for the message. */
function largestSource(design: Design): string {
  const parts = [
    ...allSources(design).map(([slot, s]) => ({ what: `the ${s.kind} source of "${slot}"`, size: JSON.stringify(s).length })),
    ...(design.sequence ? [{ what: 'its animation sequence', size: JSON.stringify(design.sequence).length }] : []),
  ];
  parts.sort((a, b) => b.size - a.size);
  return parts[0] ? ` Its largest part is ${parts[0].what}.` : '';
}

/** The first source that only exists in this browser, if any. */
function localImage(design: Design, blobs: BlobStore) {
  return allSources(design).find(([, s]) => s.kind === 'image' && !isHttp(s.src) && blobs.isRef(s.src));
}

/** A link to the design, or the reason there cannot be one. */
export function shareLink(design: Design, base: string, blobs: BlobStore): ShareResult {
  const local = localImage(design, blobs);
  if (local) {
    return {
      ok: false,
      reason: 'local-image',
      message: 'This design uses an image kept in this browser, and a link cannot carry it. Save it as a file instead (include the image in the file), or use an image from a web address.',
    };
  }
  const param = encodeDesign(design);
  if (param.length > MAX_SHARE_PARAM_CHARS) {
    return {
      ok: false,
      reason: 'too-large',
      message: `This design is too big for a link (${param.length} characters; the most a link can carry is ${MAX_SHARE_PARAM_CHARS}).${largestSource(design)} Save it as a file instead.`,
    };
  }
  const url = `${base}?${SHARE_PARAM}=${param}`;
  return { ok: true, url, chars: url.length };
}

/** Decode and validate a `?s=` value; the design comes back under a new id. */
export function designFromLink(param: string): Design {
  if (param.length > MAX_INCOMING_PARAM_CHARS) throw new PersistError('This link is too long to be a shared design.');
  if (!param.startsWith(SHARE_TAG)) throw new PersistError('This link was made by a different version of shaping and cannot be opened here.');
  let json: unknown;
  try {
    json = JSON.parse(strFromU8(inflateSync(fromBase64Url(param.slice(SHARE_TAG.length)))));
  } catch {
    throw new PersistError('This link is damaged (it may have been cut short when it was copied or sent).');
  }
  const r = DesignSchema.safeParse({ ...(json as object), id: 'shared' });
  if (!r.success) throw new PersistError(`This link does not hold a valid design.\n${formatIssues(r.error)}`);
  return holdRemoteImages(refuseBrowserImages(copyDesign(r.data)));
}

/** The `?s=` value of the page's address, or null. */
export const sharedParam = (search: string = location.search) => new URLSearchParams(search).get(SHARE_PARAM);
