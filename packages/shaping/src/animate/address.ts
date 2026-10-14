/**
 * Addressing inside a `Design`: a target (a section such as `params`, `view`, `style`, or the
 * pseudo-target `design` for top-level keys) and a dotted property path within it.
 *
 * Shared by the evaluator (`designAt`) and the exporter to an's timeline (`toAnTimeline`), so both
 * resolve a path, and read a tween's starting value, by the same rule. Not part of the public API.
 */
import type { Design } from '../design.js';

type Bag = Record<string, unknown>;

/** The pseudo-target addressing top-level keys of the Design itself (e.g. `sizeMm`). */
export const DESIGN_TARGET = 'design';
/** Only this section may gain new keys (genre parameters have defaults absent from the document). */
const OPEN_TARGET = 'params';

function isBag(x: unknown): x is Bag {
  return typeof x === 'object' && x !== null;
}

function rootOf(design: Design, target: string): Bag {
  const root: unknown = target === DESIGN_TARGET ? design : (design as unknown as Bag)[target];
  if (!isBag(root)) {
    throw new Error(`Unknown animation target "${target}": expected "${DESIGN_TARGET}" or a section of the design such as params, view, style`);
  }
  return root;
}

/** Find the container and key addressed by `property`. Throws naming the target and path. */
export function locate(design: Design, target: string, property: string): { parent: Bag; key: string } {
  const path = property.split('.');
  let node = rootOf(design, target);
  path.slice(0, -1).forEach((segment, depth) => {
    const next = node[segment];
    if (!isBag(next)) {
      throw new Error(`Unknown property path "${property}" in target "${target}": no "${path.slice(0, depth + 1).join('.')}"`);
    }
    node = next;
  });
  const key = path[path.length - 1];
  if (!(key in node) && target !== OPEN_TARGET) {
    throw new Error(`Unknown property path "${property}" in target "${target}"`);
  }
  return { parent: node, key };
}

/** The number at `target.property` in `design`. Throws when it is missing or not a number. */
export function readNumber(design: Design, target: string, property: string): number {
  const { parent, key } = locate(design, target, property);
  const value = parent[key];
  if (typeof value !== 'number') throw new Error(`Cannot tween "${target}.${property}": its value is not a number`);
  return value;
}
