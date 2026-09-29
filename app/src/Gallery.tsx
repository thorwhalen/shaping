/**
 * The gallery: the example designs (JSON files in the repository's examples/, each a `Design`,
 * none written as code), the user's saved designs, and a new design per genre.
 */
import { useEffect, useState } from 'react';
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

export function Gallery({ onOpen }: { onOpen: (d: Design) => void }) {
  const [saved, setSaved] = useState<SavedDesign[]>([]);
  const refresh = () => void designs.list().then(setSaved);
  useEffect(refresh, []);

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
        <section className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-3">
            {saved.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 py-2">
                <button className="flex flex-1 flex-col items-start text-left" onClick={() => onOpen(s.design)}>
                  <span className="font-medium">{s.title}</span>
                  <span className="text-xs text-muted">{genres[s.genre]?.title ?? s.genre} · {new Date(s.updated).toLocaleString()}</span>
                </button>
                <button aria-label={`Delete ${s.title}`} title="Delete" className="text-xs text-muted hover:text-red-700" onClick={() => void designs.remove(s.id).then(() => designs.list().then(setSaved))}>
                  ✕
                </button>
              </div>
            ))}
          </div>
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
