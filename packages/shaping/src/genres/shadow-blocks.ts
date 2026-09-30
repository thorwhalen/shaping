/**
 * Shadow blocks (Hofstadter's trip-let): one solid whose three orthogonal shadows are three
 * given figures. Each figure is extruded along its view axis and the three are intersected; the
 * result is the largest solid with those shadows, and its actual shadows can only lose area, never
 * gain it. The core's checker measures what is lost and marks it on the walls.
 *
 * Axis convention (the only place it is written): the model's z is up.
 * - `front` is seen along +y and lives in (x, z);
 * - `side`  is seen along -x and lives in (y, z);
 * - `top`   is seen along -z and lives in (x, y).
 * `VIEWS[slot]` maps model coordinates to that view's (u, v, w), with the figure in (u, v).
 *
 * Imports only the core's public entry.
 */
import { z } from 'zod';
import { affineFromColumns, defineGenre, fitFigure, invertRigid, type Affine3, type Figure, type Kernel, type Region, type ShadowPromise, type Solid } from '../core.js';

export const SLOT_IDS = ['front', 'side', 'top'] as const;
export type SlotId = (typeof SLOT_IDS)[number];

export const VIEWS: Record<SlotId, Affine3> = {
  // (x, y, z) -> (x, z, -y)
  front: affineFromColumns([1, 0, 0], [0, 0, -1], [0, 1, 0]),
  // (x, y, z) -> (y, z, x)
  side: affineFromColumns([0, 0, 1], [1, 0, 0], [0, 1, 0]),
  // (x, y, z) -> (x, y, z)
  top: affineFromColumns([1, 0, 0], [0, 1, 0], [0, 0, 1]),
};

const PlacementSchema = z.object({
  scale: z.number().min(0.2).max(2).default(1).meta({ title: 'Scale', step: 0.01 }),
  offsetU: z.number().min(-1).max(1).default(0).meta({ title: 'Shift across', step: 0.01 }),
  offsetV: z.number().min(-1).max(1).default(0).meta({ title: 'Shift up', step: 0.01 }),
  rotate: z.enum(['0', '90', '180', '270']).default('0').meta({ title: 'Rotate', unit: '°' }),
  mirror: z.boolean().default(false).meta({ title: 'Mirror' }),
});
export type Placement = z.output<typeof PlacementSchema>;
const defaultPlacement = PlacementSchema.parse({});

/** Every way to assign the three sources to the three views: the source for front, side, top. */
export const ASSIGNMENTS = ['front,side,top', 'front,top,side', 'side,front,top', 'side,top,front', 'top,front,side', 'top,side,front'] as const;

/** The block the three shadows are carved from: its shape and relative proportions. */
export const BlockSchema = z.object({
  shape: z.enum(['box', 'cylinder', 'sphere']).default('box').meta({ title: 'Block' }),
  width: z.number().min(0.2).max(5).default(1).meta({ title: 'Width (x)', step: 0.05 }),
  depth: z.number().min(0.2).max(5).default(1).meta({ title: 'Depth (y)', step: 0.05 }),
  height: z.number().min(0.2).max(5).default(1).meta({ title: 'Height (z)', step: 0.05 }),
});
export type Block = z.output<typeof BlockSchema>;
const defaultBlock = BlockSchema.parse({});

/** Segments of the ellipse that bounds a cylinder or sphere block. */
const ROUND_BLOCK_SEGMENTS = 96;

/** Half extents of the block along x, y and z; the longest is 1, so a cube spans -1..1. */
export function blockHalfExtents(b: Block): [number, number, number] {
  const m = Math.max(b.width, b.depth, b.height);
  return [b.width / m, b.depth / m, b.height / m];
}

/** Each view's rectangle as half extents (u, v): front (x, z), side (y, z), top (x, y). */
function viewHalf(b: Block, view: SlotId): [number, number] {
  const [hx, hy, hz] = blockHalfExtents(b);
  return view === 'front' ? [hx, hz] : view === 'side' ? [hy, hz] : [hx, hy];
}

export const ShadowParams = z.object({
  block: BlockSchema.default(defaultBlock),
  /** Fit each figure into the same square, keeping its proportions (contain) or filling it (stretch). */
  fit: z.enum(['contain', 'stretch']).default('contain').meta({ title: 'Fit' }),
  /** Which source goes to which view. "side,front,top" puts the side source on the front view, and so on. */
  assign: z.enum(ASSIGNMENTS).default('front,side,top').meta({ title: 'Assignment' }),
  placement: z
    .object({ front: PlacementSchema.default(defaultPlacement), side: PlacementSchema.default(defaultPlacement), top: PlacementSchema.default(defaultPlacement) })
    .default({ front: defaultPlacement, side: defaultPlacement, top: defaultPlacement }),
  /** Added to every figure so the shadows agree: a border, or a bar along the bottom. */
  frame: z.enum(['none', 'border', 'base-bar']).default('none').meta({ title: 'Frame' }),
  frameWidth: z.number().min(0.02).max(0.5).default(0.12).meta({ title: 'Frame width', step: 0.01 }),
  /** Grow every figure outward before intersecting (thin strokes make fragile solids). */
  thicken: z.number().min(0).max(0.3).default(0).meta({ title: 'Thicken', step: 0.005, sweep: true }),
  /** Drop pieces smaller than this share of the largest piece's volume. */
  dropDust: z.number().min(0).max(1).default(0.01).meta({ title: 'Drop small pieces', step: 0.005 }),
  keepLargest: z.boolean().default(false).meta({ title: 'Keep only the largest piece' }),
  basePlate: z.boolean().default(false).meta({ title: 'Base plate' }),
  baseThickness: z.number().min(0.02).max(0.5).default(0.1).meta({ title: 'Base thickness', step: 0.01 }),
});
export type ShadowParamsT = z.output<typeof ShadowParams>;

/** Place a fitted figure region: mirror, rotate, scale, shift. */
function placeRegion(k: Kernel, r: Region, p: Placement): Region {
  return k.transform2(r, { mirrorX: p.mirror, rotateDeg: Number(p.rotate), scale: p.scale, translate: [p.offsetU, p.offsetV] });
}

/** A border around the view's rectangle (half extents hu, hv), or a bar along its bottom. */
function frameRegion(k: Kernel, kind: 'border' | 'base-bar', w: number, hu: number, hv: number): Region {
  const ou = hu + w, ov = hv + w;
  if (kind === 'base-bar') return k.region([{ outer: [[-ou, -ov], [ou, -ov], [ou, -hv], [-ou, -hv]], holes: [] }]);
  return k.region([{ outer: [[-ou, -ov], [ou, -ov], [ou, ov], [-ou, ov]], holes: [[[-hu, -hv], [-hu, hv], [hu, hv], [hu, -hv]]] }]);
}

/** The block's own solid, for shapes that cut more than the three extrusions do. */
function blockSolid(k: Kernel, b: Block, margin: number): Solid | null {
  if (b.shape === 'box') return null;
  const [hx, hy, hz] = blockHalfExtents(b);
  if (b.shape === 'cylinder') {
    const ellipse = Array.from({ length: ROUND_BLOCK_SEGMENTS }, (_, i): [number, number] => {
      const a = (2 * Math.PI * i) / ROUND_BLOCK_SEGMENTS;
      return [hx * Math.cos(a), hy * Math.sin(a)];
    });
    return k.extrude(k.region([{ outer: ellipse, holes: [] }]), 2 * (hz + margin), { center: true });
  }
  // An ellipsoid: a unit sphere (a revolved half disc), scaled to the half extents.
  const half = Array.from({ length: ROUND_BLOCK_SEGMENTS / 2 + 1 }, (_, i): [number, number] => {
    const a = -Math.PI / 2 + (Math.PI * i) / (ROUND_BLOCK_SEGMENTS / 2);
    return [Math.max(0, Math.cos(a)), Math.sin(a)];
  });
  return k.scale(k.revolve(k.region([{ outer: half, holes: [] }]), { segments: ROUND_BLOCK_SEGMENTS }), [hx, hy, hz]);
}

export const shadowBlocks = defineGenre({
  id: 'shadow-blocks',
  title: 'Shadow blocks',
  description: 'One solid whose three shadows are three figures: the trip-let on the cover of Gödel, Escher, Bach.',
  starter: {
    front: { kind: 'text', text: 'G', round: 0.15, spacing: 1 },
    side: { kind: 'text', text: 'E', round: 0.15, spacing: 1 },
    top: { kind: 'text', text: 'B', round: 0.15, spacing: 1 },
  },
  slots: [
    { id: 'front', title: 'Front shadow', hint: 'Seen from the front, on the back wall.' },
    { id: 'side', title: 'Side shadow', hint: 'Seen from the right, on the left wall.' },
    { id: 'top', title: 'Top shadow', hint: 'Seen from above, on the floor.' },
  ],
  params: ShadowParams,
  slotFrame(params, slot) {
    // A slot's figure is shown on the view the assignment gives it.
    const view = SLOT_IDS[(params.assign.split(',') as SlotId[]).indexOf(slot as SlotId)] ?? (slot as SlotId);
    const [hu, hv] = viewHalf(params.block, view);
    return [2 * hu, 2 * hv];
  },
  build(figures, params, { kernel: k }) {
    const order = params.assign.split(',') as SlotId[];
    const warnings: string[] = [];
    const regions = {} as Record<SlotId, Region>;
    const components = {} as Record<SlotId, number>;
    SLOT_IDS.forEach((view, i) => {
      const src: Figure = figures[order[i]];
      const [hu, hv] = viewHalf(params.block, view);
      let r = k.region(fitFigure(src, [2 * hu, 2 * hv], params.fit).parts.flatMap((p) => p.polygons));
      r = placeRegion(k, r, params.placement[view]);
      if (params.frame !== 'none') r = k.union2([r, frameRegion(k, params.frame, params.frameWidth, hu, hv)]);
      if (params.thicken > 0) r = k.offset2(r, params.thicken, 'round');
      regions[view] = r;
      components[view] = k.components2(r).length;
    });

    let reach = 0;
    for (const v of SLOT_IDS) {
      const b = k.bounds2(regions[v]);
      reach = Math.max(reach, ...b.min.map(Math.abs), ...b.max.map(Math.abs));
    }
    const length = 2 * reach * 1.1;
    const prisms = SLOT_IDS.map((v) => k.transform(k.extrude(regions[v], length, { center: true }), invertRigid(VIEWS[v])));
    let solid: Solid = k.intersect(prisms);
    const shape = blockSolid(k, params.block, params.frame !== 'none' ? params.frameWidth : 0);
    if (shape) solid = k.intersect([solid, shape]);

    // Pieces: drop dust, or keep the largest only.
    const pieces = k.decompose(solid);
    if (pieces.length > 1) {
      const vols = pieces.map((p) => k.volume(p));
      const max = Math.max(...vols);
      const kept = pieces.filter((_, i) => (params.keepLargest ? vols[i] === max : vols[i] >= params.dropDust * max));
      if (kept.length < pieces.length) {
        warnings.push(`Dropped ${pieces.length - kept.length} small piece(s); the shadows were checked again after dropping them.`);
        solid = k.union(kept);
      }
      if (kept.length > 1) {
        const forced = SLOT_IDS.filter((v) => components[v] > 1);
        warnings.push(
          forced.length
            ? `Forced disconnection: the ${forced.join(' and ')} figure${forced.length > 1 ? 's have' : ' has'} separate components. Add a frame or a base bar, or a base plate.`
            : 'Incidental disconnection: the joining material falls outside another figure. Shift or scale a figure, try another assignment, or add a base bar.',
        );
      }
    }

    const bodies: Array<{ partId: string; solid: Solid; yields?: boolean }> = [{ partId: 'solid', solid }];
    if (params.basePlate && !k.isEmpty(solid)) {
      const bb = k.bbox(solid);
      const th = params.baseThickness;
      const m = 0.05;
      const plate = k.translate(k.box([bb.max[0] - bb.min[0] + 2 * m, bb.max[1] - bb.min[1] + 2 * m, th]), [bb.min[0] - m, bb.min[1] - m, bb.min[2] - th * 0.5]);
      bodies.push({ partId: 'base', solid: plate, yields: true });
    }
    // The shadows are promised by the block alone; a base plate is not part of the illusion.
    const shadows: ShadowPromise[] = SLOT_IDS.map((v) => ({ slot: v, label: v, toView: VIEWS[v], target: regions[v], excludeParts: ['base'] }));
    return { bodies, shadows, warnings };
  },
});
