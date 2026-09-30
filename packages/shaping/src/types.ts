/**
 * The data types that cross every boundary of the pipeline.
 *
 * source -> prepare -> Figure -> genre.build(figures, params, { kernel }) -> Model -> consumers
 *
 * Everything here is plain data (JSON or typed arrays), so it passes between a worker and the
 * page, and between the browser and Node, without conversion. No class instance, no kernel
 * object and no three.js object ever appears in these types.
 */

/** A point in the plane, `[x, y]`, with y pointing up (mathematical orientation). */
export type Vec2 = [number, number];

/** A point in space, `[x, y, z]`. */
export type Vec3 = [number, number, number];

/** A closed ring of points. The closing edge is implicit: the last point is not repeated. */
export type Ring = Vec2[];

/** An outer ring plus the rings of its holes. Outer rings are counter-clockwise, holes clockwise. */
export interface Polygon {
  outer: Ring;
  holes: Ring[];
}

/** A bitonal image: one byte per pixel, non-zero means foreground. Row 0 is the top row. */
export interface Mask {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Units a figure's coordinates are expressed in. `unit` means "no physical unit yet". */
export type Units = 'mm' | 'px' | 'unit';

/** One individually colourable component of a figure. */
export interface Part {
  id: string;
  polygons: Polygon[];
  color?: string;
}

/** A 2D figure: what every source becomes, and what every genre consumes. */
export interface Figure {
  units: Units;
  parts: Part[];
  /**
   * The rectangle the figure was drawn in (a drawing's page, an image's pixels, an SVG's view box),
   * y up. When present, genres fit this frame, not the parts' bounding box, so a small shape drawn
   * in a corner stays small and in the corner.
   */
  frame?: { min: Vec2; max: Vec2 };
}

/** One closed solid of the model, as an indexed triangle mesh (outward-facing, counter-clockwise). */
export interface Body {
  partId: string;
  /** xyz triples, in millimetres. */
  positions: Float32Array;
  /** Triangle vertex indices, three per triangle. */
  indices: Uint32Array;
  color: string;
  /** A colour the genre insisted on for this body, if any (the style decides otherwise). */
  genreColor?: string;
}

/** Axis-aligned bounding box. */
export interface Box3 {
  min: Vec3;
  max: Vec3;
}

/** A planar diagnostic region placed in space: polygons in a plane given by an origin and two axes. */
export interface PlanarRegion {
  id: string;
  label: string;
  /** Polygons in the plane's own (u, v) coordinates, millimetres. */
  polygons: Polygon[];
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  role: 'target' | 'achieved' | 'missing' | 'slice' | 'section';
}

/** One orthogonal view of a shadow check. */
export interface ShadowView {
  slot: string;
  /** Area of the target figure, in mm^2. */
  targetArea: number;
  /** Area of the solid's actual shadow, in mm^2. */
  achievedArea: number;
  /** Area of the target that the solid fails to cast, in mm^2. */
  missingArea: number;
  /** missingArea / targetArea, in [0, 1]. */
  missingShare: number;
  /** Area of shadow outside the target. Must be (numerically) zero; non-zero means an axis bug. */
  extraArea: number;
}

/** What the kernel measured about a built model, plus planar regions to draw. */
export interface Diagnostics {
  /** Volume of the union of all bodies, in mm^3. */
  volume: number;
  /** Number of disconnected pieces. */
  pieces: number;
  /** Number of sealed internal cavities (closed voids inside the solid). */
  cavities?: number;
  /** Genus of the union (number of handles). */
  genus: number;
  bbox: Box3;
  /** Planar regions (shadows, slices) for the viewer to draw. */
  regions: PlanarRegion[];
  /** Shadow checks, for genres that promise shadows. */
  shadows?: ShadowView[];
  /** Human-readable notes: what went wrong, and what could fix it. */
  warnings: string[];
  /** Time the build took, in milliseconds. */
  buildMs?: number;
}

/** The output of a build: what the viewer shows and what the exporters write. */
export interface Model {
  bodies: Body[];
  /**
   * The union of all bodies as ONE closed mesh (mm), present when there are several bodies.
   * Formats that hold a single solid (STL, PLY) write this: stacking bodies that share faces
   * would not be a closed mesh.
   */
  union?: { positions: Float32Array; indices: Uint32Array };
  diagnostics: Diagnostics;
}
