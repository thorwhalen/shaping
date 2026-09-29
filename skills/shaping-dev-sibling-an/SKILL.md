---
name: shaping-dev-sibling-an
description: Use when working on animation tracks, parameter addressing or the Design schema's animation section in shaping, or when a task touches both shaping and the Python package `an` (structured animation). Holds what the two projects share, what they do not, where `an`'s reusable research is, and the rule for changing the shared track format. Triggers on "animation track", "tween", "easing", "property path", "parameter sweep", "the an package", "structured animation", "share with an", "export for an".
metadata:
  audience: developers
---

# shaping and `an`

Decision record: `docs/architecture.md`, ADR 0002.

## The two projects

| | shaping | `an` |
|---|---|---|
| Language | TypeScript, in the browser | Python |
| Makes | 3D objects, and renders of them | videos of scenes |
| Described by | a `Design` document, Zod-validated | a scene document, Pydantic-validated |
| Repository | this one | `thorwhalen/an` |

Neither imports the other. The link is a format and shared research.

## What is shared: the track model

- A **property path** addresses a value in the document.
- **Actions**: `set`, and `tween` with an easing.
- **Combinators** (sequence, parallel, delay, loop) flatten to a list of actions with absolute times.

The JSON shape of a flattened track is kept readable by both. Before changing it here, read `an`'s schema and composition modules and check that the change can be read there. If it cannot, write the difference down in ADR 0002.

## Research in `an` worth reading before designing here

In `an`'s `misc/docs/`: the reports on scene-graph and animation system design patterns, on declarative parameter languages, and on animation interchange formats; and the notes on golden-image tests for deterministic renders. Its project instructions list its architectural pillars.

## What each may want from the other

- `an` from shaping: turntable and sweep renders as scene assets; 2D-to-3D transforms to give flat artwork depth.
- shaping from `an`: easing functions and their names; the migration pattern for versioned documents; the verification approach for renders.

## Rules

1. A pointer to this project lives in `an`'s documentation. If you rename or move this project, update it there, through a session working in that repository.
2. Do not edit `an` from a session working here.
