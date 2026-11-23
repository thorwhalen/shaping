/**
 * The gallery: the example designs (JSON files in the repository's examples/, each a `Design`,
 * none written as code), the user's saved designs, and a new design per genre.
 *
 * Your designs can be searched, narrowed to a genre and sorted; Select shows a checkbox on each
 * (Shift-click picks a range) and Move to Trash acts on the selection with one Undo. Delete means
 * Move to Trash: the Trash section restores or deletes for good (that one asks first).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { advise, offerUndo } from 'undo-toast';
import { copyDesign, DesignSchema, newDesign, type Design } from 'shaping';
import { genres } from './genres';
import { CollectionTools } from './persist/CollectionTools';
import { InstallNotice } from './persist/InstallNotice';
import { designs, type SavedDesign } from './state/designs';

const files = import.meta.glob('../../examples/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
export const EXAMPLES: Design[] = Object.values(files)
  .map((f) => DesignSchema.safeParse(f))
  .filter((r) => r.success)
  .map((r) => r.data!);

type SortKey = 'updated' | 'title' | 'genre';
const SORTS: Record<SortKey, { label: string; compare: (a: SavedDesign, b: SavedDesign) => number }> = {
  updated: { label: 'Last changed', compare: (a, b) => b.updated.localeCompare(a.updated) },
  title: { label: 'Title', compare: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) },
  genre: { label: 'Genre', compare: (a, b) => a.genre.localeCompare(b.genre) || b.updated.localeCompare(a.updated) },
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function Gallery({ onOpen }: { onOpen: (d: Design) => void }) {
  const [saved, setSaved] = useState<SavedDesign[]>([]);
  const [trash, setTrash] = useState<SavedDesign[]>([]);
  const refresh = () => {
    void designs.list().then(setSaved);
    void designs.listTrash().then(setTrash);
  };
  useEffect(refresh, []);

  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState<string>('');
  const [sort, setSort] = useState<SortKey>('updated');
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [showTrash, setShowTrash] = useState(false);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return saved.filter((d) => (!genre || d.genre === genre) && (!q || d.title.toLowerCase().includes(q))).sort(SORTS[sort].compare);
  }, [saved, search, genre, sort]);
  const genresUsed = useMemo(() => [...new Set(saved.map((d) => d.genre))], [saved]);
  // A chosen genre with no design left falls back to All (its chip is gone, so it could not be cleared).
  useEffect(() => {
    if (genre && !genresUsed.includes(genre)) setGenre('');
  }, [genre, genresUsed]);
  // Actions apply to what is shown: a design the search or genre hides is never acted on unseen.
  const pickedDesigns = shown.filter((d) => picked.has(d.id));

  function pick(id: string, range: boolean) {
    const from = range ? anchor.current : null; // read now: the updater runs after the anchor moves
    const order = shown.map((d) => d.id);
    setPicked((was) => {
      const next = new Set(was);
      const a = from ? order.indexOf(from) : -1;
      const b = order.indexOf(id);
      if (a >= 0 && b >= 0) for (const x of order.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x);
      else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchor.current = id;
  }

  /** Move designs to the Trash: one step, one Undo that restores them all (no question first). */
  async function moveToTrash(ids: readonly string[]) {
    const done = await designs.trash(ids);
    setPicked((was) => new Set([...was].filter((x) => !done.includes(x))));
    refresh();
    if (!done.length) return;
    const one = done.length === 1 ? saved.find((d) => d.id === done[0]) : undefined;
    offerUndo({
      message: one ? `“${one.title}” moved to the Trash` : `${plural(done.length, 'design', 'designs')} moved to the Trash`,
      advice: advise(done.length === 1 ? 'move-to-trash' : 'bulk-move-to-trash', { count: done.length }),
      undo: async () => {
        const back = await designs.restore(done); // deleted permanently meanwhile: nothing to restore
        refresh();
        return back.length > 0;
      },
    });
  }

  async function restore(ids: readonly string[]) {
    await designs.restore(ids);
    refresh();
  }

  /** Delete for good, only from the Trash: nothing can take it back, so it asks with the count. */
  async function purge(ids: readonly string[]) {
    if (!ids.length) return;
    const advice = advise('delete-permanently', { count: ids.length, verb: 'Delete {count} {design|designs} permanently' });
    if (advice.surface === 'confirm' && !window.confirm(`${advice.confirmLabel ?? 'Delete permanently'}? This cannot be undone.`)) return;
    await designs.purge(ids);
    refresh();
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">shaping</h1>
        <p className="max-w-2xl text-muted">
          Turn a flat figure into an object — to look at, animate, 3D-print or engrave. Bring an image, an SVG, a drawing, a shape or a few letters; choose a genre; turn the dials; export. Everything runs in your browser.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Start</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.values(genres).map((g) => (
            <button key={g.id} onClick={() => onOpen(newDesign(g.id, genres))} className="flex flex-col items-start gap-1 rounded-lg border border-line bg-white p-4 text-left hover:border-accent">
              <span className="font-medium">New: {g.title}</span>
              <span className="text-sm text-muted">{g.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Your designs</h2>
          <CollectionTools count={saved.length} onChanged={refresh} />
        </div>
        {saved.length === 0 && <p className="text-sm text-muted">Designs you make are kept in this browser. Import a saved file to bring some back.</p>}
        <InstallNotice />
      </section>

      {saved.length > 0 && (
        <section className="flex flex-col gap-3" aria-label="Your designs">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              aria-label="Search your designs"
              placeholder="Search titles"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-40 flex-1 rounded-md border border-line bg-white px-3 py-1.5 text-sm"
            />
            <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded-md border border-line bg-white px-2 py-1.5 text-sm">
              {Object.entries(SORTS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-pressed={selecting}
              className="rounded-md border border-line bg-white px-3 py-1.5 text-sm hover:border-accent"
              onClick={() => {
                setSelecting((on) => !on);
                setPicked(new Set());
              }}
            >
              {selecting ? 'Done' : 'Select'}
            </button>
          </div>
          {genresUsed.length > 1 && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Genre">
              {['', ...genresUsed].map((g) => (
                <button
                  key={g || 'all'}
                  type="button"
                  aria-pressed={genre === g}
                  onClick={() => setGenre(g)}
                  className={`rounded-full border px-3 py-0.5 text-xs ${genre === g ? 'border-accent bg-accent text-white' : 'border-line bg-white'}`}
                >
                  {g ? (genres[g]?.title ?? g) : 'All'}
                </button>
              ))}
            </div>
          )}
          {selecting && (
            <div role="region" aria-label="Selected designs" className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white p-2 text-sm shadow-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label="Select all shown"
                  checked={shown.length > 0 && shown.every((d) => picked.has(d.id))}
                  onChange={() => {
                    const ids = shown.map((d) => d.id);
                    const all = ids.every((id) => picked.has(id));
                    setPicked((was) => (all ? new Set([...was].filter((x) => !ids.includes(x))) : new Set([...was, ...ids])));
                  }}
                />
                <span aria-live="polite">{pickedDesigns.length ? `${plural(pickedDesigns.length, 'design', 'designs')} selected` : 'Select all shown'}</span>
              </label>
              {pickedDesigns.length > 0 && (
                <button type="button" className="rounded-md bg-red-700 px-3 py-1 text-white" onClick={() => void moveToTrash(pickedDesigns.map((d) => d.id))}>
                  Move {pickedDesigns.length} to Trash
                </button>
              )}
            </div>
          )}
          {shown.length === 0 && <p className="text-sm text-muted">No design matches.</p>}
          <div className="grid gap-2 sm:grid-cols-3">
            {shown.map((s) => (
              <div key={s.id} className={`flex items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 ${picked.has(s.id) ? 'border-accent' : 'border-line'}`}>
                {selecting && (
                  <input
                    type="checkbox"
                    tabIndex={-1}
                    aria-hidden="true"
                    checked={picked.has(s.id)}
                    onChange={() => undefined}
                    onClick={(e) => pick(s.id, e.shiftKey)}
                  />
                )}
                <button
                  className="flex flex-1 flex-col items-start text-left"
                  aria-pressed={selecting ? picked.has(s.id) : undefined}
                  onClick={(e) => (selecting ? pick(s.id, e.shiftKey) : onOpen(s.design))}
                >
                  <span className="font-medium">{s.title}</span>
                  <span className="text-xs text-muted">{genres[s.genre]?.title ?? s.genre} · {new Date(s.updated).toLocaleString()}</span>
                </button>
                {!selecting && (
                  <button aria-label={`Move ${s.title} to the Trash`} title="Move to Trash" className="text-xs text-muted hover:text-red-700" onClick={() => void moveToTrash([s.id])}>
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {trash.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Trash">
          <button type="button" aria-expanded={showTrash} onClick={() => setShowTrash((o) => !o)} className="self-start text-sm text-muted hover:text-ink">
            {showTrash ? '▼' : '▶'} Trash ({trash.length})
          </button>
          {showTrash && (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                {trash.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm">
                    <span className="flex flex-col">
                      <span className="font-medium">{s.title}</span>
                      <span className="text-xs text-muted">Moved {s.deletedAt ? new Date(s.deletedAt).toLocaleString() : ''}</span>
                    </span>
                    <span className="flex gap-2">
                      <button type="button" className="text-xs underline" onClick={() => void restore([s.id])}>
                        Restore
                      </button>
                      <button type="button" className="text-xs text-red-700 underline" onClick={() => void purge([s.id])}>
                        Delete permanently
                      </button>
                    </span>
                  </div>
                ))}
              </div>
              <button type="button" className="self-start text-xs text-red-700 underline" onClick={() => void purge(trash.map((d) => d.id))}>
                Empty Trash
              </button>
            </>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Examples</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {EXAMPLES.map((d) => (
            <button key={d.id} onClick={() => onOpen(copyDesign(d))} className="flex flex-col items-start gap-1 rounded-lg border border-line bg-white p-4 text-left hover:border-accent">
              <span className="flex w-full items-center justify-between gap-2">
                <span className="font-medium">{d.title}</span>
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: d.style.color }} />
              </span>
              <span className="text-xs uppercase tracking-wide text-muted">{genres[d.genre]?.title}</span>
              {d.description && <span className="text-sm text-muted">{d.description}</span>}
            </button>
          ))}
        </div>
      </section>

      <footer className="text-xs text-muted">
        Open source (MIT): <a className="underline" href="https://github.com/thorwhalen/shaping">github.com/thorwhalen/shaping</a>. Your images and designs stay in this browser.
      </footer>
    </div>
  );
}
