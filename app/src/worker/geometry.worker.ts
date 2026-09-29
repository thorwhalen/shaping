/**
 * The geometry worker: owns the kernel (Manifold, WebAssembly) and does everything heavy —
 * resolving sources to figures, mask previews, builds and exports — off the page's thread.
 *
 * Superseded requests are dropped: while one job runs, only the latest pending job of each kind
 * (per slot for resolves) is kept, so dragging a dial never queues a backlog of stale builds.
 */
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { buildFromFigures, manifoldKernel, sourceToFigure, type Kernel } from 'shaping';
import { genres } from '../genres';
import { exportModel } from 'shaping/export';
import { decodeImage, makeResolvers, prepareMask } from 'shaping/imaging';
import { fontProvider } from '../fonts/provider';
import { getBlob, isBlobRef } from '../lib/blobs';
import type { Request, Response } from './protocol';

let kernelPromise: Promise<Kernel> | null = null;
const kernel = () => (kernelPromise ??= manifoldKernel({ wasmUrl }));

async function loadBytes(src: string): Promise<{ bytes: Uint8Array; mediaType?: string }> {
  if (isBlobRef(src)) {
    const b = await getBlob(src);
    return { bytes: b.bytes, mediaType: b.mediaType };
  }
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Could not load ${src}: ${res.status}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), mediaType: res.headers.get('content-type') ?? undefined };
}
const resolvers = { ...makeResolvers({ loadBytes }), loadFont: (id: string) => fontProvider().load(id) };

const post = (r: Response, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(r, transfer);

async function handle(req: Request): Promise<void> {
  const k = await kernel();
  switch (req.kind) {
    case 'resolve': {
      const figure = await sourceToFigure(req.source, req.prepare, { kernel: k, resolvers });
      return post({ kind: 'resolve', id: req.id, slot: req.slot, figure });
    }
    case 'mask': {
      const { bytes, mediaType } = await loadBytes(req.src);
      const image = await decodeImage(bytes, mediaType);
      const r = prepareMask(image, req.prepare, { minWidthPx: req.minWidthPx });
      const data = new Uint8Array(r.mask.data.length);
      for (let i = 0; i < data.length; i++) data[i] = r.mask.data[i] ? (r.thin?.data[i] ? 2 : 1) : 0;
      return post({ kind: 'mask', id: req.id, slot: req.slot, preview: { width: r.mask.width, height: r.mask.height, data, threshold: r.threshold } }, [data.buffer]);
    }
    case 'build': {
      const model = buildFromFigures(req.design, req.figures, { kernel: k, genres: genres });
      const transfer = [...model.bodies, ...(model.union ? [model.union] : [])].flatMap((b) => [b.positions.buffer, b.indices.buffer]);
      return post({ kind: 'build', id: req.id, model }, transfer);
    }
    case 'export': {
      const bytes = exportModel(req.model, req.format, req.options);
      return post({ kind: 'export', id: req.id, bytes }, [bytes.buffer]);
    }
  }
}

// Coalescing queue: one job at a time; newer jobs of the same key replace older pending ones.
const pending = new Map<string, Request>();
let running = false;
const keyOf = (r: Request) => (r.kind === 'resolve' || r.kind === 'mask' ? `${r.kind}:${r.slot}` : r.kind === 'export' ? `export:${r.id}` : `build:${r.key}`);

async function pump() {
  if (running) return;
  running = true;
  try {
    while (pending.size) {
      const [key, req] = pending.entries().next().value as [string, Request];
      pending.delete(key);
      try {
        await handle(req);
      } catch (e) {
        post({ kind: 'error', id: req.id, request: req.kind, message: (e as Error).message ?? String(e) });
      }
    }
  } finally {
    running = false;
  }
}

self.onmessage = (ev: MessageEvent<Request>) => {
  const key = keyOf(ev.data);
  const replaced = pending.get(key);
  if (replaced) post({ kind: 'dropped', id: replaced.id });
  pending.set(key, ev.data);
  void pump();
};

