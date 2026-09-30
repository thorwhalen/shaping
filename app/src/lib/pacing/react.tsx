/**
 * React binding of the pacer: `usePaced(value, onChange)` gives a control its own copy of the value
 * to show while the person moves it (so the thumb follows the hand even when the work behind it
 * cannot), and paces what reaches `onChange`. A `PacingProvider` sets how an app knows its work is on
 * screen (`settled`) for every paced control inside it.
 */
import { createContext, useContext, useMemo, useRef, useState } from 'react';
import { createPacer, type PacerOptions } from './pacer';

type Shared = Pick<PacerOptions, 'settled' | 'load' | 'settleMs' | 'maxWaitMs'>;
const PacingContext = createContext<Shared>({});
export const PacingProvider = PacingContext.Provider;

export function usePaced<T>(value: T, onChange: (value: T) => void) {
  const shared = useContext(PacingContext);
  const latest = useRef(onChange);
  latest.current = onChange;
  const [local, setLocal] = useState<{ value: T } | null>(null);
  // Not disposed on unmount: a value held for a pause still lands if the control goes away first.
  const pacer = useMemo(() => createPacer<T>((v) => latest.current(v), { ...shared, onIdle: () => setLocal(null) }), [shared]);
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
