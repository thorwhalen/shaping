---
name: shaping-dev-imaging
description: Use when working on the path from a source to a figure in shaping — decoding uploads (PNG, JPG, HEIC, SVG, DXF), thresholding, morphology, component labelling, the distance field, tracing, simplification and smoothing, or the drawing canvas. Holds the default cascade and why, the order of operations, which libraries are excluded by licence, and how this stage is tested without image files. Triggers on "threshold", "Otsu", "bitonal", "mask", "dilate", "erode", "despeckle", "trace", "vectorize", "potrace", "contours", "HEIC", "SVG import", "pen tool", "split into components".
metadata:
  audience: developers
---

# shaping — from a source to a figure

Evidence: `docs/research_report.md`, Part A.

## Rules

1. **The original image stays in memory.** Every dial re-runs from the original. No step overwrites its input.
2. **The mask stage is hand-written over typed arrays, in a worker.** No general imaging library.
3. **Vector sources skip the raster stages.** SVG paths, DXF polylines and drawn strokes become polygons directly. (Rasterising an SVG is the fallback for files with text, strokes or clipping.)
4. **A figure carries units.** Raster sources have none, so the size dial sets them. Vector sources may bring their own.

## The default cascade

1. If the image has meaningful transparency, threshold the alpha channel at half.
2. Otherwise blur slightly, then Otsu on luminance.
3. Background is the class that dominates the border pixels. An invert toggle overrides.

Dials: manual threshold (starts at the Otsu value), invert, mode (auto, alpha, luminance, colour distance, adaptive), tolerance, window and offset for adaptive. Adaptive methods are for line art and photographs of paper; on filled shapes they leave a hollow outline, so they are never the default.

## Order of operations

threshold → drop small components → fill holes (optional; holes are often intended) → open or close (optional) → signed distance field → blur the field (smoothing) → contour at level 0, or at ±d to grow or shrink → simplify → smooth → 2D union.

Growing, shrinking and smoothing are all one contour extraction at a different level of the same field. Do not implement them three times.

## Parts

Connected-component labelling on the mask gives the parts. Colour clustering (k-means with a fixed seed) is the way to split by colour; each cluster becomes a mask and goes through the same stages.

## Tracing

Marching squares on the smoothed field gives sub-pixel contours with holes nested. It emits a vertex per pixel edge crossed, so simplification is required, not optional. Default: Ramer–Douglas–Peucker, tolerance as a dial.

## Excluded, and why

| Library | Reason |
|---|---|
| Potrace and its ports, including the one labelled MIT | GPL-2.0, or derived from it |
| `marchingsquares` | AGPL-3.0 |
| `@imgly/background-removal`, the ISNet model | AGPL-3.0 |
| RMBG models | non-commercial |
| OpenCV.js | 13 MB for what is a few hundred lines |
| tldraw | production use needs a licence key |
| Any DWG reader | GPL-3.0, 9.5 MB; ask the user for DXF |

HEIC: try the browser first; load a decoder only when that fails, as a separate file, because every decoder is LGPL.

## Drawing

Pointer events, with pointer capture, coalesced events and pressure. A stroke is the outline polygon from `perfect-freehand`, passed through a union because it can cross itself. The drawing is a list of objects; black objects are unioned and erasers subtracted, in order. Undo is the list.

## Testing

Figures are generated in the test: a disc, a ring, two blobs, a bar of known width. Assert area, hole count, part count and width. No image files in the repository.
