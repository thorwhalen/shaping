/**
 * Sources: what each slot of the genre is made from — a built-in shape, text (any open font), an uploaded
 * image (with the threshold and tuning dials and a live mask preview that marks thin regions), an
 * SVG, or a drawing. Changing a dial re-runs from the original image, never from a previous result.
 */
import { useEffect, useRef, useState } from 'react';
import { DrawingSourceSchema, PrepareSchema, prepareParams, PROFILES, setPrepare, setSource, ShapeSourceSchema, TextSourceSchema, type Design, type Source } from 'shaping';
import { genres } from '../genres';
import { Dials } from '../dials/Dials';
import { DrawingCanvas } from '../draw';
import { TextSourceEditor } from '../fonts';
import { putBlob } from '../lib/blobs';
import { heldUrl, hostOf, isHeldRemote } from '../persist/incoming';
import { useApp } from '../state/store';
import { geometry } from '../worker/client';
import type { MaskPreview } from '../worker/protocol';

type Kind = Source['kind'];
const KINDS: Array<{ kind: Kind; label: string }> = [
  { kind: 'shape', label: 'Shape' },
  { kind: 'text', label: 'Text' },
  { kind: 'image', label: 'Image' },
  { kind: 'drawing', label: 'Draw' },
  { kind: 'svg', label: 'SVG' },
];

/** What a slot switches to when the user picks a kind it does not have yet. */
const STARTERS: Record<Kind, Source | null> = {
  shape: ShapeSourceSchema.parse({ kind: 'shape', shape: 'circle' }),
  text: TextSourceSchema.parse({ kind: 'text', text: 'A' }),
  drawing: DrawingSourceSchema.parse({ kind: 'drawing' }),
  image: null,
  svg: null,
  polygons: null,
};

/** Longest side of a new drawing page, in drawing units. */
const PAGE_SIZE = 512;
/** Page proportions closer than this to the block's count as matching. */
const ASPECT_TOLERANCE = 0.01;

/** A blank drawing page with the given width : height (square without one). */
function pageFor(aspect: number | undefined): Source {
  const a = aspect ?? 1;
  const [width, height] = a >= 1 ? [PAGE_SIZE, PAGE_SIZE / a] : [PAGE_SIZE * a, PAGE_SIZE];
  return DrawingSourceSchema.parse({ kind: 'drawing', width, height });
}

/** Pixels of the working image that one millimetre of the finished object covers, roughly. */
function pxPerMm(design: Design, preview: MaskPreview | null) {
  return preview ? Math.max(preview.width, preview.height) / design.sizeMm : 1;
}

export function SourcePanel({ profileId }: { profileId: string }) {
  const design = useApp((s) => s.design)!;
  const update = useApp((s) => s.update);
  const activeSlot = useApp((s) => s.activeSlot);
  const setActiveSlot = useApp((s) => s.setActiveSlot);
  const figures = useApp((s) => s.figures);
  const genre = genres[design.genre];
  const slot = genre.slots.find((s) => s.id === activeSlot) ?? genre.slots[0];
  const source = design.sources[slot.id];
  const [stash, setStash] = useState<Record<string, Partial<Record<Kind, Source>>>>({});

  const choose = (kind: Kind) => {
    if (kind === source.kind) return;
    setStash((s) => ({ ...s, [slot.id]: { ...s[slot.id], [source.kind]: source } }));
    const starter = kind === 'drawing' ? pageFor(slotAspect) : STARTERS[kind];
    const next = stash[slot.id]?.[kind] ?? starter;
    if (next) update((d) => setSource(d, slot.id, next));
    else fileInput.current?.click();
    pendingKind.current = kind;
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingKind = useRef<Kind>('image');

  async function onFile(file: File) {
    if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
      const svg = await file.text();
      update((d) => setSource(d, slot.id, { kind: 'svg', svg, name: file.name }));
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const src = await putBlob(bytes, file.type || 'application/octet-stream', file.name);
    update((d) => setSource(d, slot.id, { kind: 'image', src, name: file.name }));
  }

  // The proportions this slot's figure is fitted into (e.g. one face of a shadow block), if the genre says.
  const slotAspect = (() => {
    const f = genre.slotFrame?.(genre.params.parse(design.params), slot.id);
    return f ? f[0] / f[1] : undefined;
  })();
  const figureError = figures[slot.id]?.error;
  const parts = figures[slot.id]?.figure?.parts.length;

  return (
    <div className="flex flex-col gap-4">
      {genre.slots.length > 1 && (
        <div className="flex gap-1" role="tablist" aria-label="Slots">
          {genre.slots.map((s) => (
            <button key={s.id} role="tab" aria-selected={s.id === slot.id} onClick={() => setActiveSlot(s.id)} className={`flex-1 rounded-md border px-2 py-1 text-sm ${s.id === slot.id ? 'border-accent bg-accent text-white' : 'border-line bg-white hover:border-muted'}`}>
              {s.title.replace(/ shadow$/, '')}
            </button>
          ))}
        </div>
      )}
      {slot.hint && <p className="text-xs text-muted">{slot.hint}</p>}

      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Source kind">
        {KINDS.map((k) => (
          <button key={k.kind} role="radio" aria-checked={source.kind === k.kind} onClick={() => choose(k.kind)} className={`rounded px-2 py-1 text-xs border ${source.kind === k.kind ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:border-muted'}`}>
            {k.label}
          </button>
        ))}
        <input
          ref={fileInput}
          type="file"
          hidden
          accept={pendingKind.current === 'svg' ? '.svg,image/svg+xml' : 'image/*,.heic,.heif,.svg'}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {source.kind === 'shape' && (
        <Dials schema={ShapeSourceSchema} value={source} exclude={['kind']} onChange={(path, v) => update((d) => setSource(d, slot.id, { ...source, [path]: v } as Source))} />
      )}

      {source.kind === 'text' && <TextSourceEditor value={source} onChange={(next) => update((d) => setSource(d, slot.id, next))} />}

      {(source.kind === 'image' || source.kind === 'svg') && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate" title={source.name}>{source.name ?? (source.kind === 'svg' ? 'SVG' : 'Image')}</span>
            <button className="rounded border border-line bg-white px-2 py-0.5 text-xs hover:border-muted" onClick={() => { pendingKind.current = source.kind; fileInput.current?.click(); }}>
              Replace…
            </button>
          </div>
          {source.kind === 'image' && isHeldRemote(source.src) && (
            <div role="alert" className="flex flex-col gap-1 rounded border border-amber-700 px-2 py-1.5 text-xs text-amber-900">
              This design loads its image from {hostOf(heldUrl(source.src))}. Nothing has been fetched yet.
              <button className="self-start rounded border border-line bg-white px-2 py-0.5 hover:border-muted" onClick={() => update((d) => setSource(d, slot.id, { ...source, src: heldUrl(source.src) }))}>
                Load image from {hostOf(heldUrl(source.src))}
              </button>
            </div>
          )}
          {source.kind === 'image' && !isHeldRemote(source.src) && <ImageTuning design={design} slot={slot.id} src={source.src} profileId={profileId} />}
        </div>
      )}

      {source.kind === 'drawing' && (
        <>
          {slotAspect && Math.abs(source.width / source.height - slotAspect) > ASPECT_TOLERANCE && (
            <p className="flex items-center justify-between gap-2 rounded border border-line bg-white px-2 py-1 text-xs text-muted">
              The page's proportions differ from this view of the block.
              <button className="shrink-0 underline hover:text-ink" onClick={() => update((d) => setSource(d, slot.id, { ...source, width: source.height * slotAspect }))}>
                Match the block
              </button>
            </p>
          )}
          <DrawingCanvas value={source} onChange={(next) => update((d) => setSource(d, slot.id, next))} className="w-full" />
          <p className="text-xs text-muted">The page is the frame of this view: what you draw keeps its size and place on it.</p>
        </>
      )}

      <p className={`text-xs ${figureError ? 'text-red-700' : 'text-muted'}`} aria-live="polite">
        {figureError ?? (parts ? `${parts} part${parts > 1 ? 's' : ''}` : '')}
      </p>

      <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line bg-white/60 px-3 py-3 text-center text-xs text-muted hover:border-muted"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) void onFile(f);
        }}
      >
        Drop an image or SVG here, or
        <span className="underline">choose a file</span>
        <input type="file" hidden accept="image/*,.heic,.heif,.svg" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
      </label>
    </div>
  );
}

function ImageTuning({ design, slot, src, profileId }: { design: Design; slot: string; src: string; profileId: string }) {
  const update = useApp((s) => s.update);
  const prepare = prepareParams(design, slot);
  const [preview, setPreview] = useState<MaskPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const minWallPx = PROFILES[profileId].minWallMm * pxPerMm(design, preview);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let live = true;
    geometry()
      .mask(slot, src, prepare, minWallPx)
      .then((p) => live && p && (setPreview(p), setErr(null)))
      .catch((e) => live && setErr((e as Error).message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, JSON.stringify(prepare), slot, Math.round(minWallPx)]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !preview) return;
    c.width = preview.width;
    c.height = preview.height;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(preview.width, preview.height);
    for (let i = 0; i < preview.data.length; i++) {
      const v = preview.data[i];
      const [r, g, b] = v === 2 ? [224, 58, 47] : v === 1 ? [31, 29, 26] : [255, 255, 255];
      img.data.set([r, g, b, 255], i * 4);
    }
    ctx.putImageData(img, 0, 0);
  }, [preview]);

  const thin = preview ? preview.data.some((v) => v === 2) : false;
  return (
    <div className="flex flex-col gap-3">
      <canvas ref={canvas} className="w-full rounded border border-line bg-white [image-rendering:pixelated]" aria-label="Mask preview" />
      <p className="text-xs text-muted" aria-live="polite">
        {err ?? (preview ? `Threshold ${Math.round(preview.threshold)}${prepare.threshold === null ? ' (automatic)' : ''}.` : 'Reading the image…')}
        {thin && <span className="text-red-700"> Red: thinner than {PROFILES[profileId].minWallMm} mm at this size.</span>}
      </p>
      <Dials schema={PrepareSchema} value={prepare} onChange={(path, v) => update((d) => setPrepare(d, slot, path, v))} />
    </div>
  );
}
