/**
 * Small mesh and text helpers shared by the exporters: body selection, colour parsing, bounds,
 * triangle normals, merging, number formatting, and stable names.
 */
import type { Body, Model } from '../types.js';

/** Decimal places written for coordinates in text formats (1e-6 mm). */
export const COORD_DECIMALS = 6;

/** Colour given to a body whose colour cannot be parsed. */
export const FALLBACK_COLOR = '#b0b0b0';

/** Bodies that have at least one triangle. Empty bodies are never written. */
export function solidBodies(model: Model): Body[] {
  return model.bodies.filter((b) => b.indices.length >= 3 && b.positions.length >= 9);
}

/** Normalise `#rgb` or `#rrggbb` to lower-case `#rrggbb`. */
export function normalizeHex(color: string): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return FALLBACK_COLOR;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
}

/** `#rrggbb` -> `[r, g, b]` in 0..255. */
export function hexToRgb(color: string): [number, number, number] {
  const h = normalizeHex(color).slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** A number as text with at most `decimals` decimals and no trailing zeros. */
export function fmt(n: number, decimals = COORD_DECIMALS): string {
  const s = n.toFixed(decimals);
  const t = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  return t === '-0' ? '0' : t;
}

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

/** Bounding box of the given bodies. Zero box when there are none. */
export function boundsOf(bodies: Body[]): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const b of bodies) {
    for (let i = 0; i < b.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = b.positions[i + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
    }
  }
  return bodies.length ? { min, max } : { min: [0, 0, 0], max: [0, 0, 0] };
}

/** Unit normal of triangle `t` of a mesh (zero vector for a degenerate triangle). */
export function triangleNormal(positions: ArrayLike<number>, indices: ArrayLike<number>, t: number): [number, number, number] {
  const a = indices[3 * t] * 3;
  const b = indices[3 * t + 1] * 3;
  const c = indices[3 * t + 2] * 3;
  const ux = positions[b] - positions[a];
  const uy = positions[b + 1] - positions[a + 1];
  const uz = positions[b + 2] - positions[a + 2];
  const vx = positions[c] - positions[a];
  const vy = positions[c + 1] - positions[a + 1];
  const vz = positions[c + 2] - positions[a + 2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  return len > 0 ? [nx / len, ny / len, nz / len] : [0, 0, 0];
}

/** Concatenate bodies into one indexed mesh, with a per-vertex colour. */
export function mergeBodies(bodies: Body[]): { positions: Float32Array; indices: Uint32Array; colors: Uint8Array } {
  const nv = bodies.reduce((s, b) => s + b.positions.length / 3, 0);
  const ni = bodies.reduce((s, b) => s + b.indices.length, 0);
  const positions = new Float32Array(nv * 3);
  const indices = new Uint32Array(ni);
  const colors = new Uint8Array(nv * 3);
  let vo = 0;
  let io = 0;
  for (const b of bodies) {
    const n = b.positions.length / 3;
    positions.set(b.positions, vo * 3);
    for (let i = 0; i < b.indices.length; i++) indices[io + i] = b.indices[i] + vo;
    const rgb = hexToRgb(b.color);
    for (let i = 0; i < n; i++) colors.set(rgb, (vo + i) * 3);
    vo += n;
    io += b.indices.length;
  }
  return { positions, indices, colors };
}

/** A name safe for XML attributes, OBJ groups and file names: `[A-Za-z0-9_-]`, never empty. */
export function safeName(text: string, fallback: string): string {
  const s = text.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return s || fallback;
}

/** Names for bodies: their part ids made safe and unique. */
export function bodyNames(bodies: Body[]): string[] {
  const seen = new Map<string, number>();
  return bodies.map((b, i) => {
    const base = safeName(b.partId, `body${i + 1}`);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}_${n + 1}` : base;
  });
}

const encoder = new TextEncoder();

/** UTF-8 bytes of a string. */
export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

/** Escape text for XML content and attribute values. */
export function xmlEscape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}
