# Shaping — implementation plan

Date: 2026-09-28. Written for option A (one repository, a library and an app), which was chosen on 2026-09-29 with the name `shaping`.

## Order of work

Each step ends with something that runs. A step is not done until its test passes.

| # | Step | Produces | Done when |
|---|---|---|---|
| 0 | Repository | `thorwhalen/shaping` under `tt/`, pnpm workspace, TypeScript, Vitest, lint rule that keeps genres on the core's public entry, CI, the dev skills and `.claude/CLAUDE.md` index, the two ADRs and the research report under `docs/` | CI is green on an empty library and an empty app |
| 1 | Types and schema | `Mask`, `Figure`, `Design`, `Model`, `Genre`, `Transform`; the `Design` Zod schema with `version: 1` | A hand-written example design validates; an invalid one fails with a message that names the field |
| 2 | Kernel wrapper | `kernel` over `manifold-3d`: figures in, bodies out; owns `delete()`; hides the top-scale gotcha; runs in Node and in a worker | Extruding a 1 by 2 rectangle by 3 gives volume 6; no Manifold object is left alive after a build |
| 3 | Shadow blocks, from polygons | `genres/shadow-blocks`: extrude three figures, intersect, diagnostics | Three test figures give one piece with the expected genus; the "extra shadow" is empty for every view |
| 4 | The shadow checker | Per view: achieved shadow, missing region, missing share; per solid: pieces, genus, volume | A pair of figures that occupy different heights reports the missing rows; a framed triple reports nothing missing |
| 5 | Exporters, first set | 3MF (hand-written, on `fflate`), binary STL, SVG and DXF profiles | The written 3MF re-reads as a closed mesh with every edge used exactly twice; the SVG is in millimetres with closed paths |
| 6 | Command line | `shaping build <design.json> --format <id> --out <file>` and `shaping check <design.json>` | **The one-command test of v1 passes** |
| 7 | Turned components | `transforms/extrude`, `revolve`, `radialArray`; `genres/turned`; per-part colour; `originalSlice` | For each transform, the kernel's slice at the declared plane equals the input figure within tolerance |
| 8 | Image to figure | Decode, threshold cascade, morphology, labelling, distance field, tracing, simplification, smoothing; all in a worker | A black disc on white gives one part whose area is within 1 % of the disc; a ring keeps its hole; two blobs give two parts |
| 9 | App shell | Vite, React, store, routing, the design list, autosave through the zodal store | A design survives a reload; Back returns to the list, not out of the app |
| 10 | Viewer | Solid, materials presets, lights, ground shadow, orbit, orthographic switch, section plane with a cap from the kernel's slice | The example design renders; the cap matches the figure |
| 11 | Source panel | Upload (PNG, JPG, SVG; HEIC where the browser decodes it), the threshold and tuning dials with a live mask preview, the thin-feature overlay | Changing the threshold never re-reads the file; thin regions are marked on the image |
| 12 | Drawing | Pen with width, line, rectangle, ellipse, eraser, undo; strokes are polygons | A drawn shape becomes a figure with no tracing step |
| 13 | Genre panels | Dials generated from each genre's schema; the fixes for shadow blocks as one-click actions | Every dial in the schema appears; adding a frame removes the missing regions of the example |
| 14 | Wall shadows | Three walls with target, achieved and missing layers; a toggle for real light | The missing region on the wall equals the checker's polygon |
| 15 | Checks panel | Process profiles as data; live checks; on-demand 3D thickness and trapped voids in a worker | A figure with a 0.3 mm stroke at 50 mm is flagged for FDM |
| 16 | Animation and media export | Turntable and parameter sweep; PNG stills; GIF (`gifenc`); video (WebCodecs with `mediabunny`), with a recorded fallback | A 60-frame turntable loops without a jump; the same design gives the same frames twice |
| 17 | More mesh formats | GLB, PLY, OBJ with MTL, zipped print pack | Each file opens in a reference viewer |
| 18 | Gallery | Example designs as JSON, each opening in the editor | Every gallery entry is a `Design` that validates; none is code |
| 19 | Browser verification | The whole flow, in Chrome, by hand and recorded | Both genres: source to export, with the exported file checked |
| 20 | Landing and deploy | Review, PR, CI, merge; static app on the platform, deployed from the Mac | The deployed page serves the build that was merged |

Steps 0 to 6 are the spine and give the one-command test. Steps 7 and 8 complete the core. Steps 9 to 18 are the app.

## What is cut from v1, by name

Inflate, helical sweep, sweep along a path, loft, bevel, relief and lithophane, wrapping; n views beyond three; image deformation in the manner of Shadow Art; the voxel route and carving; hollowing and drain holes; struts; true STEP; DXF and DWG input; machine-learning background removal; USDZ; PDF cut sheets; stacked-slice layout; 16-bit depth maps; a command palette, hotkeys and AI tools.

Each has a place to go: a transform, a genre option, an exporter, or a `segment` implementation. None needs a change to a caller.

If the budget is exceeded, cut in this order: step 17, step 12, the recorded fallback in step 16, the on-demand checks in step 15. Seams are not cut.

## Delegation

One session per repository or worktree, on disjoint files, with the split written into each brief. The lead keeps steps 0 to 4 and 7 (the types, the kernel and the genres), because everything else depends on their shape.

| Work | Who | Files | Model and effort |
|---|---|---|---|
| Steps 0–4, 6, 7, 13, 14 | lead (this session) | `packages/shaping/src/{types,design,kernel,genres,transforms,checks}`, `app/src/genres` | — |
| Step 5, 17: exporters | subagent, own worktree | `packages/shaping/src/export/**` | sonnet, medium |
| Step 8: image to figure | subagent, own worktree | `packages/shaping/src/imaging/**` | sonnet, medium |
| Step 12: drawing | subagent, own worktree | `app/src/draw/**` | sonnet, medium |
| Step 16: animation and media | subagent, own worktree | `packages/shaping/src/animate/**`, `app/src/media/**` | sonnet, medium |
| Pointer to this project in `an` | the `an` repository's own session, or a new one there | `an`'s documentation only | sonnet, medium |
| Adversarial review before landing | fresh subagent | read-only | opus, high |

The interface each delegated piece must meet is fixed in step 1, before any of them starts.

## Testing

- **Geometry** is tested by property, not by picture: volume, piece count, genus, closedness, and equality of polygons (slice against figure, shadow against target).
- **Exporters** are tested by reading back what they wrote.
- **Imaging** is tested on figures generated in the test (discs, rings, bars), with no image files in the repository.
- **The app** is tested by where Back lands, by reload, and by one end-to-end flow per genre.
- **Renders** are compared as images only for the deterministic frame loop, with a tolerance.

## Risks

| Risk | Sign | Response |
|---|---|---|
| Manifold's bindings fail under the platform's Content-Security-Policy | The kernel does not start on the deployed page | Test on the platform at step 9, not at step 20 |
| Rebuilds feel slow on large figures | More than about 100 ms per dial move | Simplify contours harder while dragging, rebuild at full detail on release |
| Traced contours self-intersect after smoothing | The kernel reports an error status | Pass every figure through a 2D union before it reaches a genre |
| Slicers ignore the 3MF colours | Parts arrive uncoloured | Test with three slicers at step 5; fall back to one object per colour |
| The worker and the page disagree on a type | Runtime errors after a schema change | One schema module, imported by both; the worker validates what it receives |
