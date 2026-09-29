/**
 * Pure edits of a text source, used by `TextSourceEditor`: change the font, set an axis, split the
 * text into runs and merge them back. Each returns a new source and keeps its invariants (`text`
 * is the runs' texts joined; axes belong to the font they were set for; nothing is empty or too long).
 */
import { BLOCK_FONT, BLOCK_FONT_CHARS, type TextSource } from 'shaping';
import { resolveRuns, type FontAxis } from 'shaping/fonts';

/** Longest text a source may hold (the schema's bound). */
export const MAX_TEXT_LENGTH = 64;
/** What text falls back to when a font accepts none of it (an emoji in the block font). */
const FALLBACK_TEXT = 'A';
/** The spacing a font starts with: one cell for the block font, no extra tracking for an outline font. */
export const DEFAULT_SPACING = { block: 1, outline: 0 } as const;

type Run = NonNullable<TextSource['runs']>[number];

const isBlock = (font: string) => font === BLOCK_FONT;
const spacingFor = (font: string) => (isBlock(font) ? DEFAULT_SPACING.block : DEFAULT_SPACING.outline);

/** The text a block-font input may hold: upper case, only the block font's characters. */
export const filterBlockText = (text: string): string => [...text.toUpperCase()].filter((c) => BLOCK_FONT_CHARS.includes(c)).join('');

/** Text as a font accepts it: filtered for the block font, else cut to the bound. */
export const textFor = (font: string, text: string): string => [...(isBlock(font) ? filterBlockText(text) : text)].slice(0, MAX_TEXT_LENGTH).join('');

const joined = (runs: Run[]): string => [...runs.map((r) => r.text).join('')].slice(0, MAX_TEXT_LENGTH).join('');

/** Choose the font of the whole source (or the default of its runs): axes reset, and the spacing default follows the kind of font. */
export function withFont(source: TextSource, font: string): TextSource {
  const wasDefault = source.spacing === spacingFor(source.font);
  const text = textFor(font, source.text) || FALLBACK_TEXT;
  return { ...source, font, text, axes: {}, spacing: wasDefault ? spacingFor(font) : source.spacing };
}

/** Set one axis; a value equal to the axis's default removes it (so the design stores only what the user changed). */
export function withAxis(axes: Record<string, number>, axis: FontAxis, value: number): Record<string, number> {
  const { [axis.tag]: _old, ...rest } = axes;
  return value === axis.default ? rest : { ...rest, [axis.tag]: value };
}

/** Axis values shown for a set of axes: what is stored, else each axis's default. */
export const axisValue = (axes: Record<string, number>, axis: FontAxis): number => axes[axis.tag] ?? axis.default;

// ---------------------------------------------------------------- runs

const inRuns = (source: TextSource, runs: Run[]): TextSource => ({ ...source, runs, text: joined(runs) || FALLBACK_TEXT });

/** Split into runs: the text becomes one run, with the source's font and axes. */
export function toRuns(source: TextSource): TextSource {
  return source.runs?.length ? source : inRuns(source, [{ text: source.text }]);
}

/** Merge the runs back into one text in the source's font. */
export function fromRuns(source: TextSource): TextSource {
  const { runs: _runs, ...rest } = source;
  return { ...rest, text: textFor(source.font, source.text) || FALLBACK_TEXT };
}

/** Add a run after the last one, in the same font. */
export function addRun(source: TextSource, text = FALLBACK_TEXT): TextSource {
  const runs = source.runs ?? [];
  const last = resolveRuns(source).at(-1);
  const font = last?.font ?? source.font;
  return inRuns(source, [...runs, { text: textFor(font, text) || FALLBACK_TEXT, ...(last && font !== source.font ? { font } : {}) }]);
}

/** Remove a run (the last one stays: text is never empty). */
export function removeRun(source: TextSource, index: number): TextSource {
  const runs = source.runs ?? [];
  return runs.length <= 1 ? source : inRuns(source, runs.filter((_, i) => i !== index));
}

/** Change a run. A change that would leave its text empty (after the font's filter) is ignored. */
export function patchRun(source: TextSource, index: number, patch: Partial<Run>): TextSource {
  const current = source.runs?.[index];
  if (!current) return source;
  const next = { ...current, ...patch };
  const text = textFor(next.font ?? source.font, next.text);
  if (!text) return source;
  return inRuns(source, (source.runs ?? []).map((r, i) => (i === index ? { ...next, text } : r)));
}

/** Give a run its own font; its axes reset. */
export const withRunFont = (source: TextSource, index: number, font: string): TextSource =>
  patchRun(source, index, { font, axes: undefined });
