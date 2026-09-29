/**
 * The gallery's "Export collection" and "Import…" buttons. Import accepts a design file or a
 * collection file (told apart by content). Without conflicts it is applied at once; with
 * conflicts, `ConflictDialog` asks first. Either way the outcome is reported.
 */
import { useRef, useState } from 'react';
import { ConflictDialog } from './ConflictDialog';
import { DEFAULT_RENAME_PREFIX, DEFAULT_RESOLUTION } from './conflicts';
import { downloadFile, formatBytes, readFileText } from './download';
import { persistence, type ImportDecision, type ImportPlan } from './index';
import { notify } from './notify';
import { describeSummary } from './summary';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** With no conflict to ask about, this is the decision used. */
const NO_QUESTION: ImportDecision = { perKey: {}, fallback: DEFAULT_RESOLUTION, prefix: DEFAULT_RENAME_PREFIX };

export function CollectionTools({ count, onChanged }: { count: number; onChanged: () => void }) {
  const [embed, setEmbed] = useState(true);
  const [pending, setPending] = useState<ImportPlan | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  async function exportAll() {
    try {
      const file = await persistence.exportCollection({ embedImages: embed });
      downloadFile(file);
      notify('success', `Saved ${file.filename} with ${count} design${count === 1 ? '' : 's'} (${formatBytes(file.text.length)}).`);
      file.warnings.forEach((w) => notify('error', w));
    } catch (e) {
      notify('error', `Could not export the collection: ${message(e)}`);
    }
  }

  async function apply(plan: ImportPlan, decision: ImportDecision) {
    try {
      notify('success', describeSummary(await persistence.applyImport(plan, decision)));
    } catch (e) {
      notify('error', `The import failed part-way: ${message(e)}`);
    }
    onChanged();
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    try {
      const plan = await persistence.planImport(persistence.parseFile(await readFileText(file)));
      if (plan.conflicts.length) setPending(plan);
      else await apply(plan, NO_QUESTION);
    } catch (e) {
      notify('error', `Could not import ${file.name}: ${message(e)}`);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button className="rounded border border-line bg-white px-2 py-1 hover:border-accent disabled:opacity-50" disabled={count === 0} onClick={() => void exportAll()}>
        Export collection
      </button>
      <label className="flex items-center gap-1 text-xs text-muted">
        <input type="checkbox" checked={embed} onChange={(e) => setEmbed(e.target.checked)} /> with images
      </label>
      <button className="rounded border border-line bg-white px-2 py-1 hover:border-accent" onClick={() => picker.current?.click()}>
        Import…
      </button>
      <input ref={picker} type="file" accept=".json,application/json" hidden onChange={(e) => { void chooseFile(e.target.files?.[0]); e.target.value = ''; }} />
      {pending && (
        <ConflictDialog
          plan={pending}
          onCancel={() => { setPending(null); notify('info', 'Import cancelled. Nothing was changed.'); }}
          onDecide={(d) => { const plan = pending; setPending(null); void apply(plan, d); }}
        />
      )}
    </div>
  );
}
