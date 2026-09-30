/**
 * Animate: sequences of views, played in the viewer and exported as GIF or video, through previz.
 *
 * Two ways to author, offered by configuration (`VITE_ANIMATION_MODES`: `both`, `capture` or
 * `formulas`):
 * - capture: "Capture this view" adds the view on screen (camera, light, material, dials) as a
 *   keyframe; the list reorders, renames and deletes them and sets each transition and dwell;
 * - formulas: pick a formula (turntable, a day of light, run a dial); its form is generated from
 *   its parameter schema.
 * Playback and export go through the same compiled reel, so the file shows what the viewer played.
 */
import { compile, parseSequence, type Reel } from 'previz';
import { expand, type Formula } from 'previz/formulas';
import { gifSink } from 'previz/gif';
import { createPlayer, type Player } from 'previz/play';
import { render } from 'previz/render';
import { webCodecsSink } from 'previz/video';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Design, Model } from 'shaping';
import { Dials } from '../dials/Dials';
import { genres } from '../genres';
import { NumberInput } from '../lib/NumberInput';
import { pickSaveHandle, saveBytes } from '../media/png';
import { useApp } from '../state/store';
import { captureRef, flushPose } from '../viewer/Viewer';
import { shapingEngine } from './engine';
import { shapingFormulas } from './formulas';
import { captureKeyframe, emptySequence, moveKeyframe, removeKeyframe, TIMINGS, updateKeyframe, type ShapingSequence } from './sequence';
import { designWithState, shapingSpace, type ShapingState } from './state';

type Mode = 'capture' | 'formulas';

/** The design's stored sequence, validated (a link or a file may carry anything); else an empty one. */
function storedSequence(stored: unknown, space: ShapingSequence['space']): ShapingSequence {
  if (!stored) return emptySequence(space);
  try {
    return { ...(parseSequence(stored) as ShapingSequence), space };
  } catch {
    return emptySequence(space);
  }
}
/** Which ways to author the app offers: `both` (default), `capture` or `formulas`. */
const CONFIGURED = (import.meta.env.VITE_ANIMATION_MODES as string | undefined) ?? 'both';
const MODES: Mode[] = CONFIGURED === 'capture' ? ['capture'] : CONFIGURED === 'formulas' ? ['formulas'] : ['capture', 'formulas'];

/** Export heights offered; the width follows the viewer's shape, so the file frames what you see. */
const HEIGHTS = [360, 480, 720, 1080] as const;
const FPS_CHOICES = [12, 24, 30, 60] as const;
const DEFAULT_FPS = 24;

const even = (n: number) => Math.max(2, 2 * Math.round(n / 2));
const viewerAspect = () => {
  const c = document.querySelector('main canvas') as HTMLCanvasElement | null;
  return c && c.clientHeight ? c.clientWidth / c.clientHeight : 16 / 9;
};

export function AnimatePanel({ setOverride }: { setOverride: (o: { design: Design; model: Model } | null) => void }) {
  const design = useApp((s) => s.design)!;
  const model = useApp((s) => s.model);
  const edit = useApp((s) => s.edit);
  const update = useApp((s) => s.update);
  const genre = genres[design.genre];
  const space = useMemo(() => shapingSpace(genre), [genre]);
  const formulas = useMemo(() => shapingFormulas(genre), [genre]);
  const [mode, setMode] = useState<Mode>(MODES[0]);
  const [formulaId, setFormulaId] = useState(formulas[0]?.id ?? '');
  const [formulaParams, setFormulaParams] = useState<Record<string, unknown>>({});
  const [height, setHeight] = useState<number>(HEIGHTS[1]);
  const [fps, setFps] = useState<number>(DEFAULT_FPS);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const player = useRef<Player | null>(null);
  const abort = useRef<AbortController | null>(null);

  const engine = useMemo(
    () =>
      shapingEngine({
        current: () => {
          const s = useApp.getState();
          const figures = Object.fromEntries(Object.entries(s.figures).map(([k, v]) => [k, v.figure!]));
          return { design: s.design!, model: s.model!, modelKey: s.modelKey, figures };
        },
        genre,
        setOverride,
        capture: () => captureRef.current,
        flushPose: () => flushPose.current(),
      }),
    [genre, setOverride],
  );

  const sequence: ShapingSequence = useMemo(() => storedSequence(design.sequence, space), [design.sequence, space]);
  const setSequence = (next: ShapingSequence) => edit((d) => void (d.sequence = next as unknown as Record<string, unknown>));
  const formula = formulas.find((f) => f.id === formulaId) ?? formulas[0];
  // A value the form allowed but the formula refuses never crashes the panel: the defaults stand in.
  const parsedParams = formula ? formula.params.safeParse(formulaParams) : null;
  const params = (parsedParams?.success ? parsedParams.data : formula?.params.parse({})) as Record<string, unknown> ?? {};

  // Stop playback and exports when leaving the panel or switching design.
  useEffect(() => () => stopAll(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function stopAll() {
    flushPose.current();
    player.current?.dispose();
    player.current = null;
    abort.current?.abort();
    abort.current = null;
    engine.release();
    setPlaying(false);
    setProgress(null);
  }

  /** The reel to play or export: the captured keyframes, or the chosen formula's expansion. */
  function reel(): Reel<ShapingState> {
    if (mode === 'capture') {
      if (sequence.keyframes.length < 2) throw new Error('Capture at least two views: the sequence moves from one to the next.');
      return compile({ ...sequence, space });
    }
    if (!formula) throw new Error('No formula is available for this genre.');
    return compile(expand(formula as Formula<any, ShapingState>, { base: engine.read!() as ShapingState, space, params }));
  }

  function play() {
    stopAll();
    try {
      const r = reel();
      const p = createPlayer(r, engine, { onError: (e) => setStatus((e as Error).message) });
      p.subscribe((e) => {
        // Dispose first: the player's last apply may still be in flight, and must not land after release.
        if (e.status === 'ended') queueMicrotask(stopAll);
      });
      player.current = p;
      setPlaying(true);
      setStatus(null);
      p.play();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function exportAs(kind: 'gif' | 'video') {
    stopAll();
    let r: Reel<ShapingState>;
    try {
      r = reel();
    } catch (e) {
      return setStatus((e as Error).message);
    }
    const width = even(height * viewerAspect());
    const base = design.title.replace(/[^\w-]+/g, '-').toLowerCase() || 'shaping';
    const name = kind === 'gif' ? `${base}.gif` : `${base}.mp4`;
    let handle: Awaited<ReturnType<typeof pickSaveHandle>>;
    try {
      handle = await pickSaveHandle(name, kind === 'gif' ? 'image/gif' : 'video/mp4');
    } catch (e) {
      return setStatus((e as Error).message);
    }
    const ctrl = new AbortController();
    abort.current = ctrl;
    setProgress(0);
    setStatus(`Rendering ${width} × ${height} at ${fps} fps…`);
    try {
      const sink = kind === 'gif' ? gifSink() : webCodecsSink();
      const take = await render(r, engine, sink, { width, height, fps, signal: ctrl.signal, onProgress: (p) => setProgress(p.fraction) });
      const { bytes, mimeType, extension } = take.result as { bytes: Uint8Array; mimeType: string; extension: string };
      const file = `${base}.${extension}`;
      await saveBytes(bytes, file, mimeType, extension === (kind === 'gif' ? 'gif' : 'mp4') ? handle : null);
      setStatus(`Saved ${file}: ${take.count} frames (${take.rendered} rendered), ${(bytes.length / 1024).toFixed(0)} kB.`);
    } catch (e) {
      if (!ctrl.signal.aborted) setStatus((e as Error).message);
      else setStatus('Export cancelled.');
    } finally {
      abort.current = null;
      engine.release();
      setProgress(null);
    }
  }

  const busy = progress !== null;
  return (
    <div className="flex flex-col gap-4">
      {MODES.length > 1 && (
        <div className="flex gap-1" role="tablist" aria-label="How to animate">
          {MODES.map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`flex-1 rounded-md border px-2 py-1 text-sm ${mode === m ? 'border-accent bg-accent text-white' : 'border-line bg-white hover:border-muted'}`}>
              {m === 'capture' ? 'Captured views' : 'Formulas'}
            </button>
          ))}
        </div>
      )}

      {mode === 'capture' && (
        <section className="flex flex-col gap-2">
          <button className="rounded border border-accent bg-accent px-2 py-1.5 text-sm text-white" onClick={() => setSequence(captureKeyframe(sequence, engine.read!() as ShapingState, space))}>
            Capture this view
          </button>
          <p className="text-xs text-muted">Arrange the view (orbit, zoom, light, dials), capture it, arrange the next, capture again. The sequence moves smoothly from one to the next.</p>
          <ol className="flex flex-col gap-1">
            {sequence.keyframes.map((k, i) => (
              <li key={k.id} className="rounded border border-line bg-white px-2 py-1.5 text-sm">
                <div className="flex items-center gap-1">
                  <span className="w-5 text-xs text-muted">{i + 1}</span>
                  <input aria-label={`Name of view ${i + 1}`} className="min-w-0 flex-1 rounded px-1 hover:bg-paper focus:bg-paper" value={k.label ?? k.id} onChange={(e) => setSequence(updateKeyframe(sequence, i, { label: e.target.value }))} />
                  <button title="Show this view (and make it the one being edited)" className="rounded px-1 text-xs text-muted hover:text-ink" onClick={() => update((d) => designWithState(d, { ...(engine.read!() as ShapingState), ...(k.state as ShapingState) }, genre))}>
                    go
                  </button>
                  <button aria-label="Move up" className="px-1 text-muted hover:text-ink disabled:opacity-30" disabled={i === 0} onClick={() => setSequence(moveKeyframe(sequence, i, -1))}>↑</button>
                  <button aria-label="Move down" className="px-1 text-muted hover:text-ink disabled:opacity-30" disabled={i === sequence.keyframes.length - 1} onClick={() => setSequence(moveKeyframe(sequence, i, 1))}>↓</button>
                  <button aria-label={`Delete view ${i + 1}`} className="px-1 text-muted hover:text-red-700" onClick={() => setSequence(removeKeyframe(sequence, i))}>✕</button>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 pl-5 text-xs text-muted">
                  {i > 0 && (
                    <>
                      <label className="flex items-center gap-1">
                        move
                        <NumberInput min={0.1} max={60} step={0.1} className="w-14 rounded border border-line px-1" value={k.enter?.duration ?? sequence.defaults?.transition?.duration ?? 1} onValue={(duration) => setSequence(updateKeyframe(sequence, i, { enter: { duration } }))} />s
                      </label>
                      <select aria-label="Timing" className="rounded border border-line px-1" value={(k.enter?.timing as string | undefined) ?? (sequence.defaults?.transition?.timing as string)} onChange={(e) => setSequence(updateKeyframe(sequence, i, { enter: { timing: e.target.value } }))}>
                        {TIMINGS.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </>
                  )}
                  <label className="flex items-center gap-1">
                    stay
                    <NumberInput min={0} max={60} step={0.1} className="w-14 rounded border border-line px-1" value={k.dwell ?? sequence.defaults?.dwell ?? 0} onValue={(dwell) => setSequence(updateKeyframe(sequence, i, { dwell }))} />s
                  </label>
                </div>
              </li>
            ))}
          </ol>
          {sequence.keyframes.length > 0 && (
            <button className="self-start text-xs text-muted hover:text-red-700" onClick={() => setSequence(emptySequence(space))}>Clear all views</button>
          )}
        </section>
      )}

      {mode === 'formulas' && formula && (
        <section className="flex flex-col gap-3">
          <select aria-label="Formula" className="rounded border border-line bg-white px-2 py-1 text-sm" value={formula.id} onChange={(e) => { setFormulaId(e.target.value); setFormulaParams({}); }}>
            {formulas.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
          </select>
          <p className="text-xs text-muted">{formula.description}</p>
          <Dials schema={formula.params} value={params} onChange={(path, v) => setFormulaParams((p) => ({ ...p, [path]: v }))} />
        </section>
      )}

      <section className="flex flex-col gap-2 border-t border-line pt-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label className="flex flex-col">Height<select value={height} onChange={(e) => setHeight(Number(e.target.value))} className="rounded border border-line bg-white px-1">{HEIGHTS.map((h) => <option key={h} value={h}>{h}px</option>)}</select></label>
          <label className="flex flex-col">Frames per second<select value={fps} onChange={(e) => setFps(Number(e.target.value))} className="rounded border border-line bg-white px-1">{FPS_CHOICES.map((f) => <option key={f} value={f}>{f}</option>)}</select></label>
        </div>
        <div className="flex flex-wrap gap-1">
          {playing ? (
            <button onClick={stopAll} className="rounded border border-ink bg-ink px-2 py-1 text-xs text-white">Stop</button>
          ) : (
            <button disabled={!model || busy} onClick={play} className="rounded border border-line bg-white px-2 py-1 text-xs hover:border-muted disabled:opacity-50">Play</button>
          )}
          <button disabled={!model || busy} onClick={() => void exportAs('gif')} className="rounded border border-line bg-white px-2 py-1 text-xs hover:border-muted disabled:opacity-50">GIF</button>
          <button disabled={!model || busy || typeof VideoEncoder === 'undefined'} title={typeof VideoEncoder === 'undefined' ? 'This browser has no WebCodecs; use a GIF.' : ''} onClick={() => void exportAs('video')} className="rounded border border-line bg-white px-2 py-1 text-xs hover:border-muted disabled:opacity-50">Video</button>
          {busy && <button onClick={stopAll} className="rounded px-2 py-1 text-xs text-muted hover:text-ink">Cancel</button>}
        </div>
        {busy && (
          <div className="h-1.5 w-full overflow-hidden rounded bg-line" role="progressbar" aria-valuenow={Math.round(100 * (progress ?? 0))}>
            <div className="h-full bg-accent transition-[width]" style={{ width: `${100 * (progress ?? 0)}%` }} />
          </div>
        )}
        {status && <p className="text-xs text-muted" aria-live="polite">{status}</p>}
      </section>
    </div>
  );
}
