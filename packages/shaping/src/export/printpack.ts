/**
 * Print pack: one zip with everything needed to make the object. The 3MF and STL for printing,
 * the SVG profiles for a laser cutter (when the model has regions to write), and a README with
 * the recipe. There is no STEP: a STEP made from triangles is an STL in substance, so "CAD
 * export" here means the profiles plus the recipe (import, extrude, intersect).
 */
import { boundsOf, fmt, solidBodies, utf8 } from './mesh.js';
import { layoutRegions } from './layout2d.js';
import { writeStl } from './stl.js';
import { writeSvg } from './svg.js';
import { write3mf } from './threemf.js';
import type { ExportOptions } from './types.js';
import type { Model } from '../types.js';
import { zipFiles } from './zip.js';

export const PACK_FILES = { threeMf: 'model.3mf', stl: 'model.stl', svg: 'profiles.svg', readme: 'README.txt' } as const;
const SIZE_DECIMALS = 2;

function hasProfiles(model: Model, options: ExportOptions): boolean {
  try {
    layoutRegions(model.diagnostics.regions, options);
    return true;
  } catch {
    return false;
  }
}

/** The README text: what is in the pack, and how to use it. */
export function packReadme(model: Model, withSvg: boolean): string {
  const { min, max } = boundsOf(solidBodies(model));
  const size = [0, 1, 2].map((k) => fmt(max[k] - min[k], SIZE_DECIMALS)).join(' x ');
  return [
    'shaping print pack',
    '',
    `Object size: ${size} mm (x, y, z). All files are in millimetres, +Z up.`,
    '',
    'Files',
    `  ${PACK_FILES.threeMf}  for printing: millimetres, one object per part, colours kept. Open it in your slicer.`,
    `  ${PACK_FILES.stl}  the same solid without colour or units; the size above is in millimetres.`,
    withSvg
      ? `  ${PACK_FILES.svg}  the flat profiles for a laser cutter or CAD: millimetres, red hairline paths are cuts.`
      : '  (no flat profiles: this model has none to write)',
    '',
    'Recipe, to rebuild the solid in CAD',
    '  1. Import the profiles (SVG or DXF) onto the planes they came from.',
    '  2. Extrude each profile through the whole object.',
    '  3. Intersect the extrusions. What remains casts each profile as its shadow.',
    '',
    'Faceted STEP is not offered: it would be the STL in another wrapper.',
    '',
  ].join('\n');
}

export function writePrintPack(model: Model, options: ExportOptions = {}): Uint8Array {
  const withSvg = hasProfiles(model, options);
  const files: Record<string, Uint8Array> = {
    [PACK_FILES.threeMf]: write3mf(model, options),
    [PACK_FILES.stl]: writeStl(model, options),
  };
  if (withSvg) files[PACK_FILES.svg] = writeSvg(model, options);
  files[PACK_FILES.readme] = utf8(packReadme(model, withSvg));
  return zipFiles(files);
}
