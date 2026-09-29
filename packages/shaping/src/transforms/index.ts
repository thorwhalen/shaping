/**
 * The 2D-to-3D transforms of v1: `extrude`, `revolve` and `radialArray`.
 *
 * Convention (the only place it is written): a part's figure lives in the model's xz plane, with
 * figure x -> model x and figure y -> model z ("up"). `FIGURE_TO_MODEL` is that placement. A
 * revolving transform turns about the vertical line x = axisX. Each transform states the plane
 * whose cut gives back the figure (`originalSlice`), and the core checks it on every build.
 */
import { z } from 'zod';
import { affineFromColumns, invertRigid } from '../geometry/affine.js';
import { defineTransform, type Transform } from '../genre.js';
import type { Kernel, Region, Solid } from '../kernel/types.js';

/** Figure (x, y, z) -> model (x, -z, y): the figure stands in the xz plane, extruded along y. */
export const FIGURE_TO_MODEL = affineFromColumns([1, 0, 0], [0, 0, 1], [0, -1, 0]);
/** Model -> figure coordinates; the figure plane is z = 0. */
export const MODEL_TO_FIGURE = invertRigid(FIGURE_TO_MODEL);

const HUGE = 1e4;
const halfPlane = (k: Kernel, side: 'right' | 'left'): Region =>
  k.region([{ outer: side === 'right' ? [[0, -HUGE], [HUGE, -HUGE], [HUGE, HUGE], [0, HUGE]] : [[-HUGE, -HUGE], [0, -HUGE], [0, HUGE], [-HUGE, HUGE]], holes: [] }]);

// ------------------------------------------------------------------ extrude

export const ExtrudeParams = z.object({
  depth: z.number().min(0.01).max(4).default(0.4).meta({ title: 'Depth', step: 0.01 }),
  twistDeg: z.number().min(-720).max(720).default(0).meta({ title: 'Twist', unit: '°', step: 1 }),
  scaleTop: z.number().min(0).max(3).default(1).meta({ title: 'Taper', step: 0.01 }),
  /** Build from the middle out, so the mid-plane is exactly the figure and the object is symmetric. */
  symmetric: z.boolean().default(true).meta({ title: 'Symmetric' }),
  /** Stepped layers instead of a smooth twist or taper; 0 means smooth. */
  steps: z.number().int().min(0).max(24).default(0).meta({ title: 'Steps' }),
});

function extrudeFigure(k: Kernel, r: Region, p: z.output<typeof ExtrudeParams>): Solid {
  const plain = p.twistDeg === 0 && p.scaleTop === 1;
  if (plain) return k.transform(k.extrude(r, p.depth, { center: true }), FIGURE_TO_MODEL);
  const h = p.symmetric ? p.depth / 2 : p.depth;
  let half: Solid;
  if (p.steps > 0) {
    // Stepped: a stack of flat layers, each rotated and scaled a little more than the last.
    const layers: Solid[] = [];
    for (let i = 0; i < p.steps; i++) {
      const f = (i + 0.5) / p.steps;
      const s = 1 + (p.scaleTop - 1) * f;
      const layer = k.transform2(r, { scale: Math.max(s, 1e-3), rotateDeg: p.twistDeg * f });
      layers.push(k.translate(k.extrude(layer, h / p.steps), [0, 0, (i * h) / p.steps]));
    }
    half = k.union(layers);
  } else {
    const divisions = p.twistDeg === 0 ? 0 : Math.max(8, Math.ceil(Math.abs(p.twistDeg) / 5));
    half = k.extrude(r, h, { twistDeg: p.twistDeg, scaleTop: [p.scaleTop, p.scaleTop], divisions });
  }
  const whole = p.symmetric ? k.union([half, k.mirror(half, [0, 0, 1])]) : k.translate(half, [0, 0, -h / 2]);
  return k.transform(whole, FIGURE_TO_MODEL);
}

export const extrude: Transform<z.output<typeof ExtrudeParams>> = defineTransform({
  id: 'extrude',
  title: 'Extrude',
  params: ExtrudeParams,
  build: (part, p, { kernel }) => extrudeFigure(kernel, part, p),
  originalSlice(part, p) {
    const exact = (p.twistDeg === 0 && p.scaleTop === 1) || p.symmetric;
    return exact ? { toPlane: MODEL_TO_FIGURE, target: part } : null;
  },
});

// ------------------------------------------------------------------ revolve

export const RevolveParams = z.object({
  angleDeg: z.number().min(1).max(360).default(360).meta({ title: 'Angle', unit: '°', step: 1 }),
  segments: z.number().int().min(8).max(256).default(96).meta({ title: 'Segments' }),
  /** Move the part away from the axis (> 0) or toward it, in figure units. */
  offset: z.number().min(-2).max(2).default(0).meta({ title: 'Axis offset', step: 0.01 }),
  /** What to do when the part crosses the axis. */
  policy: z.enum(['clip', 'both', 'refuse']).default('clip').meta({ title: 'Crossing the axis' }),
});

/** Split a part (already relative to the axis) into its right side and its mirrored left side. */
function sides(k: Kernel, r: Region) {
  const right = k.intersect2(r, halfPlane(k, 'right'));
  const left = k.transform2(k.intersect2(r, halfPlane(k, 'left')), { mirrorX: true });
  return { right, left, rightArea: k.area(right), leftArea: k.area(left) };
}

function revolveProfile(k: Kernel, part: Region, p: z.output<typeof RevolveParams>, axisX: number) {
  const rel = k.transform2(part, { translate: [-axisX + p.offset, 0] });
  const s = sides(k, rel);
  const eps = 1e-9;
  if (s.rightArea > eps && s.leftArea > eps && p.policy === 'refuse')
    throw new Error('This part crosses the revolve axis (policy "refuse"). Move the axis, add an offset, or choose "clip" or "both".');
  const profiles = p.policy === 'both' ? [s.right, s.left].filter((x) => k.area(x) > eps) : [s.rightArea >= s.leftArea ? s.right : s.left];
  const mirrored = p.policy !== 'both' && s.rightArea < s.leftArea;
  return { profiles, mirrored, crosses: s.rightArea > eps && s.leftArea > eps };
}

export const revolve: Transform<z.output<typeof RevolveParams>> = defineTransform({
  id: 'revolve',
  title: 'Revolve',
  params: RevolveParams,
  build(part, p, { kernel: k, axisX }) {
    const { profiles, mirrored } = revolveProfile(k, part, p, axisX);
    const solids = profiles.map((pr) => k.revolve(pr, { angleDeg: p.angleDeg, segments: p.segments }));
    let s = k.union(solids);
    // Centre a partial sweep on the figure plane, on the side of the axis the kept profile came from.
    if (p.angleDeg < 360) s = k.rotate(s, [0, 0, -p.angleDeg / 2 + (mirrored ? 180 : 0)]);
    return k.translate(s, [axisX - p.offset, 0, 0]);
  },
  originalSlice(part, p, { kernel: k, axisX }) {
    const { profiles, mirrored, crosses } = revolveProfile(k, part, p, axisX);
    if (p.policy === 'both' && crosses) return null;
    const [profile] = profiles;
    // Back to figure coordinates: the profile is on the right of the axis in the plane y = 0.
    const back = (r: Region) => k.transform2(r, { translate: [axisX - p.offset, 0] });
    const kept = back(profile);
    const opposite = back(k.transform2(profile, { mirrorX: true }));
    // A full turn also cuts the plane on the opposite side of the axis.
    const target = p.angleDeg >= 360 ? k.union2([kept, opposite]) : mirrored ? opposite : kept;
    return { toPlane: MODEL_TO_FIGURE, target };
  },
});

// ------------------------------------------------------------------ radial array

export const RadialParams = z.object({
  count: z.number().int().min(2).max(36).default(3).meta({ title: 'Copies' }),
  thickness: z.number().min(0.01).max(1).default(0.12).meta({ title: 'Thickness', step: 0.01 }),
  spanDeg: z.number().min(10).max(360).default(180).meta({ title: 'Span', unit: '°', step: 1 }),
});

export const radialArray: Transform<z.output<typeof RadialParams>> = defineTransform({
  id: 'radial',
  title: 'Radial array',
  params: RadialParams,
  build(part, p, { kernel: k, axisX }) {
    const slab = k.transform(k.extrude(part, p.thickness, { center: true }), FIGURE_TO_MODEL);
    const toAxis = k.translate(slab, [-axisX, 0, 0]);
    const copies = Array.from({ length: p.count }, (_, i) => k.rotate(toAxis, [0, 0, (i * p.spanDeg) / p.count]));
    return k.translate(k.union(copies), [axisX, 0, 0]);
  },
  originalSlice: (part) => ({ toPlane: MODEL_TO_FIGURE, target: part }),
});

/** The transform table. Adding a transform is adding an entry. */
export const TRANSFORMS = { extrude, revolve, radial: radialArray } as const;
export type TransformId = keyof typeof TRANSFORMS;

