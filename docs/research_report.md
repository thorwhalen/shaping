# Shaping — deep research report

Date: 2026-09-28. Working name: "shaping". Scope: a browser-first tool that turns 2D figures into parametrized 3D objects, for viewing, GIF and video, 3D printing and engraving, built as a core plus "genres". The first two genres are turned components (revolve and its relatives, per component) and shadow blocks (a solid whose orthogonal shadows are given figures).

## How to read this report

Part 0 is the synthesis: the findings that decide the design, each with its source. Parts A, B and C are the three research tracks in full. References are numbered once for the whole document, Vancouver style, and listed at the end.

Evidence levels used throughout: *read directly* (the page or file was fetched and read), *search excerpt only*, *measured here* (run locally in Node, one run, one machine), and *analysis* or *derivation* (reasoning, not a quotation). Each part ends with a list of what could not be verified. Section references inside a part ("section 6", "Part 2") point within that part.

Two limits to keep in mind. No library was run in a browser during the research; the timings are from Node. And one research tool produced invented figures for the Shadow Art paper, so that paper was read from its PDF and nothing about it comes from a summary.

## Part 0 — Synthesis

### 0.1 The shape of the problem

Every genre is the same four-stage pipeline with a different third stage:

1. **Source to figure.** An image, a vector file or a drawing becomes a *figure*: polygons with holes, split into components, with a units field. Raster sources go through a mask; vector sources and drawings enter as polygons directly [71][76].
2. **Figure preparation.** Threshold, clean, smooth, thicken, offset. This is where the user's "2D tuning" dials live.
3. **Genre.** A function from figures and parameters to solids. Turned components maps each component to a 2D-to-3D transform and unions the results. Shadow blocks maps n figures to n view directions and intersects the extrusions [119][120].
4. **Model to consumers.** The solid becomes plain data (typed arrays plus diagnostic polygons) read by the viewer, the exporters, the printability checks and the animation renderer.

Stages 1, 2 and 4 are the core. Stage 3 is the plugin point. The two genres the brief names do share everything except stage 3, which is the evidence that the boundary is in the right place.

### 0.2 Decisions the research settles

| Question | Finding | Consequence |
|---|---|---|
| Which solid kernel? | Manifold (`manifold-3d`, Apache-2.0, about 205 kB gzipped) is the only browser kernel whose output is manifold by construction [59][92]. Measured here on a trip-let: 9 ms and no open edges, against 477 ms (three-bvh-csg) and 617 ms (JSCAD), both leaving thousands of open edges. The author of three-bvh-csg states its output may not be manifold [130]. | Wrap Manifold, in a Web Worker. Build every solid through its constructors so no repair step exists. |
| Do we need a 2D polygon library? | Manifold's `CrossSection` does union, difference, offset with join types, simplify and decompose, on Clipper2 [58][96]. | No second library. 2D and 3D share one robustness model. |
| Image processing library? | OpenCV.js is a 13.3 MB file [22]. Thresholding, 3x3 morphology, labelling and a distance transform are each tens of lines over a typed array [30]. | Write the mask stage by hand, in a worker. |
| Default threshold? | Otsu assumes a two-peaked histogram and benefits from a blur first [1]. Adaptive methods hollow out filled shapes (analysis). | A cascade: alpha if present, else Otsu on blurred luminance, polarity from the border pixels. Everything else is a dial. |
| Tracer? | Potrace and its faithful ports are GPL-2.0 [35][36]; `marchingsquares` is AGPL [43]. `d3-contour` is ISC, 3.2 kB gzipped, and returns polygons with holes nested [34]. | Marching squares on a smoothed field. Avoid Potrace. |
| Will three shadows be right? | No, not usually: "inconsistency is the rule rather than the exception for more than two shadow sources" [119]. The achieved shadow is always a subset of the target. | A shadow checker belongs in the core, and the viewer must show what is missing, where. No existing tool found does this. |
| Cheap fixes for bad shadows? | Two orthogonal silhouettes are consistent exactly when they occupy the same positions along their shared axis (derivation). A frame or bar common to the figures makes three consistent; the one example in Shadow Art that needed no deformation had exactly that [119]. | Offer reposition, axis reassignment, mirror, frame, base bar and thickening before anything research-grade. |
| Disconnected pieces? | Shadow Art does not solve connectivity; it uses a transparent medium, threads or a pedestal [121]. `decompose()` reports the pieces [167]. | Detect, show, and offer: drop dust, keep largest, base plate, struts, thicken. |
| Print format? | STL carries no units and loses topology [169][166]. 3MF carries units, colour and several bodies, and defines manifoldness [168]. three.js has no 3MF exporter [195]. | 3MF by default, written by hand on `fflate` (about 150 lines). Binary STL as the universal fallback. |
| "CAD export"? | A STEP file made from a mesh is an STL in substance [209]. True B-rep needs OpenCascade: LGPL-2.1, tens of megabytes [208]. | In v1, "CAD" means clean DXF and SVG profiles in millimetres plus a documented recipe. True STEP is a later optional module. |
| Animation export? | Realtime capture records dropped frames and wall-clock timing [227]. WebCodecs is in Chrome 94, Firefox 130 and Safari 16.4 for video [221]. | Render deterministically, frame by frame: the animation is a function from frame index to parameters. WebCodecs with Mediabunny for video [223], `gifenc` for GIF [215]. |
| Renderer? | The three.js manual still calls `WebGPURenderer` experimental, and it does not support `ShaderMaterial` or `EffectComposer` [140]. | three.js on WebGL, through react-three-fiber and drei. No custom shaders. |
| Wall shadows and section caps? | The kernel returns exact polygons from `project()` and `slice()` [90]. | Draw them as geometry. They are exact, exportable, and can show target, achieved and missing together. Real shadow maps are a toggle. |

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

Two findings shape the transform interface. A revolve is undefined when the figure crosses the axis, and OpenSCAD simply refuses it [87]; each transform must state its policy (clip to one side, revolve both halves and union, or refuse and show the cut). And every transform should declare the plane whose cut gives back the figure, so that a single "show the original slice" button works for all of them.

### 0.4 What to wrap and what to write

| Wrap | Write by hand |
|---|---|
| `manifold-3d`: all Booleans, extrude, revolve, 2D offset and union, project, slice, decompose | Threshold cascade, morphology, labelling, distance transform |
| `three`, `@react-three/fiber`, `@react-three/drei`: viewer and staging | Marching squares tracing (or wrap `d3-contour`), simplification, smoothing |
| `perfect-freehand`: pen strokes as polygons [76] | 3MF, binary STL, SVG, DXF writers |
| `mediabunny`: video muxing over WebCodecs | The shadow checker and the printability checks |
| `gifenc`: GIF encoding | Rotation-minimising frames for sweeps [106] |
| `fflate`: zip, and the 3MF container [231] | The voxel route (mask AND, carving) |
| `dxf`: DXF input [71] | The deterministic frame loop |
| `zod`, `zustand`, `immer`: schema and state | |

Lazy-loaded and optional: a HEIC decoder (`heic-to`, LGPL-3.0, only when native decoding fails [60][63]), machine-learning background removal (`@huggingface/transformers`, Apache-2.0, with a permissively licensed model [9]), USDZ for AR, PDF cut sheets.

### 0.5 Licences to keep out

GPL or AGPL, and therefore not to be bundled: Potrace and its ports, `marchingsquares`, `@imgly/background-removal`, `gifski-wasm`, `@ffmpeg/core`, the LibreDWG and libdxfrw WebAssembly builds, any CGAL build. Non-commercial: the RMBG models. Proprietary: tldraw. LGPL, acceptable only as a separately loaded and replaceable file, subject to confirmation: `heic-to`, `libheif-js`, the OpenCascade builds. MPL-2.0 (file-level copyleft, compatible with bundling): `mediabunny`. One repository of prior art is GPL-3.0 and must not be copied from [126].

### 0.6 Known gotchas, found by running the code

- `manifold-3d` 3.5.4: passing the extrusion's top scale as a plain number gave a wedge (volume 3 instead of 6). Pass a two-element array. The wrapper hides this.
- Manifold objects are not garbage-collected; each needs `delete()` [93]. The wrapper owns this, and callers never see it.
- A non-zero "extra shadow" (shadow minus target) means an axis-convention bug. Keep it as an assertion.
- glTF is metres with +Y up; 3MF is millimetres with +Z up. Convert in one place.
- drei's `Environment` presets fetch from a CDN and are not meant for production [147]. Bundle the HDR files.
- A strict Content-Security-Policy may break Manifold's bindings [95]. Test under the deployed policy early.

### 0.7 Open points the research could not close

- Browser timings for the kernel and the mask stage. Expected to be close to Node; not measured.
- Whether slicers honour 3MF core `basematerials` colours for multi-material assignment. Needs a test with PrusaSlicer, Bambu Studio and Cura.
- Manifold's behaviour when a revolve profile crosses the axis. The tool avoids the question by clipping first.
- Which DXF versions each laser tool accepts, and whether they honour the units header.
- Quality of the permissively licensed background-removal models on real photographs.

---

## Part A — From image to figure

Date of research: 2026-09-28. Scope: the first layer of a browser-only TypeScript pipeline that turns an uploaded image (PNG, JPG, HEIC, SVG, DXF) or an in-app drawing into a clean foreground/background mask and then into polygons-with-holes suitable for extrusion or revolution.

### How to read this report

Every library row was checked against a live source on the research date. Version, publish date, licence and unpacked size come from the npm registry JSON API [84]. "min / gzip" bundle figures come from the Bundlephobia API [85]. Sizes of individual wasm or JS files come from the jsDelivr package-listing API [86], and the "gzip measured" figures are from downloading that file and compressing it locally with `gzip -6`, so they approximate transfer size but are not an official number. GitHub licence and last-push dates come from the GitHub REST API.

Statements marked **(analysis)** are my engineering reasoning, not something a source states. Statements marked **(not verified)** are things I could not confirm against a live source and should be treated as leads, not facts.

Verdict vocabulary: **wrap** (depend on it behind our own interface), **write by hand** (the algorithm is small enough that a dependency costs more than it saves), **optional** (lazy-loaded, off by default), **avoid**.

### 0. Executive summary

- The mask stage (threshold, 3x3 morphology, blur, connected components, hole filling, distance transform) should be written by hand on `ImageData` typed arrays. None of the general imaging libraries earns its download for this: OpenCV.js is a 13.3 MB single file (about 3.8 MB gzipped, measured) [22], and the others either lack the needed operations (Photon has thresholding but no morphology or labelling [26]) or need cross-origin isolation headers that a static host may not provide (wasm-vips [25]).
- Default binarisation should be a cascade, not a single algorithm: use the alpha channel when the image has one, otherwise Otsu on blurred luminance with automatic polarity, with manual threshold, colour-distance ("chroma key") and adaptive modes as user-selectable dials.
- Vectorisation should be marching squares on a smoothed scalar field (blurred mask or signed distance field), which gives sub-pixel contours and holes in one pass. `d3-contour` does exactly this in 3.2 kB gzipped under ISC [34].
- Potrace and every faithful port of it is GPL-2.0. `ts-potrace` declares MIT on npm but credits the GPL ports as its basis and its repository URL returns 404, so its licence claim should not be relied on.
- Clipper2 (Boost Software Licence) is the right engine for offsetting and boolean cleanup. If the 3D layer already ships `manifold-3d`, its `CrossSection` class provides the same operations with no extra download [58].
- HEIC needs a decoder everywhere except Safari 17+. All browser decoders are libheif builds and libheif is LGPL; `heic2any` carries an MIT label but has not been published since 2023.
- DXF is a realistic input format; DWG is not, because the only in-browser reader is GPL-3.0 and weighs 9.5 MB of wasm.
- For the drawing canvas, plain pointer events plus `perfect-freehand` (2 kB gzipped, MIT) is sufficient. tldraw's licence forbids production use without a key.

### 1. Thresholding for silhouette extraction

#### 1.1 The algorithms

| Method | What it does | Strength for silhouettes | Weakness for silhouettes |
|---|---|---|---|
| Global fixed threshold | One cut value on luminance | Predictable, instant, the user understands the slider | Needs the user to pick the value |
| Otsu | Picks the global cut automatically from the histogram | No parameter; correct for two-tone inputs | Assumes a bimodal histogram [1][2] |
| Adaptive mean / Gaussian | Per-pixel threshold = local (weighted) mean minus constant C over a blockSize window [1] | Copes with uneven lighting [1] | Hollows out large uniform regions **(analysis)** |
| Niblack / Sauvola | Per-pixel threshold from local mean and standard deviation [3] | Designed for text on non-uniform backgrounds [3] | Same hollowing problem; tuned for thin strokes **(analysis)** |
| Alpha channel | Threshold the alpha value | Exact when the source already has transparency | Only applies to images that have meaningful alpha |
| Colour distance / chroma key | Foreground = pixels further than a tolerance from a reference background colour [4][5] | Works on coloured subjects on a plain background where luminance fails | Needs a reference colour and a tolerance |
| k-means | Clusters pixel colours into k groups [6] | Splits an image into several colour regions, each of which becomes its own mask | Iterative, non-deterministic without a fixed seed, k must be chosen |

The OpenCV tutorial states the case for each of the first three directly: a global value "might not be good in all cases, e.g. if an image has different lighting conditions in different areas"; adaptive thresholding uses "the mean of the neighbourhood area minus the constant C" or a "gaussian-weighted sum"; and Otsu is introduced for a "bimodal image", with the worked example applying a 5x5 Gaussian blur first because "noise filtering improves the result" [1].

The scikit-image documentation describes Niblack and Sauvola as "local thresholding techniques that are useful for images where the background is not uniform, especially for text recognition" [3]. The exact Sauvola formula was not on the page I fetched, so I am not quoting it here **(not verified)**; take it from the original paper or the scikit-image source when implementing.

#### 1.2 Why adaptive methods should not be the default (analysis)

This is reasoning rather than a cited fact. A silhouette for extrusion is normally a large solid region. Inside a uniform region that is bigger than the adaptive window, every pixel equals its local mean, so the classification is decided entirely by the sign of the constant C rather than by the image. The result is an outline with a hollow interior, which then needs hole filling to repair. Adaptive and Sauvola methods are therefore the right tool for line art, pencil sketches and photographed paper, and the wrong default for filled shapes.

#### 1.3 Recommended default dials

A cascade, evaluated in order, with every step overridable:

1. **Alpha present?** If a meaningful share of pixels has alpha below 255, threshold alpha at 50 percent and ignore colour. This covers PNG cut-outs and the output of any background-removal step.
2. **Otherwise Otsu on luminance**, after a small Gaussian blur (the OpenCV example uses 5x5 [1]).
3. **Automatic polarity.** Decide which class is background by sampling the image border: the class that dominates the border is background. Expose an "invert" toggle. **(analysis)**
4. **Exposed dials:** manual threshold slider (initialised to the Otsu value), invert, mode selector (auto / alpha / luminance / colour-distance / adaptive / Sauvola), tolerance for colour-distance, window size and C for adaptive.
5. **Colour-distance mode** takes its reference colour from the border pixels by default and from a click (eyedropper) on request. Plain Euclidean distance in RGB is the cheapest option; a perceptual space is more uniform [5]. Start with RGB and measure before adding a colour-space conversion. **(analysis)**
6. **k-means** is not a binarisation default. It belongs to the "split into individually colourable components" feature: cluster into k colours, then each cluster is a mask that goes through the same pipeline.

All of these are a few dozen lines each over a `Uint8ClampedArray`. Verdict: **write by hand**.

#### 1.4 ML background removal in the browser

| Option | npm package / model | Version, published | Licence | Download cost | Verdict |
|---|---|---|---|---|---|
| IMG.LY background removal | `@imgly/background-removal` | 1.7.0, 2025-07-18 [84] | **AGPL-3.0** [7] | JS about 171 kB; models "small (~40 MB)" and "medium (~80MB)", default `isnet_fp16` [7] | **avoid** unless the app is itself AGPL or a commercial licence is bought |
| transformers.js runtime | `@huggingface/transformers` | 4.3.0, 2026-09-16 [84] | Apache-2.0 | `transformers.web.min.js` 450 kB unminified-gzip not measured [86]; plus ONNX Runtime wasm, 14 to 28 MB per variant uncompressed [19] | **optional**, lazy-loaded |
| — model: MODNet | `Xenova/modnet` [14] | — | Apache-2.0 | 6.6 MB quantised, 13 MB fp16, 25.9 MB fp32 [14] | best size/licence fit, but trained for portraits |
| — model: BiRefNet lite | `onnx-community/BiRefNet_lite-ONNX` [12] | — | MIT | 114.5 MB fp16, 224 MB fp32 [12] | good general quality, heavy |
| — model: BiRefNet | `onnx-community/BiRefNet-ONNX` [13] | — | MIT | 490 MB fp16, 973 MB fp32 [13] | too large for a browser tool |
| — model: BEN2 | `onnx-community/BEN2-ONNX` [17] | — | MIT | 219 MB fp16 [17] | too large |
| — model: ormbg | `onnx-community/ormbg-ONNX` [16] | — | Apache-2.0 | 44.3 MB quantised, 88 MB fp16 [16] | candidate general-purpose default |
| — model: ISNet | `onnx-community/ISNet-ONNX` [15] | — | **AGPL-3.0** [15] | 44.3 MB quantised [15] | avoid (licence) |
| — model: RMBG-1.4 | `briaai/RMBG-1.4` [10] | — | **Non-commercial**; "Commercial use is subject to a commercial agreement with BRIA" [10] | 44.4 MB quantised, 88 MB fp16, 176 MB fp32 [10] | avoid unless licensed |
| — model: RMBG-2.0 | `briaai/RMBG-2.0` [11] | — | **CC BY-NC 4.0**, gated [11] | 234 MB to 1 GB [11] | avoid |
| MediaPipe Image Segmenter | `@mediapipe/tasks-vision` | 1.0.1, 2026-07-31 [84] | Apache-2.0 | wasm 11.8 MB uncompressed [86]; selfie model 250 kB, DeepLab-v3 2.8 MB, multiclass selfie 16.4 MB (measured via HTTP content-length) | **avoid** for this use: models are person-centric [18] |
| `@mediapipe/selfie_segmentation` | legacy package | last version 2023-02-03 [84] | Apache-2.0 | 12.4 MB unpacked | avoid (superseded) |

Notes on this table. The IMG.LY README states that the model and wasm files "are hosted by IMG.LY by default" on `staticimgly.com` and fetched on first run [7], which matters for a tool that promises to be browser-only: the first use makes a third-party network request unless the assets are self-hosted. The README also shows a `Cross-Origin-Embedder-Policy: require-corp` header in its setup notes [7].

transformers.js lists `background-removal` and `image-segmentation` as supported pipeline tasks, runs on WASM by default with optional `device: 'webgpu'`, and documents dtype options "fp32 (default for WebGPU), fp16, q8 (default for WASM), and q4" [9]. Its own docs warn that "The WebGPU API is still experimental in many browsers" [9].

MediaPipe's segmenter models are selfie, hair, multiclass selfie and DeepLab-v3; only DeepLab-v3 is general purpose and it segments a fixed set of categories [18]. None of them is a salient-object matting model, so none fits "cut any object out of any photo".

**Is ML worth offering?** Yes, but only as an opt-in "Remove background (downloads about N MB)" button that lazy-loads transformers.js and one permissively licensed model, runs in a Web Worker, and hands its alpha matte to step 1 of the cascade. It must not be on the critical path: the smallest credible general model is tens of megabytes, and the classical pipeline handles logos, drawings, scans and product-on-white photos without it. I did not benchmark quality or speed of any model; the choice between MODNet and ormbg needs a hands-on test on representative images **(not verified)**.

### 2. Imaging libraries

| Library | npm package | Version, published | Licence | Size | Maintenance | Verdict |
|---|---|---|---|---|---|---|
| OpenCV.js (community package) | `@techstark/opencv-js` | 5.0.0-release.1, 2026-06-24 [84] | Apache-2.0 | `dist/opencv.js` 13.3 MB [22]; 3.76 MB gzip measured | Active; bundles OpenCV 5.0.0; README warns type declarations "may not be up to date" [20] | **avoid** as a default; acceptable only as an optional lazy chunk |
| OpenCV.js (old) | `opencv.js` | 1.2.1, 2017-11-01 [84] | BSD-3-Clause | — | Dead | avoid |
| OpenCV wasm | `opencv-wasm` | 4.3.0-10, 2021-01-15 [84] | BSD-3-Clause | 17.1 MB unpacked | Stale | avoid |
| Canvas 2D / `ImageData` | built in | — | — | 0 | Platform | **write by hand** on top of it |
| image-js | `image-js` | 1.7.0, 2026-07-08 [84] | MIT | 359 kB min / 111 kB gzip [85] | Active | **avoid** as a dependency; useful as reference code |
| Jimp | `jimp` | 1.6.1, 2026-04-07 [84] | MIT | 3.3 MB unpacked; browser bundle size not verified | Active | avoid |
| wasm-vips | `wasm-vips` | 0.0.18, 2026-06-09 [84] | MIT | `vips.wasm` 5.1 MB, plus 3.5 MB HEIF, 2.2 MB JXL, 1.2 MB resvg modules [86] | Active but "still under early development" [25] | avoid |
| Photon | `@silvia-odwyer/photon` | 0.3.3, 2025-05-10 [84] | Apache-2.0 | wasm 1.88 MB; 670 kB gzip measured | Slow cadence | avoid |
| Magic wand | `magic-wand-tool` | 1.1.7, 2020-10-13 [84] | MIT | 8 kB min / 3 kB gzip [85] | Unpublished since 2020; repo pushed 2024 | **write by hand**, use as reference |

Details behind the verdicts.

**OpenCV.js.** The official build script "builds WebAssembly version by default", and by default embeds the wasm in the single JS file; `--disable_single_file` writes a separate `.wasm` to reduce total size [21]. Threaded and SIMD variants are separate builds selected by a loader [21]. The TechStark package requires webpack fallbacks for `fs`, `path` and `crypto` and initialises asynchronously [20]. It would give us `threshold`, `adaptiveThreshold`, `morphologyEx`, `connectedComponents`, `distanceTransform` and `findContours` in one dependency, but at roughly a thousand times the size of hand-written equivalents. A custom reduced build is possible in principle but means owning an Emscripten toolchain; I did not measure how small such a build gets **(not verified)**.

**image-js.** The published package contains the operations we need: `threshold` with Otsu, triangle, Li, Yen and a dozen other automatic methods, plus `erode`, `dilate`, `open`, `close`, `floodFill`, `solidFill`, `clearBorder` and ROI extraction from a mask (file listing, [86]). It is the closest thing to a fit, and its MIT source is a good reference when writing our own. At 111 kB gzipped it is still larger than the whole hand-written mask stage should be.

**Jimp.** Bundlephobia returned a meaningless 164 bytes for the v1 package because the entry point re-exports sub-packages, so I have no trustworthy browser bundle size **(not verified)**. It is an image codec and filter library with no labelling or contour tracing, so it does not solve our problem regardless.

**wasm-vips.** Requires `SharedArrayBuffer`, and therefore the `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin` response headers [25]. Many static hosts cannot set those, which is disqualifying for a no-backend tool.

**Photon.** Lists thresholding among its 96 functions but not morphology, connected components or contour tracing [26].

**Magic wand.** The repository describes itself as creating a "binary mask and contours (vector data) from raster image data by color differences" [27]. That is precisely the click-to-select interaction worth offering, but it is a flood fill with tolerance, which is short enough to own. I could not confirm the exported function names from the README **(not verified)**.

**Conclusion for section 2:** decode with the platform (`createImageBitmap` [66], then draw to a canvas and read `ImageData`), and write the mask operations by hand in a Web Worker.

### 3. Morphology and mask clean-up

All of the following operate on a one-byte-per-pixel mask and are **write by hand**.

| Operation | Purpose in this pipeline | Implementation note |
|---|---|---|
| Erode / dilate (3x3, repeated) | Primitive for everything below [28] | Separable for square structuring elements **(analysis)** |
| Open (erode then dilate) | Removes specks and thin bridges | — |
| Close (dilate then erode) | Fills pinholes and small gaps | — |
| Gaussian blur then re-threshold | Rounds staircase edges and small bumps | Three box-blur passes approximate a Gaussian **(analysis)** |
| Connected-component labelling | Splits the mask into separate parts; drives despeckle and per-component colouring [32] | Two-pass with union-find, or scanline flood fill |
| Despeckle | Drop components below an area threshold | Falls out of labelling |
| Fill holes | Flood-fill background from the image border; anything not reached is a hole | Make it a toggle: holes are often intended (a washer, the letter O) |
| Distance transform / signed distance field | Offset and smoothing in one representation [29][31] | Felzenszwalb and Huttenlocher's algorithm is linear time [30] |

**Why the signed distance field is worth building (analysis).** Computing the distance transform of the mask and of its inverse and subtracting gives a signed distance field. Three user-facing features then become a single contour extraction at a different level: the outline itself is the zero level, "grow by d pixels" is the level at distance d, and "shrink" is the negative level. Blurring the field before extracting the contour smooths the outline without the volume loss that repeated open/close causes. Because the field is continuous, marching squares on it interpolates contour positions between pixel centres, which removes the pixel staircase that tracing a binary mask produces. The cost is two passes of a linear-time algorithm over the image [30].

The two approaches to offsetting are complementary rather than competing **(analysis)**: raster offsets via the distance field are robust and naturally merge or split regions, while vector offsets via Clipper2 (section 4.4) are resolution independent and give control over join style. Use the raster route for clean-up before vectorisation and the vector route for precise, user-specified dimensions afterwards.

**Suggested order (analysis):** threshold, despeckle by component area, optional fill holes, optional open/close, distance field, optional blur, contour.

### 4. Raster to vector

#### 4.1 Tracers

| Library | npm package | Version, published | Licence | Size | Maintenance | Verdict |
|---|---|---|---|---|---|---|
| d3-contour | `d3-contour` | 4.0.2, 2023-01-11 [84] | ISC | 8.2 kB min / 3.2 kB gzip [85] | Stable, low churn | **wrap** (or port the roughly 200 lines) |
| Hand-written marching squares | — | — | — | — | — | **write by hand** is equally reasonable |
| MarchingSquares.js | `marchingsquares` | 1.3.3, 2019-04-28 [84] | **AGPL-3.0** [43] | 1.8 MB unpacked | Stale | **avoid** |
| Potrace (Node port) | `potrace` | 2.1.8, 2020-07-29 [84] | **GPL-2.0** [37] | 569 kB min / 171 kB gzip [85] (pulls in Jimp [37]) | Stale | **avoid** |
| Potrace (wasm, ESM) | `esm-potrace-wasm` | 0.5.1, 2026-08-14 [84] | **GPL-2.0** [36] | 76 kB file; 30 kB gzip measured | Active | **avoid** unless the app is GPL |
| Potrace (wasm, older) | `potrace-wasm` | 1.0.4, 2019-12-12 [84] | **GPL-2.0** | 300 kB unpacked | Dead | avoid |
| Potrace (JS, older) | `potrace-js` | 0.0.6, 2017-03-17 [84] | ISC declared | — | Dead | avoid; licence claim is doubtful for the same reason as ts-potrace |
| ts-potrace | `ts-potrace` | 0.1.0, 2025-05-09 [84] | MIT declared; **provenance doubtful** | 1.08 MB single file [86] | Single release; repository URL returns 404 | **avoid** |
| imagetracerjs | `imagetracerjs` | 1.2.6, 2020-05-18 [84] | Unlicense (public domain) [39] | 19.7 kB min / 5.5 kB gzip [85] | Unpublished since 2020; repo pushed 2023 | optional fallback; usable |
| VTracer (upstream) | Rust crate, MIT [40] | repo pushed 2026-09-26 | MIT | — | Active | — |
| VTracer wasm binding | `vectortracer` | 0.1.2, 2023-08-17 [84] | MIT | wasm 126 kB [86] | Stale; colour converter not implemented [41] | optional |
| VTracer wasm binding | `vtracer-wasm` | 0.1.0, 2025-07-25 [84] | MIT (repo); npm licence field empty | wasm 137 kB; 59 kB gzip measured | Single release, 1 star | optional, low confidence |
| `vtracer` on npm | `vtracer` | 1.0.8, 2017-07-19 [84] | ISC | — | **Unrelated project** (different repository, predates VTracer) | avoid |

**Potrace licensing.** Potrace is distributed under the GNU GPL version 2 or later, and the author sells "a non-GPL version of Potrace, called Potrace Professional" for proprietary integration [35]. `esm-potrace-wasm` states plainly "GPL-v2.0, due to the original Potrace license" [36], and `node-potrace` is GPLv2 and describes itself as a fork of kilobtye's JavaScript port, "which is in turn a port of the original Potrace" [37].

**ts-potrace.** Its npm metadata and bundled LICENSE say MIT, but its README credits `node-potrace` "for the inspiration of this project" and kilobtye's GPL JavaScript port [38]. I inspected the published tarball directly. The repository it points to (`stacksjs/ts-potrace`) returned "Not Found" from the GitHub API on the research date. Whether the code is an independent reimplementation or a derivative of GPL code is something I could not determine **(not verified)**; given the credits, treat it as GPL-encumbered until proven otherwise.

**d3-contour.** Applies marching squares to a rectangular array of numeric values [34]. Output is an array of GeoJSON `MultiPolygon` geometries, each representing "the area where the input values are greater than or equal to the corresponding threshold value" [34]. Smoothing by linear interpolation is on by default [34]. The source assigns holes to their enclosing exterior ring ("assign holes to exterior rings"), which I confirmed by reading `src/contours.js` rather than from the documentation page. This output shape, polygons with holes already nested, is exactly what extrusion needs.

**imagetracerjs.** Public domain, returns structured trace data as well as SVG strings (`imagedataToTracedata`), and handles holes (the 1.2.6 changelog fixes "hole shape parent search") [39]. It is a colour-quantising tracer, so it overlaps with the k-means component-splitting feature.

**VTracer.** MIT licensed, handles colour input where Potrace does not, and describes its pipeline as "fast, linear" in contrast to Potrace's more expensive polygon search [40]. One design point matters here: VTracer uses "a stacking strategy" and avoids "producing shapes with holes" [40]. That is good for SVG rendering and awkward for extrusion, where explicit holes are wanted, so its output would need a boolean pass to recover them **(analysis)**. There is an official `@visioncortex/vtracer` Node package built as WebAssembly [40]; I did not verify whether it runs in browsers **(not verified)**.

**Recommendation.** Marching squares on the smoothed field from section 3, via `d3-contour` or a hand-written equivalent. Curve fitting in the Potrace style is unnecessary for this product **(analysis)**: the 3D mesher consumes polylines, not Bézier curves, so fitted curves would only be flattened again.

#### 4.2 Polyline simplification

| Library | npm package | Version, published | Licence | Size | Verdict |
|---|---|---|---|---|---|
| simplify-js | `simplify-js` | 1.2.4, 2020-02-03 [84] | BSD-2-Clause | 908 B min / 509 B gzip [85] | **wrap** or copy; finished software |
| simplify-ts | `simplify-ts` | 1.0.2, 2020-02-22 [84] | MIT | 14 kB unpacked | optional alternative |
| @turf/simplify | `@turf/simplify` | 7.4.0, 2026-08-03 [84] | MIT | 47 kB unpacked | avoid (GeoJSON overhead) |
| Visvalingam–Whyatt | — | — | — | — | **write by hand** |

Ramer–Douglas–Peucker removes points by maximum perpendicular distance [45]. Visvalingam–Whyatt ranks each point by the area of the triangle it forms with its neighbours and removes the least important first [46]. The relevant trade-off, from the Visvalingam article: it "will clean up sharp spikes that may be important" and applies uniform simplification so fine detail in mixed curves is eroded [46]. For organic silhouettes that smoothing bias is usually what is wanted; for mechanical shapes with sharp corners, RDP preserves corners better **(analysis)**. Offer tolerance as a dial and default to RDP.

Marching squares emits one vertex per crossed cell edge, so simplification is mandatory, not optional: an 1000-pixel outline otherwise becomes a thousand-sided prism wall **(analysis)**.

#### 4.3 Curve smoothing

Chaikin's corner-cutting algorithm [47] and Catmull–Rom interpolation, preferably the centripetal form, which avoids cusps and self-intersections [48], are each a dozen lines. Verdict: **write by hand**. Chaikin shrinks the shape slightly and never overshoots; Catmull–Rom passes through the original points and can overshoot **(analysis)**. Because smoothing can introduce self-intersections, run the result through a Clipper2 union before handing it to the 3D layer **(analysis)**.

#### 4.4 Polygon offsetting and 2D booleans

| Library | npm package | Version, published | Licence | Size | Maintenance | Verdict |
|---|---|---|---|---|---|---|
| Manifold CrossSection | `manifold-3d` | 3.5.4, 2026-09-25 [84] | Apache-2.0 | `manifold.wasm` 541 kB; 205 kB gzip measured | Very active | **wrap** if the 3D layer uses Manifold |
| Clipper2 TypeScript port | `clipper2-ts` | 2.0.1-18, 2026-07-04 [84] | BSL-1.0 | 125 kB min / 34 kB gzip [85] | Active | **wrap** otherwise |
| Clipper2 wasm | `clipper2-wasm` | 0.4.0, 2026-05-18 [84] | BSL-1.0 | `clipper2z.wasm` 214 kB; 82 kB gzip measured, plus 54 kB JS | Active | wrap if speed matters |
| Clipper2 TypeScript port (older) | `clipper2-js` | 1.2.4, 2024-01-01 [84] | BSL-1.0 | 69 kB min / 19 kB gzip [85] | Repo last pushed 2024-01-01 | avoid (superseded) |
| Clipper1 wasm | `js-angusj-clipper` | 1.3.1, 2023-02-04 [84] | MIT | about 353 kB JS with embedded wasm [86] | Stale | avoid |
| Clipper1 JS | `clipper-lib` | 6.4.2, 2019-11-08 [84] | BSL | 98 kB min / 25 kB gzip [85] | Dead | avoid |
| polygon-clipping | `polygon-clipping` | 0.15.7, 2023-12-18 [84] | MIT | 28 kB min / 8.7 kB gzip [85] | No release since 2023 | avoid as primary |
| polyclip-ts | `polyclip-ts` | 0.16.8, 2024-12-17 [84] | MIT | 42 kB min / 15 kB gzip [85] | Low cadence | avoid as primary |
| martinez | `martinez-polygon-clipping` | 0.8.1, 2025-12-07 [84] | MIT | 17 kB min / 5.6 kB gzip [85] | Maintained | avoid as primary |
| Paper.js | `paper` | 0.12.18, 2024-07-17 [84] | MIT | 238 kB min / 84 kB gzip [85] | Slow | avoid for this layer |
| polybooljs | `polybooljs` | 1.2.2, 2024-03-18 [84] | MIT | 13 kB min / 4.4 kB gzip [85] | Low cadence | avoid |
| flatten-js | `@flatten-js/core` | 1.6.14, 2026-08-18 [84] | MIT | 88 kB min / 22 kB gzip [85] | Active | not evaluated in depth |

The deciding requirement is **offsetting**. Clipper2 performs boolean operations "on both simple and complex polygons" including self-intersecting ones, offsetting with configurable join and end types, and triangulation, with EvenOdd, NonZero, Positive and Negative fill rules, using integer arithmetic internally for robustness, and is free for commercial use [49]. `polygon-clipping` implements Martinez–Rueda–Feito booleans only, takes GeoJSON-shaped input with holes, and its README documents environment variables that cap queue size to stop infinite loops caused by floating-point error [54]. Paper.js has `unite`, `intersect`, `subtract`, `exclude`, `divide`, `flatten`, `simplify` and `smooth`, but no offset method in its `PathItem` reference [57]. So the Martinez family and Paper.js each cover half of what is needed, and Clipper2 covers all of it.

`clipper2-ts` describes itself as "Faster than JavaScript-based Clipper (Clipper1) ports, slower than Clipper2-WASM" [50]. For silhouettes of a few thousand vertices a pure-TypeScript port avoids async wasm initialisation and is simpler to bundle **(analysis)**. I did not confirm which upstream Clipper2 release either port tracks, and I could not confirm from the overview page that Clipper2's path simplification helpers are exposed by the ports **(not verified)**.

**Manifold's CrossSection.** It represents 2D cross-sections "guaranteed to be without self-intersections, or overlaps between polygons", and offers union, difference, intersection, `Offset` with a `JoinType`, `Simplify`, and `Decompose` into topologically disconnected pieces [58]. Its `Offset` documentation refers to the Clipper2 MiterLimit page [58], consistent with it being built on Clipper2. `Decompose` is directly useful for the "individually colourable components" requirement. If the extrusion and revolution layer uses Manifold, the 2D engine arrives with it at no additional download, and the 2D and 3D layers share one robustness model **(analysis)**. One thing to check in the Manifold research track: whether the JavaScript bindings expose every `CrossSection` method listed in the C++ reference **(not verified)**.

Note that Bundlephobia reported a gzip size larger than the minified size for `js-angusj-clipper`, which is impossible for the same artefact; I have used the jsDelivr file size instead.

### 5. Input decoding

#### 5.1 PNG and JPEG

Use the platform: `createImageBitmap` [66], draw onto a canvas (an `OffscreenCanvas` inside a worker), read `ImageData`. No library. Downscale very large photos to a working resolution before thresholding; the right cap needs measuring **(analysis)**.

#### 5.2 HEIC

Native support exists only in Safari: caniuse lists Safari 17.0 and iOS Safari 17.0 onwards as supported, with Chrome, Firefox and Edge unsupported in every listed version [60]. WebKit's release notes confirm "Safari 17.0 also adds support for HEIC images" [61].

| Library | npm package | Version, published | Licence | Size | Maintenance | Verdict |
|---|---|---|---|---|---|---|
| heic-to | `heic-to` | 1.5.2, 2026-05-26 [84] | **LGPL-3.0** [63] | 3.0 MB min / 735 kB gzip [85] | Active; tracks libheif releases (1.5.2 uses libheif 1.22.2) [63] | **optional**, lazy-loaded |
| libheif-js | `libheif-js` | 1.23.2, 2026-09-05 [84] | **LGPL-3.0** | wasm bundle 1.99 MB; 698 kB gzip measured | Active | optional alternative (lower level) |
| heic2any | `heic2any` | 0.0.4, 2023-03-29 [84] | MIT declared | 1.35 MB min / 341 kB gzip [85] | Stale; repo last pushed 2024-04 | avoid |
| heic-decode | `heic-decode` | 2.1.0, 2025-07-04 [84] | ISC (wrapper over libheif-js) | 6.7 kB | Maintained | Node-oriented; not evaluated for browsers |
| heic-convert | `heic-convert` | 2.1.0, 2023-11-30 [84] | ISC (wrapper) | 7.9 kB | Stale | avoid |

**Licensing.** libheif "is distributed under the terms of the GNU Lesser General Public License" [65]. Every decoder above embeds a libheif build. `heic2any` labels itself MIT, which can only describe its own wrapper code; I could not verify which libheif version it embeds or how it reconciles the licences **(not verified)**. Its README still says there are "zero web browsers" supporting HEIC [62], which has been untrue since Safari 17, a fair indicator of its maintenance state.

LGPL is workable for a web app in a way GPL is not, but it carries obligations. The conventional approach is to load the decoder as a separate, unmodified, replaceable file rather than merging it into the application bundle. This is not legal advice and should be confirmed before shipping **(not verified)**.

**Recommended behaviour (analysis).** Sniff the file header for a HEIF brand; try native decoding first via `createImageBitmap`; only if that fails, dynamically import the decoder. Safari users then never download it. It is widely reported that iOS converts HEIC to JPEG automatically when a photo is chosen through a file input, which would make the decoder rarely needed on iPhones, but I did not find a primary source for this **(not verified)**.

#### 5.3 SVG

Two different needs hide under "SVG input".

**Rasterise it** (treat the SVG as a picture): load it into an `Image` and draw it to a canvas at the working resolution, then run the normal mask pipeline. This handles fills, strokes, text, clipping and transforms for free and needs no library. It should be the default **(analysis)**.

**Keep it as geometry** (preserve exact curves): parse paths and flatten to polylines.

| Library | npm package | Version, published | Licence | Size | Verdict |
|---|---|---|---|---|---|
| three.js SVGLoader | `three` (addon `examples/jsm/loaders/SVGLoader.js`) | 0.186.1, 2026-09-24 [84] | MIT | loader source 77 kB unminified [86], plus three core | **wrap** if three.js is already the renderer |
| flatten-svg | `flatten-svg` | 0.3.0, 2021-04-03 [84] | ISC | 15 kB min / 4.7 kB gzip [85] | optional; stale |
| svg-path-properties | `svg-path-properties` | 2.1.0, 2026-08-23 [84] | ISC | 26 kB min / 8.2 kB gzip [85] | optional |
| svgpath | `svgpath` | 2.6.0, 2022-10-28 [84] | MIT | 13 kB min / 4.6 kB gzip [85] | optional |
| svg-pathdata | `svg-pathdata` | 9.0.0, 2026-03-27 [84] | MIT | 20 kB min / 5 kB gzip [85] | optional |
| Paper.js | `paper` | see 4.4 | MIT | 84 kB gzip | avoid for this alone |

`SVGLoader` parses an SVG into paths and `SVGLoader.createShapes(path)` turns each into `Shape` objects ready for `ShapeGeometry`; `pointsToStroke` builds geometry for strokes [67]. Its source reads the `fill-rule` style, which I confirmed in the file, but the documentation page does not describe hole handling explicitly, so test even-odd and nested shapes before relying on it **(not verified)**.

`flatten-svg` reduces all shapes "to line segments, accurate to within a configurable error margin" (`maxError`, default 0.1) and applies transforms, working on live SVG DOM elements [70]. `svg-path-properties` is a "pure Javascript alternative to getPointAtLength(t) and getTotalLength()" with no dependencies [68]. `svgpath` is a "low level toolkit for SVG paths transformations" that applies transforms directly to path data [69].

A browser-only option needing no library at all **(analysis)**: insert the SVG into a hidden DOM node and sample each path with the native `getPointAtLength`, which also covers transforms through `getCTM`.

Whichever vector route is taken, pass the result through a Clipper2 union with the SVG's fill rule so that overlapping subpaths and self-intersections are resolved into clean polygons with holes **(analysis)**.

#### 5.4 DXF and "standard 2D CAD formats"

| Library | npm package | Version, published | Licence | Size | Maintenance | Verdict |
|---|---|---|---|---|---|---|
| dxf | `dxf` | 5.3.1, 2025-09-01 [84] | MIT | 71 kB min / 18 kB gzip [85] | Maintained | **wrap** |
| dxf-parser | `dxf-parser` | 1.1.2, 2021-11-12 [84] | MIT | 25 kB min / 7.2 kB gzip [85] | No release since 2021; repo pushed 2024 | avoid as primary |
| three-dxf | `three-dxf` | 1.3.1, 2021-10-22 [84] | MIT | 388 kB unpacked | Stale | avoid |
| @dxfjs/parser | `@dxfjs/parser` | 0.3.2, 2023-09-29 [84] | MIT | 517 kB unpacked | Stale | avoid |
| dxf-viewer | `dxf-viewer` | 1.0.49, 2026-09-20 [84] | **MPL-2.0** | 884 kB unpacked | Active | avoid (a viewer, not a geometry extractor) |
| libdxfrw wasm | `@mlightcad/libdxfrw-web` | 0.1.0, 2025-03-10 [84] | **GPL-2.0-only** | 1.6 MB unpacked | Single release | avoid |
| LibreDWG wasm | `@mlightcad/libredwg-web` | 0.7.14, 2026-09-19 [84] | **GPL-3.0** [75] | wasm 9.5 MB; 2.19 MB gzip measured | Active | **avoid** |

The `dxf` package is the better fit because it does the geometry work, not just the parsing: it offers `toPolylines()` and `toSVG()`, interpolates `SPLINE` entities, and resolves block `INSERT`s with transforms applied [71]. It parses but does not render MTEXT, DIMENSION, STYLE and HATCH [71], none of which matters for a silhouette. `dxf-parser` converts a DXF "into one large javascript object", supporting most 2D entities but leaving curve flattening and block resolution to the caller [72]. `three-dxf` is a viewer built on it [73].

**DWG.** LibreDWG is GPL version 3 or later; its README says the reader "can read all DWG versions, just some very advanced R2010+ objects fail to read and are skipped over" [74]. A WebAssembly build exists as `@mlightcad/libredwg-web`, usable in browsers [75]. So DWG in the browser is technically possible, but the licence is GPL-3.0 and the wasm file is 9.5 MB, which makes it unsuitable for anything but a GPL application. The practical answer is to tell users to export DXF, which every CAD package can do.

**What "standard 2D CAD formats" should mean.** DXF (ASCII) and SVG. DWG is out for the reasons above. Whether to accept binary DXF, and whether the `dxf` package handles it, I did not verify **(not verified)**.

**Pitfalls to design for (analysis).** DXF geometry is frequently a soup of unconnected LINE and ARC segments rather than closed polylines, so the importer needs an endpoint-stitching step with a tolerance before anything can be extruded. DXF carries units in its header and SVG has user units, whereas raster inputs have no physical scale at all; the contour data model should therefore carry a units field from the start. Closed loops from CAD should be classified into outers and holes by nesting depth, which a Clipper2 union with the even-odd rule does directly.

### 6. In-app drawing canvas

| Library | npm package | Version, published | Licence | Size | Maintenance | Verdict |
|---|---|---|---|---|---|---|
| Pointer events on canvas | built in | — | — | 0 | Platform | **write by hand** |
| perfect-freehand | `perfect-freehand` | 1.2.3, 2026-02-01 [84] | MIT | 4.4 kB min / 2.0 kB gzip [85] | Maintained | **wrap** |
| signature_pad | `signature_pad` | 5.1.4, 2026-07-31 [84] | MIT | 16 kB min / 4.6 kB gzip [85] | Active | optional alternative |
| Konva | `konva` | 10.7.0, 2026-09-23 [84] | MIT | 186 kB min / 55 kB gzip [85] | Very active | optional, only if an object editor is wanted |
| Fabric.js | `fabric` | 7.4.0, 2026-05-18 [84] | MIT | 299 kB min / 92 kB gzip [85] | Active | avoid (heavier than Konva for the same job) |
| tldraw | `tldraw` | 5.4.2, 2026-09-10 [84] | **Proprietary; production use needs a licence key** [77] | 14.9 MB unpacked | Very active | **avoid** |
| Excalidraw | `@excalidraw/excalidraw` | 0.18.1, 2026-04-20 [84] | MIT | 46.8 MB unpacked | Active | avoid |
| Rough.js | `roughjs` | 4.6.6, 2023-11-20 [84] | MIT | 170 kB unpacked | Stale | avoid (deliberately sketchy rendering) |

**tldraw** is not open source: its licence lists "Not to use the Software in Production Environments" as a restriction and gates production use behind a licence key [77].

**Excalidraw** is MIT and embeddable as a React component [78], but it is an entire whiteboard application with a hand-drawn aesthetic; its installed size alone rules it out for a pen tool. I did not measure its actual bundled size **(not verified)**.

**perfect-freehand** takes input points with optional pressure and returns the outline polygon of a variable-width stroke; options include `size`, `thinning`, `smoothing`, `streamline` and `simulatePressure` [76]. Its output is already a filled polygon, which is the form the rest of this pipeline works in. The README warns that "the polygon's paths include self-crossings" and recommends a boolean union to remove them [76], which the Clipper2 engine from section 4.4 provides.

**Konva** documents two free-drawing approaches: one `Konva.Line` per stroke, which keeps strokes selectable and movable, or drawing manually to a canvas pixel buffer for performance [79]. It is the right choice only if the product wants a real object editor with selection handles and transforms.

#### Recommendation for a simple black/white pen with variable width and shape primitives

**The drawing should be a vector document, rasterised only for display (analysis).** Store strokes and shapes as a list of objects. Each becomes a polygon: a freehand stroke via `perfect-freehand`, a rectangle or ellipse or regular polygon by direct construction, a straight line by offsetting its centreline. "Black" objects are unioned and "white" (eraser) objects are subtracted, in drawing order, using the 2D boolean engine. The result goes straight to extrusion with no thresholding or tracing, so drawn shapes keep exact edges and sharp corners.

Input handling is plain pointer events: `setPointerCapture` on pointer down, `getCoalescedEvents()` to recover the high-frequency samples the browser batches between frames [82], and `PointerEvent.pressure` for stylus width [83], with `simulatePressure` for mouse and touch. Set `touch-action: none` on the canvas so the browser does not scroll instead of drawing. Undo and redo fall out of the object list.

A raster fallback (paint to a canvas, then run the image pipeline) is simpler to build and gives a bucket-fill tool for free, but it reintroduces staircase edges and resolution dependence, so treat it as the fallback rather than the design **(analysis)**.

### 7. Architecture note: seams for this layer (analysis)

The stages are separable and each has an obvious replacement that already exists, so each is worth one keyword argument with a working default: `decode` (platform, else HEIC decoder), `segment` (the threshold cascade, else an ML matte), `trace` (marching squares, else another tracer), `simplify` (RDP, else Visvalingam), and `clip` (Clipper2 or Manifold CrossSection). The stable interchange types are a single-channel mask (`width`, `height`, `Uint8Array`) and a contour set (an array of polygons, each an outer ring plus hole rings, with a units field). Vector inputs (SVG, DXF, drawing) enter at the contour-set type and skip the raster stages entirely. Everything raster should run in a Web Worker.

### 8. Things I could not verify

- The exact Sauvola threshold formula (the scikit-image page fetched did not show it).
- Whether `ts-potrace` is an independent implementation or derived from GPL code; its repository is unreachable.
- Browser bundle size of `jimp` v1 (Bundlephobia result was meaningless).
- Exported function names of `magic-wand-tool`.
- Quality, speed and memory use of any ML background-removal model; no model was run.
- How small a custom reduced OpenCV.js build can be made.
- Which upstream Clipper2 version `clipper2-ts` and `clipper2-wasm` track, and whether they expose Clipper2's path simplification helpers.
- Whether Manifold's JavaScript bindings expose every `CrossSection` method in the C++ reference.
- Whether the official `@visioncortex/vtracer` package runs in browsers.
- Which libheif version `heic2any` embeds and how its MIT label relates to libheif's LGPL.
- The claim that iOS converts HEIC to JPEG on upload through a file input.
- Hole and even-odd handling in three.js `SVGLoader` beyond the presence of `fill-rule` parsing in source.
- Binary DXF support in the `dxf` package.
- Actual bundled size of Excalidraw.
- The OpenCV documentation site returned HTTP 403 to automated fetches, so OpenCV facts are cited from the same documents' Markdown sources in the OpenCV GitHub repository.
- The Potrace algorithm paper (PDF) returned HTTP 403 and was not read.

### 9. Recommended stack for this layer

| Stage | Choice | Package | Licence | Approx. cost | Loaded |
|---|---|---|---|---|---|
| Decode PNG/JPG | `createImageBitmap` + canvas | platform | — | 0 | always |
| Decode HEIC | native first, then decoder | `heic-to` | LGPL-3.0 (flagged) | about 735 kB gzip | lazy, on demand |
| Threshold | alpha, else Otsu on blurred luminance, auto polarity; manual, colour-distance, adaptive as dials | hand-written | — | under 5 kB | always |
| Click-to-select | flood fill with tolerance | hand-written | — | under 2 kB | always |
| Colour splitting | k-means, then per-cluster masks | hand-written | — | under 3 kB | always |
| Morphology, despeckle, fill holes, labelling | 3x3 operators, union-find labelling | hand-written | — | under 5 kB | always |
| Smoothing and raster offset | signed distance field (Felzenszwalb) plus blur | hand-written | — | under 3 kB | always |
| ML background removal | transformers.js with a permissive model (MODNet or ormbg, to be tested) | `@huggingface/transformers` | Apache-2.0 | runtime plus 7 to 45 MB model | lazy, opt-in |
| Trace | marching squares on the smoothed field | `d3-contour` or hand-written | ISC | 3.2 kB gzip | always |
| Simplify | Ramer–Douglas–Peucker default, Visvalingam option | `simplify-js` or hand-written | BSD-2-Clause | 0.5 kB gzip | always |
| Curve smoothing | Chaikin, centripetal Catmull–Rom | hand-written | — | under 1 kB | always |
| Offset and booleans | Manifold `CrossSection` if Manifold is the 3D kernel, else Clipper2 port | `manifold-3d` or `clipper2-ts` | Apache-2.0 / BSL-1.0 | 0 extra, or 34 kB gzip | always |
| SVG input | rasterise by default; vector path via SVGLoader or native `getPointAtLength` | `three` addon or platform | MIT | 0 extra if three.js is present | always |
| DXF input | parse and flatten to polylines, then stitch | `dxf` | MIT | 18 kB gzip | lazy |
| DWG input | not supported; ask for DXF | — | — | — | — |
| Drawing | pointer events, vector object list, stroke outlines | `perfect-freehand` | MIT | 2 kB gzip | always |

Licences to keep out of the default bundle: GPL (Potrace and all faithful ports, `@mlightcad/libredwg-web`, `@mlightcad/libdxfrw-web`), AGPL (`@imgly/background-removal`, `marchingsquares`, the ISNet model), non-commercial (RMBG-1.4, RMBG-2.0), and proprietary (tldraw). LGPL (`heic-to`, `libheif-js`) is acceptable only as a separately loaded, replaceable module, subject to legal confirmation.

---

## Part B — Geometry, shadow blocks, kernels and the viewer

Date of research: 2026-09-28. All package versions, dates, licences and sizes below were read from the npm registry and the jsDelivr file index on that day.

### 0. How to read this report

**Verification levels.** Every claim carries a reference. Three levels of evidence are used and marked where it matters: (a) *read directly* — I fetched the page or file and read the text myself; (b) *search excerpt only* — the page is rendered by JavaScript or blocked, so only the search engine's excerpt was seen; (c) *measured here* — I ran it locally. Anything I could not verify is listed in section 6 rather than guessed.

**A warning about one of my own tools.** The page-summarising fetcher invented facts about the Shadow Art paper (a "256³ grid", "30–90 seconds", "up to 8 shadows", "the hull must be simply connected"). None of those is in the paper. I discarded that summary and read the PDF page by page; section 2 reflects the PDF only. Treat any secondary summary of that paper with the same suspicion.

**Local measurements.** Run in Node v23.11.0 on an Apple M1 Max, not in a browser, single run each, with `manifold-3d@3.5.4`, `three-bvh-csg@0.0.18`, `@jscad/modeling@2.13.0`, `three@0.186.1`. They show order of magnitude, not a benchmark. The scripts are in the scratchpad folder `bench/` (`bench.mjs`, `bench2.mjs`, `dbg2.mjs`).

**Derivations.** Statements marked *(derivation)* are my own reasoning from the definitions, not a quotation. They are simple enough to check by hand and should be covered by a unit test in the tool.

---

### PART 1 — Taxonomy: ways to turn a 2D figure into a 3D solid

Notation: the figure is a region F in the plane with coordinates (u, v), possibly with holes. "Exact slice" asks: is there a plane whose cut through the solid reproduces F exactly (up to tessellation)? This matters because the viewer should offer a section plane that shows the original image.

#### 1.0 Summary table

| # | Method | Core dials | Exact slice of F? | Main pitfalls |
|---|---|---|---|---|
| 1 | Linear extrude (+ twist, scale, taper) | height, twist, scale, slices, centre | Yes, the base slice; every slice if no twist/scale | Faceting under twist; scale 0 gives an apex; draft can collapse thin parts |
| 2 | Revolve / lathe | angle, axis, axis offset, segments | Yes, every half-plane through the axis | Profile crossing the axis; points on the axis |
| 3 | Sweep along a path | path, frame rule, twist, scale | Yes at the path start, in the normal plane | Frenet flips; self-intersection where curvature radius is smaller than the profile |
| 4 | Helical sweep / screw | pitch, turns, radius, angle, handedness | Yes, every half-plane through the axis shows F (shifted) | Overlap when pitch is smaller than profile height |
| 5 | Loft | profiles, ruled/smooth, correspondence | Yes at each profile station | Vertex correspondence, twisting, topology change between profiles |
| 6 | Rotational array of slabs ("star") | n, thickness, angle span, axis offset | Yes, mid-plane of each slab | Must be unioned; overlap near the axis; thin slivers |
| 7 | Heightmap / relief / lithophane | height scale, base thickness, invert, smoothing | No (F is the top view, not a cut), except threshold slices | Vertical walls, steep triangles, resolution |
| 8 | Inflation / puffing | max height, profile curve, symmetric or one-sided | Yes, the mid-plane (z = 0) | Sharp silhouette edge has zero thickness; ridge artefacts |
| 9 | Bevel / chamfer / round of an extrusion | bevel width, depth, segments, profile | Yes, any slice in the unbevelled zone | Bevel wider than half the local width |
| 10 | Offset shell / hollowing | wall thickness, open faces, drain holes | Yes for the outer boundary | Thin features vanish, inner surface self-intersects |
| 11 | Medial-axis / skeleton solids | radius scale, roof angle, tube radius | Roof: base slice only. Tubes: no | Skeleton is unstable under boundary noise |
| 12 | Wrap on cylinder / sphere | radius, arc span, depth, orientation | No planar slice; the unrolled surface shows F | Distortion on a sphere, seam overlap, inner compression |
| 13 | Signed-distance-field modelling + meshing | any of the above as field operations, blend radius, cell size | Only up to cell size | Meshing loses sharp edges; deformations break the distance property |
| 14 | Visual hull / space carving | n views, directions, projection type | No; the *projections* match, not the slices | Inconsistent views, disconnected parts |
| 15 | Voxel approaches | grid size N, smoothing | Only up to voxel size | Memory N³, staircase surfaces |

#### 1.1 Linear extrude, with twist, scale and taper (draft)

**Maths.** Solid = { (s(t)·R(θ(t))·p, t·h) : p ∈ F, t ∈ [0,1] } where R is a rotation by θ(t) = t·twist and s(t) interpolates from 1 to the top scale. Draft (taper by angle α) is different from scale: it offsets the outline inward by t·h·tan α, so every wall leans by the same angle, while scale shrinks toward a centre and walls lean by different amounts.

**Dials.** Height, centre on/off, twist in degrees, number of slices, top scale (one number or separate X and Y), and draft angle where the kernel has it.

**Names.** OpenSCAD `linear_extrude(height, v, center, convexity, twist, slices, scale, segments)` [87]. Manifold `CrossSection.extrude(height, nDivisions, twistDegrees, scaleTop, center)` [90]. CadQuery `extrude(distance, taper)` and `twistExtrude(distance, angleDegrees)` [98]. Fusion: Extrude with a Taper Angle [99] *(search excerpt only)*. JSCAD `extrudeLinear({height, twistAngle, twistSteps})` [104] *(search excerpt only)*.

**Exact slice.** Yes. With no twist or scale every horizontal slice is F. With twist or scale only the base slice is F; the others are rotated or scaled copies.

**Pitfalls.** Twist with too few slices gives visibly folded quads. Manifold's doc says of `nDivisions`: "especially useful in combination with twistDegrees to avoid interpolation artifacts" [90]. Scale 0 makes a cone: "If the scale is {0, 0}, a pure cone is formed with only a single vertex at the top" [90]. A draft large enough to close a thin part changes the outline's topology partway up; an offset-based draft needs a 2D offset at each level.

**Gotcha measured here.** In `manifold-3d@3.5.4`, passing the top scale as a plain number gives the wrong solid even though the type declaration allows `Vec2|number` [90]. A 1×2 rectangle extruded by 3 has volume 6; `extrude(3, 0, 0, 1, true)` returned 3 (a wedge), `extrude(3, 0, 0, [1,1], true)` returned 6, and omitting the argument returned 6. Always pass a two-element array. The wrapper should hide this.

#### 1.2 Revolve / lathe

**Maths.** With the axis as the v-axis and u ≥ 0 the distance from it: (u, v, φ) → (u cos φ, u sin φ, v) for φ ∈ [0, angle]. By Pappus, volume = angle × (area of F) × (distance of F's centroid from the axis).

**Dials.** Sweep angle (full or partial), which line is the axis (a bounding-box edge, a line through the centroid, a user-drawn line), axis offset (distance between figure and axis; an offset above zero gives a ring with a hole), start angle, number of segments.

**Names.** OpenSCAD `rotate_extrude(angle, start, convexity, $fn)`; the `angle` parameter needs version 2019.05 and `start` needs a development snapshot [87]. Manifold `CrossSection.revolve(circularSegments, revolveDegrees)`, which revolves "around its Y-axis and then setting this as the Z-axis of the resulting manifold" [90]. CadQuery `revolve(angleDegrees, axisStart, axisEnd)` [98]. JSCAD `extrudeRotate({angle, startAngle, segments})` [104] *(search excerpt only)*. Blender: the Spin tool (an edit-mode tool, not a modifier), which "extrudes (or duplicates it if the selection is manifold) the selected elements, rotating around a specific point and axis" and is described as the "lathe" tool [103], and the Screw modifier with screw height 0 [102]. Blender has no modifier called "Spin"; the brief's "Spin modifier" is the Screw modifier.

**Exact slice.** Yes. Every half-plane through the axis, within the swept angle, shows F exactly.

**Profile crossing the axis.** This is the main pitfall. OpenSCAD forbids it: "The 2D shape must lie completely on either the right (recommended) or the left side of the Y-axis. More precisely speaking, every vertex of the shape must have either x >= 0 or x <= 0", and if it does not, a warning is printed and "the rotate_extrude() is ignored" [87]. The tool must therefore decide, per component, what to do when the chosen axis cuts the figure. Three defensible policies: (a) clip the figure to one side of the axis and revolve that half; (b) revolve both halves and union them, which gives the solid swept by the larger of the two at each height; (c) refuse and show the user the cut. Policy (a) keeps the "exact slice" property for the kept half only. Manifold's documentation does not say what it does with a profile that crosses the axis, and I did not test it; see section 6.

**Other pitfalls.** Vertices exactly on the axis produce degenerate (zero-area) triangles unless they are merged; Blender's Screw modifier has an explicit "Merge" option "to close off end points with a triangle fan" [102]. A partial angle needs two flat end caps, which are copies of F.

#### 1.3 Sweep along a path, and the choice of frame

**Maths.** Given a path c(s) and a moving frame (T, N, B) with T the tangent, the solid is { c(s) + u·N(s) + v·B(s) : (u,v) ∈ F }. The whole question is how to choose N and B.

**Frenet frame.** N is the direction of curvature. It is undefined where curvature is zero (straight stretches and inflection points) and can flip by 180° across an inflection, which twists the swept solid abruptly. Bishop introduced an alternative frame in 1975 [105]; a later paper summarises it as a frame that can "analyze a space curve even when the curve has a vanished second derivative" [105] *(search excerpt only; the 1975 article is paywalled)*.

**Rotation-minimising (Bishop, parallel-transport) frame.** N is carried along the curve with no rotation about T. Wang, Jüttler, Zheng and Liu give the standard algorithm, the *double reflection method*: it "uses two reflections to compute each frame from its preceding one" and "has fourth order global approximation error", against second order for the older methods [106] *(abstract, search excerpt)*. It is about twenty lines of code and needs no library.

**Dials.** Path (drawn, or a preset: arc, S-curve, circle), frame rule (Frenet / rotation-minimising / fixed up-vector), extra twist along the path, scale along the path, closed or open path.

**Names.** CadQuery `sweep(path, multisection, makeSolid, isFrenet, transition, normal, auxSpine)` — the `isFrenet` flag is exactly this choice [98]. Fusion: Sweep, with a taper angle [100] *(search excerpt only)*. OpenSCAD has no built-in sweep. Manifold has no sweep constructor in the declaration file I read [90]; a sweep must be built as a mesh and handed to `Manifold.ofMesh`, or built as a union of convex hulls of consecutive sections.

**Exact slice.** Yes, at the start of the path, in the plane perpendicular to the tangent.

**Pitfalls.** Self-intersection wherever the path's radius of curvature is smaller than the profile's extent toward the centre of curvature *(derivation)*. On a closed path a rotation-minimising frame generally does not return to its starting orientation; the leftover angle must be spread along the path as extra twist. A self-intersecting sweep mesh is not a valid solid and `Manifold.ofMesh` may reject it or give a wrong result.

#### 1.4 Helical sweep / screw

**Maths.** (u, v, φ) → (u cos φ, u sin φ, v + pitch·φ/2π) for φ ∈ [0, 2π·turns]. It is a revolve plus a rise proportional to the angle.

**Dials.** Pitch (rise per turn), number of turns, angle, radius (axis offset), handedness, optional end radius for a conical spiral.

**Names.** CadQuery builds the path with `Wire.makeHelix(pitch, height, radius, center, dir, angle, lefthand)`, where a non-default `angle` gives a conical helix [98], and sweeps along it. Blender Screw modifier: Angle ("Degrees for a single helix revolution"), Screw ("The height of one helix iteration"), Iterations ("Number of revolutions"), Axis, Axis Object, Steps [102]. JSCAD `extrudeHelical({angle, pitch, height, segmentsPerRotation})` [104] *(search excerpt only)*. OpenSCAD's `linear_extrude` with twist on an off-centre figure gives "a helical extrusion around the V vector, like a pig's tail" [87], but that keeps the figure horizontal, which is a different solid from a true screw, where the figure stands in a plane through the axis.

**Exact slice.** Yes: a half-plane through the axis shows one copy of F per turn.

**Pitfalls.** If the pitch is smaller than the figure's height along the axis, successive turns overlap and the raw mesh self-intersects. Build each turn (or each segment) as its own solid and union them with the kernel.

#### 1.5 Loft between profiles

**Maths.** A surface interpolating a sequence of profiles F₀, F₁, … placed at stations along an axis. "Ruled" joins corresponding points with straight lines; "smooth" fits a spline through them.

**Dials.** The profiles and their heights, ruled or smooth, the starting point and direction of each outline (this sets the correspondence), optional twist.

**Names.** CadQuery `loft(ruled, combine, clean)` [98]. Fusion: Loft, with optional rails or centreline [99] *(search excerpt only)*. JSCAD `extrudeFromSlices` *(not verified; see section 6)*. Manifold has no loft in the declaration file I read [90].

**Exact slice.** Yes at each station.

**Pitfalls.** Lofting needs a correspondence between outlines. Two outlines with different numbers of vertices, or a different number of holes, have no natural correspondence; a bad one twists or self-intersects. For this tool the natural use is morphing between two *components* of one figure, or between a figure and its simplified or offset version, where correspondence is easy. A robust fallback that needs no correspondence: convert both profiles to 2D distance fields, interpolate the fields along the axis, and mesh (section 1.13).

#### 1.6 Stacked rotated copies / discrete rotational arrays ("star")

**Maths.** Extrude F into a thin slab of thickness t, centred on its own plane, so the slab stands in a plane through the axis. Make n copies rotated by k·(span/n). The solid is the union. With n = 2 this is the classic two crossed cards; large n with t matched to the spacing approaches a revolve.

**Dials.** n, slab thickness, angular span (full turn or a fan), axis offset, whether the figure is mirrored about the axis or stands on one side, optional per-copy colour.

**Names.** OpenSCAD: a `for` loop of `rotate` around `linear_extrude`. Blender: Array modifier with an object offset. No kernel names it as a primitive.

**Exact slice.** Yes: the mid-plane of each slab shows F.

**Pitfalls.** The slabs overlap near the axis, so the raw concatenated mesh is self-intersecting; a real Boolean union is required before export. Where two slabs meet at a small angle the union has thin slivers that print badly. A figure that does not touch the axis gives n disconnected pieces unless a hub is added.

**Related: stacked layers.** A different "stack": n copies of F extruded to thickness h/n, each rotated by a step about the vertical axis. This is a twisted extrusion with deliberate staircase steps, and every layer's slice is F rotated.

#### 1.7 Heightmap / relief / lithophane

**Maths.** z = base + scale·g(I(x, y)) over the image domain, where I is brightness and g a tone curve. The solid is the volume between that surface and a flat back. A lithophane inverts it: dark pixels become thick. Wikipedia describes a lithophane as "a thin plaque of translucent material … moulded to varying thickness, such that when lit from behind the different thicknesses show as different shades" [112].

**Dials.** Maximum relief height, base thickness, invert, tone curve (gamma), blur radius, resolution, and for lithophanes the minimum and maximum thickness to match the material's translucency.

**Names.** OpenSCAD `surface(file)` *(not verified here)*. Manifold: no heightmap constructor seen in [90]; build the grid mesh directly, or use `levelSet`.

**Exact slice.** No. The figure is what you see from above. For a binary figure a horizontal cut between the two levels reproduces F, but with a slope or blur it reproduces a threshold of the blurred image.

**Pitfalls.** A binary mask gives vertical walls with badly shaped long triangles; smooth it or use a distance-based height (section 1.8). A grid of W×H pixels gives about 2·W·H triangles, so a 1000×1000 image is two million triangles. Always add a base and side walls so the result is closed.

#### 1.8 Inflation / puffing

**Maths.** Three families.

- *Distance-based.* Let d(p) be the distance from p to the boundary of F and d_max its largest value. Height z = ± H·f(d/d_max). With f(x) = √(1 − (1 − x)²) the cross-section across a strip is a circular arc, so a stripe becomes a half-cylinder and a disc becomes a half-sphere *(derivation)*. This is the simplest to implement from a binary mask: distance transform, then a height field, mirrored for the back.
- *Skeleton-based (Teddy).* Igarashi, Matsuoka and Tanaka's system "inflates the region surrounded by the silhouette making wide areas fat, and narrow areas thin" [108]. It triangulates the outline, extracts a spine (the chordal axis), lifts the spine in proportion to local width, and wraps a surface around it.
- *Energy-based (Repoussé).* Joshi and Carr's system "creates a 3D shape by inflating the surface that interpolates the input curves", controlled by "the mean curvature stored at boundary vertices", solved as "a single linear system" [109] *(abstract, search excerpt)*. This gives the smoothest pillows and lets the user set per-edge sharpness, at the cost of a sparse linear solve.

**Dials.** Maximum height, profile curve (round, flat-topped, pointed), symmetric or one-sided, edge sharpness, smoothing.

**Exact slice.** Yes: the mid-plane z = 0 of a symmetric inflation is exactly F.

**Pitfalls.** At the silhouette the thickness goes to zero, which is unprintable; add a minimum thickness (a short straight extrusion between the two halves). Distance-based heights have visible creases along the medial axis; blur the height field or use the round profile. Holes in F are handled naturally by the distance transform.

#### 1.9 Bevel, chamfer and rounding of an extrusion

**Maths.** Replace the sharp top and bottom edges by a profile. Equivalent to stacking extrusions of inward offsets of F: at height z near the top, the slice is F offset by −w(z), where w follows a line (chamfer) or a quarter circle (round). Rounding *all* edges, including vertical ones, is the Minkowski sum of a shrunken solid with a sphere.

**Dials.** Bevel width, bevel depth, number of segments, profile shape, top only or both faces.

**Names.** OpenSCAD `offset(r | delta, chamfer)` in 2D and `minkowski()` in 3D [88]. Manifold `CrossSection.offset(delta, joinType, miterLimit, circularSegments)` and `Manifold.minkowskiSum(other)` [90]. CadQuery `fillet(radius)`, `chamfer(length)` [98]. three.js `ExtrudeGeometry` has bevel options but offsets vertices naively *(not verified in documentation; stated from the library's known behaviour, see section 6)*.

**Exact slice.** Yes, any slice in the unbevelled middle zone.

**Pitfalls.** When the bevel width exceeds half the local width of F, the inward offset changes topology (a thin arm disappears, a region splits). A correct implementation uses a real polygon offset at each level (Manifold's `offset` does, through Clipper2 [96]) and stacks the results; it must then join levels whose outlines have different vertex counts, which is a loft problem. The simple robust route: build the bevelled solid as a distance-field (section 1.13), or use the straight-skeleton "roof" as the bevel surface (section 1.11).

#### 1.10 Offset shells and hollowing

**Maths.** Shell = S minus (S offset inward by wall thickness t). In distance-field terms, |d| − t/2 turns a surface into a shell; Quilez calls it "onion": `abs(sdf) - thickness`, used "for carving interiors or giving thickness to primitives, without performing expensive boolean operations" [113].

**Dials.** Wall thickness, which faces are left open, drain holes (needed for resin printing), infill left to the slicer.

**Names.** CadQuery `shell(thickness)` [98]. Manifold: no `shell`; do it as extrude(F) minus extrude(offset(F, −t)) for prismatic solids, or through `levelSet` for general ones [90].

**Exact slice.** The outer outline is F; the slice itself is a ring.

**Pitfalls.** Features thinner than 2t vanish from the inner surface. A naive vertex-normal offset of a mesh self-intersects at concave corners; do not do it that way.

#### 1.11 Medial-axis and skeleton-based solids

**Maths.** The medial axis "is the set of all points having more than one closest point on the object's boundary", introduced by Blum in 1967 [110]. The straight skeleton is a related structure "composed of straight line segments, while the medial axis of a polygon may involve parabolic curves" [111]. Two solids follow:

- *Roof.* Lift each skeleton point to a height equal to its distance from the boundary: a hipped roof with every face at 45°. OpenSCAD has this as `roof()`, with `method = "straight"` or `"voronoi"`; it is experimental [89] *(search excerpt only)*.
- *Tubes and balls.* Sweep a circle of radius r(s) = distance to the boundary along each skeleton branch. The union of those balls is F inflated (section 1.8).

**Dials.** Roof angle or height scale, tube radius multiplier, branch pruning threshold, caps.

**Exact slice.** Roof: the base slice is F, and slices at height z are inward offsets of F. Tubes: no.

**Pitfalls.** The medial axis is unstable: a small bump on the boundary grows a whole new branch. Prune by branch length or by the angle between the two closest boundary points. For npm, I found two CGAL-based WebAssembly packages published in 2026, `@matthewjacobson/str8` (straight skeleton, MIT) and `voron8` (segment Voronoi diagram, MIT); CGAL's algorithm packages are mostly GPL [137], so an MIT label on a CGAL-derived build needs a licence check before use. I did not evaluate either.

#### 1.12 Wrapping a figure on a cylinder or sphere

**Maths.** Cylinder of radius R: (u, v, w) → ((R + w) cos(u/R), (R + w) sin(u/R), v), where w is depth. Lengths along u are kept at the surface w = 0 and stretched by (R + w)/R above it. Sphere: no mapping keeps lengths, so choose a projection (equirectangular, stereographic, or gnomonic per face) and accept distortion.

**Dials.** Radius, arc span (or "fit to full turn"), relief depth, emboss or engrave, which way up.

**Names.** Fusion's Emboss "raises or recesses a sketch profile relative to faces on a solid body" and can "wrap text around a solid body" [101] *(search excerpt only)*. Manifold `warp(warpFunc)` moves "the vertices of this Manifold according to any arbitrary input function without changing topology" [90], which is exactly a wrap if the mesh is refined first with `refine(n)` [90]. Blender: Simple Deform (Bend) *(not verified)*.

**Exact slice.** No planar slice. The unrolled cylindrical surface at w = 0 is F.

**Pitfalls.** The flat mesh must be subdivided along u before warping, or long straight edges stay straight and cut through the cylinder. A figure wider than 2πR overlaps itself. `warp` does not check for self-intersection; the caller is responsible.

#### 1.13 Signed-distance-field modelling, then meshing

**Maths.** Represent the solid as a function d(p) that is negative inside. Start from a 2D distance field of F (computed from the polygon, or from the mask by a distance transform). Quilez gives the two lifting operators [113]:

- Extrusion: `d = primitive(p.xy); w = vec2(d, abs(p.z) - h); return min(max(w.x,w.y),0.0) + length(max(w,0.0));`
- Revolution: `q = vec2(length(p.xz) - o, p.y); return primitive(q)` where `o` is the axis offset.

He states that for both, "if the 2D SDF we start with is an exact SDF, the resulting 3D volume is exact as well" [113]. Other operators: rounding is `d − r` (exact); onion is `abs(d) − t` (exact); smooth union blends two shapes with a radius k; twist and bend are changes of coordinates applied to p before evaluating d [113].

**Which operations keep a true distance.** Extrusion, revolution, rounding and onion do. Smooth union, twist, bend and displacement give only a bound: they "distort the distance field and make it non-Euclidean anymore" [113]. This matters for ray marching and for offsetting, and less for meshing, which only needs the sign and a rough value near the surface.

**Revolution of a profile crossing the axis.** The revolution operator uses `length(p.xz)`, which is never negative, so only the u ≥ 0 half of the 2D field is ever sampled *(derivation)*. A distance-field revolve therefore silently applies policy (a) of section 1.2.

**Meshing.**

- *Marching cubes* (Lorensen and Cline, 1987) [114]. One vertex per grid edge crossed. The original table has ambiguous cases, which caused "discontinuities and topological issues" [114]. The patent expired in 2005 [114].
- *Marching tetrahedra.* No ambiguous cases, so "surfaces produced by marching tetrahedra are always manifold", but the meshes are "about 4x larger" [115]. Manifold's `levelSet` uses "a form of Marching Tetrahedra" [90] and its README says it "improves significantly over Marching Cubes" [59].
- *Surface nets* (Gibson 1999; "naive" variant by Lysenko). One vertex per cell. "Much faster", "easy to implement and produces slightly smaller meshes"; "the only downside is that it can create non-manifold vertices" [115].
- *Dual contouring* (Ju, Losasso, Schaefer, Warren, 2002) [116]. One vertex per cell, placed using surface normals, so it keeps sharp edges. Needs a least-squares solver per cell and, like surface nets, can create non-manifold vertices.

**Dials.** Cell size, blend radius, and every dial of the methods above expressed as a field operation.

**Exact slice.** Only up to cell size. Sharp corners of F are rounded by marching cubes, marching tetrahedra and surface nets.

**Pitfalls.** Cost grows as N³ evaluations. In Manifold the field is a JavaScript callback called from WebAssembly, once per grid point [90]; the call overhead across that boundary will dominate. I did not measure it.

**Verdict for this tool.** Use distance fields as the *second* representation, for the operations where polygons are awkward: inflation, bevels that change topology, smooth blends between components, lofts without correspondence. Keep polygons and mesh Booleans as the first representation, because they keep sharp edges and exact slices.

#### 1.14 Visual hull / shape from silhouette / space carving

**Maths.** Given n silhouettes S_k and projections P_k, each defines a cone (a prism, for parallel projection) C_k = P_k⁻¹(S_k). The hull is the intersection of all C_k. Laurentini introduced the concept in 1994 [117]; it is the largest object that has the given silhouettes, it contains the true object, and it cannot recover concavities [117]. Kutulakos and Seitz generalised from silhouettes to colour consistency and defined the *photo hull*, computed by *space carving* [118].

**Dials.** Number of views, direction of each view (the three axes, a ring of n directions about one axis, or free), parallel or perspective projection, scale and position of each image.

**Exact slice.** No. What matches is the projection, not a cut. And the projection matches only if the silhouettes are consistent; see Part 2.

**n views.** With n parallel views about one axis, the hull is a prism-like solid whose horizontal slices are intersections of n strips, that is, convex polygons per connected slice region *(derivation)*. With n large and all silhouettes equal to F this tends to the revolve of the symmetrised F.

#### 1.15 Voxel approaches

**Maths.** Sample the solid on an N³ grid of occupied / empty cells. Any of the methods above becomes a per-voxel test. Booleans are bitwise AND, OR, AND-NOT.

**Dials.** N, surface smoothing, meshing method.

**Exact slice.** Up to voxel size.

**Pitfalls.** Memory: one byte per voxel is 16.8 MB at 256³ and 134 MB at 512³; one bit per voxel is 2.1 MB and 16.8 MB. Blocky output ("cubified") is always closed and manifold if faces between occupied and empty cells are emitted consistently, except at cells touching only along an edge or a corner, which give non-manifold edges and vertices *(derivation)*. Smoothed output from marching cubes or surface nets inherits the issues in 1.13.

---

### PART 2 — Shadow blocks: literature, prior art, and how to check the shadows

#### 2.1 Hofstadter's trip-let

MathWorld defines it: "A trip-let is a three-dimensional solid that is shaped in such a way that its projections along three mutually perpendicular axes are three different letters of the alphabet" and credits Hofstadter's G, E, B blocks on the cover of *Gödel, Escher, Bach* [120]. Hofstadter's spelling is "trip-let", with a hyphen. The construction is the intersection of three orthogonal extrusions of the three letters. Mitra and Pauly reproduce a photograph of the blocks as their Figure 2(g) [119].

Aliases to search under, as collected by one of the tools below: "trip-lets, visual hulls, shadow hulls, shadow sculptures, 3D ambigrams, dual-letter illusions" and "shape from silhouette" [122].

#### 2.2 Mitra and Pauly, "Shadow Art" (SIGGRAPH Asia 2009)

Read directly from the PDF [119]. Citation: ACM Transactions on Graphics 28(5), Article 156, December 2009, 7 pages.

**Definitions.** Input is a set of shadow sources S_k = (I_k, P_k): a binary image and a projection. "Each shadow source S_k defines a generalized cone C_k ⊂ ℝ³ that marks the maximum region of space compatible with I_k and P_k. Intersecting the shadow cones of the set S yields the 3D shadow hull H(S) = C₁ ∩ · · · ∩ C_n." The hull is "a sculpting block": "Any part of space outside the shadow hull cannot be part of the sculpture, since this would contradict at least one of the desired shadow images" [119].

**Consistency.** "Let I′_k be the actual shadow cast by the shadow hull H under projection P_k. We call a set of shadow sources consistent, if I′_k = I_k for all k." And the central finding: "shadow sources provided by the user need not be consistent. In fact, inconsistency is the rule rather than the exception for more than two shadow sources. Inconsistent shadow sources lead to a shadow hull that casts incomplete shadows, i.e., parts of the input shadow image will be missing" [119]. Note the direction of the error: the actual shadow is always a *subset* of the target. Nothing is ever added; parts go missing.

**Why a pixel goes missing.** "An inconsistent pixel in I′₁ corresponds to a line of empty voxels in the shadow hull. Setting any such voxel to active would fill the pixel in I′₁. However, these voxels project onto lines of pixels in I₂ and I₃ that lie completely outside the desired shadow silhouette in at least one of the images" [119].

**Their remedy.** Deform the input images, as little as possible, until they are consistent. They use as-rigid-as-possible shape manipulation (Igarashi et al. 2005) on a triangle mesh laid over each image. Constraints are derived automatically: for each missing pixel, find the least-cost voxel on its line and pull the boundary of the offending image toward that voxel's projection. They apply "only a small fraction (0.25 in all examples) of the resulting displacements" per iteration and repeat [119]. Stiffness starts high, so the first iterations mostly *reposition* the images relative to each other, and is then relaxed.

**Limits they report.** "Not all combinations of images are suitable for creating shadow art" and "the optimization, being a greedy one, can converge to a local minima when the initialization is poor" (their Figure 11 shows a failure) [119].

**Implementation facts.** They use a voxel grid, not meshes, "since subsequent editing of the shadow hull requires volumetric operations", on a GPU, and note that "disadvantages of this approach are aliasing and grid alignment artifacts". Input image resolution is 250 × 250 for all but one example [119]. The paper gives no timing figures beyond "realtime" and "immediate visual feedback", and gives no voxel grid size.

**An example that needed no deformation.** Their Andy Warhol cube "is the only example in the paper that does not require any image deformations to achieve consistency, since the projections are orthogonal and each image has a complete ring of active pixels at the boundary" [119]. This is a usable design rule; see 2.4.

**Connectivity.** "The optimization does not consider structural aspects such as connectedness of the shadow hull that might be important for a physical realization of the sculpture." And: "If the input images are composed of multiple components, the shadow hull necessarily consists of disconnected pieces. In such cases, the 3D sculpture can be embedded in a transparent medium … Alternatively, transparent threads or other thin supporting elements can be added" [119].

**Minimum material.** The hull is the *largest* solid with those shadows; much of it can be removed. For two orthographic views the smallest voxel set "can be reduced to a bipartite graph matching problem, for which polynomial time algorithms exist". For three, "we conjecture that finding the smallest consistent shadow sculpture in this case is NP-hard" [119]. This is a conjecture in the paper, not a theorem.

**Editing.** Brush, ray and erosion tools remove voxels only where doing so leaves all shadows intact [119].

#### 2.3 Visual hull and space carving

Laurentini, "The visual hull concept for silhouette-based image understanding", IEEE Transactions on Pattern Analysis and Machine Intelligence 16(2), 150–162, February 1994, DOI 10.1109/34.273735 [117]. Kutulakos and Seitz, "A Theory of Shape by Space Carving", International Journal of Computer Vision 38, 199–218, 2000 [118]. (The Shadow Art reference list gives 1999 and different pages for this paper [119]; the publisher's record says 2000, pages 199–218 [118].)

Mitra and Pauly state the key difference between the vision problem and the design problem: in reconstruction, "the silhouettes will always be consistent, since they result from projections of a real physical object. For arbitrary input images, such a 3D shape might not exist" [119]. A design tool must therefore *detect and report* inconsistency; a vision system never has to.

#### 2.4 The consistency condition for orthogonal parallel views *(derivation)*

Take coordinates so that image A is seen along z and lives in (x, y); B is seen along x and lives in (y, z); C is seen along y and lives in (x, z). The hull is H = { (x,y,z) : A(x,y) and B(y,z) and C(x,z) }.

**Two views (A and B).** The shadow of H along z contains the point (x, y) of A exactly when some z has B(y, z), that is, when row y of B is not empty. So A is reproduced exactly if and only if every height y occupied by A is occupied by B, and B is reproduced if and only if the reverse holds. *Two orthogonal silhouettes are consistent exactly when they occupy the same set of positions along their shared axis.* For two letters of equal height with no gaps in the vertical direction this always holds, which is why two-word ambigrams are easy. A letter with a vertical gap, such as "i" with its dot or ":" or "=", has empty rows, and those rows of the other letter are lost.

**Three views.** The point (x, y) of A is reproduced exactly when some z has both B(y, z) and C(x, z): row y of B and row x of C must share at least one z. This is the condition that fails in practice, and it is not a condition on any single image.

**A sufficient rule.** If B and C both contain the full line z = z₀ (for instance a frame, a baseline bar, or a solid border), then every point of A is reproduced, because z₀ serves as the witness for all of them. The same applies to each of the other two images in turn. That is precisely the "complete ring of active pixels at the boundary" of the Warhol example [119]. The tool can offer this as a one-click fix: "add a frame to all three images".

**Measured here.** With three test shapes (a ring, a block letter E, a seven-lobed star with a hole) the polygon route and the voxel route agree on what goes missing. Polygon route: 11.1%, 0.02% and 4.4% of the three target areas missing, and 0 extra area in all three. Voxel route at 256³: 11.3%, 0.00%, 4.45%. The hull was one connected piece of genus 5.

#### 2.5 How to check that each shadow equals its input, and what to tell the user

**Polygon route (exact, recommended).** For each axis, rotate the hull so that the axis becomes z, call `project()`, which "returns a cross section representing the projected outline of this object onto the X-Y plane" [90], and compare with the target `CrossSection`:

- missing = target minus shadow (a `CrossSection`; its `area()` is the number to report, its `toPolygons()` are the regions to draw in red);
- extra = shadow minus target. This must be empty. If it is not, the tool has a bug in its axis or rotation conventions. I hit exactly this during testing, and the non-zero "extra" is what exposed it. Keep it as an assertion.

Cost, measured here: 5 ms for all three checks on a 5 000-triangle hull, 28 ms on a 41 000-triangle hull.

**Raster route.** Project the voxel grid along each axis with a logical OR and compare with the mask pixel by pixel. At 256³ this took 26 ms here. Missing pixels are those set in the mask and clear in the projection.

**What to report.** Per view: percentage of target area missing, and an overlay with the missing region highlighted on the wall. Per solid: the number of disconnected pieces from `decompose()`, which "returns a vector of Manifolds that are topologically disconnected" [90], the genus, the volume, and whether the result is empty. For printing: pieces that do not touch the build plate, and minimum wall thickness.

**Two distinct kinds of "disconnected".** (1) The inputs have several components (the dot of an "i"), so the hull *must* have several pieces [119]. (2) The inputs are connected but the hull is not, because the parts that would join them fall outside one of the other silhouettes. The user needs different advice for each: for (1) add a base or a frame, or embed in a clear block; for (2) move or scale one image, or accept a connector.

**Remedies to offer, in order of effort.** (a) Reposition and rescale the three images relative to each other, since early iterations of the Shadow Art optimisation do little more than that [119]. (b) Try all assignments of images to axes and all mirror flips, and keep the best; one tool does this for letters [122]. (c) Add a frame or base bar (2.4). (d) Thicken strokes (offset the polygons outward). (e) Full image deformation in the manner of Shadow Art, which is a research-grade feature and should be a later plugin.

#### 2.6 3D ambigrams and existing tools

| Tool | What it does | How | Licence | Status |
|---|---|---|---|---|
| Lyl3, "Customizable Triple Letter Blocks Ambigram" [128] | Blocks showing three letters from three orthogonal views | OpenSCAD customizer; needs the Rubik Mono One font | Not checked | Published on Thingiverse (thing 3633456) and Printables *(search excerpt only)* |
| ondras/3 [127] | "Shadow cube (particularly known from GEB) generator" | Web page plus an OpenSCAD file `geb.scad` | None stated | Last push 2023-02 |
| 2CATteam/AmbigramGenerator [125] | Two-word ambigrams in the browser | Series of intersect operations | MIT | Last push 2025-12 |
| Lucandia/dual_letter_illusion ("TextTango") [126] | Two-word letter blocks | Intersection of 3D letters | **GPL-3.0** | Last push 2026-03 |
| ijanos/ambi (ambi3d.com) [123] | Two equal-length words, STL export, warns about floating geometry | three.js for rendering and font outlines; Manifold WebAssembly for solids and Boolean intersection | Apache-2.0 or MIT | Last push 2026-08 |
| printpal Text Flip Generator [124] | Two words, STL | Per character: "two deeply-extruded 2D glyphs rotated at ±45° from center, then computes the CSG intersection using Manifold WASM" | Proprietary site | Live |
| mrienstra/shadow-hull [122] | Three letters or two words; tries letter-to-axis assignments; joins loose pieces; checks wall thickness; reports coverage | Manifold for Booleans, opentype.js for outlines, Vite | MIT | Pushed on the day of this research; 0 stars; very new |
| ambigramgenerator.me [129] | 2D and 3D two-name ambigrams | Not documented | Proprietary site | *(search excerpt only)* |

**What the prior art shows.** Every browser tool I found that names its kernel uses Manifold [122][123][124]. All of them are limited to letters from fonts. None takes an arbitrary image, none offers n views beyond three, and none I could inspect shows the user *where* a shadow is incomplete on the wall. Those three gaps are this project's opening. Do not copy code from the GPL-3.0 project [126] into a permissively licensed tool.

The two-word ambigram is the two-view case with views at ±45° to the reading direction, done per letter pair, which keeps each pair consistent by the two-view rule of 2.4.

---

### PART 3 — Boolean / CSG in the browser

#### 3.1 Comparison

Sizes: "unpacked" is the npm package on disk; "payload" is what a browser would download, measured here with gzip -9 on the files named.

| Library | npm package | Version, published | Licence | Size | Representation | Output guaranteed manifold? | Web Worker | Maintenance | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| Manifold | `manifold-3d` | 3.5.4, 2026-09-25 | Apache-2.0 | unpacked 2.8 MB; payload `manifold.wasm` 541 KB (205 KB gzip) + `manifold.js` 82 KB (19 KB gzip) | Triangle mesh, indexed | **Yes**, by design [59][92] | Yes; the package ships its own `dist/worker.bundled.js` | Very active (repo pushed 2026-09-28) | **Wrap: primary kernel** |
| three-bvh-csg | `three-bvh-csg` | 0.0.18, 2026-02-17 | MIT | unpacked 1.4 MB; module 164 KB (33 KB gzip); needs `three` and `three-mesh-bvh` (291 KB, 62 KB gzip) | three.js geometry | **No**, stated by the author [130] | "Worker Support" is on the roadmap as help wanted [130] | Active (repo pushed 2026-09-27), self-described experimental | Avoid for export; acceptable for live preview only |
| three-csg-ts | `three-csg-ts` | 3.2.0, 2024-05-28 | MIT | unpacked 57 KB | BSP tree | No | Pure JS, no DOM needed | Dormant since 2024-05 | Avoid |
| csg.js (Evan Wallace) | not on npm under that name | repo last pushed 2019-10 | MIT | tiny | BSP tree | No | Pure JS | Unmaintained; historical | Avoid |
| JSCAD | `@jscad/modeling` | 2.13.0, 2026-02-22 | MIT | unpacked 1.6 MB; min bundle 251 KB (59 KB gzip) | Polygon soup, BSP Booleans [133] | No | Pure JS | Active (repo pushed 2026-09-24) | Avoid as kernel; borrow ideas |
| OpenCascade.js | `opencascade.js` | 1.1.1 (latest tag), 2020-09-27; beta tag 2.0.0-beta | **LGPL-2.1-only** | unpacked 67 MB; `opencascade.wasm.wasm` 65.9 MB | B-rep (exact curves and surfaces) | Yes in principle; B-rep validity | Yes | Repo last pushed 2023-08 | Avoid directly |
| replicad | `replicad` + `replicad-opencascadejs` | 1.1.0, 2026-09-04 (both) | replicad MIT; **the WebAssembly kernel it needs is LGPL-2.1-only** | kernel wasm 23.0 MB (single-thread build), 22.5 MB (multi) | B-rep | As above | Yes; its docs recommend a worker [135] | Active | Optional plugin for STEP export only |
| bitbybit OCCT | `@bitbybit-dev/occt` | 1.3.2, 2026-09-20 | MIT label on the package; contains OpenCascade, which is LGPL | unpacked 107 MB | B-rep | As above | Not checked | Active | Not evaluated |
| CGAL in WebAssembly | none found for mesh Booleans | — | CGAL algorithms are mostly **GPL-3.0+**, kernel LGPL [137] | — | Exact arithmetic | Yes | — | `@sfcgal/sfcgal` 0.1.0-beta.0 exists, **GPL-3.0-or-later** | **Avoid (GPL)** |
| "csg2" | no npm package of that name (404) | — | — | — | — | — | — | — | See Babylon CSG2 |
| Babylon CSG2 | part of `@babylonjs/core` | 9.28.0, 2026-09-24 | Apache-2.0 | unpacked 72 MB (tree-shakeable) | Wraps Manifold [138] | Yes, inherited from Manifold | Not checked | Very active | Only if Babylon is the renderer |

**Reading the licences.** LGPL-2.1 allows use from a closed or permissively licensed application provided the user can replace the LGPL part. A separately loaded `.wasm` file arguably satisfies that, but this is a legal judgement, not a technical one, and I am not giving legal advice. GPL-3.0 code linked into the application requires the whole application to be GPL. Flagged packages: `opencascade.js` (LGPL-2.1-only), `replicad-opencascadejs` (LGPL-2.1-only), `occt-import-js` (LGPL-2.1), `@sfcgal/sfcgal` (GPL-3.0-or-later), `potrace` (GPL-2.0), `marchingsquares` (AGPL-3.0), and the repository Lucandia/dual_letter_illusion (GPL-3.0).

#### 3.2 Manifold in detail

**The guarantee.** "Our primary goal is reliability: guaranteed manifold output without caveats or edge cases" [59]. The author calls the Boolean "a guaranteed-manifold mesh Boolean algorithm, which I believe is the first of its kind" [59]. Manifoldness is defined topologically, following the 3MF specification: "Every edge of every triangle must contain the same two vertices (by index) as exactly one other triangle edge, and the start and end vertices must switch places between these two edges" [92]. Because that definition uses indices and not coordinates, "the set of manifold meshes is closed under Boolean operations" [92].

**What is *not* guaranteed.** Geometric validity (no self-overlap) is promised only within a tolerance ε, and the authors say this part "cannot be mathematically proven" [92] *(fetcher summary of the wiki; wording partly paraphrased)*. Input must already be manifold: "you'll get an error status if the imported mesh isn't manifold" [59]. This is why the tool should build every solid through Manifold's own constructors, where the input is a polygon, and not through imported meshes.

**Built-in 2D-to-3D.** `CrossSection` (2D, with fill rules, Boolean, `offset`, `hull`, `simplify`, `area`, `toPolygons`), `extrude`, `revolve`, `levelSet` for distance fields, `warp`, `refine`, `minkowskiSum`, `project`, `slice(height)`, `decompose`, `genus`, `volume`, `status` [90]. `slice` and `project` are the two functions the viewer needs for "show me the cut that matches my image" and "check my shadow". The 2D side currently depends on Clipper2; there is an open proposal for an in-house replacement [96].

**Users.** OpenSCAD, Blender, Godot, Babylon.js, trimesh, bitbybit and about thirty others are listed [59]. OpenSCAD made Manifold its default backend in development builds; reported speed-ups over its CGAL backend range from 5–30× to 100× [150] *(search excerpt only)*, and the Manifold author's first comparison gave "100 - 1,000 times faster" [94].

**Memory management.** "Since Manifold is a WASM module, it does not automatically garbage-collect like regular JavaScript. You must manually delete() each object constructed by your scripts (both Manifold and CrossSection)" [93]. The wrapper must own this; callers of the tool's API should never see `delete()`.

**Content-Security-Policy.** An issue opened on 2026-09-24, "WASM bindings fail under a Content-Security-Policy without 'unsafe-eval' (embind uses new Function)", is marked closed [95]. I did not confirm which release contains the fix. If the tool is deployed under a strict policy, test this first.

**Export.** "Please avoid saving to STL files! They are lossy and inefficient - when saving a manifold mesh to STL there is no guarantee that the re-imported mesh will still be manifold, as the topology is lost" [59]. They recommend 3MF, and glTF with the `EXT_mesh_manifold` extension [59]. Offer 3MF as the default print format and STL as a compatibility option. The npm package lists `@jscadui/3mf-export` and `@gltf-transform/core` among its dependencies [97].

**Threads.** The README speaks of "parallelization, or pipelining when only a single thread is available" [59]. Whether the published WebAssembly build uses threads is not stated in anything I read. Assume single-threaded.

#### 3.3 Measured here: the trip-let with each kernel

Three extrusions and two intersections, same input polygons for all. "Open edges" counts edges used by only one triangle after welding vertices at 10⁻⁵; a closed manifold mesh has none.

| Kernel | Input vertices per curved outline | Time | Output triangles | Open edges | Edges shared by more than 2 triangles |
|---|---|---|---|---|---|
| Manifold | 256 | 9 ms | 5 178 | 0 (status `NoError`, genus 5, 1 piece) | 0 |
| Manifold | 2 048 | 75 ms | 40 666 | 0 | 0 |
| three-bvh-csg | 256 | 477 ms | 21 919 | 23 741 | 1 379 |
| three-bvh-csg | 1 024 | 3 353 ms | 86 194 | 90 855 | 6 601 |
| @jscad/modeling | 256 | 617 ms | 6 856 (from 2 923 polygons) | 3 285 | 7 |
| @jscad/modeling | 1 024 | 15 493 ms | 30 871 | 32 783 | 231 |

**Caveats on this table.** The open-edge counts for the two JavaScript kernels are dominated by T-junctions: a vertex of one triangle lying in the middle of a neighbour's edge. The surface has no visible hole and the volume from JSCAD (1.3656) equals Manifold's (1.3656), but the mesh is not manifold by the index-based definition that 3MF and Manifold use, and slicers must repair it. My three-bvh-csg timing includes building the input geometry and its acceleration structure. The Manifold zero is by construction: `status()` returned `NoError` and the library does not return non-manifold results. One machine, one run, Node not a browser.

**Reading.** On this task Manifold was roughly 50× faster than both alternatives at the small size and 45–200× at the larger one, and it was the only one whose output needs no repair.

#### 3.4 The voxel route

Rasterise the three masks at N × N, then H[x,y,z] = A[x,y] AND B[y,z] AND C[x,z].

**Measured here.** The AND loop: 2.5 ms at 64³, 4.3 ms at 128³, 34 ms at 256³. Checking the three shadows at 256³: 26 ms. Memory at one byte per voxel: 16.8 MB at 256³. (My rasterisation step was a naive point-in-polygon test and took seconds; in the browser, draw the polygon to a canvas and read the pixels back.)

**Properties.** Trivial to write. Cannot fail. Works directly from binary masks with no tracing step. It is what Shadow Art used [119]. Editing (carving, connectivity analysis by flood fill, minimum-material search) is easy on voxels and hard on meshes.

**Costs.** Resolution-limited: edges are stair-stepped or, after smoothing, rounded. Output size grows with N²: a 256³ hull surface is of the order of hundreds of thousands of triangles. Watertightness depends on the mesher: see the manifold caveats for surface nets and marching cubes in 1.13 [114][115].

**Getting a guaranteed-manifold mesh from voxels.** Pass the grid to Manifold's `levelSet` as a sampled field; marching tetrahedra has no ambiguous cases [115] and the result is a `Manifold`. Not measured.

#### 3.5 The direct route for orthogonal extrusions *(derivation)*

The slice of the hull at height z is A ∩ (C_z × B_z), where C_z = { x : C(x,z) } and B_z = { y : B(y,z) } are unions of intervals. So each slice is A clipped to a set of rectangles. For pixel masks this gives a run-length algorithm: for each z, compute the interval lists of row z of B and C, and clip A. For polygons the interval end-points move linearly with z between vertex heights of B and C, so the solid between two consecutive vertex heights is A intersected with a union of wedge-shaped prisms.

This is a correct and fast special case, but it is a mesh Boolean in disguise, and it must solve the same robustness problems at the seams between z-ranges. Manifold already does the general case in 9 ms. **Do not write it.** The one place the slice formula is worth using is the *checker* and the *preview*: it gives the shadow-completeness answer in 2D without building any solid (2.4).

#### 3.6 Recommendation for Part 3

**Primary kernel: Manifold (`manifold-3d`)**, in a Web Worker, behind the tool's own interface.

**Wrap, do not reinvent:** 2D polygon Booleans and offsets (`CrossSection`); extrude with twist and scale; revolve; all 3D Booleans; projection and slicing; splitting into pieces; distance-field meshing (`levelSet`); 3MF export.

**Write yourself (small, well-defined):** mask-to-polygon tracing (or use a permissively licensed tracer; `potrace` on npm is GPL-2.0, `imagetracerjs` is Unlicense, `d3-contour` is ISC); the rotation-minimising frame [106]; sweep, helix, loft and wrap mesh builders feeding `Manifold.ofMesh`; the distance transform for inflation; the voxel AND and its checker; the consistency report.

**Seams to declare now.** `kernel` (default Manifold; a B-rep kernel could replace it for STEP export), `mesher` (default Manifold `levelSet`; surface nets or dual contouring could replace it), `tracer` (mask to polygons). Each is one argument with a working default.

**Second representation.** Keep the voxel route as a genre-2 option for mask inputs and for the editing features. It shares the checker.

**B-rep, later and optional.** If STEP export for CNC or engraving workflows is required, add replicad as a lazily loaded plugin. It costs a 23 MB download and brings an LGPL component, so it must not be in the default bundle.

---

### PART 4 — Viewer and rendering stack

#### 4.1 Libraries

| Library | npm package | Version, published | Licence | Size | Maintenance | Verdict |
|---|---|---|---|---|---|---|
| three.js | `three` | 0.186.1, 2026-09-24 | MIT | unpacked 20.4 MB; `three.module.js` 663 KB (131 KB gzip) + `three.core.js` 1.46 MB (287 KB gzip); WebGPU build `three.webgpu.js` 2.28 MB (444 KB gzip) | Very active | **Wrap** |
| react-three-fiber | `@react-three/fiber` | 9.8.1, 2026-09-24 | MIT | unpacked 2.4 MB | Very active; needs React 19 (peer range `>=19 <19.4`) | **Wrap**, if the application is React |
| drei | `@react-three/drei` | 10.7.9, 2026-09-25 | MIT | unpacked 1.75 MB (tree-shakeable) | Very active | **Wrap** |
| Babylon.js | `@babylonjs/core` | 9.28.0, 2026-09-24 | Apache-2.0 | unpacked 71.6 MB (tree-shakeable) | Very active | Avoid here (no advantage for this task; second ecosystem) |
| three-mesh-bvh | `three-mesh-bvh` | 0.9.15, 2026-09-09 | MIT | module 291 KB (62 KB gzip) | Very active | Optional: fast picking on large meshes |
| react-three-csg | `@react-three/csg` | 4.0.0, 2026-08-07 (repo last pushed 2025-03) | MIT | unpacked 1.6 MB | Slow | Avoid (wraps three-bvh-csg; same non-manifold caveat) |
| postprocessing | `postprocessing` | 6.39.5, 2026-09-09 | Zlib | unpacked 2.8 MB | Active | Wrap, for ambient occlusion and outlines, WebGL renderer only |
| react-postprocessing | `@react-three/postprocessing` | 3.1.3, 2026-09-27 | MIT | unpacked 432 KB | Active | Wrap |
| N8AO | `n8ao` | 2.0.1, 2026-08-10 | ISC | unpacked 804 KB | Active | Wrap, ambient occlusion |
| camera-controls | `camera-controls` | 3.1.2, 2025-11-17 | MIT | unpacked 376 KB | Active | Optional: smooth "fly to view" transitions |
| leva | `leva` | 0.10.1, 2025-10-31 | MIT | — | Slow | Development only; build the real dials from the parameter schema |
| three-gpu-pathtracer | `three-gpu-pathtracer` | 0.0.24, 2026-02-21 | MIT | — | Active | Later: "beauty render" button |

#### 4.2 three.js, Babylon.js, or react-three-fiber with drei

**Choose three.js, through react-three-fiber and drei.** Reasons. The project's frontend conventions are React, schema-driven and declarative, and react-three-fiber expresses the scene as components whose properties are the dials. drei supplies, as single components, nearly every staging effect on the list in 4.6. Every browser trip-let tool that names its renderer uses three.js [123]. Manifold's output (`vertProperties`, `triVerts`) drops directly into a three.js `BufferGeometry`.

**Babylon.js** is a complete engine and has first-party CSG through Manifold ("Before you can use CSG2, you must initialize the Manifold library" [138]; the older pure-JavaScript CSG "was not maintained and not usable anymore" [139]). That confirms Manifold as the kernel but is not a reason to adopt Babylon: the tool calls Manifold in a worker and the renderer never sees the kernel.

**Keep the renderer behind a seam.** The geometry layer should output plain typed arrays (positions, indices, per-component colour, plus the 2D silhouette polygons). The viewer is one consumer of that. A plain three.js viewer without React, or a Babylon viewer, could then be added without touching the core.

#### 4.3 Material dials (MeshPhysicalMaterial)

From the three.js documentation [142]. `roughness` and `metalness` are inherited from the standard material.

| Dial | Range, default | Meaning | Use in this tool |
|---|---|---|---|
| color | — | Base colour | Per component |
| roughness | 0–1 | Matte to mirror | Plastic about 0.4–0.6, polished metal about 0.1–0.2 |
| metalness | 0–1 | Non-metal to metal | Presets: brass, steel, gold |
| clearcoat | 0–1, default 0 | "a thin translucent layer over the base" | Lacquered wood, car paint |
| clearcoatRoughness | 0–1, default 0 | Roughness of that layer | — |
| transmission | 0–1, default 0 | Optical transparency that stays reflective; "When non-zero, set opacity to 1" | Glass or resin block around a shadow sculpture |
| thickness | default 0 | Volume depth under the surface; 0 means thin-walled | Needed for refraction to look solid |
| ior | 1.0–2.333, default 1.5 | Index of refraction | Glass 1.5, water 1.33 |
| attenuationColor, attenuationDistance | white, infinity | Tint gained with depth | Coloured resin |
| opacity (with `transparent`) | 0–1 | Plain alpha blending | X-ray mode |
| sheen, iridescence, anisotropy, dispersion | 0–1, default 0 | Cloth, soap film, brushed metal, prism colours | Advanced panel |

**Cost.** The material "has a higher performance cost, per pixel, than other three.js materials. Most effects are disabled by default, and add cost as they are enabled. For best results, always specify an environment map when using this material" [142]. Transmission renders the scene an extra time into a separate target; the renderer has a `transmissionResolutionScale` to reduce that cost [144].

**Transmission versus opacity.** Use opacity for a cheap see-through diagnostic view. Use transmission for a material that should look like glass. Do not offer both on the same material at once [142]. drei has a `MeshTransmissionMaterial` with more options (documentation file confirmed to exist; options not read).

**Present as presets first.** Matte plastic, glossy plastic, brushed metal, polished metal, glass, resin, wood. Expose the raw dials under "advanced". This is the progressive-disclosure rule applied to materials.

#### 4.4 Three orthogonal shadows on three walls

Two ways.

**A. Real shadow maps.** Three `DirectionalLight`s along −x, −y, −z, each casting onto one wall. A directional light's shadow camera is orthographic, which is the parallel projection the trip-let needs: the three.js source constructs it as `new OrthographicCamera(-5, 5, 5, -5, 0.5, 500)` [151]. The walls can use `ShadowMaterial`, which is transparent except where shadow falls [146].

- *For:* the shadow is physically produced by the solid on screen, so it is honest, and it updates for free when the solid rotates or is carved.
- *Against:* resolution is limited by the shadow map (jagged or blurred edges; letters need 2048 or 4096 pixels); needs bias tuning to avoid speckle; each wall receives light from the other two lights, which washes out its shadow, so walls need a custom treatment (each wall lit only by its own light); three shadow passes per frame.

**B. Draw the silhouette polygons on the walls.** The kernel already gives the exact projected outline as polygons (`project()` [90]). Triangulate them and place them as flat meshes a hair in front of each wall.

- *For:* perfectly sharp at any zoom; costs almost nothing per frame; and it can show *three layers at once*: the target image (outline), the achieved shadow (filled), and the missing region (red). That is the consistency report of 2.5 drawn where the user is looking.
- *Against:* it is a diagram, not a simulation. It is only valid for the three axis directions and must be recomputed when the solid changes (5–28 ms here).

**Recommendation.** B is the default, because it is exact and because showing the mismatch is the point of the genre. Offer A as a "real light" toggle, and use it for the animation where the solid or a light moves away from the axes, since only a real shadow shows how the letters dissolve between views. Both consume the same kernel output, so neither needs the core to change.

#### 4.5 WebGPU status in three.js

Read directly from the three.js manual and documentation [140][141].

- `WebGPURenderer` "is the new alternative of WebGLRenderer" and "tries to use a WebGPU backend if the browser supports WebGPU. If not, WebGPURenderer falls backs to a WebGL 2 backend" [141]. A `forceWebGL` option exists [141].
- It is imported from a different entry point: `import * as THREE from 'three/webgpu'` [140].
- Initialisation is asynchronous: `await renderer.init()`, or use `setAnimationLoop` [140].
- "Custom materials based on ShaderMaterial, RawShaderMaterial and modifications of built-in materials via onBeforeCompile() are not supported in WebGPURenderer" [140].
- "EffectComposer with its effect passes are not supported because WebGPURenderer comes with a new, more modern post-processing stack" [140].
- Status, in the maintainers' words: "The renderer itself is still in an experimental state although its maturity level has been greatly improved in the last years. Still, depending on your application and scene setup, you will encounter missing features or a better performance with WebGLRenderer" [140].
- "WebGLRenderer is still maintained and the recommended choice for pure WebGL 2 applications. However, keep in mind that there are no plans to add larger new features" [140].
- react-three-fiber 9 accepts "a callback passed to GL [that] can now return a promise for async constructors like WebGPURenderer", and its guide calls WebGPU "still a work in progress and not fully backward-compatible with all of Three's features" [148]. Version 10, with WebGPU as a first-class option, is reported to be in alpha *(search excerpt only)*.

**Consequences for this tool.** drei's `AccumulativeShadows` is built on a `ShaderMaterial` (its own type signature says so [147]), and the `postprocessing` and `n8ao` packages are built on the classic composer. Those are exactly the things the WebGPU renderer does not support. Third-party articles call WebGPU production-ready and recommend it for new projects *(search excerpt only)*; the maintainers' own manual is more cautious, and I weight the manual higher.

**Recommendation.** Ship on `WebGLRenderer`. This tool renders one object and three walls; it has no performance problem that WebGPU would solve. Keep the renderer choice behind one argument so that a later switch is a configuration change, and avoid writing custom GLSL shaders, which would have to be rewritten.

#### 4.6 Environmental effects worth offering

| Effect | How | Notes |
|---|---|---|
| Orbit, pan, zoom | drei `OrbitControls` | The documentation file was not at the path I guessed; component not re-verified today (section 6) |
| Click-through picking of stacked components | drei `CycleRaycast` | Documentation file confirmed to exist; options not read |
| HDRI environment lighting | drei `Environment` | It "sets up a global cubemap, which affects the default scene.environment". **The `preset` property "is not meant to be used in production environments and may fail as it relies on CDNs"** [147]: bundle one or two small HDR files with the tool |
| Soft ground shadow, cheap | drei `ContactShadows` | "A rather expensive effect"; for a still object render it once with `frames={1}` [147] |
| Soft ground shadow, best quality | drei `AccumulativeShadows` with `RandomizedLight` | "zero performance impact after all frames have accumulated"; gives "realistic raycast-like shadows and ambient occlusion" [147]. WebGL renderer only |
| One-line studio setup | drei `Stage` | Documentation file confirmed to exist; options not read |
| Ambient occlusion | `n8ao`, or the `postprocessing` package | Makes the concavities of a trip-let readable |
| Tone mapping | `renderer.toneMapping`: None, Linear, Reinhard, Cineon, ACESFilmic, AgX, Neutral; default is none [144] | Offer Neutral (faithful colours) and ACES or AgX (photographic) |
| Turntable | Rotate the object, or auto-rotate the camera | For genre 2, add "snap to view": animate the camera to each of the three axes in turn, with an orthographic camera at the end of each move so the letter reads exactly |
| Orthographic / perspective switch | Two cameras | A silhouette reads exactly only in orthographic view |
| Wireframe / x-ray | `wireframe` flag; low opacity | Diagnostic |
| Section / clipping plane | `material.clippingPlanes` with `renderer.localClippingEnabled = true` [143][144] | See below |
| Exploded view by component | Translate each component along its own axis | Natural for genre 1, where components have separate transforms |
| Fit to view, view cube | drei `Bounds`, `GizmoHelper` | Documentation files confirmed to exist |

**The section plane is the signature feature.** Part 1 lists, for each transform, the plane whose cut reproduces the original figure. The viewer should have a button "show the original slice" that places the clipping plane there: the base plane for an extrusion, a half-plane through the axis for a revolve or screw, the mid-plane for an inflation or a star slab, the start plane for a sweep.

Clipping in three.js only discards fragments: "Points in space whose signed distance to the plane is negative are clipped (not rendered)" [143], so the cut solid looks hollow. Two ways to fill the cut:

1. The stencil technique shown in the official example "solid geometry with clip planes and stencil materials" [145].
2. Ask the kernel: `slice(height)` "returns the cross section of this object parallel to the X-Y plane at the specified height" [90]. Draw that polygon as a flat coloured cap. It is exact, and the same polygon can be compared with the original figure to *prove* the slice matches.

Option 2 is better here for the same reason as drawn shadows in 4.4: the polygon is data the tool can check and export (an engraving outline, for instance), not only pixels.

---

### 5. Recommended architecture for this layer, in brief

- **Core is pure and renderer-free.** Input: polygons with holes, or masks. Output: typed arrays and polygons. It runs in a Web Worker.
- **A transform is a plugin** with a parameter schema (the dials), a `build(figure, params)` function returning a solid, and an `originalSlice(params)` function returning the plane whose cut reproduces the figure, or nothing. The last one is what makes the section-plane button generic.
- **A genre composes transforms.** Genre 1 maps components to transforms and unions the results. Genre 2 maps n images to n view directions, intersects, and runs the checker.
- **The checker is part of the core, not the viewer.** It returns, per view, the achieved shadow, the missing region, and the missing fraction; and per solid, the piece count, genus and volume.
- **Would another surface need the core to change?** A command-line exporter, or an HTTP service, would call the same worker functions under Node, where `manifold-3d` runs as shown by the measurements above. No.

---

### 6. What I could not verify

- **Manifold's behaviour when a revolve profile crosses the axis.** Not documented in what I read, not tested.
- **Whether the published `manifold-3d` WebAssembly build uses threads.** Not stated in the sources read.
- **Which `manifold-3d` release contains the fix for the Content-Security-Policy issue** [95]. The issue is closed; the release was not identified.
- **Cost of `levelSet` with a JavaScript callback.** Not measured.
- **Browser timings.** All measurements are from Node on one machine.
- **Autodesk Fusion help pages** [99][100][101], **JSCAD's API pages** [104], **replicad's "use as a library" page** [135], **OpenSCAD's `roof()` page** [89], **Lyl3's Thingiverse page** [128], **ambigramgenerator.me** [129]: these render with JavaScript or returned navigation only. Claims from them rest on search-engine excerpts.
- **CadQuery** [98]: I read the raw page for `sweep` (`isFrenet`: "Frenet mode (default False)"; `transitionMode`: 'transformed', 'round' or 'right') and for `Wire.makeHelix(pitch, height, radius, center, dir, angle, lefthand)`. The other signatures (`extrude` with `taper`, `twistExtrude`, `revolve`, `loft`, `shell`, `fillet`, `chamfer`) come from the fetcher's summary of the same page.
- **Manifold wiki quotations** [92]: via the fetcher's summary; the manifoldness definition matches the 3MF wording, but treat the ε-validity wording as paraphrase.
- **JSCAD `extrudeFromSlices`, OpenSCAD `surface()`, Blender Simple Deform, three.js `ExtrudeGeometry` bevel behaviour, drei `OrbitControls`**: named from general knowledge of those tools, not re-verified today.
- **Bishop's 1975 article** [105] and **Wang et al. 2008** [106]: abstracts only; both are behind publisher access.
- **Laurentini 1994** [117]: citation details from Wikipedia and from the Shadow Art reference list; the article itself was not read.
- **A maintained CGAL mesh-Boolean build for the browser.** I found none on npm. That is absence of evidence from one registry search, not proof that none exists.
- **An "occt-wasm" project** (OpenCascade at "~4MB brotli" with worker support) appeared in search results under many forked names. I could not identify the original or confirm the size claim, so it is not in the comparison table.
- **OpenSCAD speed-up figures** [150]: search excerpt only.

---

### 7. Recommended stack for this layer

| Concern | Choice | Package @ version | Licence | Why | Seam / fallback |
|---|---|---|---|---|---|
| Solid kernel (Booleans, extrude, revolve) | Manifold | `manifold-3d` @ 3.5.4 | Apache-2.0 | Only option whose output is manifold by construction; 9 ms for a trip-let here; 205 KB gzip | `kernel` argument; replicad as optional B-rep plugin |
| 2D polygon operations (union, offset, clean-up) | Manifold `CrossSection` | same | Apache-2.0 | Already in the kernel; no second library | — |
| Shadow and slice checking | Manifold `project()`, `slice()`, `decompose()` | same | Apache-2.0 | Exact polygons; 5–28 ms here | Raster check on the voxel route |
| Distance-field meshing | Manifold `levelSet()` | same | Apache-2.0 | Marching tetrahedra, result is a `Manifold` | `mesher` argument; surface nets or dual contouring, own code |
| Voxel route (mask inputs, carving, connectivity) | Own code, about 100 lines | — | — | Trivial, cannot fail, 34 ms at 256³ here | Meshed through `levelSet` |
| Sweep frames | Own code: double reflection method [106] | — | — | About 20 lines; no library needed | Frenet and fixed-up as alternative strategies |
| Inflation | Own code: distance transform plus height profile | — | — | Works from masks; mid-plane slice is exact | Teddy- or Repoussé-style as later plugins |
| Mask to polygon tracing | `d3-contour` (ISC) or `imagetracerjs` (Unlicense), or own marching squares | `d3-contour` @ 4.0.2 | ISC | Permissive | `tracer` argument. **Avoid `potrace` (GPL-2.0) and `marchingsquares` (AGPL-3.0)** |
| Font outlines (letters) | opentype.js | `opentype.js` @ 2.0.0 | MIT | Used by the prior-art tools [122] | — |
| Threading | Web Worker, with `comlink` for calls | `comlink` @ 4.4.2 | Apache-2.0 | Keeps the interface responsive; the kernel package ships its own worker bundle | — |
| Renderer | three.js, `WebGLRenderer` | `three` @ 0.186.1 | MIT | Mature; all staging helpers depend on it | One argument; WebGPU later |
| Scene as components | react-three-fiber | `@react-three/fiber` @ 9.8.1 | MIT | Declarative; dials are properties; needs React 19 | Plain three.js viewer as a second surface |
| Staging helpers | drei | `@react-three/drei` @ 10.7.9 | MIT | Environment, ContactShadows, AccumulativeShadows, Stage, Bounds, GizmoHelper | Bundle the HDR files; do not use `preset` in production |
| Ambient occlusion and effects | N8AO with postprocessing | `n8ao` @ 2.0.1, `postprocessing` @ 6.39.5 | ISC, Zlib | Readable concavities | WebGL renderer only |
| Wall shadows | Drawn silhouette polygons by default; real shadow maps as a toggle | — | — | Exact, and shows target, achieved and missing together | Both read the same kernel output |
| Section cap | Kernel `slice()` polygon drawn as a cap | — | — | Exact; can be compared with the original and exported | Stencil technique [145] |
| Print export | 3MF first, STL second | `@jscadui/3mf-export` @ ^0.5.0 (already a dependency of `manifold-3d`) | not checked | STL loses the manifold topology [59] | glTF with `EXT_mesh_manifold` for viewing |
| CAD export (STEP) | Not in the first version | `replicad` @ 1.1.0 + `replicad-opencascadejs` @ 1.1.0 | MIT + **LGPL-2.1-only** | 23 MB download; load only on demand | Optional plugin |
| Not recommended | three-bvh-csg, three-csg-ts, csg.js, @jscad/modeling as kernel, opencascade.js directly, any CGAL build, Babylon.js | — | MIT / MIT / MIT / MIT / **LGPL-2.1** / **GPL-3.0+** / Apache-2.0 | Non-manifold output, or unmaintained, or very large, or restrictive licence, or a second ecosystem with no gain | — |

---

---

## Part C — Physical embodiment and export formats

Date of research: 2026-09-28. Scope: a browser-only (no backend) TypeScript tool that turns 2D images into parametrized 3D meshes ("shadow blocks" = Boolean intersection of three orthogonal silhouette extrusions, among other genres) for viewing, GIF/video, 3D printing and engraving.

#### How to read this report

- Every factual claim carries a numbered reference to a page that was fetched or searched live during this session. Where a claim could only be confirmed through a search-result snippet, or not at all, it is marked **(unverified)** or **(snippet only)**.
- npm facts (version, licence, publish date, size) were read from the npm registry with `npm view` on 2026-09-28 [235]. "Size" is the npm **unpacked tarball size**, which is an upper bound and usually much larger than what ends up in a bundle. Minified/gzipped bundle sizes were not measured unless a project's own README states one.
- "Publish date" is the publish date of the version carrying the `latest` dist-tag.
- Numbers from manufacturer design guides disagree with each other, sometimes by a factor of five. That is expected: a printer maker quotes what the machine can do, a print service quotes what it will guarantee. The thresholds proposed at the end take the conservative (service) side.

---

### PART 1 — Physical embodiment and design for manufacturing

#### 1.1 Manifold / watertight geometry

##### What "manifold" means, operationally

The 3MF Core Specification gives the definition that matters in practice. For an object of type `model`: every triangle edge must share its two vertex endpoints with the edge of exactly one other triangle; adjacent triangles must have consistent orientation (the shared edge is traversed in opposite order by the two triangles); and all triangles must be oriented with normals pointing away from the interior [168]. The STL convention is the same in spirit: a unit facet normal pointing outward, vertices listed counter-clockwise seen from outside (right-hand rule), and the "vertex-to-vertex" rule that every edge is shared by exactly two faces without self-intersection [169].

Manifold (the library) adopts the 3MF definition deliberately, because it depends only on topology (integer indices), not on floating-point geometry, so the result of the check is not affected by rounding [92].

##### What goes wrong downstream

| Defect | What it is | What the slicer does |
|---|---|---|
| Open (boundary) edge | an edge used by one triangle only: a hole | inside/outside is undefined along the slice; slicers attempt auto-repair and flag the model with a warning icon [170] |
| Non-manifold edge | an edge used by three or more triangles | same: cannot decide which side is solid; auto-repair is attempted, not guaranteed [170] |
| Flipped normals / inconsistent winding | triangles facing inward | violates the 3MF and STL orientation rules [168][169]; a whole shell with inverted orientation reads as a void (negative volume) |
| Self-intersection / overlapping shells | surface passes through itself | 3MF resolves overlap with the positive fill rule [168], so a consumer that implements the spec treats overlapping positive shells as a union; STL has no such rule [169] |
| Zero-thickness feature | two faces coincident, or a wall thinner than one extrusion/pixel | topologically valid but physically unprintable: "walls thinner than one nozzle perimeter are not printable" [171] |

Prusa's own knowledge base states that PrusaSlicer tries to repair automatically during slicing, that a warning symbol appears next to the model name, that "not all corrupted 3D models can be repaired automatically", and that the stronger repair ("Fix by the Netfabb") is Windows-only because it relies on a Microsoft API [170]. The design consequence is plain: **do not rely on the slicer to fix the mesh; export a mesh that is already valid.**

I could not find a first-party slicer document that describes, defect by defect, what each slicer does with each kind of bad mesh. The per-defect column above combines the specification rules [168][169] with Prusa's general statement [170]; treat the detailed behaviour as **(unverified)** beyond that.

##### What the Manifold library guarantees

- "Our primary goal is reliability: guaranteed manifold output without caveats or edge cases." [166]
- The guarantee is manifold output **from manifold input** [92]. The Boolean produces manifold output even when the input is not ε-valid (that is, even when it is geometrically overlapping), but geometric validity then cannot be assured [92].
- ε-valid means there is a perturbation of the vertices, each by less than ε, under which the mesh is non-overlapping; the aim is ε-valid output from ε-valid input [92].
- It "cannot guarantee that all degenerate triangles (height < ε) are removed" [92].
- Coincident faces are handled by symbolic perturbation so that touching cubes merge, equal-height differences produce through-holes, and a mesh minus itself is empty [92]. This matters for shadow blocks, where the three extrusions share bounding planes exactly.
- The WASM build is single-threaded ("serial-only for now, but still fast") [166].
- Manifold's authors explicitly warn against STL: "when saving a manifold mesh to STL there is no guarantee that the re-imported mesh will still be manifold, as the topology is lost", and recommend 3MF, or glTF with the `EXT_mesh_manifold` extension when vertex properties are needed [166].
- Used by OpenSCAD, Blender, Godot and Babylon.js among others [166].

For this tool the important point is architectural: **if every solid is born inside Manifold (extrude a `CrossSection`, intersect, union a base plate) the mesh is manifold by construction and no repair step is needed.** Repair is only needed for meshes that come from somewhere else (marching cubes output, an imported STL).

##### Validation checks available in the browser

All of these exist on the `Manifold` class in `manifold-3d` 3.5.4 (verified in the shipped typings [167]):

| Check | API | Meaning |
|---|---|---|
| Constructed successfully | `status()` | returns an `ErrorStatus`; constructing a `Manifold` from a non-manifold mesh reports a status rather than silently succeeding [167] |
| Non-empty | `isEmpty()`, `numTri()`, `numVert()`, `numEdge()` | an empty intersection is the first failure mode of a shadow block |
| Positive volume | `volume()` | sign and magnitude; near-zero volume means a degenerate result |
| Surface area | `surfaceArea()` | with volume, gives a compactness figure |
| Genus | `genus()` | number of handles; an unexpected genus signals through-holes |
| Connected components | `decompose()` | returns `Manifold[]`, one per topologically disconnected piece |
| Bounding box | `boundingBox()` | for the size dial and for bed-fit checks |
| Clearance between two solids | `minGap(other, searchLength)` | for multi-part clearance checks |
| Cross-section at height | `slice(height)` | returns a `CrossSection`; basis for stacked-layer export and per-layer checks |
| Silhouette | `project()` | returns a `CrossSection`; verifies that the shadow actually equals the input mask |
| Best-effort stitching of an imported mesh | `Mesh.merge()` | merges vertices along open edges within tolerance; "There is no guarantee the result will be manifold - this is a best-effort helper" [167] |

If a mesh is validated outside Manifold (for example on a three.js `BufferGeometry`), the checks to write by hand are: build an edge map keyed on the sorted vertex pair and require every edge to occur exactly twice, once in each direction (edge-manifoldness + closedness + consistent orientation in one pass); compute signed volume by the divergence theorem (sum of `dot(v0, cross(v1, v2)) / 6`) and require it to be positive; compute the Euler characteristic `V - E + F = 2 - 2g` per component to get the genus. These are standard results, not library features, and need welded (indexed) vertices first.

#### 1.2 Minimum wall thickness and feature size by process

##### Published numbers

| Process | Source | Min wall (supported / unsupported) | Min feature / pin / wire | Min detail (emboss / engrave) | Min hole | Escape / drain hole | Tolerance |
|---|---|---|---|---|---|---|---|
| FDM, 0.4 mm nozzle | Prusa [171] | 1 perimeter = 0.45 mm, 2 = 0.9 mm, 3 = 1.35 mm; thinner than one perimeter is not printable | — | — | — | not needed | at least ±0.2 mm; 0.3 mm clearance for moving parts |
| FDM | Hubs / Protolabs Network [173][174] | "wall thicknesses greater than 0.8 mm" print on all processes [174] | vertical pins below 5 mm diameter may fail [173] | — | vertical holes print undersized [173] | not needed | — |
| SLA | Formlabs, Form 4 generation [178] | 0.2 mm / 0.2 mm | vertical wire 0.3 mm (7 mm tall), 0.6 mm (30 mm tall) | 0.1 mm / 0.15 mm | 0.5 mm | 0.75 mm | clearance 0.4 mm |
| SLA | Hubs [175] | 0.4 mm / 0.6 mm | — | 0.1 mm high / 0.4 mm wide and deep | 0.8 mm | 3.5 mm, at least one per hollow section; hollow wall at least 2 mm | clearance 0.5 mm moving, 0.2 mm assembly |
| SLA (slicer) | PrusaSlicer hollowing [180] | minimum hollowing thickness 1 mm | — | — | — | at least two drainage holes | — |
| SLS PA12 | Hubs [176] | 0.8 mm (2.0 mm carbon-filled) | 0.8 mm | 1 mm / 1 mm; text at least 2 mm high | 1.5 mm | 3.5 mm | ±0.3 % with a floor of ±0.3 mm |
| SLS PA12 | Shapeways [181] | 0.7 mm / 0.7 mm (1.5 mm for the smooth finish) | wire 0.8 mm supported, 1.0 mm unsupported | 0.2 mm; 0.5 mm for text | — | 4.0 mm single, 2.0 mm each when multiple | ±0.15 mm + 0.15 % of longest dimension; clearance 0.5 mm; minimum bounding box X+Y+Z at least 20 mm |
| MJF PA12 | HP guidelines as republished by Proto3000 [183] | 0.3 mm in XY, 0.5 mm in Z for short walls; 2 mm recommended for hollow parts | cantilever under 1 mm wide: aspect ratio below 1:1 | — | — | — | clearance 0.4 mm assembly, 0.7 mm moving |
| MJF PA12 | Xometry [182] | 0.7 mm minimum, 1.3 mm preferred, 7 mm maximum | 0.5 mm | line 0.5 mm; emboss 1 mm high; engrave 0.5 mm deep; characters 2.5 mm | — | 5 mm, at least two on opposite sides | ±0.3 % (±0.3 mm) |
| Metal DMLS/SLM | Hubs [177] | 0.4 mm | 0.6 mm | 0.4 mm | 1.5 mm | — | ±0.1 mm; max overhang angle 50°; max aspect ratio 8:1; unsupported edge 0.5 mm |
| Metal DMLS | Protolabs [184] | walls under 1 mm need height:thickness below 40:1 | 1.0 mm | — | — | — | ±0.1 to ±0.2 mm + 0.005 mm/mm; unsupported bridge 2 mm |

Notes on this table. The Hubs FDM page itself does not state a minimum wall; the 0.8 mm figure comes from the general Hubs article [174]. The Formlabs drain-hole figure (0.75 mm) is the smallest hole that works at all; the 3.5 mm Hubs figure is the size at which resin actually drains in reasonable time, and is the one to use as a default. The two metal sources disagree on minimum feature (0.6 mm vs 1.0 mm); use the larger. I did not fetch HP's own PDF, only two republications of it [182][183].

##### Measuring thickness

**Definition.** The accepted definition of local thickness is Hildebrand and Rüegsegger's: the local thickness at a point is the diameter of the largest sphere that lies completely inside the structure and contains the point [185]. It is computed from a distance transform: distance map, then distance ridge (a superset of the centres of maximal spheres), then the thickness map [185]. This is the algorithm behind the "Local Thickness" plugin in Fiji/ImageJ [185].

**Three places to measure, cheapest first.**

1. **On the 2D masks (recommended primary check).** A shadow block is the intersection of three extrusions, so any feature of the solid is no thicker, in the two in-plane directions of a given view, than the corresponding feature of that view's mask. Run a Euclidean distance transform on each binary mask; the local thickness in pixels is twice the distance value at the ridge. Convert with `mm_per_pixel = bbox_mm / mask_resolution`. The even simpler form is an erosion (morphological opening) test: open the mask with a disc of radius `t_min / 2`; any foreground pixels that disappear belong to features thinner than `t_min`. This is exact for the mask, fast enough to run on every parameter change, and lets the tool paint the thin regions red on the input image, which is where the user can fix them. Limitation: it is a necessary condition only. The intersection can be thinner than any single mask (two thick features crossing at a shallow overlap leave a sliver).
2. **On a voxel grid.** Voxelise the final solid at a pitch of about `t_min / 3` or finer, run a 3D distance transform, and apply the same local-thickness rule. This catches the slivers that the 2D test misses. Cost is memory: a 256-cubed grid is 16.7 million voxels, which is fine as a `Uint8Array` plus a `Float32Array` in a worker; 512-cubed is 134 million and is not. A voxel erosion test (open with a ball of radius `t_min / 2`, report lost volume) is cheaper than full local thickness and answers the yes/no question.
3. **On the mesh.** Ray-based ("shoot a ray inward along the negated normal and measure the distance to the first hit") using a BVH such as `three-mesh-bvh` (MIT, 0.9.15, 2026-09-09 [235]). It overestimates thickness at grazing angles and is sensitive to tessellation. Use it only if there is no voxel representation. An approximate alternative inside Manifold is offset-and-compare: there is no negative-offset operator on `Manifold`, but `CrossSection.offset` exists for 2D slices [167], so thickness can be tested slice by slice.

Recommendation: run (1) always and live; run (2) on demand ("check printability") in a worker; skip (3).

#### 1.3 Disconnected and floating parts

##### Why a Boolean intersection creates them

A voxel at (x, y, z) belongs to the shadow block only if its three projections all land on foreground pixels. A silhouette that is a single connected shape in each view can still produce several separate pieces in 3D, because connectivity in each 2D projection does not imply connectivity of the 3D intersection. And if any input mask itself has more than one component (the letters of a word, a dotted "i", the separate strokes of a stencil), the result is necessarily disconnected.

##### What Mitra and Pauly did

Shadow Art [121] is the reference. Verified against the paper's PDF:

- The shadow hull is the intersection of the generalised cones of the shadow sources, computed on a binary voxel grid by a logical AND of the projected image pixels [121, section 2]. Input images were 250 by 250 in all examples but one [121, section 5].
- Their central problem is **inconsistency**, which is a different failure from disconnection: the shadow cast by the hull is smaller than the requested image, because some pixel of one image corresponds to a line of voxels that are all ruled out by the other images. "Inconsistency is the rule rather than the exception for more than two shadow sources" [121, section 2].
- Their remedy for inconsistency is to **deform the input images**, using as-rigid-as-possible shape manipulation driven by positional constraints derived from the least-cost voxel on each inconsistent pixel's line, applying only a fraction (0.25) of the displacement per iteration [121, section 3].
- On connectivity they are explicit that they did not solve it: "The optimization does not consider structural aspects such as connectedness of the shadow hull that might be important for a physical realization of the sculpture. However, we can ensure that no additional components will be created during the editing stage. If the input images are composed of multiple components, the shadow hull necessarily consists of disconnected pieces. In such cases, the 3D sculpture can be embedded in a transparent medium, as illustrated in Figure 9 and 13. Alternatively, transparent threads or other thin supporting elements can be added to create a stable configuration as shown in Figure 1." [121, section 5, Discussion and Limitations]
- They also added a pedestal for stability in the Lego example [121, figure 7], and their 3D print lost features "due to restrictions of the 3D printer" [121, figure 10].
- Fabrication path: voxel grid to triangle mesh by contouring, a few subdivision steps to smooth, then to a 3D printer [121, section 4].

So the honest summary is: Shadow Art fixes *wrong shadows* by warping the inputs, and handles *disconnected pieces* by embedding in a transparent block, by threads, or by a pedestal. It offers no automatic connectivity repair.

A second check worth taking from the paper: **shadow consistency**. After building the solid, project it back along each axis (`Manifold.project()` [167]) and compare with the input mask. Pixels in the mask but not in the projection are the inconsistent pixels. Report the percentage per view; this is the single most informative quality number for a shadow block.

##### Detection

`Manifold.decompose()` returns one `Manifold` per connected component [167]; take `volume()` and `boundingBox()` of each. On a voxel grid, use 6-connected component labelling (6-connectivity, because voxels that touch only along an edge or at a corner are not a printable connection).

##### Remedies, in the order the tool should offer them

1. **Warn and show.** Colour each component differently in the viewport and list them with volume and size. Always do this.
2. **Drop dust.** Remove components below a volume threshold (proposed default: below 1 % of the largest component's volume, or smaller than the minimum feature size in every dimension). Re-check shadow consistency afterwards, because the dropped piece may have been carrying part of a shadow.
3. **Keep largest only.** A one-click option; same re-check.
4. **Add a base plate.** A slab under the block that every component touching the bottom fuses to. It also gives a flat first layer. It does not help components that float above the bottom.
5. **Add struts or a frame.** Thin rods joining each floating component to its nearest neighbour or to the base. They alter the shadow; keep the diameter at the process minimum wire size and route them where they fall inside an existing shadow if possible.
6. **Thicken the 2D inputs.** Dilate the masks by a few pixels. This is the cheapest fix for near-misses and also helps wall thickness, at the cost of fidelity.
7. **Embed in a transparent medium** [121], that is, export the components as a multi-body file for a two-material print (opaque figure, clear matrix). Realistic only for PolyJet-class printers or casting in resin.
8. **Sprue / kit.** Attach loose parts to a sprue frame and print them as a kit to be assembled.

#### 1.4 Internal cavities and trapped volumes

##### Detection

A closed void inside a solid appears in the mesh as an additional closed shell whose orientation is inward, that is, whose signed volume computed on its own is negative, and which lies inside a positively oriented shell. Procedure on a mesh: split the triangle soup into edge-connected shells, compute signed volume per shell, flag every negative shell. Note that `Manifold.decompose()` splits by connectivity of the **solid**, so a solid with a bubble in it is one component whose mesh has two shells; the shell split has to be done on the output of `getMesh()` [167]. On a voxel grid: flood-fill the empty space from the grid boundary; any empty voxel not reached is a trapped void.

For shadow blocks specifically, a fully enclosed void is rare, because every empty voxel is empty by virtue of a whole line of sight being empty in at least one view, and that line reaches the outside. Enclosed voids become possible as soon as the tool adds other operations (hollowing, shells, union with a frame). The check is cheap enough to run regardless.

##### Consequences by process

| Process | Sealed cavity | What is needed |
|---|---|---|
| FDM | printable; the slicer fills the interior with infill and nothing is trapped | nothing; a cavity only adds bridging inside |
| SLA / MSLA | uncured resin is trapped, and a hollow cup creates pressure differences ("cupping") that can cause a blowout [175][178] | drain holes: at least 3.5 mm diameter, at least one per hollow section [175]; Formlabs says one near the build platform plus at least one more [179]; PrusaSlicer says at least two [180]; Formlabs' absolute minimum is 0.75 mm [178] |
| SLS / MJF | unsintered powder is trapped; the part prints but stays full and heavy | escape holes: 3.5 mm minimum [176]; Shapeways 4.0 mm for a single hole or 2.0 mm each for several [181]; MJF 5 mm, at least two on opposite sides [182] |
| Metal powder bed | as SLS, plus internal supports that cannot be removed | avoid sealed cavities |

##### Hollowing and infill

Hollowing saves material and, in resin printing, lowers peel forces [180]. Recommended shell thickness: at least 2 mm for SLA [175], 1 mm is PrusaSlicer's floor [180], 2 mm for MJF hollow parts [183]. For FDM, hollowing in the design tool is pointless because the slicer's infill setting does it better.

Recommendation: **the tool should not hollow by default.** Offer it as an option for resin and powder processes only, and when it is on, add drain holes automatically (two, on the bottom face and one other face, 3.5 mm default) and verify that every void is connected to the outside.

#### 1.5 Overhangs, supports, orientation, bed adhesion, tolerances

| Topic | Rule | Source | Who should handle it |
|---|---|---|---|
| Overhang | 45° from vertical is the general limit without supports; Prusa quotes 45 to 60° depending on nozzle and settings, up to 75° on its newest machines | [173][171] | Tool can **report** the fraction of downward-facing area steeper than the threshold for the current orientation. Support generation belongs to the slicer. |
| Bridging | FDM bridges under 5 mm print without support; metal 2 mm; SLA horizontal span up to 29 mm (Formlabs) or 21 mm (Hubs) | [173][184][178][175] | Tool can report the longest unsupported horizontal span per layer, from `slice()`. Low priority. |
| Orientation | bottom face on the bed is flat and smooth; faces above supports are rough; FDM parts are weaker across layers | [171] | Tool should offer "which face is down" and pick the default that gives the largest flat contact area. For a shadow block with a base plate that is obvious. |
| Bed adhesion / flat base | — | — | Tool can compute the area of the mesh lying in the lowest plane (within one layer height) and warn when it is small relative to the footprint, or when the centre of mass projects outside the contact polygon (it will topple). |
| Elephant's foot | the first layer is squashed and prints wider; PrusaSlicer compensates by about 0.2 mm for a 0.4 mm nozzle, on by default in Prusa profiles; the design-side remedy is a 45° chamfer on edges touching the bed | [172][173] | Leave to the slicer. Optionally offer a small bottom chamfer on the base plate. |
| Tolerance and clearance | FDM ±0.2 mm, 0.3 mm clearance; SLS ±0.3 mm; SLA clearance 0.4 to 0.5 mm; MJF 0.4 to 0.7 mm | [171][176][178][175][183] | Matters only for multi-part assemblies (a block that sits in a separate base). Tool should apply a clearance parameter when it generates mating parts. |
| Shrinkage and warping | SLS 3 to 3.5 % shrinkage; MJF aspect ratios above 10:1 warp | [176][183] | Leave to the service. |

**What a design tool can usefully report:** validity (manifold, volume), size, component count, minimum thickness, trapped voids, shadow consistency, base contact and stability, and an overhang percentage for the chosen orientation. **What to leave to the slicer:** supports, infill, elephant's foot, seams, layer height, and everything that depends on a specific machine and material profile.

#### 1.6 Units and scale

- STL carries no units: "STL files contain no scale information, and the units are arbitrary" [169]. three.js's STLExporter documentation repeats this [196]. In practice slicers assume millimetres, and a model authored in metres arrives a thousand times too small. That assumption is convention, not specification.
- 3MF has a `unit` attribute on the `model` element with values micron, millimeter, centimeter, inch, foot, meter; the default is millimeter [168].
- glTF is in metres with +Y up; 3MF is conventionally millimetres with +Z up. Manifold's own 3MF importer notes this and converts [167]. **An exporter that writes both GLB and 3MF from one scene must convert units and the up axis in one place.**
- AMF also carries units (millimetres default) [207].

Recommendations. The internal model is unitless and normalised (unit cube). One user-facing dial sets the **longest bounding-box edge in millimetres**, default 50 mm, with the resulting X, Y, Z sizes shown. Everything that depends on size (thickness checks, thresholds, base-plate height, strut diameter) is computed after scaling. STL is written in millimetres with the size stated in the file name and the 80-byte header (for example `shadowblock_50x50x50mm.stl`). 3MF is written with `unit="millimeter"` explicitly. A minimum-size warning is useful: Shapeways requires X+Y+Z of at least 20 mm for standard PA12 [181].

#### 1.7 Engraving and cutting

##### What the machines and their software accept

| Software / service | Imports | Notes |
|---|---|---|
| LightBurn | vector: AI, SVG, DXF, PDF, PLT/HPGL; raster: PNG, JPG, BMP, GIF, TIF | fonts must be installed or text converted to paths; G-code import loses speed and power; vector export carries graphics only, no cut settings [186] |
| xTool Creative Space | JPG, PNG, BMP, GIF, WEBP, SVG, DXF | vectors can be cut, scored or engraved; rasters can only be engraved; DXF paths with gaps are auto-closed within a tolerance [189] (snippet only) |
| Glowforge | SVG (and PDF, raster) | strokes become cuts or scores, fills become engraves; each distinct colour becomes a separate step; text must be converted to paths [188] (community and third-party sources only; **I did not retrieve an official Glowforge support page**) |
| Epilog / Trotec / Universal drivers | print-driver workflow from Illustrator, CorelDRAW, Inkscape | a stroke of 0.001 in (hairline) is a vector cut, anything thicker is rastered; colour must be RGB; pure red (255, 0, 0) is the usual cut colour [191] (snippet only, from a university lab guide, not from Epilog) |
| Ponoko (service) | SVG, DXF, AI | blue (#0000ff) 0.01 mm stroke means cut; red, green, magenta mean engrave [190] (snippet only) |

The conventions differ, so the exporter should not hard-code one. What is common to all of them:

- **Stroke means cut or score, fill means engrave.** Cut geometry must be unfilled paths (`fill="none"`), engrave geometry must be filled closed paths with no stroke.
- **One colour per operation.** Every tool above maps colours to operations or layers. The exporter should take an operation-to-colour map as a parameter, with a default of red `#ff0000` for cut, blue `#0000ff` for score, black `#000000` fill for engrave, and named presets for the services that differ (Ponoko's blue-is-cut [190]).
- **Hairline stroke.** Default stroke width 0.01 mm, parameterised.
- **Closed paths.** Fill operations need closed loops [186 via search]; emit `Z` on every contour and never rely on coincident endpoints.
- **No text elements.** Any text must be converted to outlines [186][188].
- **Real units.** Write the SVG with `width` and `height` in mm and a `viewBox` in the same numbers, so that one user unit is one millimetre. DXF has an `$INSUNITS` header variable for the same purpose; whether each importer honours it was **not verified**.

##### Kerf

Kerf is the width of material removed by the beam, centred on the drawn line [190]. Published figures: CO2 lasers roughly 0.08 to 0.45 mm; about 0.16 mm is typical for hobby CO2 machines in 3 mm material; industrial services quote 0.25 to 0.5 mm [192] (snippet only). Every source insists the value be measured per material, thickness and setting. Ponoko warns that cut lines closer than 0.5 mm may burn away what lies between them and that features under 1 mm are fragile [190].

Tool behaviour: a `kerf` parameter in mm, default 0 (no compensation) with a suggested starting value of 0.15 mm; when it is non-zero, offset outer contours outward and hole contours inward by half the kerf, using `CrossSection.offset` from Manifold [167]. Do not compensate silently. Apply the 2D thickness test of section 1.2 to cut geometry with a 1 mm default minimum.

##### Heightmap (greyscale depth) engraving

LightBurn's "3D Sliced" mode takes a greyscale depth map in which pixel brightness represents depth, engraves darker pixels with more passes (so darker is deeper, invertible with Negative Image), supports 16-bit depth maps from version 2.1, and is available on galvo lasers only [187]. LightBurn's Grayscale image mode on CO2 lasers varies power between a minimum and a maximum across the tonal range and can also produce variable depth [187 via search]. CNC relief carving uses the same kind of image.

This is an easy export for the tool: render the solid orthographically from above into a depth buffer, normalise to the depth range, and save as PNG. Offer both polarities, and offer 16-bit output (canvas `toBlob` gives 8-bit only; 16-bit greyscale PNG needs an encoder such as `upng-js` or a hand-written one). **Whether upng-js writes 16-bit greyscale correctly was not verified.**

##### Stacked slices

Cutting a 3D object into parallel layers of sheet material and stacking them is an established technique: Autodesk's Slicer for Fusion 360 calls it "Stacked Slices" [194], and Kiri:Moto, a browser-based open-source slicer, has a laser mode that slices a 3D model and lays out the cross-sections for export to SVG or DXF [193] (snippet only). For this tool it is nearly free: `Manifold.slice(z)` at `z = (i + 0.5) * sheet_thickness` gives each layer as a `CrossSection` [167]. Add registration holes (two dowel holes at fixed positions through every layer), a layer number engraved on each piece, and a simple shelf packer to lay the pieces out on sheets. Report any layer that has more than one component, because its loose islands need the registration pins or a tab to stay in place.

##### G-code

Out of scope. G-code is specific to machine, controller, material, tool and feed, and LightBurn, xTool Creative Space and Glowforge all generate it themselves from vectors [186][189][188]. The tool should stop at SVG, DXF and PNG.

---

### PART 2 — Export formats and the JS libraries that write them

#### 2.1 Mesh formats

| Format | Geometry | Colour | Units | Multiple bodies / materials | Consumers | Notes |
|---|---|---|---|---|---|---|
| STL binary | triangle soup, no shared vertices | none in the standard; two incompatible vendor extensions [169] | none [169] | no | every slicer, every print service | 80-byte header + 50 bytes per triangle [169]; topology is lost [166] |
| STL ASCII | same | none | none | named `solid` blocks, poorly supported | same | several times larger; no reason to offer it except debugging |
| 3MF | indexed mesh, manifold by specification [168] | per-object and per-triangle via `basematerials` with `displaycolor` sRGB [168] | yes, default millimetre [168] | yes: objects, components, build items [168] | PrusaSlicer, Bambu Studio, Cura, OrcaSlicer, Windows 3D tools | a zip of XML; the right default for printing |
| OBJ (+MTL) | indexed mesh, polygons | per-material via MTL; per-vertex colour is a non-standard extension | none | groups and materials | general 3D tools, some full-colour print services | two files, so it must be zipped |
| PLY | indexed mesh | per-vertex colour, standard | none | no | MeshLab, Blender, scanning tools, some colour print services | simplest way to ship vertex colour |
| GLB / glTF 2.0 | indexed mesh, scene graph | PBR materials, vertex colour, textures | metres by specification | yes | web viewers, Blender, game engines, AR on Android | the right default for viewing and sharing |
| USDZ | mesh, scene graph | PBR materials, textures | metres | yes | Apple AR Quick Look | only needed for iOS AR |
| AMF | mesh, curved triangles | yes | yes [207] | yes | few | ISO/ASTM 52915:2016, last version 1.2 [207]; see below |
| VRML / X3D | mesh | per-vertex and per-face colour | metres by convention | yes | legacy full-colour printing, scientific tools | see below |

##### 3MF: is there a maintained JS writer?

Findings, all verified on 2026-09-28:

- **three.js has no 3MF exporter.** The `examples/jsm/exporters` directory on the `dev` branch contains exactly: DRACOExporter, EXRExporter, GLTFExporter, KTX2Exporter, OBJExporter, PLYExporter, STLExporter, USDZExporter [195]. There is a `3MFLoader` (import only) and an `AMFLoader` [195]. The request for an exporter has been open since March 2020 [201].
- **manifold-3d ships a 3MF exporter.** Version 3.5.4 contains `lib/export-3mf.js` (8.6 kB) and `lib/import-3mf.js`; the exporter's signature is `toArrayBuffer(doc: GLTFTransform.Document, options?: Export3MFOptions): Promise<ArrayBuffer>`, and the options carry a header with `unit` ('micron' | 'millimeter' | 'centimeter' | 'inch' | 'foot' | 'meter'), title, author, description and licence [167]. It supports components with transforms, several parts in one file, and multi-material trees, and sorts components topologically because PrusaSlicer and its descendants expect children before parents [167]. Its input is a glTF-Transform `Document`, not a `Manifold`: it is part of the ManifoldCAD layer, whose dependencies are `@gltf-transform/core`, `@gltf-transform/extensions`, `@gltf-transform/functions`, `@jscadui/3mf-export`, `fast-xml-parser` and `fflate` [167]. So it is usable, but it pulls glTF-Transform in as the intermediate representation.
- **`@jscadui/3mf-export`** 0.5.0, MIT, published 2023-11-22, 66 kB unpacked, zero dependencies [203][235]. It describes itself as a "3mf export MVP": functions that produce the XML strings, leaving the zip to the caller [203]. It is what Manifold's exporter builds on [167]. Small and stable, not actively developed.
- **`@jscad/3mf-serializer`** 2.1.17, MIT, published 2026-02-22, 27 kB unpacked [205][235]. Maintained as part of JSCAD, but it consumes JSCAD geometry objects, so using it means converting meshes to JSCAD's `geom3` first.
- **`three-3mf-exporter`** 45.2.0, MIT, published 2026-03-16, 22 kB unpacked [202][235]. A third-party exporter for three.js objects, extracted from the Bekuto3D app; it advertises multiple materials and colours and Bambu Studio compatible print settings [202]. Single maintainer; the version number is tied to the parent app. I did not test its output.
- **`@3mfconsortium/lib3mf`** 2.5.0-fix.2, BSD-2-Clause, published 2026-02-25, 2.4 MB unpacked [204][235]. The reference implementation compiled to WebAssembly, published by the 3MF Consortium; works in browsers through bundlers [204]. It covers the whole specification including extensions, at the cost of a megabyte-scale WASM download and a C++-style API.

**Verdict for 3MF: write it by hand, using `fflate` for the zip.** The core format is three small files in a zip (`[Content_Types].xml`, `_rels/.rels`, `3D/3dmodel.model`) [203], and the model file is a list of vertices, triangles, `basematerials`, objects and build items [168]. That is about 150 lines of TypeScript with no dependency other than the zip library, it takes Manifold's `Mesh` directly (so the indexed, manifold topology is written without loss), and per-component colour is one `basematerials` group with `pid`/`pindex` on each object [168]. Use `@jscadui/3mf-export` as the reference for the exact XML, and keep `@3mfconsortium/lib3mf` in reserve for the day an extension (beam lattice, slice, volumetric) is needed. One caution that is **unverified**: which slicers honour core-specification `basematerials` colours for multi-material assignment, as opposed to their own vendor metadata, differs between slicers; test with PrusaSlicer, Bambu Studio and Cura before promising "multi-material 3MF".

##### Other mesh writers

| Library | npm package | Version, date | Licence | Unpacked size | Status | Verdict |
|---|---|---|---|---|---|---|
| three.js STLExporter | `three` (addon) | 0.186.1, 2026-09-24 | MIT | 20.4 MB (whole package; addons are tree-shaken) | active | **write by hand**: binary STL is 84 bytes of header and 50 per triangle [169], about 30 lines, and writing from Manifold's mesh avoids building a three.js scene first. The exporter has one option, `binary`, default false [196]. |
| three.js OBJExporter | `three` | same | MIT | — | active | **avoid**: "not able to export material data into MTL files so only geometry data are supported", and children are merged into one mesh [197]. Write OBJ + MTL by hand (text formats, about 60 lines) if colour OBJ is wanted. |
| three.js PLYExporter | `three` | same | MIT | — | active | **wrap** (or write by hand): exports positions, colours, normals, uv; options `binary`, `littleEndian`, `excludeAttributes` [198]. |
| three.js GLTFExporter | `three` | same | MIT | — | active | **wrap** when the scene already lives in three.js, which it will for the viewport. |
| glTF-Transform | `@gltf-transform/core` | 4.5.0, 2026-09-01 | MIT | 976 kB | active | **wrap** if GLB is to be built without three.js, or post-processed (`weld`, `dedup`, `simplify`, `draco`, `meshopt`) [206]. Works on web, Node and Deno [206]. It is already a dependency of Manifold's ManifoldCAD layer [167]. |
| three.js USDZExporter | `three` | same | MIT | — | active | **wrap**, optional. `parseAsync(scene)` returns an ArrayBuffer; options include `quickLookCompatible`, `maxTextureSize`, `ar.anchoring.type` and `ar.planeAnchoring.alignment` [199]. Material limitations are not documented on the page [199]. |
| JSCAD serializers | `@jscad/stl-serializer` 2.1.23, `@jscad/obj-serializer` 2.1.23, `@jscad/x3d-serializer` 2.4.13, `@jscad/3mf-serializer` 2.1.17 | all 2026-02-22 | MIT | 18 to 37 kB each | active | **avoid** unless the geometry kernel is JSCAD: they take JSCAD geometries, not raw meshes. |
| JSCAD AMF | `@jscad/amf-serializer` | 2.1.23 | MIT | 28 kB | published | **avoid**, see below. |

**AMF: dead in practice?** The standard exists (ISO/ASTM 52915:2016, version 1.2) [207], three.js can load it [195] and JSCAD can write it [235]. What I could not find is a source that states its adoption level, so "dead" is my judgement and not a cited fact: 3MF covers the same ground (units, colour, materials), is what Manifold recommends [166], and is what current slicers exchange. **Do not implement AMF.**

**VRML / X3D.** three.js has a `VRMLLoader` but no VRML or X3D exporter [195]. `@jscad/x3d-serializer` exists [235]. These formats were the historical route to full-colour sandstone printing. I did not verify which services still require them. **Do not implement; PLY, OBJ+MTL and 3MF cover colour.**

#### 2.2 CAD B-rep: STEP and IGES

| Library | npm package | Version, date | Licence | Unpacked size | Status |
|---|---|---|---|---|---|
| OpenCascade.js | `opencascade.js` | `latest` tag 1.1.1; newest build 2.0.0-beta published 2023-03-23 | **LGPL-2.1-only** | 66.7 MB | no release since March 2023 [235]; the site's copyright line reads 2023 [208] |
| replicad | `replicad` | 1.1.0, 2026-09-04 | MIT | 5.9 MB | active |
| replicad's OCCT build | `replicad-opencascadejs` | 1.1.0, 2026-09-04 | **LGPL-2.1-only** | 48.9 MB | active |

OpenCascade.js is a port of the OpenCascade kernel to WebAssembly, with support for custom builds that ship only the needed parts [208]. replicad is a friendlier API over it and can export STEP and STL [135] (snippet only; the replicad documentation page failed to load during this session). A competing build claims about 4.5 MB brotli-compressed and says that is roughly half the size of opencascade.js [135], which puts the standard build near 9 MB compressed **(unverified, derived from a third party's claim)**.

**LGPL flag.** The WASM binary is LGPL-2.1. One project's reading is that the LGPL's requirement that users be able to replace the library is met by loading the `.wasm` from a URL [135]. That is a third party's interpretation, not legal advice.

**Is it worth it for mesh-born geometry? No.** Converting a triangle mesh to STEP wraps each triangle as a planar face and stitches them into a shell; the result is about 290 to 400 bytes per triangle (a 100,000-triangle mesh is near 29 MB), and it contains no sketches, dimensions, constraints or feature history, so CAD operations on it behave poorly [209] (snippet only). It is a STEP file in name and an STL in substance.

**What "CAD export" can honestly mean for this tool.** Three things, in decreasing order of value:

1. **Export the 2D profiles as DXF or SVG**, clean and closed, in millimetres, one file or layer per view. A CAD user imports the three profiles as sketches, extrudes each, and intersects them. This reproduces the shadow block as a true B-rep with a feature tree in about two minutes, and it is the only route that yields something editable. The tool should document this recipe and call the export "CAD profiles".
2. **Build the B-rep natively**, for the shadow-block genre only: the solid is by definition three extrusions and one Boolean, which OpenCascade can do on the vectorised outlines and write as real STEP with planar and ruled faces. This is a legitimate feature but it costs a multi-megabyte LGPL download and only works for genres that have a CAD construction. Make it a lazy-loaded optional module, if at all, and not in v1.
3. **Faceted STEP from the mesh.** Do not offer it. If a user needs it, mesh-to-STEP converters exist [209].

IGES is older and has no advantage over STEP here. Do not implement.

#### 2.3 2D vector formats

##### SVG

Hand-written. An SVG of silhouettes or slices is a list of `<path>` elements built from `CrossSection.toPolygons()` [167]; no library is needed, and writing it by hand is the only way to control the conventions of section 1.7 (stroke versus fill, colours, mm units, closed paths).

For a **drawing of the 3D object** (hidden-line projection):

- three.js `SVGRenderer` renders the scene to SVG but supports no advanced shading, no textures and no shadows, and sorts by depth (painter's algorithm) instead of removing hidden lines, so overlapping geometry shows artefacts [200]. It outputs one filled polygon per triangle. Usable for a flat-shaded vector picture, **not** for a line drawing a plotter or laser could follow.
- `three-edge-projection` (MIT, by the author of three-mesh-bvh) extracts the visible projected edges as flattened line segments and generates silhouettes through clipper2-js; its README names floor plans and DXF/SVG export as uses [210]. It depends on `three-mesh-bvh` and `clipper2-js` (Boost Software Licence, 1.2.4, last modified 2024-01-01 [235]). **I could not confirm its npm package name or version**: `npm view three-edge-projection` returned no `latest` tag. Treat it as a GitHub dependency until checked.
- For axis-aligned views, `Manifold.project()` gives the exact silhouette as polygons [167], which is all a shadow block's three principal views need.

Verdict: **write SVG by hand; use `Manifold.project()` and `slice()` as the geometry source; evaluate three-edge-projection only if a true hidden-line isometric drawing becomes a requirement.**

##### DXF

| Library | npm package | Version, date | Licence | Unpacked size | Status | Verdict |
|---|---|---|---|---|---|---|
| dxfjs writer | `@tarikjabiri/dxf` | 2.9.0, 2026-09-15 | MIT | 430 kB | active again (a search index still showed 2.8.9 as three years old; npm shows 2.9.0 this month) [211][235] | **wrap** if layers, units, blocks or hatches are needed. TypeScript. |
| dxf-writer | `dxf-writer` | 1.18.4, 2022-11-07 | MIT | 61 kB | dormant; "dead simple 2D DXF writer" [212] | acceptable; small; no releases in nearly four years |
| Maker.js | `makerjs` | 0.19.2, 2026-01-27 | Apache-2.0 | 1.1 MB | maintained by Microsoft, slow cadence | **avoid** as a dependency: it is a whole 2D modelling kernel (paths, models, chains, kerf offset, DXF/SVG/PDF export); too much for writing files |
| JSCAD DXF | `@jscad/dxf-serializer` | 2.1.23, 2026-02-22 | MIT | 72 kB | active | **avoid** unless on JSCAD geometry |
| `dxf` | `dxf` | 5.3.1, 2025-09-01 | MIT | 535 kB | — | it is a DXF **parser** and SVG converter, not a writer; listed to prevent confusion |

A laser-grade DXF needs only a header with `$INSUNITS`, a layer table, and closed `LWPOLYLINE` entities on named, coloured layers. That is about 80 lines by hand. **Verdict: write by hand for v1 (polylines only); move to `@tarikjabiri/dxf` if arcs, splines or hatches are needed.** Emit R12 or R2000-style ASCII for the widest compatibility; which DXF versions each laser tool accepts was **not verified**.

##### PDF

| Library | npm package | Version, date | Licence | Unpacked size | Status | Verdict |
|---|---|---|---|---|---|---|
| jsPDF | `jspdf` | 4.2.1, 2026-03-17 | MIT | 30.2 MB | active | **wrap** if PDF is needed; has vector path drawing; pair with `svg2pdf.js` (2.8.1, 2026-08-31, MIT) to convert the SVG the tool already writes |
| pdf-lib | `pdf-lib` | 1.17.1, 2021-11-06 | MIT | 19.5 MB | **unmaintained** since 2021 | **avoid** the original |
| pdf-lib fork | `@cantoo/pdf-lib` | 2.11.1, 2026-09-15 | MIT | 26.3 MB | active fork | use this if pdf-lib's API is preferred |

PDF is a secondary format here. LightBurn imports it [186], and it is the natural format for a printable "cut sheet" or assembly instructions. **Verdict: defer; when needed, jsPDF + svg2pdf.js, lazy-loaded.**

##### G-code

Out of scope; see section 1.7.

#### 2.4 Raster and animation

##### PNG

Native. `canvas.toBlob(cb, 'image/png')` on the WebGL canvas. Points to get right:

- **Transparent background:** create the renderer with `alpha: true` and clear with alpha 0; `preserveDrawingBuffer: true`, or call `toBlob` in the same task as the render, otherwise the buffer may already be cleared.
- **High resolution:** render to a separate render target or an `OffscreenCanvas` at the export size, not the on-screen canvas. OffscreenCanvas has full support in Chrome 69, Firefox 105 and Safari 17 [233]. Maximum size is bounded by the GPU's maximum texture and renderbuffer size; above that, render in tiles.
- These three points are general WebGL practice and were not checked against a specific source in this session.

##### GIF

| Library | npm package | Version, date | Licence | Unpacked size | Status | Quality | Verdict |
|---|---|---|---|---|---|---|---|
| gifenc | `gifenc` | 1.0.3, 2021-03-07 | MIT | 173 kB (README: 9 kB before gzip) | dormant but complete | PNN quantiser; per-frame or shared palette; **no dithering**, "best suited for simple flat-style vector graphics"; 150 frames of 1024 by 1024 in about 2.1 s with workers [215] | **wrap (default)**: flat-shaded renders of solid-colour objects are exactly its strength |
| modern-gif | `modern-gif` | 2.1.0, 2026-04-16 | MIT | 168 kB | active | encoder and decoder, palette of 2 to 255 colours, optional worker, TypeScript [216] | **wrap (alternative)**: choose it over gifenc if maintenance matters more than the smallest size |
| gif.js | `gif.js` | 0.2.0, 2016-12-06 | MIT | — | **unmaintained**: no release since 2016, 82 open issues [217][235] | several dithering modes, web workers [217] | **avoid** |
| gifski-wasm | `gifski-wasm` | 2.2.0, 2025-02-05 | **AGPL-3.0-or-later** | 705 kB | maintained | best available: cross-frame palettes and temporal dithering; multithreading needs SharedArrayBuffer and COOP/COEP headers, with a single-threaded fallback [218] | **avoid bundling**: AGPL obliges the whole application to be offered under AGPL terms if distributed or served. Acceptable only if the tool itself is AGPL, or as a user-installed optional plug-in. |

GIF is limited to 256 colours per frame and binary transparency, and files are large. It remains the format that plays everywhere without a player. For a turntable of a flat-coloured object, use one global palette computed from a few sample frames so that colours do not flicker between frames.

##### APNG and animated WebP

Both display in all current browsers: APNG since Chrome 59, Firefox 3, Safari 8; WebP including animation since Chrome 32, Firefox 65, Safari 16 [233]. Neither can be produced by `canvas.toBlob`, which writes single frames only.

- APNG: `upng-js` 2.1.0, MIT, published 2017-12-12, **unmaintained** [234][235]; depends on pako. It does encode APNG. APNG is lossless with full alpha, so a transparent turntable is possible, at a large file size.
- Animated WebP: several WASM builds of libwebp exist (`wasm-webp`, `webpxmux`) [234]. `@jsquash/webp` (1.5.0, Apache-2.0) is the best maintained WebP codec but I did not confirm that it writes animation. **None of these were evaluated in depth.**

**Verdict: defer both.** MP4 or WebM covers "small, good-looking animation", GIF covers "plays anywhere".

##### Video

| Approach | Package | Version, date | Licence | Unpacked size | Notes | Verdict |
|---|---|---|---|---|---|---|
| WebCodecs `VideoEncoder` + muxer | `mediabunny` | 1.60.0, 2026-09-25 | **MPL-2.0** | 10.8 MB (tree-shakable) | reads, writes and converts MP4, MOV, WebM, MKV and more; wraps WebCodecs; has a canvas source; successor to mp4-muxer and webm-muxer by the same author [223] | **wrap (default)** |
| older muxers | `mp4-muxer` 5.2.2, `webm-muxer` 5.1.4 | both 2025-07-02 | MIT | 156 kB, 148 kB | **deprecated on npm**: "This library is superseded by Mediabunny. Please migrate to it." [224][235] | **avoid** for new code; still work, tiny, MIT, if MPL is unwanted |
| MediaRecorder + `canvas.captureStream` | native | — | — | 0 | supported in Chrome 49, Firefox 29, Safari 14.1 [228]; realtime only; container and codec are the browser's choice | **fallback** |
| ffmpeg.wasm | `@ffmpeg/ffmpeg` 0.12.15 (wrapper, MIT) + `@ffmpeg/core` 0.12.10 (**GPL-2.0-or-later**) | both 2025-01-07 | MIT wrapper, GPL core | core 64.7 MB unpacked | single-thread and multi-thread cores; multi-thread is about twice as fast; WebAssembly is "a lot slower than native"; 2 GB file limit; the core follows FFmpeg's licences [225]. The multi-thread core needs SharedArrayBuffer, which needs COOP and COEP headers [226] | **avoid** |
| CCapture.js | `ccapture.js` | 2.0.0, 2026-07-27 | MIT | 671 kB, no runtime dependencies | **revived**: after 1.1.0 in April 2018, a complete rewrite was published in July 2026 with ES modules, WebCodecs, MP4 (H.264/AV1), WebM (VP8/VP9/AV1), image sequences, GIF, and a virtual clock that hooks `performance.now`, `requestAnimationFrame` and timers [219][235]. Its optional high-quality GIF encoder loads gifski-wasm (AGPL) lazily from a CDN and is not registered by default [219] | **do not need**: its purpose is to capture animations that run on wall-clock time. This tool controls its own render loop. Worth reading as a reference implementation. |

**MPL-2.0 flag for Mediabunny.** MPL is a file-level ("weak") copyleft: modifications to Mediabunny's own files must be published under MPL, but it can be combined with and bundled into code under other licences, including proprietary code. It is not GPL or LGPL. Noted because the brief asks for licence flags.

**GPL flag for ffmpeg.wasm.** `@ffmpeg/core` is GPL-2.0-or-later [235]. Shipping it makes the distributed application subject to the GPL. Together with a download in the tens of megabytes and the cross-origin isolation requirement for the fast build, that rules it out for a static, serverless page. COOP/COEP also cannot be set on some static hosts (GitHub Pages serves no custom headers), and cross-origin isolation breaks third-party embeds that do not send CORP headers.

##### WebCodecs browser support

From caniuse, read 2026-09-28 [221]:

| Browser | Full support from | Partial support from | Note |
|---|---|---|---|
| Chrome | 94 | — | |
| Edge | 94 | — | |
| Opera | 80 | — | |
| Samsung Internet | 17.0 | — | |
| Firefox desktop | 130 | — | |
| Firefox for Android | not supported (version 156 listed as no) | — | |
| Safari macOS | 26.0 | 16.4 | partial means video only, no audio codecs |
| Safari iOS | 26.0 | 16.4 | same |
| Chrome for Android | supported (current) | — | caniuse lists only the current version |

Global coverage: 91.0 % full, 3.5 % partial [221]. MDN still labels `VideoEncoder` "Limited availability", not Baseline; it requires a secure context and is available in dedicated workers [220]. Since a turntable has no audio, Safari 16.4's video-only support is sufficient, which leaves Firefox for Android as the one current browser with no support. Codec availability varies by platform, so call `VideoEncoder.isConfigSupported()` and fall back through H.264 (`avc1`), VP9, VP8 [220]. WebCodecs does no muxing: the encoder emits chunks with timestamps in microseconds and key-frame flags, and a muxer has to put them in a container [222].

##### Deterministic frame-by-frame rendering versus realtime capture

This is the most important design decision in the animation layer.

- **Realtime capture** (`MediaRecorder` on `canvas.captureStream(fps)`) records whatever the screen shows at whatever rate the machine achieves. Dropped frames, variable frame timing, tab throttling and thermal load all end up in the file, the export takes as long as the animation lasts, and resolution is tied to the canvas. `captureStream(0)` with `track.requestFrame()` gives manual control over *when* a frame is captured [227], but MediaRecorder still timestamps by wall clock, so it does not give frame-exact timing.
- **Deterministic rendering** treats the animation as a pure function `frame index -> scene state`. For a turntable, `angle = 2 * pi * i / N`. For each `i`: set state, render to an offscreen target at the export resolution, make `new VideoFrame(canvas, { timestamp: i * 1e6 / fps })`, call `encoder.encode(frame, { keyFrame: i % gop === 0 })`, close the frame, and wait when `encoder.encodeQueueSize` grows. The same code path feeds the GIF encoder with `readPixels` data. The result is identical on every machine, loops seamlessly (frame N equals frame 0, so write N frames, not N + 1), can be rendered at 4K on a laptop, and usually finishes faster than realtime.

**Verdict: deterministic rendering is the only mode to build. MediaRecorder is a fallback for browsers without WebCodecs, used with `captureStream(0)` and `requestFrame()`, and labelled as lower quality.** H.264 requires even width and height; round the export size.

#### 2.5 Saving files in the browser

| Mechanism | Package | Version, date | Licence | Unpacked size | Support | Verdict |
|---|---|---|---|---|---|---|
| `showSaveFilePicker` (File System Access API) | native | — | — | — | Chrome and Edge 105 full, 86 partial; **Firefox: no; Safari: no**; global 30.5 % [229] | use when present |
| `<a download>` + `URL.createObjectURL` | native | — | — | — | everywhere | the baseline |
| browser-fs-access | `browser-fs-access` | 0.38.0, 2025-06-18 | Apache-2.0 | 43 kB | uses the File System Access API where available and falls back to `<a download>` [229][230] | **wrap**, or write the 20-line equivalent |
| FileSaver.js | `file-saver` | 2.0.5, 2020-11-19 | MIT | 36 kB | — | **avoid**: unmaintained, and its workarounds target browsers that no longer exist |
| StreamSaver | `streamsaver` | 2.0.6 | MIT | 61 kB | last modified 2022 | **avoid**: relies on a service worker and a third-party hosted page |

Two cautions. The picker must be called inside a user gesture and in a secure context, and the handle should be obtained **before** the long-running export starts, otherwise the gesture has expired and the call throws [229]. And a Chrome documentation summary I read listed Firefox 111 and Safari 15.2 as supporting the API; that refers to the origin-private file system, not the save picker. caniuse is unambiguous that neither Firefox nor Safari implements the pickers [229].

##### Zip bundling

| Library | npm package | Version, date | Licence | Unpacked size | Notes | Verdict |
|---|---|---|---|---|---|---|
| fflate | `fflate` | 0.8.3, 2026-05-16 | MIT | 797 kB (README: 8 kB minified, 3 kB for decompression only) | sync, async (workers) and streaming zip; tree-shakable; up to 4 GB [231] | **wrap**: it is also needed for 3MF, and it is already a dependency of manifold-3d's ManifoldCAD layer [167] |
| JSZip | `jszip` | 3.10.2, 2026-09-08 | **dual: MIT OR GPL-3.0-or-later** | 693 kB | the long-standing default; larger and slower than fflate by fflate's own benchmarks [231] | acceptable; choose the MIT option explicitly; no reason to prefer it |
| client-zip | `client-zip` | 2.5.1, 2026-09-14 | MIT | 42 kB | streaming, store-only (no compression) | alternative for bundling already-compressed files (PNG, MP4, GLB) |

A zip is required whenever an export is more than one file: OBJ + MTL, a set of per-view DXF files, a stack of slice SVGs, an image sequence, or a "print pack" of 3MF + STL + preview PNG + a parameters JSON.

---

### Recommended stack for this layer

| Concern | Choice | npm package | Licence | Approach | Reason |
|---|---|---|---|---|---|
| Solid kernel and validation | Manifold | `manifold-3d` 3.5.4 | Apache-2.0 | wrap | manifold by construction; `status`, `volume`, `genus`, `decompose`, `slice`, `project`, `minGap` cover nearly every check |
| Thickness check (2D) | distance transform on masks | — | — | write by hand | exact, fast, points at the input the user can fix |
| Thickness and void check (3D) | voxel grid in a worker | — | — | write by hand | catches intersection slivers and trapped voids |
| Print format (default) | 3MF, millimetres, per-component colour | — (+ `fflate`) | MIT | write by hand | about 150 lines; preserves indexed topology; units and colour in the file |
| Print format (universal) | binary STL | — | — | write by hand | about 30 lines; size in file name and header |
| View and share format | GLB | `three` GLTFExporter, or `@gltf-transform/core` 4.5.0 | MIT | wrap | the viewport is already three.js |
| Vertex-colour mesh | PLY | `three` PLYExporter | MIT | wrap | standard vertex colour |
| OBJ + MTL | — | — | — | write by hand, low priority | three.js's exporter writes no materials |
| AR on iOS | USDZ | `three` USDZExporter | MIT | wrap, optional, lazy | only when AR is a feature |
| AMF, VRML, X3D, IGES, faceted STEP | — | — | — | do not implement | superseded or misleading |
| True STEP | replicad + OpenCascade | `replicad` 1.1.0 + `replicad-opencascadejs` | MIT + **LGPL-2.1** | defer; lazy optional module | large, LGPL, and only meaningful for genres with a CAD construction |
| "CAD export" in v1 | 2D profiles as DXF and SVG, plus a documented recipe | — | — | write by hand | the honest, editable route into CAD |
| SVG | silhouettes, slices, cut sheets | — | — | write by hand | full control of stroke, fill, colour and units |
| DXF | closed polylines on layers | — (later `@tarikjabiri/dxf` 2.9.0) | MIT | write by hand | about 80 lines |
| PDF | cut sheet, instructions | `jspdf` 4.2.1 + `svg2pdf.js` 2.8.1 | MIT | defer; wrap, lazy | reuses the SVG writer |
| Depth map | 8-bit and 16-bit greyscale PNG | — (16-bit encoder to be chosen) | — | write by hand | for LightBurn 3D Sliced and CNC relief |
| PNG stills | `canvas.toBlob` from an offscreen target | — | — | native | transparent, any resolution |
| GIF | gifenc (or modern-gif) | `gifenc` 1.0.3 / `modern-gif` 2.1.0 | MIT | wrap | small, fast, right for flat colours |
| Video | WebCodecs + Mediabunny, deterministic frames | `mediabunny` 1.60.0 | **MPL-2.0** | wrap | hardware encoding, MP4 and WebM, no server, no special headers |
| Video fallback | MediaRecorder + `captureStream(0)` | — | — | native | for browsers without WebCodecs |
| Avoid | ffmpeg.wasm, gifski-wasm, gif.js, pdf-lib (original), file-saver, mp4-muxer/webm-muxer for new code | — | **GPL-2.0**, **AGPL-3.0**, MIT (stale) | avoid | licence, size, headers, or no maintenance |
| Saving | File System Access API with anchor-download fallback | `browser-fs-access` 0.38.0 | Apache-2.0 | wrap (or 20 lines by hand) | picker works in Chromium only |
| Bundling | zip | `fflate` 0.8.3 | MIT | wrap | also the 3MF container |

Architectural note, in the terms of the project's own conventions: each exporter should be a pure function `(model, options) => Blob | Uint8Array`, registered in a table keyed by format identifier that also holds the extension, MIME type and a capability record (carries colour, carries units, carries multiple bodies). The UI builds its export menu from that table, and the heavy exporters (video, USDZ, PDF, STEP) are dynamic imports. The process profile (FDM, SLA, SLS/MJF, metal, laser) is likewise a data record of thresholds, not code.

---

### Printability checks the tool should run

Checks are grouped by when they run. "Blocker" prevents a valid export, "warning" is shown and can be overridden, "info" is reported. All thresholds are parameters of the process profile; the values below are proposed defaults.

#### Always, live (cheap)

- [ ] **Solid is non-empty.** `isEmpty()` is false and `volume()` is positive. Blocker.
- [ ] **Solid is valid.** `status()` reports no error. Blocker. By construction this holds when the solid is built inside Manifold.
- [ ] **Size is set and sane.** Longest bounding-box edge in mm, default 50 mm. Warning under 20 mm (X + Y + Z, from Shapeways [181]) and when larger than the selected profile's build volume (default 180 by 180 by 180 mm for a generic FDM bed; this default is my choice, not sourced).
- [ ] **Shadow consistency, per view.** Percentage of mask pixels missing from `project()` of the solid. Info under 1 %, warning from 1 %, strong warning from 5 %. Thresholds are my proposal; the concept is from Shadow Art [121].
- [ ] **2D minimum feature width, per mask.** Distance-transform or opening test at the profile's minimum wall. Warning, with the thin regions highlighted on the input image.
- [ ] **Connected components.** `decompose().length`. Info when 1; warning when more, with a list of volumes. Offer: drop components under 1 % of the largest component's volume, keep largest, add base plate, add struts, dilate masks.

#### On demand ("check printability"), in a worker

- [ ] **3D minimum thickness.** Voxel opening test at pitch no larger than a third of the minimum wall. Warning, with thin voxels highlighted.
- [ ] **Trapped voids.** Flood-fill of empty voxels from the boundary, or negative-volume shells in the mesh. Info for FDM; blocker for SLA, SLS, MJF and metal unless drain holes are added.
- [ ] **Drain holes present and large enough**, when hollowing is on. Minimum two holes; diameter per profile.
- [ ] **Base contact and stability.** Area of the mesh within one layer height of the lowest plane, as a fraction of the footprint: warning under 10 %. Centre of mass must project inside the convex hull of the contact area: warning otherwise. Both thresholds are my proposal.
- [ ] **Overhang area.** Fraction of surface area facing downward at more than the profile's angle from vertical. Info only, with the note that the slicer will add supports.
- [ ] **Genus.** Info. A sudden change of genus while a parameter is dragged is a useful signal that a thin bridge has appeared or vanished.
- [ ] **Triangle count and file size estimate.** Info; warning above 1,000,000 triangles (my proposal).

#### At export

- [ ] **Units written.** 3MF `unit="millimeter"`; STL with the size in the file name and header.
- [ ] **Up axis and scale converted** between the viewing convention (glTF: metres, +Y up) and the printing convention (millimetres, +Z up).
- [ ] **Vector exports:** every path closed; no text elements; stroke and fill per the operation map; dimensions in mm; cut features no narrower than 1 mm; kerf compensation stated in the file name when it is non-zero.
- [ ] **Re-validate the written mesh** by re-reading the 3MF or STL, welding vertices, and running the edge-manifold check. This guards against exporter bugs, which are otherwise found only by the slicer.

#### Proposed default thresholds by process profile

| Parameter | FDM, 0.4 mm nozzle | SLA / MSLA | SLS / MJF nylon | Metal (DMLS/SLM) | Laser cut sheet |
|---|---|---|---|---|---|
| Minimum wall | 0.9 mm (two perimeters) [171]; absolute floor 0.45 mm | 0.6 mm [175]; absolute floor 0.2 mm [178] | 0.8 mm [176]; 1.0 mm for unsupported wires [181] | 1.0 mm [184]; absolute floor 0.4 mm [177] | 1.0 mm between cut lines [190] |
| Minimum free-standing pin or wire | 2.0 mm (my proposal; Hubs says pins under 5 mm may fail [173]) | 0.6 mm [178] | 1.0 mm [181] | 1.0 mm [184] | — |
| Minimum embossed / engraved detail | 0.45 mm (one extrusion width) | 0.1 mm / 0.4 mm [175] | 1.0 mm / 1.0 mm [176] | 0.4 mm [177] | — |
| Minimum hole diameter | 2.0 mm (my proposal) | 0.8 mm [175] | 1.5 mm [176] | 1.5 mm [177] | — |
| Sealed cavity | allowed | blocker | blocker | blocker | — |
| Drain / escape hole | not applicable | 3.5 mm, at least 2 [175][179][180] | 4.0 mm for one, 2.0 mm each for several [181]; 5 mm for MJF [182] | avoid cavities | — |
| Hollow shell thickness | not applicable (use infill) | 2.0 mm [175] | 2.0 mm [183] | — | — |
| Overhang angle without support | 45° [173] | 19° from level for short overhangs [175]; supports are routine | none needed (powder supports the part) | 45° [184]; 50° per Hubs [177] | — |
| Maximum unsupported bridge | 5 mm [173] | 21 mm [175] | none | 2 mm [184] | — |
| Clearance between mating parts | 0.3 mm [171] | 0.5 mm [175] | 0.5 mm [181]; 0.7 mm for MJF moving parts [183] | not proposed | kerf-dependent |
| Dimensional tolerance to display | ±0.2 mm [171] | not stated in the sources read | ±0.3 mm or ±0.3 % [176] | ±0.1 to 0.2 mm [184] | — |
| Kerf | — | — | — | — | 0 by default; suggest 0.15 mm [192] |

---

### What could not be verified

- No first-party slicer documentation was found that describes, per defect type, what the slicer does with non-manifold edges, flipped normals or self-intersections. Prusa's page is general [170].
- No official Glowforge support page was retrieved; the stroke-is-cut, fill-is-engrave rule rests on the Glowforge community forum and third-party guides [188].
- Epilog/Trotec hairline and colour conventions come from a university lab guide seen as a search snippet [191], not from the manufacturers.
- Ponoko's colour and stroke conventions and the kerf ranges are search snippets [190][192]; the Ponoko help article I fetched contained no numbers.
- HP's own MJF design guide was not fetched; two republications were [182][183], and they differ on minimum wall.
- The replicad documentation page failed to load; its STEP export claim rests on a search snippet [135].
- The compressed size of the OpenCascade.js WASM build is inferred from a competitor's claim [135]. Only the npm unpacked size (66.7 MB) is first-hand [235].
- `three-edge-projection` was confirmed on GitHub [210] but not on npm.
- Which slicers honour 3MF core `basematerials` colours for multi-material assignment was not tested.
- Whether any maintained browser library writes animated WebP, and whether `upng-js` writes 16-bit greyscale PNG correctly, was not tested.
- Whether laser tools honour DXF `$INSUNITS`, and which DXF versions they accept, was not checked.
- AMF's low adoption is my judgement; no source stating it was found [207].
- The WebGL practices for transparent and high-resolution PNG capture were written from general knowledge, not from a fetched source.
- All "my proposal" thresholds in the checklist are engineering judgement, not sourced.
- No library was installed or run in this session. Every library verdict rests on registry metadata, READMEs and typings.

---

---

## REFERENCES

[1] [OpenCV: Image Thresholding tutorial (Markdown source)](https://github.com/opencv/opencv/blob/4.x/doc/py_tutorials/py_imgproc/py_thresholding/py_thresholding.markdown)

[2] [Wikipedia: Otsu's method](https://en.wikipedia.org/wiki/Otsu%27s_method)

[3] [scikit-image: Niblack and Sauvola Thresholding](https://scikit-image.org/docs/stable/auto_examples/segmentation/plot_niblack_sauvola.html)

[4] [Wikipedia: Chroma key](https://en.wikipedia.org/wiki/Chroma_key)

[5] [Wikipedia: Color difference](https://en.wikipedia.org/wiki/Color_difference)

[6] [Wikipedia: k-means clustering](https://en.wikipedia.org/wiki/K-means_clustering)

[7] [imgly/background-removal-js (GitHub)](https://github.com/imgly/background-removal-js)

[8] [npm registry: @imgly/background-removal](https://registry.npmjs.org/@imgly%2Fbackground-removal)

[9] [Transformers.js documentation](https://huggingface.co/docs/transformers.js/index)

[10] [Hugging Face: briaai/RMBG-1.4](https://huggingface.co/briaai/RMBG-1.4)

[11] [Hugging Face: briaai/RMBG-2.0](https://huggingface.co/briaai/RMBG-2.0)

[12] [Hugging Face: onnx-community/BiRefNet_lite-ONNX](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX)

[13] [Hugging Face: onnx-community/BiRefNet-ONNX](https://huggingface.co/onnx-community/BiRefNet-ONNX)

[14] [Hugging Face: Xenova/modnet](https://huggingface.co/Xenova/modnet)

[15] [Hugging Face: onnx-community/ISNet-ONNX](https://huggingface.co/onnx-community/ISNet-ONNX)

[16] [Hugging Face: onnx-community/ormbg-ONNX](https://huggingface.co/onnx-community/ormbg-ONNX)

[17] [Hugging Face: onnx-community/BEN2-ONNX](https://huggingface.co/onnx-community/BEN2-ONNX)

[18] [MediaPipe Image Segmenter guide](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter)

[19] [jsDelivr file listing: onnxruntime-web 1.30.0](https://data.jsdelivr.com/v1/packages/npm/onnxruntime-web@1.30.0?structure=flat)

[20] [TechStark/opencv-js (GitHub)](https://github.com/TechStark/opencv-js)

[21] [OpenCV: Build OpenCV.js (Markdown source)](https://github.com/opencv/opencv/blob/4.x/doc/js_tutorials/js_setup/js_setup/js_setup.markdown)

[22] [jsDelivr file listing: @techstark/opencv-js 5.0.0-release.1](https://data.jsdelivr.com/v1/packages/npm/@techstark/opencv-js@5.0.0-release.1?structure=flat)

[23] [image-js/image-js (GitHub)](https://github.com/image-js/image-js)

[24] [jimp-dev/jimp (GitHub)](https://github.com/jimp-dev/jimp)

[25] [kleisauke/wasm-vips (GitHub)](https://github.com/kleisauke/wasm-vips)

[26] [silvia-odwyer/photon (GitHub)](https://github.com/silvia-odwyer/photon)

[27] [Tamersoul/magic-wand-js (GitHub)](https://github.com/Tamersoul/magic-wand-js)

[28] [Wikipedia: Mathematical morphology](https://en.wikipedia.org/wiki/Mathematical_morphology)

[29] [Wikipedia: Distance transform](https://en.wikipedia.org/wiki/Distance_transform)

[30] [Felzenszwalb and Huttenlocher: Distance Transforms of Sampled Functions](https://cs.brown.edu/people/pfelzens/dt/)

[31] [Wikipedia: Signed distance function](https://en.wikipedia.org/wiki/Signed_distance_function)

[32] [Wikipedia: Connected-component labeling](https://en.wikipedia.org/wiki/Connected-component_labeling)

[33] [Wikipedia: Marching squares](https://en.wikipedia.org/wiki/Marching_squares)

[34] [d3-contour documentation: Contour polygons](https://d3js.org/d3-contour/contour)

[35] [Potrace home page](https://potrace.sourceforge.net/)

[36] [tomayac/esm-potrace-wasm (GitHub)](https://github.com/tomayac/esm-potrace-wasm)

[37] [tooolbox/node-potrace (GitHub)](https://github.com/tooolbox/node-potrace)

[38] [npm registry: ts-potrace](https://registry.npmjs.org/ts-potrace)

[39] [jankovicsandras/imagetracerjs (GitHub)](https://github.com/jankovicsandras/imagetracerjs)

[40] [visioncortex/vtracer (GitHub)](https://github.com/visioncortex/vtracer)

[41] [AlansCodeLog/vectortracer (GitHub)](https://github.com/AlansCodeLog/vectortracer)

[42] [jsscheller/vtracer-wasm (GitHub)](https://github.com/jsscheller/vtracer-wasm)

[43] [RaumZeit/MarchingSquares.js (GitHub)](https://github.com/RaumZeit/MarchingSquares.js)

[44] [mourner/simplify-js (GitHub)](https://github.com/mourner/simplify-js)

[45] [Wikipedia: Ramer–Douglas–Peucker algorithm](https://en.wikipedia.org/wiki/Ramer%E2%80%93Douglas%E2%80%93Peucker_algorithm)

[46] [Wikipedia: Visvalingam–Whyatt algorithm](https://en.wikipedia.org/wiki/Visvalingam%E2%80%93Whyatt_algorithm)

[47] [Chaikin's Algorithm lecture notes (UNC)](https://www.cs.unc.edu/~dm/UNC/COMP258/LECTURES/Chaikins-Algorithm.pdf)

[48] [Wikipedia: Centripetal Catmull–Rom spline](https://en.wikipedia.org/wiki/Centripetal_Catmull%E2%80%93Rom_spline)

[49] [Clipper2 documentation: Overview](https://www.angusj.com/clipper2/Docs/Overview.htm)

[50] [countertype/clipper2-ts (GitHub)](https://github.com/countertype/clipper2-ts)

[51] [ErikSom/Clipper2-WASM (GitHub)](https://github.com/ErikSom/Clipper2-WASM)

[52] [IRobot1/clipper2-ts, published as clipper2-js (GitHub)](https://github.com/IRobot1/clipper2-ts)

[53] [xaviergonz/js-angusj-clipper (GitHub)](https://github.com/xaviergonz/js-angusj-clipper)

[54] [mfogel/polygon-clipping (GitHub)](https://github.com/mfogel/polygon-clipping)

[55] [luizbarboza/polyclip-ts (GitHub)](https://github.com/luizbarboza/polyclip-ts)

[56] [w8r/martinez (GitHub)](https://github.com/w8r/martinez)

[57] [Paper.js reference: PathItem](https://paperjs.org/reference/pathitem/)

[58] [Manifold documentation: CrossSection class](https://manifoldcad.org/docs/html/classmanifold_1_1_cross_section.html)

[59] [elalish/manifold (GitHub)](https://github.com/elalish/manifold)

[60] [Can I use: HEIF/HEIC image format](https://caniuse.com/heif)

[61] [WebKit blog: WebKit Features in Safari 17.0](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/)

[62] [alexcorvi/heic2any (GitHub)](https://github.com/alexcorvi/heic2any)

[63] [hoppergee/heic-to (GitHub)](https://github.com/hoppergee/heic-to)

[64] [catdad-experiments/libheif-js (GitHub)](https://github.com/catdad-experiments/libheif-js)

[65] [strukturag/libheif (GitHub)](https://github.com/strukturag/libheif)

[66] [MDN: createImageBitmap()](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap)

[67] [three.js documentation: SVGLoader](https://threejs.org/docs/pages/SVGLoader.html)

[68] [rveciana/svg-path-properties (GitHub)](https://github.com/rveciana/svg-path-properties)

[69] [fontello/svgpath (GitHub)](https://github.com/fontello/svgpath)

[70] [nornagon/flatten-svg (GitHub)](https://github.com/nornagon/flatten-svg)

[71] [skymakerolof/dxf (GitHub)](https://github.com/skymakerolof/dxf)

[72] [gdsestimating/dxf-parser (GitHub)](https://github.com/gdsestimating/dxf-parser)

[73] [gdsestimating/three-dxf (GitHub)](https://github.com/gdsestimating/three-dxf)

[74] [LibreDWG/libredwg (GitHub)](https://github.com/LibreDWG/libredwg)

[75] [mlightcad/libredwg-web (GitHub)](https://github.com/mlightcad/libredwg-web)

[76] [steveruizok/perfect-freehand (GitHub)](https://github.com/steveruizok/perfect-freehand)

[77] [tldraw licence](https://github.com/tldraw/tldraw/blob/main/LICENSE.md)

[78] [Excalidraw documentation: Installation](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/installation)

[79] [Konva documentation: Free Drawing](https://konvajs.org/docs/sandbox/Free_Drawing.html)

[80] [Fabric.js](https://fabricjs.com/)

[81] [szimek/signature_pad (GitHub)](https://github.com/szimek/signature_pad)

[82] [MDN: PointerEvent.getCoalescedEvents()](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents)

[83] [MDN: PointerEvent.pressure](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/pressure)

[84] [npm registry JSON API (per package: registry.npmjs.org/PACKAGE)](https://registry.npmjs.org/)

[85] [Bundlephobia (per package: bundlephobia.com/package/PACKAGE)](https://bundlephobia.com/)

[86] [jsDelivr data API (per package file listings)](https://data.jsdelivr.com/v1/packages/npm/d3-contour@4.0.2?structure=flat)

[87] [OpenSCAD User Manual — Using the 2D Subsystem (linear_extrude, rotate_extrude)](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Using_the_2D_Subsystem)

[88] [OpenSCAD User Manual — Transformations (offset, minkowski, hull)](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Transformations)

[89] [OpenSCAD User Manual — WIP: Roof](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/WIP/Roof)

[90] [Manifold — TypeScript declarations for the WebAssembly bindings (manifold-encapsulated-types.d.ts)](https://raw.githubusercontent.com/elalish/manifold/master/bindings/wasm/manifold-encapsulated-types.d.ts)

[91] [Manifold — WebAssembly bindings README](https://github.com/elalish/manifold/blob/master/bindings/wasm/README.md)

[92] [Manifold — wiki: Manifold Library (algorithm and definitions)](https://github.com/elalish/manifold/wiki/Manifold-Library)

[93] [Manifold WASM Developer Guide — Using Manifold (installation, memory management)](https://manifoldcad.org/docs/jsapi/documents/Using_Manifold.html)

[94] [Manifold — discussion 383: Manifold Performance](https://github.com/elalish/manifold/discussions/383)

[95] [Manifold — issue 1849: WASM bindings fail under a Content-Security-Policy without 'unsafe-eval'](https://github.com/elalish/manifold/issues/1849)

[96] [Manifold — issue 1707: Add experimental boolean2 CrossSection backend (Clipper2 dependency)](https://github.com/elalish/manifold/issues/1707)

[97] [npm — manifold-3d](https://www.npmjs.com/package/manifold-3d)

[98] [CadQuery — Class Reference](https://cadquery.readthedocs.io/en/latest/classreference.html)

[99] [Autodesk Fusion Help — Extrude a solid body](https://help.autodesk.com/view/fusion360/ENU/?guid=SLD-EXTRUDE-SOLID)

[100] [Autodesk Fusion Help — Sweep a solid body](https://help.autodesk.com/view/fusion360/ENU/?contextId=MODEL-SWEEP-CMD)

[101] [Autodesk Fusion Help — Emboss a solid body](https://help.autodesk.com/view/fusion360/ENU/?contextId=SLD-EMBOSS)

[102] [Blender Manual — Screw Modifier](https://docs.blender.org/manual/en/latest/modeling/modifiers/generate/screw.html)

[103] [Blender Manual — Spin tool](https://docs.blender.org/manual/en/latest/modeling/meshes/tools/spin.html)

[104] [JSCAD — API documentation: modeling/extrusions](https://www.openjscad.xyz/docs/module-modeling_extrusions.html)

[105] [Bishop RL. There is More than One Way to Frame a Curve. The American Mathematical Monthly. 1975;82(3):246-251](https://www.tandfonline.com/doi/abs/10.1080/00029890.1975.11993807)

[106] [Wang W, Jüttler B, Zheng D, Liu Y. Computation of rotation minimizing frames. ACM Transactions on Graphics. 2008;27(1):Article 2](https://dl.acm.org/doi/10.1145/1330511.1330513)

[107] [Wikipedia — Frenet–Serret formulas](https://en.wikipedia.org/wiki/Frenet%E2%80%93Serret_formulas)

[108] [Igarashi T, Matsuoka S, Tanaka H. Teddy: a sketching interface for 3D freeform design. SIGGRAPH 1999 (ACM SIGGRAPH History Archives entry)](https://history.siggraph.org/learning/teddy-a-sketching-interface-for-3d-freeform-design-by-igarashi-matsuoka-and-tanaka/)

[109] [Joshi P, Carr NA. Repoussé: Automatic Inflation of 2D Artwork. Sketch-Based Interfaces and Modeling 2008 (Eurographics Digital Library)](https://diglib.eg.org/items/6c312948-5efc-4a33-bec2-4c2c28900659)

[110] [Wikipedia — Medial axis](https://en.wikipedia.org/wiki/Medial_axis)

[111] [Wikipedia — Straight skeleton](https://en.wikipedia.org/wiki/Straight_skeleton)

[112] [Wikipedia — Lithophane](https://en.wikipedia.org/wiki/Lithophane)

[113] [Quilez I. Distance functions (3D signed distance functions and operators)](https://iquilezles.org/articles/distfunctions/)

[114] [Wikipedia — Marching cubes](https://en.wikipedia.org/wiki/Marching_cubes)

[115] [Lysenko M. Smooth Voxel Terrain (Part 2). 0 FPS blog, 2012](https://0fps.net/2012/07/12/smooth-voxel-terrain-part-2/)

[116] [Ju T, Losasso F, Schaefer S, Warren J. Dual contouring of hermite data. SIGGRAPH 2002](https://dl.acm.org/doi/10.1145/566570.566586)

[117] [Wikipedia — Visual hull (with citation of Laurentini A. The visual hull concept for silhouette-based image understanding. IEEE TPAMI. 1994;16(2):150-162)](https://en.wikipedia.org/wiki/Visual_hull)

[118] [Kutulakos KN, Seitz SM. A Theory of Shape by Space Carving. International Journal of Computer Vision. 2000;38:199-218](https://link.springer.com/article/10.1023/A:1008191222954)

[119] [Mitra NJ, Pauly M. Shadow Art. ACM Transactions on Graphics. 2009;28(5):Article 156 (PDF)](https://www.cg.tuwien.ac.at/courses/CA/material/papers/ShadowArt.pdf)

[120] [Wolfram MathWorld — Trip-Let](https://mathworld.wolfram.com/Trip-Let.html)

[121] [Mitra NJ, Pauly M. Shadow art — ACM Digital Library record](https://dl.acm.org/doi/10.1145/1661412.1618502)

[122] [mrienstra/shadow-hull — GitHub repository](https://github.com/mrienstra/shadow-hull)

[123] [ijanos/ambi — GitHub repository (ambi3d.com)](https://github.com/ijanos/ambi)

[124] [printpal — Text Flip 3D Generator](https://printpal.io/tools/text-flip-generator)

[125] [2CATteam/AmbigramGenerator — GitHub repository](https://github.com/2CATteam/AmbigramGenerator)

[126] [Lucandia/dual_letter_illusion — GitHub repository (GPL-3.0)](https://github.com/Lucandia/dual_letter_illusion)

[127] [ondras/3 — GitHub repository (GEB shadow cube generator)](https://github.com/ondras/3)

[128] [Lyl3 — Customizable Triple Letter Blocks Ambigram (Thingiverse thing 3633456)](https://www.thingiverse.com/thing:3633456)

[129] [Ambigram Generator — ambigramgenerator.me](https://www.ambigramgenerator.me/)

[130] [three-bvh-csg — README](https://github.com/gkjohnson/three-bvh-csg)

[131] [three-csg-ts — README](https://github.com/samalexander/three-csg-ts)

[132] [csg.js (Evan Wallace) — README](https://github.com/evanw/csg.js)

[133] [@jscad/modeling — README](https://github.com/jscad/OpenJSCAD.org/tree/master/packages/modeling)

[134] [OpenCascade.js — GitHub repository](https://github.com/donalffons/opencascade.js)

[135] [replicad — documentation: replicad as a library](https://replicad.xyz/docs/use-as-a-library/)

[136] [OpenCascade.js — documentation: custom builds](https://ocjs.org/docs/app-dev-workflow/custom-builds)

[137] [CGAL — Licence](https://www.cgal.org/license.html)

[138] [Babylon.js Documentation — Merging Meshes (CSG2, InitializeCSG2Async)](https://doc.babylonjs.com/features/featuresDeepDive/mesh/mergeMeshes)

[139] [Babylon.js forum — Introducing: CSG2](https://forum.babylonjs.com/t/introducing-csg2/54274)

[140] [three.js manual — WebGPURenderer](https://threejs.org/manual/pages/webgpurenderer.html)

[141] [three.js docs — WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html)

[142] [three.js docs — MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html)

[143] [three.js docs — Material (clippingPlanes, clipIntersection, clipShadows)](https://threejs.org/docs/pages/Material.html)

[144] [three.js docs — WebGLRenderer (toneMapping, localClippingEnabled, transmissionResolutionScale)](https://threejs.org/docs/pages/WebGLRenderer.html)

[145] [three.js example — webgl clipping stencil](https://threejs.org/examples/webgl_clipping_stencil.html)

[146] [three.js docs — ShadowMaterial](https://threejs.org/docs/pages/ShadowMaterial.html)

[147] [drei — documentation sources: staging (ContactShadows, AccumulativeShadows, Environment)](https://github.com/pmndrs/drei/tree/master/docs/staging)

[148] [React Three Fiber — v9 Migration Guide](https://r3f.docs.pmnd.rs/tutorials/v9-migration-guide)

[149] [react-three-csg — GitHub repository](https://github.com/pmndrs/react-three-csg)

[150] [OpenSCAD — issue 5192: Make CGAL vs. Manifold configurable in Preferences](https://github.com/openscad/openscad/issues/5192)

[151] [three.js source — src/lights/DirectionalLightShadow.js](https://github.com/mrdoob/three.js/blob/dev/src/lights/DirectionalLightShadow.js)

[152] [npm — three-bvh-csg](https://www.npmjs.com/package/three-bvh-csg)

[153] [npm — three-csg-ts](https://www.npmjs.com/package/three-csg-ts)

[154] [npm — @jscad/modeling](https://www.npmjs.com/package/@jscad/modeling)

[155] [npm — opencascade.js](https://www.npmjs.com/package/opencascade.js)

[156] [npm — replicad](https://www.npmjs.com/package/replicad)

[157] [npm — replicad-opencascadejs](https://www.npmjs.com/package/replicad-opencascadejs)

[158] [npm — three](https://www.npmjs.com/package/three)

[159] [npm — @babylonjs/core](https://www.npmjs.com/package/@babylonjs/core)

[160] [npm — @react-three/fiber](https://www.npmjs.com/package/@react-three/fiber)

[161] [npm — @react-three/drei](https://www.npmjs.com/package/@react-three/drei)

[162] [npm — @sfcgal/sfcgal](https://www.npmjs.com/package/@sfcgal/sfcgal)

[163] [npm — potrace](https://www.npmjs.com/package/potrace)

[164] [npm — n8ao](https://www.npmjs.com/package/n8ao)

[165] [npm — postprocessing](https://www.npmjs.com/package/postprocessing)

[166] [Manifold README (elalish/manifold)](https://github.com/elalish/manifold#readme)

[167] [manifold-3d 3.5.4 on npm: typings and lib/export-3mf, lib/import-3mf, lib/export-model](https://cdn.jsdelivr.net/npm/manifold-3d@3.5.4/manifold.d.ts) and [package page](https://www.npmjs.com/package/manifold-3d)

[168] [3MF Core Specification (3MF Consortium)](https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md)

[169] [STL (file format) — Wikipedia](https://en.wikipedia.org/wiki/STL_(file_format))

[170] [Corrupted 3D models for printing — Prusa Knowledge Base](https://help.prusa3d.com/article/corrupted-3d-models-for-printing_2205)

[171] [Modeling with 3D printing in mind — Prusa Knowledge Base](https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135)

[172] [Elephant foot compensation — Prusa Knowledge Base](https://help.prusa3d.com/article/elephant-foot-compensation_114487)

[173] [How to design parts for FDM 3D printing — Protolabs Network (Hubs)](https://www.hubs.com/knowledge-base/how-design-parts-fdm-3d-printing/)

[174] [Key design considerations for 3D printing — Protolabs Network (Hubs)](https://www.hubs.com/knowledge-base/key-design-considerations-3d-printing/)

[175] [How to design parts for SLA 3D printing — Protolabs Network (Hubs)](https://www.hubs.com/knowledge-base/how-design-parts-sla-3d-printing/)

[176] [How to design parts for SLS 3D printing — Protolabs Network (Hubs)](https://www.hubs.com/knowledge-base/how-design-parts-sls-3d-printing/)

[177] [How to design parts for metal 3D printing — Protolabs Network (Hubs)](https://www.hubs.com/knowledge-base/how-design-parts-metal-3d-printing/)

[178] [Design specifications for 3D models (Form 4 generation) — Formlabs](https://formlabs.com/support/Design-specifications-for-3D-models-Form-4-generation/)

[179] [How to hollow out 3D models — Formlabs](https://formlabs.com/blog/how-to-hollow-out-3d-models/)

[180] [Hollowing — Prusa Knowledge Base](https://help.prusa3d.com/article/hollowing_117285)

[181] [Nylon 12 (PA12, Versatile Plastic) design guidelines — Shapeways](https://www.shapeways.com/materials/versatile-plastic)

[182] [MJF 3D printing design tips — Xometry Pro](https://xometry.pro/en/articles/mjf-design-guidelines/)

[183] [HP Multi Jet Fusion design guidelines — Proto3000](https://proto3000.com/service/3d-printing-services/materials/overview/design-guidelines/mjf-multi-jet-fusion-design-guidelines/)

[184] [Direct Metal Laser Sintering (DMLS) — Protolabs](https://www.protolabs.com/en-gb/services/3d-printing/direct-metal-laser-sintering/)

[185] [Computation of thickness and mechanical properties of interconnected structures (describes the Hildebrand and Rüegsegger local thickness algorithm) — Frontiers in Materials, 2019](https://www.frontiersin.org/journals/materials/articles/10.3389/fmats.2019.00327/pdf) and [Hildebrand and Rüegsegger, original paper record](https://www.researchgate.net/publication/229471011_A_New_Method_for_the_Model-Independent_Assessment_of_Thickness_in_Three-Dimensional_Images)

[186] [File Management — LightBurn Documentation](https://docs.lightburnsoftware.com/latest/Reference/FileManagement/)

[187] [3D Sliced Engravings — LightBurn User Guide](https://docs.lightburnsoftware.com/2.1/Guides/3DSlicedImage/)

[188] [Which colours for cut/engrave/score? — Glowforge Owners Forum](https://community.glowforge.com/t/which-colours-for-cut-engrave-score/23707) and [Glowforge Laser Cutter guide — Northern Arizona University Library](https://libraryguides.nau.edu/creating/Glowforge)

[189] [FAQs on Importing Images — xTool Support Center](https://support.xtool.com/article/544)

[190] [Interlocking 3D laser cut designs — Ponoko Help Center](https://help.ponoko.com/en/articles/4527166-interlocking-3d-laser-cut-designs) and [Ponoko Digital Fabrication Project Guide, laser-cutting edition (PDF)](https://www.ponoko.com/blog/wp-content/uploads/2011/02/Ponoko_Project_Guide_Laser_2_15_11.pdf)

[191] [How to prepare files for the Epilog Fusion M2 laser — SUNY New Paltz (PDF)](https://www.newpaltz.edu/media/dfl/2023%20File%20Preparation%20for%20the%20Epilog%20Laser%20Cutter.pdf)

[192] [What is kerf in laser cutting? — SendCutSend](https://sendcutsend.com/blog/what-is-kerf-in-laser-cutting/) and [Understanding laser kerf — CutLaserCut](https://cutlasercut.com/drawing-resources/expert-tips/laser-kerf/)

[193] [Kiri:Moto — Grid.Space](https://grid.space/kiri/)

[194] [Slicer for Fusion 360 tutorial: slice your 3D model — Sculpteo](https://www.sculpteo.com/en/prepare-your-file-laser-cutting/slicer-fusion-360-tutorial-prepare-your-file-laser-cutting/slice-your-3d-model/)

[195] [three.js examples/jsm/exporters directory, dev branch](https://github.com/mrdoob/three.js/tree/dev/examples/jsm/exporters)

[196] [STLExporter — three.js docs](https://threejs.org/docs/pages/STLExporter.html)

[197] [OBJExporter — three.js docs](https://threejs.org/docs/pages/OBJExporter.html)

[198] [PLYExporter — three.js docs](https://threejs.org/docs/pages/PLYExporter.html)

[199] [USDZExporter — three.js docs](https://threejs.org/docs/pages/USDZExporter.html)

[200] [SVGRenderer — three.js docs](https://threejs.org/docs/pages/SVGRenderer.html)

[201] [3MF exporter — three.js issue 18984](https://github.com/mrdoob/three.js/issues/18984)

[202] [three-3mf-exporter — npm](https://www.npmjs.com/package/three-3mf-exporter)

[203] [@jscadui/3mf-export — npm](https://www.npmjs.com/package/@jscadui/3mf-export)

[204] [@3mfconsortium/lib3mf — npm](https://www.npmjs.com/package/@3mfconsortium/lib3mf)

[205] [@jscad/3mf-serializer — npm](https://www.npmjs.com/package/@jscad/3mf-serializer)

[206] [glTF Transform](https://gltf-transform.dev/)

[207] [Additive manufacturing file format — Wikipedia](https://en.wikipedia.org/wiki/Additive_manufacturing_file_format)

[208] [OpenCascade.js](https://ocjs.org/)

[209] [mesh2step: faceted triangle-mesh to B-rep STEP converter](https://github.com/tommasobbianchi/mesh2step) and [STL to STEP — Xometry](https://www.xometry.com/resources/3d-printing/stl-to-step/)

[210] [three-edge-projection — GitHub](https://github.com/gkjohnson/three-edge-projection)

[211] [dxfjs/writer (@tarikjabiri/dxf) — GitHub](https://github.com/dxfjs/writer) and [npm](https://www.npmjs.com/package/@tarikjabiri/dxf)

[212] [dxf-writer — npm](https://www.npmjs.com/package/dxf-writer)

[213] [makerjs — npm](https://www.npmjs.com/package/makerjs)

[214] [jspdf — npm](https://www.npmjs.com/package/jspdf), [pdf-lib — npm](https://www.npmjs.com/package/pdf-lib), [@cantoo/pdf-lib — npm](https://www.npmjs.com/package/@cantoo/pdf-lib)

[215] [gifenc — GitHub](https://github.com/mattdesl/gifenc)

[216] [modern-gif — GitHub](https://github.com/qq15725/modern-gif)

[217] [gif.js — GitHub](https://github.com/jnordberg/gif.js)

[218] [gifski-wasm — GitHub](https://github.com/jamsinclair/gifski-wasm)

[219] [ccapture.js — GitHub](https://github.com/spite/ccapture.js)

[220] [VideoEncoder — MDN](https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder)

[221] [WebCodecs API — Can I use (data file)](https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/webcodecs.json) and [page](https://caniuse.com/webcodecs)

[222] [Video processing with WebCodecs — Chrome for Developers](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs)

[223] [Mediabunny — introduction](https://mediabunny.dev/guide/introduction)

[224] [mp4-muxer — npm (deprecation notice)](https://www.npmjs.com/package/mp4-muxer) and [webm-muxer — npm](https://www.npmjs.com/package/webm-muxer)

[225] [ffmpeg.wasm — overview](https://ffmpegwasm.netlify.app/docs/overview) and [FAQ](https://ffmpegwasm.netlify.app/docs/faq)

[226] [Shared Array Buffer — Can I use](https://caniuse.com/sharedarraybuffer)

[227] [HTMLCanvasElement.captureStream() — MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream)

[228] [MediaRecorder API — Can I use](https://caniuse.com/mediarecorder)

[229] [The File System Access API — Chrome for Developers](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access) and [File System Access API — Can I use](https://caniuse.com/native-filesystem-api)

[230] [browser-fs-access — npm](https://www.npmjs.com/package/browser-fs-access)

[231] [fflate — GitHub](https://github.com/101arrowz/fflate)

[232] [jszip — npm](https://www.npmjs.com/package/jszip)

[233] [OffscreenCanvas — Can I use](https://caniuse.com/offscreencanvas), [APNG — Can I use](https://caniuse.com/apng), [WebP — Can I use](https://caniuse.com/webp)

[234] [upng-js — npm](https://www.npmjs.com/package/upng-js), [wasm-webp — npm](https://www.npmjs.com/package/wasm-webp), [@jsquash/webp — npm](https://www.npmjs.com/package/@jsquash/webp)

[235] [npm registry, queried with `npm view` on 2026-09-28 for every package named in this report](https://www.npmjs.com/)
