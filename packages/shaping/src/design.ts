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

export const DESIGN_VERSION = 1 as const;

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
  n: z.number().int().min(3).max(64).default(5),
  /** Inner-to-outer radius ratio (ring, star) or width-to-height ratio (rect, cross). */
  ratio: z.number().min(0.05).max(20).default(0.5),
});

/** Text set in the built-in block font: each glyph is a union of cells, so letters are exact polygons. */
export const TextSourceSchema = z.object({
  kind: z.literal('text'),
  text: z.string().min(1).max(24),
  /** Rounds the corners of the cells, as a fraction of a cell. */
  round: z.number().min(0).max(0.5).default(0),
  /** Gap between glyphs, in cells. */
  spacing: z.number().min(0).max(3).default(1),
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
  /** How the mask is extracted from a raster image. */
  mode: z.enum(['auto', 'alpha', 'luminance', 'color', 'adaptive']).default('auto').meta({ title: 'Mask mode' }),
  /** Luminance threshold 0-255; null means "use Otsu's value". */
  threshold: z.number().min(0).max(255).nullable().default(null).meta({ title: 'Threshold' }),
  invert: z.boolean().default(false).meta({ title: 'Invert' }),
  /** Reference colour for mode "color". */
  color: z.string().default('#000000').meta({ title: 'Key colour' }),
  /** Colour distance tolerance for mode "color", 0-1. */
  tolerance: z.number().min(0).max(1).default(0.25).meta({ title: 'Colour tolerance' }),
  /** Adaptive threshold window (pixels) and offset. */
  window: z.number().int().min(3).max(201).default(31).meta({ title: 'Adaptive window', unit: 'px' }),
  offset: z.number().min(-50).max(50).default(5).meta({ title: 'Adaptive offset' }),
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
  colors: z.number().int().min(2).max(12).default(3).meta({ title: 'Colour clusters' }),
});

// ---------------------------------------------------------------- style, view, animation

export const MATERIAL_PRESETS = ['matte', 'glossy', 'brushed-metal', 'polished-metal', 'glass', 'resin'] as const;

export const StyleSchema = z.object({
  material: z.enum(MATERIAL_PRESETS).default('glossy').meta({ title: 'Material' }),
  color: z.string().default('#d4763b').meta({ title: 'Colour' }),
  /** Colour per part id; parts not listed use `color` or the palette. */
  partColors: z.record(z.string(), z.string()).default({}),
  /** Use a distinct palette colour per part when no colour is given. */
  palette: z.boolean().default(true).meta({ title: 'Colour parts' }),
  opacity: z.number().min(0.05).max(1).default(1).meta({ title: 'Opacity', step: 0.05 }),
  roughness: z.number().min(0).max(1).nullable().default(null).meta({ title: 'Roughness', step: 0.05 }),
  metalness: z.number().min(0).max(1).nullable().default(null).meta({ title: 'Metalness', step: 0.05 }),
  background: z.string().default('#f4f1ea').meta({ title: 'Background' }),
});

export const ViewSchema = z.object({
  camera: z.enum(['perspective', 'orthographic']).default('perspective'),
  /** Camera azimuth and elevation, in degrees. Animatable. */
  azimuthDeg: z.number().default(35).meta({ title: 'Azimuth', unit: '°' }),
  elevationDeg: z.number().min(-89).max(89).default(25).meta({ title: 'Elevation', unit: '°' }),
  /** Show the diagnostic walls (shadows) the genre provides. */
  walls: z.boolean().default(true).meta({ title: 'Shadow walls' }),
  ground: z.boolean().default(true).meta({ title: 'Ground shadow' }),
  /** Light direction: azimuth and elevation in degrees, and intensity. */
  lightAzimuthDeg: z.number().default(45).meta({ title: 'Light azimuth', unit: '°' }),
  lightElevationDeg: z.number().min(0).max(90).default(55).meta({ title: 'Light elevation', unit: '°' }),
  lightIntensity: z.number().min(0).max(6).default(2.2).meta({ title: 'Light', step: 0.1 }),
  lightColor: z.string().default('#ffffff').meta({ title: 'Light colour' }),
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

export const DesignSchema = z.object({
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
  /** Size of the longest edge of the finished object. */
  sizeMm: z.number().positive().max(2000).default(50).meta({ title: 'Size (longest edge)', unit: 'mm' }),
  style: StyleSchema.default(StyleSchema.parse({})),
  view: ViewSchema.default(ViewSchema.parse({})),
  animation: AnimationSchema.optional(),
});

export type Source = z.infer<typeof SourceSchema>;
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
export type Design = z.infer<typeof DesignSchema>;
export type DesignInput = z.input<typeof DesignSchema>;

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
