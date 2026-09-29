---
name: shaping-dev-viewer-media
description: Use when working on the 3D viewer of shaping or on image, GIF and video output — react-three-fiber scene, materials and lighting dials, wall shadows, the section plane and its cap, turntables and parameter sweeps, frame-by-frame rendering, WebCodecs. Holds the renderer choice and what it rules out, the rule that diagnostics are drawn from kernel polygons, and the deterministic frame loop. Triggers on "viewer", "three.js", "r3f", "drei", "material", "shine", "transparency", "shadow on the wall", "clipping plane", "turntable", "GIF", "video export", "WebCodecs", "screenshot", "WebGPU".
metadata:
  audience: developers
---

# shaping — viewer and media

Evidence: `docs/research_report.md`, Part B, part 4, and Part C, section 2.4. Also read the global `tw-frontend-ux` skill.

## Rules

1. **The viewer draws the `Model`. It builds nothing.** Bodies become buffer geometries; diagnostics become flat meshes.
2. **WebGL renderer.** The WebGPU renderer is still described as experimental by its maintainers and does not support the staging helpers in use.
3. **No custom shaders.** They would have to be rewritten for another renderer, and they tempt effects the exporter cannot see.
4. **One WebGL context.** Thumbnails reuse the main renderer: resize, render, capture, restore. A second context can blank the first.
5. **Bundle the environment maps.** The presets in drei fetch from a CDN.

## Diagnostics are geometry

- **Wall shadows**: three layers from the checker's polygons — target (outline), achieved (fill), missing (marked). Exact at any zoom. Real directional light is a toggle, used when the object or a light leaves the axes.
- **Section cap**: the kernel's slice, drawn as a flat mesh on the clipping plane. "Show the original slice" places the plane where the transform's `originalSlice` says.
- A silhouette reads exactly only in an orthographic view. "Align to view" ends in one.

## Materials

Presets first: matte plastic, glossy plastic, brushed metal, polished metal, glass, resin. Raw dials (roughness, metalness, clearcoat, transmission, thickness, index of refraction, opacity) under "advanced". Opacity is the cheap see-through view; transmission is glass. Not both at once.

## Feedback

A rebuild over about 100 ms puts the viewer in a busy state and dims the old solid. The old solid is never left looking current.

## Animation and capture

Animation goes through the previz library (docs/architecture.md section 11): the adapter is `app/src/anim/engine.ts`, the state and its field kinds are in `app/src/anim/state.ts`, formulas in `app/src/anim/formulas.ts`. Do not add encoders or a frame loop to the app; add a formula, a field kind or an engine member instead. The rules below are what the adapter guarantees.

An animation is a function from a frame index to a `Design`. Frame N equals frame 0, so write N frames.

```
for i in 0..N-1:
    design = at(i)                     # view change, or a parameter change and a rebuild
    render to an offscreen target at the export size
    hand the pixels to the encoder, with timestamp i / fps
    wait while the encoder's queue is long
```

- Video: WebCodecs, muxed by `mediabunny`. Check the codec with `isConfigSupported`, falling back from H.264 to VP9 to VP8. H.264 needs even dimensions.
- GIF: `gifenc`, one palette for all frames, taken from a few sample frames, so colours do not flicker.
- Stills: PNG from the offscreen target, with a transparent background as an option.
- Without WebCodecs: record the canvas with manual frame requests, and say that the quality is lower.
- Ask for the file handle before a long export starts. The user gesture expires.

Never record the screen as the main path. It captures dropped frames and the machine's speed.
