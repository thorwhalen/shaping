/**
 * `FontPicker`: choose a font from the whole open-font catalogue.
 *
 * The list is windowed (only the rows in view exist), and each row loads its family's name in its
 * own face when it scrolls into view, so opening the picker costs a few kilobytes, not a font per
 * family. Recently used families come first, then the common ones, then the rest; typing ranks by
 * how well the name matches. The block font (built in, nothing to load) is always the first row.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BLOCK_FONT } from 'shaping';
import type { FontEntry } from 'shaping/fonts';
import { COMMON_FONT_IDS } from './common';
import { useCatalog } from './hooks';
import { ensurePreview, previewFontFamily } from './previews';
import { loadRecent, rememberFont } from './recent';
import { categoriesOf, searchFonts, type SearchHit } from './search';

const ROW_HEIGHT = 36;
const LIST_HEIGHT = 288;
const OVERSCAN_ROWS = 4;
const BLOCK_LABEL = 'Block letters (built in)';

type Row = { kind: 'header'; label: string } | { kind: 'block' } | { kind: 'font'; hit: SearchHit };

const GROUP_LABEL = { recent: 'Recently used', common: 'Common', all: 'All fonts' } as const;

/** The rows of the list: the block font, then section headers (no query) or just matches (query). */
function buildRows(hits: SearchHit[], query: string, showBlock: boolean): Row[] {
  const rows: Row[] = showBlock ? [{ kind: 'block' }] : [];
  if (query.trim()) return [...rows, { kind: 'header', label: `${hits.length} match${hits.length === 1 ? '' : 'es'}` }, ...hits.map((hit): Row => ({ kind: 'font', hit }))];
  let group: SearchHit['group'] | null = null;
  for (const hit of hits) {
    if (hit.group !== group) rows.push({ kind: 'header', label: GROUP_LABEL[hit.group] });
    group = hit.group;
    rows.push({ kind: 'font', hit });
  }
  return rows;
}

export interface FontPickerProps {
  /** `'block'` or a catalogue font id. */
  value: string;
  onChange: (fontId: string) => void;
  /** Offer the built-in block font (default true). */
  allowBlock?: boolean;
  label?: string;
}

export function FontPicker({ value, onChange, allowBlock = true, label = 'Font' }: FontPickerProps) {
  const catalog = useCatalog();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = catalog.entries.find((e) => e.id === value);

  useEffect(() => {
    if (!open) return;
    const away = (ev: MouseEvent) => !root.current?.contains(ev.target as Node) && setOpen(false);
    const esc = (ev: KeyboardEvent) => ev.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div ref={root} className="relative flex flex-col gap-1 text-sm">
      <span>{label}</span>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex items-center justify-between gap-2 rounded border border-line bg-white px-2 py-1 text-left hover:border-muted">
        {value === BLOCK_FONT ? <span>{BLOCK_LABEL}</span> : <FamilyName entry={current} fallback={value} />}
        <span aria-hidden className="text-xs text-muted">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <Panel
          catalog={catalog}
          showBlock={allowBlock}
          value={value}
          onPick={(id) => {
            if (id !== BLOCK_FONT) rememberFont(id);
            onChange(id);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function Panel({ catalog, showBlock, value, onPick }: { catalog: ReturnType<typeof useCatalog>; showBlock: boolean; value: string; onPick: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [variableOnly, setVariableOnly] = useState(false);
  const [recent] = useState(loadRecent);
  const [scrollTop, setScrollTop] = useState(0);
  const categories = useMemo(() => categoriesOf(catalog.entries), [catalog.entries]);
  const hits = useMemo(() => searchFonts(catalog.entries, query, { recent, common: COMMON_FONT_IDS, category: category || undefined, variableOnly }), [catalog.entries, query, recent, category, variableOnly]);
  const rows = useMemo(() => buildRows(hits, query, showBlock && (!query.trim() || /block|built/i.test(query))), [hits, query, showBlock]);
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  const last = Math.min(rows.length, Math.ceil((scrollTop + LIST_HEIGHT) / ROW_HEIGHT) + OVERSCAN_ROWS);

  return (
    <div className="absolute left-0 right-0 top-full z-20 mt-1 flex flex-col gap-2 rounded-md border border-line bg-white p-2 shadow-lg">
      <input autoFocus type="search" placeholder="Search fonts…" aria-label="Search fonts" value={query} onChange={(e) => (setQuery(e.target.value), setScrollTop(0))} className="rounded border border-line px-2 py-1" />
      <div className="flex items-center gap-2 text-xs">
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="rounded border border-line bg-white px-1 py-0.5">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={variableOnly} onChange={(e) => setVariableOnly(e.target.checked)} /> Variable only
        </label>
      </div>
      {catalog.status === 'loading' && <p className="px-1 py-6 text-center text-xs text-muted" aria-live="polite">Loading the font catalogue…</p>}
      {catalog.status === 'error' && (
        <p className="px-1 py-3 text-center text-xs text-red-700" role="alert">
          Could not load the catalogue: {catalog.error}{' '}
          <button className="underline" onClick={catalog.retry}>Retry</button>
        </p>
      )}
      {catalog.status === 'ready' && (
        <div role="listbox" aria-label="Fonts" style={{ height: LIST_HEIGHT }} className="overflow-y-auto" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
          <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
            {rows.slice(first, last).map((row, i) => (
              <div key={first + i} style={{ position: 'absolute', top: (first + i) * ROW_HEIGHT, height: ROW_HEIGHT, left: 0, right: 0 }}>
                {row.kind === 'header' && <div className="px-2 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted">{row.label}</div>}
                {row.kind === 'block' && <Option selected={value === BLOCK_FONT} onPick={() => onPick(BLOCK_FONT)}>{BLOCK_LABEL}</Option>}
                {row.kind === 'font' && (
                  <Option selected={value === row.hit.entry.id} onPick={() => onPick(row.hit.entry.id)}>
                    <FamilyName entry={row.hit.entry} />
                    <span className="ml-2 shrink-0 text-[11px] text-muted">{row.hit.entry.variable ? 'variable · ' : ''}{row.hit.entry.category}</span>
                  </Option>
                )}
              </div>
            ))}
          </div>
          {rows.length === 0 && <p className="p-3 text-center text-xs text-muted">No font matches.</p>}
        </div>
      )}
    </div>
  );
}

function Option({ selected, onPick, children }: { selected: boolean; onPick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="option" aria-selected={selected} onClick={onPick} className={`flex h-full w-full items-center justify-between rounded px-2 text-left ${selected ? 'bg-accent/10' : 'hover:bg-paper'}`}>
      {children}
    </button>
  );
}

/** A family's name drawn in its own face, loaded on first display; the plain face and "…" while it loads. */
function FamilyName({ entry, fallback }: { entry?: FontEntry; fallback?: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    if (!entry) return;
    let live = true;
    setState('loading');
    ensurePreview(entry).then(() => live && setState('ready'), () => live && setState('error'));
    return () => {
      live = false;
    };
  }, [entry]);
  if (!entry) return <span>{fallback}</span>;
  return (
    <span className="flex min-w-0 items-center gap-1 truncate text-base" style={state === 'ready' ? { fontFamily: previewFontFamily(entry) } : undefined} title={entry.family}>
      <span className={state === 'loading' ? 'text-muted' : undefined}>{entry.family}</span>
      {state === 'loading' && <span aria-label="loading" className="text-xs text-muted">…</span>}
    </span>
  );
}
