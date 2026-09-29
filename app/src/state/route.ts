/**
 * The URL is the state for where the user is: which design and which panel.
 * Opening a design is a new history entry (so Back returns to the gallery); switching panels
 * replaces the current entry.
 */
export interface Route {
  design: string | null;
  panel: string;
}

export const DEFAULT_PANEL = 'source';

export function readRoute(): Route {
  const q = new URLSearchParams(location.search);
  return { design: q.get('d'), panel: q.get('p') ?? DEFAULT_PANEL };
}

function href(r: Route): string {
  const q = new URLSearchParams();
  if (r.design) q.set('d', r.design);
  if (r.design && r.panel !== DEFAULT_PANEL) q.set('p', r.panel);
  const s = q.toString();
  return location.pathname + (s ? `?${s}` : '');
}

/** Entries the app pushed carry `pushed: true`, so the in-app Back never leaves the app. */
export const pushRoute = (r: Route) => history.pushState({ ...r, pushed: true }, '', href(r));
export const cameFromApp = () => Boolean((history.state as { pushed?: boolean } | null)?.pushed);
export const replaceRoute = (r: Route) => history.replaceState({ ...r, pushed: cameFromApp() }, '', href(r));
