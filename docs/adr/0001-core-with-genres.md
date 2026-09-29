# ADR 0001 — A core with genres, one kernel, data between the stages

**Context.** Two genres are required now and more are expected. A prototype of the first genre existed and had these limits: components were measured by hand; a design existed in two forms that could not be converted; the animated solid could not be exported; values were fixed in code.

**Decision.** The pipeline of section 2, with genres as plain objects (section 3), the seams of section 4, Manifold as the only solid kernel, and plain data between the stages.

**Consequences.** Every solid is manifold by construction, so there is no repair step. Anything shown can be exported. A new genre is one file. The cost is that every geometric operation must be expressed through the kernel or handed to it as a closed mesh, which rules out viewer-only effects.

**Known limit (2026-09-29 review).** Exporters receive meshes only. True STEP output from a B-rep kernel will need the `Model` to carry the kernel's native solid (or a handle to rebuild it), which changes `build` and `Model`; it is the one listed future change that does not arrive at an existing seam.

Status: accepted, 2026-09-29. Also recorded in `docs/architecture.md`.
