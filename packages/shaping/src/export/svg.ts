/**
 * SVG writer for laser cutting and engraving, from the model's planar regions.
 *
 * Width, height and viewBox are in millimetres (one user unit is one mm). Stroke means cut or
 * score (no fill); fill means engrave (no stroke). Every subpath is closed with `Z`, holes wind
 * opposite to outer rings, and `fill-rule` is evenodd. No text elements. Kerf, roles, gap and the
 * operation colours are options (see `ExportOptions`).
 */
import { fmt, utf8 } from './mesh.js';
import { layoutRegions, resolveOptions2d, type Layout } from './layout2d.js';
import { orient } from './offset.js';
import type { ExportOptions } from './types.js';
import type { Model, Ring } from '../types.js';

/** Decimals for SVG coordinates (1e-4 mm). */
const SVG_DECIMALS = 4;

/** A closed subpath. `ring` is in y-up layout coordinates; y flips to the SVG's y-down. */
function subpath(ring: Ring, height: number, outer: boolean): string {
  // In y-down coordinates a visually counter-clockwise ring has negative signed area; outer rings
  // are written one way and holes the other.
  const flipped: Ring = ring.map(([x, y]) => [x, height - y]);
  const r = orient(flipped, outer);
  return `M${r.map(([x, y]) => `${fmt(x, SVG_DECIMALS)} ${fmt(y, SVG_DECIMALS)}`).join('L')}Z`;
}

function pathData(layout: Layout, regionIndex: number): string {
  return layout.regions[regionIndex].shapes
    .map((s) => [subpath(s.outer, layout.height, true), ...s.holes.map((h) => subpath(h, layout.height, false))].join(''))
    .join('');
}

export function writeSvg(model: Model, options: ExportOptions = {}): Uint8Array {
  const layout = layoutRegions(model.diagnostics.regions, options);
  const { operation, colors, hairline } = resolveOptions2d(options);
  const w = fmt(layout.width, SVG_DECIMALS);
  const h = fmt(layout.height, SVG_DECIMALS);
  const style =
    operation === 'engrave'
      ? `fill="${colors.engrave}" fill-rule="evenodd" stroke="none"`
      : `fill="none" stroke="${colors[operation]}" stroke-width="${fmt(hairline, SVG_DECIMALS)}"`;
  const paths = layout.regions.map((r, i) => `  <path id="${r.id.replace(/[^A-Za-z0-9_-]/g, '_')}" ${style} d="${pathData(layout, i)}"/>`);
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">\n` +
    `${paths.join('\n')}\n</svg>\n`;
  return utf8(svg);
}
