/**
 * Manufacturing process profiles: plain data records, read by the checks and the export menu.
 * Figures from print services, which are stricter than printer makers' (see the research report,
 * Part C). Adding a process is adding a row.
 */
export interface ProcessProfile {
  id: string;
  title: string;
  /** Thinnest wall that survives, in millimetres. */
  minWallMm: number;
  /** Whether a sealed internal cavity blocks export (resin and powder trap material inside). */
  sealedCavityBlocks: boolean;
  /** Drain holes to suggest for hollow parts: diameter in mm and count; null when not relevant. */
  drainHole: { diameterMm: number; count: number } | null;
  /** The file formats this process usually takes, best first. */
  formats: string[];
}

export const PROFILES: Record<string, ProcessProfile> = {
  fdm: { id: 'fdm', title: 'FDM, 0.4 mm nozzle', minWallMm: 0.9, sealedCavityBlocks: false, drainHole: null, formats: ['3mf', 'stl'] },
  resin: { id: 'resin', title: 'Resin (SLA/MSLA)', minWallMm: 0.6, sealedCavityBlocks: true, drainHole: { diameterMm: 3.5, count: 2 }, formats: ['stl', '3mf'] },
  nylon: { id: 'nylon', title: 'Nylon powder (SLS/MJF)', minWallMm: 0.8, sealedCavityBlocks: true, drainHole: { diameterMm: 4, count: 1 }, formats: ['stl', '3mf'] },
  metal: { id: 'metal', title: 'Metal', minWallMm: 1.0, sealedCavityBlocks: true, drainHole: null, formats: ['stl', '3mf'] },
  laser: { id: 'laser', title: 'Laser cutting / engraving', minWallMm: 1.0, sealedCavityBlocks: false, drainHole: null, formats: ['svg', 'dxf'] },
};

export const DEFAULT_PROFILE = 'fdm';

export interface LiveCheck {
  level: 'ok' | 'warn' | 'error';
  message: string;
}

/**
 * The checks that run on every build: not empty, size sane, pieces, and a thin-feature estimate
 * from the figures (the detailed thin-region overlay is drawn on the source image).
 */
export function liveChecks(m: { bodies: unknown[]; diagnostics: { pieces: number; volume: number; bbox: { min: number[]; max: number[] } } }, profile: ProcessProfile): LiveCheck[] {
  const out: LiveCheck[] = [];
  if (m.bodies.length === 0 || m.diagnostics.volume <= 0) return [{ level: 'error', message: 'Empty: there is nothing to print.' }];
  const ext = [0, 1, 2].map((i) => m.diagnostics.bbox.max[i] - m.diagnostics.bbox.min[i]);
  const smallest = Math.min(...ext);
  if (smallest < profile.minWallMm) out.push({ level: 'error', message: `Thinner than ${profile.minWallMm} mm overall (${smallest.toFixed(2)} mm): ${profile.title} cannot make it.` });
  if (m.diagnostics.pieces > 1) out.push({ level: 'warn', message: `${m.diagnostics.pieces} separate pieces.` });
  if (!out.length) out.push({ level: 'ok', message: `One piece, ${ext.map((e) => e.toFixed(1)).join(' × ')} mm.` });
  return out;
}
