/**
 * A range slider with a ghost thumb. The value updates live while dragging. The ghost is a faint
 * second thumb: while dragging it stays where the drag started, so the way back is visible; at rest
 * it marks the default value (when the slider is elsewhere). Clicking the ghost returns there.
 */
import { useRef, useState } from 'react';

/** Width of the native range thumb, in pixels, so the ghost lines up with it. */
const THUMB_PX = 14;

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  /** Where the ghost rests when not dragging (usually the schema default). */
  restGhost?: number;
  disabled?: boolean;
  label: string;
}

export function Slider({ value, min, max, step, onChange, restGhost, disabled, label }: SliderProps) {
  const [dragStart, setDragStart] = useState<number | null>(null);
  const startRef = useRef<number | null>(null);
  const ghost = dragStart ?? restGhost;
  const showGhost = ghost !== undefined && Math.abs(ghost - value) > step / 2 && ghost >= min && ghost <= max;
  const pct = (v: number) => (max > min ? (v - min) / (max - min) : 0);
  const begin = () => {
    startRef.current = value;
    setDragStart(value);
  };
  const end = () => {
    startRef.current = null;
    setDragStart(null);
  };
  return (
    <div className="relative isolate flex w-full items-center">
      {showGhost && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`${label}: back to ${ghost}`}
          title={dragStart !== null ? `Back to where you started (${ghost})` : `Back to the default (${ghost})`}
          onClick={() => onChange(ghost!)}
          className="absolute top-1/2 z-10 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent/60 bg-accent/25 hover:bg-accent/50"
          style={{ left: `calc(${pct(ghost!)} * (100% - ${THUMB_PX}px) + ${THUMB_PX / 2}px)` }}
        />
      )}
      <input
        type="range"
        aria-label={label}
        className="relative z-20 w-full accent-[var(--color-accent)]"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onPointerDown={begin}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={() => startRef.current === null && begin()}
        onKeyUp={end}
        onBlur={end}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
