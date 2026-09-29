/**
 * Dials generated from a Zod schema. The schema is the single source of truth: this component
 * reads `z.toJSONSchema(schema)` — types, bounds, defaults, and the `.meta({ title, unit, step,
 * when })` each field carries — and renders a control per field. A dial that exists only here is a
 * bug; add the field to the schema instead.
 */
import { useMemo } from 'react';
import { z } from 'zod';
import { Slider } from './Slider';

type JS = {
  type?: string | string[];
  properties?: Record<string, JS>;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JS[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  default?: unknown;
  title?: string;
  description?: string;
  unit?: string;
  step?: number;
  when?: Record<string, unknown[]>;
  additionalProperties?: unknown;
};

/** Steps per slider range when a field does not give its own step. */
const DEFAULT_SLIDER_STEPS = 200;

const humanize = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).replace(/ Deg$/, '');

export interface DialsProps {
  schema: z.ZodType;
  value: Record<string, unknown>;
  onChange: (path: string, value: unknown) => void;
  /** Top-level keys not to render (handled by a custom control). */
  exclude?: string[];
  /** Top-level keys to render, in this order (default: all, in schema order). */
  only?: string[];
}

export function Dials({ schema, value, onChange, exclude = [], only }: DialsProps) {
  const json = useMemo(() => z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JS, [schema]);
  const keys = (only ?? Object.keys(json.properties ?? {})).filter((k) => !exclude.includes(k));
  return (
    <div className="flex flex-col gap-3">
      {keys.map((k) => json.properties?.[k] && <Field key={k} name={k} path={k} schema={json.properties[k]} value={value?.[k]} siblings={value} onChange={onChange} />)}
    </div>
  );
}

function Field({ name, path, schema, value, siblings, onChange }: { name: string; path: string; schema: JS; value: unknown; siblings: Record<string, unknown>; onChange: DialsProps['onChange'] }) {
  if (schema.when && !Object.entries(schema.when).every(([k, allowed]) => allowed.includes(siblings?.[k]))) return null;
  const title = schema.title ?? humanize(name);
  const nullable = schema.anyOf?.some((s) => s.type === 'null');
  const base: JS = schema.anyOf ? { ...schema, ...schema.anyOf.find((s) => s.type !== 'null') } : schema;
  const type = Array.isArray(base.type) ? base.type[0] : base.type;

  if (type === 'object' && base.properties) {
    const obj = (value ?? {}) as Record<string, unknown>;
    return (
      <details className="rounded-md border border-line bg-white/50 px-3 py-2">
        <summary className="cursor-pointer select-none text-sm font-medium">{title}</summary>
        <div className="mt-2 flex flex-col gap-3">
          {Object.entries(base.properties).map(([k, s]) => (
            <Field key={k} name={k} path={`${path}.${k}`} schema={s} value={obj[k]} siblings={obj} onChange={onChange} />
          ))}
        </div>
      </details>
    );
  }
  if (type === 'object') return null; // records and maps have custom controls

  if (base.enum) {
    const opts = base.enum as string[];
    return (
      <Row title={title}>
        {opts.length <= 4 ? (
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={title}>
            {opts.map((o) => (
              <button
                key={String(o)}
                role="radio"
                aria-checked={value === o}
                onClick={() => onChange(path, o)}
                className={`rounded px-2 py-0.5 text-xs border ${value === o ? 'border-accent bg-accent text-white' : 'border-line bg-white hover:border-muted'}`}
              >
                {String(o)}
                {base.unit && /^\d+$/.test(String(o)) ? base.unit : ''}
              </button>
            ))}
          </div>
        ) : (
          <select className="rounded border border-line bg-white px-1 py-0.5 text-xs" value={String(value)} onChange={(e) => onChange(path, e.target.value)} aria-label={title}>
            {opts.map((o) => (
              <option key={String(o)}>{String(o)}</option>
            ))}
          </select>
        )}
      </Row>
    );
  }

  if (type === 'boolean')
    return (
      <label className="flex cursor-pointer items-center justify-between gap-2 text-sm">
        <span>{title}</span>
        <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={Boolean(value)} onChange={(e) => onChange(path, e.target.checked)} />
      </label>
    );

  if (type === 'number' || type === 'integer') {
    const min = base.minimum ?? base.exclusiveMinimum ?? 0;
    const max = base.maximum ?? Math.max(1, Number(base.default ?? 1) * 4);
    const step = base.step ?? (type === 'integer' ? 1 : (max - min) / DEFAULT_SLIDER_STEPS);
    const isAuto = nullable && (value === null || value === undefined);
    const shown = isAuto ? Number(base.default ?? min) : Number(value ?? base.default ?? min);
    return (
      <Row title={title} extra={nullable ? (
        <label className="flex items-center gap-1 text-xs text-muted">
          <input type="checkbox" checked={isAuto} onChange={(e) => onChange(path, e.target.checked ? null : shown)} /> auto
        </label>
      ) : undefined}>
        <div className="flex items-center gap-2">
          <Slider
            label={title}
            min={min}
            max={max}
            step={step}
            value={shown}
            disabled={isAuto}
            restGhost={typeof base.default === 'number' ? base.default : undefined}
            onChange={(v) => onChange(path, type === 'integer' ? Math.round(v) : v)}
          />
          <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted">
            {isAuto ? 'auto' : formatNumber(shown, step)}
            {!isAuto && base.unit ? ` ${base.unit}` : ''}
          </span>
        </div>
      </Row>
    );
  }

  if (type === 'string' && typeof base.default === 'string' && base.default.startsWith('#'))
    return (
      <label className="flex items-center justify-between gap-2 text-sm">
        <span>{title}</span>
        <input type="color" className="h-6 w-10 cursor-pointer rounded border border-line" value={String(value ?? base.default)} onChange={(e) => onChange(path, e.target.value)} />
      </label>
    );

  return null;
}

function formatNumber(v: number, step: number): string {
  const digits = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
  return v.toFixed(digits);
}

function Row({ title, children, extra }: { title: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-sm">
        <span>{title}</span>
        {extra}
      </div>
      {children}
    </div>
  );
}
