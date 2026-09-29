/**
 * Everything that leaves the app: files for printing, viewing and laser work (built from the
 * exporters table), and stills, GIFs and videos rendered frame by frame at the export size. An
 * animation that changes the solid rebuilds the model for every frame: the file shows exactly
 * what would be exported at that moment, never a screen effect.
 */
import { useMemo, useState } from 'react';
import { builtInGenres, DEFAULT_PROFILE, getPath, PROFILES, type Design, type Model } from 'shaping';
import { z } from 'zod';
import { designAt, frameCount, rebuildsGeometry, sweep, turntable } from 'shaping/animate';
import { exporters, exportFileName, type Operation } from 'shaping/export';
import { encodeGif, encodeVideo, pickSaveHandle, saveBytes, supportsVideo } from '../media';
import { useApp } from '../state/store';
import { captureRef } from '../viewer/Viewer';
import { geometry } from '../worker/client';

/** Export sizes offered for images and videos, in pixels. */
const MEDIA_SIZES = [480, 720, 1080] as const;

export function OutputPanel({ profileId, setProfileId, setOverride }: { profileId: string; setProfileId: (id: string) => void; setOverride: (o: { design: Design; model: Model } | null) => void }) {
  const design = useApp((s) => s.design)!;
  const model = useApp((s) => s.model);
  const edit = useApp((s) => s.edit);
  const [operation, setOperation] = useState<Operation>('cut');
  const [kerf, setKerf] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const profile = PROFILES[profileId] ?? PROFILES[DEFAULT_PROFILE];
  const ordered = useMemo(() => [...profile.formats, ...Object.keys(exporters).filter((k) => !profile.formats.includes(k))], [profile]);

  async function exportFile(id: string) {
    if (!model) return;
    const ex = exporters[id];
    const options = ex.kind === '2d' ? { operation, kerf, title: design.title } : { title: design.title };
    const name = exportFileName(design.title, ex, design.sizeMm, options);
    const handle = await pickSaveHandle(name, ex.mediaType);
    setStatus(`Writing ${name}…`);
    try {
      const bytes = await geometry().export(model, id, options);
      await saveBytes(bytes, name, ex.mediaType, handle);
      setStatus(`Saved ${name} (${(bytes.length / 1024).toFixed(0)} kB).`);
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Size and process</h3>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>Longest edge</span>
          <span className="flex items-center gap-1">
            <input type="number" min={1} max={2000} step={1} value={design.sizeMm} onChange={(e) => Number(e.target.value) > 0 && edit((d) => void (d.sizeMm = Number(e.target.value)))} className="w-20 rounded border border-line bg-white px-1 text-right" />
            mm
          </span>
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>Process</span>
          <select value={profile.id} onChange={(e) => setProfileId(e.target.value)} className="rounded border border-line bg-white px-1 py-0.5 text-xs">
            {Object.values(PROFILES).map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted">Minimum wall {profile.minWallMm} mm.{profile.sealedCavityBlocks ? ' Sealed cavities trap material in this process.' : ''}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Files</h3>
        <div className="grid grid-cols-2 gap-1">
          {ordered.map((id) => {
            const ex = exporters[id];
            return (
              <button key={id} disabled={!model} onClick={() => void exportFile(id)} title={ex.title} className="flex flex-col items-start rounded border border-line bg-white px-2 py-1 text-left hover:border-muted disabled:opacity-50">
                <span className="text-sm font-medium">.{ex.extension}</span>
                <span className="text-[11px] leading-tight text-muted">{ex.title}</span>
              </button>
            );
          })}
        </div>
        <details className="rounded-md border border-line bg-white/50 px-3 py-2">
          <summary className="cursor-pointer select-none text-sm">Laser: SVG and DXF</summary>
          <div className="mt-2 flex flex-col gap-2 text-sm">
            <div className="flex gap-1">
              {(['cut', 'score', 'engrave'] as const).map((o) => (
                <button key={o} onClick={() => setOperation(o)} className={`rounded border px-2 py-0.5 text-xs ${operation === o ? 'border-accent bg-accent text-white' : 'border-line bg-white'}`}>{o}</button>
              ))}
            </div>
            <label className="flex items-center justify-between">
              Kerf
              <span><input type="number" min={0} max={1} step={0.01} value={kerf} onChange={(e) => setKerf(Math.max(0, Number(e.target.value)))} className="w-16 rounded border border-line bg-white px-1 text-right" /> mm</span>
            </label>
            <p className="text-xs text-muted">Profiles are the figures as the object carries them (slices, shadows). “CAD export” means these profiles plus the recipe in the print pack: import, extrude, intersect.</p>
          </div>
        </details>
      </section>

      <MediaSection design={design} model={model} setOverride={setOverride} setStatus={setStatus} />

      {status && <p className="text-xs text-muted" aria-live="polite">{status}</p>}
    </div>
  );
}

function MediaSection({ design, model, setOverride, setStatus }: { design: Design; model: Model | null; setOverride: (o: { design: Design; model: Model } | null) => void; setStatus: (s: string | null) => void }) {
  const figures = useApp((s) => s.figures);
  const [kind, setKind] = useState<'turntable' | 'sweep'>('turntable');
  const [seconds, setSeconds] = useState(4);
  const [fps, setFps] = useState(24);
  const [size, setSize] = useState<number>(MEDIA_SIZES[0]);
  const [sweepPath, setSweepPath] = useState<string>('');
  const [progress, setProgress] = useState<number | null>(null);
  const sweepables = useSweepables(design);
  const chosen = sweepables.find((s) => s.path === sweepPath) ?? sweepables[0];

  const animation = kind === 'turntable' || !chosen
    ? turntable(design, { seconds, fps })
    : sweep(design, { target: 'params', property: chosen.path, from: chosen.min, to: chosen.max, seconds, fps, pingPong: true });

  async function render(format: 'gif' | 'video' | 'png') {
    if (!model || !captureRef.current) return;
    const capture = captureRef.current;
    const figs = Object.fromEntries(Object.entries(figures).map(([k, v]) => [k, v.figure!]));
    const geometric = rebuildsGeometry(animation);
    const at = { ...design, animation };
    const frame = async (i: number) => {
      const d = designAt(at, i / animation.fps);
      const m = geometric ? await geometry().build(d, figs, 'frame') : model;
      if (!m) throw new Error('A frame could not be built.');
      return capture({ design: d, model: m, width: size, height: size });
    };
    const base = design.title.replace(/[^\w-]+/g, '-').toLowerCase();
    try {
      if (format === 'png') {
        const img = await capture({ design, model, width: size * 2, height: size * 2, transparent: true });
        const c = new OffscreenCanvas(img.width, img.height);
        c.getContext('2d')!.putImageData(img, 0, 0);
        await saveBytes(await c.convertToBlob({ type: 'image/png' }), `${base}.png`, 'image/png');
        setStatus(`Saved ${base}.png.`);
        return;
      }
      const count = frameCount(animation);
      const name = format === 'gif' ? `${base}.gif` : `${base}.mp4`;
      const handle = await pickSaveHandle(name, format === 'gif' ? 'image/gif' : 'video/mp4');
      setProgress(0);
      if (format === 'gif') {
        const bytes = await encodeGif(frame, { count, fps: animation.fps, onProgress: setProgress });
        await saveBytes(bytes, name, 'image/gif', handle);
        setStatus(`Saved ${name}: ${count} frames.`);
      } else {
        const v = await encodeVideo(frame, { count, fps: animation.fps, width: size, height: size, onProgress: setProgress });
        const vname = `${base}.${v.extension}`;
        await saveBytes(v.bytes, vname, v.mimeType, v.extension === 'mp4' ? handle : null);
        setStatus(`Saved ${vname}: ${count} frames.`);
      }
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setOverride(null);
      setProgress(null);
    }
  }

  async function preview() {
    if (!model) return;
    const figs = Object.fromEntries(Object.entries(figures).map(([k, v]) => [k, v.figure!]));
    const geometric = rebuildsGeometry(animation);
    const at = { ...design, animation };
    const count = frameCount(animation);
    setProgress(0);
    for (let i = 0; i <= count; i++) {
      const d = designAt(at, (i % count) / animation.fps);
      const m = geometric ? await geometry().build(d, figs, 'frame') : model;
      if (m) setOverride({ design: d, model: m });
      await new Promise((r) => setTimeout(r, 1000 / animation.fps));
      setProgress(i / count);
    }
    setOverride(null);
    setProgress(null);
  }

  const busy = progress !== null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Images and animation</h3>
      <div className="flex gap-1">
        {(['turntable', 'sweep'] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)} disabled={k === 'sweep' && !sweepables.length} className={`rounded border px-2 py-0.5 text-xs ${kind === k ? 'border-accent bg-accent text-white' : 'border-line bg-white'} disabled:opacity-40`}>
            {k === 'turntable' ? 'Turntable' : 'Parameter sweep'}
          </button>
        ))}
      </div>
      {kind === 'sweep' && chosen && (
        <label className="flex items-center justify-between text-sm">
          Dial
          <select className="max-w-[60%] rounded border border-line bg-white px-1 text-xs" value={chosen.path} onChange={(e) => setSweepPath(e.target.value)}>
            {sweepables.map((s) => (
              <option key={s.path} value={s.path}>{s.title} ({s.min} → {s.max})</option>
            ))}
          </select>
        </label>
      )}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <label className="flex flex-col">Seconds<input type="number" min={1} max={30} value={seconds} onChange={(e) => setSeconds(Math.max(1, Number(e.target.value)))} className="rounded border border-line bg-white px-1" /></label>
        <label className="flex flex-col">FPS<input type="number" min={6} max={60} value={fps} onChange={(e) => setFps(Math.max(6, Number(e.target.value)))} className="rounded border border-line bg-white px-1" /></label>
        <label className="flex flex-col">Size<select value={size} onChange={(e) => setSize(Number(e.target.value))} className="rounded border border-line bg-white px-1">{MEDIA_SIZES.map((s) => <option key={s} value={s}>{s}px</option>)}</select></label>
      </div>
      <div className="flex flex-wrap gap-1">
        <button disabled={!model || busy} onClick={() => void preview()} className="rounded border border-line bg-white px-2 py-1 text-xs hover:border-muted disabled:opacity-50">Play</button>
        <button disabled={!model || busy} onClick={() => void render('png')} className="rounded border border-line bg-white px-2 py-1 text-xs hover:border-muted disabled:opacity-50">PNG</button>
        <button disabled={!model || busy} onClick={() => void render('gif')} className="rounded border border-line bg-white px-2 py-1 text-xs hover:border-muted disabled:opacity-50">GIF</button>
        <button disabled={!model || busy || !supportsVideo()} title={supportsVideo() ? '' : 'This browser has no WebCodecs; use a GIF.'} onClick={() => void render('video')} className="rounded border border-line bg-white px-2 py-1 text-xs hover:border-muted disabled:opacity-50">Video</button>
      </div>
      {busy && (
        <div className="h-1.5 w-full overflow-hidden rounded bg-line" role="progressbar" aria-valuenow={Math.round(100 * (progress ?? 0))}>
          <div className="h-full bg-accent transition-[width]" style={{ width: `${100 * (progress ?? 0)}%` }} />
        </div>
      )}
    </section>
  );
}

/** Numeric genre dials that can be swept, with their ranges, read from the genre's schema. */
function useSweepables(design: Design): Array<{ path: string; title: string; min: number; max: number }> {
  return useMemo(() => {
    const genre = builtInGenres[design.genre];
    const out: Array<{ path: string; title: string; min: number; max: number }> = [];
    const walk = (schema: unknown, prefix: string) => {
      const s = schema as { properties?: Record<string, { type?: string; minimum?: number; maximum?: number; title?: string; properties?: object }> };
      for (const [k, v] of Object.entries(s.properties ?? {})) {
        if ((v.type === 'number' || v.type === 'integer') && v.minimum !== undefined && v.maximum !== undefined) out.push({ path: prefix + k, title: v.title ?? k, min: v.minimum, max: v.maximum });
        else if (v.type === 'object' && v.properties) walk(v, `${prefix}${k}.`);
      }
    };
    walk(toJson(genre.params), '');
    // Sweep from the current value toward the far end of the dial's range.
    const params = genre.params.parse(design.params);
    return out.map((o) => {
      const now = Number(getPath(params, o.path) ?? o.min);
      const to = Math.abs(o.max - now) >= Math.abs(now - o.min) ? o.max : o.min;
      return { ...o, min: now, max: to };
    });
  }, [design.genre, design.params]);
}

const toJson = (schema: z.ZodType) => z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
