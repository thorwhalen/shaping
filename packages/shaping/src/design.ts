/**
 * The `Design`: the single source of truth for a piece of work.
 *
 * A Design is what is saved, shared, put in the gallery, and handed to the command line. Types,
 * defaults, validation and the dials panel all derive from the Zod schemas in this module (and
 * from each genre's own `params` schema). A dial that exists only in a component is a bug.
 *
 * Numbers that shape geometry carry `.meta({ title, unit, step })` so a user interface can be
 * generated from `z.toJSONSchema(schema)` without knowing the schema in advance.
 */
import { z } from 'zod';

/**
 * Version of the Design document. Older versions are migrated on the way in (see `migrateDesign`),
 * so saved work, shared links and files keep meaning what they meant.
 * - 2 (2026-09-29): a text source's `round` became a share of the stroke's half-width (was a radius
 *   in cells) and rounds concave corners too.
 */
export const DESIGN_VERSION = 2 as const;

const vec2 = z.tuple([z.number(), z.number()]);
const ring = z.array(vec2);

export const PolygonSchema = z.object({ outer: ring, holes: z.array(ring).default([]) });
export const PartSchema = z.object({ id: z.string(), polygons: z.array(PolygonSchema), color: z.string().optional() });
export const FigureSchema = z.object({ units: z.enum(['mm', 'px', 'unit']).default('unit'), parts: z.array(PartSchema) });

// ---------------------------------------------------------------- sources

/** Built-in parametric shapes: for examples, tests and quick starts. */
export const ShapeSourceSchema = z.object({
  kind: z.literal('shape'),
  shape: z.enum(['circle', 'rect', 'ring', 'star', 'polygon', 'cross', 'heart']),
  /** Number of points (star) or sides (polygon). */
  n: z.number().int().min(3).max(64).default(5).meta({ title: 'Points or sides', when: { shape: ['star', 'polygon'] } }),
  /** Inner-to-outer radius ratio (ring, star) or width-to-height ratio (rect, cross). */
  ratio: z.number().min(0.05).max(20).default(0.5).meta({ title: 'Ratio', step: 0.01, when: { shape: ['rect', 'ring', 'star', 'cross'] } }),
});

/** Text set in the built-in block font: each glyph is a union of cells, so letters are exact polygons. */
/** Id of the built-in block font; any other font id names a font in the font catalog. */
export const BLOCK_FONT = 'block';

/** A stretch of text in one font (with its variable-font axis values). */
export const TextRunSchema = z.object({
  text: z.string().min(1).max(64),
  font: z.string().optional(),
  axes: z.record(z.string(), z.number()).optional(),
});

/**
 * Text as a figure: in the built-in block font (exact polygons, no loading) or in any font of the
 * catalog (outlines of the glyphs, loaded on demand). Several fonts in one text: give `runs`; a
 * run without its own font or axes uses the source's.
 */
export const TextSourceSchema = z.object({
  kind: z.literal('text'),
  text: z.string().min(1).max(64),
  font: z.string().default(BLOCK_FONT).meta({ title: 'Font' }),
  /** Variable-font axis values, by axis tag (e.g. `{ wght: 700 }`). Ignored by static fonts. */
  axes: z.record(z.string(), z.number()).default({}),
  runs: z.array(TextRunSchema).optional(),
  /** Rounds every corner, convex and concave: 0 is sharp, 1 rounds a stroke's tip completely. */
  round: z.number().min(0).max(1).default(0).meta({ title: 'Round', step: 0.01 }),
  /** Extra gap between glyphs: in cells for the block font, in tenths of an em for other fonts. */
  spacing: z.number().min(-1).max(3).default(1).meta({ title: 'Spacing', step: 0.05 }),
});

/** A figure given as polygons (vector data, already parsed). */
export const PolygonsSourceSchema = z.object({ kind: z.literal('polygons'), figure: FigureSchema });

/** An SVG document, parsed to polygons without rasterising. */
export const SvgSourceSchema = z.object({ kind: z.literal('svg'), svg: z.string(), name: z.string().optional() });

/**
 * A raster image. `src` is a `data:` URL, a URL, a path (command line), or `idb:<key>` for an image
 * kept in the browser's IndexedDB. The bytes are never stored in the Design itself when large.
 */
export const ImageSourceSchema = z.object({ kind: z.literal('image'), src: z.string(), name: z.string().optional() });

export const DrawObjectSchema = z.object({
  tool: z.enum(['pen', 'line', 'rect', 'ellipse']),
  /** Points in drawing coordinates (y down, like the canvas); a third number is pen pressure. */
  points: z.array(z.array(z.number()).min(2).max(3)),
  /** Stroke width in drawing units. */
  size: z.number().positive().default(12),
  /** Rectangles and ellipses: filled, or only their outline. */
  filled: z.boolean().default(true),
  /** Subtract instead of add. */
  erase: z.boolean().default(false),
});

/** A drawing made in the app: a list of objects, unioned (and erasers subtracted) in order. */
export const DrawingSourceSchema = z.object({
  kind: z.literal('drawing'),
  width: z.number().positive().default(512),
  height: z.number().positive().default(512),
  objects: z.array(DrawObjectSchema).default([]),
});

export const SourceSchema = z.discriminatedUnion('kind', [
  ShapeSourceSchema,
  TextSourceSchema,
  PolygonsSourceSchema,
  SvgSourceSchema,
  ImageSourceSchema,
  DrawingSourceSchema,
]);

// ---------------------------------------------------------------- preparation (source -> figure)

export const PrepareSchema = z.object({
  /** What is fitted to the object: the page it was drawn on (keeps size and place), or just the shape drawn. */
  fit: z.enum(['frame', 'content']).default('frame').meta({ title: 'Fit' }),
  /** How the mask is extracted from a raster image. */
  mode: z.enum(['auto', 'alpha', 'luminance', 'color', 'adaptive']).default('auto').meta({ title: 'Mask mode' }),
  /** Luminance threshold 0-255; null means "use Otsu's value". */
  threshold: z.number().min(0).max(255).nullable().default(null).meta({ title: 'Threshold', when: { mode: ['auto', 'luminance'] } }),
  invert: z.boolean().default(false).meta({ title: 'Invert' }),
  /** Reference colour for mode "color". */
  color: z.string().default('#000000').meta({ title: 'Key colour', when: { mode: ['color'] } }),
  /** Colour distance tolerance for mode "color", 0-1. */
  tolerance: z.number().min(0).max(1).default(0.25).meta({ title: 'Colour tolerance', step: 0.01, when: { mode: ['color'] } }),
  /** Adaptive threshold window (pixels) and offset. */
  window: z.number().int().min(3).max(201).default(31).meta({ title: 'Adaptive window', unit: 'px', when: { mode: ['adaptive'] } }),
  offset: z.number().min(-50).max(50).default(5).meta({ title: 'Adaptive offset', when: { mode: ['adaptive'] } }),
  /** Longest side the image is reduced to before processing. */
  maxSize: z.number().int().min(64).max(4096).default(768).meta({ title: 'Working size', unit: 'px' }),
  /** Components smaller than this share of the image area are dropped (despeckle). */
  minArea: z.number().min(0).max(0.1).default(0.0005).meta({ title: 'Drop specks', step: 0.0001 }),
  fillHoles: z.boolean().default(false).meta({ title: 'Fill holes' }),
  /** Grow (> 0) or shrink (< 0) the shape, in pixels of the working image. */
  grow: z.number().min(-20).max(20).default(0).meta({ title: 'Thicken', unit: 'px', step: 0.5 }),
  /** Smoothing radius of the distance field, in pixels. */
  smooth: z.number().min(0).max(20).default(1.5).meta({ title: 'Smooth', unit: 'px', step: 0.5 }),
  /** Ramer-Douglas-Peucker tolerance, in pixels. */
  simplify: z.number().min(0).max(5).default(0.6).meta({ title: 'Simplify', unit: 'px', step: 0.1 }),
  /** How the figure is split into parts. */
  split: z.enum(['components', 'none', 'colors']).default('components').meta({ title: 'Parts' }),
  /** Number of colour clusters when split = "colors". */
  colors: z.number().int().min(2).max(12).default(3).meta({ title: 'Colour clusters', when: { split: ['colors'] } }),
});

// ---------------------------------------------------------------- style, view, animation

export const MATERIAL_PRESETS = ['matte', 'glossy', 'brushed-metal', 'polished-metal', 'glass', 'resin'] as const;

export const StyleSchema = z.object({
  material: z.enum(MATERIAL_PRESETS).default('glossy').meta({ render: true, title: 'Material' }),
  color: z.string().default('#d4763b').meta({ render: true, title: 'Colour' }),
  /** Colour per part id; parts not listed use `color` or the palette. */
  partColors: z.record(z.string(), z.string()).default({}).meta({ render: true }),
  /** Use a distinct palette colour per part when no colour is given. */
  palette: z.boolean().default(true).meta({ render: true, title: 'Colour parts' }),
  opacity: z.number().min(0.05).max(1).default(1).meta({ render: true, title: 'Opacity', step: 0.05 }),
  roughness: z.number().min(0).max(1).nullable().default(null).meta({ render: true, title: 'Roughness', step: 0.05 }),
  metalness: z.number().min(0).max(1).nullable().default(null).meta({ render: true, title: 'Metalness', step: 0.05 }),
  background: z.string().default('#f4f1ea').meta({ render: true, title: 'Background' }),
});

export const ViewSchema = z.object({
  camera: z.enum(['perspective', 'orthographic']).default('perspective').meta({ render: true }),
  /** Camera azimuth and elevation, in degrees. Animatable. */
  azimuthDeg: z.number().min(-360).max(720).default(35).meta({ render: true, title: 'Azimuth', unit: '°' }),
  elevationDeg: z.number().min(-89).max(89).default(25).meta({ render: true, title: 'Elevation', unit: '°' }),
  /** Show the diagnostic walls (shadows) the genre provides. */
  /**
   * The walls around the object: none; the shadow walls (a panel behind each view); a corner (three
   * big walls meeting at the edges); or a closed box of six (four walls, a floor and a ceiling).
   * Walls between the camera and the object are cut away.
   */
  room: z.enum(['none', 'shadow', 'corner', 'box']).default('shadow').meta({ render: true, title: 'Walls' }),
  /** Size of the shadow-wall panels, as a multiple of what just frames their shadow. */
  wallSize: z.number().min(1).max(4).default(1.3).meta({ render: true, title: 'Wall size', step: 0.05, when: { room: ['shadow'] } }),
  /**
   * The light: the movable sun; three lights, one along each view's axis, each casting its view's
   * shadow on its own wall (parallel light from infinitely far away); or off (fill light only).
   */
  light: z.enum(['sun', 'axes', 'off']).default('sun').meta({ render: true, title: 'Light' }),
  // ---- the rest of the camera pose (with azimuthDeg and elevationDeg above), in units of the framed
  // radius, so a pose means the same framing whatever the object's size. Screen and export read it.
  /** Camera distance from the orbit target, in framed radii (perspective); dolly changes it. */
  distance: z.number().min(1.05).max(200).default(4).meta({ render: true, title: 'Distance', step: 0.05 }),
  /** Pan: the orbit target's offset from the object's centre, in framed radii (scene x, y, z). */
  panX: z.number().min(-20).max(20).default(0).meta({ render: true, title: 'Pan x', step: 0.01 }),
  panY: z.number().min(-20).max(20).default(0).meta({ render: true, title: 'Pan y', step: 0.01 }),
  panZ: z.number().min(-20).max(20).default(0).meta({ render: true, title: 'Pan z', step: 0.01 }),
  /** Vertical field of view of the perspective camera, in degrees. */
  fovDeg: z.number().min(5).max(120).default(35).meta({ render: true, title: 'Field of view', unit: '°', step: 1 }),
  /** Zoom of the orthographic camera (1 frames the object). */
  zoom: z.number().min(0.05).max(50).default(1).meta({ render: true, title: 'Zoom', step: 0.01 }),
  /** Distance of the shadow walls from the object, as a share of its size. */
  wallGap: z.number().min(0.05).max(3).default(0.8).meta({ title: 'Wall distance', step: 0.05, when: { room: ['shadow', 'corner', 'box'] } }),
  ground: z.boolean().default(true).meta({ render: true, title: 'Ground shadow' }),
  /** Light direction: azimuth and elevation in degrees, and intensity. */
  lightAzimuthDeg: z.number().min(-180).max(180).default(45).meta({ render: true, title: 'Light azimuth', unit: '°' }),
  lightElevationDeg: z.number().min(0).max(90).default(55).meta({ render: true, title: 'Light elevation', unit: '°' }),
  lightIntensity: z.number().min(0).max(6).default(2.2).meta({ render: true, title: 'Light', step: 0.1 }),
  lightColor: z.string().default('#ffffff').meta({ render: true, title: 'Light colour' }),
  /** Light that comes from everywhere (fills the shadows). Low, so the sun dominates. */
  fillIntensity: z.number().min(0).max(2).default(0.25).meta({ render: true, title: 'Fill light', step: 0.05 }),
  /** Strength of the studio reflections, which turn with the sun. */
  environmentIntensity: z.number().min(0).max(2).default(0.45).meta({ render: true, title: 'Reflections', step: 0.05 }),
  /** Clip the solid with a plane and show the kernel's slice on it. */
  section: z.boolean().default(false).meta({ title: 'Section' }),
  sectionOffset: z.number().min(-1).max(1).default(0).meta({ title: 'Section position', step: 0.01 }),
});

export const EASINGS = ['linear', 'ease_in', 'ease_out', 'ease_in_out'] as const;

/**
 * One flattened action, in the shape used by the `an` package (structured animation), so a track
 * written by one project can be read by the other: `target` is a section of the Design (`params`,
 * `view`, `style`), `property` a key within it.
 */
export const FlatActionSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  action: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('set'), target: z.string(), property: z.string(), value: z.unknown(), at: z.number().default(0) }),
    z.object({
      kind: z.literal('tween'),
      target: z.string(),
      property: z.string(),
      to_value: z.number(),
      from_value: z.number().nullable().default(null),
      duration: z.number().positive(),
      easing: z.enum(EASINGS).nullable().default('ease_in_out'),
    }),
  ]),
});

export const AnimationSchema = z.object({
  fps: z.number().int().min(1).max(60).default(24),
  /** Total length in seconds. Frame N equals frame 0 when `loop` is true. */
  duration: z.number().positive().max(120).default(4),
  loop: z.boolean().default(true),
  actions: z.array(FlatActionSchema).default([]),
});

// ---------------------------------------------------------------- the design

export const DesignObjectSchema = z.object({
  version: z.literal(DESIGN_VERSION),
  id: z.string().min(1),
  title: z.string().default('Untitled'),
  description: z.string().optional(),
  /** Id of the genre that builds this design. */
  genre: z.string().min(1),
  /** One source per slot of the genre, keyed by slot id. */
  sources: z.record(z.string(), SourceSchema),
  /** Preparation parameters per slot (raster and drawn sources). Missing slots use defaults. */
  prepare: z.record(z.string(), PrepareSchema.partial()).default({}),
  /** The genre's parameters, validated by the genre's own schema. */
  params: z.record(z.string(), z.unknown()).default({}),
  /**
   * The work left in other genres: switching genre stores the current genre's sources, preparation
   * and parameters here and brings back the target genre's, so switching away and back loses nothing.
   */
  genreState: z
    .record(z.string(), z.object({ sources: z.record(z.string(), SourceSchema), prepare: z.record(z.string(), PrepareSchema.partial()).default({}), params: z.record(z.string(), z.unknown()).default({}) }))
    .optional(),
  /** Size of the longest edge of the finished object. */
  sizeMm: z.number().positive().max(2000).default(50).meta({ title: 'Size (longest edge)', unit: 'mm' }),
  style: StyleSchema.default(StyleSchema.parse({})),
  view: ViewSchema.default(ViewSchema.parse({})),
  animation: AnimationSchema.optional(),
  /**
   * A keyframe sequence: captured views with transitions and dwells, as a sequence document of the
   * animation library the app uses. Display state only (never part of the build); validated by that
   * library when it is compiled.
   */
  sequence: z.record(z.string(), z.unknown()).optional(),
});

export type Source = z.infer<typeof SourceSchema>;
export type SourceInput = z.input<typeof SourceSchema>;
export type ShapeSource = z.infer<typeof ShapeSourceSchema>;
export type TextSource = z.infer<typeof TextSourceSchema>;
export type ImageSource = z.infer<typeof ImageSourceSchema>;
export type SvgSource = z.infer<typeof SvgSourceSchema>;
export type DrawingSource = z.infer<typeof DrawingSourceSchema>;
export type DrawObject = z.infer<typeof DrawObjectSchema>;
export type PrepareParams = z.infer<typeof PrepareSchema>;
export type Style = z.infer<typeof StyleSchema>;
export type View = z.infer<typeof ViewSchema>;
export type FlatAction = z.infer<typeof FlatActionSchema>;
export type Animation = z.infer<typeof AnimationSchema>;
/** `view.walls: false` (before rooms existed) means no walls. Additive: no version change. */
function liftWalls(input: object): object {
  const view = (input as { view?: Record<string, unknown> }).view;
  if (!view || !('walls' in view)) return input;
  const { walls, ...rest } = view;
  return { ...input, view: { ...rest, room: rest.room ?? (walls === false ? 'none' : 'shadow') } };
}

/** In version 1 a block-text `round` was a radius in cells (0..0.5); it is now a share of the half-stroke. */
const V1_ROUND_TO_V2 = 1 / (0.5 * 0.98);

/** Bring an older Design document up to the current version. Unknown shapes pass through to validation. */
export function migrateDesign(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const d = liftWalls(input) as { version?: unknown; sources?: Record<string, { kind?: string; round?: number }> };
  if (d.version !== 1) return d;
  const sources = Object.fromEntries(
    Object.entries(d.sources ?? {}).map(([k, src]) =>
      src?.kind === 'text' && typeof src.round === 'number' ? [k, { ...src, round: Math.min(1, src.round * V1_ROUND_TO_V2) }] : [k, src],
    ),
  );
  return { ...d, version: 2, sources };
}

/** The Design schema, accepting older versions (migrated first). */
export const DesignSchema = z.preprocess(migrateDesign, DesignObjectSchema);

export type Design = z.infer<typeof DesignObjectSchema>;
export type DesignInput = z.input<typeof DesignObjectSchema>;

/** Keys of an object schema whose fields carry `.meta({ render: true })`: display only, never geometry. */
function renderOnlyKeys(schema: z.ZodObject<z.ZodRawShape>): string[] {
  return Object.entries(schema.shape)
    .filter(([, f]) => (z.globalRegistry.get(f as z.ZodType) as { render?: boolean } | undefined)?.render)
    .map(([k]) => k);
}
const RENDER_VIEW = renderOnlyKeys(ViewSchema);
const RENDER_STYLE = renderOnlyKeys(StyleSchema);
const omit = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

/**
 * Everything in a design that can change its Model, as a string: two designs with the same key
 * build the same Model. Fields tagged `render` in the schema (camera, light, material) are left out,
 * so turning them never triggers a rebuild. A test guards the tags against `build` reading them.
 */
export function buildKey(d: Design): string {
  return JSON.stringify([d.genre, d.sources, d.prepare, d.params, d.sizeMm, omit(d.view, RENDER_VIEW), omit(d.style, RENDER_STYLE)]);
}

/** Format a Zod error so it names the field: `sources.x.kind: Invalid input`. */
export function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
}

/** Validate a design and fill in defaults. Throws an error that names each offending field. */
export function parseDesign(input: unknown): Design {
  const r = DesignSchema.safeParse(input);
  if (!r.success) throw new Error(`Invalid design:\n${formatIssues(r.error)}`);
  return r.data;
}

/** Default preparation parameters for a slot, merged with what the design gives. */
export function prepareParams(design: Design, slot: string): PrepareParams {
  return PrepareSchema.parse(design.prepare[slot] ?? {});
}
