import { describe, expect, it } from 'vitest';
import { filterBlockText, textFor } from '../fonts/editing';
import { numberRules, shown, typed, type EditBufferRules } from './editBuffer';

// The text of a source, as `TextInput` edits it: never empty, filtered for the block font.
const textRules = (font: string): EditBufferRules<string> => ({ format: (t) => t, parse: (d) => textFor(font, d) || null, clean: font === 'block' ? filterBlockText : undefined });

describe('edit buffer', () => {
  it('lets the last character of a never-empty text be deleted, and reports the text once retyped', () => {
    const rules = textRules('roboto');
    const emptied = typed('', rules);
    expect(emptied).toEqual({ draft: '', value: null }); // the input shows "", the text is unchanged
    expect(shown(emptied.draft, 'A', rules)).toBe(''); // the regression: it used to snap back to "A"
    expect(typed('B', rules)).toEqual({ draft: 'B', value: 'B' });
  });

  it('shows the value again when the field is left empty', () => {
    expect(shown(null, 'A', textRules('roboto'))).toBe('A');
  });

  it('cleans every keystroke for a filtered font', () => {
    expect(typed('ab!', textRules('block')).draft).toBe(filterBlockText('ab!'));
  });

  it('lets a number field be cleared and retyped, reporting only numbers within bounds', () => {
    const rules = numberRules({ min: 1, max: 2000 });
    expect(typed('', rules).value).toBeNull();
    expect(typed('1', rules).value).toBe(1);
    expect(typed('12', rules).value).toBe(12);
    expect(typed('0', rules).value).toBeNull();
    expect(typed('3000', rules).value).toBeNull();
    expect(typed('-', rules)).toEqual({ draft: '-', value: null });
  });
});
