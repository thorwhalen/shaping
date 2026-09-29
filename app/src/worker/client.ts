/**
 * The page's side of the geometry worker: promise-returning calls. A request the worker replaced
 * with a newer one of the same kind before running it resolves to `null`; every request that ran
 * resolves with its result, in the order the worker ran them — so while a dial is dragged, each
 * finished intermediate result still arrives (live feedback) and the last one arrives last.
 */
import type { Design, Figure, Model, PrepareParams, Source } from 'shaping';
import type { MaskPreview, Request, Response } from './protocol';

export class GeometryClient {
  private worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private waiting = new Map<number, (r: Response) => void>();

  constructor() {
    this.worker.onmessage = (ev: MessageEvent<Response>) => {
      const w = this.waiting.get(ev.data.id);
      if (!w) return;
      this.waiting.delete(ev.data.id);
      w(ev.data);
    };
  }

  private call<R extends Response>(req: Omit<Request, 'id'>): Promise<R | null> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, (r) => {
        if (r.kind === 'dropped') return resolve(null);
        if (r.kind === 'error') return reject(new Error(r.message));
        resolve(r as R);
      });
      this.worker.postMessage({ ...req, id } as Request);
    });
  }

  async resolve(slot: string, source: Source, prepare: PrepareParams): Promise<Figure | null> {
    const r = await this.call<Extract<Response, { kind: 'resolve' }>>({ kind: 'resolve', slot, source, prepare } as Omit<Request, 'id'>);
    return r?.figure ?? null;
  }

  async mask(slot: string, src: string, prepare: PrepareParams, minWidthPx?: number): Promise<MaskPreview | null> {
    const r = await this.call<Extract<Response, { kind: 'mask' }>>({ kind: 'mask', slot, src, prepare, minWidthPx } as Omit<Request, 'id'>);
    return r?.preview ?? null;
  }

  /** Builds with the same `key` supersede each other; use distinct keys for independent streams. */
  async build(design: Design, figures: Record<string, Figure>, key = 'build'): Promise<Model | null> {
    const r = await this.call<Extract<Response, { kind: 'build' }>>({ kind: 'build', key, design, figures } as Omit<Request, 'id'>);
    return r?.model ?? null;
  }

  async export(model: Model, format: string, options: Record<string, unknown> = {}): Promise<Uint8Array> {
    const r = await this.call<Extract<Response, { kind: 'export' }>>({ kind: 'export', model, format, options } as Omit<Request, 'id'>);
    if (!r) throw new Error('Export was cancelled.');
    return r.bytes;
  }
}

let client: GeometryClient | null = null;
export const geometry = () => (client ??= new GeometryClient());
