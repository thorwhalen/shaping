import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = new URL('..', import.meta.url).pathname;
const files = (dir: string): string[] =>
  readdirSync(join(src, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
const imports = (file: string) => [...readFileSync(join(src, file), 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);

describe('module boundaries', () => {
  it('genres import only the core public entry (and zod)', () => {
    for (const f of files('genres')) {
      if (f.endsWith('index.ts')) continue;
      for (const i of imports(f)) expect([`../core.js`, 'zod'], `${f} imports ${i}`).toContain(i);
    }
  });

  it('the library never imports React or three.js', () => {
    for (const f of files('.').filter((f) => !f.includes('__tests__')))
      for (const i of imports(f)) expect(/^(react|three|@react-three)/.test(i), `${f} imports ${i}`).toBe(false);
  });
});
