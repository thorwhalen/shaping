/**
 * Draws the app icons (PNG) from the same glyph as `public/icon.svg`: a triangle on the paper
 * colour. Run from `app/`: `node scripts/make-icons.mjs`. The PNGs are committed; this is here so
 * they can be regenerated.
 */
import { encode } from 'fast-png';
import { writeFileSync } from 'node:fs';

const PAPER = [0xf4, 0xf1, 0xea];
const ACCENT = [0xd4, 0x76, 0x3b];
/** The glyph's triangle in a 32-unit box (same as icon.svg). */
const TRIANGLE = [[6, 26], [16, 4], [26, 26]];
const BOX = 32;
/** Samples per pixel side, for smooth edges. */
const SUPERSAMPLE = 4;
/** The glyph fills this share of a maskable icon (the safe zone is the inner 80%). */
const MASKABLE_SCALE = 0.7;

const inside = (p, [a, b, c]) => {
  const s = (q, r, t) => (q[0] - t[0]) * (r[1] - t[1]) - (r[0] - t[0]) * (q[1] - t[1]);
  const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

function icon(size, scale) {
  const data = new Uint8Array(size * size * 3);
  const map = ([x, y]) => [(x - BOX / 2) * scale + BOX / 2, (y - BOX / 2) * scale + BOX / 2];
  const tri = TRIANGLE.map(map);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let j = 0; j < SUPERSAMPLE; j++) {
        for (let i = 0; i < SUPERSAMPLE; i++) {
          const p = [((x + (i + 0.5) / SUPERSAMPLE) / size) * BOX, ((y + (j + 0.5) / SUPERSAMPLE) / size) * BOX];
          if (inside(p, tri)) hit++;
        }
      }
      const t = hit / (SUPERSAMPLE * SUPERSAMPLE);
      for (let k = 0; k < 3; k++) data[(y * size + x) * 3 + k] = Math.round(PAPER[k] * (1 - t) + ACCENT[k] * t);
    }
  }
  return encode({ width: size, height: size, data, channels: 3, depth: 8 });
}

const out = (name, size, scale) => writeFileSync(new URL(`../public/${name}`, import.meta.url), icon(size, scale));
out('icon-192.png', 192, 1);
out('icon-512.png', 512, 1);
out('icon-maskable-512.png', 512, MASKABLE_SCALE);
out('apple-touch-icon.png', 180, 1);
