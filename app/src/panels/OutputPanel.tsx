/**
 * Everything that leaves the app as a file: printing, viewing and laser files (built from the
 * exporters table, recoloured as shown), and a picture of the view. Animations (GIF, video) are made
 * in the Animate panel, through previz.
 */
import { useMemo, useState } from 'react';
import { DEFAULT_PROFILE, PROFILES, type Design, type Model, recolor } from 'shaping';
import { exporters, exportFileName, type Operation } from 'shaping/export';
import { NumberInput } from '../lib/NumberInput';
import { pickSaveHandle, saveBytes } from '../media/png';
import { useApp } from '../state/store';
import { captureRef } from '../viewer/Viewer';
import { geometry } from '../worker/client';

/** Export sizes offered for images and videos, in pixels. */
const MEDIA_SIZES = [480, 720, 1080] as const;

export function OutputPanel({ profileId, setProfileId }: { profileId: string; setProfileId: (id: string) => void }) {
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
    setStatus(`Writing ${name}…`);
    try {
      const handle = await pickSaveHandle(name, ex.mediaType);
      // Colours are display fields: export the model coloured as it is shown.
      const bytes = await geometry().export(recolor(model, design.style), id, options);
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
            <NumberInput min={1} max={2000} step={1} value={design.sizeMm} onValue={(v) => edit((d) => void (d.sizeMm = v))} className="w-20 rounded border border-line bg-white px-1 text-right" />
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
              <span><NumberInput min={0} max={1} step={0.01} value={kerf} onValue={setKerf} className="w-16 rounded border border-line bg-white px-1 text-right" /> mm</span>
            </label>
            <p className="text-xs text-muted">Profiles are the figures as the object carries them (slices, shadows). “CAD export” means these profiles plus the recipe in the print pack: import, extrude, intersect.</p>
          </div>
        </details>
      </section>

      <StillSection design={design} model={model} setStatus={setStatus} />

      {status && <p className="text-xs text-muted" aria-live="polite">{status}</p>}
    </div>
  );
}

/** A still of the view, at the viewer's shape (or square), rendered by the same capture as every export. */
function StillSection({ design, model, setStatus }: { design: Design; model: Model | null; setStatus: (s: string | null) => void }) {
  const [height, setHeight] = useState<number>(STILL_HEIGHTS[1]);
  const [transparent, setTransparent] = useState(false);
  async function still() {
    const capture = captureRef.current;
    if (!model || !capture) return;
    const c = document.querySelector('main canvas') as HTMLCanvasElement | null;
    const aspect = c && c.clientHeight ? c.clientWidth / c.clientHeight : 1;
    const width = Math.round(height * aspect);
    const img = await capture({ design, model: recolor(model, design.style), width, height, transparent });
    const oc = new OffscreenCanvas(img.width, img.height);
    oc.getContext('2d')!.putImageData(img, 0, 0);
    const base = design.title.replace(/[^\w-]+/g, '-').toLowerCase() || 'shaping';
    await saveBytes(await oc.convertToBlob({ type: 'image/png' }), `${base}.png`, 'image/png');
    setStatus(`Saved ${base}.png (${width} × ${height}).`);
  }
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Picture</h3>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select aria-label="Picture height" value={height} onChange={(e) => setHeight(Number(e.target.value))} className="rounded border border-line bg-white px-1">
          {STILL_HEIGHTS.map((h) => <option key={h} value={h}>{h}px</option>)}
        </select>
        <label className="flex items-center gap-1"><input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> transparent</label>
        <button disabled={!model} onClick={() => void still()} className="rounded border border-line bg-white px-2 py-1 hover:border-muted disabled:opacity-50">PNG</button>
      </div>
      <p className="text-xs text-muted">The picture is the view on screen. Animations (GIF, video) are in the Animate tab.</p>
    </section>
  );
}

/** Picture heights offered. */
const STILL_HEIGHTS = [720, 1080, 2160] as const;
