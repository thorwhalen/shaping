/** Plain-language account of what an import did, so the user is told the outcome of every import. */
import type { ImportSummary } from './types';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function describeSummary(s: ImportSummary): string {
  const parts = [
    s.added.length && `${plural(s.added.length, 'design')} added`,
    s.renamed.length && `${plural(s.renamed.length, 'design')} kept alongside yours under a new name`,
    s.replaced.length && `${plural(s.replaced.length, 'design')} replaced`,
    s.skipped.length && `${plural(s.skipped.length, 'design')} skipped`,
    s.identical.length && `${plural(s.identical.length, 'design')} already here, unchanged`,
  ].filter(Boolean);
  const lines = [parts.length ? `Import done: ${parts.join('; ')}.` : 'Nothing to import: the file holds no designs.'];
  if (s.rejected.length) lines.push(`${plural(s.rejected.length, 'design')} in the file could not be read and ${s.rejected.length === 1 ? 'was' : 'were'} left out: ${s.rejected.map((r) => r.key).join(', ')}.`);
  if (s.missingImages.length) lines.push(`${plural(s.missingImages.length, 'image')} used by these designs ${s.missingImages.length === 1 ? 'is' : 'are'} not in this browser and not in the file; upload again where needed.`);
  return lines.join('\n');
}
