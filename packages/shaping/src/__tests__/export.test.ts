import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { build, manifoldKernel, type Model } from '../index.js';
import { exportFileName, exportModel, exporters } from '../export/index.js';
import { offsetPolygon, signedArea as signedAreaOf } from '../export/offset.js';
import { checkClosedMesh, read3mf, readGlb, readObj, readPly, readStl } from '../export/read.js';

const example = (name: string) => JSON.parse(readFileSync(new URL(`../../../../examples/${name}.json`, import.meta.url), 'utf8'));

let triplet: Model;
let turned: Model;
beforeAll(async () => {
  const kernel = await manifoldKernel();
  triplet = await build(example('triplet'), { kernel });
  turned = await build({ version: 1, id: 't', genre: 'turned', sources: { figure: { kind: 'text', text: 'HI' } }, params: { transform: { kind: 'extrude' } } }, { kernel });
});

const text = (b: Uint8Array) => new TextDecoder().decode(b);
const models = ['triplet', 'turned'] as const;
const modelOf = (name: (typeof models)[number]) => (name === 'triplet' ? triplet : turned);

describe('exporters table', () => {
  it('has every format and refuses unknown ids by listing the known ones', () => {
    expect(Object.keys(exporters).sort()).toEqual(['3mf', 'dxf', 'glb', 'obj', 'ply', 'print-pack', 'stl', 'svg']);
    expect(() => exportModel(triplet, 'nope')).toThrow(/Available: 3mf, stl/);
    expect(() => exportModel(triplet, 'toString')).toThrow(/Unknown export format/);
  });

  it('names files: size for unit-less 3D formats, kerf for 2D ones', () => {
    expect(exportFileName('Triplet', exporters.stl, 50)).toBe('triplet-50mm.stl');
    expect(exportFileName('Triplet', exporters['3mf'], 50)).toBe('triplet.3mf');
    expect(exportFileName('Triplet', exporters.svg, 50, { kerf: 0.2 })).toBe('triplet-kerf0.2mm.svg');
    expect(exportFileName('Triplet', exporters.svg, 50)).toBe('triplet.svg');
  });
});

describe('3D read-back', () => {
  for (const name of models) {
    it(`${name}: 3MF has millimetre units, one object per body with its colour, and closed meshes`, () => {
      const model = modelOf(name);
      const r = read3mf(exportModel(model, '3mf'));
      expect(r.unit).toBe('millimeter');
      expect(r.objects).toHaveLength(model.bodies.length);
      expect(r.buildItems).toHaveLength(model.bodies.length);
      r.objects.forEach((o, i) => {
        expect(o.color).toBe(model.bodies[i].color.toLowerCase());
        const rep = checkClosedMesh(o);
        expect(rep, `object ${i}`).toMatchObject({ closed: true, openEdges: 0, repeatedEdges: 0 });
        expect(o.positions.length).toBe(model.bodies[i].positions.length);
      });
    });

    it(`${name}: STL is closed and sized in the header`, () => {
      const model = modelOf(name);
      const r = readStl(exportModel(model, 'stl'));
      expect(r.header).toMatch(/shaping.*mm/);
      expect(checkClosedMesh(r).closed).toBe(true);
      expect(r.indices.length / 3).toBe(model.bodies.reduce((s, b) => s + b.indices.length / 3, 0));
    });

    it(`${name}: PLY is closed and carries body colours`, () => {
      const model = modelOf(name);
      const r = readPly(exportModel(model, 'ply'));
      expect(checkClosedMesh(r).closed).toBe(true);
      const first = model.bodies[0].color.slice(1);
      expect([...r.colors.subarray(0, 3)]).toEqual([0, 2, 4].map((i) => parseInt(first.slice(i, i + 2), 16)));
    });

    it(`${name}: OBJ zip has one group per body with its colour, each closed`, () => {
      const model = modelOf(name);
      const meshes = readObj(exportModel(model, 'obj'));
      expect(meshes).toHaveLength(model.bodies.length);
      meshes.forEach((m, i) => {
        expect(m.color).toBe(model.bodies[i].color.toLowerCase());
        expect(checkClosedMesh(m).closed).toBe(true);
      });
    });

    it(`${name}: GLB has valid chunks, metres, y up, one mesh per body`, () => {
      const model = modelOf(name);
      const g = readGlb(exportModel(model, 'glb'));
      expect(g.version).toBe(2);
      expect(g.length % 4).toBe(0);
      expect(g.bin.length % 4).toBe(0);
      expect(g.meshes).toHaveLength(model.bodies.length);
      const { min, max } = model.diagnostics.bbox;
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (const m of g.meshes) {
        expect(checkClosedMesh(m, 1e-7).closed).toBe(true);
        for (let i = 0; i < m.positions.length; i += 3) {
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k], m.positions[i + k]);
            hi[k] = Math.max(hi[k], m.positions[i + k]);
          }
        }
      }
      // glTF (x, y, z) = model (x, z, -y), in metres.
      expect(hi[0] - lo[0]).toBeCloseTo((max[0] - min[0]) / 1000, 5);
      expect(hi[1] - lo[1]).toBeCloseTo((max[2] - min[2]) / 1000, 5);
      expect(hi[2] - lo[2]).toBeCloseTo((max[1] - min[1]) / 1000, 5);
      expect(lo[1]).toBeCloseTo(min[2] / 1000, 5);
    });
  }

  it('a body needs its own colours in 3MF: the turned example has several coloured bodies', () => {
    expect(turned.bodies.length).toBeGreaterThan(1);
    expect(new Set(read3mf(exportModel(turned, '3mf')).objects.map((o) => o.color)).size).toBeGreaterThan(1);
  });

  it('the 3MF package has the required parts and is deterministic', () => {
    const bytes = exportModel(triplet, '3mf');
    expect(Object.keys(unzipSync(bytes))).toEqual(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']);
    expect(exportModel(triplet, '3mf')).toEqual(bytes);
  });
});

describe('2D files', () => {
  it('SVG: mm dimensions, closed paths only, no text, hairline cut', () => {
    const svg = text(exportModel(triplet, 'svg'));
    const m = /width="([\d.]+)mm" height="([\d.]+)mm" viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!;
    expect(m).toBeTruthy();
    expect(m[1]).toBe(m[3]);
    expect(m[2]).toBe(m[4]);
    expect(svg).not.toMatch(/<text/);
    expect(svg).toMatch(/fill="none" stroke="#ff0000" stroke-width="0.01"/);
    const subpaths = [...svg.matchAll(/\sd="([^"]*)"/g)].flatMap((d) => d[1].split('M').filter(Boolean));
    expect(subpaths.length).toBeGreaterThan(2);
    for (const s of subpaths) expect(s.endsWith('Z')).toBe(true);
    // Three target regions laid out left to right: widths plus two gaps.
    expect(Number(m[1])).toBeGreaterThan(2 * 5);
    expect((svg.match(/<path /g) ?? []).length).toBe(triplet.diagnostics.regions.filter((r) => r.role === 'target').length);
  });

  it('SVG: engrave is fill only with evenodd; operation colours are a parameter', () => {
    const e = text(exportModel(triplet, 'svg', { operation: 'engrave' }));
    expect(e).toMatch(/fill="#000000" fill-rule="evenodd" stroke="none"/);
    expect(text(exportModel(triplet, 'svg', { operation: 'score', operationColors: { score: '#123456' } }))).toMatch(/stroke="#123456"/);
  });

  it('SVG: kerf grows the layout by the kerf on each outer edge', () => {
    const dim = (s: string) => Number(/width="([\d.]+)mm"/.exec(s)![1]);
    const plain = dim(text(exportModel(triplet, 'svg')));
    const kerfed = dim(text(exportModel(triplet, 'svg', { kerf: 1 })));
    expect(kerfed).toBeGreaterThan(plain);
    expect(exportModel(triplet, 'svg', { kerf: 0 })).toEqual(exportModel(triplet, 'svg'));
  });

  it('SVG: an unmatched role filter says what the model has', () => {
    expect(() => exportModel(triplet, 'svg', { roles: ['section'] })).toThrow(/role section/);
  });

  it('DXF: closed polylines, millimetres, one layer', () => {
    const dxf = text(exportModel(triplet, 'dxf'));
    const lines = dxf.split('\r\n');
    expect(lines.slice(0, 4)).toEqual(['0', 'SECTION', '2', 'HEADER']);
    expect(dxf).toContain('$INSUNITS\r\n70\r\n4');
    expect(dxf).toContain('AC1009');
    expect(dxf.endsWith('0\r\nEOF\r\n')).toBe(true);
    const polylines = dxf.split('0\r\nPOLYLINE\r\n').slice(1);
    expect(polylines.length).toBeGreaterThan(2);
    for (const p of polylines) {
      expect(p).toMatch(/\r\n70\r\n1\r\n/);
      expect(p).toContain('0\r\nSEQEND');
      expect(p).toMatch(/8\r\nCUT\r\n/);
    }
  });

  it('a model with slices (turned) writes SVG by default roles', () => {
    const svg = text(exportModel(turned, 'svg'));
    expect(svg).toMatch(/<path /);
  });
});

describe('print pack', () => {
  it('holds the 3MF, STL, SVG and a README with the recipe', () => {
    const files = unzipSync(exportModel(triplet, 'print-pack'));
    expect(Object.keys(files)).toEqual(['model.3mf', 'model.stl', 'profiles.svg', 'README.txt']);
    expect(read3mf(files['model.3mf']).unit).toBe('millimeter');
    expect(checkClosedMesh(readStl(files['model.stl'])).closed).toBe(true);
    expect(text(files['README.txt'])).toMatch(/extrude/i);
  });
});

describe('polygon offset', () => {
  const square = { outer: [[0, 0], [10, 0], [10, 10], [0, 10]] as [number, number][], holes: [[[3, 3], [3, 7], [7, 7], [7, 3]] as [number, number][]] };
  it('moves outer contours out and holes in, by the distance', () => {
    const p = offsetPolygon(square, 0.5)!;
    expect(signedAreaOf(p.outer)).toBeCloseTo(121, 6);
    expect(Math.abs(signedAreaOf(p.holes[0]))).toBeCloseTo(9, 6);
  });
  it('drops a hole that closes up and refuses a collapsed outline', () => {
    expect(offsetPolygon(square, 2.5)!.holes).toHaveLength(0);
    expect(offsetPolygon(square, -6)).toBeNull();
  });
});
