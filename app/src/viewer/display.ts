/**
 * Display data of a body: its creased normals, as the viewer draws it. It is derived from the
 * model, not a different model, so the geometry worker computes it beside each build and
 * transfers the buffers (shaping#9): the page then only wraps them in a geometry, instead of
 * running `toCreasedNormals` on its own thread while a slider is dragged.
 *
 * The page keeps the transferred data keyed by the body's `positions` array: `recolor` spreads
 * a body into a new object but keeps its arrays, so a recoloured body still finds its display.
 * A body built anywhere else (a test, a future path) has none, and the viewer computes it.
 */
import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Body, Model } from 'shaping';

/** Normals are smoothed across edges flatter than this, and kept sharp across steeper ones. */
export const CREASE_ANGLE_DEG = 32;

/** A body ready to draw: non-indexed positions and their creased normals. */
export interface BodyDisplay {
  positions: Float32Array;
  normals: Float32Array;
}

/** The creased display data of an indexed mesh. Pure: runs in the worker or on the page. */
export function creasedDisplay(positions: Float32Array, indices: Uint32Array | Uint16Array, creaseAngleDeg = CREASE_ANGLE_DEG): BodyDisplay {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  const creased = toCreasedNormals(g, (creaseAngleDeg * Math.PI) / 180);
  g.dispose();
  const out = {
    positions: creased.getAttribute('position').array as Float32Array,
    normals: creased.getAttribute('normal').array as Float32Array,
  };
  creased.dispose();
  return out;
}

/** Display data of every body of `model`, in order (what a build response carries). */
export function modelDisplays(model: Model): BodyDisplay[] {
  return model.bodies.map((b) => creasedDisplay(b.positions, b.indices));
}

/** The buffers to transfer with `displays`. */
export const displayBuffers = (displays: BodyDisplay[]): ArrayBuffer[] => displays.flatMap((d) => [d.positions.buffer as ArrayBuffer, d.normals.buffer as ArrayBuffer]);

const known = new WeakMap<Float32Array, BodyDisplay>();

/** Keep `displays` (from the worker) for the bodies of `model`, which they were computed from. */
export function rememberDisplays(model: Model, displays: BodyDisplay[] | undefined): void {
  if (!displays || displays.length !== model.bodies.length) return;
  model.bodies.forEach((b, i) => known.set(b.positions, displays[i]));
}

/** A body's display data: the worker's when it sent one, else computed here. */
export function displayOf(body: Body): BodyDisplay {
  return known.get(body.positions) ?? creasedDisplay(body.positions, body.indices);
}

/** A three.js geometry over a body's display data (shares its arrays: no copy). */
export function displayGeometry(display: BodyDisplay): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(display.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(display.normals, 3));
  return g;
}
