---
name: shaping-dev-shadow-blocks
description: Use when working on the shadow-blocks genre of shaping or on the shadow checker — the solid whose orthogonal shadows are given figures (Hofstadter's trip-let). Holds the axis convention, the consistency condition and why three figures usually fail it, the checker's two outputs and the assertion that catches convention bugs, the two kinds of disconnection, and the order of fixes to offer. Triggers on "shadow block", "trip-let", "triplet", "ambigram", "visual hull", "shadow is incomplete", "missing part of the letter", "disconnected pieces", "floating part", "add a frame", "axis assignment".
metadata:
  audience: developers
---

# shaping — shadow blocks

Evidence: `docs/research_report.md`, Part B, part 2, and Part C, section 1.3. The reference is Mitra and Pauly, "Shadow Art" (2009), read from the paper itself.

## Convention

Figure A is seen along z and lives in (x, y). B is seen along x and lives in (y, z). C is seen along y and lives in (x, z). The solid is the set of points where all three hold. This convention is written in one module; nothing else may assume an axis.

## What goes wrong, and it is the usual case

The solid is the largest object with those shadows. Its actual shadow is always a subset of the target: parts go missing, nothing is added. With three figures this is the rule, not the exception.

- **Two figures** are consistent exactly when they occupy the same positions along their shared axis. A gap in one (the dot of an "i") removes those rows from the other.
- **Three figures**: a point of A survives when its row of B and its column of C share some z. No single figure decides it.
- **A sufficient fix**: if two of the figures both contain a full line at the same position (a frame, a base bar), the third is reproduced entirely.

## The checker (it is in the core)

For each view: rotate so the view axis is z, `project()`, compare with the target.

| Output | Meaning | Use |
|---|---|---|
| missing = target − shadow | what the solid fails to cast | the number to report, and the region to mark on the wall |
| extra = shadow − target | must be empty | **assert it**. Non-empty means an axis or mirror bug in our code |

Also per solid: pieces, genus, volume, empty or not.

## Two kinds of disconnection

| Kind | Cause | Advice |
|---|---|---|
| Forced | a figure has several components | base, frame, or a clear block around it |
| Incidental | connected figures, but the joining material falls outside another figure | move or scale one figure, reassign axes, or accept a connector |

Tell the user which it is. After dropping any piece, run the checker again: the piece may have been carrying part of a shadow.

## Fixes, in the order to offer them

1. Reposition and rescale the figures against each other.
2. Try the axis assignments and mirror flips; keep the best.
3. Add a frame or a base bar to all figures.
4. Thicken (offset outward).
5. Drop pieces under a share of the largest; keep the largest only.
6. Base plate.

Deforming the figures until they agree, as the paper does, is a later feature and belongs in its own module.

## Do not

- Write a special algorithm for orthogonal extrusions. It is a mesh Boolean in disguise; the kernel does the general case in milliseconds.
- Copy from existing trip-let tools. One of them is GPL-3.0.
- Rely on shadow maps for the wall shadows. Draw the kernel's polygons; real light is a toggle.
