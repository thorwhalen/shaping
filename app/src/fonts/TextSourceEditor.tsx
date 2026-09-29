/**
 * `TextSourceEditor`: everything a text source can be told, in one component.
 *
 * Text and font (from the whole open-font catalogue); the font's variable axes as sliders with
 * their real ranges and defaults (read from the font file itself, so a static font shows none);
 * several fonts in one text, as runs; and the round and spacing dials, which work for every font.
 * It edits a `TextSource` value and reports the next one; it knows nothing of the rest of the app.
 */
import { useState } from 'react';
import { BLOCK_FONT, TextSourceSchema, type TextSource } from 'shaping';
import { resolveRuns, type FontAxis } from 'shaping/fonts';
import { Dials } from '../dials/Dials';
import { addRun, axisValue, filterBlockText, fromRuns, MAX_TEXT_LENGTH, patchRun, removeRun, textFor, toRuns, withAxis, withFont, withRunFont } from './editing';
import { FontPicker } from './FontPicker';
import { useFontAxes } from './hooks';

/** Axes shown at once; the rest sit under "More axes". */
const PRIMARY_AXES = ['wght', 'wdth', 'opsz', 'slnt', 'ital'];
/** Steps per slider range when the axis gives no step. */
const SLIDER_STEPS = 200;
const AXIS_LABELS: Record<string, string> = { wght: 'Weight', wdth: 'Width', opsz: 'Optical size', slnt: 'Slant', ital: 'Italic', GRAD: 'Grade' };
const BLOCK_HINT = 'Block letters A–Z, digits and a few signs.';

export interface TextSourceEditorProps {
  value: TextSource;
  onChange: (next: TextSource) => void;
}

export function TextSourceEditor({ value, onChange }: TextSourceEditorProps) {
  const several = Boolean(value.runs?.length);
  return (
    <div className="flex flex-col gap-3">
      {several ? <RunsEditor value={value} onChange={onChange} /> : <SingleEditor value={value} onChange={onChange} />}
      <label className="flex cursor-pointer items-center justify-between gap-2 text-sm">
        <span>Several fonts in this text</span>
        <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={several} onChange={(e) => onChange(e.target.checked ? toRuns(value) : fromRuns(value))} />
      </label>
      <Dials schema={TextSourceSchema} value={value} only={['round', 'spacing']} onChange={(path, v) => onChange({ ...value, [path]: v } as TextSource)} />
      <p className="text-xs text-muted">Spacing is in cells for the block font and in tenths of an em for other fonts.</p>
    </div>
  );
}

function SingleEditor({ value, onChange }: TextSourceEditorProps) {
  const block = value.font === BLOCK_FONT;
  return (
    <div className="flex flex-col gap-3">
      <TextInput label="Text" font={value.font} text={value.text} onText={(text) => onChange({ ...value, text })} />
      {block && <span className="-mt-2 text-xs text-muted">{BLOCK_HINT}</span>}
      <FontPicker value={value.font} onChange={(font) => onChange(withFont(value, font))} />
      <AxisDials fontId={value.font} axes={value.axes} onChange={(axes) => onChange({ ...value, axes })} />
    </div>
  );
}

function RunsEditor({ value, onChange }: TextSourceEditorProps) {
  const runs = resolveRuns(value);
  return (
    <div className="flex flex-col gap-3">
      {runs.map((run, i) => (
        <fieldset key={i} className="flex flex-col gap-2 rounded-md border border-line bg-white/50 p-2">
          <legend className="px-1 text-xs text-muted">Run {i + 1}</legend>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextInput label="Text" font={run.font} text={run.text} onText={(text) => onChange(patchRun(value, i, { text }))} />
            </div>
            {runs.length > 1 && (
              <button type="button" aria-label={`Remove run ${i + 1}`} className="rounded border border-line bg-white px-2 py-1 text-xs hover:border-muted" onClick={() => onChange(removeRun(value, i))}>
                ✕
              </button>
            )}
          </div>
          <FontPicker value={run.font} onChange={(font) => onChange(withRunFont(value, i, font))} />
          <AxisDials fontId={run.font} axes={run.axes} onChange={(axes) => onChange(patchRun(value, i, { axes }))} />
        </fieldset>
      ))}
      <button type="button" className="self-start rounded border border-line bg-white px-2 py-1 text-xs hover:border-muted disabled:opacity-50" disabled={value.text.length >= MAX_TEXT_LENGTH} onClick={() => onChange(addRun(value))}>
        + Add a run
      </button>
    </div>
  );
}

function TextInput({ label, font, text, onText }: { label: string; font: string; text: string; onText: (text: string) => void }) {
  const block = font === BLOCK_FONT;
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        className={`rounded border border-line bg-white px-2 py-1 text-lg ${block ? 'font-mono uppercase' : ''}`}
        value={text}
        maxLength={MAX_TEXT_LENGTH}
        onChange={(e) => {
          const next = textFor(font, block ? filterBlockText(e.target.value) : e.target.value);
          if (next) onText(next);
        }}
      />
    </label>
  );
}

/** Sliders for a font's variable axes, from the font file's own axis table. */
function AxisDials({ fontId, axes, onChange }: { fontId: string; axes: Record<string, number>; onChange: (axes: Record<string, number>) => void }) {
  const face = useFontAxes(fontId);
  if (fontId === BLOCK_FONT) return null;
  if (face.status === 'loading') return <p className="text-xs text-muted" aria-live="polite">Loading the font…</p>;
  if (face.status === 'error') return <p className="text-xs text-red-700" role="alert">Could not load this font: {face.error}</p>;
  if (face.axes.length === 0) return <p className="text-xs text-muted">This font has no variable axes.</p>;
  const primary = face.axes.filter((a) => PRIMARY_AXES.includes(a.tag));
  const more = face.axes.filter((a) => !PRIMARY_AXES.includes(a.tag));
  const dial = (a: FontAxis) => <AxisDial key={a.tag} axis={a} value={axisValue(axes, a)} onChange={(v) => onChange(withAxis(axes, a, v))} />;
  return (
    <div className="flex flex-col gap-3">
      {primary.map(dial)}
      {more.length > 0 && (
        <details className="rounded-md border border-line bg-white/50 px-3 py-2">
          <summary className="cursor-pointer select-none text-sm font-medium">More axes ({more.length})</summary>
          <div className="mt-2 flex flex-col gap-3">{more.map(dial)}</div>
        </details>
      )}
    </div>
  );
}

function AxisDial({ axis, value, onChange }: { axis: FontAxis; value: number; onChange: (v: number) => void }) {
  const title = AXIS_LABELS[axis.tag] ?? axis.name ?? axis.tag;
  const step = axis.step && axis.step > 0 ? axis.step : (axis.max - axis.min) / SLIDER_STEPS;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-sm">
        <span title={axis.tag}>{title}</span>
        {value !== axis.default && (
          <button type="button" className="text-xs text-muted underline" onClick={() => onChange(axis.default)}>
            reset
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input type="range" aria-label={title} className="w-full accent-[var(--color-accent)]" min={axis.min} max={axis.max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted">{Number.isInteger(step) ? Math.round(value) : value.toFixed(2)}</span>
      </div>
    </div>
  );
}
