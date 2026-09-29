# Research C — Physical embodiment, design-for-manufacturing, and export formats for a browser-only image-to-3D tool

Date of research: 2026-09-28. Scope: a browser-only (no backend) TypeScript tool that turns 2D images into parametrized 3D meshes ("shadow blocks" = Boolean intersection of three orthogonal silhouette extrusions, among other genres) for viewing, GIF/video, 3D printing and engraving.

## How to read this report

- Every factual claim carries a numbered reference to a page that was fetched or searched live during this session. Where a claim could only be confirmed through a search-result snippet, or not at all, it is marked **(unverified)** or **(snippet only)**.
- npm facts (version, licence, publish date, size) were read from the npm registry with `npm view` on 2026-09-28 [73]. "Size" is the npm **unpacked tarball size**, which is an upper bound and usually much larger than what ends up in a bundle. Minified/gzipped bundle sizes were not measured unless a project's own README states one.
- "Publish date" is the publish date of the version carrying the `latest` dist-tag.
- Numbers from manufacturer design guides disagree with each other, sometimes by a factor of five. That is expected: a printer maker quotes what the machine can do, a print service quotes what it will guarantee. The thresholds proposed at the end take the conservative (service) side.

---

# PART 1 — Physical embodiment and design for manufacturing

## 1.1 Manifold / watertight geometry

### What "manifold" means, operationally

The 3MF Core Specification gives the definition that matters in practice. For an object of type `model`: every triangle edge must share its two vertex endpoints with the edge of exactly one other triangle; adjacent triangles must have consistent orientation (the shared edge is traversed in opposite order by the two triangles); and all triangles must be oriented with normals pointing away from the interior [4]. The STL convention is the same in spirit: a unit facet normal pointing outward, vertices listed counter-clockwise seen from outside (right-hand rule), and the "vertex-to-vertex" rule that every edge is shared by exactly two faces without self-intersection [5].

Manifold (the library) adopts the 3MF definition deliberately, because it depends only on topology (integer indices), not on floating-point geometry, so the result of the check is not affected by rounding [1].

### What goes wrong downstream

| Defect | What it is | What the slicer does |
|---|---|---|
| Open (boundary) edge | an edge used by one triangle only: a hole | inside/outside is undefined along the slice; slicers attempt auto-repair and flag the model with a warning icon [6] |
| Non-manifold edge | an edge used by three or more triangles | same: cannot decide which side is solid; auto-repair is attempted, not guaranteed [6] |
| Flipped normals / inconsistent winding | triangles facing inward | violates the 3MF and STL orientation rules [4][5]; a whole shell with inverted orientation reads as a void (negative volume) |
| Self-intersection / overlapping shells | surface passes through itself | 3MF resolves overlap with the positive fill rule [4], so a consumer that implements the spec treats overlapping positive shells as a union; STL has no such rule [5] |
| Zero-thickness feature | two faces coincident, or a wall thinner than one extrusion/pixel | topologically valid but physically unprintable: "walls thinner than one nozzle perimeter are not printable" [7] |

Prusa's own knowledge base states that PrusaSlicer tries to repair automatically during slicing, that a warning symbol appears next to the model name, that "not all corrupted 3D models can be repaired automatically", and that the stronger repair ("Fix by the Netfabb") is Windows-only because it relies on a Microsoft API [6]. The design consequence is plain: **do not rely on the slicer to fix the mesh; export a mesh that is already valid.**

I could not find a first-party slicer document that describes, defect by defect, what each slicer does with each kind of bad mesh. The per-defect column above combines the specification rules [4][5] with Prusa's general statement [6]; treat the detailed behaviour as **(unverified)** beyond that.

### What the Manifold library guarantees

- "Our primary goal is reliability: guaranteed manifold output without caveats or edge cases." [2]
- The guarantee is manifold output **from manifold input** [1]. The Boolean produces manifold output even when the input is not ε-valid (that is, even when it is geometrically overlapping), but geometric validity then cannot be assured [1].
- ε-valid means there is a perturbation of the vertices, each by less than ε, under which the mesh is non-overlapping; the aim is ε-valid output from ε-valid input [1].
- It "cannot guarantee that all degenerate triangles (height < ε) are removed" [1].
- Coincident faces are handled by symbolic perturbation so that touching cubes merge, equal-height differences produce through-holes, and a mesh minus itself is empty [1]. This matters for shadow blocks, where the three extrusions share bounding planes exactly.
- The WASM build is single-threaded ("serial-only for now, but still fast") [2].
- Manifold's authors explicitly warn against STL: "when saving a manifold mesh to STL there is no guarantee that the re-imported mesh will still be manifold, as the topology is lost", and recommend 3MF, or glTF with the `EXT_mesh_manifold` extension when vertex properties are needed [2].
- Used by OpenSCAD, Blender, Godot and Babylon.js among others [2].

For this tool the important point is architectural: **if every solid is born inside Manifold (extrude a `CrossSection`, intersect, union a base plate) the mesh is manifold by construction and no repair step is needed.** Repair is only needed for meshes that come from somewhere else (marching cubes output, an imported STL).

### Validation checks available in the browser

All of these exist on the `Manifold` class in `manifold-3d` 3.5.4 (verified in the shipped typings [3]):

| Check | API | Meaning |
|---|---|---|
| Constructed successfully | `status()` | returns an `ErrorStatus`; constructing a `Manifold` from a non-manifold mesh reports a status rather than silently succeeding [3] |
| Non-empty | `isEmpty()`, `numTri()`, `numVert()`, `numEdge()` | an empty intersection is the first failure mode of a shadow block |
| Positive volume | `volume()` | sign and magnitude; near-zero volume means a degenerate result |
| Surface area | `surfaceArea()` | with volume, gives a compactness figure |
| Genus | `genus()` | number of handles; an unexpected genus signals through-holes |
| Connected components | `decompose()` | returns `Manifold[]`, one per topologically disconnected piece |
| Bounding box | `boundingBox()` | for the size dial and for bed-fit checks |
| Clearance between two solids | `minGap(other, searchLength)` | for multi-part clearance checks |
| Cross-section at height | `slice(height)` | returns a `CrossSection`; basis for stacked-layer export and per-layer checks |
| Silhouette | `project()` | returns a `CrossSection`; verifies that the shadow actually equals the input mask |
| Best-effort stitching of an imported mesh | `Mesh.merge()` | merges vertices along open edges within tolerance; "There is no guarantee the result will be manifold - this is a best-effort helper" [3] |

If a mesh is validated outside Manifold (for example on a three.js `BufferGeometry`), the checks to write by hand are: build an edge map keyed on the sorted vertex pair and require every edge to occur exactly twice, once in each direction (edge-manifoldness + closedness + consistent orientation in one pass); compute signed volume by the divergence theorem (sum of `dot(v0, cross(v1, v2)) / 6`) and require it to be positive; compute the Euler characteristic `V - E + F = 2 - 2g` per component to get the genus. These are standard results, not library features, and need welded (indexed) vertices first.

## 1.2 Minimum wall thickness and feature size by process

### Published numbers

| Process | Source | Min wall (supported / unsupported) | Min feature / pin / wire | Min detail (emboss / engrave) | Min hole | Escape / drain hole | Tolerance |
|---|---|---|---|---|---|---|---|
| FDM, 0.4 mm nozzle | Prusa [7] | 1 perimeter = 0.45 mm, 2 = 0.9 mm, 3 = 1.35 mm; thinner than one perimeter is not printable | — | — | — | not needed | at least ±0.2 mm; 0.3 mm clearance for moving parts |
| FDM | Hubs / Protolabs Network [9][10] | "wall thicknesses greater than 0.8 mm" print on all processes [10] | vertical pins below 5 mm diameter may fail [9] | — | vertical holes print undersized [9] | not needed | — |
| SLA | Formlabs, Form 4 generation [14] | 0.2 mm / 0.2 mm | vertical wire 0.3 mm (7 mm tall), 0.6 mm (30 mm tall) | 0.1 mm / 0.15 mm | 0.5 mm | 0.75 mm | clearance 0.4 mm |
| SLA | Hubs [11] | 0.4 mm / 0.6 mm | — | 0.1 mm high / 0.4 mm wide and deep | 0.8 mm | 3.5 mm, at least one per hollow section; hollow wall at least 2 mm | clearance 0.5 mm moving, 0.2 mm assembly |
| SLA (slicer) | PrusaSlicer hollowing [16] | minimum hollowing thickness 1 mm | — | — | — | at least two drainage holes | — |
| SLS PA12 | Hubs [12] | 0.8 mm (2.0 mm carbon-filled) | 0.8 mm | 1 mm / 1 mm; text at least 2 mm high | 1.5 mm | 3.5 mm | ±0.3 % with a floor of ±0.3 mm |
| SLS PA12 | Shapeways [17] | 0.7 mm / 0.7 mm (1.5 mm for the smooth finish) | wire 0.8 mm supported, 1.0 mm unsupported | 0.2 mm; 0.5 mm for text | — | 4.0 mm single, 2.0 mm each when multiple | ±0.15 mm + 0.15 % of longest dimension; clearance 0.5 mm; minimum bounding box X+Y+Z at least 20 mm |
| MJF PA12 | HP guidelines as republished by Proto3000 [19] | 0.3 mm in XY, 0.5 mm in Z for short walls; 2 mm recommended for hollow parts | cantilever under 1 mm wide: aspect ratio below 1:1 | — | — | — | clearance 0.4 mm assembly, 0.7 mm moving |
| MJF PA12 | Xometry [18] | 0.7 mm minimum, 1.3 mm preferred, 7 mm maximum | 0.5 mm | line 0.5 mm; emboss 1 mm high; engrave 0.5 mm deep; characters 2.5 mm | — | 5 mm, at least two on opposite sides | ±0.3 % (±0.3 mm) |
| Metal DMLS/SLM | Hubs [13] | 0.4 mm | 0.6 mm | 0.4 mm | 1.5 mm | — | ±0.1 mm; max overhang angle 50°; max aspect ratio 8:1; unsupported edge 0.5 mm |
| Metal DMLS | Protolabs [20] | walls under 1 mm need height:thickness below 40:1 | 1.0 mm | — | — | — | ±0.1 to ±0.2 mm + 0.005 mm/mm; unsupported bridge 2 mm |

Notes on this table. The Hubs FDM page itself does not state a minimum wall; the 0.8 mm figure comes from the general Hubs article [10]. The Formlabs drain-hole figure (0.75 mm) is the smallest hole that works at all; the 3.5 mm Hubs figure is the size at which resin actually drains in reasonable time, and is the one to use as a default. The two metal sources disagree on minimum feature (0.6 mm vs 1.0 mm); use the larger. I did not fetch HP's own PDF, only two republications of it [18][19].

### Measuring thickness

**Definition.** The accepted definition of local thickness is Hildebrand and Rüegsegger's: the local thickness at a point is the diameter of the largest sphere that lies completely inside the structure and contains the point [22]. It is computed from a distance transform: distance map, then distance ridge (a superset of the centres of maximal spheres), then the thickness map [22]. This is the algorithm behind the "Local Thickness" plugin in Fiji/ImageJ [22].

**Three places to measure, cheapest first.**

1. **On the 2D masks (recommended primary check).** A shadow block is the intersection of three extrusions, so any feature of the solid is no thicker, in the two in-plane directions of a given view, than the corresponding feature of that view's mask. Run a Euclidean distance transform on each binary mask; the local thickness in pixels is twice the distance value at the ridge. Convert with `mm_per_pixel = bbox_mm / mask_resolution`. The even simpler form is an erosion (morphological opening) test: open the mask with a disc of radius `t_min / 2`; any foreground pixels that disappear belong to features thinner than `t_min`. This is exact for the mask, fast enough to run on every parameter change, and lets the tool paint the thin regions red on the input image, which is where the user can fix them. Limitation: it is a necessary condition only. The intersection can be thinner than any single mask (two thick features crossing at a shallow overlap leave a sliver).
2. **On a voxel grid.** Voxelise the final solid at a pitch of about `t_min / 3` or finer, run a 3D distance transform, and apply the same local-thickness rule. This catches the slivers that the 2D test misses. Cost is memory: a 256-cubed grid is 16.7 million voxels, which is fine as a `Uint8Array` plus a `Float32Array` in a worker; 512-cubed is 134 million and is not. A voxel erosion test (open with a ball of radius `t_min / 2`, report lost volume) is cheaper than full local thickness and answers the yes/no question.
3. **On the mesh.** Ray-based ("shoot a ray inward along the negated normal and measure the distance to the first hit") using a BVH such as `three-mesh-bvh` (MIT, 0.9.15, 2026-09-09 [73]). It overestimates thickness at grazing angles and is sensitive to tessellation. Use it only if there is no voxel representation. An approximate alternative inside Manifold is offset-and-compare: there is no negative-offset operator on `Manifold`, but `CrossSection.offset` exists for 2D slices [3], so thickness can be tested slice by slice.

Recommendation: run (1) always and live; run (2) on demand ("check printability") in a worker; skip (3).

## 1.3 Disconnected and floating parts

### Why a Boolean intersection creates them

A voxel at (x, y, z) belongs to the shadow block only if its three projections all land on foreground pixels. A silhouette that is a single connected shape in each view can still produce several separate pieces in 3D, because connectivity in each 2D projection does not imply connectivity of the 3D intersection. And if any input mask itself has more than one component (the letters of a word, a dotted "i", the separate strokes of a stencil), the result is necessarily disconnected.

### What Mitra and Pauly did

Shadow Art [21] is the reference. Verified against the paper's PDF:

- The shadow hull is the intersection of the generalised cones of the shadow sources, computed on a binary voxel grid by a logical AND of the projected image pixels [21, section 2]. Input images were 250 by 250 in all examples but one [21, section 5].
- Their central problem is **inconsistency**, which is a different failure from disconnection: the shadow cast by the hull is smaller than the requested image, because some pixel of one image corresponds to a line of voxels that are all ruled out by the other images. "Inconsistency is the rule rather than the exception for more than two shadow sources" [21, section 2].
- Their remedy for inconsistency is to **deform the input images**, using as-rigid-as-possible shape manipulation driven by positional constraints derived from the least-cost voxel on each inconsistent pixel's line, applying only a fraction (0.25) of the displacement per iteration [21, section 3].
- On connectivity they are explicit that they did not solve it: "The optimization does not consider structural aspects such as connectedness of the shadow hull that might be important for a physical realization of the sculpture. However, we can ensure that no additional components will be created during the editing stage. If the input images are composed of multiple components, the shadow hull necessarily consists of disconnected pieces. In such cases, the 3D sculpture can be embedded in a transparent medium, as illustrated in Figure 9 and 13. Alternatively, transparent threads or other thin supporting elements can be added to create a stable configuration as shown in Figure 1." [21, section 5, Discussion and Limitations]
- They also added a pedestal for stability in the Lego example [21, figure 7], and their 3D print lost features "due to restrictions of the 3D printer" [21, figure 10].
- Fabrication path: voxel grid to triangle mesh by contouring, a few subdivision steps to smooth, then to a 3D printer [21, section 4].

So the honest summary is: Shadow Art fixes *wrong shadows* by warping the inputs, and handles *disconnected pieces* by embedding in a transparent block, by threads, or by a pedestal. It offers no automatic connectivity repair.

A second check worth taking from the paper: **shadow consistency**. After building the solid, project it back along each axis (`Manifold.project()` [3]) and compare with the input mask. Pixels in the mask but not in the projection are the inconsistent pixels. Report the percentage per view; this is the single most informative quality number for a shadow block.

### Detection

`Manifold.decompose()` returns one `Manifold` per connected component [3]; take `volume()` and `boundingBox()` of each. On a voxel grid, use 6-connected component labelling (6-connectivity, because voxels that touch only along an edge or at a corner are not a printable connection).

### Remedies, in the order the tool should offer them

1. **Warn and show.** Colour each component differently in the viewport and list them with volume and size. Always do this.
2. **Drop dust.** Remove components below a volume threshold (proposed default: below 1 % of the largest component's volume, or smaller than the minimum feature size in every dimension). Re-check shadow consistency afterwards, because the dropped piece may have been carrying part of a shadow.
3. **Keep largest only.** A one-click option; same re-check.
4. **Add a base plate.** A slab under the block that every component touching the bottom fuses to. It also gives a flat first layer. It does not help components that float above the bottom.
5. **Add struts or a frame.** Thin rods joining each floating component to its nearest neighbour or to the base. They alter the shadow; keep the diameter at the process minimum wire size and route them where they fall inside an existing shadow if possible.
6. **Thicken the 2D inputs.** Dilate the masks by a few pixels. This is the cheapest fix for near-misses and also helps wall thickness, at the cost of fidelity.
7. **Embed in a transparent medium** [21], that is, export the components as a multi-body file for a two-material print (opaque figure, clear matrix). Realistic only for PolyJet-class printers or casting in resin.
8. **Sprue / kit.** Attach loose parts to a sprue frame and print them as a kit to be assembled.

## 1.4 Internal cavities and trapped volumes

### Detection

A closed void inside a solid appears in the mesh as an additional closed shell whose orientation is inward, that is, whose signed volume computed on its own is negative, and which lies inside a positively oriented shell. Procedure on a mesh: split the triangle soup into edge-connected shells, compute signed volume per shell, flag every negative shell. Note that `Manifold.decompose()` splits by connectivity of the **solid**, so a solid with a bubble in it is one component whose mesh has two shells; the shell split has to be done on the output of `getMesh()` [3]. On a voxel grid: flood-fill the empty space from the grid boundary; any empty voxel not reached is a trapped void.

For shadow blocks specifically, a fully enclosed void is rare, because every empty voxel is empty by virtue of a whole line of sight being empty in at least one view, and that line reaches the outside. Enclosed voids become possible as soon as the tool adds other operations (hollowing, shells, union with a frame). The check is cheap enough to run regardless.

### Consequences by process

| Process | Sealed cavity | What is needed |
|---|---|---|
| FDM | printable; the slicer fills the interior with infill and nothing is trapped | nothing; a cavity only adds bridging inside |
| SLA / MSLA | uncured resin is trapped, and a hollow cup creates pressure differences ("cupping") that can cause a blowout [11][14] | drain holes: at least 3.5 mm diameter, at least one per hollow section [11]; Formlabs says one near the build platform plus at least one more [15]; PrusaSlicer says at least two [16]; Formlabs' absolute minimum is 0.75 mm [14] |
| SLS / MJF | unsintered powder is trapped; the part prints but stays full and heavy | escape holes: 3.5 mm minimum [12]; Shapeways 4.0 mm for a single hole or 2.0 mm each for several [17]; MJF 5 mm, at least two on opposite sides [18] |
| Metal powder bed | as SLS, plus internal supports that cannot be removed | avoid sealed cavities |

### Hollowing and infill

Hollowing saves material and, in resin printing, lowers peel forces [16]. Recommended shell thickness: at least 2 mm for SLA [11], 1 mm is PrusaSlicer's floor [16], 2 mm for MJF hollow parts [19]. For FDM, hollowing in the design tool is pointless because the slicer's infill setting does it better.

Recommendation: **the tool should not hollow by default.** Offer it as an option for resin and powder processes only, and when it is on, add drain holes automatically (two, on the bottom face and one other face, 3.5 mm default) and verify that every void is connected to the outside.

## 1.5 Overhangs, supports, orientation, bed adhesion, tolerances

| Topic | Rule | Source | Who should handle it |
|---|---|---|---|
| Overhang | 45° from vertical is the general limit without supports; Prusa quotes 45 to 60° depending on nozzle and settings, up to 75° on its newest machines | [9][7] | Tool can **report** the fraction of downward-facing area steeper than the threshold for the current orientation. Support generation belongs to the slicer. |
| Bridging | FDM bridges under 5 mm print without support; metal 2 mm; SLA horizontal span up to 29 mm (Formlabs) or 21 mm (Hubs) | [9][20][14][11] | Tool can report the longest unsupported horizontal span per layer, from `slice()`. Low priority. |
| Orientation | bottom face on the bed is flat and smooth; faces above supports are rough; FDM parts are weaker across layers | [7] | Tool should offer "which face is down" and pick the default that gives the largest flat contact area. For a shadow block with a base plate that is obvious. |
| Bed adhesion / flat base | — | — | Tool can compute the area of the mesh lying in the lowest plane (within one layer height) and warn when it is small relative to the footprint, or when the centre of mass projects outside the contact polygon (it will topple). |
| Elephant's foot | the first layer is squashed and prints wider; PrusaSlicer compensates by about 0.2 mm for a 0.4 mm nozzle, on by default in Prusa profiles; the design-side remedy is a 45° chamfer on edges touching the bed | [8][9] | Leave to the slicer. Optionally offer a small bottom chamfer on the base plate. |
| Tolerance and clearance | FDM ±0.2 mm, 0.3 mm clearance; SLS ±0.3 mm; SLA clearance 0.4 to 0.5 mm; MJF 0.4 to 0.7 mm | [7][12][14][11][19] | Matters only for multi-part assemblies (a block that sits in a separate base). Tool should apply a clearance parameter when it generates mating parts. |
| Shrinkage and warping | SLS 3 to 3.5 % shrinkage; MJF aspect ratios above 10:1 warp | [12][19] | Leave to the service. |

**What a design tool can usefully report:** validity (manifold, volume), size, component count, minimum thickness, trapped voids, shadow consistency, base contact and stability, and an overhang percentage for the chosen orientation. **What to leave to the slicer:** supports, infill, elephant's foot, seams, layer height, and everything that depends on a specific machine and material profile.

## 1.6 Units and scale

- STL carries no units: "STL files contain no scale information, and the units are arbitrary" [5]. three.js's STLExporter documentation repeats this [33]. In practice slicers assume millimetres, and a model authored in metres arrives a thousand times too small. That assumption is convention, not specification.
- 3MF has a `unit` attribute on the `model` element with values micron, millimeter, centimeter, inch, foot, meter; the default is millimeter [4].
- glTF is in metres with +Y up; 3MF is conventionally millimetres with +Z up. Manifold's own 3MF importer notes this and converts [3]. **An exporter that writes both GLB and 3MF from one scene must convert units and the up axis in one place.**
- AMF also carries units (millimetres default) [44].

Recommendations. The internal model is unitless and normalised (unit cube). One user-facing dial sets the **longest bounding-box edge in millimetres**, default 50 mm, with the resulting X, Y, Z sizes shown. Everything that depends on size (thickness checks, thresholds, base-plate height, strut diameter) is computed after scaling. STL is written in millimetres with the size stated in the file name and the 80-byte header (for example `shadowblock_50x50x50mm.stl`). 3MF is written with `unit="millimeter"` explicitly. A minimum-size warning is useful: Shapeways requires X+Y+Z of at least 20 mm for standard PA12 [17].

## 1.7 Engraving and cutting

### What the machines and their software accept

| Software / service | Imports | Notes |
|---|---|---|
| LightBurn | vector: AI, SVG, DXF, PDF, PLT/HPGL; raster: PNG, JPG, BMP, GIF, TIF | fonts must be installed or text converted to paths; G-code import loses speed and power; vector export carries graphics only, no cut settings [23] |
| xTool Creative Space | JPG, PNG, BMP, GIF, WEBP, SVG, DXF | vectors can be cut, scored or engraved; rasters can only be engraved; DXF paths with gaps are auto-closed within a tolerance [26] (snippet only) |
| Glowforge | SVG (and PDF, raster) | strokes become cuts or scores, fills become engraves; each distinct colour becomes a separate step; text must be converted to paths [25] (community and third-party sources only; **I did not retrieve an official Glowforge support page**) |
| Epilog / Trotec / Universal drivers | print-driver workflow from Illustrator, CorelDRAW, Inkscape | a stroke of 0.001 in (hairline) is a vector cut, anything thicker is rastered; colour must be RGB; pure red (255, 0, 0) is the usual cut colour [28] (snippet only, from a university lab guide, not from Epilog) |
| Ponoko (service) | SVG, DXF, AI | blue (#0000ff) 0.01 mm stroke means cut; red, green, magenta mean engrave [27] (snippet only) |

The conventions differ, so the exporter should not hard-code one. What is common to all of them:

- **Stroke means cut or score, fill means engrave.** Cut geometry must be unfilled paths (`fill="none"`), engrave geometry must be filled closed paths with no stroke.
- **One colour per operation.** Every tool above maps colours to operations or layers. The exporter should take an operation-to-colour map as a parameter, with a default of red `#ff0000` for cut, blue `#0000ff` for score, black `#000000` fill for engrave, and named presets for the services that differ (Ponoko's blue-is-cut [27]).
- **Hairline stroke.** Default stroke width 0.01 mm, parameterised.
- **Closed paths.** Fill operations need closed loops [23 via search]; emit `Z` on every contour and never rely on coincident endpoints.
- **No text elements.** Any text must be converted to outlines [23][25].
- **Real units.** Write the SVG with `width` and `height` in mm and a `viewBox` in the same numbers, so that one user unit is one millimetre. DXF has an `$INSUNITS` header variable for the same purpose; whether each importer honours it was **not verified**.

### Kerf

Kerf is the width of material removed by the beam, centred on the drawn line [27]. Published figures: CO2 lasers roughly 0.08 to 0.45 mm; about 0.16 mm is typical for hobby CO2 machines in 3 mm material; industrial services quote 0.25 to 0.5 mm [29] (snippet only). Every source insists the value be measured per material, thickness and setting. Ponoko warns that cut lines closer than 0.5 mm may burn away what lies between them and that features under 1 mm are fragile [27].

Tool behaviour: a `kerf` parameter in mm, default 0 (no compensation) with a suggested starting value of 0.15 mm; when it is non-zero, offset outer contours outward and hole contours inward by half the kerf, using `CrossSection.offset` from Manifold [3]. Do not compensate silently. Apply the 2D thickness test of section 1.2 to cut geometry with a 1 mm default minimum.

### Heightmap (greyscale depth) engraving

LightBurn's "3D Sliced" mode takes a greyscale depth map in which pixel brightness represents depth, engraves darker pixels with more passes (so darker is deeper, invertible with Negative Image), supports 16-bit depth maps from version 2.1, and is available on galvo lasers only [24]. LightBurn's Grayscale image mode on CO2 lasers varies power between a minimum and a maximum across the tonal range and can also produce variable depth [24 via search]. CNC relief carving uses the same kind of image.

This is an easy export for the tool: render the solid orthographically from above into a depth buffer, normalise to the depth range, and save as PNG. Offer both polarities, and offer 16-bit output (canvas `toBlob` gives 8-bit only; 16-bit greyscale PNG needs an encoder such as `upng-js` or a hand-written one). **Whether upng-js writes 16-bit greyscale correctly was not verified.**

### Stacked slices

Cutting a 3D object into parallel layers of sheet material and stacking them is an established technique: Autodesk's Slicer for Fusion 360 calls it "Stacked Slices" [31], and Kiri:Moto, a browser-based open-source slicer, has a laser mode that slices a 3D model and lays out the cross-sections for export to SVG or DXF [30] (snippet only). For this tool it is nearly free: `Manifold.slice(z)` at `z = (i + 0.5) * sheet_thickness` gives each layer as a `CrossSection` [3]. Add registration holes (two dowel holes at fixed positions through every layer), a layer number engraved on each piece, and a simple shelf packer to lay the pieces out on sheets. Report any layer that has more than one component, because its loose islands need the registration pins or a tab to stay in place.

### G-code

Out of scope. G-code is specific to machine, controller, material, tool and feed, and LightBurn, xTool Creative Space and Glowforge all generate it themselves from vectors [23][26][25]. The tool should stop at SVG, DXF and PNG.

---

# PART 2 — Export formats and the JS libraries that write them

## 2.1 Mesh formats

| Format | Geometry | Colour | Units | Multiple bodies / materials | Consumers | Notes |
|---|---|---|---|---|---|---|
| STL binary | triangle soup, no shared vertices | none in the standard; two incompatible vendor extensions [5] | none [5] | no | every slicer, every print service | 80-byte header + 50 bytes per triangle [5]; topology is lost [2] |
| STL ASCII | same | none | none | named `solid` blocks, poorly supported | same | several times larger; no reason to offer it except debugging |
| 3MF | indexed mesh, manifold by specification [4] | per-object and per-triangle via `basematerials` with `displaycolor` sRGB [4] | yes, default millimetre [4] | yes: objects, components, build items [4] | PrusaSlicer, Bambu Studio, Cura, OrcaSlicer, Windows 3D tools | a zip of XML; the right default for printing |
| OBJ (+MTL) | indexed mesh, polygons | per-material via MTL; per-vertex colour is a non-standard extension | none | groups and materials | general 3D tools, some full-colour print services | two files, so it must be zipped |
| PLY | indexed mesh | per-vertex colour, standard | none | no | MeshLab, Blender, scanning tools, some colour print services | simplest way to ship vertex colour |
| GLB / glTF 2.0 | indexed mesh, scene graph | PBR materials, vertex colour, textures | metres by specification | yes | web viewers, Blender, game engines, AR on Android | the right default for viewing and sharing |
| USDZ | mesh, scene graph | PBR materials, textures | metres | yes | Apple AR Quick Look | only needed for iOS AR |
| AMF | mesh, curved triangles | yes | yes [44] | yes | few | ISO/ASTM 52915:2016, last version 1.2 [44]; see below |
| VRML / X3D | mesh | per-vertex and per-face colour | metres by convention | yes | legacy full-colour printing, scientific tools | see below |

### 3MF: is there a maintained JS writer?

Findings, all verified on 2026-09-28:

- **three.js has no 3MF exporter.** The `examples/jsm/exporters` directory on the `dev` branch contains exactly: DRACOExporter, EXRExporter, GLTFExporter, KTX2Exporter, OBJExporter, PLYExporter, STLExporter, USDZExporter [32]. There is a `3MFLoader` (import only) and an `AMFLoader` [32]. The request for an exporter has been open since March 2020 [38].
- **manifold-3d ships a 3MF exporter.** Version 3.5.4 contains `lib/export-3mf.js` (8.6 kB) and `lib/import-3mf.js`; the exporter's signature is `toArrayBuffer(doc: GLTFTransform.Document, options?: Export3MFOptions): Promise<ArrayBuffer>`, and the options carry a header with `unit` ('micron' | 'millimeter' | 'centimeter' | 'inch' | 'foot' | 'meter'), title, author, description and licence [3]. It supports components with transforms, several parts in one file, and multi-material trees, and sorts components topologically because PrusaSlicer and its descendants expect children before parents [3]. Its input is a glTF-Transform `Document`, not a `Manifold`: it is part of the ManifoldCAD layer, whose dependencies are `@gltf-transform/core`, `@gltf-transform/extensions`, `@gltf-transform/functions`, `@jscadui/3mf-export`, `fast-xml-parser` and `fflate` [3]. So it is usable, but it pulls glTF-Transform in as the intermediate representation.
- **`@jscadui/3mf-export`** 0.5.0, MIT, published 2023-11-22, 66 kB unpacked, zero dependencies [40][73]. It describes itself as a "3mf export MVP": functions that produce the XML strings, leaving the zip to the caller [40]. It is what Manifold's exporter builds on [3]. Small and stable, not actively developed.
- **`@jscad/3mf-serializer`** 2.1.17, MIT, published 2026-02-22, 27 kB unpacked [42][73]. Maintained as part of JSCAD, but it consumes JSCAD geometry objects, so using it means converting meshes to JSCAD's `geom3` first.
- **`three-3mf-exporter`** 45.2.0, MIT, published 2026-03-16, 22 kB unpacked [39][73]. A third-party exporter for three.js objects, extracted from the Bekuto3D app; it advertises multiple materials and colours and Bambu Studio compatible print settings [39]. Single maintainer; the version number is tied to the parent app. I did not test its output.
- **`@3mfconsortium/lib3mf`** 2.5.0-fix.2, BSD-2-Clause, published 2026-02-25, 2.4 MB unpacked [41][73]. The reference implementation compiled to WebAssembly, published by the 3MF Consortium; works in browsers through bundlers [41]. It covers the whole specification including extensions, at the cost of a megabyte-scale WASM download and a C++-style API.

**Verdict for 3MF: write it by hand, using `fflate` for the zip.** The core format is three small files in a zip (`[Content_Types].xml`, `_rels/.rels`, `3D/3dmodel.model`) [40], and the model file is a list of vertices, triangles, `basematerials`, objects and build items [4]. That is about 150 lines of TypeScript with no dependency other than the zip library, it takes Manifold's `Mesh` directly (so the indexed, manifold topology is written without loss), and per-component colour is one `basematerials` group with `pid`/`pindex` on each object [4]. Use `@jscadui/3mf-export` as the reference for the exact XML, and keep `@3mfconsortium/lib3mf` in reserve for the day an extension (beam lattice, slice, volumetric) is needed. One caution that is **unverified**: which slicers honour core-specification `basematerials` colours for multi-material assignment, as opposed to their own vendor metadata, differs between slicers; test with PrusaSlicer, Bambu Studio and Cura before promising "multi-material 3MF".

### Other mesh writers

| Library | npm package | Version, date | Licence | Unpacked size | Status | Verdict |
|---|---|---|---|---|---|---|
| three.js STLExporter | `three` (addon) | 0.186.1, 2026-09-24 | MIT | 20.4 MB (whole package; addons are tree-shaken) | active | **write by hand**: binary STL is 84 bytes of header and 50 per triangle [5], about 30 lines, and writing from Manifold's mesh avoids building a three.js scene first. The exporter has one option, `binary`, default false [33]. |
| three.js OBJExporter | `three` | same | MIT | — | active | **avoid**: "not able to export material data into MTL files so only geometry data are supported", and children are merged into one mesh [34]. Write OBJ + MTL by hand (text formats, about 60 lines) if colour OBJ is wanted. |
| three.js PLYExporter | `three` | same | MIT | — | active | **wrap** (or write by hand): exports positions, colours, normals, uv; options `binary`, `littleEndian`, `excludeAttributes` [35]. |
| three.js GLTFExporter | `three` | same | MIT | — | active | **wrap** when the scene already lives in three.js, which it will for the viewport. |
| glTF-Transform | `@gltf-transform/core` | 4.5.0, 2026-09-01 | MIT | 976 kB | active | **wrap** if GLB is to be built without three.js, or post-processed (`weld`, `dedup`, `simplify`, `draco`, `meshopt`) [43]. Works on web, Node and Deno [43]. It is already a dependency of Manifold's ManifoldCAD layer [3]. |
| three.js USDZExporter | `three` | same | MIT | — | active | **wrap**, optional. `parseAsync(scene)` returns an ArrayBuffer; options include `quickLookCompatible`, `maxTextureSize`, `ar.anchoring.type` and `ar.planeAnchoring.alignment` [36]. Material limitations are not documented on the page [36]. |
| JSCAD serializers | `@jscad/stl-serializer` 2.1.23, `@jscad/obj-serializer` 2.1.23, `@jscad/x3d-serializer` 2.4.13, `@jscad/3mf-serializer` 2.1.17 | all 2026-02-22 | MIT | 18 to 37 kB each | active | **avoid** unless the geometry kernel is JSCAD: they take JSCAD geometries, not raw meshes. |
| JSCAD AMF | `@jscad/amf-serializer` | 2.1.23 | MIT | 28 kB | published | **avoid**, see below. |

**AMF: dead in practice?** The standard exists (ISO/ASTM 52915:2016, version 1.2) [44], three.js can load it [32] and JSCAD can write it [73]. What I could not find is a source that states its adoption level, so "dead" is my judgement and not a cited fact: 3MF covers the same ground (units, colour, materials), is what Manifold recommends [2], and is what current slicers exchange. **Do not implement AMF.**

**VRML / X3D.** three.js has a `VRMLLoader` but no VRML or X3D exporter [32]. `@jscad/x3d-serializer` exists [73]. These formats were the historical route to full-colour sandstone printing. I did not verify which services still require them. **Do not implement; PLY, OBJ+MTL and 3MF cover colour.**

## 2.2 CAD B-rep: STEP and IGES

| Library | npm package | Version, date | Licence | Unpacked size | Status |
|---|---|---|---|---|---|
| OpenCascade.js | `opencascade.js` | `latest` tag 1.1.1; newest build 2.0.0-beta published 2023-03-23 | **LGPL-2.1-only** | 66.7 MB | no release since March 2023 [73]; the site's copyright line reads 2023 [45] |
| replicad | `replicad` | 1.1.0, 2026-09-04 | MIT | 5.9 MB | active |
| replicad's OCCT build | `replicad-opencascadejs` | 1.1.0, 2026-09-04 | **LGPL-2.1-only** | 48.9 MB | active |

OpenCascade.js is a port of the OpenCascade kernel to WebAssembly, with support for custom builds that ship only the needed parts [45]. replicad is a friendlier API over it and can export STEP and STL [46] (snippet only; the replicad documentation page failed to load during this session). A competing build claims about 4.5 MB brotli-compressed and says that is roughly half the size of opencascade.js [46], which puts the standard build near 9 MB compressed **(unverified, derived from a third party's claim)**.

**LGPL flag.** The WASM binary is LGPL-2.1. One project's reading is that the LGPL's requirement that users be able to replace the library is met by loading the `.wasm` from a URL [46]. That is a third party's interpretation, not legal advice.

**Is it worth it for mesh-born geometry? No.** Converting a triangle mesh to STEP wraps each triangle as a planar face and stitches them into a shell; the result is about 290 to 400 bytes per triangle (a 100,000-triangle mesh is near 29 MB), and it contains no sketches, dimensions, constraints or feature history, so CAD operations on it behave poorly [47] (snippet only). It is a STEP file in name and an STL in substance.

**What "CAD export" can honestly mean for this tool.** Three things, in decreasing order of value:

1. **Export the 2D profiles as DXF or SVG**, clean and closed, in millimetres, one file or layer per view. A CAD user imports the three profiles as sketches, extrudes each, and intersects them. This reproduces the shadow block as a true B-rep with a feature tree in about two minutes, and it is the only route that yields something editable. The tool should document this recipe and call the export "CAD profiles".
2. **Build the B-rep natively**, for the shadow-block genre only: the solid is by definition three extrusions and one Boolean, which OpenCascade can do on the vectorised outlines and write as real STEP with planar and ruled faces. This is a legitimate feature but it costs a multi-megabyte LGPL download and only works for genres that have a CAD construction. Make it a lazy-loaded optional module, if at all, and not in v1.
3. **Faceted STEP from the mesh.** Do not offer it. If a user needs it, mesh-to-STEP converters exist [47].

IGES is older and has no advantage over STEP here. Do not implement.

## 2.3 2D vector formats

### SVG

Hand-written. An SVG of silhouettes or slices is a list of `<path>` elements built from `CrossSection.toPolygons()` [3]; no library is needed, and writing it by hand is the only way to control the conventions of section 1.7 (stroke versus fill, colours, mm units, closed paths).

For a **drawing of the 3D object** (hidden-line projection):

- three.js `SVGRenderer` renders the scene to SVG but supports no advanced shading, no textures and no shadows, and sorts by depth (painter's algorithm) instead of removing hidden lines, so overlapping geometry shows artefacts [37]. It outputs one filled polygon per triangle. Usable for a flat-shaded vector picture, **not** for a line drawing a plotter or laser could follow.
- `three-edge-projection` (MIT, by the author of three-mesh-bvh) extracts the visible projected edges as flattened line segments and generates silhouettes through clipper2-js; its README names floor plans and DXF/SVG export as uses [48]. It depends on `three-mesh-bvh` and `clipper2-js` (Boost Software Licence, 1.2.4, last modified 2024-01-01 [73]). **I could not confirm its npm package name or version**: `npm view three-edge-projection` returned no `latest` tag. Treat it as a GitHub dependency until checked.
- For axis-aligned views, `Manifold.project()` gives the exact silhouette as polygons [3], which is all a shadow block's three principal views need.

Verdict: **write SVG by hand; use `Manifold.project()` and `slice()` as the geometry source; evaluate three-edge-projection only if a true hidden-line isometric drawing becomes a requirement.**

### DXF

| Library | npm package | Version, date | Licence | Unpacked size | Status | Verdict |
|---|---|---|---|---|---|---|
| dxfjs writer | `@tarikjabiri/dxf` | 2.9.0, 2026-09-15 | MIT | 430 kB | active again (a search index still showed 2.8.9 as three years old; npm shows 2.9.0 this month) [49][73] | **wrap** if layers, units, blocks or hatches are needed. TypeScript. |
| dxf-writer | `dxf-writer` | 1.18.4, 2022-11-07 | MIT | 61 kB | dormant; "dead simple 2D DXF writer" [50] | acceptable; small; no releases in nearly four years |
| Maker.js | `makerjs` | 0.19.2, 2026-01-27 | Apache-2.0 | 1.1 MB | maintained by Microsoft, slow cadence | **avoid** as a dependency: it is a whole 2D modelling kernel (paths, models, chains, kerf offset, DXF/SVG/PDF export); too much for writing files |
| JSCAD DXF | `@jscad/dxf-serializer` | 2.1.23, 2026-02-22 | MIT | 72 kB | active | **avoid** unless on JSCAD geometry |
| `dxf` | `dxf` | 5.3.1, 2025-09-01 | MIT | 535 kB | — | it is a DXF **parser** and SVG converter, not a writer; listed to prevent confusion |

A laser-grade DXF needs only a header with `$INSUNITS`, a layer table, and closed `LWPOLYLINE` entities on named, coloured layers. That is about 80 lines by hand. **Verdict: write by hand for v1 (polylines only); move to `@tarikjabiri/dxf` if arcs, splines or hatches are needed.** Emit R12 or R2000-style ASCII for the widest compatibility; which DXF versions each laser tool accepts was **not verified**.

### PDF

| Library | npm package | Version, date | Licence | Unpacked size | Status | Verdict |
|---|---|---|---|---|---|---|
| jsPDF | `jspdf` | 4.2.1, 2026-03-17 | MIT | 30.2 MB | active | **wrap** if PDF is needed; has vector path drawing; pair with `svg2pdf.js` (2.8.1, 2026-08-31, MIT) to convert the SVG the tool already writes |
| pdf-lib | `pdf-lib` | 1.17.1, 2021-11-06 | MIT | 19.5 MB | **unmaintained** since 2021 | **avoid** the original |
| pdf-lib fork | `@cantoo/pdf-lib` | 2.11.1, 2026-09-15 | MIT | 26.3 MB | active fork | use this if pdf-lib's API is preferred |

PDF is a secondary format here. LightBurn imports it [23], and it is the natural format for a printable "cut sheet" or assembly instructions. **Verdict: defer; when needed, jsPDF + svg2pdf.js, lazy-loaded.**

### G-code

Out of scope; see section 1.7.

## 2.4 Raster and animation

### PNG

Native. `canvas.toBlob(cb, 'image/png')` on the WebGL canvas. Points to get right:

- **Transparent background:** create the renderer with `alpha: true` and clear with alpha 0; `preserveDrawingBuffer: true`, or call `toBlob` in the same task as the render, otherwise the buffer may already be cleared.
- **High resolution:** render to a separate render target or an `OffscreenCanvas` at the export size, not the on-screen canvas. OffscreenCanvas has full support in Chrome 69, Firefox 105 and Safari 17 [71]. Maximum size is bounded by the GPU's maximum texture and renderbuffer size; above that, render in tiles.
- These three points are general WebGL practice and were not checked against a specific source in this session.

### GIF

| Library | npm package | Version, date | Licence | Unpacked size | Status | Quality | Verdict |
|---|---|---|---|---|---|---|---|
| gifenc | `gifenc` | 1.0.3, 2021-03-07 | MIT | 173 kB (README: 9 kB before gzip) | dormant but complete | PNN quantiser; per-frame or shared palette; **no dithering**, "best suited for simple flat-style vector graphics"; 150 frames of 1024 by 1024 in about 2.1 s with workers [53] | **wrap (default)**: flat-shaded renders of solid-colour objects are exactly its strength |
| modern-gif | `modern-gif` | 2.1.0, 2026-04-16 | MIT | 168 kB | active | encoder and decoder, palette of 2 to 255 colours, optional worker, TypeScript [54] | **wrap (alternative)**: choose it over gifenc if maintenance matters more than the smallest size |
| gif.js | `gif.js` | 0.2.0, 2016-12-06 | MIT | — | **unmaintained**: no release since 2016, 82 open issues [55][73] | several dithering modes, web workers [55] | **avoid** |
| gifski-wasm | `gifski-wasm` | 2.2.0, 2025-02-05 | **AGPL-3.0-or-later** | 705 kB | maintained | best available: cross-frame palettes and temporal dithering; multithreading needs SharedArrayBuffer and COOP/COEP headers, with a single-threaded fallback [56] | **avoid bundling**: AGPL obliges the whole application to be offered under AGPL terms if distributed or served. Acceptable only if the tool itself is AGPL, or as a user-installed optional plug-in. |

GIF is limited to 256 colours per frame and binary transparency, and files are large. It remains the format that plays everywhere without a player. For a turntable of a flat-coloured object, use one global palette computed from a few sample frames so that colours do not flicker between frames.

### APNG and animated WebP

Both display in all current browsers: APNG since Chrome 59, Firefox 3, Safari 8; WebP including animation since Chrome 32, Firefox 65, Safari 16 [71]. Neither can be produced by `canvas.toBlob`, which writes single frames only.

- APNG: `upng-js` 2.1.0, MIT, published 2017-12-12, **unmaintained** [72][73]; depends on pako. It does encode APNG. APNG is lossless with full alpha, so a transparent turntable is possible, at a large file size.
- Animated WebP: several WASM builds of libwebp exist (`wasm-webp`, `webpxmux`) [72]. `@jsquash/webp` (1.5.0, Apache-2.0) is the best maintained WebP codec but I did not confirm that it writes animation. **None of these were evaluated in depth.**

**Verdict: defer both.** MP4 or WebM covers "small, good-looking animation", GIF covers "plays anywhere".

### Video

| Approach | Package | Version, date | Licence | Unpacked size | Notes | Verdict |
|---|---|---|---|---|---|---|
| WebCodecs `VideoEncoder` + muxer | `mediabunny` | 1.60.0, 2026-09-25 | **MPL-2.0** | 10.8 MB (tree-shakable) | reads, writes and converts MP4, MOV, WebM, MKV and more; wraps WebCodecs; has a canvas source; successor to mp4-muxer and webm-muxer by the same author [61] | **wrap (default)** |
| older muxers | `mp4-muxer` 5.2.2, `webm-muxer` 5.1.4 | both 2025-07-02 | MIT | 156 kB, 148 kB | **deprecated on npm**: "This library is superseded by Mediabunny. Please migrate to it." [62][73] | **avoid** for new code; still work, tiny, MIT, if MPL is unwanted |
| MediaRecorder + `canvas.captureStream` | native | — | — | 0 | supported in Chrome 49, Firefox 29, Safari 14.1 [66]; realtime only; container and codec are the browser's choice | **fallback** |
| ffmpeg.wasm | `@ffmpeg/ffmpeg` 0.12.15 (wrapper, MIT) + `@ffmpeg/core` 0.12.10 (**GPL-2.0-or-later**) | both 2025-01-07 | MIT wrapper, GPL core | core 64.7 MB unpacked | single-thread and multi-thread cores; multi-thread is about twice as fast; WebAssembly is "a lot slower than native"; 2 GB file limit; the core follows FFmpeg's licences [63]. The multi-thread core needs SharedArrayBuffer, which needs COOP and COEP headers [64] | **avoid** |
| CCapture.js | `ccapture.js` | 2.0.0, 2026-07-27 | MIT | 671 kB, no runtime dependencies | **revived**: after 1.1.0 in April 2018, a complete rewrite was published in July 2026 with ES modules, WebCodecs, MP4 (H.264/AV1), WebM (VP8/VP9/AV1), image sequences, GIF, and a virtual clock that hooks `performance.now`, `requestAnimationFrame` and timers [57][73]. Its optional high-quality GIF encoder loads gifski-wasm (AGPL) lazily from a CDN and is not registered by default [57] | **do not need**: its purpose is to capture animations that run on wall-clock time. This tool controls its own render loop. Worth reading as a reference implementation. |

**MPL-2.0 flag for Mediabunny.** MPL is a file-level ("weak") copyleft: modifications to Mediabunny's own files must be published under MPL, but it can be combined with and bundled into code under other licences, including proprietary code. It is not GPL or LGPL. Noted because the brief asks for licence flags.

**GPL flag for ffmpeg.wasm.** `@ffmpeg/core` is GPL-2.0-or-later [73]. Shipping it makes the distributed application subject to the GPL. Together with a download in the tens of megabytes and the cross-origin isolation requirement for the fast build, that rules it out for a static, serverless page. COOP/COEP also cannot be set on some static hosts (GitHub Pages serves no custom headers), and cross-origin isolation breaks third-party embeds that do not send CORP headers.

### WebCodecs browser support

From caniuse, read 2026-09-28 [59]:

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

Global coverage: 91.0 % full, 3.5 % partial [59]. MDN still labels `VideoEncoder` "Limited availability", not Baseline; it requires a secure context and is available in dedicated workers [58]. Since a turntable has no audio, Safari 16.4's video-only support is sufficient, which leaves Firefox for Android as the one current browser with no support. Codec availability varies by platform, so call `VideoEncoder.isConfigSupported()` and fall back through H.264 (`avc1`), VP9, VP8 [58]. WebCodecs does no muxing: the encoder emits chunks with timestamps in microseconds and key-frame flags, and a muxer has to put them in a container [60].

### Deterministic frame-by-frame rendering versus realtime capture

This is the most important design decision in the animation layer.

- **Realtime capture** (`MediaRecorder` on `canvas.captureStream(fps)`) records whatever the screen shows at whatever rate the machine achieves. Dropped frames, variable frame timing, tab throttling and thermal load all end up in the file, the export takes as long as the animation lasts, and resolution is tied to the canvas. `captureStream(0)` with `track.requestFrame()` gives manual control over *when* a frame is captured [65], but MediaRecorder still timestamps by wall clock, so it does not give frame-exact timing.
- **Deterministic rendering** treats the animation as a pure function `frame index -> scene state`. For a turntable, `angle = 2 * pi * i / N`. For each `i`: set state, render to an offscreen target at the export resolution, make `new VideoFrame(canvas, { timestamp: i * 1e6 / fps })`, call `encoder.encode(frame, { keyFrame: i % gop === 0 })`, close the frame, and wait when `encoder.encodeQueueSize` grows. The same code path feeds the GIF encoder with `readPixels` data. The result is identical on every machine, loops seamlessly (frame N equals frame 0, so write N frames, not N + 1), can be rendered at 4K on a laptop, and usually finishes faster than realtime.

**Verdict: deterministic rendering is the only mode to build. MediaRecorder is a fallback for browsers without WebCodecs, used with `captureStream(0)` and `requestFrame()`, and labelled as lower quality.** H.264 requires even width and height; round the export size.

## 2.5 Saving files in the browser

| Mechanism | Package | Version, date | Licence | Unpacked size | Support | Verdict |
|---|---|---|---|---|---|---|
| `showSaveFilePicker` (File System Access API) | native | — | — | — | Chrome and Edge 105 full, 86 partial; **Firefox: no; Safari: no**; global 30.5 % [67] | use when present |
| `<a download>` + `URL.createObjectURL` | native | — | — | — | everywhere | the baseline |
| browser-fs-access | `browser-fs-access` | 0.38.0, 2025-06-18 | Apache-2.0 | 43 kB | uses the File System Access API where available and falls back to `<a download>` [67][68] | **wrap**, or write the 20-line equivalent |
| FileSaver.js | `file-saver` | 2.0.5, 2020-11-19 | MIT | 36 kB | — | **avoid**: unmaintained, and its workarounds target browsers that no longer exist |
| StreamSaver | `streamsaver` | 2.0.6 | MIT | 61 kB | last modified 2022 | **avoid**: relies on a service worker and a third-party hosted page |

Two cautions. The picker must be called inside a user gesture and in a secure context, and the handle should be obtained **before** the long-running export starts, otherwise the gesture has expired and the call throws [67]. And a Chrome documentation summary I read listed Firefox 111 and Safari 15.2 as supporting the API; that refers to the origin-private file system, not the save picker. caniuse is unambiguous that neither Firefox nor Safari implements the pickers [67].

### Zip bundling

| Library | npm package | Version, date | Licence | Unpacked size | Notes | Verdict |
|---|---|---|---|---|---|---|
| fflate | `fflate` | 0.8.3, 2026-05-16 | MIT | 797 kB (README: 8 kB minified, 3 kB for decompression only) | sync, async (workers) and streaming zip; tree-shakable; up to 4 GB [69] | **wrap**: it is also needed for 3MF, and it is already a dependency of manifold-3d's ManifoldCAD layer [3] |
| JSZip | `jszip` | 3.10.2, 2026-09-08 | **dual: MIT OR GPL-3.0-or-later** | 693 kB | the long-standing default; larger and slower than fflate by fflate's own benchmarks [69] | acceptable; choose the MIT option explicitly; no reason to prefer it |
| client-zip | `client-zip` | 2.5.1, 2026-09-14 | MIT | 42 kB | streaming, store-only (no compression) | alternative for bundling already-compressed files (PNG, MP4, GLB) |

A zip is required whenever an export is more than one file: OBJ + MTL, a set of per-view DXF files, a stack of slice SVGs, an image sequence, or a "print pack" of 3MF + STL + preview PNG + a parameters JSON.

---

# Recommended stack for this layer

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

# Printability checks the tool should run

Checks are grouped by when they run. "Blocker" prevents a valid export, "warning" is shown and can be overridden, "info" is reported. All thresholds are parameters of the process profile; the values below are proposed defaults.

## Always, live (cheap)

- [ ] **Solid is non-empty.** `isEmpty()` is false and `volume()` is positive. Blocker.
- [ ] **Solid is valid.** `status()` reports no error. Blocker. By construction this holds when the solid is built inside Manifold.
- [ ] **Size is set and sane.** Longest bounding-box edge in mm, default 50 mm. Warning under 20 mm (X + Y + Z, from Shapeways [17]) and when larger than the selected profile's build volume (default 180 by 180 by 180 mm for a generic FDM bed; this default is my choice, not sourced).
- [ ] **Shadow consistency, per view.** Percentage of mask pixels missing from `project()` of the solid. Info under 1 %, warning from 1 %, strong warning from 5 %. Thresholds are my proposal; the concept is from Shadow Art [21].
- [ ] **2D minimum feature width, per mask.** Distance-transform or opening test at the profile's minimum wall. Warning, with the thin regions highlighted on the input image.
- [ ] **Connected components.** `decompose().length`. Info when 1; warning when more, with a list of volumes. Offer: drop components under 1 % of the largest component's volume, keep largest, add base plate, add struts, dilate masks.

## On demand ("check printability"), in a worker

- [ ] **3D minimum thickness.** Voxel opening test at pitch no larger than a third of the minimum wall. Warning, with thin voxels highlighted.
- [ ] **Trapped voids.** Flood-fill of empty voxels from the boundary, or negative-volume shells in the mesh. Info for FDM; blocker for SLA, SLS, MJF and metal unless drain holes are added.
- [ ] **Drain holes present and large enough**, when hollowing is on. Minimum two holes; diameter per profile.
- [ ] **Base contact and stability.** Area of the mesh within one layer height of the lowest plane, as a fraction of the footprint: warning under 10 %. Centre of mass must project inside the convex hull of the contact area: warning otherwise. Both thresholds are my proposal.
- [ ] **Overhang area.** Fraction of surface area facing downward at more than the profile's angle from vertical. Info only, with the note that the slicer will add supports.
- [ ] **Genus.** Info. A sudden change of genus while a parameter is dragged is a useful signal that a thin bridge has appeared or vanished.
- [ ] **Triangle count and file size estimate.** Info; warning above 1,000,000 triangles (my proposal).

## At export

- [ ] **Units written.** 3MF `unit="millimeter"`; STL with the size in the file name and header.
- [ ] **Up axis and scale converted** between the viewing convention (glTF: metres, +Y up) and the printing convention (millimetres, +Z up).
- [ ] **Vector exports:** every path closed; no text elements; stroke and fill per the operation map; dimensions in mm; cut features no narrower than 1 mm; kerf compensation stated in the file name when it is non-zero.
- [ ] **Re-validate the written mesh** by re-reading the 3MF or STL, welding vertices, and running the edge-manifold check. This guards against exporter bugs, which are otherwise found only by the slicer.

## Proposed default thresholds by process profile

| Parameter | FDM, 0.4 mm nozzle | SLA / MSLA | SLS / MJF nylon | Metal (DMLS/SLM) | Laser cut sheet |
|---|---|---|---|---|---|
| Minimum wall | 0.9 mm (two perimeters) [7]; absolute floor 0.45 mm | 0.6 mm [11]; absolute floor 0.2 mm [14] | 0.8 mm [12]; 1.0 mm for unsupported wires [17] | 1.0 mm [20]; absolute floor 0.4 mm [13] | 1.0 mm between cut lines [27] |
| Minimum free-standing pin or wire | 2.0 mm (my proposal; Hubs says pins under 5 mm may fail [9]) | 0.6 mm [14] | 1.0 mm [17] | 1.0 mm [20] | — |
| Minimum embossed / engraved detail | 0.45 mm (one extrusion width) | 0.1 mm / 0.4 mm [11] | 1.0 mm / 1.0 mm [12] | 0.4 mm [13] | — |
| Minimum hole diameter | 2.0 mm (my proposal) | 0.8 mm [11] | 1.5 mm [12] | 1.5 mm [13] | — |
| Sealed cavity | allowed | blocker | blocker | blocker | — |
| Drain / escape hole | not applicable | 3.5 mm, at least 2 [11][15][16] | 4.0 mm for one, 2.0 mm each for several [17]; 5 mm for MJF [18] | avoid cavities | — |
| Hollow shell thickness | not applicable (use infill) | 2.0 mm [11] | 2.0 mm [19] | — | — |
| Overhang angle without support | 45° [9] | 19° from level for short overhangs [11]; supports are routine | none needed (powder supports the part) | 45° [20]; 50° per Hubs [13] | — |
| Maximum unsupported bridge | 5 mm [9] | 21 mm [11] | none | 2 mm [20] | — |
| Clearance between mating parts | 0.3 mm [7] | 0.5 mm [11] | 0.5 mm [17]; 0.7 mm for MJF moving parts [19] | not proposed | kerf-dependent |
| Dimensional tolerance to display | ±0.2 mm [7] | not stated in the sources read | ±0.3 mm or ±0.3 % [12] | ±0.1 to 0.2 mm [20] | — |
| Kerf | — | — | — | — | 0 by default; suggest 0.15 mm [29] |

---

# What could not be verified

- No first-party slicer documentation was found that describes, per defect type, what the slicer does with non-manifold edges, flipped normals or self-intersections. Prusa's page is general [6].
- No official Glowforge support page was retrieved; the stroke-is-cut, fill-is-engrave rule rests on the Glowforge community forum and third-party guides [25].
- Epilog/Trotec hairline and colour conventions come from a university lab guide seen as a search snippet [28], not from the manufacturers.
- Ponoko's colour and stroke conventions and the kerf ranges are search snippets [27][29]; the Ponoko help article I fetched contained no numbers.
- HP's own MJF design guide was not fetched; two republications were [18][19], and they differ on minimum wall.
- The replicad documentation page failed to load; its STEP export claim rests on a search snippet [46].
- The compressed size of the OpenCascade.js WASM build is inferred from a competitor's claim [46]. Only the npm unpacked size (66.7 MB) is first-hand [73].
- `three-edge-projection` was confirmed on GitHub [48] but not on npm.
- Which slicers honour 3MF core `basematerials` colours for multi-material assignment was not tested.
- Whether any maintained browser library writes animated WebP, and whether `upng-js` writes 16-bit greyscale PNG correctly, was not tested.
- Whether laser tools honour DXF `$INSUNITS`, and which DXF versions they accept, was not checked.
- AMF's low adoption is my judgement; no source stating it was found [44].
- The WebGL practices for transparent and high-resolution PNG capture were written from general knowledge, not from a fetched source.
- All "my proposal" thresholds in the checklist are engineering judgement, not sourced.
- No library was installed or run in this session. Every library verdict rests on registry metadata, READMEs and typings.

---

# REFERENCES

[1] [Manifold Library — wiki page on guarantees, manifoldness definition and ε-validity](https://github.com/elalish/manifold/wiki/Manifold-Library)

[2] [Manifold README (elalish/manifold)](https://github.com/elalish/manifold#readme)

[3] [manifold-3d 3.5.4 on npm: typings and lib/export-3mf, lib/import-3mf, lib/export-model](https://cdn.jsdelivr.net/npm/manifold-3d@3.5.4/manifold.d.ts) and [package page](https://www.npmjs.com/package/manifold-3d)

[4] [3MF Core Specification (3MF Consortium)](https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md)

[5] [STL (file format) — Wikipedia](https://en.wikipedia.org/wiki/STL_(file_format))

[6] [Corrupted 3D models for printing — Prusa Knowledge Base](https://help.prusa3d.com/article/corrupted-3d-models-for-printing_2205)

[7] [Modeling with 3D printing in mind — Prusa Knowledge Base](https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135)

[8] [Elephant foot compensation — Prusa Knowledge Base](https://help.prusa3d.com/article/elephant-foot-compensation_114487)

[9] [How to design parts for FDM 3D printing — Protolabs Network (Hubs)](https://www.hubs.com/knowledge-base/how-design-parts-fdm-3d-printing/)

[10] [Key design considerations for 3D printing — Protolabs Network (Hubs)](https://www.hubs.com/knowledge-base/key-design-considerations-3d-printing/)

[11] [How to design parts for SLA 3D printing — Protolabs Network (Hubs)](https://www.hubs.com/knowledge-base/how-design-parts-sla-3d-printing/)

[12] [How to design parts for SLS 3D printing — Protolabs Network (Hubs)](https://www.hubs.com/knowledge-base/how-design-parts-sls-3d-printing/)

[13] [How to design parts for metal 3D printing — Protolabs Network (Hubs)](https://www.hubs.com/knowledge-base/how-design-parts-metal-3d-printing/)

[14] [Design specifications for 3D models (Form 4 generation) — Formlabs](https://formlabs.com/support/Design-specifications-for-3D-models-Form-4-generation/)

[15] [How to hollow out 3D models — Formlabs](https://formlabs.com/blog/how-to-hollow-out-3d-models/)

[16] [Hollowing — Prusa Knowledge Base](https://help.prusa3d.com/article/hollowing_117285)

[17] [Nylon 12 (PA12, Versatile Plastic) design guidelines — Shapeways](https://www.shapeways.com/materials/versatile-plastic)

[18] [MJF 3D printing design tips — Xometry Pro](https://xometry.pro/en/articles/mjf-design-guidelines/)

[19] [HP Multi Jet Fusion design guidelines — Proto3000](https://proto3000.com/service/3d-printing-services/materials/overview/design-guidelines/mjf-multi-jet-fusion-design-guidelines/)

[20] [Direct Metal Laser Sintering (DMLS) — Protolabs](https://www.protolabs.com/en-gb/services/3d-printing/direct-metal-laser-sintering/)

[21] [Mitra NJ, Pauly M. Shadow Art. ACM Transactions on Graphics 28(5), Article 156, 2009 (ACM)](https://dl.acm.org/doi/10.1145/1661412.1618502) and [full text PDF (TU Wien course mirror)](https://www.cg.tuwien.ac.at/courses/CA/material/papers/ShadowArt.pdf)

[22] [Computation of thickness and mechanical properties of interconnected structures (describes the Hildebrand and Rüegsegger local thickness algorithm) — Frontiers in Materials, 2019](https://www.frontiersin.org/journals/materials/articles/10.3389/fmats.2019.00327/pdf) and [Hildebrand and Rüegsegger, original paper record](https://www.researchgate.net/publication/229471011_A_New_Method_for_the_Model-Independent_Assessment_of_Thickness_in_Three-Dimensional_Images)

[23] [File Management — LightBurn Documentation](https://docs.lightburnsoftware.com/latest/Reference/FileManagement/)

[24] [3D Sliced Engravings — LightBurn User Guide](https://docs.lightburnsoftware.com/2.1/Guides/3DSlicedImage/)

[25] [Which colours for cut/engrave/score? — Glowforge Owners Forum](https://community.glowforge.com/t/which-colours-for-cut-engrave-score/23707) and [Glowforge Laser Cutter guide — Northern Arizona University Library](https://libraryguides.nau.edu/creating/Glowforge)

[26] [FAQs on Importing Images — xTool Support Center](https://support.xtool.com/article/544)

[27] [Interlocking 3D laser cut designs — Ponoko Help Center](https://help.ponoko.com/en/articles/4527166-interlocking-3d-laser-cut-designs) and [Ponoko Digital Fabrication Project Guide, laser-cutting edition (PDF)](https://www.ponoko.com/blog/wp-content/uploads/2011/02/Ponoko_Project_Guide_Laser_2_15_11.pdf)

[28] [How to prepare files for the Epilog Fusion M2 laser — SUNY New Paltz (PDF)](https://www.newpaltz.edu/media/dfl/2023%20File%20Preparation%20for%20the%20Epilog%20Laser%20Cutter.pdf)

[29] [What is kerf in laser cutting? — SendCutSend](https://sendcutsend.com/blog/what-is-kerf-in-laser-cutting/) and [Understanding laser kerf — CutLaserCut](https://cutlasercut.com/drawing-resources/expert-tips/laser-kerf/)

[30] [Kiri:Moto — Grid.Space](https://grid.space/kiri/)

[31] [Slicer for Fusion 360 tutorial: slice your 3D model — Sculpteo](https://www.sculpteo.com/en/prepare-your-file-laser-cutting/slicer-fusion-360-tutorial-prepare-your-file-laser-cutting/slice-your-3d-model/)

[32] [three.js examples/jsm/exporters directory, dev branch](https://github.com/mrdoob/three.js/tree/dev/examples/jsm/exporters)

[33] [STLExporter — three.js docs](https://threejs.org/docs/pages/STLExporter.html)

[34] [OBJExporter — three.js docs](https://threejs.org/docs/pages/OBJExporter.html)

[35] [PLYExporter — three.js docs](https://threejs.org/docs/pages/PLYExporter.html)

[36] [USDZExporter — three.js docs](https://threejs.org/docs/pages/USDZExporter.html)

[37] [SVGRenderer — three.js docs](https://threejs.org/docs/pages/SVGRenderer.html)

[38] [3MF exporter — three.js issue 18984](https://github.com/mrdoob/three.js/issues/18984)

[39] [three-3mf-exporter — npm](https://www.npmjs.com/package/three-3mf-exporter)

[40] [@jscadui/3mf-export — npm](https://www.npmjs.com/package/@jscadui/3mf-export)

[41] [@3mfconsortium/lib3mf — npm](https://www.npmjs.com/package/@3mfconsortium/lib3mf)

[42] [@jscad/3mf-serializer — npm](https://www.npmjs.com/package/@jscad/3mf-serializer)

[43] [glTF Transform](https://gltf-transform.dev/)

[44] [Additive manufacturing file format — Wikipedia](https://en.wikipedia.org/wiki/Additive_manufacturing_file_format)

[45] [OpenCascade.js](https://ocjs.org/)

[46] [replicad as a library — replicad docs](https://replicad.xyz/docs/use-as-a-library/) and [occt-wasm (size and LGPL notes)](https://github.com/andymai/occt-wasm)

[47] [mesh2step: faceted triangle-mesh to B-rep STEP converter](https://github.com/tommasobbianchi/mesh2step) and [STL to STEP — Xometry](https://www.xometry.com/resources/3d-printing/stl-to-step/)

[48] [three-edge-projection — GitHub](https://github.com/gkjohnson/three-edge-projection)

[49] [dxfjs/writer (@tarikjabiri/dxf) — GitHub](https://github.com/dxfjs/writer) and [npm](https://www.npmjs.com/package/@tarikjabiri/dxf)

[50] [dxf-writer — npm](https://www.npmjs.com/package/dxf-writer)

[51] [makerjs — npm](https://www.npmjs.com/package/makerjs)

[52] [jspdf — npm](https://www.npmjs.com/package/jspdf), [pdf-lib — npm](https://www.npmjs.com/package/pdf-lib), [@cantoo/pdf-lib — npm](https://www.npmjs.com/package/@cantoo/pdf-lib)

[53] [gifenc — GitHub](https://github.com/mattdesl/gifenc)

[54] [modern-gif — GitHub](https://github.com/qq15725/modern-gif)

[55] [gif.js — GitHub](https://github.com/jnordberg/gif.js)

[56] [gifski-wasm — GitHub](https://github.com/jamsinclair/gifski-wasm)

[57] [ccapture.js — GitHub](https://github.com/spite/ccapture.js)

[58] [VideoEncoder — MDN](https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder)

[59] [WebCodecs API — Can I use (data file)](https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/webcodecs.json) and [page](https://caniuse.com/webcodecs)

[60] [Video processing with WebCodecs — Chrome for Developers](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs)

[61] [Mediabunny — introduction](https://mediabunny.dev/guide/introduction)

[62] [mp4-muxer — npm (deprecation notice)](https://www.npmjs.com/package/mp4-muxer) and [webm-muxer — npm](https://www.npmjs.com/package/webm-muxer)

[63] [ffmpeg.wasm — overview](https://ffmpegwasm.netlify.app/docs/overview) and [FAQ](https://ffmpegwasm.netlify.app/docs/faq)

[64] [Shared Array Buffer — Can I use](https://caniuse.com/sharedarraybuffer)

[65] [HTMLCanvasElement.captureStream() — MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream)

[66] [MediaRecorder API — Can I use](https://caniuse.com/mediarecorder)

[67] [The File System Access API — Chrome for Developers](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access) and [File System Access API — Can I use](https://caniuse.com/native-filesystem-api)

[68] [browser-fs-access — npm](https://www.npmjs.com/package/browser-fs-access)

[69] [fflate — GitHub](https://github.com/101arrowz/fflate)

[70] [jszip — npm](https://www.npmjs.com/package/jszip)

[71] [OffscreenCanvas — Can I use](https://caniuse.com/offscreencanvas), [APNG — Can I use](https://caniuse.com/apng), [WebP — Can I use](https://caniuse.com/webp)

[72] [upng-js — npm](https://www.npmjs.com/package/upng-js), [wasm-webp — npm](https://www.npmjs.com/package/wasm-webp), [@jsquash/webp — npm](https://www.npmjs.com/package/@jsquash/webp)

[73] [npm registry, queried with `npm view` on 2026-09-28 for every package named in this report](https://www.npmjs.com/)
