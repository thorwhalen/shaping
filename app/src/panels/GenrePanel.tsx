/**
 * The genre and its dials. The dials come from the genre's own Zod schema; what the schema cannot
 * express (per-part transforms and colours, one-click fixes) is written here.
 */
import { useEffect, useState } from 'react';
import { ASSIGNMENTS, PartTransformSchema, PART_PALETTE, setParam, switchGenre, type Design, type Model, recolor } from 'shaping';
import { genres } from '../genres';
import { Dials } from '../dials/Dials';
import { useApp } from '../state/store';
import { geometry } from '../worker/client';

export function GenrePanel() {
  const design = useApp((s) => s.design)!;
  const update = useApp((s) => s.update);
  const genre = genres[design.genre];
  const params = genre.params.parse(design.params) as Record<string, unknown>;
  const onChange = (path: string, v: unknown) => update((d) => setParam(d, path, v));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1" role="radiogroup" aria-label="Genre">
        {Object.values(genres).map((g) => (
          <button key={g.id} role="radio" aria-checked={g.id === design.genre} onClick={() => g.id !== design.genre && update((d) => switchGenre(d, g.id, genres))} className={`flex-1 rounded-md border px-2 py-1 text-sm ${g.id === design.genre ? 'border-accent bg-accent text-white' : 'border-line bg-white hover:border-muted'}`}>
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

/** The shape's state that the fixes act on: how much of the shadows is missing, and in how many pieces. */
function stats(m: Model | null) {
  return m ? { missing: m.diagnostics.shadows?.reduce((a, s) => a + s.missingShare, 0) ?? 0, pieces: m.diagnostics.pieces } : null;
}
const pct = (x: number) => `${(100 * x).toFixed(1)} %`;

/**
 * The fixes for shadows that do not agree, as toggles that show whether they are on. A click shows
 * at once that it was taken (the chip pulses while the object rebuilds), and when the new object is
 * there, a line says what changed ("missing 5.2 % → 0 %, 3 pieces → 1").
 */
function ShadowFixes({ design }: { design: Design }) {
  const update = useApp((s) => s.update);
  const model = useApp((s) => s.model);
  const stale = useApp((s) => s.stale);
  const figures = useApp((s) => s.figures);
  const [pending, setPending] = useState<{ label: string; before: ReturnType<typeof stats> } | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [trying, setTrying] = useState<string | null>(null);
  const p = genres[design.genre].params.parse(design.params) as { frame: string; thicken: number; keepLargest: boolean; basePlate: boolean; assign: string };
  const now = stats(model);

  // When the rebuilt object arrives, say what the fix changed.
  useEffect(() => {
    if (!pending || stale || !now) return;
    const b = pending.before;
    const parts = [b ? `missing ${pct(b.missing)} → ${pct(now.missing)}` : `missing ${pct(now.missing)}`, b && b.pieces !== now.pieces ? `${b.pieces} piece${b.pieces > 1 ? 's' : ''} → ${now.pieces}` : `${now.pieces} piece${now.pieces > 1 ? 's' : ''}`];
    setOutcome(`${pending.label}: ${parts.join(', ')}.`);
    setPending(null);
  }, [model, stale]); // eslint-disable-line react-hooks/exhaustive-deps

  function apply(label: string, fn: (d: Design) => Design) {
    setOutcome(null);
    setPending({ label, before: now });
    update(fn);
  }

  async function tryArrangements() {
    setOutcome(null);
    const figs = Object.fromEntries(Object.entries(figures).map(([k, v]) => [k, v.figure!]));
    const score = (m: Model | null) => (m ? (stats(m)!.missing) + 0.05 * (m.diagnostics.pieces - 1) : Infinity);
    const start = { assign: p.assign, score: score(model) };
    let best = start;
    try {
      for (const [i, assign] of ASSIGNMENTS.entries()) {
        setTrying(`Trying ${i + 1} of ${ASSIGNMENTS.length}…`);
        const m = await geometry().build(setParam(design, 'assign', assign), figs, 'probe');
        const s = score(m);
        if (s < best.score - 1e-6) best = { assign, score: s };
      }
    } finally {
      setTrying(null);
    }
    if (best.assign === start.assign) setOutcome('Tried all six assignments: yours is already the best.');
    else apply(`Assignment ${best.assign.replaceAll(',', ' / ')}`, (d) => setParam(d, 'assign', best.assign));
  }

  const toggles: Array<{ label: string; on: boolean; hint: string; set: (d: Design, on: boolean) => Design }> = [
    { label: 'Frame', on: p.frame === 'border', hint: 'A border on every figure: the third shadow is then always complete.', set: (d, on) => setParam(d, 'frame', on ? 'border' : 'none') },
    { label: 'Base bar', on: p.frame === 'base-bar', hint: 'A bar along the bottom of every figure.', set: (d, on) => setParam(d, 'frame', on ? 'base-bar' : 'none') },
    { label: 'Thicken', on: p.thicken > 0, hint: 'Grow every figure a little (fragile strokes become sturdier).', set: (d, on) => setParam(d, 'thicken', on ? THICKEN_STEP : 0) },
    { label: 'Largest piece only', on: p.keepLargest, hint: 'Drop every piece but the largest.', set: (d, on) => setParam(d, 'keepLargest', on) },
    { label: 'Base plate', on: p.basePlate, hint: 'A plate underneath joins loose pieces.', set: (d, on) => setParam(d, 'basePlate', on) },
  ];
  const busy = Boolean(pending) || Boolean(trying);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-white/60 p-2" aria-busy={busy}>
      <p className="text-xs" aria-live="polite">
        {now ? (
          now.missing < 0.001 && now.pieces <= 1 ? (
            <span className="text-green-800">All three shadows complete, in one piece.</span>
          ) : (
            <>
              {now.missing >= 0.001 && <span className="text-red-700">Missing {pct(now.missing)} of the shadows (red on the walls). </span>}
              {now.pieces > 1 && <span className="text-amber-800">{now.pieces} separate pieces. </span>}
            </>
          )
        ) : (
          'Building…'
        )}
        {stale && <span className="text-muted"> Updating…</span>}
      </p>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Fixes">
        {toggles.map((t) => {
          const working = pending?.label.startsWith(t.label);
          return (
            <button
              key={t.label}
              title={t.hint}
              aria-pressed={t.on}
              disabled={busy}
              onClick={() => apply(`${t.label} ${t.on ? 'off' : 'on'}`, (d) => t.set(d, !t.on))}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors disabled:cursor-wait ${t.on ? 'border-accent bg-accent text-white' : 'border-line bg-white hover:border-muted'} ${working ? 'animate-pulse' : ''}`}
            >
              {t.on ? '✓ ' : ''}
              {t.label}
            </button>
          );
        })}
        <button onClick={() => void tryArrangements()} disabled={busy} title="Build all six ways of assigning the figures to the views, and keep the best." className="rounded-full border border-dashed border-muted bg-white px-2.5 py-1 text-xs hover:border-ink disabled:cursor-wait">
          {trying ?? 'Try all assignments'}
        </button>
      </div>
      {outcome && <p className="text-xs text-ink" aria-live="polite">{outcome}</p>}
    </div>
  );
}

/** How much "Thicken" grows the figures when switched on (the dial below sets it precisely). */
const THICKEN_STEP = 0.04;

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
            const color = design.style.partColors[p.id] ?? (model ? recolor(model, design.style) : null)?.bodies.find((b) => b.partId === p.id)?.color ?? PART_PALETTE[i % PART_PALETTE.length];
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
