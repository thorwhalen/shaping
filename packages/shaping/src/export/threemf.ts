/**
 * 3MF writer: the default format for printing.
 *
 * A zip holding `[Content_Types].xml`, `_rels/.rels` and `3D/3dmodel.model` (3MF core spec).
 * Units are millimetres, one `<object>` per body, colour through one `<basematerials>` group
 * (each object points at its own base), and one `<item>` per object in `<build>`.
 */
import { convertPositions } from './axes.js';
import { bodyNames, fmt, normalizeHex, solidBodies, utf8, xmlEscape } from './mesh.js';
import type { ExportOptions } from './types.js';
import type { Body, Model } from '../types.js';
import { zipFiles } from './zip.js';

const MODEL_NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const MODEL_REL_TYPE = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';
const MODEL_PATH = '3D/3dmodel.model';
/** Resource id of the material group; object ids follow it. */
const MATERIALS_ID = 1;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/${MODEL_PATH}" Id="rel0" Type="${MODEL_REL_TYPE}"/></Relationships>`;

function meshXml(body: Body): string {
  const p = convertPositions(body.positions, 'print');
  const v: string[] = [];
  for (let i = 0; i < p.length; i += 3) v.push(`<vertex x="${fmt(p[i])}" y="${fmt(p[i + 1])}" z="${fmt(p[i + 2])}"/>`);
  const t: string[] = [];
  for (let i = 0; i < body.indices.length; i += 3) t.push(`<triangle v1="${body.indices[i]}" v2="${body.indices[i + 1]}" v3="${body.indices[i + 2]}"/>`);
  return `<mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh>`;
}

/** The text of `3D/3dmodel.model`. */
export function threeMfModelXml(model: Model, options: ExportOptions = {}): string {
  const bodies = solidBodies(model);
  const names = bodyNames(bodies);
  const bases = bodies.map((b, i) => `<base name="${xmlEscape(names[i])}" displaycolor="${normalizeHex(b.color).toUpperCase()}"/>`).join('');
  const objects = bodies
    .map((b, i) => `<object id="${MATERIALS_ID + 1 + i}" name="${xmlEscape(names[i])}" type="model" pid="${MATERIALS_ID}" pindex="${i}">${meshXml(b)}</object>`)
    .join('');
  const items = bodies.map((_, i) => `<item objectid="${MATERIALS_ID + 1 + i}"/>`).join('');
  const meta = `<metadata name="Application">shaping</metadata>${options.title ? `<metadata name="Title">${xmlEscape(options.title)}</metadata>` : ''}`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="${MODEL_NS}">${meta}` +
    `<resources>${bodies.length ? `<basematerials id="${MATERIALS_ID}">${bases}</basematerials>` : ''}${objects}</resources>` +
    `<build>${items}</build></model>`
  );
}

/** Write a model as a 3MF package. */
export function write3mf(model: Model, options: ExportOptions = {}): Uint8Array {
  return zipFiles({
    '[Content_Types].xml': utf8(CONTENT_TYPES),
    '_rels/.rels': utf8(RELS),
    [MODEL_PATH]: utf8(threeMfModelXml(model, options)),
  });
}
