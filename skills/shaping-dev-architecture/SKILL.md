---
name: shaping-dev-architecture
description: Read first on any non-trivial change to shaping. The pipeline (source, figure, genre, model, consumers), the four data types, what belongs to the core and what belongs to a genre, the five seams and what is deliberately not a seam, and the rules that keep what is shown equal to what is exported. Triggers on "add a genre", "add a transform", "where does this go", "new exporter", "new dial", "change the Design schema", "why can't the viewer do this itself".
metadata:
  audience: developers
---

# shaping — architecture rules

Full text: `docs/architecture.md`. Evidence: `docs/research_report.md`.

## The pipeline

source → prepare → `Figure` → `genre.build(figures, params, { kernel })` → `Model` → viewer, exporters, checks, animation.

## Rules

1. **What is shown is what is exported.** The viewer never builds geometry. If an effect changes the solid, it changes the `Design` and the `Model` is rebuilt. No shader that fakes geometry.
2. **The `Design` is the only representation of a piece of work.** Gallery entries, saved work, shared links and command-line input are all `Design` JSON. Never a gallery entry written as code.
3. **The Zod schema is the source of truth.** Types, defaults, validation and the dials panel are derived from it. A dial that exists only in a component is a bug.
4. **No fixed numbers in code.** Segment counts, sizes, margins and thresholds are parameters with defaults in a schema, or fields of a process profile.
5. **The core imports neither React nor three.js.** Genres import only the core's public entry. The lint rule enforces both; do not disable it.
6. **Plain data crosses every boundary.** Typed arrays and JSON. No kernel object, no three.js object, no class instance leaves the worker.
7. **Everything heavy runs in a worker** and can be cancelled when a newer build supersedes it.
8. **No reference to any earlier prototype** in code, data, comments, documentation or commit messages.

## Where a new thing goes

| Adding | Goes in | Must provide |
|---|---|---|
| A way to turn a part into a solid | `transforms/<id>.ts` | Zod params, `build`, `originalSlice` |
| A new kind of object | `genres/<id>.ts` | `id`, `title`, `slots`, Zod params, `build` |
| A file format | `export/<id>.ts`, plus a row in the exporters table | pure `(model, options) => bytes`, and a read-back test |
| A manufacturing process | a row in `profiles` | thresholds only |
| A way to get a mask from an image | an implementation of `segment` | same signature as the cascade |
| A user action | `actions.ts` | `(design, params) => design`, with a Zod schema for `params` |

## Seams (current defaults)

`kernel` Manifold · `segment` threshold cascade · `trace` marching squares · `store` zodal localStorage · `genres` the built-in table. Surfaces built: web app, command line.

Before adding a sixth, read the global `architecture-first` skill: a seam needs a replacement you can point at, and costs one argument.

## The test that must never break

`pnpm shaping build examples/triplet.json --format 3mf --out <file>`, then re-read the file and check every edge is used exactly twice.
