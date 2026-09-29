/**
 * From an SVG document to a `Figure`, without a DOM (so it runs in Node and in workers).
 *
 * A small XML tokenizer builds a tree; `path` (M L H V C S Q T A Z, absolute and relative, arcs
 * converted to cubic beziers), `rect` (with rx/ry), `circle`, `ellipse`, `polygon`, `polyline`
 * (filled) and `g` with nested `transform` are turned into rings. Curves are flattened adaptively
 * in final coordinates. `fill-rule` decides which rings are holes; `fill="none"` shapes are
 * skipped. Each top-level filled element, or each `<g id>`, is a part with its fill colour.
 * Coordinates are flipped so y points up. Units are `mm` when the root `width`/`height` are in
 * physical units (mm, cm, in, pt, pc), otherwise `unit`.
 *
 * Not supported, and said so in errors: text (convert it to paths), stroke-only shapes (convert
 * strokes to paths), CSS classes, gradients, clipping and masks (these are ignored).
 */
import type { SvgSource } from '../design.js';
import type { Kernel } from '../kernel/types.js';
import type { Figure, Part, Polygon, Ring, Vec2 } from '../types.js';
import { toHexColor } from './mask.js';
import type { ImagingContext } from './figure.js';
import { signedArea } from './trace.js';

// ---------------------------------------------------------------- constants

/** Curve flattening tolerance as a share of the drawing's longest side. */
const FLATNESS_RATIO = 1e-3;
/** Flattening tolerance when the drawing's size is unknown, in output units. */
const FALLBACK_FLATNESS = 0.1;
const MAX_SUBDIVISION_DEPTH = 16;
const MAX_USE_DEPTH = 8;
/** CSS pixels per inch: a user unit without a viewBox is one of these. */
const PX_PER_INCH = 96;
const MM_PER_INCH = 25.4;
const PX_TO_MM = MM_PER_INCH / PX_PER_INCH;
const MM_PER: Record<string, number> = { mm: 1, cm: 10, in: MM_PER_INCH, pt: MM_PER_INCH / 72, pc: MM_PER_INCH / 6 };
const DEFAULT_FILL = '#000000';
/** Quarter turn: arcs are split into pieces no longer than this. */
const ARC_PIECE = Math.PI / 2;
/** Bezier control-point factor for an arc of angle a is (4/3) tan(a / 4). */
const ARC_KAPPA = 4 / 3;

const SKIPPED = new Set(['defs', 'clippath', 'mask', 'symbol', 'marker', 'pattern', 'lineargradient', 'radialgradient', 'style', 'title', 'desc', 'metadata', 'filter', 'script', 'foreignobject', 'image', 'line']);
const GROUPS = new Set(['g', 'svg', 'a', 'switch']);
const TEXTS = new Set(['text', 'tspan', 'textpath']);

const NAMED_COLORS: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500',
  purple: '#800080', gray: '#808080', grey: '#808080', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff',
  pink: '#ffc0cb', brown: '#a52a2a', silver: '#c0c0c0', gold: '#ffd700', navy: '#000080', teal: '#008080', maroon: '#800000',
  lime: '#00ff00', olive: '#808000',
};

// ---------------------------------------------------------------- XML

interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTRIBUTE = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const localName = (name: string) => name.slice(name.indexOf(':') + 1).toLowerCase();

/** Parse XML text into a tree and return its root element. */
export function parseXml(text: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  for (const m of text.matchAll(TOKEN)) {
    const [, closing, opening, attrText, selfClosing] = m;
    if (closing !== undefined) {
      if (stack.length > 1) stack.pop();
    } else if (opening !== undefined) {
      const attrs: Record<string, string> = {};
      for (const a of attrText.matchAll(ATTRIBUTE)) attrs[a[1] === 'xlink:href' ? 'href' : a[1]] = a[2] ?? a[3];
      const node: XmlNode = { name: localName(opening), attrs, children: [] };
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) stack.push(node);
    }
  }
  const svg = root.children.find((n) => n.name === 'svg');
  if (!svg) throw new Error('Not an SVG document: no <svg> element found.');
  return svg;
}

function styleDeclarations(style: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of (style ?? '').split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  }
  return out;
}

// ---------------------------------------------------------------- transforms

/** Affine matrix [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f. */
type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** `m ∘ n`: apply `n` first, then `m`. */
const multiply = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

const apply = (m: Mat, [x, y]: Vec2): Vec2 => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const numbers = (s: string): number[] => (s.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Parse an SVG `transform` list (matrix, translate, scale, rotate, skewX, skewY). */
export function parseTransform(text: string | undefined): Mat {
  let m = IDENTITY;
  for (const t of (text ?? '').matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = numbers(t[2]);
    let n: Mat;
    switch (t[1]) {
      case 'matrix':
        if (a.length !== 6) throw new Error(`SVG transform matrix() needs 6 numbers, got ${a.length}.`);
        n = a as Mat;
        break;
      case 'translate': n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]; break;
      case 'scale': n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const c = Math.cos(rad(a[0] ?? 0)), s = Math.sin(rad(a[0] ?? 0));
        const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
        n = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
        break;
      }
      case 'skewX': n = [1, 0, Math.tan(rad(a[0] ?? 0)), 1, 0, 0]; break;
      case 'skewY': n = [1, Math.tan(rad(a[0] ?? 0)), 0, 1, 0, 0]; break;
      default: throw new Error(`Unknown SVG transform "${t[1]}".`);
    }
    m = multiply(m, n);
  }
  return m;
}

// ---------------------------------------------------------------- path building

interface Sub {
  points: Ring;
  closed: boolean;
}

/** Collects subpaths in final coordinates, flattening curves adaptively as they arrive. */
class PathBuilder {
  subs: Sub[] = [];
  private cur: Sub | null = null;
  private last: Vec2 = [0, 0];
  constructor(private matrix: Mat, private tolerance: number) {}

  moveTo(p: Vec2): void {
    const q = apply(this.matrix, p);
    this.cur = { points: [q], closed: false };
    this.subs.push(this.cur);
    this.last = q;
  }

  lineTo(p: Vec2): void {
    const q = apply(this.matrix, p);
    this.sub().points.push(q);
    this.last = q;
  }

  cubicTo(c1: Vec2, c2: Vec2, p: Vec2): void {
    const s = this.sub();
    const end = apply(this.matrix, p);
    this.flatten(this.last, apply(this.matrix, c1), apply(this.matrix, c2), end, s.points, 0);
    this.last = end;
  }

  close(): void {
    if (this.cur) {
      this.cur.closed = true;
      this.last = this.cur.points[0];
    }
    this.cur = null;
  }

  /** The subpath being built; after a close, a new one starts where the last one started. */
  private sub(): Sub {
    if (!this.cur) {
      this.cur = { points: [this.last], closed: false };
      this.subs.push(this.cur);
    }
    return this.cur;
  }

  private flatten(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, out: Ring, depth: number): void {
    const flat = Math.max(distanceToLine(p1, p0, p3), distanceToLine(p2, p0, p3)) <= this.tolerance;
    if (flat || depth >= MAX_SUBDIVISION_DEPTH) {
      out.push(p3);
      return;
    }
    const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const p01 = mid(p0, p1), p12 = mid(p1, p2), p23 = mid(p2, p3);
    const p012 = mid(p01, p12), p123 = mid(p12, p23);
    const m = mid(p012, p123);
    this.flatten(p0, p01, p012, m, out, depth + 1);
    this.flatten(m, p123, p23, p3, out, depth + 1);
  }
}

function distanceToLine(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  return len === 0 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0])) / len;
}

/** An elliptical arc (SVG endpoint form) as cubic bezier pieces `[c1, c2, end]`, no piece longer than a quarter turn. */
export function arcToCubics(from: Vec2, rxIn: number, ryIn: number, xAxisDeg: number, large: boolean, sweep: boolean, to: Vec2): Array<[Vec2, Vec2, Vec2]> {
  let rx = Math.abs(rxIn), ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (from[0] === to[0] && from[1] === to[1])) return rx === 0 || ry === 0 ? [[from, to, to]] : [];
  const phi = rad(xAxisDeg), cosP = Math.cos(phi), sinP = Math.sin(phi);
  const dx = (from[0] - to[0]) / 2, dy = (from[1] - to[1]) / 2;
  const x1 = cosP * dx + sinP * dy, y1 = -sinP * dx + cosP * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) [rx, ry] = [rx * Math.sqrt(lambda), ry * Math.sqrt(lambda)];
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1) / ry, cyp = (-coef * ry * x1) / rx;
  const cx = cosP * cxp - sinP * cyp + (from[0] + to[0]) / 2;
  const cy = sinP * cxp + cosP * cyp + (from[1] + to[1]) / 2;
  const t1 = Math.atan2((y1 - cyp) / ry, (x1 - cxp) / rx);
  const t2 = Math.atan2((-y1 - cyp) / ry, (-x1 - cxp) / rx);
  let delta = t2 - t1;
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const pieces = Math.max(1, Math.ceil(Math.abs(delta) / ARC_PIECE - 1e-9));
  const step = delta / pieces;
  const k = ARC_KAPPA * Math.tan(step / 4);
  const point = (t: number): Vec2 => [cx + rx * Math.cos(t) * cosP - ry * Math.sin(t) * sinP, cy + rx * Math.cos(t) * sinP + ry * Math.sin(t) * cosP];
  const tangent = (t: number): Vec2 => [-rx * Math.sin(t) * cosP - ry * Math.cos(t) * sinP, -rx * Math.sin(t) * sinP + ry * Math.cos(t) * cosP];
  return Array.from({ length: pieces }, (_, i): [Vec2, Vec2, Vec2] => {
    const a = t1 + i * step, b = a + step;
    const [pa, pb, ta, tb] = [point(a), point(b), tangent(a), tangent(b)];
    const end: Vec2 = i === pieces - 1 ? to : pb;
    return [[pa[0] + k * ta[0], pa[1] + k * ta[1]], [pb[0] - k * tb[0], pb[1] - k * tb[1]], end];
  });
}

const ARG_COUNT: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;

/** Feed SVG path data to a builder (local coordinates; the builder transforms and flattens). */
export function parsePathData(d: string, out: PathBuilder): void {
  let pos = 0;
  const skip = () => {
    while (pos < d.length && /[\s,]/.test(d[pos])) pos++;
  };
  const num = (): number => {
    skip();
    NUMBER.lastIndex = pos;
    const m = NUMBER.exec(d);
    if (!m) throw new Error(`SVG path: expected a number at position ${pos} of "${d.slice(Math.max(0, pos - 10), pos + 10)}".`);
    pos = NUMBER.lastIndex;
    return Number(m[0]);
  };
  const flag = (): boolean => {
    skip();
    const c = d[pos];
    if (c !== '0' && c !== '1') throw new Error(`SVG path: expected an arc flag (0 or 1) at position ${pos}.`);
    pos++;
    return c === '1';
  };
  let cmd = '';
  let cur: Vec2 = [0, 0];
  let start: Vec2 = [0, 0];
  let lastCubic: Vec2 | null = null;
  let lastQuad: Vec2 | null = null;
  for (skip(); pos < d.length; skip()) {
    if (/[A-Za-z]/.test(d[pos])) cmd = d[pos++];
    else if (!cmd) throw new Error(`SVG path must start with a command, found "${d[pos]}".`);
    else if (cmd === 'z' || cmd === 'Z') throw new Error(`SVG path: unexpected "${d[pos]}" after a close command.`);
    const lower = cmd.toLowerCase();
    if (!(lower in ARG_COUNT)) throw new Error(`SVG path: unknown command "${cmd}".`);
    const rel = cmd === lower;
    const [ox, oy] = rel ? cur : [0, 0];
    let cubic: Vec2 | null = null;
    let quad: Vec2 | null = null;
    switch (lower) {
      case 'm': {
        cur = [ox + num(), oy + num()];
        start = cur;
        out.moveTo(cur);
        cmd = rel ? 'l' : 'L'; // further pairs are implicit line-tos
        break;
      }
      case 'l': cur = [ox + num(), oy + num()]; out.lineTo(cur); break;
      case 'h': cur = [ox + num(), cur[1]]; out.lineTo(cur); break;
      case 'v': cur = [cur[0], oy + num()]; out.lineTo(cur); break;
      case 'c': {
        const c1: Vec2 = [ox + num(), oy + num()], c2: Vec2 = [ox + num(), oy + num()], p: Vec2 = [ox + num(), oy + num()];
        out.cubicTo(c1, c2, p);
        [cubic, cur] = [c2, p];
        break;
      }
      case 's': {
        const c1: Vec2 = lastCubic ? [2 * cur[0] - lastCubic[0], 2 * cur[1] - lastCubic[1]] : cur;
        const c2: Vec2 = [ox + num(), oy + num()], p: Vec2 = [ox + num(), oy + num()];
        out.cubicTo(c1, c2, p);
        [cubic, cur] = [c2, p];
        break;
      }
      case 'q': {
        const q: Vec2 = [ox + num(), oy + num()], p: Vec2 = [ox + num(), oy + num()];
        out.cubicTo(...quadraticToCubic(cur, q, p));
        [quad, cur] = [q, p];
        break;
      }
      case 't': {
        const q: Vec2 = lastQuad ? [2 * cur[0] - lastQuad[0], 2 * cur[1] - lastQuad[1]] : cur;
        const p: Vec2 = [ox + num(), oy + num()];
        out.cubicTo(...quadraticToCubic(cur, q, p));
        [quad, cur] = [q, p];
        break;
      }
      case 'a': {
        const [rx, ry, rot] = [num(), num(), num()];
        const large = flag(), sweep = flag();
        const p: Vec2 = [ox + num(), oy + num()];
        for (const piece of arcToCubics(cur, rx, ry, rot, large, sweep, p)) out.cubicTo(...piece);
        cur = p;
        break;
      }
      case 'z':
        out.close();
        cur = start;
        break;
    }
    lastCubic = cubic;
    lastQuad = quad;
    if (lower === 'z') cmd = 'z';
  }
}

function quadraticToCubic(p0: Vec2, q: Vec2, p: Vec2): [Vec2, Vec2, Vec2] {
  const third = (a: Vec2, b: Vec2): Vec2 => [a[0] + (2 / 3) * (b[0] - a[0]), a[1] + (2 / 3) * (b[1] - a[1])];
  return [third(p0, q), third(p, q), p];
}

// ---------------------------------------------------------------- shapes to rings

const attrNumber = (n: XmlNode, key: string, fallback = 0): number => {
  const v = n.attrs[key];
  return v === undefined ? fallback : (numbers(v)[0] ?? fallback);
};

/** The path data of a basic shape (rect, circle, ellipse, polygon, polyline), or null for other elements. */
export function shapeToPathData(n: XmlNode): string | null {
  switch (n.name) {
    case 'path':
      return n.attrs.d ?? '';
    case 'rect': {
      const [x, y, w, h] = [attrNumber(n, 'x'), attrNumber(n, 'y'), attrNumber(n, 'width'), attrNumber(n, 'height')];
      let rx = n.attrs.rx !== undefined ? attrNumber(n, 'rx') : attrNumber(n, 'ry');
      let ry = n.attrs.ry !== undefined ? attrNumber(n, 'ry') : rx;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (w <= 0 || h <= 0) return '';
      if (rx <= 0 || ry <= 0) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case 'circle':
    case 'ellipse': {
      const [cx, cy] = [attrNumber(n, 'cx'), attrNumber(n, 'cy')];
      const rx = n.name === 'circle' ? attrNumber(n, 'r') : attrNumber(n, 'rx');
      const ry = n.name === 'circle' ? rx : attrNumber(n, 'ry');
      if (rx <= 0 || ry <= 0) return '';
      return `M${cx + rx} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${cy + ry}A${rx} ${ry} 0 0 1 ${cx - rx} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${cy - ry}A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}Z`;
    }
    case 'polygon':
    case 'polyline': {
      const v = numbers(n.attrs.points ?? '');
      if (v.length < 6) return '';
      const pairs = Array.from({ length: Math.floor(v.length / 2) }, (_, i) => `${v[2 * i]} ${v[2 * i + 1]}`);
      return `M${pairs.join('L')}Z`;
    }
    default:
      return null;
  }
}

type FillRule = 'nonzero' | 'evenodd';

function inRing(p: Vec2, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Decide which rings of one element are outlines and which are holes under a fill rule, from their
 * nesting and orientation, and return well-oriented polygons (outer CCW, holes CW).
 * A single ring that crosses itself is filled by even-odd whatever the rule says.
 */
export function ringsToPolygons(rings: Ring[], rule: FillRule): Polygon[] {
  const items = rings.map((ring) => ({ ring, area: signedArea(ring) })).filter((r) => r.ring.length >= 3 && r.area !== 0);
  items.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
  const polygons = new Map<number, Polygon>();
  items.forEach((item, i) => {
    const ancestors = items.slice(0, i).map((_, j) => j).filter((j) => inRing(item.ring[0], items[j].ring));
    const windingOut = ancestors.reduce((s, j) => s + Math.sign(items[j].area), 0);
    const windingIn = windingOut + Math.sign(item.area);
    const filled = (winding: number, depth: number) => (rule === 'evenodd' ? depth % 2 === 1 : winding !== 0);
    const outsideFilled = filled(windingOut, ancestors.length);
    const insideFilled = filled(windingIn, ancestors.length + 1);
    if (!outsideFilled && insideFilled) {
      polygons.set(i, { outer: item.area > 0 ? item.ring : [...item.ring].reverse(), holes: [] });
    } else if (outsideFilled && !insideFilled) {
      const owner = [...ancestors].reverse().find((j) => polygons.has(j));
      if (owner !== undefined) polygons.get(owner)!.holes.push(item.area < 0 ? item.ring : [...item.ring].reverse());
    }
  });
  return [...polygons.values()];
}

// ---------------------------------------------------------------- colours

/** Normalise a CSS colour (hex, rgb(), or a common name) to `#rrggbb`; undefined when unknown (gradients, `currentColor`). */
export function cssColor(value: string): string | undefined {
  const v = value.trim().toLowerCase();
  if (NAMED_COLORS[v]) return NAMED_COLORS[v];
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) return '#' + (hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]);
  const rgb = /^rgb\(([^)]*)\)$/.exec(v);
  if (rgb) {
    const parts = rgb[1].split(/[\s,]+/).filter(Boolean).slice(0, 3);
    const channels = parts.map((p) => (p.endsWith('%') ? (parseFloat(p) * 255) / 100 : parseFloat(p)));
    if (channels.length === 3 && channels.every(Number.isFinite)) return toHexColor(channels);
  }
  return undefined;
}

// ---------------------------------------------------------------- the document walk

interface Style {
  matrix: Mat;
  fill: string;
  fillRule: FillRule;
}

interface Env {
  tolerance: number;
  ids: Map<string, XmlNode>;
}

interface Shape {
  polygons: Polygon[];
  color?: string;
}

function indexIds(node: XmlNode, ids: Map<string, XmlNode>): void {
  if (node.attrs.id) ids.set(node.attrs.id, node);
  for (const c of node.children) indexIds(c, ids);
}

/** Resolve a node's own presentation properties on top of the inherited ones; null when it is not displayed. */
function styleOf(node: XmlNode, parent: Style): Style | null {
  const props = { ...node.attrs, ...styleDeclarations(node.attrs.style) };
  if (props.display === 'none' || props.visibility === 'hidden') return null;
  const fill = props.fill ?? parent.fill;
  return {
    matrix: multiply(parent.matrix, parseTransform(props.transform)),
    fill: fill === 'currentColor' ? DEFAULT_FILL : fill,
    fillRule: props['fill-rule'] === 'evenodd' ? 'evenodd' : props['fill-rule'] === 'nonzero' ? 'nonzero' : parent.fillRule,
  };
}

/** All filled shapes under a node, in document order. */
function shapesOf(node: XmlNode, parent: Style, env: Env, depth = 0): Shape[] {
  const name = node.name;
  if (TEXTS.has(name)) throw new Error('This SVG contains text. Text cannot be shaped: convert it to paths first (in Inkscape: Path > Object to Path; in Illustrator: Type > Create Outlines).');
  if (SKIPPED.has(name)) return [];
  const style = styleOf(node, parent);
  if (!style) return [];
  if (GROUPS.has(name)) return node.children.flatMap((c) => shapesOf(c, style, env, depth));
  if (name === 'use') {
    const target = env.ids.get((node.attrs.href ?? '').replace(/^#/, ''));
    if (!target || depth >= MAX_USE_DEPTH) return [];
    const at = multiply(style.matrix, [1, 0, 0, 1, attrNumber(node, 'x'), attrNumber(node, 'y')]);
    return shapesOf(target, { ...style, matrix: at }, env, depth + 1);
  }
  const d = shapeToPathData(node);
  if (d === null || style.fill === 'none' || style.fill === 'transparent') return [];
  const builder = new PathBuilder(style.matrix, env.tolerance);
  parsePathData(d, builder);
  const polygons = ringsToPolygons(builder.subs.map((s) => dedupeClosing(s.points)), style.fillRule);
  return polygons.length ? [{ polygons, color: cssColor(style.fill) }] : [];
}

function dedupeClosing(ring: Ring): Ring {
  const [a, b] = [ring[0], ring[ring.length - 1]];
  return ring.length > 1 && a[0] === b[0] && a[1] === b[1] ? ring.slice(0, -1) : ring;
}

/** Top-level parts: a `<g id>` groups its descendants; other groups are looked through; anything else is one part. */
function topLevelParts(node: XmlNode, parent: Style, env: Env, out: Array<{ id?: string; shapes: Shape[] }>): void {
  if (SKIPPED.has(node.name)) return;
  const style = styleOf(node, parent);
  if (!style) return;
  if (GROUPS.has(node.name) && !node.attrs.id) {
    for (const c of node.children) topLevelParts(c, style, env, out);
    return;
  }
  const shapes = shapesOf(node, parent, env);
  if (shapes.length) out.push({ id: node.attrs.id, shapes });
}

// ---------------------------------------------------------------- the root

interface Root {
  matrix: Mat;
  units: Figure['units'];
  extent: number | undefined;
}

const parseLength = (s: string | undefined): { value: number; unit: string } | null => {
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(s ?? '');
  return m ? { value: Number(m[1]), unit: m[2].toLowerCase() } : null;
};

/** Root transform (viewBox, physical size, y flip), the figure's units and the drawing's longest side. */
function rootOf(svg: XmlNode): Root {
  const vb = numbers(svg.attrs.viewBox ?? '');
  const box = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? { x: vb[0], y: vb[1], w: vb[2], h: vb[3] } : null;
  const width = parseLength(svg.attrs.width);
  const height = parseLength(svg.attrs.height);
  const physical = [width, height].find((l) => l && l.unit in MM_PER);
  let scale = 1;
  let units: Figure['units'] = 'unit';
  if (physical) {
    units = 'mm';
    const mm = physical.value * MM_PER[physical.unit];
    const along = physical === width ? box?.w : box?.h;
    scale = box ? mm / (along as number) : PX_TO_MM;
  }
  const userSize = (len: { value: number; unit: string } | null, boxSize: number | undefined): number | undefined => {
    if (boxSize !== undefined || !len) return boxSize;
    if (len.unit in MM_PER) return (len.value * MM_PER[len.unit]) / PX_TO_MM;
    return len.unit === '' || len.unit === 'px' ? len.value : undefined;
  };
  const userHeight = userSize(height, box?.h);
  const userWidth = userSize(width, box?.w);
  const top = (box?.y ?? 0) + (userHeight ?? 0);
  const matrix: Mat = [scale, 0, 0, -scale, -(box?.x ?? 0) * scale, top * scale];
  const longest = userWidth !== undefined && userHeight !== undefined ? Math.max(userWidth, userHeight) * scale : undefined;
  return { matrix, units, extent: longest };
}

/** Parse an SVG document into a figure (y up). Throws a helpful error for text and for stroke-only artwork. */
export function svgToFigure(svgText: string, ctx: ImagingContext): Figure {
  const svg = parseXml(svgText);
  const root = rootOf(svg);
  const ids = new Map<string, XmlNode>();
  indexIds(svg, ids);
  const env: Env = { ids, tolerance: root.extent ? FLATNESS_RATIO * root.extent : FALLBACK_FLATNESS };
  const start: Style = { matrix: root.matrix, fill: DEFAULT_FILL, fillRule: 'nonzero' };
  const found: Array<{ id?: string; shapes: Shape[] }> = [];
  const rootStyle = styleOf(svg, start) ?? start;
  for (const c of svg.children) topLevelParts(c, rootStyle, env, found);
  if (found.length === 0) {
    throw new Error('This SVG has no filled shapes. Outlines drawn only as strokes cannot be shaped: convert strokes to paths (Inkscape: Path > Stroke to Path) and give them a fill.');
  }
  return { units: root.units, parts: found.map((f, i) => toPart(f, i, found, ctx.kernel)) };
}

function toPart(item: { id?: string; shapes: Shape[] }, index: number, all: Array<{ id?: string }>, kernel: Kernel): Part {
  const polygons = kernel.scope(() => kernel.polygons(kernel.region(item.shapes.flatMap((s) => s.polygons))));
  const id = item.id && all.findIndex((o) => o.id === item.id) === index ? item.id : `s${index + 1}`;
  return { id, polygons, color: item.shapes.find((s) => s.color)?.color };
}

/** Adapter for the `svg` slot of `SourceResolvers`. */
export const svgSourceToFigure = (source: SvgSource, ctx: ImagingContext): Figure => svgToFigure(source.svg, ctx);
