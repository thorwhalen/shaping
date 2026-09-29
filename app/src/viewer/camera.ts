/**
 * One definition of where the camera is for a given `View` and model size, used both on screen
 * ("reset view") and for every exported frame, so a turntable is the same on screen and on file.
 * Scene coordinates: three.js y-up; the model (z-up, millimetres) is turned once, in `Scene`.
 */
import type { Box3, Model, View } from 'shaping';

/** Half the height the orthographic camera shows at zoom 1, in framed radii. */
export const ORTHO_HALF_HEIGHT_RADII = 1.6;
/** Near and far clipping planes, in framed radii. */
const NEAR_RADII = 0.01;
const FAR_RADII = 400;

export function modelRadius(b: Box3): number {
  const d = [0, 1, 2].map((i) => b.max[i] - b.min[i]);
  return Math.max(1, Math.hypot(d[0], d[1], d[2]) / 2);
}

/** Centre of the model in scene coordinates. */
export function modelCentre(b: Box3): Vec3 {
  return [(b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2, -(b.min[1] + b.max[1]) / 2];
}

type Vec3 = [number, number, number];
const RAD = Math.PI / 180;

/** The camera pose fields of a View (angles in degrees; distance and pan in framed radii). */
export type CameraPoseFields = Pick<View, 'azimuthDeg' | 'elevationDeg' | 'distance' | 'panX' | 'panY' | 'panZ' | 'fovDeg' | 'zoom'>;

/**
 * Everything needed to set up a camera, for the screen and for every exported frame alike — so an
 * export is the view on screen. Pure: no three.js here, so it is testable and shared.
 */
export interface CameraSpec {
  kind: View['camera'];
  position: Vec3;
  target: Vec3;
  fovDeg: number;
  /** Orthographic: half the visible height at zoom 1, in scene units. */
  halfHeight: number;
  zoom: number;
  near: number;
  far: number;
}

export function cameraFor(view: View, box: Box3): CameraSpec {
  const r = modelRadius(box);
  const c = modelCentre(box);
  const target: Vec3 = [c[0] + view.panX * r, c[1] + view.panY * r, c[2] + view.panZ * r];
  const d = view.distance * r;
  const az = view.azimuthDeg * RAD, el = view.elevationDeg * RAD;
  // Azimuth 0 looks from the front (scene +z), increasing counter-clockwise seen from above.
  const position: Vec3 = [target[0] + d * Math.cos(el) * Math.sin(az), target[1] + d * Math.sin(el), target[2] + d * Math.cos(el) * Math.cos(az)];
  return { kind: view.camera, position, target, fovDeg: view.fovDeg, halfHeight: ORTHO_HALF_HEIGHT_RADII * r, zoom: view.camera === 'orthographic' ? view.zoom : 1, near: NEAR_RADII * r, far: FAR_RADII * r };
}

/** The inverse of `cameraFor`: read a pose back from a live camera (position, target, zoom). */
export function poseFromCamera(position: Vec3, target: Vec3, zoom: number, box: Box3, kind: View['camera']): Omit<CameraPoseFields, 'fovDeg' | 'zoom'> & { zoom?: number } {
  const r = modelRadius(box);
  const c = modelCentre(box);
  const v: Vec3 = [position[0] - target[0], position[1] - target[1], position[2] - target[2]];
  const d = Math.hypot(...v) || 1e-9;
  return {
    azimuthDeg: Math.atan2(v[0], v[2]) / RAD,
    elevationDeg: Math.asin(Math.max(-1, Math.min(1, v[1] / d))) / RAD,
    distance: d / r,
    panX: (target[0] - c[0]) / r,
    panY: (target[1] - c[1]) / r,
    panZ: (target[2] - c[2]) / r,
    // Only an orthographic camera zooms; a perspective one dollies (distance), so zoom is not read.
    ...(kind === 'orthographic' ? { zoom } : {}),
  };
}

/** The pose a camera spec stands for, compared field by field with a tolerance (for write-back). */
export function samePose(a: Partial<CameraPoseFields>, b: Partial<CameraPoseFields>, eps = 1e-3): boolean {
  const keys = ['azimuthDeg', 'elevationDeg', 'distance', 'panX', 'panY', 'panZ', 'zoom'] as const;
  return keys.every((k) => {
    const x = a[k], y = b[k];
    if (x === undefined || y === undefined) return true;
    if (k === 'azimuthDeg') return Math.abs((((x - y) % 360) + 540) % 360 - 180) < eps * 100;
    return Math.abs(x - y) < eps * Math.max(1, Math.abs(y));
  });
}

/** Kept for callers of the earlier API: position and target of the camera for a view. */
export function cameraPose(view: View, b: Box3): { position: Vec3; target: Vec3 } {
  const s = cameraFor(view, b);
  return { position: s.position, target: s.target };
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
