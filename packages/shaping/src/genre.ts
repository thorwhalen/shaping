/**
 * The plug-in contracts: `Genre` (a kind of object) and `Transform` (a 2D-to-3D operator that a
 * genre can compose).
 *
 * A genre owns exactly one stage of the pipeline: turning figures into solids. Everything else
 * (sources, preparation, sizing, checks, meshing, export, animation) belongs to the core. A genre
 * declares what it promises (shadows, original slices) and the core checks those promises, so a
 * new genre gets the checker, the walls and the section caps for free.
 */
import type { z } from 'zod';
import type { Affine3, Kernel, Region, Solid } from './kernel/types.js';
import type { Figure } from './types.js';

/** One input figure a genre takes, e.g. the three views of a shadow block. */
export interface Slot {
  id: string;
  title: string;
  /** Short help shown next to the slot. */
  hint?: string;
}

export interface BuildContext {
  kernel: Kernel;
}

/**
 * "The solid, seen along this direction, casts exactly this figure."
 * `toView` is a rigid motion taking model coordinates to view coordinates, where the view looks
 * along +z and the figure lives in (x, y).
 */
export interface ShadowPromise {
  slot: string;
  label: string;
  toView: Affine3;
  target: Region;
  /** Parts that do not take part in the promise (a base plate, say). */
  excludeParts?: string[];
}

/**
 * "The body of this part, cut by this plane, gives back the figure."
 * `toPlane` is a rigid motion taking model coordinates to plane coordinates, where the plane is
 * z = 0 and the figure lives in (x, y).
 */
export interface SlicePromise {
  partId: string;
  label: string;
  toPlane: Affine3;
  target: Region;
}

export interface GenreBody {
  partId: string;
  solid: Solid;
  /** A colour the genre insists on; otherwise the design's style decides. */
  color?: string;
  /** This body is meant to overlap earlier ones (a base sunk into the parts): it gives way silently. */
  yields?: boolean;
}

/** What a genre returns. Handles are valid only inside the build's kernel scope. */
export interface GenreResult {
  bodies: GenreBody[];
  shadows?: ShadowPromise[];
  slices?: SlicePromise[];
  warnings?: string[];
}

export interface Genre<P = Record<string, unknown>> {
  id: string;
  title: string;
  description: string;
  slots: Slot[];
  /** Sources a new design of this genre starts with, per slot, so it opens on something that works. */
  starter?: Record<string, import('./design.js').Source>;
  /** The dials, with defaults. The dials panel is generated from this schema. */
  params: z.ZodType<P>;
  /**
   * Build the solids. Runs inside a kernel scope; create handles freely and return them.
   * Figures are keyed by slot id; each arrives with its parts cleaned by a 2D union.
   */
  build(figures: Record<string, Figure>, params: P, ctx: BuildContext): GenreResult;
}

/** A 2D-to-3D operator for one part: extrude, revolve, radial array, and those to come. */
export interface Transform<P = Record<string, unknown>> {
  id: string;
  title: string;
  params: z.ZodType<P>;
  /**
   * Build the solid for one part. The figure lives in the model's xz plane (figure y is model z,
   * "up"); `axisX` is the figure x of the vertical axis that revolving transforms turn about.
   */
  build(part: Region, params: P, ctx: BuildContext & { axisX: number }): Solid;
  /**
   * The plane whose cut gives back the figure, and what that cut should equal; null when the
   * transform keeps no exact slice.
   */
  originalSlice(part: Region, params: P, ctx: BuildContext & { axisX: number }): { toPlane: Affine3; target: Region } | null;
}

/** Define a genre with its parameter type inferred from the schema. */
export function defineGenre<S extends z.ZodType>(g: Omit<Genre<z.output<S>>, 'params'> & { params: S }): Genre<z.output<S>> {
  return g as unknown as Genre<z.output<S>>;
}

/** Define a transform with its parameter type inferred from the schema. */
export function defineTransform<S extends z.ZodType>(t: Omit<Transform<z.output<S>>, 'params'> & { params: S }): Transform<z.output<S>> {
  return t as unknown as Transform<z.output<S>>;
}
