/**
 * The rule for designs that arrive from outside (a shared link, a design file, a collection file):
 * opening one must not make this browser contact a web address the user has not approved. So a
 * remote image source is held as `ask:<url>`; the geometry worker refuses to fetch it, and the
 * Source panel offers "Load image from <host>". A link cannot carry an image kept in another
 * browser (`idb:`), so such a link is refused with a clear message.
 */
import { allSources, mapSources, type Design, type Source } from 'shaping';
import { PersistError } from './types';

export const ASK_PREFIX = 'ask:';
const REMOTE = /^https?:\/\//i;

export const isHeldRemote = (src: string) => src.startsWith(ASK_PREFIX);
export const heldUrl = (src: string) => src.slice(ASK_PREFIX.length);
export const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Every image source, including those kept for other genres. */
function mapImages(design: Design, fn: (src: string) => string): Design {
  return mapSources(design, (s): Source => (s.kind === 'image' ? { ...s, src: fn(s.src) } : s));
}

/** Hold every remote image source of an incoming design until the user allows it. */
export function holdRemoteImages(design: Design): Design {
  return mapImages(design, (src) => (REMOTE.test(src) ? ASK_PREFIX + src : src));
}

/** Refuse a link-borne design that points at images kept in some other browser. */
export function refuseBrowserImages(design: Design): Design {
  const local = allSources(design).some(([, s]) => s.kind === 'image' && s.src.startsWith('idb:'));
  if (local) throw new PersistError('This link refers to an image kept in the sender\'s browser, which links cannot carry. Ask for the design file instead.');
  return design;
}
