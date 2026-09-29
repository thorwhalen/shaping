/**
 * `shaping/fonts`: any open font as a figure.
 *
 * ```ts
 * import { fontsourceProvider, parseFont } from 'shaping/fonts';
 * const fonts = fontsourceProvider();                 // the catalogue and the files, from Fontsource
 * const entries = await fonts.catalog();              // ~2100 families with their variable axes
 * const font = await parseFont(await fonts.load('roboto-flex'));
 * font.axes;                                          // real ranges: wght 100..1000, wdth 25..151, ...
 * ```
 *
 * Text sources in any font but the block font resolve through `SourceResolvers.loadFont`; the
 * `build` facade supplies `defaultFontLoader` (Fontsource) by default. The provider is the seam.
 */
export { defaultFontLoader, fontsourceProvider, fontFileCandidates, mergeCatalog, nearestWeight, FONTSOURCE_API, FONTSOURCE_CDN } from './catalog.js';
export { isWoff2, toSfnt } from './decode.js';
export { flattenPath, FLATNESS_EM } from './flatten.js';
export { clampAxes, parseFont, parseFontCached, type GlyphOutline, type OutlineFont } from './outline.js';
export { CAP_HEIGHT_EM, isBlockOnly, outlineTextFigure, resolveRuns, ROUND_EM_FRACTION, TRACKING_UNIT_EM, type OutlineTextContext, type ResolvedRun } from './text.js';
export type { FontAxis, FontEntry, FontLoader, FontProvider, FontsourceOptions } from './types.js';
