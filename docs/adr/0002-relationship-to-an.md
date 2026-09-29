# ADR 0002 — Relationship to `an` (structured animation)

**Context.** The user maintains `an`, a Python package for structured animation: a scene document, validated, rendered to video by swappable backends. Its targets differ from this project's: `an` makes videos of scenes; this project makes objects. They overlap in two places: both describe things by parameters, and both render animations of those parameters.

**Decision.**

1. This project's animation tracks use `an`'s model: a property path into the document, the actions `set` and `tween` with an easing, and combinators flattened to absolute times. The JSON shape is kept compatible so that a track written for one can be read by the other.
2. Neither project depends on the other. The link is a shared format and shared research, not an import.
3. Each project records the other: this ADR and the dev skill `shaping-dev-sibling-an` here; a short pointer in `an`'s own documentation, added by a session working in that repository.
4. Research to reuse from `an`: its reports on scene-graph and animation system design, on declarative parameter languages, and on animation interchange formats; and its golden-image approach to testing deterministic renders.
5. What `an` may want from here: turntable and parameter-sweep renders of 3D objects as assets for a scene, and the 2D-to-3D transforms as a way to give depth to flat artwork.

**Consequences.** A change to the track format in either project is a change to check against the other. The format is small on purpose.

Status: accepted, 2026-09-29. Also recorded in `docs/architecture.md`.
