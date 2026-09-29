/**
 * The genre and its dials. The dials come from the genre's own Zod schema; what the schema cannot
 * express (per-part transforms and colours, one-click fixes) is written here.
 */
import { useState } from 'react';
import { ASSIGNMENTS, builtInGenres, PartTransformSchema, PART_PALETTE, setParam, switchGenre, type Design, type Model } from 'shaping';
import { Dials } from '../dials/Dials';
import { useApp } from '../state/store';
import { geometry } from '../worker/client';

export function GenrePanel() {
  const design = useApp((s) => s.design)!;
  const update = useApp((s) => s.update);
  const genre = builtInGenres[design.genre];
  const params = genre.params.parse(design.params) as Record<string, unknown>;
  const onChange = (path: string, v: unknown) => update((d) => setParam(d, path, v));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1" role="radiogroup" aria-label="Genre">
        {Object.values(builtInGenres).map((g) => (
          <button key={g.id} role="radio" aria-checked={g.id === design.genre} onClick={() => g.id !== design.genre && update((d) => switchGenre(d, g.id, builtInGenres))} className={`flex-1 rounded-md border px-2 py-1 text-sm ${g.id === design.genre ? 'border-accent bg-accent text-white' : 'border-line bg-white hover:border-muted'}`}>
            {g.title}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">{genre.description}</p>
      {design.genre === 'shadow-blocks' && <ShadowFixes design={design} />}
      {design.genre === 'turned' && <TurnedParts design={design} params={params} />}
      <Dials schema={genre.params} value={params} onChange={onChange} exclude={['parts', 'hidden', 'transform']} />
    </div>
  );
}

function ShadowFixes({ design }: { design: Design }) {
  const update = useApp((s) => s.update);
  const model = useApp((s) => s.model);
  const figures = useApp((s) => s.figures);
  const [searching, setSearching] = useState(false);
  const missing = model?.diagnostics.shadows?.reduce((a, s) => a + s.missingShare, 0) ?? 0;
  const pieces = model?.diagnostics.pieces ?? 1;

  async function tryArrangements() {
    setSearching(true);
    try {
      const figs = Object.fromEntries(Object.entries(figures).map(([k, v]) => [k, v.figure!]));
      const score = (m: Model | null) => (m ? (m.diagnostics.shadows?.reduce((a, s) => a + s.missingShare, 0) ?? 0) + 0.05 * (m.diagnostics.pieces - 1) : Infinity);
      let best = { assign: (design.params.assign as string) ?? ASSIGNMENTS[0], score: score(model) };
      for (const assign of ASSIGNMENTS) {
        const m = await geometry().build(setParam(design, 'assign', assign), figs, 'probe');
        const s = score(m);
        if (s < best.score - 1e-6) best = { assign, score: s };
      }
      update((d) => setParam(d, 'assign', best.assign));
    } finally {
      setSearching(false);
    }
  }

  const fix = (label: string, fn: (d: Design) => Design, title: string) => (
    <button title={title} onClick={() => update(fn)} className="rounded border border-line bg-white px-2 py-1 text-xs hover:border-muted">
      {label}
    </button>
  );

  if (missing < 0.001 && pieces <= 1) return <p className="rounded bg-green-50 px-2 py-1 text-xs text-green-800">All three shadows are complete, in one piece.</p>;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-white/60 p-2">
      <p className="text-xs">
        {missing >= 0.001 && <>The solid misses {(100 * missing).toFixed(1)} % of its shadows (red on the walls). </>}
        {pieces > 1 && <>It falls into {pieces} pieces. </>}
        Fixes, in the order worth trying:
      </p>
      <div className="flex flex-wrap gap-1">
        <button onClick={() => void tryArrangements()} disabled={searching} className="rounded border border-accent bg-accent px-2 py-1 text-xs text-white disabled:opacity-60">
          {searching ? 'Trying…' : 'Try all assignments'}
        </button>
        {fix('Add a frame', (d) => setParam(d, 'frame', 'border'), 'A border on every figure: the third shadow is then always complete.')}
        {fix('Base bar', (d) => setParam(d, 'frame', 'base-bar'), 'A bar along the bottom of every figure.')}
        {fix('Thicken', (d) => setParam(d, 'thicken', Math.min(0.3, Number((d.params.thicken as number) ?? 0) + 0.03)), 'Grow every figure a little.')}
        {fix('Keep largest piece', (d) => setParam(d, 'keepLargest', true), 'Drop every piece but the largest.')}
        {fix('Base plate', (d) => setParam(d, 'basePlate', true), 'A plate underneath joins loose pieces.')}
      </div>
    </div>
  );
}

function TurnedParts({ design, params }: { design: Design; params: Record<string, unknown> }) {
  const update = useApp((s) => s.update);
  const figure = useApp((s) => s.figures.figure?.figure);
  const model = useApp((s) => s.model);
  const overrides = (params.parts ?? {}) as Record<string, Record<string, unknown>>;
  const hidden = (params.hidden ?? []) as string[];
  const def = params.transform as Record<string, unknown>;
  const [open, setOpen] = useState<string | null>(null);
  const parts = figure?.parts ?? [];

  return (
    <div className="flex flex-col gap-2">
      <details open className="rounded-md border border-line bg-white/50 px-3 py-2">
        <summary className="cursor-pointer select-none text-sm font-medium">Every part</summary>
        <div className="mt-2">
          <Dials schema={PartTransformSchema} value={def} onChange={(path, v) => update((d) => setParam(d, `transform.${path}`, v))} />
        </div>
      </details>
      {parts.length > 1 && (
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium">Parts</div>
          {parts.map((p, i) => {
            const color = design.style.partColors[p.id] ?? model?.bodies.find((b) => b.partId === p.id)?.color ?? PART_PALETTE[i % PART_PALETTE.length];
            const ov = overrides[p.id] ?? {};
            const isHidden = hidden.includes(p.id);
            return (
              <div key={p.id} className="rounded border border-line bg-white px-2 py-1">
                <div className="flex items-center gap-2 text-sm">
                  <input type="color" aria-label={`Colour of part ${p.id}`} value={color} className="h-5 w-7 cursor-pointer" onChange={(e) => update((d) => ({ ...d, style: { ...d.style, partColors: { ...d.style.partColors, [p.id]: e.target.value } } }))} />
                  <span className="flex-1">{p.id}</span>
                  <select aria-label={`Transform of part ${p.id}`} className="rounded border border-line px-1 text-xs" value={String(ov.kind ?? '')} onChange={(e) => update((d) => setParam(d, `parts.${p.id}`, e.target.value ? { ...ov, kind: e.target.value } : {}))}>
                    <option value="">as every part</option>
                    <option value="revolve">revolve</option>
                    <option value="extrude">extrude</option>
                    <option value="radial">radial</option>
                  </select>
                  <button className="text-xs text-muted hover:text-ink" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
                    {open === p.id ? 'less' : 'more'}
                  </button>
                  <label className="flex items-center gap-1 text-xs text-muted">
                    <input type="checkbox" checked={!isHidden} onChange={(e) => update((d) => setParam(d, 'hidden', e.target.checked ? hidden.filter((h) => h !== p.id) : [...hidden, p.id]))} /> show
                  </label>
                </div>
                {open === p.id && (
                  <div className="mt-2 border-t border-line pt-2">
                    <Dials schema={PartTransformSchema} value={{ ...def, ...ov }} onChange={(path, v) => update((d) => setParam(d, `parts.${p.id}.${path}`, v))} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
