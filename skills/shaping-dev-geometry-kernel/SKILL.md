---
name: shaping-dev-geometry-kernel
description: Use when writing or changing anything that builds solids in shaping — the Manifold wrapper, a transform (extrude, revolve, radial array, and the ones to come), 2D polygon operations, or a geometry test. Holds the kernel's guarantees and limits, the memory rule, the gotchas found by running it, the policy for a figure that crosses a revolve axis, and how geometry is tested. Triggers on "manifold", "CrossSection", "extrude", "revolve", "lathe", "boolean", "union", "intersect", "non-manifold", "self-intersection", "originalSlice", "memory leak in the worker".
metadata:
  audience: developers
---

# shaping — building solids

Evidence and measurements: `docs/research_report.md`, Part B.

## Rules

1. **Every solid is born inside the kernel.** Build from a `CrossSection` with `extrude` or `revolve`, or combine solids with Booleans. Then the result is manifold by construction and nothing needs repair.
2. **A hand-built mesh enters through `Manifold.ofMesh` only if it is closed and does not cross itself.** For shapes that overlap themselves (a helix with a small pitch, slabs meeting at the axis), build the pieces separately and union them.
3. **Every figure passes through a 2D union before a genre sees it.** Smoothing and tracing can make a contour cross itself; the union cleans it.
4. **The wrapper owns `delete()`.** Manifold objects are not garbage-collected. Use the wrapper's scope helper, which deletes everything created inside it except what is returned as plain data. No caller ever calls `delete()`.
5. **Pass the top scale of an extrusion as a two-element array.** In `manifold-3d` 3.5.4 a plain number gave a wedge. The wrapper does this; do not bypass it.
6. **Never concatenate meshes and call it a union.** It looks right and is not a solid.

## A figure that crosses the revolve axis

The revolve is undefined there. Each call states a policy, and the default is the first:

| Policy | Result | Original slice kept? |
|---|---|---|
| `clip` | keep the side with the larger area, revolve it | yes, for that side |
| `both` | revolve each side, union | no: the slice is the larger of the two at each height |
| `refuse` | no solid; the diagnostic carries the cut line | — |

Points on the axis are merged before the revolve.

## The original slice

Each transform's `originalSlice(params)` returns the plane whose cut gives back the figure: the base plane for an extrusion, a half-plane through the axis for a revolve, the mid-plane of a slab for a radial array. The test for a transform is that the kernel's slice there equals the input.

## Testing geometry

Test properties, not pictures:

- volume (a revolve's volume is angle × area × distance of the centroid from the axis);
- piece count from `decompose()`, and genus;
- polygon equality, as the area of the symmetric difference being under a tolerance;
- after a build, no live kernel objects.

## What not to use

three-bvh-csg, three-csg-ts, JSCAD's Booleans, or three.js `ExtrudeGeometry` and `LatheGeometry` for anything that is exported: their output is not guaranteed to be a closed solid. OpenCascade and CGAL builds: size and licence.

## Choosing the next transform

The research ranks them. Inflate (height from the distance to the boundary, mirrored) and helical sweep come next, because both keep an exact slice and both are short. Bevel, loft and sweep need either matching contours between levels or a distance-field route; read Part B, sections 1.9 and 1.13, first.
