# shaping

Turn 2D figures into parametrized 3D objects — to look at, animate, 3D-print or engrave.

**App:** [apps.thorwhalen.com/shaping](https://apps.thorwhalen.com/shaping/) · **Library:** `npm install shaping`

Bring a figure (an image, an SVG, a drawing, a shape or block text), pick a *genre*, turn the dials, and export. Everything runs in your browser; nothing is uploaded.

- **Turned components** — split a figure into its parts and give each part its own revolve, extrusion (with twist and taper) or radial array, and its own colour. The figure stays a slice of the object.
- **Shadow blocks** — one solid whose three shadows are three figures, like the trip-let on the cover of *Gödel, Escher, Bach*. The app shows the three shadows on the walls and marks any part the solid cannot cast.

Exports: 3MF and STL for printing; GLB, PLY and OBJ for viewing; SVG and DXF profiles for laser cutting and engraving; PNG, GIF and video of turntables and parameter sweeps.

## Library

```ts
import { build } from 'shaping';
import { toThreeMF } from 'shaping/export';

const model = await build({
  version: 1, id: 'geb', genre: 'shadow-blocks',
  sources: { front: { kind: 'text', text: 'G' }, side: { kind: 'text', text: 'E' }, top: { kind: 'text', text: 'B' } },
});
model.diagnostics.shadows; // per view: target, achieved and missing area
```

A design is plain JSON (validated by a Zod schema); a model is plain typed arrays. Every solid is built by [Manifold](https://github.com/elalish/manifold), so it is closed and printable by construction.

## Command line

```bash
npx shaping build examples/triplet.json --format 3mf --out triplet.3mf
npx shaping check examples/triplet.json
```

## Adding a genre

A genre is one object: an id, the figures it takes (`slots`), a Zod schema of its dials, and a `build` function. See `packages/shaping/src/genres/` and `docs/architecture.md`.

## Related

`an` (structured animation, Python) shares this project's animation track format; see `docs/adr/0002-relationship-to-an.md`.

MIT licence.
