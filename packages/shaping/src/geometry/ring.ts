/** Ring measurements shared by the kernel wrapper and the plain-data figure helpers. */
import type { Ring } from '../types.js';

/** Signed area of a ring (positive when counter-clockwise). */
export function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2;
}
