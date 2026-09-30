/**
 * An edit buffer for a controlled text or number input whose value has rules the half-typed text
 * may break: "never empty", "a positive number", "only these characters". The input shows what the
 * person is typing (the draft) and the value changes only when the draft parses; a draft that does
 * not parse stays on screen until it does, or until the field loses focus, when it shows the value
 * again. Without it, the value's rule is applied to every keystroke and the input snaps back: the
 * last character of a "never empty" text cannot be deleted, and "5" cannot become "12" by
 * deleting the 5 first.
 *
 * Nothing here knows the host app. extraction candidate: zodal-ui-shadcn text and number fields.
 */
import { useState, type ChangeEvent } from 'react';

export interface EditBufferRules<T> {
  /** How the value reads in the input. */
  format: (value: T) => string;
  /** The value a draft means, or `null` while it means none (empty, out of range, half-typed). */
  parse: (draft: string) => T | null;
  /** What the input may hold at all, applied to every keystroke (upper-case it, drop characters). Default: as typed. */
  clean?: (raw: string) => string;
}

/** One keystroke: what the input now shows, and the value to report (`null`: report nothing yet). */
export function typed<T>(raw: string, rules: EditBufferRules<T>): { draft: string; value: T | null } {
  const draft = rules.clean ? rules.clean(raw) : raw;
  return { draft, value: rules.parse(draft) };
}

/** What the input shows: the draft while the person is editing, else the value. */
export const shown = <T,>(draft: string | null, value: T, rules: EditBufferRules<T>): string => draft ?? rules.format(value);

/**
 * Props for an `<input>` that edits `value` through a draft. Spread them onto the input:
 * `<input {...useEditBuffer(value, onValue, rules)} />`.
 */
export function useEditBuffer<T>(value: T, onValue: (value: T) => void, rules: EditBufferRules<T>) {
  const [draft, setDraft] = useState<string | null>(null);
  return {
    value: shown(draft, value, rules),
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const next = typed(e.target.value, rules);
      setDraft(next.draft);
      if (next.value !== null) onValue(next.value);
    },
    // Leaving the field drops the draft, so an unparseable one (an emptied text) shows the value again.
    onBlur: () => setDraft(null),
  };
}

/** Rules for a number field: a draft means a number when it is one and lies within the bounds. */
export const numberRules = ({ min = -Infinity, max = Infinity }: { min?: number; max?: number } = {}): EditBufferRules<number> => ({
  format: String,
  parse: (s) => {
    if (s.trim() === '') return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  },
});
