import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as shaping from 'shaping';
import { genres } from '../genres';

/** Field names marked render-only (`.meta({ render: true })`) in a schema, as the dials read them (nullable fields too). */
function renderMarked(schema: z.ZodType): string[] {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as { properties?: Record<string, { render?: boolean; anyOf?: { render?: boolean }[] }> };
  return Object.entries(json.properties ?? {})
    .filter(([, f]) => f.render === true || f.anyOf?.some((s) => s.render === true))
    .map(([k]) => k);
}

describe('render-only marks', () => {
  it('appear only on the View and Style schemas, the ones buildKey skips', () => {
    const marked: string[] = [];
    for (const [name, value] of Object.entries(shaping)) {
      if (value instanceof z.ZodObject && !['ViewSchema', 'StyleSchema'].includes(name) && renderMarked(value).length) marked.push(name);
    }
    for (const [id, genre] of Object.entries(genres)) {
      if (renderMarked(genre.params as z.ZodType).length) marked.push(`genre ${id}`);
    }
    expect(marked).toEqual([]);
  });

  it('reach nullable fields too', () => {
    expect(renderMarked(shaping.StyleSchema)).toEqual(expect.arrayContaining(['roughness', 'metalness']));
  });
});
