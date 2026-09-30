/**
 * The walls around the object, as plain geometry (model coordinates, millimetres, z up).
 *
 * - `shadow`: a panel behind each of the genre's shadow views, sized to frame its shadow;
 * - `corner`: three big walls on those same planes (or, for a genre without shadows, behind the
 *   object, on its left and under it), meeting at the edges like the corner of a room;
 * - `box`: a closed room of six (four walls, a floor, a ceiling), each opposite wall as far from the
 *   object as its partner.
 * Distances come from the shadow walls the build placed (so the drawn shadows lie on the walls), or,
 * without them, from `view.wallGap` times the object's extent. Every plane knows which way faces the
 * object, so the viewer can cut away the walls between the camera and the object.
 */
import type { Box3, Model, PlanarRegion, View } from 'shaping';

type Vec3 = [number, number, number];

export interface RoomPlane {
  id: string;
  /** Centre of the plane. */
  centre: Vec3;
  /** In-plane unit axes and the plane's size along them. */
  u: Vec3;
  v: Vec3;
  width: number;
  height: number;
  /** Unit normal pointing toward the object. */
  inward: Vec3;
}

const AXES: Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
/** Default corner, for genres without shadow walls: behind (max y), left (min x), under (min z). */
const DEFAULT_CORNER: Array<{ axis: number; side: 'min' | 'max' }> = [
  { axis: 1, side: 'max' },
  { axis: 0, side: 'min' },
  { axis: 2, side: 'min' },
];

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The shadow walls the build placed: one per view, as an axis, a side and a plane coordinate. */
export function shadowWalls(model: Model): Array<{ slot: string; axis: number; side: 'min' | 'max'; at: number; regions: PlanarRegion[] }> {
  const bySlot = new Map<string, PlanarRegion[]>();
  for (const r of model.diagnostics.regions)
    if (r.role === 'target' || r.role === 'achieved' || r.role === 'missing') bySlot.set(r.id.split(':')[0], [...(bySlot.get(r.id.split(':')[0]) ?? []), r]);
  const b = model.diagnostics.bbox;
  return [...bySlot].map(([slot, regions]) => {
    const n = cross(regions[0].u, regions[0].v);
    const axis = n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs)));
    const at = regions[0].origin[axis];
    const side: 'min' | 'max' = at <= (b.min[axis] + b.max[axis]) / 2 ? 'min' : 'max';
    return { slot, axis, side, at, regions };
  });
}

/** The room's inner box: the object's box grown to the walls, symmetric on each axis. */
export function roomBox(model: Model, view: View): Box3 {
  const b = model.diagnostics.bbox;
  const min = [...b.min] as Vec3;
  const max = [...b.max] as Vec3;
  const walls = shadowWalls(model);
  for (let a = 0; a < 3; a++) {
    const w = walls.find((x) => x.axis === a);
    const gap = w ? (w.side === 'min' ? b.min[a] - w.at : w.at - b.max[a]) : view.wallGap * (b.max[a] - b.min[a] || 1);
    min[a] = b.min[a] - gap;
    max[a] = b.max[a] + gap;
  }
  return { min, max };
}

/** The big walls of a `corner` or `box` room. */
export function roomPlanes(model: Model, view: View): RoomPlane[] {
  if (view.room !== 'corner' && view.room !== 'box') return [];
  const box = roomBox(model, view);
  const walls = shadowWalls(model);
  const faces: Array<{ axis: number; side: 'min' | 'max' }> =
    view.room === 'box'
      ? [0, 1, 2].flatMap((axis) => [{ axis, side: 'min' as const }, { axis, side: 'max' as const }])
      : walls.length
        ? walls.map((w) => ({ axis: w.axis, side: w.side }))
        : DEFAULT_CORNER;
  return faces.map(({ axis, side }) => {
    const [ua, va] = [0, 1, 2].filter((i) => i !== axis);
    const centre = [0, 1, 2].map((i) => (i === axis ? (side === 'min' ? box.min[i] : box.max[i]) : (box.min[i] + box.max[i]) / 2)) as Vec3;
    const inward = AXES[axis].map((x) => (side === 'min' ? x : -x)) as Vec3;
    return { id: `${side}-${'xyz'[axis]}`, centre, u: AXES[ua], v: AXES[va], width: box.max[ua] - box.min[ua], height: box.max[va] - box.min[va], inward };
  });
}
