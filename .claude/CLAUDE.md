# shaping — agent index

Turn 2D figures into parametrized 3D objects. A TypeScript library (`packages/shaping`: core, genres, exporters, imaging, animation) and a React app (`app/`) deployed at apps.thorwhalen.com/shaping/. pnpm workspace.

Read `skills/shaping-dev-architecture/SKILL.md` before any non-trivial change. The full design is `docs/architecture.md`; the plan is `docs/implementation_plan.md`; the evidence is `docs/research_report.md`.

## Map

| Working on | Read |
|---|---|
| Where anything goes; the pipeline, seams, rules | `shaping-dev-architecture` |
| The kernel, a transform, 2D polygon ops, geometry tests | `shaping-dev-geometry-kernel` |
| The shadow-blocks genre or the shadow checker | `shaping-dev-shadow-blocks` |
| Images, SVG, drawings -> figures | `shaping-dev-imaging` |
| Exporters, units, printability checks, laser files | `shaping-dev-embodiment-export` |
| The viewer, materials, GIF/video/PNG output | `shaping-dev-viewer-media` |
| Animation tracks; anything shared with the `an` package | `shaping-dev-sibling-an` |

## Commands

```bash
pnpm install
pnpm test                 # library tests (geometry by property, exporters by read-back)
pnpm build                # library, then app
pnpm shaping build examples/triplet.json --format 3mf --out /tmp/triplet.3mf
pnpm dev                  # the app, locally
```

## Rules that bite

- The viewer never builds geometry: what is shown is what is exported.
- Genres import only `src/core.ts` (a test enforces it). The core imports neither React nor three.js.
- No reference to any earlier prototype, anywhere.
- No data in the repository beyond small example designs authored here.
