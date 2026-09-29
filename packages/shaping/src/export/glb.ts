/**
 * glTF 2.0 binary (GLB) writer, by hand: for viewing and sharing.
 *
 * Viewing frame: metres, +Y up (see `axes.ts`). One mesh and one node per body, each with a PBR
 * material of the body's colour. No normals are written, so viewers shade flat, which is right
 * for faceted solids. The file is a 12-byte header, a JSON chunk padded with spaces, and a BIN
 * chunk padded with zeros, both 4-byte aligned.
 */
import { convertPositions } from './axes.js';
import { bodyNames, hexToRgb, solidBodies, utf8 } from './mesh.js';
import type { ExportOptions } from './types.js';
import type { Body, Model } from '../types.js';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const GLB_VERSION = 2;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const ALIGNMENT = 4;
const TARGET_ARRAY_BUFFER = 34962;
const TARGET_ELEMENT_ARRAY_BUFFER = 34963;
const COMPONENT_FLOAT = 5126;
const COMPONENT_UINT = 5125;
const METALLIC = 0;
const ROUGHNESS = 0.7;

const pad = (n: number) => (ALIGNMENT - (n % ALIGNMENT)) % ALIGNMENT;

/** sRGB channel (0..255) to linear (0..1), as glTF base colours are linear. */
function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function minMax(p: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (p[i + k] < min[k]) min[k] = p[i + k];
      if (p[i + k] > max[k]) max[k] = p[i + k];
    }
  }
  return { min, max };
}

interface Json {
  [k: string]: unknown;
}

export function writeGlb(model: Model, _options: ExportOptions = {}): Uint8Array {
  const bodies: Body[] = solidBodies(model);
  const names = bodyNames(bodies);
  const converted = bodies.map((b) => convertPositions(b.positions, 'view'));
  const binLength = bodies.reduce((s, b, i) => s + converted[i].byteLength + b.indices.byteLength, 0);
  const bin = new Uint8Array(binLength + pad(binLength));
  const binView = new DataView(bin.buffer);

  const bufferViews: Json[] = [];
  const accessors: Json[] = [];
  const meshes: Json[] = [];
  const nodes: Json[] = [];
  const materials: Json[] = [];
  let offset = 0;
  bodies.forEach((b, i) => {
    const p = converted[i];
    for (let k = 0; k < p.length; k++) binView.setFloat32(offset + 4 * k, p[k], true);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: p.byteLength, target: TARGET_ARRAY_BUFFER });
    const posAccessor = accessors.length;
    accessors.push({ bufferView: bufferViews.length - 1, componentType: COMPONENT_FLOAT, count: p.length / 3, type: 'VEC3', ...minMax(p) });
    offset += p.byteLength;
    for (let k = 0; k < b.indices.length; k++) binView.setUint32(offset + 4 * k, b.indices[k], true);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: b.indices.byteLength, target: TARGET_ELEMENT_ARRAY_BUFFER });
    accessors.push({ bufferView: bufferViews.length - 1, componentType: COMPONENT_UINT, count: b.indices.length, type: 'SCALAR' });
    offset += b.indices.byteLength;
    const [r, g, bl] = hexToRgb(b.color).map(srgbToLinear);
    materials.push({ name: names[i], pbrMetallicRoughness: { baseColorFactor: [r, g, bl, 1], metallicFactor: METALLIC, roughnessFactor: ROUGHNESS } });
    meshes.push({ name: names[i], primitives: [{ attributes: { POSITION: posAccessor }, indices: posAccessor + 1, material: i, mode: 4 }] });
    nodes.push({ name: names[i], mesh: i });
  });

  const gltf: Json = {
    asset: { version: '2.0', generator: 'shaping' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  };
  const jsonBytes = utf8(JSON.stringify(gltf));
  const jsonPadded = jsonBytes.length + pad(jsonBytes.length);
  const total = 12 + 8 + jsonPadded + 8 + bin.length;
  const out = new Uint8Array(total);
  out.fill(0x20, 20, 20 + jsonPadded); // JSON chunk padding is spaces
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPadded, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  const binHeader = 20 + jsonPadded;
  view.setUint32(binHeader, bin.length, true);
  view.setUint32(binHeader + 4, CHUNK_BIN, true);
  out.set(bin, binHeader + 8);
  return out;
}
