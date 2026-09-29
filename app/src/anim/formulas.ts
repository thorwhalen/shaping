/**
 * The formulas shaping offers: named, parametrized recipes that build an ordinary keyframe
 * sequence. previz's own `turntable` and `daylight` ("a full day of light") work as they are,
 * because shaping's state has the same `camera` orbit and `light` fields; `dialSweep` runs one of
 * the genre's dials, and is generated from the genre's parameter schema.
 */
import { buildFormula, daylight, sweep, turntable, type Formula } from 'previz/formulas';
import type { Genre } from 'shaping';
import { z } from 'zod';

/** Seconds a dial sweep lasts by default (there and back). */
const SWEEP_SECONDS = 4;

type Dial = { path: string; title: string; min: number; max: number; preferred: boolean };

/** The genre's numeric dials with a range, as dotted paths inside `params`. */
export function sweepableDials(genre: Genre<any>): Dial[] {
  type J = { type?: string; minimum?: number; maximum?: number; title?: string; sweep?: boolean; properties?: Record<string, J> };
  const out: Dial[] = [];
  const walk = (j: J, prefix: string) => {
    for (const [k, v] of Object.entries(j.properties ?? {})) {
      if ((v.type === 'number' || v.type === 'integer') && v.minimum !== undefined && v.maximum !== undefined)
        out.push({ path: prefix + k, title: v.title ?? k, min: v.minimum, max: v.maximum, preferred: Boolean(v.sweep) });
      else if (v.type === 'object' && v.properties) walk(v, `${prefix}${k}.`);
    }
  };
  walk(z.toJSONSchema(genre.params, { io: 'input', unrepresentable: 'any' }) as J, '');
  return out.sort((a, b) => Number(b.preferred) - Number(a.preferred));
}

/** "Run a dial": one of the genre's dials, from where it is to a value, there and back. */
export function dialSweep(genre: Genre<any>): Formula<any> | null {
  const dials = sweepableDials(genre);
  if (!dials.length) return null;
  const ids = dials.map((d) => d.path) as [string, ...string[]];
  const params = z
    .object({
      dial: z.enum(ids).default(ids[0]).meta({ title: 'Dial' }),
      to: z.number().optional().meta({ title: 'To (empty: the far end of its range)' }),
      seconds: z.number().positive().max(120).default(SWEEP_SECONDS).meta({ title: 'Seconds' }),
      pingPong: z.boolean().default(true).meta({ title: 'There and back' }),
    })
    .meta({ title: 'Run a dial' });
  return {
    id: 'dial-sweep',
    title: 'Run a dial',
    description: `Move one of the ${genre.title.toLowerCase()} dials from its current value to another, and back.`,
    params,
    loop: true,
    build: ({ dial, to, seconds, pingPong }: z.output<typeof params>, context) => {
      const d = dials.find((x) => x.path === dial)!;
      const now = Number((context.base.params as Record<string, unknown>) && dial.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], context.base.params));
      const target = to ?? (Math.abs(d.max - now) >= Math.abs(now - d.min) ? d.max : d.min);
      return buildFormula(sweep, { path: `params.${dial}`, to: target, seconds, pingPong }, context);
    },
  };
}

/** Everything the app offers, for this genre. */
export function shapingFormulas(genre: Genre<any>): Formula<any>[] {
  return [turntable, daylight, dialSweep(genre)].filter((f): f is Formula<any> => f !== null);
}
