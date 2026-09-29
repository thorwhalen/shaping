/**
 * Asks what to do with imported designs whose key exists here with a different value: one choice
 * per design or one for all. The default is to keep both, the incoming one under a prefixed key.
 */
import { useEffect, useState } from 'react';
import { DEFAULT_RENAME_PREFIX, DEFAULT_RESOLUTION } from './conflicts';
import type { ImportDecision, ImportPlan, Resolution } from './types';

const CHOICES: { value: Resolution; label: string }[] = [
  { value: 'rename', label: 'Keep both (rename the incoming one)' },
  { value: 'replace', label: 'Replace mine with the incoming one' },
  { value: 'skip', label: 'Skip the incoming one' },
];

interface Props {
  plan: ImportPlan;
  onDecide: (decision: ImportDecision) => void;
  onCancel: () => void;
}

export function ConflictDialog({ plan, onDecide, onCancel }: Props) {
  const [fallback, setFallback] = useState<Resolution>(DEFAULT_RESOLUTION);
  const [perKey, setPerKey] = useState<Record<string, Resolution>>({});
  const [prefix, setPrefix] = useState(DEFAULT_RENAME_PREFIX);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onCancel]);

  const choiceOf = (key: string) => perKey[key] ?? fallback;
  const renaming = plan.conflicts.some((c) => choiceOf(c.key) === 'rename');
  const setAll = (r: Resolution) => {
    setFallback(r);
    setPerKey({});
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-3" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div role="dialog" aria-modal="true" aria-labelledby="conflict-title" className="flex max-h-[85vh] w-full max-w-xl flex-col gap-3 overflow-y-auto rounded-lg border border-line bg-white p-4 text-sm shadow-lg">
        <h2 id="conflict-title" className="text-base font-semibold">
          {plan.conflicts.length === 1 ? '1 design has the same name as one you already have' : `${plan.conflicts.length} designs have the same name as ones you already have`}
        </h2>
        <p className="text-muted">
          They differ from yours, so nothing has been changed yet. Choose what to do with each; by default both are kept.
          {plan.identical.length > 0 && ` ${plan.identical.length} identical design(s) will be left as they are.`}
        </p>
        <label className="flex items-center gap-2">
          <span className="font-medium">For all:</span>
          <select className="rounded border border-line px-2 py-1" value={fallback} onChange={(e) => setAll(e.target.value as Resolution)}>
            {CHOICES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
        <ul className="flex flex-col gap-2">
          {plan.conflicts.map((c) => (
            <li key={c.key} className="flex flex-col gap-1 rounded border border-line px-2 py-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0">
                <span className="block truncate font-medium">{c.incoming.title}</span>
                <span className="block truncate text-xs text-muted">yours: “{c.existing.title}” · key {c.key}</span>
              </span>
              <select aria-label={`What to do with ${c.incoming.title}`} className="rounded border border-line px-2 py-1" value={choiceOf(c.key)} onChange={(e) => setPerKey({ ...perKey, [c.key]: e.target.value as Resolution })}>
                {CHOICES.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </li>
          ))}
        </ul>
        {renaming && (
          <label className="flex items-center gap-2">
            <span>Prefix for renamed designs:</span>
            <input className="w-40 rounded border border-line px-2 py-1" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button className="rounded border border-line px-3 py-1.5 hover:border-accent" onClick={onCancel}>
            Cancel
          </button>
          <button className="rounded bg-accent px-3 py-1.5 text-white disabled:opacity-50" disabled={renaming && !prefix.trim()} onClick={() => onDecide({ perKey, fallback, prefix: prefix.trim() })}>
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
