/**
 * The one place that converts axes and units.
 *
 * The model is millimetres with +Z up. Printing formats (3MF, STL, OBJ, PLY, and the 2D laser
 * files) keep it as is. Viewing formats (GLB) are metres with +Y up. PLY is treated as a printing
 * format: it is a mesh-processing interchange with no unit field, and the tools that read it
 * (slicers, MeshLab, CAD) expect the same frame as STL.
 */

/** Which frame a format expects. */
export type AxisConvention = 'print' | 'view';

/** Millimetres in one metre. */
export const MM_PER_METRE = 1000;

/** Convert a model-frame xyz array (mm, +Z up) into the frame a format expects. Returns a new array. */
export function convertPositions(positions: ArrayLike<number>, convention: AxisConvention): Float32Array {
  const out = new Float32Array(positions.length);
  if (convention === 'print') {
    for (let i = 0; i < positions.length; i++) out[i] = positions[i];
    return out;
  }
  // Rotation of -90 degrees about X (z up -> y up, no mirroring) and mm -> m.
  for (let i = 0; i < positions.length; i += 3) {
    out[i] = positions[i] / MM_PER_METRE;
    out[i + 1] = positions[i + 2] / MM_PER_METRE;
    out[i + 2] = -positions[i + 1] / MM_PER_METRE;
  }
  return out;
}
