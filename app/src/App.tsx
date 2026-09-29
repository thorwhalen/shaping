/**
 * The app shell: the gallery, or the editor (panels on the left, the viewer on the right, the
 * checks underneath). The URL says which design and which panel is open; Back from the editor
 * returns to the gallery, not out of the app.
 */
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_PROFILE, liveChecks, PROFILES, type Design, type Model } from 'shaping';
import { EXAMPLES, Gallery } from './Gallery';
import { Notices } from './persist/Notices';
import { useSharedLink } from './persist/useSharedLink';
import { GenrePanel } from './panels/GenrePanel';
import { LookPanel } from './panels/LookPanel';
import { OutputPanel } from './panels/OutputPanel';
import { SourcePanel } from './panels/SourcePanel';
import { designs } from './state/designs';
import { cameFromApp, DEFAULT_PANEL, pushRoute, readRoute, replaceRoute, type Route } from './state/route';
import { useApp } from './state/store';
import { Viewer } from './viewer/Viewer';

const PANELS = [
  { id: 'source', label: 'Source' },
  { id: 'shape', label: 'Shape' },
  { id: 'look', label: 'Look' },
  { id: 'output', label: 'Export' },
] as const;

export function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const design = useApp((s) => s.design);
  const open = useApp((s) => s.open);

  // Follow the URL: open the design it names (saved, or an example by id), or show the gallery.
  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (!route.design) return open(null);
    if (design?.id === route.design) return;
    void designs.get(route.design).then((d) => {
      const found = d ?? EXAMPLES.find((e) => e.id === route.design) ?? null;
      if (found) open(found);
      else {
        replaceRoute({ design: null, panel: route.panel });
        setRoute({ design: null, panel: route.panel });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.design]);

  const openDesign = useCallback((d: Design) => {
    open(d);
    void designs.save(d);
    const r = { design: d.id, panel: 'source' };
    pushRoute(r);
    setRoute(r);
  }, [open]);

  // A shared link (?s=) lands here: save the copy, then replace the link's address with the copy's own.
  useSharedLink((d) =>
    void designs.save(d).then(() => {
      const r = { design: d.id, panel: DEFAULT_PANEL };
      replaceRoute(r);
      setRoute(r);
    }),
  );

  const screen = !route.design || !design ? (
    route.design ? <Loading /> : <Gallery onOpen={openDesign} />
  ) : (
    <Editor
      panel={route.panel}
      setPanel={(panel) => {
        const r = { ...route, panel };
        replaceRoute(r);
        setRoute(r);
      }}
      onBack={() => {
        if (cameFromApp()) return history.back();
        const r = { design: null, panel: route.panel };
        replaceRoute(r);
        setRoute(r);
      }}
    />
  );
  return (
    <>
      {screen}
      <Notices />
    </>
  );
}

function Loading() {
  return <div className="grid h-full place-items-center text-muted">Opening…</div>;
}

function Editor({ panel, setPanel, onBack }: { panel: string; setPanel: (p: string) => void; onBack: () => void }) {
  const design = useApp((s) => s.design)!;
  const model = useApp((s) => s.model);
  const busy = useApp((s) => s.busy);
  const error = useApp((s) => s.error);
  const edit = useApp((s) => s.edit);
  const [profileId, setProfileId] = useState(DEFAULT_PROFILE);
  const [resetKey, setResetKey] = useState(0);
  const [showSlices, setShowSlices] = useState(false);
  const [override, setOverride] = useState<{ design: Design; model: Model } | null>(null);

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="flex max-h-[55vh] w-full shrink-0 flex-col border-b border-line bg-paper md:max-h-none md:w-[360px] md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <button onClick={onBack} className="rounded px-1 text-muted hover:text-ink" aria-label="Back to the gallery" title="Back to the gallery">
            ←
          </button>
          <input aria-label="Title" className="min-w-0 flex-1 rounded bg-transparent px-1 font-medium hover:bg-white focus:bg-white" value={design.title} onChange={(e) => edit((d) => void (d.title = e.target.value))} />
        </div>
        <nav className="flex border-b border-line" role="tablist">
          {PANELS.map((p) => (
            <button key={p.id} role="tab" aria-selected={panel === p.id} onClick={() => setPanel(p.id)} className={`flex-1 px-2 py-2 text-sm ${panel === p.id ? 'border-b-2 border-accent font-medium' : 'text-muted hover:text-ink'}`}>
              {p.label}
            </button>
          ))}
        </nav>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {panel === 'source' && <SourcePanel profileId={profileId} />}
          {panel === 'shape' && <GenrePanel />}
          {panel === 'look' && <LookPanel onResetView={() => setResetKey((k) => k + 1)} showSlices={showSlices} setShowSlices={setShowSlices} />}
          {panel === 'output' && <OutputPanel profileId={profileId} setProfileId={setProfileId} setOverride={setOverride} />}
        </div>
      </aside>
      <main className="relative min-h-[50vh] flex-1">
        <Viewer design={design} model={model} busy={busy} resetKey={resetKey} showSlices={showSlices} override={override} setOverride={setOverride}>
          {busy && <div className="pointer-events-none absolute right-3 top-3 rounded bg-white/80 px-2 py-1 text-xs text-muted">Building…</div>}
          {!model && !error && <div className="pointer-events-none absolute inset-0 grid place-items-center text-muted">Building…</div>}
        </Viewer>
        <StatusBar model={model} error={error} profileId={profileId} />
      </main>
    </div>
  );
}

function StatusBar({ model, error, profileId }: { model: Model | null; error: string | null; profileId: string }) {
  const checks = model ? liveChecks(model, PROFILES[profileId]) : [];
  const d = model?.diagnostics;
  return (
    <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 border-t border-line bg-paper/90 px-3 py-2 text-xs backdrop-blur" aria-live="polite">
      {error && <p className="text-red-700">{error}</p>}
      {d && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {checks.map((c, i) => (
            <span key={i} className={c.level === 'ok' ? 'text-green-800' : c.level === 'warn' ? 'text-amber-700' : 'text-red-700'}>
              {c.message}
            </span>
          ))}
          <span className="text-muted">{(d.volume / 1000).toFixed(1)} cm³</span>
          {d.shadows?.map((s) => (
            <span key={s.slot} className={s.missingShare > 0.001 ? 'text-red-700' : 'text-muted'}>
              {s.slot}: {s.missingShare > 0.001 ? `${(100 * s.missingShare).toFixed(1)} % missing` : 'complete'}
            </span>
          ))}
          {d.buildMs !== undefined && <span className="text-muted">{d.buildMs.toFixed(0)} ms</span>}
        </div>
      )}
      {d?.warnings.filter((w) => !/separate pieces/.test(w)).map((w, i) => (
        <p key={i} className="text-amber-800">{w}</p>
      ))}
    </div>
  );
}
