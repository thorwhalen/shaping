/**
 * The page's side of the geometry worker: promise-returning calls, where a newer call of the same
 * kind (and slot) supersedes an older one — the older promise resolves to `null` and is ignored.
 */
import type { Design, Figure, Model, PrepareParams, Source } from 'shaping';
import type { MaskPreview, Request, Response } from './protocol';

type Waiter = { key: string; resolve: (r: Response) => void };

export class GeometryClient {
  private worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private waiting = new Map<number, Waiter>();
  private latest = new Map<string, number>();

  constructor() {
    this.worker.onmessage = (ev: MessageEvent<Response>) => {
      const w = this.waiting.get(ev.data.id);
      if (!w) return;
      this.waiting.delete(ev.data.id);
      w.resolve(ev.data);
    };
  }

  private call<R extends Response>(req: Omit<Request, 'id'>, key: string): Promise<R | null> {
    const id = this.nextId++;
    this.latest.set(key, id);
    // Resolve superseded callers now, with null.
    for (const [otherId, w] of this.waiting) if (w.key === key && otherId !== id) { this.waiting.delete(otherId); w.resolve(null as never); }
    return new Promise((resolve, reject) => {
      this.waiting.set(id, {
        key,
        resolve: (r) => {
          if (r === null) return resolve(null);
          if (this.latest.get(key) !== id) return resolve(null);
          if (r.kind === 'error') return reject(new Error(r.message));
          resolve(r as R);
        },
      });
      this.worker.postMessage({ ...req, id } as Request);
    });
  }

  async resolve(slot: string, source: Source, prepare: PrepareParams): Promise<Figure | null> {
    const r = await this.call<Extract<Response, { kind: 'resolve' }>>({ kind: 'resolve', slot, source, prepare } as Omit<Request, 'id'>, `resolve:${slot}`);
    return r?.figure ?? null;
  }

  async mask(slot: string, src: string, prepare: PrepareParams, minWidthPx?: number): Promise<MaskPreview | null> {
    const r = await this.call<Extract<Response, { kind: 'mask' }>>({ kind: 'mask', slot, src, prepare, minWidthPx } as Omit<Request, 'id'>, `mask:${slot}`);
    return r?.preview ?? null;
  }

  async build(design: Design, figures: Record<string, Figure>, key = 'build'): Promise<Model | null> {
    const r = await this.call<Extract<Response, { kind: 'build' }>>({ kind: 'build', key, design, figures } as Omit<Request, 'id'>, key);
    return r?.model ?? null;
  }

  async export(model: Model, format: string, options: Record<string, unknown> = {}): Promise<Uint8Array> {
    const r = await this.call<Extract<Response, { kind: 'export' }>>({ kind: 'export', model, format, options } as Omit<Request, 'id'>, `export:${this.nextId}`);
    if (!r) throw new Error('Export was cancelled.');
    return r.bytes;
  }
}

let client: GeometryClient | null = null;
export const geometry = () => (client ??= new GeometryClient());
