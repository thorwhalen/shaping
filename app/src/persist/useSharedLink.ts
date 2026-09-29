/**
 * Opening a shared link: when the page is loaded with `?s=<design>`, decode it and hand the
 * design (a copy under a new id) to the app once. The link's address is a landing, not a place in
 * the app: the caller replaces it with the design's own address (`?d=<id>`), like any redirect,
 * so Back does not return to a link that would make a second copy, and a reload opens the copy.
 * A link that cannot be opened is reported and its address cleared.
 */
import { useEffect } from 'react';
import type { Design } from 'shaping';
import { persistence, sharedParam } from './index';
import { notify } from './notify';

/** The value already handled, so React's double effects in development do not make two copies. */
let handled: string | null = null;

export function useSharedLink(onOpen: (design: Design) => void) {
  useEffect(() => {
    const param = sharedParam();
    if (param === null || param === handled) return;
    handled = param;
    try {
      const design = persistence.designFromLink(param);
      notify('info', `Opened a shared design, “${design.title}”, as your own copy.`);
      onOpen(design);
    } catch (e) {
      notify('error', e instanceof Error ? e.message : String(e));
      history.replaceState(history.state, '', location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
