/**
 * OBJ writer: a zip holding `model.obj` and `model.mtl`, one object and one `usemtl` group per
 * body. Millimetres, +Z up (OBJ has no unit field). Written by hand because common OBJ writers
 * emit no materials.
 */
import { convertPositions } from './axes.js';
import { bodyNames, fmt, hexToRgb, solidBodies, utf8 } from './mesh.js';
import type { ExportOptions } from './types.js';
import type { Model } from '../types.js';
import { zipFiles } from './zip.js';

export const OBJ_FILE = 'model.obj';
export const MTL_FILE = 'model.mtl';
/** Decimals for diffuse colour components in the MTL. */
const MTL_DECIMALS = 4;

/** The `model.obj` and `model.mtl` texts. */
export function objTexts(model: Model): { obj: string; mtl: string } {
  const bodies = solidBodies(model);
  const names = bodyNames(bodies);
  const obj: string[] = ['# shaping OBJ, units: mm, +Z up', `mtllib ${MTL_FILE}`];
  const mtl: string[] = ['# shaping materials'];
  let base = 1; // OBJ indices are 1-based and global
  bodies.forEach((b, i) => {
    const p = convertPositions(b.positions, 'print');
    obj.push(`o ${names[i]}`, `usemtl ${names[i]}`);
    for (let k = 0; k < p.length; k += 3) obj.push(`v ${fmt(p[k])} ${fmt(p[k + 1])} ${fmt(p[k + 2])}`);
    for (let k = 0; k < b.indices.length; k += 3) obj.push(`f ${b.indices[k] + base} ${b.indices[k + 1] + base} ${b.indices[k + 2] + base}`);
    base += p.length / 3;
    const [r, g, bl] = hexToRgb(b.color).map((c) => fmt(c / 255, MTL_DECIMALS));
    mtl.push(`newmtl ${names[i]}`, `Kd ${r} ${g} ${bl}`, 'Ka 0 0 0', 'Ks 0 0 0', 'd 1', '');
  });
  return { obj: obj.join('\n') + '\n', mtl: mtl.join('\n') + '\n' };
}

export function writeObj(model: Model, _options: ExportOptions = {}): Uint8Array {
  const { obj, mtl } = objTexts(model);
  return zipFiles({ [OBJ_FILE]: utf8(obj), [MTL_FILE]: utf8(mtl) });
}
