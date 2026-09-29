/**
 * The solid-modeller seam.
 *
 * A `Kernel` is what every genre and transform builds with. It deals in opaque handles:
 * `Region` (a clean 2D area) and `Solid` (a closed 3D volume). Handles live only inside
 * `kernel.scope(fn)`, which deletes every handle created during `fn` once it returns, so
 * nothing but plain data (polygons, meshes, numbers) ever escapes. Callers never free memory.
 *
 * The default implementation is Manifold (`manifoldKernel`). A replacement, such as one on
 * OpenCascade for true STEP export, implements this interface and is passed as `kernel`.
 */
import type { Box3, Polygon, Vec2, Vec3 } from '../types.js';

declare const regionBrand: unique symbol;
declare const solidBrand: unique symbol;

/** An opaque 2D area: a union of polygons with holes, free of self-intersections. */
export interface Region {
  readonly [regionBrand]: true;
}

/** An opaque closed 3D solid (possibly empty, possibly several pieces). */
export interface Solid {
  readonly [solidBrand]: true;
}

/** A 4x3 affine matrix, column-major (12 numbers: three columns of the linear part, then translation). */
export type Affine3 = [number, number, number, number, number, number, number, number, number, number, number, number];

export interface ExtrudeOptions {
  /** Twist of the top relative to the bottom, in degrees. */
  twistDeg?: number;
  /** Scale of the top relative to the bottom, per axis. */
  scaleTop?: Vec2;
  /** Number of intermediate slices (needed for twist to look smooth). */
  divisions?: number;
  /** Centre the extrusion on z = 0 instead of resting on it. */
  center?: boolean;
}

export interface RevolveOptions {
  /** Sweep angle in degrees, (0, 360]. */
  angleDeg?: number;
  /** Segments for a full turn. */
  segments?: number;
}

export type JoinType = 'round' | 'miter' | 'square';

/** An indexed triangle mesh as plain typed arrays. */
export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface Kernel {
  /** A name for diagnostics, e.g. "manifold". */
  readonly name: string;

  /**
   * Run `fn` with a fresh handle scope. Every Region and Solid created while `fn` runs is deleted
   * when it returns (or throws). Return plain data only. Scopes nest.
   */
  scope<T>(fn: () => T): T;

  // ---- 2D
  /** Build a clean region from polygons (union with the non-zero rule, holes respected). */
  region(polygons: Polygon[]): Region;
  polygons(r: Region): Polygon[];
  area(r: Region): number;
  bounds2(r: Region): { min: Vec2; max: Vec2 };
  isEmpty2(r: Region): boolean;
  union2(rs: Region[]): Region;
  intersect2(a: Region, b: Region): Region;
  subtract2(a: Region, b: Region): Region;
  /** Grow (delta > 0) or shrink (delta < 0) a region. */
  offset2(r: Region, delta: number, join?: JoinType): Region;
  transform2(r: Region, m: { translate?: Vec2; scale?: Vec2 | number; rotateDeg?: number; mirrorX?: boolean; mirrorY?: boolean }): Region;
  /** Split a region into its connected components (each with its holes). */
  components2(r: Region): Region[];
  simplify2(r: Region, epsilon: number): Region;

  // ---- 2D to 3D
  /** Extrude along +z (or centred on z = 0). */
  extrude(r: Region, height: number, opts?: ExtrudeOptions): Solid;
  /** Revolve the part of the region with x >= 0 about the region's y axis, which becomes +z. */
  revolve(r: Region, opts?: RevolveOptions): Solid;

  // ---- 3D
  empty(): Solid;
  union(ss: Solid[]): Solid;
  intersect(ss: Solid[]): Solid;
  subtract(a: Solid, b: Solid): Solid;
  translate(s: Solid, v: Vec3): Solid;
  /** Rotate by Euler angles in degrees, applied x, then y, then z. */
  rotate(s: Solid, deg: Vec3): Solid;
  scale(s: Solid, f: Vec3 | number): Solid;
  mirror(s: Solid, normal: Vec3): Solid;
  transform(s: Solid, m: Affine3): Solid;
  /** Build a box, for bases and frames. */
  box(size: Vec3, center?: boolean): Solid;
  /** Shadow on the xy plane (projection along z). */
  project(s: Solid): Region;
  /** Cross-section at height z. */
  slice(s: Solid, z: number): Region;
  decompose(s: Solid): Solid[];
  isEmpty(s: Solid): boolean;
  volume(s: Solid): number;
  genus(s: Solid): number;
  bbox(s: Solid): Box3;
  /** Extract the triangle mesh. The mesh is closed and outward-facing. */
  mesh(s: Solid): MeshData;
  /** Build a solid from a closed, non-self-intersecting mesh. Throws if it is not manifold. */
  fromMesh(m: MeshData): Solid;
  /** Number of live handles, for leak tests. */
  liveCount(): number;
}
