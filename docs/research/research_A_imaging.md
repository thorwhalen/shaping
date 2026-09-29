# Research A — Image to bitonal mask to vector contours, in the browser

Date of research: 2026-09-28. Scope: the first layer of a browser-only TypeScript pipeline that turns an uploaded image (PNG, JPG, HEIC, SVG, DXF) or an in-app drawing into a clean foreground/background mask and then into polygons-with-holes suitable for extrusion or revolution.

## How to read this report

Every library row was checked against a live source on the research date. Version, publish date, licence and unpacked size come from the npm registry JSON API [84]. "min / gzip" bundle figures come from the Bundlephobia API [85]. Sizes of individual wasm or JS files come from the jsDelivr package-listing API [86], and the "gzip measured" figures are from downloading that file and compressing it locally with `gzip -6`, so they approximate transfer size but are not an official number. GitHub licence and last-push dates come from the GitHub REST API.

Statements marked **(analysis)** are my engineering reasoning, not something a source states. Statements marked **(not verified)** are things I could not confirm against a live source and should be treated as leads, not facts.

Verdict vocabulary: **wrap** (depend on it behind our own interface), **write by hand** (the algorithm is small enough that a dependency costs more than it saves), **optional** (lazy-loaded, off by default), **avoid**.

## 0. Executive summary

- The mask stage (threshold, 3x3 morphology, blur, connected components, hole filling, distance transform) should be written by hand on `ImageData` typed arrays. None of the general imaging libraries earns its download for this: OpenCV.js is a 13.3 MB single file (about 3.8 MB gzipped, measured) [22], and the others either lack the needed operations (Photon has thresholding but no morphology or labelling [26]) or need cross-origin isolation headers that a static host may not provide (wasm-vips [25]).
- Default binarisation should be a cascade, not a single algorithm: use the alpha channel when the image has one, otherwise Otsu on blurred luminance with automatic polarity, with manual threshold, colour-distance ("chroma key") and adaptive modes as user-selectable dials.
- Vectorisation should be marching squares on a smoothed scalar field (blurred mask or signed distance field), which gives sub-pixel contours and holes in one pass. `d3-contour` does exactly this in 3.2 kB gzipped under ISC [34].
- Potrace and every faithful port of it is GPL-2.0. `ts-potrace` declares MIT on npm but credits the GPL ports as its basis and its repository URL returns 404, so its licence claim should not be relied on.
- Clipper2 (Boost Software Licence) is the right engine for offsetting and boolean cleanup. If the 3D layer already ships `manifold-3d`, its `CrossSection` class provides the same operations with no extra download [58].
- HEIC needs a decoder everywhere except Safari 17+. All browser decoders are libheif builds and libheif is LGPL; `heic2any` carries an MIT label but has not been published since 2023.
- DXF is a realistic input format; DWG is not, because the only in-browser reader is GPL-3.0 and weighs 9.5 MB of wasm.
- For the drawing canvas, plain pointer events plus `perfect-freehand` (2 kB gzipped, MIT) is sufficient. tldraw's licence forbids production use without a key.

## 1. Thresholding for silhouette extraction

### 1.1 The algorithms

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

### 1.2 Why adaptive methods should not be the default (analysis)

This is reasoning rather than a cited fact. A silhouette for extrusion is normally a large solid region. Inside a uniform region that is bigger than the adaptive window, every pixel equals its local mean, so the classification is decided entirely by the sign of the constant C rather than by the image. The result is an outline with a hollow interior, which then needs hole filling to repair. Adaptive and Sauvola methods are therefore the right tool for line art, pencil sketches and photographed paper, and the wrong default for filled shapes.

### 1.3 Recommended default dials

A cascade, evaluated in order, with every step overridable:

1. **Alpha present?** If a meaningful share of pixels has alpha below 255, threshold alpha at 50 percent and ignore colour. This covers PNG cut-outs and the output of any background-removal step.
2. **Otherwise Otsu on luminance**, after a small Gaussian blur (the OpenCV example uses 5x5 [1]).
3. **Automatic polarity.** Decide which class is background by sampling the image border: the class that dominates the border is background. Expose an "invert" toggle. **(analysis)**
4. **Exposed dials:** manual threshold slider (initialised to the Otsu value), invert, mode selector (auto / alpha / luminance / colour-distance / adaptive / Sauvola), tolerance for colour-distance, window size and C for adaptive.
5. **Colour-distance mode** takes its reference colour from the border pixels by default and from a click (eyedropper) on request. Plain Euclidean distance in RGB is the cheapest option; a perceptual space is more uniform [5]. Start with RGB and measure before adding a colour-space conversion. **(analysis)**
6. **k-means** is not a binarisation default. It belongs to the "split into individually colourable components" feature: cluster into k colours, then each cluster is a mask that goes through the same pipeline.

All of these are a few dozen lines each over a `Uint8ClampedArray`. Verdict: **write by hand**.

### 1.4 ML background removal in the browser

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

## 2. Imaging libraries

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

## 3. Morphology and mask clean-up

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

## 4. Raster to vector

### 4.1 Tracers

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

### 4.2 Polyline simplification

| Library | npm package | Version, published | Licence | Size | Verdict |
|---|---|---|---|---|---|
| simplify-js | `simplify-js` | 1.2.4, 2020-02-03 [84] | BSD-2-Clause | 908 B min / 509 B gzip [85] | **wrap** or copy; finished software |
| simplify-ts | `simplify-ts` | 1.0.2, 2020-02-22 [84] | MIT | 14 kB unpacked | optional alternative |
| @turf/simplify | `@turf/simplify` | 7.4.0, 2026-08-03 [84] | MIT | 47 kB unpacked | avoid (GeoJSON overhead) |
| Visvalingam–Whyatt | — | — | — | — | **write by hand** |

Ramer–Douglas–Peucker removes points by maximum perpendicular distance [45]. Visvalingam–Whyatt ranks each point by the area of the triangle it forms with its neighbours and removes the least important first [46]. The relevant trade-off, from the Visvalingam article: it "will clean up sharp spikes that may be important" and applies uniform simplification so fine detail in mixed curves is eroded [46]. For organic silhouettes that smoothing bias is usually what is wanted; for mechanical shapes with sharp corners, RDP preserves corners better **(analysis)**. Offer tolerance as a dial and default to RDP.

Marching squares emits one vertex per crossed cell edge, so simplification is mandatory, not optional: an 1000-pixel outline otherwise becomes a thousand-sided prism wall **(analysis)**.

### 4.3 Curve smoothing

Chaikin's corner-cutting algorithm [47] and Catmull–Rom interpolation, preferably the centripetal form, which avoids cusps and self-intersections [48], are each a dozen lines. Verdict: **write by hand**. Chaikin shrinks the shape slightly and never overshoots; Catmull–Rom passes through the original points and can overshoot **(analysis)**. Because smoothing can introduce self-intersections, run the result through a Clipper2 union before handing it to the 3D layer **(analysis)**.

### 4.4 Polygon offsetting and 2D booleans

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

## 5. Input decoding

### 5.1 PNG and JPEG

Use the platform: `createImageBitmap` [66], draw onto a canvas (an `OffscreenCanvas` inside a worker), read `ImageData`. No library. Downscale very large photos to a working resolution before thresholding; the right cap needs measuring **(analysis)**.

### 5.2 HEIC

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

### 5.3 SVG

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

### 5.4 DXF and "standard 2D CAD formats"

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

## 6. In-app drawing canvas

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

### Recommendation for a simple black/white pen with variable width and shape primitives

**The drawing should be a vector document, rasterised only for display (analysis).** Store strokes and shapes as a list of objects. Each becomes a polygon: a freehand stroke via `perfect-freehand`, a rectangle or ellipse or regular polygon by direct construction, a straight line by offsetting its centreline. "Black" objects are unioned and "white" (eraser) objects are subtracted, in drawing order, using the 2D boolean engine. The result goes straight to extrusion with no thresholding or tracing, so drawn shapes keep exact edges and sharp corners.

Input handling is plain pointer events: `setPointerCapture` on pointer down, `getCoalescedEvents()` to recover the high-frequency samples the browser batches between frames [82], and `PointerEvent.pressure` for stylus width [83], with `simulatePressure` for mouse and touch. Set `touch-action: none` on the canvas so the browser does not scroll instead of drawing. Undo and redo fall out of the object list.

A raster fallback (paint to a canvas, then run the image pipeline) is simpler to build and gives a bucket-fill tool for free, but it reintroduces staircase edges and resolution dependence, so treat it as the fallback rather than the design **(analysis)**.

## 7. Architecture note: seams for this layer (analysis)

The stages are separable and each has an obvious replacement that already exists, so each is worth one keyword argument with a working default: `decode` (platform, else HEIC decoder), `segment` (the threshold cascade, else an ML matte), `trace` (marching squares, else another tracer), `simplify` (RDP, else Visvalingam), and `clip` (Clipper2 or Manifold CrossSection). The stable interchange types are a single-channel mask (`width`, `height`, `Uint8Array`) and a contour set (an array of polygons, each an outer ring plus hole rings, with a units field). Vector inputs (SVG, DXF, drawing) enter at the contour-set type and skip the raster stages entirely. Everything raster should run in a Web Worker.

## 8. Things I could not verify

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

## 9. Recommended stack for this layer

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
