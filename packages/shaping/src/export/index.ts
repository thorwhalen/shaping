/**
 * `shaping/export`: what leaves shaping as a file.
 *
 * ```ts
 * import { exportModel, exportFileName, exporters } from 'shaping/export';
 * const bytes = exportModel(model, '3mf');
 * const name = exportFileName('triplet', exporters.stl, 50);   // 'triplet-50mm.stl'
 * ```
 *
 * `exporters` is a plain table keyed by id; the export menu is built from its rows. Every
 * exporter is pure and synchronous. Printing formats are millimetres with +Z up; GLB is metres
 * with +Y up (`axes.ts`). Nothing here imports three.js or React.
 */
import { writeDxf } from './dxf.js';
import { writeGlb } from './glb.js';
import { writeObj } from './obj.js';
import { writePly } from './ply.js';
import { writePrintPack } from './printpack.js';
import { writeStl } from './stl.js';
import { writeSvg } from './svg.js';
import { write3mf } from './threemf.js';
import { DEFAULT_KERF_MM } from './layout2d.js';
import type { Exporter, ExportOptions } from './types.js';
import type { Model } from '../types.js';

export type { Exporter, ExporterCapabilities, ExportOptions, Operation, OperationColors, RegionRole } from './types.js';
export type { AxisConvention } from './axes.js';
export { convertPositions } from './axes.js';
export { offsetPolygon } from './offset.js';

/** The id of the exporter to use when the caller has no preference: 3MF, for printing. */
export const DEFAULT_EXPORTER_ID = '3mf';

const solid = { color: true, units: true, bodies: true };

/** The exporters, keyed by id. Adding a format is adding a row. */
export const exporters: Record<string, Exporter> = {
  '3mf': { id: '3mf', title: '3MF (printing)', extension: '3mf', mediaType: 'model/3mf', kind: '3d', carries: solid, write: write3mf },
  stl: { id: 'stl', title: 'STL (binary)', extension: 'stl', mediaType: 'model/stl', kind: '3d', carries: { color: false, units: false, bodies: false }, write: writeStl },
  glb: { id: 'glb', title: 'GLB (viewing)', extension: 'glb', mediaType: 'model/gltf-binary', kind: '3d', carries: solid, write: writeGlb },
  ply: { id: 'ply', title: 'PLY (vertex colours)', extension: 'ply', mediaType: 'application/x-ply', kind: '3d', carries: { color: true, units: false, bodies: false }, write: writePly },
  obj: { id: 'obj', title: 'OBJ + MTL (zip)', extension: 'zip', mediaType: 'application/zip', kind: '3d', carries: { color: true, units: false, bodies: true }, write: writeObj },
  svg: { id: 'svg', title: 'SVG (laser profiles)', extension: 'svg', mediaType: 'image/svg+xml', kind: '2d', carries: { color: true, units: true, bodies: true }, write: writeSvg },
  dxf: { id: 'dxf', title: 'DXF (laser profiles)', extension: 'dxf', mediaType: 'image/vnd.dxf', kind: '2d', carries: { color: false, units: true, bodies: true }, write: writeDxf },
  'print-pack': { id: 'print-pack', title: 'Print pack (zip)', extension: 'zip', mediaType: 'application/zip', kind: '3d', carries: solid, write: writePrintPack },
};

/** Write `model` with the exporter `id`. Throws, listing the ids, for an unknown id. */
export function exportModel(model: Model, id: string, options: ExportOptions = {}): Uint8Array {
  const exporter = Object.hasOwn(exporters, id) ? exporters[id] : undefined;
  if (!exporter) throw new Error(`Unknown export format "${id}". Available: ${Object.keys(exporters).join(', ')}`);
  return exporter.write(model, options);
}

/** A file-name-safe slug of a title. */
function slug(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
}

/** A number for a file name: no trailing zeros, `.` kept. */
const nameNumber = (n: number) => String(Number(n.toFixed(3)));

/**
 * The file name for an export. Formats with no units (STL, PLY, OBJ) get the size in mm in the
 * name; 2D files get the kerf when it is set: `triplet-50mm.stl`, `triplet-kerf0.2mm.svg`.
 */
export function exportFileName(title: string, exporter: Exporter, sizeMm?: number, options: ExportOptions = {}): string {
  const parts = [slug(title)];
  if (exporter.kind === '3d' && !exporter.carries.units && sizeMm !== undefined) parts.push(`${nameNumber(sizeMm)}mm`);
  const kerf = options.kerf ?? DEFAULT_KERF_MM;
  if (exporter.kind === '2d' && kerf > 0) parts.push(`kerf${nameNumber(kerf)}mm`);
  return `${parts.join('-')}.${exporter.extension}`;
}
