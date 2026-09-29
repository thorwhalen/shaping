/**
 * shaping's animatable state, as the previz library sees it, and the mapping to and from a Design.
 *
 * The state is a projection of the Design: the camera as one orbit (so it moves around its target
 * instead of swelling mid-move), the light (so previz's `daylight` formula works as is), the rest of
 * the view and style, the genre's parameters and the size. Sources, genre, id and title never
 * change during an animation: changing them is a cut, not a tween.
 *
 * `shapingSpace(genre)` declares each field's kind (angle, log number, colour, orbit); fields it does
 * not declare (enums, booleans) switch like discrete values, which is always correct.
 */
import type { Json, Space } from 'previz';
import { ViewSchema, StyleSchema, type Design, type Genre } from 'shaping';
import { z } from 'zod';

type JsonObject = { [key: string]: Json };

export interface ShapingState {
  [key: string]: Json;
  camera: { azimuth: number; elevation: number; distance: number; target: [number, number, number] };
  fov: number;
  zoom: number;
  light: { azimuth: number; elevation: number; intensity: number; color: string };
  view: JsonObject;
  style: JsonObject;
  params: JsonObject;
  sizeMm: number;
}

/** View fields carried by `camera`, `fov`, `zoom` and `light` rather than by `view`. */
const LIFTED_VIEW_KEYS = ['azimuthDeg', 'elevationDeg', 'distance', 'panX', 'panY', 'panZ', 'fovDeg', 'zoom', 'lightAzimuthDeg', 'lightElevationDeg', 'lightIntensity', 'lightColor'];

const omit = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

type JsonSchema = { type?: string | string[]; properties?: Record<string, JsonSchema>; default?: unknown; anyOf?: JsonSchema[]; unit?: string };
const jsonOf = (schema: z.ZodType) => z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema;

/** The Design's state as previz sees it. Genre parameters are complete (defaults filled in). */
export function stateFromDesign(d: Design, genre: Genre<any>): ShapingState {
  const v = d.view;
  return {
    camera: { azimuth: v.azimuthDeg, elevation: v.elevationDeg, distance: v.distance, target: [v.panX, v.panY, v.panZ] },
    fov: v.fovDeg,
    zoom: v.zoom,
    light: { azimuth: v.lightAzimuthDeg, elevation: v.lightElevationDeg, intensity: v.lightIntensity, color: v.lightColor },
    view: omit(v as Record<string, unknown>, LIFTED_VIEW_KEYS) as JsonObject,
    style: { ...d.style } as JsonObject,
    params: genre.params.parse(d.params) as JsonObject,
    sizeMm: d.sizeMm,
  };
}

/** Dotted paths of the genre's integer parameters (counts, segments): tweened, then rounded. */
export function integerPaths(genre: Genre<any>): string[] {
  const out: string[] = [];
  const walk = (j: JsonSchema, prefix: string) => {
    for (const [k, raw] of Object.entries(j.properties ?? {})) {
      const v = baseOf(raw);
      if (v.type === 'integer') out.push(prefix + k);
      else if (v.type === 'object' && v.properties) walk(v, `${prefix}${k}.`);
    }
  };
  walk(jsonOf(genre.params), '');
  return out;
}

function roundAt(o: Record<string, unknown>, path: string): Record<string, unknown> {
  const [head, ...rest] = path.split('.');
  const v = o[head];
  if (rest.length === 0) return typeof v === 'number' ? { ...o, [head]: Math.round(v) } : o;
  return v && typeof v === 'object' ? { ...o, [head]: roundAt(v as Record<string, unknown>, rest.join('.')) } : o;
}

/**
 * The Design showing a state: everything a state does not hold comes from `base`. With the genre,
 * its parameters are made valid for it: integers rounded (a count tweened from 3 to 6 passes 4.5),
 * and parameters of another genre dropped.
 */
export function designWithState(base: Design, s: ShapingState, genre?: Genre<any>): Design {
  return {
    ...base,
    view: {
      ...base.view,
      ...(s.view as Partial<Design['view']>),
      azimuthDeg: s.camera.azimuth,
      elevationDeg: s.camera.elevation,
      distance: s.camera.distance,
      panX: s.camera.target[0],
      panY: s.camera.target[1],
      panZ: s.camera.target[2],
      fovDeg: s.fov,
      zoom: s.zoom,
      lightAzimuthDeg: s.light.azimuth,
      // A day of light may dip the sun below the horizon; the scene's light stays at or above it.
      lightElevationDeg: clamp(s.light.elevation, 0, 90),
      lightIntensity: s.light.intensity,
      lightColor: s.light.color,
    },
    style: { ...base.style, ...(s.style as Partial<Design['style']>) },
    params: genre ? validParams(genre, { ...base.params, ...s.params }) : { ...base.params, ...s.params },
    sizeMm: s.sizeMm,
  };
}

function validParams(genre: Genre<any>, params: Record<string, unknown>): Record<string, unknown> {
  const rounded = integerPaths(genre).reduce(roundAt, params);
  const r = genre.params.safeParse(rounded);
  return r.success ? (r.data as Record<string, unknown>) : rounded;
}

const isColorDefault = (j: JsonSchema) => typeof j.default === 'string' && j.default.startsWith('#');
const baseOf = (j: JsonSchema): JsonSchema => (j.anyOf ? { ...j, ...j.anyOf.find((x) => x.type !== 'null') } : j);

/** Declare numbers and colours of an object schema, recursively, under a path prefix. */
function declare(json: JsonSchema, prefix: string, out: Space, skip: string[] = []): void {
  for (const [k, raw] of Object.entries(json.properties ?? {})) {
    if (skip.includes(k)) continue;
    const j = baseOf(raw);
    const type = Array.isArray(j.type) ? j.type[0] : j.type;
    const path = `${prefix}${k}`;
    if (type === 'number' || type === 'integer') out[path] = raw.anyOf ? { kind: 'discrete' } : j.unit === '°' ? { kind: 'angle', wrap: false } : { kind: 'number' };
    else if (type === 'string' && isColorDefault(j)) out[path] = { kind: 'color' };
    else if (type === 'object' && j.properties) declare(j, `${path}.`, out);
  }
}

/**
 * How each field of shaping's state moves, from the schemas' types and metadata. Angles in the
 * genre's dials (unit °) turn without wrapping (a twist of 720° is two turns, not none); nullable
 * numbers ("auto") switch, since null cannot be interpolated.
 */
export function shapingSpace(genre: Genre<any>): Space {
  const space: Space = {
    camera: { kind: 'orbit' },
    fov: { kind: 'number' },
    zoom: { kind: 'number', space: 'log' },
    'light.azimuth': { kind: 'angle' },
    'light.elevation': { kind: 'number' },
    'light.intensity': { kind: 'number' },
    'light.color': { kind: 'color' },
    sizeMm: { kind: 'number', space: 'log' },
  };
  declare(jsonOf(ViewSchema), 'view.', space, LIFTED_VIEW_KEYS);
  declare(jsonOf(StyleSchema), 'style.', space);
  declare(jsonOf(genre.params), 'params.', space);
  return space;
}
