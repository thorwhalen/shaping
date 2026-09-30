/**
 * React binding of the pacer: `usePaced(value, onChange)` gives a control its own copy of the value
 * to show while the person moves it (so the thumb follows the hand even when the work behind it
 * cannot), and paces what reaches `onChange`. A `PacingProvider` sets, for every paced control inside
 * it, how the app knows its work is on screen (`settled`) and what to do while a gesture lasts
 * (`onGesture`, e.g. keep one undo step open).
 */
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPacer, type PacerOptions } from './pacer';

type Shared = Pick<PacerOptions, 'settled' | 'load' | 'settleMs' | 'maxWaitMs' | 'onGesture' | 'onError'>;
const PacingContext = createContext<Shared>({});
export const PacingProvider = PacingContext.Provider;

export function usePaced<T>(value: T, onChange: (value: T) => void) {
  const shared = useContext(PacingContext);
  const latest = useRef(onChange);
  useLayoutEffect(() => void (latest.current = onChange));
  const [local, setLocal] = useState<{ value: T } | null>(null);
  const pacer = useMemo(() => createPacer<T>((v) => latest.current(v), { ...shared, onIdle: () => setLocal(null) }), [shared]);
  // A control that goes away drops what it was holding (its release has already been applied).
  useEffect(() => () => pacer.cancel(), [pacer]);
  return {
    /** What the control shows: its own value while it is being moved, else `value`. */
    value: local ? local.value : value,
    push(v: T) {
      setLocal({ value: v });
      pacer.push(v);
    },
    commit(v?: T) {
      if (v !== undefined) setLocal({ value: v });
      pacer.commit(v);
    },
  };
}
