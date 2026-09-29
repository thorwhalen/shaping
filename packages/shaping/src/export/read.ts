/**
 * Readers for what the exporters write: 3MF, binary STL, PLY, OBJ (zip) and GLB back to
 * `{ positions, indices }` per object, plus `checkClosedMesh`. Used by the read-back tests
 * (every exporter is tested by parsing its own output) and useful for import later.
 *
 * The readers are deliberately narrow: they read this package's own dialect, not arbitrary files.
 */
import { unzipSync } from 'fflate';

export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface NamedMesh extends MeshData {
  name: string;
  /** `#rrggbb`, when the format carries a colour for the object. */
  color?: string;
}

const decoder = new TextDecoder();

/** Default distance under which two vertices are the same vertex. */
export const DEFAULT_WELD_TOLERANCE_MM = 1e-4;

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');

/** Result of `read3mf`. */
export interface ThreeMfContents {
  unit: string;
  objects: NamedMesh[];
  /** Object ids listed in `<build>`, in order. */
  buildItems: number[];
}

/** Parse a 3MF written by `write3mf`. */
export function read3mf(bytes: Uint8Array): ThreeMfContents {
  const files = unzipSync(bytes);
  const entry = files['3D/3dmodel.model'];
  if (!entry) throw new Error('Not a 3MF: 3D/3dmodel.model is missing.');
  const xml = decoder.decode(entry);
  const unit = /<model[^>]*\sunit="([^"]*)"/.exec(xml)?.[1] ?? 'millimeter';
  const colors = [...xml.matchAll(/<base\s[^>]*displaycolor="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1].toLowerCase());
  const objects: NamedMesh[] = [];
  for (const m of xml.matchAll(/<object\s([^>]*)>([\s\S]*?)<\/object>/g)) {
    const attrs = m[1];
    const pindex = /pindex="(\d+)"/.exec(attrs)?.[1];
    const verts = [...m[2].matchAll(/<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g)].flatMap((v) => [Number(v[1]), Number(v[2]), Number(v[3])]);
    const tris = [...m[2].matchAll(/<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g)].flatMap((t) => [Number(t[1]), Number(t[2]), Number(t[3])]);
    objects.push({
      name: /name="([^"]*)"/.exec(attrs)?.[1] ?? '',
      color: pindex !== undefined ? colors[Number(pindex)] : undefined,
      positions: Float32Array.from(verts),
      indices: Uint32Array.from(tris),
    });
  }
  const buildItems = [...xml.matchAll(/<item\s+objectid="(\d+)"/g)].map((m) => Number(m[1]));
  return { unit, objects, buildItems };
}

/** Parse a binary STL (triangle soup: vertices are not shared, weld before checking). */
export function readStl(bytes: Uint8Array): MeshData & { header: string } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  if (bytes.length !== 84 + count * 50) throw new Error(`STL size ${bytes.length} does not match ${count} triangles.`);
  const positions = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 9; k++) positions[9 * t + k] = view.getFloat32(84 + 50 * t + 12 + 4 * k, true);
  }
  const indices = Uint32Array.from({ length: count * 3 }, (_, i) => i);
  return { header: decoder.decode(bytes.subarray(0, 80)).replace(/\0+$/, ''), positions, indices };
}

/** Parse a binary little-endian PLY with float xyz, uchar rgb, and `list uchar int` faces. */
export function readPly(bytes: Uint8Array): MeshData & { colors: Uint8Array } {
  const marker = 'end_header\n';
  const text = decoder.decode(bytes.subarray(0, Math.min(bytes.length, 1024)));
  const end = text.indexOf(marker);
  if (end < 0 || !text.startsWith('ply')) throw new Error('Not a PLY file.');
  const header = text.slice(0, end);
  if (!/format binary_little_endian 1\.0/.test(header)) throw new Error('Only binary little-endian PLY is supported.');
  const nv = Number(/element vertex (\d+)/.exec(header)?.[1]);
  const nf = Number(/element face (\d+)/.exec(header)?.[1]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = end + marker.length;
  const positions = new Float32Array(nv * 3);
  const colors = new Uint8Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    for (let k = 0; k < 3; k++) positions[3 * i + k] = view.getFloat32(o + 4 * k, true);
    for (let k = 0; k < 3; k++) colors[3 * i + k] = view.getUint8(o + 12 + k);
    o += 15;
  }
  const indices = new Uint32Array(nf * 3);
  for (let f = 0; f < nf; f++) {
    if (view.getUint8(o) !== 3) throw new Error('Only triangle faces are supported.');
    for (let k = 0; k < 3; k++) indices[3 * f + k] = view.getInt32(o + 1 + 4 * k, true);
    o += 13;
  }
  return { positions, indices, colors };
}

/** Parse the zip written by `writeObj`: one mesh per `o`, its colour from the `usemtl` material's `Kd`. */
export function readObj(bytes: Uint8Array): NamedMesh[] {
  const files = unzipSync(bytes);
  const obj = files['model.obj'];
  const mtl = files['model.mtl'];
  if (!obj || !mtl) throw new Error('Not an OBJ package: model.obj or model.mtl is missing.');
  const kd = new Map<string, string>();
  let current = '';
  for (const line of decoder.decode(mtl).split('\n')) {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'newmtl') current = t[1];
    if (t[0] === 'Kd') kd.set(current, `#${[t[1], t[2], t[3]].map((c) => hex2(Number(c) * 255)).join('')}`);
  }
  const all: number[] = [];
  const meshes: { name: string; material: string; faces: number[] }[] = [];
  for (const line of decoder.decode(obj).split('\n')) {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'v') all.push(Number(t[1]), Number(t[2]), Number(t[3]));
    else if (t[0] === 'o') meshes.push({ name: t[1], material: '', faces: [] });
    else if (t[0] === 'usemtl') meshes[meshes.length - 1].material = t[1];
    else if (t[0] === 'f') meshes[meshes.length - 1].faces.push(...t.slice(1).map((i) => Number(i.split('/')[0]) - 1));
  }
  return meshes.map((m) => {
    const used = [...new Set(m.faces)].sort((a, b) => a - b);
    const remap = new Map(used.map((v, i) => [v, i]));
    return {
      name: m.name,
      color: kd.get(m.material),
      positions: Float32Array.from(used.flatMap((v) => [all[3 * v], all[3 * v + 1], all[3 * v + 2]])),
      indices: Uint32Array.from(m.faces.map((v) => remap.get(v)!)),
    };
  });
}

/** Result of `readGlb`. */
export interface GlbContents {
  version: number;
  /** Total length from the header. */
  length: number;
  json: any;
  bin: Uint8Array;
  meshes: NamedMesh[];
}

/** Parse a GLB written by `writeGlb`, checking header and chunk lengths. */
export function readGlb(bytes: Uint8Array): GlbContents {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB: bad magic.');
  const length = view.getUint32(8, true);
  if (length !== bytes.length) throw new Error(`GLB header length ${length} != file length ${bytes.length}.`);
  const jsonLen = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error('GLB: first chunk is not JSON.');
  const json = JSON.parse(decoder.decode(bytes.subarray(20, 20 + jsonLen)));
  const binAt = 20 + jsonLen;
  const binLen = view.getUint32(binAt, true);
  if (view.getUint32(binAt + 4, true) !== 0x004e4942) throw new Error('GLB: second chunk is not BIN.');
  if (binAt + 8 + binLen !== bytes.length) throw new Error('GLB: chunk lengths do not add up to the file length.');
  const bin = bytes.slice(binAt + 8, binAt + 8 + binLen);
  const binView = new DataView(bin.buffer);
  const read = (accessorIndex: number, component: 'f' | 'u') => {
    const a = json.accessors[accessorIndex];
    const bv = json.bufferViews[a.bufferView];
    const n = a.count * (a.type === 'VEC3' ? 3 : 1);
    return Array.from({ length: n }, (_, i) => (component === 'f' ? binView.getFloat32(bv.byteOffset + 4 * i, true) : binView.getUint32(bv.byteOffset + 4 * i, true)));
  };
  const meshes: NamedMesh[] = json.meshes.map((m: any) => {
    const prim = m.primitives[0];
    const [r, g, b] = json.materials[prim.material].pbrMetallicRoughness.baseColorFactor as number[];
    const toSrgb = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
    return {
      name: m.name,
      color: `#${[r, g, b].map((c) => hex2(toSrgb(c))).join('')}`,
      positions: Float32Array.from(read(prim.attributes.POSITION, 'f')),
      indices: Uint32Array.from(read(prim.indices, 'u')),
    };
  });
  return { version: view.getUint32(4, true), length, json, bin, meshes };
}

/** What `checkClosedMesh` found. */
export interface ClosedMeshReport {
  vertices: number;
  triangles: number;
  /** Triangles with fewer than three distinct vertices after welding. */
  degenerate: number;
  /** Directed edges with no opposite partner (holes in the surface). */
  openEdges: number;
  /** Directed edges used more than once (non-manifold, or inconsistent winding). */
  repeatedEdges: number;
  /** Every undirected edge used exactly twice, once in each direction. */
  closed: boolean;
}

/**
 * Weld vertices closer than `weldTolerance` and check that every undirected edge is used
 * exactly twice, once in each direction (a closed, consistently oriented surface).
 */
export function checkClosedMesh(mesh: MeshData, weldTolerance = DEFAULT_WELD_TOLERANCE_MM): ClosedMeshReport {
  const ids = new Map<string, number>();
  const remap: number[] = [];
  const n = mesh.positions.length / 3;
  for (let i = 0; i < n; i++) {
    const key = [0, 1, 2].map((k) => Math.round(mesh.positions[3 * i + k] / weldTolerance)).join(',');
    if (!ids.has(key)) ids.set(key, ids.size);
    remap.push(ids.get(key)!);
  }
  const directed = new Map<string, number>();
  let degenerate = 0;
  const triangles = mesh.indices.length / 3;
  for (let t = 0; t < triangles; t++) {
    const v = [0, 1, 2].map((k) => remap[mesh.indices[3 * t + k]]);
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) {
      degenerate++;
      continue;
    }
    for (let k = 0; k < 3; k++) {
      const key = `${v[k]}>${v[(k + 1) % 3]}`;
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
  }
  let openEdges = 0;
  let repeatedEdges = 0;
  for (const [key, count] of directed) {
    const [a, b] = key.split('>');
    if (count > 1) repeatedEdges++;
    if (!directed.has(`${b}>${a}`)) openEdges++;
  }
  return { vertices: ids.size, triangles, degenerate, openEdges, repeatedEdges, closed: openEdges === 0 && repeatedEdges === 0 && triangles > 0 };
}
