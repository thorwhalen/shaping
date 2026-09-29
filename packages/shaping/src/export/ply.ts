/**
 * Binary little-endian PLY writer with vertex colours. Bodies are merged into one mesh, each
 * vertex carrying its body's colour. Printing frame (mm, +Z up), see `axes.ts` for why.
 */
import { convertPositions } from './axes.js';
import { mergeBodies, solidBodies, utf8 } from './mesh.js';
import type { ExportOptions } from './types.js';
import type { Model } from '../types.js';

const VERTEX_BYTES = 15; // 3 x float32 + 3 x uint8
const FACE_BYTES = 13; // uint8 count + 3 x int32

export function writePly(model: Model, _options: ExportOptions = {}): Uint8Array {
  const { positions, indices, colors } = mergeBodies(solidBodies(model));
  const p = convertPositions(positions, 'print');
  const nv = p.length / 3;
  const nf = indices.length / 3;
  const header = utf8(
    [
      'ply',
      'format binary_little_endian 1.0',
      'comment shaping, units: mm',
      `element vertex ${nv}`,
      'property float x',
      'property float y',
      'property float z',
      'property uchar red',
      'property uchar green',
      'property uchar blue',
      `element face ${nf}`,
      'property list uchar int vertex_indices',
      'end_header',
      '',
    ].join('\n'),
  );
  const out = new Uint8Array(header.length + nv * VERTEX_BYTES + nf * FACE_BYTES);
  out.set(header);
  const view = new DataView(out.buffer);
  let o = header.length;
  for (let i = 0; i < nv; i++) {
    for (let k = 0; k < 3; k++) view.setFloat32(o + 4 * k, p[3 * i + k], true);
    for (let k = 0; k < 3; k++) view.setUint8(o + 12 + k, colors[3 * i + k]);
    o += VERTEX_BYTES;
  }
  for (let f = 0; f < nf; f++) {
    view.setUint8(o, 3);
    for (let k = 0; k < 3; k++) view.setInt32(o + 1 + 4 * k, indices[3 * f + k], true);
    o += FACE_BYTES;
  }
  return out;
}
