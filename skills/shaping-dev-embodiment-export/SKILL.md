---
name: shaping-dev-embodiment-export
description: Use when working on anything that leaves shaping as a file, or on the printability checks — 3MF, STL, GLB, PLY, OBJ, SVG and DXF for engraving and cutting, depth maps, units and axes, process profiles, wall thickness, trapped voids, floating parts. Holds which formats are written by hand and why, the conventions laser software expects, the thresholds per process with their sources, and the read-back test. Triggers on "export", "STL", "3MF", "STEP", "CAD export", "DXF", "SVG for laser", "engrave", "kerf", "wall thickness", "printable", "watertight", "units", "millimetres", "slicer".
metadata:
  audience: developers
---

# shaping — files and physical objects

Evidence: `docs/research_report.md`, Part C.

## Rules

1. **An exporter is a pure function** `(model, options) => bytes`, with a row in the exporters table giving its extension, media type, and what it can carry (colour, units, several bodies). The export menu is built from the table.
2. **Every exporter has a read-back test.** Parse what was written, weld vertices, require every edge to be used exactly twice, once in each direction.
3. **Millimetres, stated.** The model is normalised; the size dial sets the longest edge. 3MF writes `unit="millimeter"`. STL has no units, so the size goes in the file name and the header.
4. **One place converts axes and units.** Viewing formats are metres with +Y up; printing formats are millimetres with +Z up.
5. **Heavy or rarely used exporters are dynamic imports.**

## Formats

| Format | How | Notes |
|---|---|---|
| 3MF | by hand, on `fflate` | the default for printing; one object per part, colour through base materials |
| STL, binary | by hand | the universal fallback; loses topology and units |
| GLB | three.js exporter | for viewing and sharing |
| PLY | three.js exporter | vertex colour |
| OBJ with MTL | by hand, zipped | the three.js exporter writes no materials |
| SVG, DXF | by hand | see below |
| PNG depth map | render from above | both polarities |
| STEP | not offered | a STEP made from triangles is an STL in substance. "CAD export" means profiles as DXF and SVG, plus the recipe: import, extrude, intersect |

Not implemented, on purpose: AMF, VRML, X3D, IGES, G-code.

## Vector files for lasers and cutters

- Stroke means cut or score; fill means engrave. Cut paths have no fill; engrave paths have no stroke.
- One colour per operation, from a map that is a parameter. Default: red cut, blue score, black engrave. Services differ, so presets, never a fixed choice.
- Hairline stroke, 0.01 mm by default.
- Every path closed explicitly. No text elements.
- Width, height and view box in millimetres, so one unit is one millimetre.
- Kerf is a parameter, 0 by default. When set, outer contours move out and holes move in by half of it, and the file name says so.

## Checks

Live, on every change: not empty; size sane; pieces; thin features on the 2D figures (opening test at the profile's minimum wall, with the thin regions marked on the figure). On demand, in a worker: thickness in 3D, trapped voids, base contact and stability, overhang share.

What to leave to the slicer: supports, infill, first-layer compensation, anything that depends on one machine.

## Process profiles (defaults; each is a data record)

| | FDM, 0.4 mm | Resin | Nylon powder | Metal | Laser sheet |
|---|---|---|---|---|---|
| Minimum wall | 0.9 mm | 0.6 mm | 0.8 mm | 1.0 mm | 1.0 mm between cuts |
| Sealed cavity | allowed | blocks export | blocks export | blocks export | — |
| Drain hole | — | 3.5 mm, two | 4 mm, or 2 mm each | — | — |

Published figures disagree by up to five times between a printer maker and a print service. The defaults take the service's side. Sources are in the report.

## Licences to keep out

`@ffmpeg/core` (GPL), `gifski-wasm` (AGPL). `mediabunny` is MPL-2.0, which allows bundling.
