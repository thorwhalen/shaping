/**
 * React hooks over the font provider: the catalogue, and a loaded font's own axes. Both report a
 * status (`loading`, `ready`, `error`) so the interface can always say what is happening.
 */
import { useCallback, useEffect, useState } from 'react';
import { BLOCK_FONT } from 'shaping';
import { parseFontCached, type FontAxis, type FontEntry } from 'shaping/fonts';
import { fontProvider } from './provider';

export type Status = 'loading' | 'ready' | 'error';

export interface CatalogState {
  status: Status;
  entries: FontEntry[];
  error?: string;
  retry: () => void;
}

/** The font catalogue (fetched once, cached in the browser for a week). */
export function useCatalog(): CatalogState {
  const [state, setState] = useState<Omit<CatalogState, 'retry'>>({ status: 'loading', entries: [] });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading', entries: [] });
    fontProvider()
      .catalog()
      .then((entries) => live && setState({ status: 'ready', entries }))
      .catch((e) => live && setState({ status: 'error', entries: [], error: (e as Error).message }));
    return () => {
      live = false;
    };
  }, [attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}

export interface FaceState {
  status: Status;
  axes: FontAxis[];
  error?: string;
}

const NO_AXES: FontAxis[] = [];

/** The variable axes of a font, read from the font file itself (loading it if needed). The block font has none. */
export function useFontAxes(fontId: string): FaceState {
  const [state, setState] = useState<FaceState>({ status: 'ready', axes: NO_AXES });
  useEffect(() => {
    if (fontId === BLOCK_FONT) return setState({ status: 'ready', axes: NO_AXES });
    let live = true;
    setState({ status: 'loading', axes: NO_AXES });
    fontProvider()
      .load(fontId)
      .then(parseFontCached)
      .then((font) => live && setState({ status: 'ready', axes: font.axes }))
      .catch((e) => live && setState({ status: 'error', axes: NO_AXES, error: (e as Error).message }));
    return () => {
      live = false;
    };
  }, [fontId]);
  return state;
}
