/**
 * Small helpers for rigid motions stored as `Affine3` (4x3, column-major: three columns of the
 * linear part, then the translation), the format the kernel takes.
 */
import type { Affine3 } from '../kernel/types.js';
import type { Vec3 } from '../types.js';

export const IDENTITY: Affine3 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/** Build an affine map from the images of the three unit vectors and a translation. */
export function affineFromColumns(ex: Vec3, ey: Vec3, ez: Vec3, t: Vec3 = [0, 0, 0]): Affine3 {
  return [...ex, ...ey, ...ez, ...t] as Affine3;
}

export function applyAffine(m: Affine3, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[3] * p[1] + m[6] * p[2] + m[9],
    m[1] * p[0] + m[4] * p[1] + m[7] * p[2] + m[10],
    m[2] * p[0] + m[5] * p[1] + m[8] * p[2] + m[11],
  ];
}

/** `compose(a, b)` is the map "first b, then a". */
export function compose(a: Affine3, b: Affine3): Affine3 {
  const col = (i: number): Vec3 => {
    const v: Vec3 = [b[3 * i], b[3 * i + 1], b[3 * i + 2]];
    return [a[0] * v[0] + a[3] * v[1] + a[6] * v[2], a[1] * v[0] + a[4] * v[1] + a[7] * v[2], a[2] * v[0] + a[5] * v[1] + a[8] * v[2]];
  };
  return affineFromColumns(col(0), col(1), col(2), applyAffine(a, [b[9], b[10], b[11]]));
}

/** Inverse of a rigid motion (orthonormal linear part). */
export function invertRigid(m: Affine3): Affine3 {
  // The inverse of an orthonormal matrix is its transpose: columns become rows.
  const ex: Vec3 = [m[0], m[3], m[6]];
  const ey: Vec3 = [m[1], m[4], m[7]];
  const ez: Vec3 = [m[2], m[5], m[8]];
  const r = affineFromColumns(ex, ey, ez);
  const t = applyAffine(r, [m[9], m[10], m[11]]);
  return affineFromColumns(ex, ey, ez, [-t[0], -t[1], -t[2]]);
}

/** Scale the translation of a map, for when the whole model is scaled by `s`. */
export function scaleTranslation(m: Affine3, s: number): Affine3 {
  return [...m.slice(0, 9), m[9] * s, m[10] * s, m[11] * s] as Affine3;
}

export const translation = (t: Vec3): Affine3 => affineFromColumns([1, 0, 0], [0, 1, 0], [0, 0, 1], t);
