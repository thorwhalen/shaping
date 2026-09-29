/**
 * The core's public entry: everything a genre, a transform or an application needs, and nothing
 * that depends on a particular genre. Genres import from here and only from here (a test enforces
 * it), so a genre can move to its own package without changing a line.
 */
export * from './types.js';
export * from './design.js';
export * from './genre.js';
export * from './kernel/types.js';
export { manifoldKernel, type LoadManifoldOptions } from './kernel/manifold.js';
export * from './geometry/affine.js';
export { ringArea } from './geometry/ring.js';
export * from './figure.js';
export * from './sources/index.js';
export { BLOCK_FONT_CHARS, glyphCells } from './sources/blockfont.js';
export * from './build.js';
export * from './transforms/index.js';
