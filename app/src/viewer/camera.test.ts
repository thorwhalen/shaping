import { describe, expect, it } from 'vitest';
import { ViewSchema, type Box3 } from 'shaping';
import { cameraFor, poseFromCamera, samePose } from './camera';

const box: Box3 = { min: [-20, -10, 0], max: [30, 10, 40] };

describe('camera pose', () => {
  it('a pose read from the camera round-trips through the design', () => {
    for (const kind of ['perspective', 'orthographic'] as const) {
      const view = ViewSchema.parse({ camera: kind, azimuthDeg: -120, elevationDeg: 33, distance: 2.7, panX: 0.3, panY: -0.2, panZ: 0.1, zoom: 2.5 });
      const spec = cameraFor(view, box);
      const back = poseFromCamera(spec.position, spec.target, spec.zoom, box, kind);
      expect(samePose(back, view)).toBe(true);
      const again = cameraFor({ ...view, ...back }, box);
      again.position.forEach((x, i) => expect(x).toBeCloseTo(spec.position[i], 6));
      again.target.forEach((x, i) => expect(x).toBeCloseTo(spec.target[i], 6));
      expect(again.zoom).toBeCloseTo(spec.zoom, 9);
      if (kind === 'perspective') expect(back.zoom).toBeUndefined();
    }
  });

  it('the defaults reproduce the earlier framing (distance 4 radii, no pan, 35° field of view)', () => {
    const spec = cameraFor(ViewSchema.parse({}), box);
    const r = Math.hypot(50, 20, 40) / 2;
    const d = Math.hypot(...spec.position.map((x, i) => x - spec.target[i]));
    expect(d).toBeCloseTo(4 * r, 6);
    expect(spec.fovDeg).toBe(35);
    [5, 20, 0].forEach((x, i) => expect(spec.target[i]).toBeCloseTo(x, 9));
  });
});

describe('clampPose', () => {
  it('keeps a written-back pose inside the schema, so the design always validates', async () => {
    const { clampPose } = await import('./camera');
    const p = clampPose({ azimuthDeg: 10, elevationDeg: 89.9999, distance: 500, panX: 99, zoom: 1e6 });
    expect(ViewSchema.safeParse({ ...ViewSchema.parse({}), ...p }).success).toBe(true);
    expect(p.elevationDeg).toBe(89);
  });
});
