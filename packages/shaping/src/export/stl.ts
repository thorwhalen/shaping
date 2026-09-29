/**
 * Binary STL writer: the universal fallback. It has no units and no colour, so the header says
 * millimetres and the size, and callers put the size in the file name.
 *
 * Layout: 80-byte header, uint32 triangle count, then per triangle 12 float32 (normal, three
 * vertices) and a uint16 attribute count of zero. Bodies are concatenated.
 */
import { convertPositions } from './axes.js';
import { boundsOf, fmt, singleSolid, solidBodies, triangleNormal, utf8 } from './mesh.js';
import type { ExportOptions } from './types.js';
import type { Model } from '../types.js';

const HEADER_BYTES = 80;
const TRIANGLE_BYTES = 50;
/** Decimals for sizes quoted in the header. */
const HEADER_DECIMALS = 2;

/** Header text: names the writer, the unit, and the size of the bounding box. */
export function stlHeaderText(model: Model): string {
  const { min, max } = boundsOf(solidBodies(model));
  const size = [0, 1, 2].map((k) => fmt(max[k] - min[k], HEADER_DECIMALS)).join(' x ');
  return `shaping binary STL, units: mm, size: ${size} mm`;
}

export function writeStl(model: Model, _options: ExportOptions = {}): Uint8Array {
  const solid = singleSolid(model);
  const bodies = [{ positions: solid.positions, indices: solid.indices }];
  const triangles = bodies.reduce((s, b) => s + b.indices.length / 3, 0);
  const out = new Uint8Array(HEADER_BYTES + 4 + triangles * TRIANGLE_BYTES);
  out.set(utf8(stlHeaderText(model)).subarray(0, HEADER_BYTES));
  const view = new DataView(out.buffer);
  view.setUint32(HEADER_BYTES, triangles, true);
  let o = HEADER_BYTES + 4;
  for (const body of bodies) {
    const p = convertPositions(body.positions, 'print');
    for (let t = 0; t < body.indices.length / 3; t++) {
      const n = triangleNormal(p, body.indices, t);
      for (let k = 0; k < 3; k++) view.setFloat32(o + 4 * k, n[k], true);
      for (let v = 0; v < 3; v++) {
        const at = body.indices[3 * t + v] * 3;
        for (let k = 0; k < 3; k++) view.setFloat32(o + 12 + 12 * v + 4 * k, p[at + k], true);
      }
      o += TRIANGLE_BYTES;
    }
  }
  return out;
}
