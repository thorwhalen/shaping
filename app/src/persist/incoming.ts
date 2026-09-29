/**
 * The rule for designs that arrive from outside (a shared link, a design file, a collection file):
 * opening one must not make this browser contact a web address the user has not approved. So a
 * remote image source is held as `ask:<url>`; the geometry worker refuses to fetch it, and the
 * Source panel offers "Load image from <host>". A link cannot carry an image kept in another
 * browser (`idb:`), so such a link is refused with a clear message.
 */
import type { Design, Source } from 'shaping';
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

function mapImages(design: Design, fn: (src: string) => string): Design {
  const sources = Object.fromEntries(
    Object.entries(design.sources).map(([slot, s]): [string, Source] => [slot, s.kind === 'image' ? { ...s, src: fn(s.src) } : s]),
  );
  return { ...design, sources };
}

/** Hold every remote image source of an incoming design until the user allows it. */
export function holdRemoteImages(design: Design): Design {
  return mapImages(design, (src) => (REMOTE.test(src) ? ASK_PREFIX + src : src));
}

/** Refuse a link-borne design that points at images kept in some other browser. */
export function refuseBrowserImages(design: Design): Design {
  const local = Object.values(design.sources).some((s) => s.kind === 'image' && s.src.startsWith('idb:'));
  if (local) throw new PersistError('This link refers to an image kept in the sender\'s browser, which links cannot carry. Ask for the design file instead.');
  return design;
}
