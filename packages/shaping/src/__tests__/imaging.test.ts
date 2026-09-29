import { encode } from 'fast-png';
import { beforeAll, describe, expect, it } from 'vitest';
import { build, manifoldKernel, PrepareSchema, type Figure, type Kernel, type PrepareParams } from '../index.js';
import {
  decodeImage,
  defaultResolvers,
  drawingToFigure,
  imageToFigure,
  labelComponents,
  prepareMask,
  signedDistanceField,
  svgToFigure,
  thinFeatures,
  type RGBAImage,
} from '../imaging/index.js';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await manifoldKernel();
});

const prep = (over: Partial<PrepareParams> = {}): PrepareParams => PrepareSchema.parse(over);

/** Build an RGBA image from a per-pixel function returning [r, g, b, a?]. */
function paint(width: number, height: number, f: (x: number, y: number) => number[]): RGBAImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = f(x + 0.5, y + 0.5);
      data.set([r, g, b, a], (y * width + x) * 4);
    }
  return { width, height, data };
}

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];
const disc = (cx: number, cy: number, r: number) => (x: number, y: number) => Math.hypot(x - cx, y - cy) <= r;
const onWhite = (inside: (x: number, y: number) => boolean) => (x: number, y: number) => (inside(x, y) ? BLACK : WHITE);
const areaOf = (fig: Figure, id?: string) =>
  fig.parts
    .filter((p) => !id || p.id === id)
    .flatMap((p) => p.polygons)
    .reduce((s, g) => s + shoelace(g.outer) - g.holes.reduce((h, r) => h + shoelace(r), 0), 0);
const shoelace = (r: [number, number][]) => Math.abs(r.reduce((s, p, i) => s + (r[(i + 1) % r.length][0] - p[0]) * (r[(i + 1) % r.length][1] + p[1]), 0)) / 2;
const signed = (r: [number, number][]) => r.reduce((s, p, i) => s + (p[0] - r[(i + 1) % r.length][0]) * (p[1] + r[(i + 1) % r.length][1]), 0) / 2;

describe('raster figures', () => {
  it('a black disc on white is one part with area within 1% of pi r^2, outer ring counter-clockwise', () => {
    const fig = imageToFigure(paint(300, 300, onWhite(disc(150, 150, 100))), prep(), { kernel });
    expect(fig.units).toBe('px');
    expect(fig.parts).toHaveLength(1);
    expect(fig.parts[0].id).toBe('c1');
    expect(Math.abs(areaOf(fig) / (Math.PI * 100 ** 2) - 1)).toBeLessThan(0.01);
    expect(signed(fig.parts[0].polygons[0].outer)).toBeGreaterThan(0);
  });

  it('a ring keeps its hole (clockwise), and filling holes removes it', () => {
    const ring = (x: number, y: number) => disc(150, 150, 100)(x, y) && !disc(150, 150, 50)(x, y);
    const fig = imageToFigure(paint(300, 300, onWhite(ring)), prep(), { kernel });
    expect(fig.parts).toHaveLength(1);
    expect(fig.parts[0].polygons[0].holes).toHaveLength(1);
    expect(signed(fig.parts[0].polygons[0].holes[0])).toBeLessThan(0);
    expect(Math.abs(areaOf(fig) / (Math.PI * (100 ** 2 - 50 ** 2)) - 1)).toBeLessThan(0.01);
    const filled = imageToFigure(paint(300, 300, onWhite(ring)), prep({ fillHoles: true }), { kernel });
    expect(filled.parts[0].polygons[0].holes).toHaveLength(0);
  });

  it('two blobs are two parts, largest first', () => {
    const fig = imageToFigure(paint(400, 200, onWhite((x, y) => disc(100, 100, 70)(x, y) || disc(310, 100, 40)(x, y))), prep(), { kernel });
    expect(fig.parts.map((p) => p.id)).toEqual(['c1', 'c2']);
    expect(areaOf(fig, 'c1')).toBeGreaterThan(areaOf(fig, 'c2'));
    const one = imageToFigure(paint(400, 200, onWhite((x, y) => disc(100, 100, 70)(x, y) || disc(310, 100, 40)(x, y))), prep({ split: 'none' }), { kernel });
    expect(one.parts).toHaveLength(1);
    expect(one.parts[0].polygons).toHaveLength(2);
  });

  it('measures a bar of known width, and flags it only where it is thinner than asked', () => {
    const bar = paint(200, 60, onWhite((x, y) => x > 20 && x < 180 && y > 24 && y < 36)); // 12 px tall (rows 24..35)
    const { mask } = prepareMask(bar, prep({ minArea: 0 }));
    expect(Math.abs(mask.data.filter(Boolean).length / (160 * 12) - 1)).toBeLessThan(0.01); // blur rounds the corners
    const sdf = signedDistanceField(mask);
    expect(2 * Math.max(...sdf) + 1).toBeCloseTo(12, 6);
    const thin = (min: number) => thinFeatures(mask, min).data.filter(Boolean).length;
    expect(thin(8)).toBe(0);
    expect(thin(20)).toBeGreaterThan(0.9 * 160 * 12);
  });

  it('uses the alpha channel when the image has meaningful transparency', () => {
    // Everything is white; only the alpha carries the disc, so luminance alone would find nothing.
    const img = paint(200, 200, (x, y) => [255, 255, 255, disc(100, 100, 60)(x, y) ? 255 : 0]);
    const { mask } = prepareMask(img, prep());
    expect(mask.data.filter(Boolean).length / (Math.PI * 60 ** 2)).toBeCloseTo(1, 1);
    expect(imageToFigure(img, prep(), { kernel }).parts).toHaveLength(1);
  });

  it('white on black is still the shape (border rule), and invert flips the choice', () => {
    const img = paint(200, 200, (x, y) => (disc(100, 100, 60)(x, y) ? WHITE : BLACK));
    const auto = imageToFigure(img, prep(), { kernel });
    expect(Math.abs(areaOf(auto) / (Math.PI * 60 ** 2) - 1)).toBeLessThan(0.02);
    const inverted = imageToFigure(img, prep({ invert: true }), { kernel });
    expect(Math.abs(areaOf(inverted) / (200 * 200 - Math.PI * 60 ** 2) - 1)).toBeLessThan(0.02);
    expect(inverted.parts[0].polygons[0].holes).toHaveLength(1);
  });

  it('grow thickens by about grow pixels', () => {
    const img = paint(300, 300, onWhite(disc(150, 150, 60)));
    const grown = imageToFigure(img, prep({ grow: 5 }), { kernel });
    expect(Math.abs(areaOf(grown) / (Math.PI * 65 ** 2) - 1)).toBeLessThan(0.02);
    const shrunk = imageToFigure(img, prep({ grow: -5 }), { kernel });
    expect(Math.abs(areaOf(shrunk) / (Math.PI * 55 ** 2) - 1)).toBeLessThan(0.02);
  });

  it('colour mode and colour split give parts with their mean colours', () => {
    const img = paint(300, 150, (x, y) => (y < 20 || y > 130 ? WHITE : x > 30 && x < 130 ? [220, 30, 30] : x > 140 && x < 240 ? [30, 30, 220] : WHITE));
    const fig = imageToFigure(img, prep({ split: 'colors', colors: 2, mode: 'luminance', threshold: 240 }), { kernel });
    expect(fig.parts.map((p) => p.color).sort()).toEqual(['#1e1edc', '#dc1e1e']);
    const key = imageToFigure(img, prep({ mode: 'color', color: '#dc1e1e', tolerance: 0.1 }), { kernel });
    expect(Math.abs(areaOf(key) / (100 * 110) - 1)).toBeLessThan(0.02);
  });

  it('labels components with 8- and 4-connectivity', () => {
    const mask = { width: 4, height: 2, data: Uint8Array.from([1, 0, 0, 0, 0, 1, 0, 1]) };
    expect(labelComponents(mask, 8).count).toBe(2);
    expect(labelComponents(mask, 4).count).toBe(3);
  });

  it('a 768 px image goes through the whole chain in well under a second', () => {
    const img = paint(768, 768, onWhite((x, y) => disc(384, 384, 300)(x, y) && !disc(384, 384, 150)(x, y)));
    imageToFigure(img, prep(), { kernel }); // warm up
    const t0 = performance.now();
    const fig = imageToFigure(img, prep(), { kernel });
    const ms = performance.now() - t0;
    console.log(`768px chain: ${ms.toFixed(0)} ms, ${fig.parts[0].polygons[0].outer.length} outer vertices`);
    expect(ms).toBeLessThan(1000);
  });
});

describe('svg figures', () => {
  const svg = (body: string, attrs = 'viewBox="0 0 100 100"') => svgToFigure(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`, { kernel });

  it('a path with arcs and a hole keeps the hole and the right area', () => {
    const d = 'M 50 0 A 50 50 0 1 1 -50 0 A 50 50 0 1 1 50 0 Z M 25 0 A 25 25 0 1 0 -25 0 A 25 25 0 1 0 25 0 Z';
    const fig = svg(`<path fill="#336699" d="${d}"/>`, 'viewBox="-60 -60 120 120"');
    expect(fig.parts).toHaveLength(1);
    expect(fig.parts[0].polygons).toHaveLength(1);
    expect(fig.parts[0].polygons[0].holes).toHaveLength(1);
    expect(fig.parts[0].color).toBe('#336699');
    expect(Math.abs(areaOf(fig) / (Math.PI * (50 ** 2 - 25 ** 2)) - 1)).toBeLessThan(0.005);
  });

  it('fill-rule decides whether same-direction nested squares make a hole', () => {
    const d = 'M0 0H100V100H0Z M25 25H75V75H25Z';
    expect(svg(`<path d="${d}" fill-rule="evenodd"/>`).parts[0].polygons[0].holes).toHaveLength(1);
    expect(svg(`<path d="${d}"/>`).parts[0].polygons[0].holes).toHaveLength(0);
  });

  it('a rect is a part with its colour, y is up, and the root size in mm sets the units', () => {
    const fig = svg('<rect x="10" y="10" width="20" height="10" style="fill:red"/>', 'width="50mm" height="50mm" viewBox="0 0 100 100"');
    expect(fig.units).toBe('mm');
    expect(fig.parts[0].color).toBe('#ff0000');
    expect(areaOf(fig)).toBeCloseTo(20 * 10 * 0.25, 6);
    const ys = fig.parts[0].polygons[0].outer.map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo((100 - 20) * 0.5, 6); // svg y 20 (bottom edge) is 80 above the bottom
    expect(fig.units).toBe('mm');
  });

  it('nested transforms, groups with ids, rounded rects and fill="none"', () => {
    const fig = svg(
      `<g id="left" transform="translate(10 0) scale(2)"><rect width="10" height="10"/></g>
       <rect id="pill" x="50" y="0" width="40" height="20" rx="10"/>
       <circle cx="50" cy="50" r="10" fill="none" stroke="black"/>
       <g transform="rotate(90)"><ellipse cx="5" cy="-5" rx="5" ry="2" fill="green"/></g>`,
    );
    expect(fig.units).toBe('unit');
    expect(fig.parts.map((p) => p.id)).toEqual(['left', 'pill', 's3']);
    expect(areaOf(fig, 'left')).toBeCloseTo(400, 6);
    expect(areaOf(fig, 'pill')).toBeCloseTo(40 * 20 - 100 * (4 - Math.PI), -1);
    expect(Math.abs(areaOf(fig, 's3') / (Math.PI * 10) - 1)).toBeLessThan(0.03); // a tiny ellipse, flattened at 0.1 units
  });

  it('refuses text and stroke-only artwork with advice', () => {
    expect(() => svg('<text x="0" y="10">Hi</text>')).toThrow(/convert it to paths/);
    expect(() => svg('<path d="M0 0L10 10" fill="none" stroke="black"/>')).toThrow(/strokes to paths/);
  });
});

describe('drawings', () => {
  const line = (points: number[][], extra = {}) => ({ tool: 'line' as const, points, size: 20, filled: true, erase: false, ...extra });

  it('an eraser across a stroke cuts it in two', () => {
    const fig = drawingToFigure(
      { kind: 'drawing', width: 200, height: 200, objects: [line([[20, 100], [180, 100]]), { tool: 'rect', points: [[90, 0], [110, 200]], size: 12, filled: true, erase: true }] },
      { kernel },
    );
    expect(fig.units).toBe('unit');
    expect(fig.parts).toHaveLength(2);
    expect(Math.abs(areaOf(fig) / (2 * (70 * 20 + (Math.PI * 100) / 2)) - 1)).toBeLessThan(0.02);
  });

  it('pen strokes make outlines, outline rectangles keep a hole, and y is flipped up', () => {
    const fig = drawingToFigure(
      {
        kind: 'drawing',
        width: 200,
        height: 200,
        objects: [
          { tool: 'pen', points: [[20, 20, 0.5], [60, 25, 0.7], [100, 20, 0.5]], size: 10, filled: true, erase: false },
          { tool: 'rect', points: [[20, 100], [180, 190]], size: 10, filled: false, erase: false },
        ],
      },
      { kernel },
    );
    expect(fig.parts).toHaveLength(2);
    expect(fig.parts[0].polygons[0].holes).toHaveLength(1);
    const pen = fig.parts[1].polygons[0].outer.map((p) => p[1]);
    expect(Math.min(...pen)).toBeGreaterThan(150); // drawn near the top (y = 20 of 200)
  });
});

describe('resolvers', () => {
  const png = (img: RGBAImage) => encode({ width: img.width, height: img.height, data: new Uint8Array(img.data.buffer), channels: 4, depth: 8 });
  const dataUrl = (bytes: Uint8Array) => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;

  it('decodes a PNG and reduces it to the working size', async () => {
    const decoded = await decodeImage(png(paint(400, 200, onWhite(disc(100, 100, 50)))), 'image/png', 100);
    expect([decoded.width, decoded.height]).toEqual([100, 50]);
  });

  it('defaultResolvers.image reads a data: PNG URL', async () => {
    const fig = await defaultResolvers.image!({ kind: 'image', src: dataUrl(png(paint(300, 300, onWhite(disc(150, 150, 100))))) }, prep());
    expect(fig.parts).toHaveLength(1);
    expect(Math.abs(areaOf(fig) / (Math.PI * 100 ** 2) - 1)).toBeLessThan(0.01);
  });

  it('idb: keys need the app to supply a loader, with a message that says so', async () => {
    await expect(defaultResolvers.image!({ kind: 'image', src: 'idb:abc' }, prep())).rejects.toThrow(/loadBytes/);
  });

  it('builds end to end: an image source in a turned design', async () => {
    const src = dataUrl(png(paint(300, 300, onWhite((x, y) => disc(150, 150, 100)(x, y) && !disc(150, 150, 40)(x, y)))));
    const model = await build(
      { version: 1, id: 'img', genre: 'turned', sources: { figure: { kind: 'image', src } }, prepare: { figure: { maxSize: 256 } }, params: { axis: -1.2, transform: { kind: 'extrude' } } },
      { kernel },
    );
    expect(model.bodies).toHaveLength(1);
    expect(model.diagnostics.volume).toBeGreaterThan(0);
    expect(model.diagnostics.genus).toBe(1);
  });
});
