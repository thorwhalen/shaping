#!/usr/bin/env node
/**
 * The command line: the same core as the app, with no browser.
 *
 *   shaping build <design.json> --format 3mf --out <file>   write a file (and re-read it to check it)
 *   shaping check <design.json>                              print the diagnostics; exit 1 on a problem
 *   shaping formats                                          list the export formats
 *
 * Image sources given as paths are read relative to the design file.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { build, parseDesign } from './index.js';
import { exportModel, exporters } from './export/index.js';
import { checkClosedMesh, read3mf, readStl } from './export/read.js';
import { makeResolvers } from './imaging/index.js';
import type { Model } from './types.js';

const MEDIA_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' };
const USAGE = `usage:
  shaping build <design.json> --format <${Object.keys(exporters).join('|')}> --out <file>
  shaping check <design.json>
  shaping formats`;

function flag(args: string[], name: string, fallback?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}

async function loadDesign(path: string) {
  const design = parseDesign(JSON.parse(await readFile(path, 'utf8')));
  const base = dirname(resolve(path));
  const resolvers = makeResolvers({
    loadBytes: async (src: string) => {
      if (/^(data:|https?:)/.test(src)) {
        const res = await fetch(src);
        return { bytes: new Uint8Array(await res.arrayBuffer()), mediaType: res.headers.get('content-type') ?? undefined };
      }
      if (src.startsWith('idb:')) throw new Error(`${src} lives in a browser's storage; export the design with the image embedded, or give a file path.`);
      return { bytes: new Uint8Array(await readFile(resolve(base, src))), mediaType: MEDIA_TYPES[extname(src).toLowerCase()] };
    },
  });
  return { design, model: await build(design, { resolvers }) };
}

function summary(m: Model): string[] {
  const d = m.diagnostics;
  const size = [0, 1, 2].map((i) => (d.bbox.max[i] - d.bbox.min[i]).toFixed(1)).join(' x ');
  const lines = [`bodies ${m.bodies.length}, pieces ${d.pieces}, cavities ${d.cavities ?? 0}, genus ${d.genus}`, `size ${size} mm, volume ${(d.volume / 1000).toFixed(2)} cm3, built in ${d.buildMs?.toFixed(0)} ms`];
  for (const s of d.shadows ?? []) lines.push(`shadow ${s.slot}: ${(100 * s.missingShare).toFixed(2)} % missing`);
  for (const w of d.warnings) lines.push(`warning: ${w}`);
  return lines;
}

/** Re-read a printing file and require every edge to be used exactly twice, once each way. */
function verify(format: string, bytes: Uint8Array): string {
  const meshes = format === '3mf' ? read3mf(bytes).objects : format === 'stl' ? [readStl(bytes)] : [];
  for (const mesh of meshes) {
    const r = checkClosedMesh(mesh);
    if (!r.closed) throw new Error(`The written ${format} is not a closed mesh: ${JSON.stringify(r)}`);
  }
  const unit = format === '3mf' ? `, unit ${read3mf(bytes).unit}` : '';
  return meshes.length ? `re-read: ${meshes.length} closed mesh${meshes.length > 1 ? 'es' : ''}${unit}` : 'not re-read (no reader for this format)';
}

async function main(argv: string[]) {
  const [cmd, path, ...rest] = argv;
  if (cmd === 'formats') return void console.log(Object.values(exporters).map((e) => `${e.id.padEnd(11)} .${e.extension.padEnd(4)} ${e.title}`).join('\n'));
  if (!cmd || !path || !['build', 'check'].includes(cmd)) throw new Error(USAGE);
  const { design, model } = await loadDesign(path);
  if (cmd === 'check') {
    console.log(summary(model).join('\n'));
    const bad = model.bodies.length === 0 || model.diagnostics.warnings.some((w) => /Internal check failed/.test(w));
    process.exitCode = bad ? 1 : 0;
    return;
  }
  const format = flag(rest, 'format', '3mf')!;
  const out = flag(rest, 'out');
  if (!out) throw new Error(`--out is required.\n${USAGE}`);
  const bytes = exportModel(model, format, { title: design.title });
  await writeFile(out, bytes);
  console.log(`wrote ${out} (${bytes.length} bytes)`);
  console.log(summary(model).join('\n'));
  console.log(verify(format, bytes));
}

main(process.argv.slice(2)).catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
