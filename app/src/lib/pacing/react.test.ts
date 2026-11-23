import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { StyleSchema, ViewSchema } from 'shaping';
import { nextPaint, paintLoad, sharedLoad } from './pacer';
import { pacingFor } from './react';

describe('paint-only controls', () => {
  const app = { settled: async () => undefined, onGesture: () => undefined };

  it('time themselves by the next frame and their own load, and keep the shared gesture', () => {
    const own = pacingFor(app, { paintOnly: true });
    expect(own.settled).toBe(nextPaint);
    expect(own.load).toBe(paintLoad);
    expect(own.load).not.toBe(sharedLoad);
    expect(own.onGesture).toBe(app.onGesture);
    expect(pacingFor(app)).toBe(app);
  });

  it('are the fields the schema marks render-only, as the dials read them', () => {
    const marked = (schema: z.ZodType) =>
      Object.entries((z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as { properties: Record<string, { render?: boolean }> }).properties)
        .filter(([, f]) => f.render === true)
        .map(([k]) => k);
    expect(marked(ViewSchema)).toEqual(expect.arrayContaining(['azimuthDeg', 'lightAzimuthDeg', 'lightIntensity', 'zoom']));
    expect(marked(StyleSchema)).toEqual(expect.arrayContaining(['roughness', 'metalness', 'opacity']));
    expect(marked(ViewSchema)).not.toContain('wallGap'); // geometry: a rebuild
  });
});
