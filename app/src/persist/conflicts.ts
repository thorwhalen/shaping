/**
 * Merging an incoming collection into the designs kept here. Pure: no storage, no interface.
 *
 * Items are matched by key (the design id). For each incoming item:
 *
 * - key not present here: it is added;
 * - key present with an equal value: nothing to do (`identical`);
 * - key present with a different value: a conflict, and the user decides, per item or for all:
 *   `rename` (the default: keep both, the incoming one under a prefixed key), `replace` (the
 *   incoming value wins) or `skip` (the existing one stays).
 *
 * A renamed key never collides with anything: it must be free among the existing keys, the other
 * incoming keys and the keys already given out. If the renamed key is already here with exactly
 * the renamed value (the same file imported twice), the item counts as identical, so importing a
 * file again changes nothing.
 */
import type { Design } from 'shaping';
import type { Conflict, ImportDecision, ImportPlan, ImportSummary, RejectedItem, Resolution } from './types';

/** The default prefix for a renamed key. */
export const DEFAULT_RENAME_PREFIX = 'imported-';

/** The default choice for a conflict: keep both. */
export const DEFAULT_RESOLUTION: Resolution = 'rename';

/** Added to the title of a renamed design, so the two are told apart in the gallery. */
export const RENAMED_TITLE_SUFFIX = ' (imported)';

/** Stable JSON: object keys sorted, so two equal values compare equal whatever their key order. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );
}

export const sameValue = (a: Design, b: Design) => canonical(a) === canonical(b);

/** Sort every incoming item into added, identical or conflicting. */
export function planMerge(
  existing: Record<string, Design>,
  incoming: Record<string, Design>,
  { rejected = [], images = {} }: { rejected?: RejectedItem[]; images?: ImportPlan['images'] } = {},
): ImportPlan {
  const plan: ImportPlan = { added: {}, identical: [], conflicts: [], rejected, images, existing };
  for (const [key, value] of Object.entries(incoming)) {
    const have = existing[key];
    if (!have) plan.added[key] = value;
    else if (sameValue(have, value)) plan.identical.push(key);
    else plan.conflicts.push({ key, existing: have, incoming: value });
  }
  return plan;
}

/** The item as it is kept under `key`: its id follows the key. */
const asKey = (design: Design, key: string, title = design.title): Design => ({ ...design, id: key, title });

/**
 * A free key for a renamed item: `prefix + key`, then `prefix + 2 + '-' + key`, and so on, until
 * it is unused. Returns null when the key is already here holding exactly this renamed item.
 */
export function renamedKey(
  key: string,
  incoming: Design,
  { prefix, taken, existing }: { prefix: string; taken: ReadonlySet<string>; existing: Record<string, Design> },
): string | null {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? prefix + key : `${prefix}${n}-${key}`;
    if (!taken.has(candidate)) return candidate;
    const have = existing[candidate];
    if (have && sameValue(have, renamedItem(incoming, candidate))) return null;
  }
}

const renamedItem = (incoming: Design, key: string): Design => asKey(incoming, key, incoming.title + RENAMED_TITLE_SUFFIX);

export interface MergeResult {
  /** What to write, by key. */
  writes: Record<string, Design>;
  summary: Omit<ImportSummary, 'rejected' | 'missingImages'>;
}

/** Turn a plan and the user's decisions into the writes to make. */
export function resolveMerge(plan: ImportPlan, decision: ImportDecision): MergeResult {
  const writes: Record<string, Design> = { ...plan.added };
  const summary: MergeResult['summary'] = { added: Object.keys(plan.added), replaced: [], renamed: [], skipped: [], identical: [...plan.identical] };
  // Every key the renamed items must avoid: what is here, what arrives, what is already given out.
  const taken = new Set<string>([...Object.keys(plan.existing), ...Object.keys(plan.added), ...plan.conflicts.map((c) => c.key)]);
  for (const conflict of plan.conflicts) {
    const choice = decision.perKey[conflict.key] ?? decision.fallback;
    applyChoice(choice, conflict, { writes, summary, taken, plan, prefix: decision.prefix });
  }
  return { writes, summary };
}

function applyChoice(
  choice: Resolution,
  { key, incoming }: Conflict,
  ctx: { writes: Record<string, Design>; summary: MergeResult['summary']; taken: Set<string>; plan: ImportPlan; prefix: string },
) {
  if (choice === 'skip') return void ctx.summary.skipped.push(key);
  if (choice === 'replace') {
    ctx.writes[key] = asKey(incoming, key);
    return void ctx.summary.replaced.push(key);
  }
  const to = renamedKey(key, incoming, { prefix: ctx.prefix, taken: ctx.taken, existing: ctx.plan.existing });
  if (to === null) return void ctx.summary.identical.push(key);
  ctx.taken.add(to);
  ctx.writes[to] = renamedItem(incoming, to);
  ctx.summary.renamed.push({ from: key, to });
}
