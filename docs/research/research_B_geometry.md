# Research B — Geometry layer: 2D-to-3D transforms, shadow blocks, browser CSG, viewer stack

Date of research: 2026-09-28. All package versions, dates, licences and sizes below were read from the npm registry and the jsDelivr file index on that day.

## 0. How to read this report

**Verification levels.** Every claim carries a reference. Three levels of evidence are used and marked where it matters: (a) *read directly* — I fetched the page or file and read the text myself; (b) *search excerpt only* — the page is rendered by JavaScript or blocked, so only the search engine's excerpt was seen; (c) *measured here* — I ran it locally. Anything I could not verify is listed in section 6 rather than guessed.

**A warning about one of my own tools.** The page-summarising fetcher invented facts about the Shadow Art paper (a "256³ grid", "30–90 seconds", "up to 8 shadows", "the hull must be simply connected"). None of those is in the paper. I discarded that summary and read the PDF page by page; section 2 reflects the PDF only. Treat any secondary summary of that paper with the same suspicion.

**Local measurements.** Run in Node v23.11.0 on an Apple M1 Max, not in a browser, single run each, with `manifold-3d@3.5.4`, `three-bvh-csg@0.0.18`, `@jscad/modeling@2.13.0`, `three@0.186.1`. They show order of magnitude, not a benchmark. The scripts are in the scratchpad folder `bench/` (`bench.mjs`, `bench2.mjs`, `dbg2.mjs`).

**Derivations.** Statements marked *(derivation)* are my own reasoning from the definitions, not a quotation. They are simple enough to check by hand and should be covered by a unit test in the tool.

---

## PART 1 — Taxonomy: ways to turn a 2D figure into a 3D solid

Notation: the figure is a region F in the plane with coordinates (u, v), possibly with holes. "Exact slice" asks: is there a plane whose cut through the solid reproduces F exactly (up to tessellation)? This matters because the viewer should offer a section plane that shows the original image.

### 1.0 Summary table

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

### 1.1 Linear extrude, with twist, scale and taper (draft)

**Maths.** Solid = { (s(t)·R(θ(t))·p, t·h) : p ∈ F, t ∈ [0,1] } where R is a rotation by θ(t) = t·twist and s(t) interpolates from 1 to the top scale. Draft (taper by angle α) is different from scale: it offsets the outline inward by t·h·tan α, so every wall leans by the same angle, while scale shrinks toward a centre and walls lean by different amounts.

**Dials.** Height, centre on/off, twist in degrees, number of slices, top scale (one number or separate X and Y), and draft angle where the kernel has it.

**Names.** OpenSCAD `linear_extrude(height, v, center, convexity, twist, slices, scale, segments)` [1]. Manifold `CrossSection.extrude(height, nDivisions, twistDegrees, scaleTop, center)` [4]. CadQuery `extrude(distance, taper)` and `twistExtrude(distance, angleDegrees)` [13]. Fusion: Extrude with a Taper Angle [14] *(search excerpt only)*. JSCAD `extrudeLinear({height, twistAngle, twistSteps})` [19] *(search excerpt only)*.

**Exact slice.** Yes. With no twist or scale every horizontal slice is F. With twist or scale only the base slice is F; the others are rotated or scaled copies.

**Pitfalls.** Twist with too few slices gives visibly folded quads. Manifold's doc says of `nDivisions`: "especially useful in combination with twistDegrees to avoid interpolation artifacts" [4]. Scale 0 makes a cone: "If the scale is {0, 0}, a pure cone is formed with only a single vertex at the top" [4]. A draft large enough to close a thin part changes the outline's topology partway up; an offset-based draft needs a 2D offset at each level.

**Gotcha measured here.** In `manifold-3d@3.5.4`, passing the top scale as a plain number gives the wrong solid even though the type declaration allows `Vec2|number` [4]. A 1×2 rectangle extruded by 3 has volume 6; `extrude(3, 0, 0, 1, true)` returned 3 (a wedge), `extrude(3, 0, 0, [1,1], true)` returned 6, and omitting the argument returned 6. Always pass a two-element array. The wrapper should hide this.

### 1.2 Revolve / lathe

**Maths.** With the axis as the v-axis and u ≥ 0 the distance from it: (u, v, φ) → (u cos φ, u sin φ, v) for φ ∈ [0, angle]. By Pappus, volume = angle × (area of F) × (distance of F's centroid from the axis).

**Dials.** Sweep angle (full or partial), which line is the axis (a bounding-box edge, a line through the centroid, a user-drawn line), axis offset (distance between figure and axis; an offset above zero gives a ring with a hole), start angle, number of segments.

**Names.** OpenSCAD `rotate_extrude(angle, start, convexity, $fn)`; the `angle` parameter needs version 2019.05 and `start` needs a development snapshot [1]. Manifold `CrossSection.revolve(circularSegments, revolveDegrees)`, which revolves "around its Y-axis and then setting this as the Z-axis of the resulting manifold" [4]. CadQuery `revolve(angleDegrees, axisStart, axisEnd)` [13]. JSCAD `extrudeRotate({angle, startAngle, segments})` [19] *(search excerpt only)*. Blender: the Spin tool (an edit-mode tool, not a modifier), which "extrudes (or duplicates it if the selection is manifold) the selected elements, rotating around a specific point and axis" and is described as the "lathe" tool [18], and the Screw modifier with screw height 0 [17]. Blender has no modifier called "Spin"; the brief's "Spin modifier" is the Screw modifier.

**Exact slice.** Yes. Every half-plane through the axis, within the swept angle, shows F exactly.

**Profile crossing the axis.** This is the main pitfall. OpenSCAD forbids it: "The 2D shape must lie completely on either the right (recommended) or the left side of the Y-axis. More precisely speaking, every vertex of the shape must have either x >= 0 or x <= 0", and if it does not, a warning is printed and "the rotate_extrude() is ignored" [1]. The tool must therefore decide, per component, what to do when the chosen axis cuts the figure. Three defensible policies: (a) clip the figure to one side of the axis and revolve that half; (b) revolve both halves and union them, which gives the solid swept by the larger of the two at each height; (c) refuse and show the user the cut. Policy (a) keeps the "exact slice" property for the kept half only. Manifold's documentation does not say what it does with a profile that crosses the axis, and I did not test it; see section 6.

**Other pitfalls.** Vertices exactly on the axis produce degenerate (zero-area) triangles unless they are merged; Blender's Screw modifier has an explicit "Merge" option "to close off end points with a triangle fan" [17]. A partial angle needs two flat end caps, which are copies of F.

### 1.3 Sweep along a path, and the choice of frame

**Maths.** Given a path c(s) and a moving frame (T, N, B) with T the tangent, the solid is { c(s) + u·N(s) + v·B(s) : (u,v) ∈ F }. The whole question is how to choose N and B.

**Frenet frame.** N is the direction of curvature. It is undefined where curvature is zero (straight stretches and inflection points) and can flip by 180° across an inflection, which twists the swept solid abruptly. Bishop introduced an alternative frame in 1975 [20]; a later paper summarises it as a frame that can "analyze a space curve even when the curve has a vanished second derivative" [20] *(search excerpt only; the 1975 article is paywalled)*.

**Rotation-minimising (Bishop, parallel-transport) frame.** N is carried along the curve with no rotation about T. Wang, Jüttler, Zheng and Liu give the standard algorithm, the *double reflection method*: it "uses two reflections to compute each frame from its preceding one" and "has fourth order global approximation error", against second order for the older methods [21] *(abstract, search excerpt)*. It is about twenty lines of code and needs no library.

**Dials.** Path (drawn, or a preset: arc, S-curve, circle), frame rule (Frenet / rotation-minimising / fixed up-vector), extra twist along the path, scale along the path, closed or open path.

**Names.** CadQuery `sweep(path, multisection, makeSolid, isFrenet, transition, normal, auxSpine)` — the `isFrenet` flag is exactly this choice [13]. Fusion: Sweep, with a taper angle [15] *(search excerpt only)*. OpenSCAD has no built-in sweep. Manifold has no sweep constructor in the declaration file I read [4]; a sweep must be built as a mesh and handed to `Manifold.ofMesh`, or built as a union of convex hulls of consecutive sections.

**Exact slice.** Yes, at the start of the path, in the plane perpendicular to the tangent.

**Pitfalls.** Self-intersection wherever the path's radius of curvature is smaller than the profile's extent toward the centre of curvature *(derivation)*. On a closed path a rotation-minimising frame generally does not return to its starting orientation; the leftover angle must be spread along the path as extra twist. A self-intersecting sweep mesh is not a valid solid and `Manifold.ofMesh` may reject it or give a wrong result.

### 1.4 Helical sweep / screw

**Maths.** (u, v, φ) → (u cos φ, u sin φ, v + pitch·φ/2π) for φ ∈ [0, 2π·turns]. It is a revolve plus a rise proportional to the angle.

**Dials.** Pitch (rise per turn), number of turns, angle, radius (axis offset), handedness, optional end radius for a conical spiral.

**Names.** CadQuery builds the path with `Wire.makeHelix(pitch, height, radius, center, dir, angle, lefthand)`, where a non-default `angle` gives a conical helix [13], and sweeps along it. Blender Screw modifier: Angle ("Degrees for a single helix revolution"), Screw ("The height of one helix iteration"), Iterations ("Number of revolutions"), Axis, Axis Object, Steps [17]. JSCAD `extrudeHelical({angle, pitch, height, segmentsPerRotation})` [19] *(search excerpt only)*. OpenSCAD's `linear_extrude` with twist on an off-centre figure gives "a helical extrusion around the V vector, like a pig's tail" [1], but that keeps the figure horizontal, which is a different solid from a true screw, where the figure stands in a plane through the axis.

**Exact slice.** Yes: a half-plane through the axis shows one copy of F per turn.

**Pitfalls.** If the pitch is smaller than the figure's height along the axis, successive turns overlap and the raw mesh self-intersects. Build each turn (or each segment) as its own solid and union them with the kernel.

### 1.5 Loft between profiles

**Maths.** A surface interpolating a sequence of profiles F₀, F₁, … placed at stations along an axis. "Ruled" joins corresponding points with straight lines; "smooth" fits a spline through them.

**Dials.** The profiles and their heights, ruled or smooth, the starting point and direction of each outline (this sets the correspondence), optional twist.

**Names.** CadQuery `loft(ruled, combine, clean)` [13]. Fusion: Loft, with optional rails or centreline [14] *(search excerpt only)*. JSCAD `extrudeFromSlices` *(not verified; see section 6)*. Manifold has no loft in the declaration file I read [4].

**Exact slice.** Yes at each station.

**Pitfalls.** Lofting needs a correspondence between outlines. Two outlines with different numbers of vertices, or a different number of holes, have no natural correspondence; a bad one twists or self-intersects. For this tool the natural use is morphing between two *components* of one figure, or between a figure and its simplified or offset version, where correspondence is easy. A robust fallback that needs no correspondence: convert both profiles to 2D distance fields, interpolate the fields along the axis, and mesh (section 1.13).

### 1.6 Stacked rotated copies / discrete rotational arrays ("star")

**Maths.** Extrude F into a thin slab of thickness t, centred on its own plane, so the slab stands in a plane through the axis. Make n copies rotated by k·(span/n). The solid is the union. With n = 2 this is the classic two crossed cards; large n with t matched to the spacing approaches a revolve.

**Dials.** n, slab thickness, angular span (full turn or a fan), axis offset, whether the figure is mirrored about the axis or stands on one side, optional per-copy colour.

**Names.** OpenSCAD: a `for` loop of `rotate` around `linear_extrude`. Blender: Array modifier with an object offset. No kernel names it as a primitive.

**Exact slice.** Yes: the mid-plane of each slab shows F.

**Pitfalls.** The slabs overlap near the axis, so the raw concatenated mesh is self-intersecting; a real Boolean union is required before export. Where two slabs meet at a small angle the union has thin slivers that print badly. A figure that does not touch the axis gives n disconnected pieces unless a hub is added.

**Related: stacked layers.** A different "stack": n copies of F extruded to thickness h/n, each rotated by a step about the vertical axis. This is a twisted extrusion with deliberate staircase steps, and every layer's slice is F rotated.

### 1.7 Heightmap / relief / lithophane

**Maths.** z = base + scale·g(I(x, y)) over the image domain, where I is brightness and g a tone curve. The solid is the volume between that surface and a flat back. A lithophane inverts it: dark pixels become thick. Wikipedia describes a lithophane as "a thin plaque of translucent material … moulded to varying thickness, such that when lit from behind the different thicknesses show as different shades" [27].

**Dials.** Maximum relief height, base thickness, invert, tone curve (gamma), blur radius, resolution, and for lithophanes the minimum and maximum thickness to match the material's translucency.

**Names.** OpenSCAD `surface(file)` *(not verified here)*. Manifold: no heightmap constructor seen in [4]; build the grid mesh directly, or use `levelSet`.

**Exact slice.** No. The figure is what you see from above. For a binary figure a horizontal cut between the two levels reproduces F, but with a slope or blur it reproduces a threshold of the blurred image.

**Pitfalls.** A binary mask gives vertical walls with badly shaped long triangles; smooth it or use a distance-based height (section 1.8). A grid of W×H pixels gives about 2·W·H triangles, so a 1000×1000 image is two million triangles. Always add a base and side walls so the result is closed.

### 1.8 Inflation / puffing

**Maths.** Three families.

- *Distance-based.* Let d(p) be the distance from p to the boundary of F and d_max its largest value. Height z = ± H·f(d/d_max). With f(x) = √(1 − (1 − x)²) the cross-section across a strip is a circular arc, so a stripe becomes a half-cylinder and a disc becomes a half-sphere *(derivation)*. This is the simplest to implement from a binary mask: distance transform, then a height field, mirrored for the back.
- *Skeleton-based (Teddy).* Igarashi, Matsuoka and Tanaka's system "inflates the region surrounded by the silhouette making wide areas fat, and narrow areas thin" [23]. It triangulates the outline, extracts a spine (the chordal axis), lifts the spine in proportion to local width, and wraps a surface around it.
- *Energy-based (Repoussé).* Joshi and Carr's system "creates a 3D shape by inflating the surface that interpolates the input curves", controlled by "the mean curvature stored at boundary vertices", solved as "a single linear system" [24] *(abstract, search excerpt)*. This gives the smoothest pillows and lets the user set per-edge sharpness, at the cost of a sparse linear solve.

**Dials.** Maximum height, profile curve (round, flat-topped, pointed), symmetric or one-sided, edge sharpness, smoothing.

**Exact slice.** Yes: the mid-plane z = 0 of a symmetric inflation is exactly F.

**Pitfalls.** At the silhouette the thickness goes to zero, which is unprintable; add a minimum thickness (a short straight extrusion between the two halves). Distance-based heights have visible creases along the medial axis; blur the height field or use the round profile. Holes in F are handled naturally by the distance transform.

### 1.9 Bevel, chamfer and rounding of an extrusion

**Maths.** Replace the sharp top and bottom edges by a profile. Equivalent to stacking extrusions of inward offsets of F: at height z near the top, the slice is F offset by −w(z), where w follows a line (chamfer) or a quarter circle (round). Rounding *all* edges, including vertical ones, is the Minkowski sum of a shrunken solid with a sphere.

**Dials.** Bevel width, bevel depth, number of segments, profile shape, top only or both faces.

**Names.** OpenSCAD `offset(r | delta, chamfer)` in 2D and `minkowski()` in 3D [2]. Manifold `CrossSection.offset(delta, joinType, miterLimit, circularSegments)` and `Manifold.minkowskiSum(other)` [4]. CadQuery `fillet(radius)`, `chamfer(length)` [13]. three.js `ExtrudeGeometry` has bevel options but offsets vertices naively *(not verified in documentation; stated from the library's known behaviour, see section 6)*.

**Exact slice.** Yes, any slice in the unbevelled middle zone.

**Pitfalls.** When the bevel width exceeds half the local width of F, the inward offset changes topology (a thin arm disappears, a region splits). A correct implementation uses a real polygon offset at each level (Manifold's `offset` does, through Clipper2 [11]) and stacks the results; it must then join levels whose outlines have different vertex counts, which is a loft problem. The simple robust route: build the bevelled solid as a distance-field (section 1.13), or use the straight-skeleton "roof" as the bevel surface (section 1.11).

### 1.10 Offset shells and hollowing

**Maths.** Shell = S minus (S offset inward by wall thickness t). In distance-field terms, |d| − t/2 turns a surface into a shell; Quilez calls it "onion": `abs(sdf) - thickness`, used "for carving interiors or giving thickness to primitives, without performing expensive boolean operations" [28].

**Dials.** Wall thickness, which faces are left open, drain holes (needed for resin printing), infill left to the slicer.

**Names.** CadQuery `shell(thickness)` [13]. Manifold: no `shell`; do it as extrude(F) minus extrude(offset(F, −t)) for prismatic solids, or through `levelSet` for general ones [4].

**Exact slice.** The outer outline is F; the slice itself is a ring.

**Pitfalls.** Features thinner than 2t vanish from the inner surface. A naive vertex-normal offset of a mesh self-intersects at concave corners; do not do it that way.

### 1.11 Medial-axis and skeleton-based solids

**Maths.** The medial axis "is the set of all points having more than one closest point on the object's boundary", introduced by Blum in 1967 [25]. The straight skeleton is a related structure "composed of straight line segments, while the medial axis of a polygon may involve parabolic curves" [26]. Two solids follow:

- *Roof.* Lift each skeleton point to a height equal to its distance from the boundary: a hipped roof with every face at 45°. OpenSCAD has this as `roof()`, with `method = "straight"` or `"voronoi"`; it is experimental [3] *(search excerpt only)*.
- *Tubes and balls.* Sweep a circle of radius r(s) = distance to the boundary along each skeleton branch. The union of those balls is F inflated (section 1.8).

**Dials.** Roof angle or height scale, tube radius multiplier, branch pruning threshold, caps.

**Exact slice.** Roof: the base slice is F, and slices at height z are inward offsets of F. Tubes: no.

**Pitfalls.** The medial axis is unstable: a small bump on the boundary grows a whole new branch. Prune by branch length or by the angle between the two closest boundary points. For npm, I found two CGAL-based WebAssembly packages published in 2026, `@matthewjacobson/str8` (straight skeleton, MIT) and `voron8` (segment Voronoi diagram, MIT); CGAL's algorithm packages are mostly GPL [52], so an MIT label on a CGAL-derived build needs a licence check before use. I did not evaluate either.

### 1.12 Wrapping a figure on a cylinder or sphere

**Maths.** Cylinder of radius R: (u, v, w) → ((R + w) cos(u/R), (R + w) sin(u/R), v), where w is depth. Lengths along u are kept at the surface w = 0 and stretched by (R + w)/R above it. Sphere: no mapping keeps lengths, so choose a projection (equirectangular, stereographic, or gnomonic per face) and accept distortion.

**Dials.** Radius, arc span (or "fit to full turn"), relief depth, emboss or engrave, which way up.

**Names.** Fusion's Emboss "raises or recesses a sketch profile relative to faces on a solid body" and can "wrap text around a solid body" [16] *(search excerpt only)*. Manifold `warp(warpFunc)` moves "the vertices of this Manifold according to any arbitrary input function without changing topology" [4], which is exactly a wrap if the mesh is refined first with `refine(n)` [4]. Blender: Simple Deform (Bend) *(not verified)*.

**Exact slice.** No planar slice. The unrolled cylindrical surface at w = 0 is F.

**Pitfalls.** The flat mesh must be subdivided along u before warping, or long straight edges stay straight and cut through the cylinder. A figure wider than 2πR overlaps itself. `warp` does not check for self-intersection; the caller is responsible.

### 1.13 Signed-distance-field modelling, then meshing

**Maths.** Represent the solid as a function d(p) that is negative inside. Start from a 2D distance field of F (computed from the polygon, or from the mask by a distance transform). Quilez gives the two lifting operators [28]:

- Extrusion: `d = primitive(p.xy); w = vec2(d, abs(p.z) - h); return min(max(w.x,w.y),0.0) + length(max(w,0.0));`
- Revolution: `q = vec2(length(p.xz) - o, p.y); return primitive(q)` where `o` is the axis offset.

He states that for both, "if the 2D SDF we start with is an exact SDF, the resulting 3D volume is exact as well" [28]. Other operators: rounding is `d − r` (exact); onion is `abs(d) − t` (exact); smooth union blends two shapes with a radius k; twist and bend are changes of coordinates applied to p before evaluating d [28].

**Which operations keep a true distance.** Extrusion, revolution, rounding and onion do. Smooth union, twist, bend and displacement give only a bound: they "distort the distance field and make it non-Euclidean anymore" [28]. This matters for ray marching and for offsetting, and less for meshing, which only needs the sign and a rough value near the surface.

**Revolution of a profile crossing the axis.** The revolution operator uses `length(p.xz)`, which is never negative, so only the u ≥ 0 half of the 2D field is ever sampled *(derivation)*. A distance-field revolve therefore silently applies policy (a) of section 1.2.

**Meshing.**

- *Marching cubes* (Lorensen and Cline, 1987) [29]. One vertex per grid edge crossed. The original table has ambiguous cases, which caused "discontinuities and topological issues" [29]. The patent expired in 2005 [29].
- *Marching tetrahedra.* No ambiguous cases, so "surfaces produced by marching tetrahedra are always manifold", but the meshes are "about 4x larger" [30]. Manifold's `levelSet` uses "a form of Marching Tetrahedra" [4] and its README says it "improves significantly over Marching Cubes" [5].
- *Surface nets* (Gibson 1999; "naive" variant by Lysenko). One vertex per cell. "Much faster", "easy to implement and produces slightly smaller meshes"; "the only downside is that it can create non-manifold vertices" [30].
- *Dual contouring* (Ju, Losasso, Schaefer, Warren, 2002) [31]. One vertex per cell, placed using surface normals, so it keeps sharp edges. Needs a least-squares solver per cell and, like surface nets, can create non-manifold vertices.

**Dials.** Cell size, blend radius, and every dial of the methods above expressed as a field operation.

**Exact slice.** Only up to cell size. Sharp corners of F are rounded by marching cubes, marching tetrahedra and surface nets.

**Pitfalls.** Cost grows as N³ evaluations. In Manifold the field is a JavaScript callback called from WebAssembly, once per grid point [4]; the call overhead across that boundary will dominate. I did not measure it.

**Verdict for this tool.** Use distance fields as the *second* representation, for the operations where polygons are awkward: inflation, bevels that change topology, smooth blends between components, lofts without correspondence. Keep polygons and mesh Booleans as the first representation, because they keep sharp edges and exact slices.

### 1.14 Visual hull / shape from silhouette / space carving

**Maths.** Given n silhouettes S_k and projections P_k, each defines a cone (a prism, for parallel projection) C_k = P_k⁻¹(S_k). The hull is the intersection of all C_k. Laurentini introduced the concept in 1994 [32]; it is the largest object that has the given silhouettes, it contains the true object, and it cannot recover concavities [32]. Kutulakos and Seitz generalised from silhouettes to colour consistency and defined the *photo hull*, computed by *space carving* [33].

**Dials.** Number of views, direction of each view (the three axes, a ring of n directions about one axis, or free), parallel or perspective projection, scale and position of each image.

**Exact slice.** No. What matches is the projection, not a cut. And the projection matches only if the silhouettes are consistent; see Part 2.

**n views.** With n parallel views about one axis, the hull is a prism-like solid whose horizontal slices are intersections of n strips, that is, convex polygons per connected slice region *(derivation)*. With n large and all silhouettes equal to F this tends to the revolve of the symmetrised F.

### 1.15 Voxel approaches

**Maths.** Sample the solid on an N³ grid of occupied / empty cells. Any of the methods above becomes a per-voxel test. Booleans are bitwise AND, OR, AND-NOT.

**Dials.** N, surface smoothing, meshing method.

**Exact slice.** Up to voxel size.

**Pitfalls.** Memory: one byte per voxel is 16.8 MB at 256³ and 134 MB at 512³; one bit per voxel is 2.1 MB and 16.8 MB. Blocky output ("cubified") is always closed and manifold if faces between occupied and empty cells are emitted consistently, except at cells touching only along an edge or a corner, which give non-manifold edges and vertices *(derivation)*. Smoothed output from marching cubes or surface nets inherits the issues in 1.13.

---

## PART 2 — Shadow blocks: literature, prior art, and how to check the shadows

### 2.1 Hofstadter's trip-let

MathWorld defines it: "A trip-let is a three-dimensional solid that is shaped in such a way that its projections along three mutually perpendicular axes are three different letters of the alphabet" and credits Hofstadter's G, E, B blocks on the cover of *Gödel, Escher, Bach* [35]. Hofstadter's spelling is "trip-let", with a hyphen. The construction is the intersection of three orthogonal extrusions of the three letters. Mitra and Pauly reproduce a photograph of the blocks as their Figure 2(g) [34].

Aliases to search under, as collected by one of the tools below: "trip-lets, visual hulls, shadow hulls, shadow sculptures, 3D ambigrams, dual-letter illusions" and "shape from silhouette" [37].

### 2.2 Mitra and Pauly, "Shadow Art" (SIGGRAPH Asia 2009)

Read directly from the PDF [34]. Citation: ACM Transactions on Graphics 28(5), Article 156, December 2009, 7 pages.

**Definitions.** Input is a set of shadow sources S_k = (I_k, P_k): a binary image and a projection. "Each shadow source S_k defines a generalized cone C_k ⊂ ℝ³ that marks the maximum region of space compatible with I_k and P_k. Intersecting the shadow cones of the set S yields the 3D shadow hull H(S) = C₁ ∩ · · · ∩ C_n." The hull is "a sculpting block": "Any part of space outside the shadow hull cannot be part of the sculpture, since this would contradict at least one of the desired shadow images" [34].

**Consistency.** "Let I′_k be the actual shadow cast by the shadow hull H under projection P_k. We call a set of shadow sources consistent, if I′_k = I_k for all k." And the central finding: "shadow sources provided by the user need not be consistent. In fact, inconsistency is the rule rather than the exception for more than two shadow sources. Inconsistent shadow sources lead to a shadow hull that casts incomplete shadows, i.e., parts of the input shadow image will be missing" [34]. Note the direction of the error: the actual shadow is always a *subset* of the target. Nothing is ever added; parts go missing.

**Why a pixel goes missing.** "An inconsistent pixel in I′₁ corresponds to a line of empty voxels in the shadow hull. Setting any such voxel to active would fill the pixel in I′₁. However, these voxels project onto lines of pixels in I₂ and I₃ that lie completely outside the desired shadow silhouette in at least one of the images" [34].

**Their remedy.** Deform the input images, as little as possible, until they are consistent. They use as-rigid-as-possible shape manipulation (Igarashi et al. 2005) on a triangle mesh laid over each image. Constraints are derived automatically: for each missing pixel, find the least-cost voxel on its line and pull the boundary of the offending image toward that voxel's projection. They apply "only a small fraction (0.25 in all examples) of the resulting displacements" per iteration and repeat [34]. Stiffness starts high, so the first iterations mostly *reposition* the images relative to each other, and is then relaxed.

**Limits they report.** "Not all combinations of images are suitable for creating shadow art" and "the optimization, being a greedy one, can converge to a local minima when the initialization is poor" (their Figure 11 shows a failure) [34].

**Implementation facts.** They use a voxel grid, not meshes, "since subsequent editing of the shadow hull requires volumetric operations", on a GPU, and note that "disadvantages of this approach are aliasing and grid alignment artifacts". Input image resolution is 250 × 250 for all but one example [34]. The paper gives no timing figures beyond "realtime" and "immediate visual feedback", and gives no voxel grid size.

**An example that needed no deformation.** Their Andy Warhol cube "is the only example in the paper that does not require any image deformations to achieve consistency, since the projections are orthogonal and each image has a complete ring of active pixels at the boundary" [34]. This is a usable design rule; see 2.4.

**Connectivity.** "The optimization does not consider structural aspects such as connectedness of the shadow hull that might be important for a physical realization of the sculpture." And: "If the input images are composed of multiple components, the shadow hull necessarily consists of disconnected pieces. In such cases, the 3D sculpture can be embedded in a transparent medium … Alternatively, transparent threads or other thin supporting elements can be added" [34].

**Minimum material.** The hull is the *largest* solid with those shadows; much of it can be removed. For two orthographic views the smallest voxel set "can be reduced to a bipartite graph matching problem, for which polynomial time algorithms exist". For three, "we conjecture that finding the smallest consistent shadow sculpture in this case is NP-hard" [34]. This is a conjecture in the paper, not a theorem.

**Editing.** Brush, ray and erosion tools remove voxels only where doing so leaves all shadows intact [34].

### 2.3 Visual hull and space carving

Laurentini, "The visual hull concept for silhouette-based image understanding", IEEE Transactions on Pattern Analysis and Machine Intelligence 16(2), 150–162, February 1994, DOI 10.1109/34.273735 [32]. Kutulakos and Seitz, "A Theory of Shape by Space Carving", International Journal of Computer Vision 38, 199–218, 2000 [33]. (The Shadow Art reference list gives 1999 and different pages for this paper [34]; the publisher's record says 2000, pages 199–218 [33].)

Mitra and Pauly state the key difference between the vision problem and the design problem: in reconstruction, "the silhouettes will always be consistent, since they result from projections of a real physical object. For arbitrary input images, such a 3D shape might not exist" [34]. A design tool must therefore *detect and report* inconsistency; a vision system never has to.

### 2.4 The consistency condition for orthogonal parallel views *(derivation)*

Take coordinates so that image A is seen along z and lives in (x, y); B is seen along x and lives in (y, z); C is seen along y and lives in (x, z). The hull is H = { (x,y,z) : A(x,y) and B(y,z) and C(x,z) }.

**Two views (A and B).** The shadow of H along z contains the point (x, y) of A exactly when some z has B(y, z), that is, when row y of B is not empty. So A is reproduced exactly if and only if every height y occupied by A is occupied by B, and B is reproduced if and only if the reverse holds. *Two orthogonal silhouettes are consistent exactly when they occupy the same set of positions along their shared axis.* For two letters of equal height with no gaps in the vertical direction this always holds, which is why two-word ambigrams are easy. A letter with a vertical gap, such as "i" with its dot or ":" or "=", has empty rows, and those rows of the other letter are lost.

**Three views.** The point (x, y) of A is reproduced exactly when some z has both B(y, z) and C(x, z): row y of B and row x of C must share at least one z. This is the condition that fails in practice, and it is not a condition on any single image.

**A sufficient rule.** If B and C both contain the full line z = z₀ (for instance a frame, a baseline bar, or a solid border), then every point of A is reproduced, because z₀ serves as the witness for all of them. The same applies to each of the other two images in turn. That is precisely the "complete ring of active pixels at the boundary" of the Warhol example [34]. The tool can offer this as a one-click fix: "add a frame to all three images".

**Measured here.** With three test shapes (a ring, a block letter E, a seven-lobed star with a hole) the polygon route and the voxel route agree on what goes missing. Polygon route: 11.1%, 0.02% and 4.4% of the three target areas missing, and 0 extra area in all three. Voxel route at 256³: 11.3%, 0.00%, 4.45%. The hull was one connected piece of genus 5.

### 2.5 How to check that each shadow equals its input, and what to tell the user

**Polygon route (exact, recommended).** For each axis, rotate the hull so that the axis becomes z, call `project()`, which "returns a cross section representing the projected outline of this object onto the X-Y plane" [4], and compare with the target `CrossSection`:

- missing = target minus shadow (a `CrossSection`; its `area()` is the number to report, its `toPolygons()` are the regions to draw in red);
- extra = shadow minus target. This must be empty. If it is not, the tool has a bug in its axis or rotation conventions. I hit exactly this during testing, and the non-zero "extra" is what exposed it. Keep it as an assertion.

Cost, measured here: 5 ms for all three checks on a 5 000-triangle hull, 28 ms on a 41 000-triangle hull.

**Raster route.** Project the voxel grid along each axis with a logical OR and compare with the mask pixel by pixel. At 256³ this took 26 ms here. Missing pixels are those set in the mask and clear in the projection.

**What to report.** Per view: percentage of target area missing, and an overlay with the missing region highlighted on the wall. Per solid: the number of disconnected pieces from `decompose()`, which "returns a vector of Manifolds that are topologically disconnected" [4], the genus, the volume, and whether the result is empty. For printing: pieces that do not touch the build plate, and minimum wall thickness.

**Two distinct kinds of "disconnected".** (1) The inputs have several components (the dot of an "i"), so the hull *must* have several pieces [34]. (2) The inputs are connected but the hull is not, because the parts that would join them fall outside one of the other silhouettes. The user needs different advice for each: for (1) add a base or a frame, or embed in a clear block; for (2) move or scale one image, or accept a connector.

**Remedies to offer, in order of effort.** (a) Reposition and rescale the three images relative to each other, since early iterations of the Shadow Art optimisation do little more than that [34]. (b) Try all assignments of images to axes and all mirror flips, and keep the best; one tool does this for letters [37]. (c) Add a frame or base bar (2.4). (d) Thicken strokes (offset the polygons outward). (e) Full image deformation in the manner of Shadow Art, which is a research-grade feature and should be a later plugin.

### 2.6 3D ambigrams and existing tools

| Tool | What it does | How | Licence | Status |
|---|---|---|---|---|
| Lyl3, "Customizable Triple Letter Blocks Ambigram" [43] | Blocks showing three letters from three orthogonal views | OpenSCAD customizer; needs the Rubik Mono One font | Not checked | Published on Thingiverse (thing 3633456) and Printables *(search excerpt only)* |
| ondras/3 [42] | "Shadow cube (particularly known from GEB) generator" | Web page plus an OpenSCAD file `geb.scad` | None stated | Last push 2023-02 |
| 2CATteam/AmbigramGenerator [40] | Two-word ambigrams in the browser | Series of intersect operations | MIT | Last push 2025-12 |
| Lucandia/dual_letter_illusion ("TextTango") [41] | Two-word letter blocks | Intersection of 3D letters | **GPL-3.0** | Last push 2026-03 |
| ijanos/ambi (ambi3d.com) [38] | Two equal-length words, STL export, warns about floating geometry | three.js for rendering and font outlines; Manifold WebAssembly for solids and Boolean intersection | Apache-2.0 or MIT | Last push 2026-08 |
| printpal Text Flip Generator [39] | Two words, STL | Per character: "two deeply-extruded 2D glyphs rotated at ±45° from center, then computes the CSG intersection using Manifold WASM" | Proprietary site | Live |
| mrienstra/shadow-hull [37] | Three letters or two words; tries letter-to-axis assignments; joins loose pieces; checks wall thickness; reports coverage | Manifold for Booleans, opentype.js for outlines, Vite | MIT | Pushed on the day of this research; 0 stars; very new |
| ambigramgenerator.me [44] | 2D and 3D two-name ambigrams | Not documented | Proprietary site | *(search excerpt only)* |

**What the prior art shows.** Every browser tool I found that names its kernel uses Manifold [37][38][39]. All of them are limited to letters from fonts. None takes an arbitrary image, none offers n views beyond three, and none I could inspect shows the user *where* a shadow is incomplete on the wall. Those three gaps are this project's opening. Do not copy code from the GPL-3.0 project [41] into a permissively licensed tool.

The two-word ambigram is the two-view case with views at ±45° to the reading direction, done per letter pair, which keeps each pair consistent by the two-view rule of 2.4.

---

## PART 3 — Boolean / CSG in the browser

### 3.1 Comparison

Sizes: "unpacked" is the npm package on disk; "payload" is what a browser would download, measured here with gzip -9 on the files named.

| Library | npm package | Version, published | Licence | Size | Representation | Output guaranteed manifold? | Web Worker | Maintenance | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| Manifold | `manifold-3d` | 3.5.4, 2026-09-25 | Apache-2.0 | unpacked 2.8 MB; payload `manifold.wasm` 541 KB (205 KB gzip) + `manifold.js` 82 KB (19 KB gzip) | Triangle mesh, indexed | **Yes**, by design [5][7] | Yes; the package ships its own `dist/worker.bundled.js` | Very active (repo pushed 2026-09-28) | **Wrap: primary kernel** |
| three-bvh-csg | `three-bvh-csg` | 0.0.18, 2026-02-17 | MIT | unpacked 1.4 MB; module 164 KB (33 KB gzip); needs `three` and `three-mesh-bvh` (291 KB, 62 KB gzip) | three.js geometry | **No**, stated by the author [45] | "Worker Support" is on the roadmap as help wanted [45] | Active (repo pushed 2026-09-27), self-described experimental | Avoid for export; acceptable for live preview only |
| three-csg-ts | `three-csg-ts` | 3.2.0, 2024-05-28 | MIT | unpacked 57 KB | BSP tree | No | Pure JS, no DOM needed | Dormant since 2024-05 | Avoid |
| csg.js (Evan Wallace) | not on npm under that name | repo last pushed 2019-10 | MIT | tiny | BSP tree | No | Pure JS | Unmaintained; historical | Avoid |
| JSCAD | `@jscad/modeling` | 2.13.0, 2026-02-22 | MIT | unpacked 1.6 MB; min bundle 251 KB (59 KB gzip) | Polygon soup, BSP Booleans [48] | No | Pure JS | Active (repo pushed 2026-09-24) | Avoid as kernel; borrow ideas |
| OpenCascade.js | `opencascade.js` | 1.1.1 (latest tag), 2020-09-27; beta tag 2.0.0-beta | **LGPL-2.1-only** | unpacked 67 MB; `opencascade.wasm.wasm` 65.9 MB | B-rep (exact curves and surfaces) | Yes in principle; B-rep validity | Yes | Repo last pushed 2023-08 | Avoid directly |
| replicad | `replicad` + `replicad-opencascadejs` | 1.1.0, 2026-09-04 (both) | replicad MIT; **the WebAssembly kernel it needs is LGPL-2.1-only** | kernel wasm 23.0 MB (single-thread build), 22.5 MB (multi) | B-rep | As above | Yes; its docs recommend a worker [50] | Active | Optional plugin for STEP export only |
| bitbybit OCCT | `@bitbybit-dev/occt` | 1.3.2, 2026-09-20 | MIT label on the package; contains OpenCascade, which is LGPL | unpacked 107 MB | B-rep | As above | Not checked | Active | Not evaluated |
| CGAL in WebAssembly | none found for mesh Booleans | — | CGAL algorithms are mostly **GPL-3.0+**, kernel LGPL [52] | — | Exact arithmetic | Yes | — | `@sfcgal/sfcgal` 0.1.0-beta.0 exists, **GPL-3.0-or-later** | **Avoid (GPL)** |
| "csg2" | no npm package of that name (404) | — | — | — | — | — | — | — | See Babylon CSG2 |
| Babylon CSG2 | part of `@babylonjs/core` | 9.28.0, 2026-09-24 | Apache-2.0 | unpacked 72 MB (tree-shakeable) | Wraps Manifold [53] | Yes, inherited from Manifold | Not checked | Very active | Only if Babylon is the renderer |

**Reading the licences.** LGPL-2.1 allows use from a closed or permissively licensed application provided the user can replace the LGPL part. A separately loaded `.wasm` file arguably satisfies that, but this is a legal judgement, not a technical one, and I am not giving legal advice. GPL-3.0 code linked into the application requires the whole application to be GPL. Flagged packages: `opencascade.js` (LGPL-2.1-only), `replicad-opencascadejs` (LGPL-2.1-only), `occt-import-js` (LGPL-2.1), `@sfcgal/sfcgal` (GPL-3.0-or-later), `potrace` (GPL-2.0), `marchingsquares` (AGPL-3.0), and the repository Lucandia/dual_letter_illusion (GPL-3.0).

### 3.2 Manifold in detail

**The guarantee.** "Our primary goal is reliability: guaranteed manifold output without caveats or edge cases" [5]. The author calls the Boolean "a guaranteed-manifold mesh Boolean algorithm, which I believe is the first of its kind" [5]. Manifoldness is defined topologically, following the 3MF specification: "Every edge of every triangle must contain the same two vertices (by index) as exactly one other triangle edge, and the start and end vertices must switch places between these two edges" [7]. Because that definition uses indices and not coordinates, "the set of manifold meshes is closed under Boolean operations" [7].

**What is *not* guaranteed.** Geometric validity (no self-overlap) is promised only within a tolerance ε, and the authors say this part "cannot be mathematically proven" [7] *(fetcher summary of the wiki; wording partly paraphrased)*. Input must already be manifold: "you'll get an error status if the imported mesh isn't manifold" [5]. This is why the tool should build every solid through Manifold's own constructors, where the input is a polygon, and not through imported meshes.

**Built-in 2D-to-3D.** `CrossSection` (2D, with fill rules, Boolean, `offset`, `hull`, `simplify`, `area`, `toPolygons`), `extrude`, `revolve`, `levelSet` for distance fields, `warp`, `refine`, `minkowskiSum`, `project`, `slice(height)`, `decompose`, `genus`, `volume`, `status` [4]. `slice` and `project` are the two functions the viewer needs for "show me the cut that matches my image" and "check my shadow". The 2D side currently depends on Clipper2; there is an open proposal for an in-house replacement [11].

**Users.** OpenSCAD, Blender, Godot, Babylon.js, trimesh, bitbybit and about thirty others are listed [5]. OpenSCAD made Manifold its default backend in development builds; reported speed-ups over its CGAL backend range from 5–30× to 100× [65] *(search excerpt only)*, and the Manifold author's first comparison gave "100 - 1,000 times faster" [9].

**Memory management.** "Since Manifold is a WASM module, it does not automatically garbage-collect like regular JavaScript. You must manually delete() each object constructed by your scripts (both Manifold and CrossSection)" [8]. The wrapper must own this; callers of the tool's API should never see `delete()`.

**Content-Security-Policy.** An issue opened on 2026-09-24, "WASM bindings fail under a Content-Security-Policy without 'unsafe-eval' (embind uses new Function)", is marked closed [10]. I did not confirm which release contains the fix. If the tool is deployed under a strict policy, test this first.

**Export.** "Please avoid saving to STL files! They are lossy and inefficient - when saving a manifold mesh to STL there is no guarantee that the re-imported mesh will still be manifold, as the topology is lost" [5]. They recommend 3MF, and glTF with the `EXT_mesh_manifold` extension [5]. Offer 3MF as the default print format and STL as a compatibility option. The npm package lists `@jscadui/3mf-export` and `@gltf-transform/core` among its dependencies [12].

**Threads.** The README speaks of "parallelization, or pipelining when only a single thread is available" [5]. Whether the published WebAssembly build uses threads is not stated in anything I read. Assume single-threaded.

### 3.3 Measured here: the trip-let with each kernel

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

### 3.4 The voxel route

Rasterise the three masks at N × N, then H[x,y,z] = A[x,y] AND B[y,z] AND C[x,z].

**Measured here.** The AND loop: 2.5 ms at 64³, 4.3 ms at 128³, 34 ms at 256³. Checking the three shadows at 256³: 26 ms. Memory at one byte per voxel: 16.8 MB at 256³. (My rasterisation step was a naive point-in-polygon test and took seconds; in the browser, draw the polygon to a canvas and read the pixels back.)

**Properties.** Trivial to write. Cannot fail. Works directly from binary masks with no tracing step. It is what Shadow Art used [34]. Editing (carving, connectivity analysis by flood fill, minimum-material search) is easy on voxels and hard on meshes.

**Costs.** Resolution-limited: edges are stair-stepped or, after smoothing, rounded. Output size grows with N²: a 256³ hull surface is of the order of hundreds of thousands of triangles. Watertightness depends on the mesher: see the manifold caveats for surface nets and marching cubes in 1.13 [29][30].

**Getting a guaranteed-manifold mesh from voxels.** Pass the grid to Manifold's `levelSet` as a sampled field; marching tetrahedra has no ambiguous cases [30] and the result is a `Manifold`. Not measured.

### 3.5 The direct route for orthogonal extrusions *(derivation)*

The slice of the hull at height z is A ∩ (C_z × B_z), where C_z = { x : C(x,z) } and B_z = { y : B(y,z) } are unions of intervals. So each slice is A clipped to a set of rectangles. For pixel masks this gives a run-length algorithm: for each z, compute the interval lists of row z of B and C, and clip A. For polygons the interval end-points move linearly with z between vertex heights of B and C, so the solid between two consecutive vertex heights is A intersected with a union of wedge-shaped prisms.

This is a correct and fast special case, but it is a mesh Boolean in disguise, and it must solve the same robustness problems at the seams between z-ranges. Manifold already does the general case in 9 ms. **Do not write it.** The one place the slice formula is worth using is the *checker* and the *preview*: it gives the shadow-completeness answer in 2D without building any solid (2.4).

### 3.6 Recommendation for Part 3

**Primary kernel: Manifold (`manifold-3d`)**, in a Web Worker, behind the tool's own interface.

**Wrap, do not reinvent:** 2D polygon Booleans and offsets (`CrossSection`); extrude with twist and scale; revolve; all 3D Booleans; projection and slicing; splitting into pieces; distance-field meshing (`levelSet`); 3MF export.

**Write yourself (small, well-defined):** mask-to-polygon tracing (or use a permissively licensed tracer; `potrace` on npm is GPL-2.0, `imagetracerjs` is Unlicense, `d3-contour` is ISC); the rotation-minimising frame [21]; sweep, helix, loft and wrap mesh builders feeding `Manifold.ofMesh`; the distance transform for inflation; the voxel AND and its checker; the consistency report.

**Seams to declare now.** `kernel` (default Manifold; a B-rep kernel could replace it for STEP export), `mesher` (default Manifold `levelSet`; surface nets or dual contouring could replace it), `tracer` (mask to polygons). Each is one argument with a working default.

**Second representation.** Keep the voxel route as a genre-2 option for mask inputs and for the editing features. It shares the checker.

**B-rep, later and optional.** If STEP export for CNC or engraving workflows is required, add replicad as a lazily loaded plugin. It costs a 23 MB download and brings an LGPL component, so it must not be in the default bundle.

---

## PART 4 — Viewer and rendering stack

### 4.1 Libraries

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

### 4.2 three.js, Babylon.js, or react-three-fiber with drei

**Choose three.js, through react-three-fiber and drei.** Reasons. The project's frontend conventions are React, schema-driven and declarative, and react-three-fiber expresses the scene as components whose properties are the dials. drei supplies, as single components, nearly every staging effect on the list in 4.6. Every browser trip-let tool that names its renderer uses three.js [38]. Manifold's output (`vertProperties`, `triVerts`) drops directly into a three.js `BufferGeometry`.

**Babylon.js** is a complete engine and has first-party CSG through Manifold ("Before you can use CSG2, you must initialize the Manifold library" [53]; the older pure-JavaScript CSG "was not maintained and not usable anymore" [54]). That confirms Manifold as the kernel but is not a reason to adopt Babylon: the tool calls Manifold in a worker and the renderer never sees the kernel.

**Keep the renderer behind a seam.** The geometry layer should output plain typed arrays (positions, indices, per-component colour, plus the 2D silhouette polygons). The viewer is one consumer of that. A plain three.js viewer without React, or a Babylon viewer, could then be added without touching the core.

### 4.3 Material dials (MeshPhysicalMaterial)

From the three.js documentation [57]. `roughness` and `metalness` are inherited from the standard material.

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

**Cost.** The material "has a higher performance cost, per pixel, than other three.js materials. Most effects are disabled by default, and add cost as they are enabled. For best results, always specify an environment map when using this material" [57]. Transmission renders the scene an extra time into a separate target; the renderer has a `transmissionResolutionScale` to reduce that cost [59].

**Transmission versus opacity.** Use opacity for a cheap see-through diagnostic view. Use transmission for a material that should look like glass. Do not offer both on the same material at once [57]. drei has a `MeshTransmissionMaterial` with more options (documentation file confirmed to exist; options not read).

**Present as presets first.** Matte plastic, glossy plastic, brushed metal, polished metal, glass, resin, wood. Expose the raw dials under "advanced". This is the progressive-disclosure rule applied to materials.

### 4.4 Three orthogonal shadows on three walls

Two ways.

**A. Real shadow maps.** Three `DirectionalLight`s along −x, −y, −z, each casting onto one wall. A directional light's shadow camera is orthographic, which is the parallel projection the trip-let needs: the three.js source constructs it as `new OrthographicCamera(-5, 5, 5, -5, 0.5, 500)` [66]. The walls can use `ShadowMaterial`, which is transparent except where shadow falls [61].

- *For:* the shadow is physically produced by the solid on screen, so it is honest, and it updates for free when the solid rotates or is carved.
- *Against:* resolution is limited by the shadow map (jagged or blurred edges; letters need 2048 or 4096 pixels); needs bias tuning to avoid speckle; each wall receives light from the other two lights, which washes out its shadow, so walls need a custom treatment (each wall lit only by its own light); three shadow passes per frame.

**B. Draw the silhouette polygons on the walls.** The kernel already gives the exact projected outline as polygons (`project()` [4]). Triangulate them and place them as flat meshes a hair in front of each wall.

- *For:* perfectly sharp at any zoom; costs almost nothing per frame; and it can show *three layers at once*: the target image (outline), the achieved shadow (filled), and the missing region (red). That is the consistency report of 2.5 drawn where the user is looking.
- *Against:* it is a diagram, not a simulation. It is only valid for the three axis directions and must be recomputed when the solid changes (5–28 ms here).

**Recommendation.** B is the default, because it is exact and because showing the mismatch is the point of the genre. Offer A as a "real light" toggle, and use it for the animation where the solid or a light moves away from the axes, since only a real shadow shows how the letters dissolve between views. Both consume the same kernel output, so neither needs the core to change.

### 4.5 WebGPU status in three.js

Read directly from the three.js manual and documentation [55][56].

- `WebGPURenderer` "is the new alternative of WebGLRenderer" and "tries to use a WebGPU backend if the browser supports WebGPU. If not, WebGPURenderer falls backs to a WebGL 2 backend" [56]. A `forceWebGL` option exists [56].
- It is imported from a different entry point: `import * as THREE from 'three/webgpu'` [55].
- Initialisation is asynchronous: `await renderer.init()`, or use `setAnimationLoop` [55].
- "Custom materials based on ShaderMaterial, RawShaderMaterial and modifications of built-in materials via onBeforeCompile() are not supported in WebGPURenderer" [55].
- "EffectComposer with its effect passes are not supported because WebGPURenderer comes with a new, more modern post-processing stack" [55].
- Status, in the maintainers' words: "The renderer itself is still in an experimental state although its maturity level has been greatly improved in the last years. Still, depending on your application and scene setup, you will encounter missing features or a better performance with WebGLRenderer" [55].
- "WebGLRenderer is still maintained and the recommended choice for pure WebGL 2 applications. However, keep in mind that there are no plans to add larger new features" [55].
- react-three-fiber 9 accepts "a callback passed to GL [that] can now return a promise for async constructors like WebGPURenderer", and its guide calls WebGPU "still a work in progress and not fully backward-compatible with all of Three's features" [63]. Version 10, with WebGPU as a first-class option, is reported to be in alpha *(search excerpt only)*.

**Consequences for this tool.** drei's `AccumulativeShadows` is built on a `ShaderMaterial` (its own type signature says so [62]), and the `postprocessing` and `n8ao` packages are built on the classic composer. Those are exactly the things the WebGPU renderer does not support. Third-party articles call WebGPU production-ready and recommend it for new projects *(search excerpt only)*; the maintainers' own manual is more cautious, and I weight the manual higher.

**Recommendation.** Ship on `WebGLRenderer`. This tool renders one object and three walls; it has no performance problem that WebGPU would solve. Keep the renderer choice behind one argument so that a later switch is a configuration change, and avoid writing custom GLSL shaders, which would have to be rewritten.

### 4.6 Environmental effects worth offering

| Effect | How | Notes |
|---|---|---|
| Orbit, pan, zoom | drei `OrbitControls` | The documentation file was not at the path I guessed; component not re-verified today (section 6) |
| Click-through picking of stacked components | drei `CycleRaycast` | Documentation file confirmed to exist; options not read |
| HDRI environment lighting | drei `Environment` | It "sets up a global cubemap, which affects the default scene.environment". **The `preset` property "is not meant to be used in production environments and may fail as it relies on CDNs"** [62]: bundle one or two small HDR files with the tool |
| Soft ground shadow, cheap | drei `ContactShadows` | "A rather expensive effect"; for a still object render it once with `frames={1}` [62] |
| Soft ground shadow, best quality | drei `AccumulativeShadows` with `RandomizedLight` | "zero performance impact after all frames have accumulated"; gives "realistic raycast-like shadows and ambient occlusion" [62]. WebGL renderer only |
| One-line studio setup | drei `Stage` | Documentation file confirmed to exist; options not read |
| Ambient occlusion | `n8ao`, or the `postprocessing` package | Makes the concavities of a trip-let readable |
| Tone mapping | `renderer.toneMapping`: None, Linear, Reinhard, Cineon, ACESFilmic, AgX, Neutral; default is none [59] | Offer Neutral (faithful colours) and ACES or AgX (photographic) |
| Turntable | Rotate the object, or auto-rotate the camera | For genre 2, add "snap to view": animate the camera to each of the three axes in turn, with an orthographic camera at the end of each move so the letter reads exactly |
| Orthographic / perspective switch | Two cameras | A silhouette reads exactly only in orthographic view |
| Wireframe / x-ray | `wireframe` flag; low opacity | Diagnostic |
| Section / clipping plane | `material.clippingPlanes` with `renderer.localClippingEnabled = true` [58][59] | See below |
| Exploded view by component | Translate each component along its own axis | Natural for genre 1, where components have separate transforms |
| Fit to view, view cube | drei `Bounds`, `GizmoHelper` | Documentation files confirmed to exist |

**The section plane is the signature feature.** Part 1 lists, for each transform, the plane whose cut reproduces the original figure. The viewer should have a button "show the original slice" that places the clipping plane there: the base plane for an extrusion, a half-plane through the axis for a revolve or screw, the mid-plane for an inflation or a star slab, the start plane for a sweep.

Clipping in three.js only discards fragments: "Points in space whose signed distance to the plane is negative are clipped (not rendered)" [58], so the cut solid looks hollow. Two ways to fill the cut:

1. The stencil technique shown in the official example "solid geometry with clip planes and stencil materials" [60].
2. Ask the kernel: `slice(height)` "returns the cross section of this object parallel to the X-Y plane at the specified height" [4]. Draw that polygon as a flat coloured cap. It is exact, and the same polygon can be compared with the original figure to *prove* the slice matches.

Option 2 is better here for the same reason as drawn shadows in 4.4: the polygon is data the tool can check and export (an engraving outline, for instance), not only pixels.

---

## 5. Recommended architecture for this layer, in brief

- **Core is pure and renderer-free.** Input: polygons with holes, or masks. Output: typed arrays and polygons. It runs in a Web Worker.
- **A transform is a plugin** with a parameter schema (the dials), a `build(figure, params)` function returning a solid, and an `originalSlice(params)` function returning the plane whose cut reproduces the figure, or nothing. The last one is what makes the section-plane button generic.
- **A genre composes transforms.** Genre 1 maps components to transforms and unions the results. Genre 2 maps n images to n view directions, intersects, and runs the checker.
- **The checker is part of the core, not the viewer.** It returns, per view, the achieved shadow, the missing region, and the missing fraction; and per solid, the piece count, genus and volume.
- **Would another surface need the core to change?** A command-line exporter, or an HTTP service, would call the same worker functions under Node, where `manifold-3d` runs as shown by the measurements above. No.

---

## 6. What I could not verify

- **Manifold's behaviour when a revolve profile crosses the axis.** Not documented in what I read, not tested.
- **Whether the published `manifold-3d` WebAssembly build uses threads.** Not stated in the sources read.
- **Which `manifold-3d` release contains the fix for the Content-Security-Policy issue** [10]. The issue is closed; the release was not identified.
- **Cost of `levelSet` with a JavaScript callback.** Not measured.
- **Browser timings.** All measurements are from Node on one machine.
- **Autodesk Fusion help pages** [14][15][16], **JSCAD's API pages** [19], **replicad's "use as a library" page** [50], **OpenSCAD's `roof()` page** [3], **Lyl3's Thingiverse page** [43], **ambigramgenerator.me** [44]: these render with JavaScript or returned navigation only. Claims from them rest on search-engine excerpts.
- **CadQuery** [13]: I read the raw page for `sweep` (`isFrenet`: "Frenet mode (default False)"; `transitionMode`: 'transformed', 'round' or 'right') and for `Wire.makeHelix(pitch, height, radius, center, dir, angle, lefthand)`. The other signatures (`extrude` with `taper`, `twistExtrude`, `revolve`, `loft`, `shell`, `fillet`, `chamfer`) come from the fetcher's summary of the same page.
- **Manifold wiki quotations** [7]: via the fetcher's summary; the manifoldness definition matches the 3MF wording, but treat the ε-validity wording as paraphrase.
- **JSCAD `extrudeFromSlices`, OpenSCAD `surface()`, Blender Simple Deform, three.js `ExtrudeGeometry` bevel behaviour, drei `OrbitControls`**: named from general knowledge of those tools, not re-verified today.
- **Bishop's 1975 article** [20] and **Wang et al. 2008** [21]: abstracts only; both are behind publisher access.
- **Laurentini 1994** [32]: citation details from Wikipedia and from the Shadow Art reference list; the article itself was not read.
- **A maintained CGAL mesh-Boolean build for the browser.** I found none on npm. That is absence of evidence from one registry search, not proof that none exists.
- **An "occt-wasm" project** (OpenCascade at "~4MB brotli" with worker support) appeared in search results under many forked names. I could not identify the original or confirm the size claim, so it is not in the comparison table.
- **OpenSCAD speed-up figures** [65]: search excerpt only.

---

## 7. Recommended stack for this layer

| Concern | Choice | Package @ version | Licence | Why | Seam / fallback |
|---|---|---|---|---|---|
| Solid kernel (Booleans, extrude, revolve) | Manifold | `manifold-3d` @ 3.5.4 | Apache-2.0 | Only option whose output is manifold by construction; 9 ms for a trip-let here; 205 KB gzip | `kernel` argument; replicad as optional B-rep plugin |
| 2D polygon operations (union, offset, clean-up) | Manifold `CrossSection` | same | Apache-2.0 | Already in the kernel; no second library | — |
| Shadow and slice checking | Manifold `project()`, `slice()`, `decompose()` | same | Apache-2.0 | Exact polygons; 5–28 ms here | Raster check on the voxel route |
| Distance-field meshing | Manifold `levelSet()` | same | Apache-2.0 | Marching tetrahedra, result is a `Manifold` | `mesher` argument; surface nets or dual contouring, own code |
| Voxel route (mask inputs, carving, connectivity) | Own code, about 100 lines | — | — | Trivial, cannot fail, 34 ms at 256³ here | Meshed through `levelSet` |
| Sweep frames | Own code: double reflection method [21] | — | — | About 20 lines; no library needed | Frenet and fixed-up as alternative strategies |
| Inflation | Own code: distance transform plus height profile | — | — | Works from masks; mid-plane slice is exact | Teddy- or Repoussé-style as later plugins |
| Mask to polygon tracing | `d3-contour` (ISC) or `imagetracerjs` (Unlicense), or own marching squares | `d3-contour` @ 4.0.2 | ISC | Permissive | `tracer` argument. **Avoid `potrace` (GPL-2.0) and `marchingsquares` (AGPL-3.0)** |
| Font outlines (letters) | opentype.js | `opentype.js` @ 2.0.0 | MIT | Used by the prior-art tools [37] | — |
| Threading | Web Worker, with `comlink` for calls | `comlink` @ 4.4.2 | Apache-2.0 | Keeps the interface responsive; the kernel package ships its own worker bundle | — |
| Renderer | three.js, `WebGLRenderer` | `three` @ 0.186.1 | MIT | Mature; all staging helpers depend on it | One argument; WebGPU later |
| Scene as components | react-three-fiber | `@react-three/fiber` @ 9.8.1 | MIT | Declarative; dials are properties; needs React 19 | Plain three.js viewer as a second surface |
| Staging helpers | drei | `@react-three/drei` @ 10.7.9 | MIT | Environment, ContactShadows, AccumulativeShadows, Stage, Bounds, GizmoHelper | Bundle the HDR files; do not use `preset` in production |
| Ambient occlusion and effects | N8AO with postprocessing | `n8ao` @ 2.0.1, `postprocessing` @ 6.39.5 | ISC, Zlib | Readable concavities | WebGL renderer only |
| Wall shadows | Drawn silhouette polygons by default; real shadow maps as a toggle | — | — | Exact, and shows target, achieved and missing together | Both read the same kernel output |
| Section cap | Kernel `slice()` polygon drawn as a cap | — | — | Exact; can be compared with the original and exported | Stencil technique [60] |
| Print export | 3MF first, STL second | `@jscadui/3mf-export` @ ^0.5.0 (already a dependency of `manifold-3d`) | not checked | STL loses the manifold topology [5] | glTF with `EXT_mesh_manifold` for viewing |
| CAD export (STEP) | Not in the first version | `replicad` @ 1.1.0 + `replicad-opencascadejs` @ 1.1.0 | MIT + **LGPL-2.1-only** | 23 MB download; load only on demand | Optional plugin |
| Not recommended | three-bvh-csg, three-csg-ts, csg.js, @jscad/modeling as kernel, opencascade.js directly, any CGAL build, Babylon.js | — | MIT / MIT / MIT / MIT / **LGPL-2.1** / **GPL-3.0+** / Apache-2.0 | Non-manifold output, or unmaintained, or very large, or restrictive licence, or a second ecosystem with no gain | — |

---

## REFERENCES

[1] [OpenSCAD User Manual — Using the 2D Subsystem (linear_extrude, rotate_extrude)](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Using_the_2D_Subsystem)

[2] [OpenSCAD User Manual — Transformations (offset, minkowski, hull)](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Transformations)

[3] [OpenSCAD User Manual — WIP: Roof](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/WIP/Roof)

[4] [Manifold — TypeScript declarations for the WebAssembly bindings (manifold-encapsulated-types.d.ts)](https://raw.githubusercontent.com/elalish/manifold/master/bindings/wasm/manifold-encapsulated-types.d.ts)

[5] [Manifold — repository README](https://github.com/elalish/manifold)

[6] [Manifold — WebAssembly bindings README](https://github.com/elalish/manifold/blob/master/bindings/wasm/README.md)

[7] [Manifold — wiki: Manifold Library (algorithm and definitions)](https://github.com/elalish/manifold/wiki/Manifold-Library)

[8] [Manifold WASM Developer Guide — Using Manifold (installation, memory management)](https://manifoldcad.org/docs/jsapi/documents/Using_Manifold.html)

[9] [Manifold — discussion 383: Manifold Performance](https://github.com/elalish/manifold/discussions/383)

[10] [Manifold — issue 1849: WASM bindings fail under a Content-Security-Policy without 'unsafe-eval'](https://github.com/elalish/manifold/issues/1849)

[11] [Manifold — issue 1707: Add experimental boolean2 CrossSection backend (Clipper2 dependency)](https://github.com/elalish/manifold/issues/1707)

[12] [npm — manifold-3d](https://www.npmjs.com/package/manifold-3d)

[13] [CadQuery — Class Reference](https://cadquery.readthedocs.io/en/latest/classreference.html)

[14] [Autodesk Fusion Help — Extrude a solid body](https://help.autodesk.com/view/fusion360/ENU/?guid=SLD-EXTRUDE-SOLID)

[15] [Autodesk Fusion Help — Sweep a solid body](https://help.autodesk.com/view/fusion360/ENU/?contextId=MODEL-SWEEP-CMD)

[16] [Autodesk Fusion Help — Emboss a solid body](https://help.autodesk.com/view/fusion360/ENU/?contextId=SLD-EMBOSS)

[17] [Blender Manual — Screw Modifier](https://docs.blender.org/manual/en/latest/modeling/modifiers/generate/screw.html)

[18] [Blender Manual — Spin tool](https://docs.blender.org/manual/en/latest/modeling/meshes/tools/spin.html)

[19] [JSCAD — API documentation: modeling/extrusions](https://www.openjscad.xyz/docs/module-modeling_extrusions.html)

[20] [Bishop RL. There is More than One Way to Frame a Curve. The American Mathematical Monthly. 1975;82(3):246-251](https://www.tandfonline.com/doi/abs/10.1080/00029890.1975.11993807)

[21] [Wang W, Jüttler B, Zheng D, Liu Y. Computation of rotation minimizing frames. ACM Transactions on Graphics. 2008;27(1):Article 2](https://dl.acm.org/doi/10.1145/1330511.1330513)

[22] [Wikipedia — Frenet–Serret formulas](https://en.wikipedia.org/wiki/Frenet%E2%80%93Serret_formulas)

[23] [Igarashi T, Matsuoka S, Tanaka H. Teddy: a sketching interface for 3D freeform design. SIGGRAPH 1999 (ACM SIGGRAPH History Archives entry)](https://history.siggraph.org/learning/teddy-a-sketching-interface-for-3d-freeform-design-by-igarashi-matsuoka-and-tanaka/)

[24] [Joshi P, Carr NA. Repoussé: Automatic Inflation of 2D Artwork. Sketch-Based Interfaces and Modeling 2008 (Eurographics Digital Library)](https://diglib.eg.org/items/6c312948-5efc-4a33-bec2-4c2c28900659)

[25] [Wikipedia — Medial axis](https://en.wikipedia.org/wiki/Medial_axis)

[26] [Wikipedia — Straight skeleton](https://en.wikipedia.org/wiki/Straight_skeleton)

[27] [Wikipedia — Lithophane](https://en.wikipedia.org/wiki/Lithophane)

[28] [Quilez I. Distance functions (3D signed distance functions and operators)](https://iquilezles.org/articles/distfunctions/)

[29] [Wikipedia — Marching cubes](https://en.wikipedia.org/wiki/Marching_cubes)

[30] [Lysenko M. Smooth Voxel Terrain (Part 2). 0 FPS blog, 2012](https://0fps.net/2012/07/12/smooth-voxel-terrain-part-2/)

[31] [Ju T, Losasso F, Schaefer S, Warren J. Dual contouring of hermite data. SIGGRAPH 2002](https://dl.acm.org/doi/10.1145/566570.566586)

[32] [Wikipedia — Visual hull (with citation of Laurentini A. The visual hull concept for silhouette-based image understanding. IEEE TPAMI. 1994;16(2):150-162)](https://en.wikipedia.org/wiki/Visual_hull)

[33] [Kutulakos KN, Seitz SM. A Theory of Shape by Space Carving. International Journal of Computer Vision. 2000;38:199-218](https://link.springer.com/article/10.1023/A:1008191222954)

[34] [Mitra NJ, Pauly M. Shadow Art. ACM Transactions on Graphics. 2009;28(5):Article 156 (PDF)](https://www.cg.tuwien.ac.at/courses/CA/material/papers/ShadowArt.pdf)

[35] [Wolfram MathWorld — Trip-Let](https://mathworld.wolfram.com/Trip-Let.html)

[36] [Mitra NJ, Pauly M. Shadow art — ACM Digital Library record](https://dl.acm.org/doi/10.1145/1661412.1618502)

[37] [mrienstra/shadow-hull — GitHub repository](https://github.com/mrienstra/shadow-hull)

[38] [ijanos/ambi — GitHub repository (ambi3d.com)](https://github.com/ijanos/ambi)

[39] [printpal — Text Flip 3D Generator](https://printpal.io/tools/text-flip-generator)

[40] [2CATteam/AmbigramGenerator — GitHub repository](https://github.com/2CATteam/AmbigramGenerator)

[41] [Lucandia/dual_letter_illusion — GitHub repository (GPL-3.0)](https://github.com/Lucandia/dual_letter_illusion)

[42] [ondras/3 — GitHub repository (GEB shadow cube generator)](https://github.com/ondras/3)

[43] [Lyl3 — Customizable Triple Letter Blocks Ambigram (Thingiverse thing 3633456)](https://www.thingiverse.com/thing:3633456)

[44] [Ambigram Generator — ambigramgenerator.me](https://www.ambigramgenerator.me/)

[45] [three-bvh-csg — README](https://github.com/gkjohnson/three-bvh-csg)

[46] [three-csg-ts — README](https://github.com/samalexander/three-csg-ts)

[47] [csg.js (Evan Wallace) — README](https://github.com/evanw/csg.js)

[48] [@jscad/modeling — README](https://github.com/jscad/OpenJSCAD.org/tree/master/packages/modeling)

[49] [OpenCascade.js — GitHub repository](https://github.com/donalffons/opencascade.js)

[50] [replicad — documentation: replicad as a library](https://replicad.xyz/docs/use-as-a-library/)

[51] [OpenCascade.js — documentation: custom builds](https://ocjs.org/docs/app-dev-workflow/custom-builds)

[52] [CGAL — Licence](https://www.cgal.org/license.html)

[53] [Babylon.js Documentation — Merging Meshes (CSG2, InitializeCSG2Async)](https://doc.babylonjs.com/features/featuresDeepDive/mesh/mergeMeshes)

[54] [Babylon.js forum — Introducing: CSG2](https://forum.babylonjs.com/t/introducing-csg2/54274)

[55] [three.js manual — WebGPURenderer](https://threejs.org/manual/pages/webgpurenderer.html)

[56] [three.js docs — WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html)

[57] [three.js docs — MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html)

[58] [three.js docs — Material (clippingPlanes, clipIntersection, clipShadows)](https://threejs.org/docs/pages/Material.html)

[59] [three.js docs — WebGLRenderer (toneMapping, localClippingEnabled, transmissionResolutionScale)](https://threejs.org/docs/pages/WebGLRenderer.html)

[60] [three.js example — webgl clipping stencil](https://threejs.org/examples/webgl_clipping_stencil.html)

[61] [three.js docs — ShadowMaterial](https://threejs.org/docs/pages/ShadowMaterial.html)

[62] [drei — documentation sources: staging (ContactShadows, AccumulativeShadows, Environment)](https://github.com/pmndrs/drei/tree/master/docs/staging)

[63] [React Three Fiber — v9 Migration Guide](https://r3f.docs.pmnd.rs/tutorials/v9-migration-guide)

[64] [react-three-csg — GitHub repository](https://github.com/pmndrs/react-three-csg)

[65] [OpenSCAD — issue 5192: Make CGAL vs. Manifold configurable in Preferences](https://github.com/openscad/openscad/issues/5192)

[66] [three.js source — src/lights/DirectionalLightShadow.js](https://github.com/mrdoob/three.js/blob/dev/src/lights/DirectionalLightShadow.js)

[67] [npm — three-bvh-csg](https://www.npmjs.com/package/three-bvh-csg)

[68] [npm — three-csg-ts](https://www.npmjs.com/package/three-csg-ts)

[69] [npm — @jscad/modeling](https://www.npmjs.com/package/@jscad/modeling)

[70] [npm — opencascade.js](https://www.npmjs.com/package/opencascade.js)

[71] [npm — replicad](https://www.npmjs.com/package/replicad)

[72] [npm — replicad-opencascadejs](https://www.npmjs.com/package/replicad-opencascadejs)

[73] [npm — three](https://www.npmjs.com/package/three)

[74] [npm — @babylonjs/core](https://www.npmjs.com/package/@babylonjs/core)

[75] [npm — @react-three/fiber](https://www.npmjs.com/package/@react-three/fiber)

[76] [npm — @react-three/drei](https://www.npmjs.com/package/@react-three/drei)

[77] [npm — @sfcgal/sfcgal](https://www.npmjs.com/package/@sfcgal/sfcgal)

[78] [npm — potrace](https://www.npmjs.com/package/potrace)

[79] [npm — n8ao](https://www.npmjs.com/package/n8ao)

[80] [npm — postprocessing](https://www.npmjs.com/package/postprocessing)
