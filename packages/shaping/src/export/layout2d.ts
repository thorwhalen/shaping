/**
 * Layout of planar regions for the 2D files (SVG, DXF): filter by role, apply kerf, then place
 * the regions left to right with a gap, all in millimetres.
 *
 * Output coordinates have y pointing up and start at the origin (the layout's lower-left
 * corner). SVG flips y on writing.
 */
import type { PlanarRegion, Ring } from '../types.js';
import { offsetPolygon } from './offset.js';
import type { ExportOptions, Operation, OperationColors, RegionRole } from './types.js';

export const DEFAULT_ROLES: RegionRole[] = ['slice', 'target'];
export const DEFAULT_GAP_MM = 5;
export const DEFAULT_KERF_MM = 0;
export const DEFAULT_HAIRLINE_MM = 0.01;
export const DEFAULT_OPERATION: Operation = 'cut';
export const DEFAULT_OPERATION_COLORS: OperationColors = { cut: '#ff0000', score: '#0000ff', engrave: '#000000' };

/** One outline (outer ring plus its holes) placed in the layout. */
export interface PlacedShape {
  outer: Ring;
  holes: Ring[];
}

/** One region placed in the layout. */
export interface PlacedRegion {
  id: string;
  shapes: PlacedShape[];
  /** Extent of the region, in mm. */
  width: number;
  height: number;
}

export interface Layout {
  regions: PlacedRegion[];
  width: number;
  height: number;
}

/** Options with every default filled in. */
export function resolveOptions2d(options: ExportOptions = {}) {
  return {
    roles: options.roles ?? DEFAULT_ROLES,
    gap: options.gap ?? DEFAULT_GAP_MM,
    kerf: options.kerf ?? DEFAULT_KERF_MM,
    hairline: options.hairline ?? DEFAULT_HAIRLINE_MM,
    operation: options.operation ?? DEFAULT_OPERATION,
    colors: { ...DEFAULT_OPERATION_COLORS, ...options.operationColors },
  };
}

function regionShapes(region: PlanarRegion, kerf: number) {
  const shapes = [];
  for (const polygon of region.polygons) {
    const p = offsetPolygon(polygon, kerf / 2);
    if (p) shapes.push({ outer: p.outer, holes: p.holes });
  }
  return shapes;
}

/** Lay out the regions of `regions` whose role is in `options.roles`. Throws when none match. */
export function layoutRegions(regions: PlanarRegion[], options: ExportOptions = {}): Layout {
  const { roles, gap, kerf } = resolveOptions2d(options);
  const chosen = regions.filter((r) => roles.includes(r.role) && r.polygons.length > 0);
  if (!chosen.length) {
    const have = [...new Set(regions.map((r) => r.role))].join(', ') || 'none';
    throw new Error(`No planar regions with role ${roles.join(' or ')} to write (the model has: ${have}).`);
  }
  const placed: PlacedRegion[] = [];
  let cursor = 0;
  let height = 0;
  for (const region of chosen) {
    const shapes = regionShapes(region, kerf);
    const pts = shapes.flatMap((s) => s.outer);
    if (!pts.length) continue;
    const minU = Math.min(...pts.map((p) => p[0]));
    const maxU = Math.max(...pts.map((p) => p[0]));
    const minV = Math.min(...pts.map((p) => p[1]));
    const maxV = Math.max(...pts.map((p) => p[1]));
    const move = (ring: Ring): Ring => ring.map(([u, v]) => [u - minU + cursor, v - minV]);
    placed.push({
      id: region.id,
      shapes: shapes.map((s) => ({ outer: move(s.outer), holes: s.holes.map(move) })),
      width: maxU - minU,
      height: maxV - minV,
    });
    cursor += maxU - minU + gap;
    height = Math.max(height, maxV - minV);
  }
  return { regions: placed, width: Math.max(cursor - gap, 0), height };
}
