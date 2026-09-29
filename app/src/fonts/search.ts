/**
 * Searching and ordering the font catalogue (pure, no DOM).
 *
 * With no query the list is the recently used families, then the common ones, then everything else
 * alphabetically. With a query, families are ranked by how well their name matches (exact, prefix,
 * word prefix, substring, then category), and ties go to recent, then common, then alphabetical.
 */
import type { FontEntry } from 'shaping/fonts';

/** Match quality, best first. Lower is better; `null` means no match. */
export const MATCH = { exact: 0, prefix: 1, wordPrefix: 2, substring: 3, category: 4 } as const;

/** Where a family is listed when there is no query. */
export type Group = 'recent' | 'common' | 'all';

export interface SearchOptions {
  /** Recently used ids, most recent first. */
  recent?: readonly string[];
  /** Common ids, in display order. */
  common?: readonly string[];
  /** Restrict to one category (e.g. `serif`). */
  category?: string;
  /** Restrict to families with variable axes. */
  variableOnly?: boolean;
}

export interface SearchHit {
  entry: FontEntry;
  group: Group;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** How well a family matches a (normalised) query: a `MATCH` value or null. */
export function matchRank(entry: FontEntry, query: string): number | null {
  const q = norm(query);
  if (!q) return 0;
  const name = norm(entry.family);
  if (name === q) return MATCH.exact;
  if (name.startsWith(q)) return MATCH.prefix;
  if (name.split(' ').some((w) => w.startsWith(q))) return MATCH.wordPrefix;
  if (name.includes(q) || entry.id.includes(q.replace(/ /g, '-'))) return MATCH.substring;
  if (norm(entry.category).includes(q)) return MATCH.category;
  return null;
}

/** Position in a list; an id that is not in it sorts after every id that is (finite, so differences stay numbers). */
const NOT_LISTED = Number.MAX_SAFE_INTEGER;
const indexIn = (list: readonly string[], id: string) => {
  const i = list.indexOf(id);
  return i < 0 ? NOT_LISTED : i;
};

/** Search and order the catalogue. */
export function searchFonts(entries: readonly FontEntry[], query: string, opts: SearchOptions = {}): SearchHit[] {
  const recent = opts.recent ?? [];
  const common = opts.common ?? [];
  const groupOf = (e: FontEntry): Group => (recent.includes(e.id) ? 'recent' : common.includes(e.id) ? 'common' : 'all');
  const pool = entries.filter((e) => (!opts.category || e.category === opts.category) && (!opts.variableOnly || e.variable));
  const ranked = pool
    .map((entry) => ({ entry, rank: matchRank(entry, query) }))
    .filter((r): r is { entry: FontEntry; rank: number } => r.rank !== null);
  const groupOrder: Record<Group, number> = { recent: 0, common: 1, all: 2 };
  ranked.sort(
    (a, b) =>
      a.rank - b.rank ||
      indexIn(recent, a.entry.id) - indexIn(recent, b.entry.id) ||
      indexIn(common, a.entry.id) - indexIn(common, b.entry.id) ||
      groupOrder[groupOf(a.entry)] - groupOrder[groupOf(b.entry)] ||
      a.entry.family.localeCompare(b.entry.family),
  );
  return ranked.map(({ entry }) => ({ entry, group: groupOf(entry) }));
}

/** The categories present in a catalogue, most populated first. */
export function categoriesOf(entries: readonly FontEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
}
