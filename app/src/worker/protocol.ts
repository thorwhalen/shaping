/**
 * Messages between the page and the geometry worker. Everything is plain data: designs as JSON,
 * figures as polygons, models as typed arrays (transferred, not copied).
 */
import type { Design, Figure, Model, PrepareParams, Source } from 'shaping';

export type Request =
  | { kind: 'resolve'; id: number; slot: string; source: Source; prepare: PrepareParams }
  | { kind: 'mask'; id: number; slot: string; src: string; prepare: PrepareParams; minWidthPx?: number }
  | { kind: 'build'; id: number; key: string; design: Design; figures: Record<string, Figure> }
  | { kind: 'export'; id: number; model: Model; format: string; options: Record<string, unknown> };

export interface MaskPreview {
  width: number;
  height: number;
  /** One byte per pixel: 0 background, 1 foreground, 2 foreground thinner than the minimum wall. */
  data: Uint8Array;
  threshold: number;
}

export type Response =
  | { kind: 'resolve'; id: number; slot: string; figure: Figure }
  | { kind: 'mask'; id: number; slot: string; preview: MaskPreview }
  | { kind: 'build'; id: number; model: Model }
  | { kind: 'export'; id: number; bytes: Uint8Array }
  | { kind: 'error'; id: number; request: Request['kind']; message: string }
  /** The request was replaced by a newer one of the same kind before it ran. */
  | { kind: 'dropped'; id: number };
