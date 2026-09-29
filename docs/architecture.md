# Shaping — architecture

Date: 2026-09-28. Status: accepted 2026-09-29 (section 9 records the decisions). Evidence for every library choice is in `research_report.md`; this document does not repeat it.

## 1. What is being built

A browser-only tool. The user brings a 2D figure (an image, a vector file, or a drawing made in the app), chooses a *genre*, turns dials, and gets a 3D object that can be looked at, animated, printed or engraved. Nothing is sent to a server.

The definition of done for v1 is one command and one page:

```
v1 done when: `pnpm shaping build examples/triplet.json --format 3mf --out /tmp/triplet.3mf`
              writes a 3MF that re-reads as a closed manifold mesh with its size in millimetres,
              and the same design opened in the app shows the solid, its three wall shadows
              with the missing regions marked, and exports the same bytes.
```

That command is also the first test. It must still pass after every later change to a seam.

## 2. The pipeline

```
 source            figure              genre               model              consumers
 ------            ------              -----               -----              ---------
 image  ─┐                                                                   ┌─ viewer
 SVG/DXF ─┼─► prepare ─► Figure ─► genre.build(figures, params) ─► Model ─────┼─ exporters
 drawing ─┘   (mask,     (polygons   (uses the kernel)      (typed arrays,   ├─ checks
              contours)   + parts)                           polygons,        └─ animation
                                                             report)
```

Four data types cross the boundaries. All are plain, JSON-able or typed-array data, so they pass between a worker and the page, and between the browser and Node, without conversion.

| Type | What it is | Notes |
|---|---|---|
| `Mask` | `{ width, height, data: Uint8Array }` | One byte per pixel. Only raster sources have one. |
| `Figure` | `{ units, parts: Part[] }`, where a `Part` is `{ id, polygons, color? }` and a polygon is an outer ring plus hole rings | Vector sources and drawings start here. Parts are the individually colourable components. |
| `Design` | The document: sources, preparation parameters, genre id, genre parameters, style, view, animation. Validated by a Zod schema, with a `version` field | The single source of truth. What is saved, shared, put in the gallery, and given to the command line. |
| `Model` | `{ bodies: Body[], diagnostics }`, where a `Body` is `{ partId, positions, indices, color }` | What the kernel produced, as data. `diagnostics` holds polygons (shadows, slices, missing regions) and numbers (volume, piece count, genus). |

**The rule that the earlier prototype taught: the thing on screen is the thing exported.** The viewer never builds geometry of its own. An animation that changes the solid changes the `Design` parameters and rebuilds the `Model`; it is never a shader effect that the exporter cannot see.

## 3. Core and genres

**The core** owns stages 1, 2 and 4: decoding sources, the mask operations, tracing, figure preparation, the kernel wrapper, the checks, the exporters, the frame loop for animation, and the `Design` schema. It has no dependency on React or three.js.

**A genre** owns stage 3 and nothing else. It is one object:

```ts
export const shadowBlocks: Genre<ShadowParams> = {
  id: 'shadow-blocks',
  title: 'Shadow blocks',
  slots: [{ id: 'x' }, { id: 'y' }, { id: 'z' }],   // how many figures it takes
  params: ShadowParams,                              // a Zod schema: the dials, with defaults
  build(figures, params, { kernel }) { ... },        // returns a Model
}
```

The dials panel is generated from `params`. A genre does not write UI unless the schema cannot express what it needs.

**A transform** is the smaller unit that the turned-components genre composes: a 2D-to-3D operator with its own Zod schema, a `build(part, params, kernel)` and an `originalSlice(params)` that returns the plane whose cut gives back the figure, or nothing. v1 ships three: `extrude` (with twist, top scale and stepped layers), `revolve` (angle, axis, offset, policy for a figure that crosses the axis) and `radialArray` (n slabs about an axis, thickness, span). The research lists twelve more and marks which come next.

**The two genres of v1.**

| | Turned components | Shadow blocks |
|---|---|---|
| Takes | one figure, several parts | three figures (n later) |
| Does | gives each part a transform and a colour, then unions | extrudes each figure along its axis, then intersects |
| Shows | the original slice, per part | three wall shadows: target, achieved, missing |
| Reports | pieces, volume | the same, plus the share of each shadow that is missing |
| Fixes offered | hub or base to join loose parts | reposition, reassign axes, mirror, frame, base bar, thicken, drop dust, keep largest |

What the two share is everything except `build`: sources, preparation, the kernel, the checks, the viewer, the exporters and the animation. That is the line the brief asked to be drawn between the two points.

## 4. Seams

A seam is one keyword argument whose default is the strongest implementation that needs no extra dependency, declared only where the replacement already exists.

| # | Seam | v1 default | Replacement that already exists |
|---|---|---|---|
| 1 | `kernel`: the solid modeller | Manifold (`manifold-3d`), in a worker | `replicad` on OpenCascade, for true STEP export |
| 2 | `segment`: image to mask | the threshold cascade, hand-written | a matte from `@huggingface/transformers` with a permissive model |
| 3 | `trace`: mask to polygons | marching squares on a smoothed field | `imagetracerjs`, VTracer's WebAssembly build |
| 4 | `store`: where designs are kept | `@zodal/store-localstorage` | `@zodal/store-s3`, `@zodal/store-supabase` |
| 5 | `genres`: the table of genres | `{ turned, shadowBlocks }` | the second entry is the evidence; a third-party genre is a third |

```
Surface for v1: the web app, plus a command line over the same core.
NOT seams:      the renderer (three.js on WebGL, written directly), the exporters' file formats,
                the process profiles (plain data records), the dials panel, the drawing canvas,
                the simplification and smoothing algorithms.
```

Two tables look like registries and are deliberately only data: `exporters` (format id to a pure function `(model, options) => bytes`, with extension, media type and what the format can carry) and `profiles` (process name to thresholds). The export menu and the checks read them. Neither has a loader, a base class or a lifecycle.

Source images are kept in memory while a design is open, so that the threshold can be changed without loss, and in IndexedDB between visits. `# seam candidate: a blob store` — it becomes a seam on the day designs are shared between devices.

## 5. Surfaces

| Surface | Would it need the core to change? | Built in v1? |
|---|---|---|
| Web app | — | Yes. It is the product. |
| Command line (Node) | No. Manifold runs in Node; the core takes a `Design` and returns bytes. Raster decoding needs a Node decoder behind the same `decode` function. | Yes, minimal: `build` and `check`. It is the cheapest proof that the core is not fused to the page. |
| MCP, agent tools | No. Every user action is a named function over the `Design` with a Zod parameter schema, which is the shape a command registry needs. | No. |
| HTTP | No. The core keeps no module-level state. | No. |
| Shipped agent skills | No. | No. |

User actions are written as plain functions `(design, params) => design` in one module, with their Zod schemas beside them. That is the shape `acture` wraps, so adding a command palette, hotkeys or an AI tool surface later is an addition. No `acture` dependency in v1.

## 6. The frontend

React 19, Vite, TypeScript, zustand with immer, shadcn components, react-three-fiber and drei.

- **One store** holds the open `Design` and the interface state. The `Model` is derived: a worker rebuilds it when the design changes, debounced, and cancels a build that has been superseded.
- **The URL is the state for where the user is**: which design, which genre, which panel. Opening a design is a new history entry; turning a dial replaces the current one.
- **Feedback.** A rebuild that takes longer than about 100 ms shows a busy state on the viewer, and the previous solid is dimmed, not left looking current.
- **Nothing the user drew or tuned is lost.** The open design is saved continuously, keyed by design id, and restored on return.
- **Progressive disclosure.** Each genre opens with a working example and three or four dials. Materials are presets first (matte plastic, glossy plastic, metal, glass, resin), raw dials under "advanced".
- **Units.** The model is normalised; one dial sets the longest edge in millimetres, default 50. Everything that depends on size is computed after scaling.

## 7. Animation, and the relationship to `an`

An animation is a function from a frame index to a `Design`. v1 has two kinds: a turntable (the view changes) and a parameter sweep (one dial moves between two values, and the solid is rebuilt for each frame). Both are rendered frame by frame at the export size, not recorded from the screen.

The track format is taken from the user's Python package `an` (structured animation: a validated scene document, rendered to video), so that the two projects can read each other's tracks: a property path, an action (`set`, `tween` with an easing), and combinators that flatten to a list of actions with absolute times. See ADR 0002.

## 8. Data and privacy

- The repository holds code, example designs (small JSON, authored for this project) and example figures drawn for this project. No meshes, no user images, no build output.
- A user's images and designs never leave the browser.
- The app is static. It is deployed as a static app on the user's platform, from the build output; nothing on the server is written at run time.
- This project contains no reference to any earlier prototype: no names, no data, no imports. Lessons were taken; nothing else was.

## 9. Decisions

Decided 2026-09-29: the name is **shaping**; the split is **option A**; MIT; public; `thorwhalen/shaping`; the related project is `an`; the app is deployed at `apps.thorwhalen.com/shaping/`. The options as they were presented follow.

### 9.1 The name

See `names.md`. Recommendation: keep **shaping**. It is free on npm as an unscoped name, it is neutral between genres, and it is what the project is already called. The alternatives that are also free and have no collision are `umbraform`, `sweepform`, `loftform`, `turnery` and `spinform`; each leans toward one genre.

### 9.2 The package split

| Option | What it is | For | Against |
|---|---|---|---|
| **A. One repository, two workspace members (recommended)** | `packages/shaping`: the library, published to npm, holding the core and both genres, with the genres importable on their own (`shaping/genres/shadow-blocks`). `app/`: the web app, deployed, not published. | One version, one release, one CI. The boundary is physical: the library's `package.json` has no React and no three.js. Genres may import only the core's public entry, enforced by a lint rule, so moving a genre to its own package later is a move, not a rewrite. | The genres are released with the core, not on their own. |
| B. One repository, four packages | `shaping-core`, `shaping-genre-turned`, `shaping-genre-shadow-blocks`, and the app | Each genre is a consumer of the core, as the brief suggests. A third party sees exactly how to write a genre. | Three npm names to hold and three versions to keep aligned while the core's interface is still moving. Every change to the `Genre` type is a coordinated release. |
| C. Separate repositories | One per package | Full independence | The same costs as B, plus cross-repository changes. Nothing in v1 needs it. |

Recommendation: **A now, B when a genre has a reason to be released on its own** (a heavy dependency, a different licence, an outside author). Under A the genres are already written as if they were outside the core, so the move to B does not change any code that calls them.

### 9.3 Smaller points, with a default if there is no answer

| Question | Default |
|---|---|
| Licence | MIT |
| Repository owner and place | `thorwhalen/shaping`, under `tt/` |
| Public or private | Public |
| Is `an` the related project? | Yes (it is the only project that describes itself as structured animation) |
| Deployed at | `apps.thorwhalen.com/shaping/` |

## ADR 0001 — A core with genres, one kernel, data between the stages

**Context.** Two genres are required now and more are expected. A prototype of the first genre existed and had these limits: components were measured by hand; a design existed in two forms that could not be converted; the animated solid could not be exported; values were fixed in code.

**Decision.** The pipeline of section 2, with genres as plain objects (section 3), the seams of section 4, Manifold as the only solid kernel, and plain data between the stages.

**Consequences.** Every solid is manifold by construction, so there is no repair step. Anything shown can be exported. A new genre is one file. The cost is that every geometric operation must be expressed through the kernel or handed to it as a closed mesh, which rules out viewer-only effects.

## ADR 0002 — Relationship to `an` (structured animation)

**Context.** The user maintains `an`, a Python package for structured animation: a scene document, validated, rendered to video by swappable backends. Its targets differ from this project's: `an` makes videos of scenes; this project makes objects. They overlap in two places: both describe things by parameters, and both render animations of those parameters.

**Decision.**

1. This project's animation tracks use `an`'s model: a property path into the document, the actions `set` and `tween` with an easing, and combinators flattened to absolute times. The JSON shape is kept compatible so that a track written for one can be read by the other.
2. Neither project depends on the other. The link is a shared format and shared research, not an import.
3. Each project records the other: this ADR and the dev skill `shaping-dev-sibling-an` here; a short pointer in `an`'s own documentation, added by a session working in that repository.
4. Research to reuse from `an`: its reports on scene-graph and animation system design, on declarative parameter languages, and on animation interchange formats; and its golden-image approach to testing deterministic renders.
5. What `an` may want from here: turntable and parameter-sweep renders of 3D objects as assets for a scene, and the 2D-to-3D transforms as a way to give depth to flat artwork.

**Consequences.** A change to the track format in either project is a change to check against the other. The format is small on purpose.

## 10. Camera pose and colours are display state (2026-09-29)

**Camera pose in the Design.** `view` holds the whole camera: azimuth, elevation, `distance` (in framed radii), pan (`panX`, `panY`, `panZ`, in framed radii), `fovDeg` and, for the orthographic camera, `zoom`. The defaults reproduce the earlier fixed camera (distance 4, no pan, 35°). Orbiting, panning and zooming with the mouse write the pose back into the Design once the movement settles, so the stored state is always what is on screen. One pure function, `cameraFor(view, box)` in `app/src/viewer/camera.ts`, sets up both the on-screen camera and every exported frame's camera, so an export is the view (checked in the browser: mean pixel difference under 3/255 after orbiting, zooming and panning). The environment and lights follow the frame being shown, not the live design, so a previewed or captured frame is lit as it will be exported.

**Colours without a rebuild.** `style.color`, `style.partColors` and `style.palette` are display fields (`render` in the schema), so changing them never rebuilds geometry. This is safe only because colouring is one pure function, `recolor(model, style)` in the core, applied by the viewer and before every export: the build still colours the model it returns (with the same function, `bodyColor`), and each body keeps the colour its genre insisted on (`genreColor`) so recolouring gives exactly what a rebuild would (a test pins this). The alternative, keeping colour in the build key, would make every colour frame of an animation cost a rebuild.
