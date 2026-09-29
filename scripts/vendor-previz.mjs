#!/usr/bin/env node
/**
 * Unpack the previz library into vendor/previz (gitignored), where the app resolves it.
 *
 * previz is a private library, not on npm yet, and this repository is public: its source, its
 * tarball and even its name in the lockfile stay out of the repository. The app resolves `previz`
 * through aliases (app/vite.config.ts, app/tsconfig.json) to vendor/previz/dist.
 *
 * The tarball is taken from `$PREVIZ_TARBALL`, else from previz's build output in the user's data
 * folder (`~/.local/share/previz/dist/`), else packed from a sibling clone (`../previz`).
 * Run: `node scripts/vendor-previz.mjs [--force]`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The previz version this app is written against. */
export const PREVIZ_VERSION = '0.1.0';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'vendor', 'previz');
const tarName = `previz-${PREVIZ_VERSION}.tgz`;

if (existsSync(join(dest, 'dist', 'index.js')) && !process.argv.includes('--force')) process.exit(0);

function findTarball() {
  const direct = [process.env.PREVIZ_TARBALL, join(homedir(), '.local', 'share', 'previz', 'dist', tarName)].filter(Boolean);
  const hit = direct.find((p) => existsSync(p));
  if (hit) return hit;
  const sibling = resolve(root, '..', 'previz');
  if (!existsSync(join(sibling, 'package.json'))) return null;
  const out = mkdtempSync(join(tmpdir(), 'previz-pack-'));
  execFileSync('npx', ['--yes', 'pnpm@11', 'pack', '--pack-destination', out], { cwd: sibling, stdio: 'inherit' });
  const packed = readdirSync(out).find((f) => f.endsWith('.tgz'));
  return packed ? join(out, packed) : null;
}

const tarball = findTarball();
if (!tarball) {
  console.error(`previz: ${tarName} not found. Set PREVIZ_TARBALL to the packed tarball, or clone thorwhalen/previz next to this repository.`);
  process.exit(1);
}
const work = mkdtempSync(join(tmpdir(), 'previz-unpack-'));
execFileSync('tar', ['-xzf', tarball, '-C', work]);
rmSync(dest, { recursive: true, force: true });
renameSync(join(work, 'package'), dest);
console.log(`previz: unpacked ${tarball.split('/').pop()} into vendor/previz`);
