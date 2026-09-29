# Shaping — deep research report

Date: 2026-09-28. Working name: "shaping". Scope: a browser-first tool that turns 2D figures into parametrized 3D objects, for viewing, GIF and video, 3D printing and engraving, built as a core plus "genres". The first two genres are turned components (revolve and its relatives, per component) and shadow blocks (a solid whose orthogonal shadows are given figures).

## How to read this report

Part 0 is the synthesis: the findings that decide the design, each with its source. Parts A, B and C are the three research tracks in full. References are numbered once for the whole document, Vancouver style, and listed at the end.

Evidence levels used throughout: *read directly* (the page or file was fetched and read), *search excerpt only*, *measured here* (run locally in Node, one run, one machine), and *analysis* or *derivation* (reasoning, not a quotation). Each part ends with a list of what could not be verified. Section references inside a part ("section 6", "Part 2") point within that part.

Two limits to keep in mind. No library was run in a browser during the research; the timings are from Node. And one research tool produced invented figures for the Shadow Art paper, so that paper was read from its PDF and nothing about it comes from a summary.

## Part 0 — Synthesis

### 0.1 The shape of the problem

Every genre is the same four-stage pipeline with a different third stage:

1. **Source to figure.** An image, a vector file or a drawing becomes a *figure*: polygons with holes, split into components, with a units field. Raster sources go through a mask; vector sources and drawings enter as polygons directly {{A:71}}{{A:76}}.
2. **Figure preparation.** Threshold, clean, smooth, thicken, offset. This is where the user's "2D tuning" dials live.
3. **Genre.** A function from figures and parameters to solids. Turned components maps each component to a 2D-to-3D transform and unions the results. Shadow blocks maps n figures to n view directions and intersects the extrusions {{B:34}}{{B:35}}.
4. **Model to consumers.** The solid becomes plain data (typed arrays plus diagnostic polygons) read by the viewer, the exporters, the printability checks and the animation renderer.

Stages 1, 2 and 4 are the core. Stage 3 is the plugin point. The two genres the brief names do share everything except stage 3, which is the evidence that the boundary is in the right place.

### 0.2 Decisions the research settles

| Question | Finding | Consequence |
|---|---|---|
| Which solid kernel? | Manifold (`manifold-3d`, Apache-2.0, about 205 kB gzipped) is the only browser kernel whose output is manifold by construction {{B:5}}{{B:7}}. Measured here on a trip-let: 9 ms and no open edges, against 477 ms (three-bvh-csg) and 617 ms (JSCAD), both leaving thousands of open edges. The author of three-bvh-csg states its output may not be manifold {{B:45}}. | Wrap Manifold, in a Web Worker. Build every solid through its constructors so no repair step exists. |
| Do we need a 2D polygon library? | Manifold's `CrossSection` does union, difference, offset with join types, simplify and decompose, on Clipper2 {{A:58}}{{B:11}}. | No second library. 2D and 3D share one robustness model. |
| Image processing library? | OpenCV.js is a 13.3 MB file {{A:22}}. Thresholding, 3x3 morphology, labelling and a distance transform are each tens of lines over a typed array {{A:30}}. | Write the mask stage by hand, in a worker. |
| Default threshold? | Otsu assumes a two-peaked histogram and benefits from a blur first {{A:1}}. Adaptive methods hollow out filled shapes (analysis). | A cascade: alpha if present, else Otsu on blurred luminance, polarity from the border pixels. Everything else is a dial. |
| Tracer? | Potrace and its faithful ports are GPL-2.0 {{A:35}}{{A:36}}; `marchingsquares` is AGPL {{A:43}}. `d3-contour` is ISC, 3.2 kB gzipped, and returns polygons with holes nested {{A:34}}. | Marching squares on a smoothed field. Avoid Potrace. |
| Will three shadows be right? | No, not usually: "inconsistency is the rule rather than the exception for more than two shadow sources" {{B:34}}. The achieved shadow is always a subset of the target. | A shadow checker belongs in the core, and the viewer must show what is missing, where. No existing tool found does this. |
| Cheap fixes for bad shadows? | Two orthogonal silhouettes are consistent exactly when they occupy the same positions along their shared axis (derivation). A frame or bar common to the figures makes three consistent; the one example in Shadow Art that needed no deformation had exactly that {{B:34}}. | Offer reposition, axis reassignment, mirror, frame, base bar and thickening before anything research-grade. |
| Disconnected pieces? | Shadow Art does not solve connectivity; it uses a transparent medium, threads or a pedestal {{C:21}}. `decompose()` reports the pieces {{C:3}}. | Detect, show, and offer: drop dust, keep largest, base plate, struts, thicken. |
| Print format? | STL carries no units and loses topology {{C:5}}{{C:2}}. 3MF carries units, colour and several bodies, and defines manifoldness {{C:4}}. three.js has no 3MF exporter {{C:32}}. | 3MF by default, written by hand on `fflate` (about 150 lines). Binary STL as the universal fallback. |
| "CAD export"? | A STEP file made from a mesh is an STL in substance {{C:47}}. True B-rep needs OpenCascade: LGPL-2.1, tens of megabytes {{C:45}}. | In v1, "CAD" means clean DXF and SVG profiles in millimetres plus a documented recipe. True STEP is a later optional module. |
| Animation export? | Realtime capture records dropped frames and wall-clock timing {{C:65}}. WebCodecs is in Chrome 94, Firefox 130 and Safari 16.4 for video {{C:59}}. | Render deterministically, frame by frame: the animation is a function from frame index to parameters. WebCodecs with Mediabunny for video {{C:61}}, `gifenc` for GIF {{C:53}}. |
| Renderer? | The three.js manual still calls `WebGPURenderer` experimental, and it does not support `ShaderMaterial` or `EffectComposer` {{B:55}}. | three.js on WebGL, through react-three-fiber and drei. No custom shaders. |
| Wall shadows and section caps? | The kernel returns exact polygons from `project()` and `slice()` {{B:4}}. | Draw them as geometry. They are exact, exportable, and can show target, achieved and missing together. Real shadow maps are a toggle. |

### 0.3 Ways to turn a figure into a solid

Part B, section 1 describes fifteen methods, each with its maths, dials, names in OpenSCAD, CadQuery, Fusion and Blender, and pitfalls. The column that matters most for this tool is whether a plane cut through the solid reproduces the original figure, because the brief asks that a slice often be the original image.

| Method | Exact slice of the figure? | In v1? |
|---|---|---|
| Linear extrude, with twist and scale | Yes: the base slice; every slice without twist or scale | Yes |
| Revolve, full or partial | Yes: every half-plane through the axis | Yes |
| Rotational array of slabs (n copies about an axis) | Yes: the mid-plane of each slab | Yes |
| Stacked rotated layers | Yes: each layer, rotated | Yes (a parameter of extrude) |
| Inflate (height from distance to the boundary) | Yes: the mid-plane | Next |
| Helical sweep | Yes: a half-plane through the axis, once per turn | Next |
| Sweep along a path | Yes: at the path start | Later |
| Loft between profiles | Yes: at each station | Later |
| Bevel and round | Yes: in the unbevelled zone | Later |
| Relief and lithophane | No: the figure is the top view | Later |
| Wrap on a cylinder | No planar slice | Later |
| Visual hull from n views | No: the projections match, not the slices | Yes, as the shadow-blocks genre |

Two findings shape the transform interface. A revolve is undefined when the figure crosses the axis, and OpenSCAD simply refuses it {{B:1}}; each transform must state its policy (clip to one side, revolve both halves and union, or refuse and show the cut). And every transform should declare the plane whose cut gives back the figure, so that a single "show the original slice" button works for all of them.

### 0.4 What to wrap and what to write

| Wrap | Write by hand |
|---|---|
| `manifold-3d`: all Booleans, extrude, revolve, 2D offset and union, project, slice, decompose | Threshold cascade, morphology, labelling, distance transform |
| `three`, `@react-three/fiber`, `@react-three/drei`: viewer and staging | Marching squares tracing (or wrap `d3-contour`), simplification, smoothing |
| `perfect-freehand`: pen strokes as polygons {{A:76}} | 3MF, binary STL, SVG, DXF writers |
| `mediabunny`: video muxing over WebCodecs | The shadow checker and the printability checks |
| `gifenc`: GIF encoding | Rotation-minimising frames for sweeps {{B:21}} |
| `fflate`: zip, and the 3MF container {{C:69}} | The voxel route (mask AND, carving) |
| `dxf`: DXF input {{A:71}} | The deterministic frame loop |
| `zod`, `zustand`, `immer`: schema and state | |

Lazy-loaded and optional: a HEIC decoder (`heic-to`, LGPL-3.0, only when native decoding fails {{A:60}}{{A:63}}), machine-learning background removal (`@huggingface/transformers`, Apache-2.0, with a permissively licensed model {{A:9}}), USDZ for AR, PDF cut sheets.

### 0.5 Licences to keep out

GPL or AGPL, and therefore not to be bundled: Potrace and its ports, `marchingsquares`, `@imgly/background-removal`, `gifski-wasm`, `@ffmpeg/core`, the LibreDWG and libdxfrw WebAssembly builds, any CGAL build. Non-commercial: the RMBG models. Proprietary: tldraw. LGPL, acceptable only as a separately loaded and replaceable file, subject to confirmation: `heic-to`, `libheif-js`, the OpenCascade builds. MPL-2.0 (file-level copyleft, compatible with bundling): `mediabunny`. One repository of prior art is GPL-3.0 and must not be copied from {{B:41}}.

### 0.6 Known gotchas, found by running the code

- `manifold-3d` 3.5.4: passing the extrusion's top scale as a plain number gave a wedge (volume 3 instead of 6). Pass a two-element array. The wrapper hides this.
- Manifold objects are not garbage-collected; each needs `delete()` {{B:8}}. The wrapper owns this, and callers never see it.
- A non-zero "extra shadow" (shadow minus target) means an axis-convention bug. Keep it as an assertion.
- glTF is metres with +Y up; 3MF is millimetres with +Z up. Convert in one place.
- drei's `Environment` presets fetch from a CDN and are not meant for production {{B:62}}. Bundle the HDR files.
- A strict Content-Security-Policy may break Manifold's bindings {{B:10}}. Test under the deployed policy early.

### 0.7 Open points the research could not close

- Browser timings for the kernel and the mask stage. Expected to be close to Node; not measured.
- Whether slicers honour 3MF core `basematerials` colours for multi-material assignment. Needs a test with PrusaSlicer, Bambu Studio and Cura.
- Manifold's behaviour when a revolve profile crosses the axis. The tool avoids the question by clipping first.
- Which DXF versions each laser tool accepts, and whether they honour the units header.
- Quality of the permissively licensed background-removal models on real photographs.

