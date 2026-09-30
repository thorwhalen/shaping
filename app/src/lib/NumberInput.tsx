/**
 * A number field that lets the person clear it and type a new number: the value changes only when
 * what is typed is a number within `min`..`max` (see `editBuffer`). Other input props pass through.
 */
import type { ComponentProps } from 'react';
import { numberRules, useEditBuffer } from './editBuffer';

type NumberInputProps = Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type' | 'min' | 'max'> & {
  value: number;
  onValue: (value: number) => void;
  min?: number;
  max?: number;
};

export function NumberInput({ value, onValue, min, max, onBlur, ...props }: NumberInputProps) {
  const input = useEditBuffer(value, onValue, numberRules({ min, max }));
  return <input type="number" min={min} max={max} {...props} {...input} onBlur={(e) => (input.onBlur(), onBlur?.(e))} />;
}
