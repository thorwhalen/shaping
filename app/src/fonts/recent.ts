/**
 * The families the user used lately, most recent first, kept in localStorage (page only).
 * The list logic is pure (`pushRecent`); reading and writing is wrapped in try/catch because
 * storage can be blocked or full.
 */
const KEY = 'shaping.fonts.recent';
export const MAX_RECENT = 12;

/** Put `id` first, drop repeats, keep at most `max`. */
export function pushRecent(list: readonly string[], id: string, max = MAX_RECENT): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}

export function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

/** Remember that `id` was used; returns the new list. */
export function rememberFont(id: string): string[] {
  const next = pushRecent(loadRecent(), id);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked or full: the list simply lives for this call.
  }
  return next;
}
