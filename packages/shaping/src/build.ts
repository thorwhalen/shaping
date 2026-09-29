/**
 * The build: `Design` + figures -> `Model`.
 *
 * Runs the genre inside one kernel scope, then does everything a genre should not have to do:
 * makes bodies disjoint, sizes the object to millimetres and stands it on z = 0, meshes it,
 * measures it, and checks every promise the genre made (shadows, original slices), turning them
 * into planar regions the viewer draws. Nothing the kernel allocated survives the scope.
 */
import type { Design } from './design.js';
import { prepareParams } from './design.js';
import { cleanFigure } from './figure.js';
import { affineFromColumns, applyAffine, invertRigid } from './geometry/affine.js';
import type { Genre, GenreResult } from './genre.js';
import type { Kernel, Region, Solid } from './kernel/types.js';
import { sourceToFigure, type SourceResolvers } from './sources/index.js';
import type { Body, Figure, Model, PlanarRegion, Polygon, ShadowView, Vec3 } from './types.js';
import { formatIssues } from './design.js';
import { z } from 'zod';

/** The table of genres, keyed by id. A plain object: adding a genre is adding an entry. */
export type GenreTable = Record<string, Genre<any>>;

/** Colours given to parts when the design asks for a palette. */
export const PART_PALETTE = ['#d4763b', '#3b7dd4', '#4caf6d', '#c94f7c', '#e0b43a', '#7a5cc9', '#3aa9b0', '#8a8f3c', '#d45f3b', '#5a6b8c'];

export interface BuildFromFiguresOptions {
  kernel: Kernel;
  genres: GenreTable;
  /** Gap between the object and its shadow walls, as a share of the object's size. */
  wallGap?: number;
  /** Largest acceptable "extra shadow" share before the checker reports a bug. */
  extraTolerance?: number;
}

export interface ResolveFiguresOptions {
  kernel: Kernel;
  genres: GenreTable;
  resolvers?: SourceResolvers;
}

export function getGenre(genres: GenreTable, id: string): Genre<any> {
  const g = genres[id];
  if (!g) throw new Error(`Unknown genre "${id}". Available: ${Object.keys(genres).join(', ')}`);
  return g;
}

/** Validate a design's genre parameters, naming each offending field. */
export function genreParams<P>(genre: Genre<P>, design: Design): P {
  const r = (genre.params as z.ZodType<P>).safeParse(design.params);
  if (!r.success) throw new Error(`Invalid parameters for genre "${genre.id}":\n${formatIssues(r.error)}`);
  return r.data;
}

/** Resolve every slot's source to a figure. This is the slow, asynchronous half of a build. */
export async function resolveFigures(design: Design, opts: ResolveFiguresOptions): Promise<Record<string, Figure>> {
  const genre = getGenre(opts.genres, design.genre);
  const out: Record<string, Figure> = {};
  for (const slot of genre.slots) {
    const source = design.sources[slot.id];
    if (!source) throw new Error(`Design "${design.id}" has no source for slot "${slot.id}" of genre "${genre.id}".`);
    out[slot.id] = await sourceToFigure(source, prepareParams(design, slot.id), { kernel: opts.kernel, resolvers: opts.resolvers ?? {} });
  }
  return out;
}

/** Build a model from already-resolved figures. Synchronous: this is what runs on every dial move. */
export function buildFromFigures(design: Design, figures: Record<string, Figure>, opts: BuildFromFiguresOptions): Model {
  const { kernel } = opts;
  const wallGap = opts.wallGap ?? 0.25;
  const extraTolerance = opts.extraTolerance ?? 1e-3;
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const genre = getGenre(opts.genres, design.genre);
  const params = genreParams(genre, design);

  const model = kernel.scope((): Model => {
    const cleaned: Record<string, Figure> = {};
    for (const slot of genre.slots) {
      const f = figures[slot.id];
      if (!f) throw new Error(`No figure for slot "${slot.id}" of genre "${genre.id}".`);
      cleaned[slot.id] = cleanFigure(kernel, f);
    }
    const result: GenreResult = genre.build(cleaned, params, { kernel });
    const warnings = [...(result.warnings ?? [])];

    // Bodies are disjoint: earlier bodies win, so a multi-colour print has no overlapping volume.
    const bodies: Array<{ partId: string; solid: Solid; color?: string }> = [];
    let taken: Solid | null = null;
    for (const b of result.bodies) {
      let s = b.solid;
      if (taken) s = kernel.subtract(s, taken);
      if (kernel.isEmpty(s)) continue;
      taken = taken ? kernel.union([taken, s]) : s;
      bodies.push({ ...b, solid: s });
    }
    if (!taken || bodies.length === 0) {
      return {
        bodies: [],
        diagnostics: { volume: 0, pieces: 0, genus: 0, bbox: { min: [0, 0, 0], max: [0, 0, 0] }, regions: [], warnings: [...warnings, 'The result is empty: nothing survives the operation.'] },
      };
    }
    // Measure the union of the solids as the genre made them: the disjoint bodies share faces
    // exactly, and a union of exactly touching solids is not guaranteed to weld.
    const all = kernel.union(result.bodies.map((b) => b.solid));

    // Size: the longest edge becomes design.sizeMm; the object stands on z = 0, centred in x and y.
    const gb = kernel.bbox(all);
    const ext = [0, 1, 2].map((i) => gb.max[i] - gb.min[i]);
    const s = design.sizeMm / Math.max(...ext);
    const t: Vec3 = [-s * (gb.min[0] + gb.max[0]) / 2, -s * (gb.min[1] + gb.max[1]) / 2, -s * gb.min[2]];
    const place = (p: Vec3): Vec3 => [s * p[0] + t[0], s * p[1] + t[1], s * p[2] + t[2]];
    const toMm = (x: Solid) => kernel.translate(kernel.scale(x, s), t);

    const style = design.style;
    const outBodies: Body[] = bodies.map((b, i) => {
      const m = kernel.mesh(toMm(b.solid));
      const color = style.partColors[b.partId] ?? b.color ?? (style.palette && bodies.length > 1 ? PART_PALETTE[i % PART_PALETTE.length] : style.color);
      return { partId: b.partId, positions: m.positions, indices: m.indices, color };
    });

    const allMm = toMm(all);
    // Components with negative volume are the shells of sealed cavities, not pieces.
    const shells = kernel.decompose(allMm).map((c) => kernel.volume(c));
    const pieces = shells.filter((v) => v > 0).length;
    const cavities = shells.filter((v) => v < 0).length;
    const regions: PlanarRegion[] = [];
    const scalePolys = (ps: Polygon[]): Polygon[] =>
      ps.map((p) => ({ outer: p.outer.map(([x, y]) => [x * s, y * s]), holes: p.holes.map((h) => h.map(([x, y]) => [x * s, y * s])) }));

    // Shadow promises, checked in genre coordinates; areas and polygons converted to millimetres.
    const shadows: ShadowView[] = [];
    for (const promise of result.shadows ?? []) {
      const excluded = promise.excludeParts ?? [];
      const casting = excluded.length ? kernel.union(bodies.filter((b) => !excluded.includes(b.partId)).map((b) => b.solid)) : all;
      const view = kernel.transform(casting, promise.toView);
      const shadow = kernel.project(view);
      const missing = kernel.subtract2(promise.target, shadow);
      const extra = kernel.subtract2(shadow, promise.target);
      const targetArea = kernel.area(promise.target) * s * s;
      const missingArea = kernel.area(missing) * s * s;
      const extraArea = kernel.area(extra) * s * s;
      shadows.push({ slot: promise.slot, targetArea, achievedArea: kernel.area(shadow) * s * s, missingArea, missingShare: targetArea > 0 ? missingArea / targetArea : 0, extraArea });
      if (targetArea > 0 && extraArea / targetArea > extraTolerance)
        warnings.push(`Internal check failed: the ${promise.label} shadow extends beyond its figure (an axis convention bug).`);

      // Place the wall behind the object, facing the viewer of this promise.
      const vb = kernel.bbox(view);
      const depth = vb.max[2] - vb.min[2];
      const inv = invertRigid(promise.toView);
      const w = vb.min[2] - wallGap * depth;
      const origin = place(applyAffine(inv, [0, 0, w]));
      const u = sub(applyAffine(inv, [1, 0, w]), applyAffine(inv, [0, 0, w]));
      const v = sub(applyAffine(inv, [0, 1, w]), applyAffine(inv, [0, 0, w]));
      const add = (role: PlanarRegion['role'], r: Region) =>
        regions.push({ id: `${promise.slot}:${role}`, label: `${promise.label} — ${role}`, polygons: scalePolys(kernel.polygons(r)), origin, u, v, role });
      add('target', promise.target);
      add('achieved', shadow);
      if (missingArea > 0) add('missing', missing);
    }

    // Original-slice promises: the kernel's cut on the plane should give back the figure.
    for (const promise of result.slices ?? []) {
      const body = bodies.find((b) => b.partId === promise.partId);
      if (!body) continue;
      const cut = kernel.slice(kernel.transform(body.solid, promise.toPlane), 0);
      const diff = kernel.union2([kernel.subtract2(cut, promise.target), kernel.subtract2(promise.target, cut)]);
      const ta = kernel.area(promise.target);
      const share = ta > 0 ? kernel.area(diff) / ta : 0;
      if (share > 0.02) warnings.push(`The ${promise.label} cut differs from its figure by ${(100 * share).toFixed(1)} %.`);
      const inv = invertRigid(promise.toPlane);
      const origin = place(applyAffine(inv, [0, 0, 0]));
      regions.push({
        id: `slice:${promise.partId}`,
        label: `${promise.label} — original slice`,
        polygons: scalePolys(kernel.polygons(cut)),
        origin,
        u: sub(applyAffine(inv, [1, 0, 0]), applyAffine(inv, [0, 0, 0])),
        v: sub(applyAffine(inv, [0, 1, 0]), applyAffine(inv, [0, 0, 0])),
        role: 'slice',
      });
    }

    // Section: the kernel's cut of the whole object by the plane y = c (front to back), when the view asks.
    if (design.view.section) {
      const c = ((gb.min[1] + gb.max[1]) / 2) + design.view.sectionOffset * ((gb.max[1] - gb.min[1]) / 2);
      const toPlane = SECTION_Y(c);
      const cut = kernel.slice(kernel.transform(all, toPlane), 0);
      const inv = invertRigid(toPlane);
      regions.push({
        id: 'section',
        label: 'section',
        polygons: scalePolys(kernel.polygons(cut)),
        origin: place(applyAffine(inv, [0, 0, 0])),
        u: sub(applyAffine(inv, [1, 0, 0]), applyAffine(inv, [0, 0, 0])),
        v: sub(applyAffine(inv, [0, 1, 0]), applyAffine(inv, [0, 0, 0])),
        role: 'section',
      });
    }

    if (cavities > 0) warnings.push(`${cavities} sealed internal cavit${cavities > 1 ? 'ies' : 'y'}: resin and powder processes trap material there.`);
    if (pieces > 1) warnings.push(`${pieces} separate pieces. A printed object would fall apart; see the genre's fixes.`);
    const bb = kernel.bbox(allMm);
    return {
      bodies: outBodies,
      diagnostics: { volume: kernel.volume(allMm), pieces, cavities, genus: kernel.genus(allMm), bbox: bb, regions, shadows: shadows.length ? shadows : undefined, warnings },
    };
  });
  model.diagnostics.buildMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return model;
}

/** Model -> plane coordinates for the plane y = c, seen from the front: (x, z, -(y - c)). */
const SECTION_Y = (c: number) => affineFromColumns([1, 0, 0], [0, 0, -1], [0, 1, 0], [0, 0, c]);

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
