/**
 * DXF writer for laser cutting and engraving: ASCII, AutoCAD R12 (AC1009) compatible.
 *
 * Same layout as the SVG (regions left to right with a gap), y up as DXF expects. Every outline
 * is a closed 2D POLYLINE (flag 70 = 1) with VERTEX records and a SEQEND; R12 has no LWPOLYLINE.
 * Units are millimetres (`$INSUNITS` = 4). One layer per operation (CUT, SCORE, ENGRAVE); the
 * requested operation's layer receives the geometry, and the layer table carries all three with
 * the AutoCAD colour numbers matching the default red / blue / black.
 */
import { fmt, utf8 } from './mesh.js';
import { layoutRegions, resolveOptions2d } from './layout2d.js';
import type { ExportOptions, Operation } from './types.js';
import type { Model, Ring } from '../types.js';

/** DXF `$INSUNITS` code for millimetres. */
const INSUNITS_MM = 4;
/** Decimals for DXF coordinates (1e-4 mm). */
const DXF_DECIMALS = 4;
/** Polyline flag: closed. */
const POLYLINE_CLOSED = 1;

export const DXF_LAYERS: Record<Operation, { name: string; aci: number }> = {
  cut: { name: 'CUT', aci: 1 },
  score: { name: 'SCORE', aci: 5 },
  engrave: { name: 'ENGRAVE', aci: 7 },
};

const pair = (code: number, value: string | number) => `${code}\r\n${value}\r\n`;

function polyline(ring: Ring, layer: string): string {
  const head = pair(0, 'POLYLINE') + pair(8, layer) + pair(66, 1) + pair(10, 0) + pair(20, 0) + pair(30, 0) + pair(70, POLYLINE_CLOSED);
  const vertices = ring.map(([x, y]) => pair(0, 'VERTEX') + pair(8, layer) + pair(10, fmt(x, DXF_DECIMALS)) + pair(20, fmt(y, DXF_DECIMALS)) + pair(30, 0)).join('');
  return head + vertices + pair(0, 'SEQEND') + pair(8, layer);
}

function layerTable(): string {
  const entries = Object.values(DXF_LAYERS).map((l) => pair(0, 'LAYER') + pair(2, l.name) + pair(70, 0) + pair(62, l.aci) + pair(6, 'CONTINUOUS'));
  return (
    pair(0, 'TABLE') + pair(2, 'LTYPE') + pair(70, 1) + pair(0, 'LTYPE') + pair(2, 'CONTINUOUS') + pair(70, 0) + pair(3, 'Solid line') + pair(72, 65) + pair(73, 0) + pair(40, 0) + pair(0, 'ENDTAB') +
    pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, entries.length) + entries.join('') + pair(0, 'ENDTAB')
  );
}

export function writeDxf(model: Model, options: ExportOptions = {}): Uint8Array {
  const layout = layoutRegions(model.diagnostics.regions, options);
  const layer = DXF_LAYERS[resolveOptions2d(options).operation].name;
  const entities = layout.regions.flatMap((r) => r.shapes.flatMap((s) => [s.outer, ...s.holes])).map((ring) => polyline(ring, layer));
  const text =
    pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$ACADVER') + pair(1, 'AC1009') + pair(9, '$INSUNITS') + pair(70, INSUNITS_MM) + pair(0, 'ENDSEC') +
    pair(0, 'SECTION') + pair(2, 'TABLES') + layerTable() + pair(0, 'ENDSEC') +
    pair(0, 'SECTION') + pair(2, 'ENTITIES') + entities.join('') + pair(0, 'ENDSEC') +
    pair(0, 'EOF');
  return utf8(text);
}
