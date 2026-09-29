/**
 * Turned components: one figure, split into parts; each part gets a 2D-to-3D transform (revolve,
 * extrude or radial array) and a colour, and the parts are assembled into one object that stands
 * in the xz plane, so the figure itself is (usually) a slice of the result.
 *
 * Imports only the core's public entry.
 */
import { z } from 'zod';
import { defineGenre, figureBounds, fitFigure, TRANSFORMS, type Region, type SlicePromise, type Solid, type TransformId } from '../core.js';

export const PartTransformSchema = z.object({
  kind: z.enum(['revolve', 'extrude', 'radial']).default('revolve').meta({ title: 'Transform' }),
  // revolve
  angleDeg: z.number().min(1).max(360).default(360).meta({ title: 'Angle', unit: '°', step: 1, when: { kind: ['revolve'] } }),
  offset: z.number().min(-2).max(2).default(0).meta({ title: 'Axis offset', step: 0.01, when: { kind: ['revolve'] } }),
  policy: z.enum(['clip', 'both', 'refuse']).default('clip').meta({ title: 'Crossing the axis', when: { kind: ['revolve'] } }),
  segments: z.number().int().min(8).max(256).default(96).meta({ title: 'Segments', when: { kind: ['revolve'] } }),
  // extrude
  depth: z.number().min(0.01).max(4).default(0.4).meta({ title: 'Depth', step: 0.01, when: { kind: ['extrude'] } }),
  twistDeg: z.number().min(-720).max(720).default(0).meta({ title: 'Twist', unit: '°', step: 1, when: { kind: ['extrude'] } }),
  scaleTop: z.number().min(0).max(3).default(1).meta({ title: 'Taper', step: 0.01, when: { kind: ['extrude'] } }),
  symmetric: z.boolean().default(true).meta({ title: 'Symmetric', when: { kind: ['extrude'] } }),
  steps: z.number().int().min(0).max(24).default(0).meta({ title: 'Steps', when: { kind: ['extrude'] } }),
  // radial array
  count: z.number().int().min(2).max(36).default(3).meta({ title: 'Copies', when: { kind: ['radial'] } }),
  thickness: z.number().min(0.01).max(1).default(0.12).meta({ title: 'Thickness', step: 0.01, when: { kind: ['radial'] } }),
  spanDeg: z.number().min(10).max(360).default(180).meta({ title: 'Span', unit: '°', step: 1, when: { kind: ['radial'] } }),
});
export type PartTransform = z.output<typeof PartTransformSchema>;

export const TurnedParams = z.object({
  /** Horizontal position of the vertical axis, relative to the figure's centre (the figure spans -1..1). */
  axis: z.number().min(-1.5).max(1.5).default(0).meta({ title: 'Axis position', step: 0.01 }),
  /** The transform every part gets unless it has its own. */
  transform: PartTransformSchema.default(PartTransformSchema.parse({})),
  /** Per-part overrides, keyed by part id. Only the fields given override the default. */
  parts: z.record(z.string(), PartTransformSchema.partial()).default({}),
  /** Parts left out of the object. */
  hidden: z.array(z.string()).default([]),
  /** A base under everything, to join loose parts. */
  base: z.enum(['none', 'disc', 'plate']).default('none').meta({ title: 'Base' }),
  baseThickness: z.number().min(0.01).max(0.5).default(0.08).meta({ title: 'Base thickness', step: 0.01 }),
});

export const turned = defineGenre({
  id: 'turned',
  title: 'Turned components',
  description: 'One figure, split into parts; each part is revolved, extruded or arrayed, and coloured on its own.',
  slots: [{ id: 'figure', title: 'Figure', hint: 'An image, drawing or shape. Each separate component becomes a part.' }],
  params: TurnedParams,
  build(figures, params, { kernel: k }) {
    const figure = fitFigure(figures.figure, 2, 'contain');
    const b = figureBounds(figure);
    const axisX = params.axis;
    const bodies: Array<{ partId: string; solid: Solid }> = [];
    const slices: SlicePromise[] = [];
    const warnings: string[] = [];
    for (const part of figure.parts) {
      if (params.hidden.includes(part.id)) continue;
      const choice: PartTransform = { ...params.transform, ...(params.parts[part.id] ?? {}) } as PartTransform;
      const t = TRANSFORMS[choice.kind as TransformId];
      const tp = t.params.parse(choice) as never;
      const region: Region = k.region(part.polygons);
      try {
        bodies.push({ partId: part.id, solid: t.build(region, tp, { kernel: k, axisX }) });
        const sl = t.originalSlice(region, tp, { kernel: k, axisX });
        if (sl) slices.push({ partId: part.id, label: `part ${part.id}`, ...sl });
      } catch (e) {
        warnings.push(`Part ${part.id}: ${(e as Error).message}`);
      }
    }
    if (params.base !== 'none' && bodies.length > 0 && b) {
      const all = k.union(bodies.map((x) => x.solid));
      const bb = k.bbox(all);
      const th = params.baseThickness;
      let base: Solid;
      if (params.base === 'disc') {
        const r = Math.max(Math.abs(bb.min[0] - axisX), Math.abs(bb.max[0] - axisX), Math.abs(bb.min[1]), Math.abs(bb.max[1])) * 1.05;
        const rect = k.region([{ outer: [[0, 0], [r, 0], [r, th], [0, th]], holes: [] }]);
        base = k.translate(k.revolve(rect, { segments: 96 }), [axisX, 0, bb.min[2] - th * 0.5]);
      } else {
        const m = 0.05;
        base = k.translate(k.box([bb.max[0] - bb.min[0] + 2 * m, bb.max[1] - bb.min[1] + 2 * m, th]), [bb.min[0] - m, bb.min[1] - m, bb.min[2] - th * 0.5]);
      }
      bodies.push({ partId: 'base', solid: base });
    }
    return { bodies, slices, warnings };
  },
});
