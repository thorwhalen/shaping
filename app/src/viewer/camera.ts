/**
 * One definition of where the camera is for a given `View` and model size, used both on screen
 * ("reset view") and for every exported frame, so a turntable is the same on screen and on file.
 * Scene coordinates: three.js y-up; the model (z-up, millimetres) is turned once, in `Scene`.
 */
import type { Box3, Model, View } from 'shaping';

/** Distance of the camera from the centre, in multiples of the model's bounding radius. */
export const CAMERA_DISTANCE = 4;

export function modelRadius(b: Box3): number {
  const d = [0, 1, 2].map((i) => b.max[i] - b.min[i]);
  return Math.max(1, Math.hypot(d[0], d[1], d[2]) / 2);
}

/** Centre of the model in scene coordinates. */
export function modelCentre(b: Box3): [number, number, number] {
  return [(b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2, -(b.min[1] + b.max[1]) / 2];
}

export function cameraPose(view: View, b: Box3): { position: [number, number, number]; target: [number, number, number] } {
  const r = modelRadius(b) * CAMERA_DISTANCE;
  const az = (view.azimuthDeg * Math.PI) / 180;
  const el = (view.elevationDeg * Math.PI) / 180;
  const c = modelCentre(b);
  // Azimuth 0 looks from the front (scene +z), increasing counter-clockwise seen from above.
  return { position: [c[0] + r * Math.cos(el) * Math.sin(az), c[1] + r * Math.sin(el), c[2] + r * Math.cos(el) * Math.cos(az)], target: c };
}

export function lightDirection(view: View): [number, number, number] {
  const az = (view.lightAzimuthDeg * Math.PI) / 180;
  const el = (view.lightElevationDeg * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}

/**
 * The box the camera frames: the model's, grown to include the diagnostic walls when they are
 * shown, so the walls and the shadows on them are in view.
 */
export function framingBox(model: Model, view: View): Box3 {
  const b = model.diagnostics.bbox;
  const min = [...b.min] as [number, number, number];
  const max = [...b.max] as [number, number, number];
  if (!view.walls) return { min, max };
  for (const r of model.diagnostics.regions) {
    if (r.role !== 'target') continue;
    for (const p of r.polygons)
      for (const [u, v] of p.outer)
        for (let i = 0; i < 3; i++) {
          const x = r.origin[i] + u * r.u[i] + v * r.v[i];
          min[i] = Math.min(min[i], x);
          max[i] = Math.max(max[i], x);
        }
  }
  return { min, max };
}
